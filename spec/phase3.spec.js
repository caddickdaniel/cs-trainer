// Phase 3: board additions, community tactic sharing, Game Mode tactic picker,
// Demo Review events, the demo library and live demo review.
const fs = require('fs');
const zlib = require('zlib');
const { expect } = require('chai');
const {
  connection, reseed, signUp, tacticDoc, teamWithMember, addMember, TINY_PNG,
} = require('./helpers');
const demoJobs = require('../services/demoJobs');
const { buildReplay, findRounds, radarTransform, DemoError } = require('../services/demoParse');
const config = require('../config/env');

const futureIso = (hours) => new Date(Date.now() + hours * 3600 * 1000).toISOString();
const DEMO_BYTES = Buffer.concat([Buffer.from('PBDEMS2\0', 'latin1'), Buffer.alloc(64, 1)]);

// A board with a hold, a sized note and utility for player p1.
function boardDoc(p1, p2, overrides = {}) {
  return tacticDoc([p1, p2], {
    map: 'de_nuke',
    phases: [{
      name: 'Setup',
      notes: '',
      board: {
        markers: [
          { id: 'm1', kind: 'player', x: 0.2, y: 0.3, level: 'main', user_id: p1, label: '', images: [] },
          { id: 'm2', kind: 'smoke', x: 0.5, y: 0.5, level: 'main', user_id: p1, label: '', images: [] },
          { id: 'm3', kind: 'note', x: 0.6, y: 0.6, level: 'lower', user_id: null, label: 'Wait for the ramp smoke before you swing', size: 30, images: [] },
          { id: 'm4', kind: 'player', x: 0.4, y: 0.4, level: 'lower', user_id: p2, label: '', images: [] },
        ],
        routes: [{ id: 'r1', level: 'main', user_id: p1, color: '#ffffff', points: [{ x: 0.2, y: 0.3 }, { x: 0.35, y: 0.45 }] }],
        holds: [{ id: 'h1', marker_id: 'm4', angle: 45, spread: 60, length: 0.15 }],
      },
      assignments: [
        { user_id: p1, instruction: 'Smoke ramp', utility: 'Smoke', reference_url: 'https://example.com/private-notes' },
        { user_id: p2, instruction: 'Hold secret', utility: '' },
      ],
    }],
    ...overrides,
  });
}

async function uploadLineup(client, teamId) {
  return (await client.post(`/api/teams/${teamId}/lineup-images`).set('Content-Type', 'image/png').send(TINY_PNG).expect(201)).body.image.image_id;
}

describe('phase 3', () => {
  beforeEach(reseed);
  // Uploaded test demos live in a test-only folder; start each test empty.
  beforeEach(() => {
    if (config.isTest && /demos-test$/.test(config.demoStorageDir)) fs.rmSync(config.demoStorageDir, { recursive: true, force: true });
  });

  describe('tactics board', () => {
    it('saves holds, sized multi-line notes and floors, and rejects holds without a player marker', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const doc = boardDoc(owner.user.user_id, member.user.user_id);
      const { tactic } = (await owner.post(`/api/teams/${teamId}/tactics`).send(doc).expect(201)).body;
      const board = (await member.get(`/api/tactics/${tactic.tactic_id}/document`).expect(200)).body.tactic.phases[0].board;
      expect(board.holds).to.deep.equal(doc.phases[0].board.holds);
      expect(board.markers.find((m) => m.id === 'm3')).to.include({ label: 'Wait for the ramp smoke before you swing', size: 30, level: 'lower' });

      const bad = boardDoc(owner.user.user_id, member.user.user_id);
      bad.phases[0].board.holds = [{ id: 'h1', marker_id: 'm2', angle: 0, spread: 60, length: 0.1 }];
      await owner.post(`/api/teams/${teamId}/tactics`).send(bad).expect(400);
      const longLabel = boardDoc(owner.user.user_id, member.user.user_id);
      longLabel.phases[0].board.markers[1].label = 'x'.repeat(41);
      await owner.post(`/api/teams/${teamId}/tactics`).send(longLabel).expect(400);
    });

    it('older boards without holds or slots load with defaults', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const { tactic } = (await owner.post(`/api/teams/${teamId}/tactics`).send(tacticDoc([owner.user.user_id])).expect(201)).body;
      // Simulate a board saved before Phase 3.
      await connection('tactic_phases').where('tactic_id', tactic.tactic_id)
        .update({ board: JSON.stringify({ markers: [{ id: 'old', kind: 'note', x: 0.5, y: 0.5, user_id: null, label: 'i' }], routes: [] }) });
      const { body } = await member.get(`/api/tactics/${tactic.tactic_id}/document`).expect(200);
      expect(body.tactic.phases[0].board.holds).to.deep.equal([]);
      expect(body.tactic.phases[0].board.markers[0]).to.include({ slot: null, label: 'i' });
    });
  });

  describe('shared tactics', () => {
    async function publishedSetup() {
      const a = await teamWithMember();
      const imageId = await uploadLineup(a.owner, a.teamId);
      const doc = boardDoc(a.owner.user.user_id, a.member.user.user_id);
      doc.phases[0].board.markers[1].images = [{ image_id: imageId, caption: 'Stand on the box' }];
      const { tactic } = (await a.owner.post(`/api/teams/${a.teamId}/tactics`).send(doc).expect(201)).body;
      return { ...a, imageId, tactic };
    }

    it('publishes a private-identifier-free snapshot that later edits do not change', async () => {
      const { owner, member, teamId, imageId, tactic } = await publishedSetup();
      await member.post(`/api/tactics/${tactic.tactic_id}/share`).send({}).expect(403);
      const preview = (await owner.get(`/api/tactics/${tactic.tactic_id}/share`).expect(200)).body;
      expect(preview.listing).to.equal(null);
      expect(preview.image_count).to.equal(1);
      // The preview shows exactly what is published: no private image ids.
      expect(JSON.stringify(preview)).not.to.include(imageId);
      expect(JSON.stringify(preview)).not.to.include('private-notes');
      const { tactic: listing } = (await owner.post(`/api/tactics/${tactic.tactic_id}/share`).send({}).expect(200)).body;

      const viewer = await signUp('Viewer');
      const { body } = await viewer.get(`/api/shared-tactics/${listing.share_id}`).expect(200);
      const text = JSON.stringify(body);
      const team = await connection('teams').where('team_id', teamId).first('team_name');
      for (const secret of [owner.user.user_name, member.user.user_name, team.team_name, 'private-notes', imageId, '/api/lineup-images']) {
        expect(text).not.to.include(secret);
      }
      expect(text).not.to.match(/"user_id":\s*\d/);
      const phase = body.tactic.phases[0];
      expect(phase.assignments.map((a) => a.slot)).to.deep.equal([1, 2]);
      const smoke = phase.board.markers.find((m) => m.id === 'm2');
      expect(smoke.slot).to.equal(1);
      expect(smoke.images[0].url).to.match(new RegExp(`^/api/shared-tactics/${listing.share_id}/images/`));
      await viewer.get(smoke.images[0].url).expect(200).expect('Content-Type', 'image/png');
      // The team's private image stays private.
      await viewer.get(`/api/lineup-images/${imageId}`).expect(404);

      // Editing the private tactic does not change the listing.
      const doc = (await owner.get(`/api/tactics/${tactic.tactic_id}/document`).expect(200)).body.tactic;
      await owner.put(`/api/tactics/${tactic.tactic_id}/document`).send({
        ...boardDoc(owner.user.user_id, member.user.user_id), tactic_name: 'Renamed privately', revision: doc.revision,
      }).expect(200);
      expect((await viewer.get(`/api/shared-tactics/${listing.share_id}`).expect(200)).body.tactic.tactic_name).to.equal(tactic.tactic_name);
      expect((await owner.get(`/api/tactics/${tactic.tactic_id}/share`).expect(200)).body.out_of_date).to.equal(true);
    });

    it('enforces one vote per user, derives the score and blocks voting on your own listing', async () => {
      const { owner, tactic } = await publishedSetup();
      const { tactic: listing } = (await owner.post(`/api/tactics/${tactic.tactic_id}/share`).send({}).expect(200)).body;
      const [u1, u2] = [await signUp('Voter'), await signUp('Voter')];
      await u1.put(`/api/shared-tactics/${listing.share_id}/vote`).send({ value: 1 }).expect(200);
      await u1.put(`/api/shared-tactics/${listing.share_id}/vote`).send({ value: 1 }).expect(200);
      let res = await u2.put(`/api/shared-tactics/${listing.share_id}/vote`).send({ value: -1 }).expect(200);
      expect(res.body.tactic).to.include({ score: 0, upvotes: 1, downvotes: 1, my_vote: -1 });
      res = await u2.put(`/api/shared-tactics/${listing.share_id}/vote`).send({ value: 1 }).expect(200);
      expect(res.body.tactic).to.include({ score: 2, my_vote: 1 });
      res = await u1.put(`/api/shared-tactics/${listing.share_id}/vote`).send({ value: 0 }).expect(200);
      expect(res.body.tactic).to.include({ score: 1, my_vote: 0 });
      await u1.put(`/api/shared-tactics/${listing.share_id}/vote`).send({ value: 5 }).expect(400);
      await owner.put(`/api/shared-tactics/${listing.share_id}/vote`).send({ value: 1 }).expect(403);
      expect(await connection('shared_tactic_votes').where('share_id', listing.share_id).count('* as n').first()).to.deep.equal({ n: '1' });
      // The database enforces the one-vote rule too.
      let dup = null;
      try {
        await connection('shared_tactic_votes').insert({ share_id: listing.share_id, user_id: u2.user.user_id, value: 1 });
      } catch (err) { dup = err; }
      expect(dup && dup.code).to.equal('23505');
    });

    it('imports an independent slot-based copy for another team; withdrawing stops new imports only', async () => {
      const { owner, tactic } = await publishedSetup();
      const { tactic: listing } = (await owner.post(`/api/tactics/${tactic.tactic_id}/share`).send({}).expect(200)).body;
      const b = await teamWithMember();
      await b.member.post(`/api/shared-tactics/${listing.share_id}/import`).send({ team_id: b.teamId }).expect(403);
      await b.owner.post(`/api/shared-tactics/${listing.share_id}/import`).send({ team_id: 999999 }).expect(404);
      const { tactic_id: copyId } = (await b.owner.post(`/api/shared-tactics/${listing.share_id}/import`).send({ team_id: b.teamId }).expect(201)).body;

      const copy = (await b.owner.get(`/api/tactics/${copyId}/document`).expect(200)).body.tactic;
      expect(copy.imported_from_share_id).to.equal(listing.share_id);
      expect(copy.map).to.equal('de_nuke');
      const phase = copy.phases[0];
      expect(phase.assignments.map((a) => [a.user_id, a.slot])).to.deep.equal([[null, 1], [null, 2]]);
      expect(phase.board.markers.every((m) => m.user_id === null)).to.equal(true);
      expect(phase.board.markers.find((m) => m.id === 'm3').level).to.equal('lower');
      expect(phase.board.holds).to.have.length(1);
      const copiedImage = phase.board.markers.find((m) => m.id === 'm2').images[0].image_id;
      await b.member.get(`/api/lineup-images/${copiedImage}`).expect(200);
      await owner.get(`/api/lineup-images/${copiedImage}`).expect(404);

      // Map Player 1 and 2 to team B's roster and save; the copy is editable.
      const ids = [b.owner.user.user_id, b.member.user.user_id];
      const mapped = {
        ...copy,
        phases: copy.phases.map((p) => ({
          ...p,
          board: {
            ...p.board,
            markers: p.board.markers.map((m) => (m.slot ? { ...m, user_id: ids[m.slot - 1] } : m)),
            routes: p.board.routes.map((r) => (r.slot ? { ...r, user_id: ids[r.slot - 1] } : r)),
          },
          assignments: p.assignments.map((a) => ({ user_id: ids[a.slot - 1], slot: a.slot, instruction: a.instruction, utility: a.utility })),
        })),
      };
      const saved = (await b.owner.put(`/api/tactics/${copyId}/document`).send(mapped).expect(200)).body.tactic;
      expect(saved.phases[0].assignments.map((a) => a.user_id)).to.have.members(ids);

      // Withdraw: gone from browse, previews, images and imports; the copy still works.
      const sharedImage = (await b.owner.get(`/api/shared-tactics/${listing.share_id}`).expect(200)).body.tactic.phases[0].board.markers[1].images[0].url;
      await b.owner.delete(`/api/shared-tactics/${listing.share_id}`).expect(404);
      await owner.delete(`/api/shared-tactics/${listing.share_id}`).expect(200);
      expect((await b.owner.get('/api/shared-tactics').expect(200)).body.tactics).to.have.length(0);
      await b.owner.get(`/api/shared-tactics/${listing.share_id}`).expect(404);
      await b.owner.get(sharedImage).expect(404);
      await b.owner.post(`/api/shared-tactics/${listing.share_id}/import`).send({ team_id: b.teamId }).expect(404);
      await b.member.get(`/api/tactics/${copyId}/document`).expect(200);
      await b.member.get(`/api/lineup-images/${copiedImage}`).expect(200);
    });

    it('lists with filters and keeps team tactics and rosters private', async () => {
      const { owner, tactic, teamId } = await publishedSetup();
      await owner.post(`/api/tactics/${tactic.tactic_id}/share`).send({ include_images: false }).expect(200);
      const viewer = await signUp('Browser');
      expect((await viewer.get('/api/shared-tactics?map=de_nuke&side=T').expect(200)).body.tactics).to.have.length(1);
      expect((await viewer.get('/api/shared-tactics?map=de_mirage').expect(200)).body.tactics).to.have.length(0);
      await viewer.get('/api/shared-tactics?map=nowhere').expect(400);
      await viewer.get(`/api/tactics/${tactic.tactic_id}/document`).expect(404);
      await viewer.get(`/api/teams/${teamId}/roster`).expect(404);
      await viewer.get(`/api/tactics/${tactic.tactic_id}/share`).expect(404);
    });
  });

  describe('Game Mode tactic picker', () => {
    it('lets only the IGL queue an eligible tactic and starts it at phase one next round', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const ids = [owner.user.user_id, member.user.user_id];
      const mk = async (name, economy, side = 'T', map = 'de_mirage') => (await owner.post(`/api/teams/${teamId}/tactics`)
        .send(tacticDoc(ids, { tactic_name: name, economy, side, map })).expect(201)).body.tactic.tactic_id;
      const full = await mk('A full', 'Fullbuy');
      const pistol = await mk('Z pistol', 'Pistol');
      const eco = await mk('M eco', 'Eco');
      const ct = await mk('CT setup', 'Fullbuy', 'CT');
      const { session } = (await owner.post(`/api/teams/${teamId}/game-session`).send({ tactic_id: full }).expect(201)).body;
      expect(session.side_tactics.map((t) => t.tactic_id)).to.deep.equal([pistol, eco, full]);
      expect(session.side_tactics[0]).to.include({ economy: 'Pistol' });

      const cmd = (who, body, version) => who.post(`/api/game-sessions/${session.session_id}/command`).send({ ...body, expected_version: version });
      await cmd(member, { action: 'tactic_select', tactic_id: eco }, 1).expect(403);
      await cmd(owner, { action: 'tactic_select', tactic_id: ct }, 1).expect(400);
      let s = (await cmd(owner, { action: 'phase_next' }, 1).expect(200)).body.session;
      s = (await cmd(owner, { action: 'tactic_select', tactic_id: eco }, s.version).expect(200)).body.session;
      expect(s.selected_tactic).to.include({ tactic_id: eco, economy: 'Eco' });
      expect(s.tactic.tactic_id).to.equal(full);
      expect(s.current_phase).to.equal(1);

      const teammate = (await member.get(`/api/teams/${teamId}/game-session`).expect(200)).body.session;
      expect(teammate.can_control).to.equal(false);
      expect(teammate.side_tactics).to.equal(undefined);
      expect(teammate.selected_tactic.tactic_id).to.equal(eco);

      s = (await cmd(owner, { action: 'new_round' }, s.version).expect(200)).body.session;
      expect(s).to.include({ round_number: 2, current_phase: 0 });
      expect(s.tactic.tactic_id).to.equal(eco);
      const after = (await member.get(`/api/teams/${teamId}/game-session`).expect(200)).body.session;
      expect(after.tactic.tactic_name).to.equal('M eco');
      expect(after.my_assignment).to.not.equal(undefined);
    });
  });

  describe('calendar Demo Review events', () => {
    it('links a demo from the same team only', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const { demo } = (await owner.post(`/api/teams/${teamId}/demos?file_name=scrim.dem`)
        .set('Content-Type', 'application/octet-stream').send(DEMO_BYTES).expect(201)).body;
      const other = await teamWithMember();
      const { demo: foreign } = (await other.owner.post(`/api/teams/${other.teamId}/demos?file_name=x.dem`)
        .set('Content-Type', 'application/octet-stream').send(Buffer.concat([DEMO_BYTES, Buffer.from('other')])).expect(201)).body;
      const base = { kind: 'demo_review', title: 'Review scrim', starts_at: futureIso(4), time_zone: 'Europe/London' };
      await owner.post(`/api/teams/${teamId}/events`).send({ ...base, demo_id: foreign.demo_id }).expect(400);
      await owner.post(`/api/teams/${teamId}/events`).send({ ...base, kind: 'training', demo_id: demo.demo_id }).expect(400);
      const { event } = (await owner.post(`/api/teams/${teamId}/events`).send({ ...base, demo_id: demo.demo_id }).expect(201)).body;
      expect(event).to.include({ kind: 'demo_review', demo_id: demo.demo_id });
      expect(event.demo).to.include({ title: 'scrim' });
      const next = (await member.get(`/api/teams/${teamId}/events/next`).expect(200)).body.event;
      expect(next).to.include({ event_id: event.event_id, kind: 'demo_review' });
      const changed = (await owner.patch(`/api/teams/${teamId}/events/${event.event_id}`).send({ kind: 'training' }).expect(200)).body.event;
      expect(changed.demo_id).to.equal(null);
    });
  });

  describe('demo library', () => {
    let uploaded = [];
    afterEach(() => {
      uploaded.forEach((k) => fs.rmSync(demoJobs.storagePath(k), { force: true }));
      uploaded = [];
    });
    const upload = (client, teamId, body = DEMO_BYTES, name = 'match.dem') => client.post(`/api/teams/${teamId}/demos?file_name=${name}`)
      .set('Content-Type', 'application/octet-stream').send(body);

    it('validates uploads and keeps demos team-scoped', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const notDemo = await upload(owner, teamId, Buffer.from('definitely not a demo file')).expect(415);
      expect(notDemo.body.code).to.equal('not_a_demo');
      const csgo = await upload(owner, teamId, Buffer.concat([Buffer.from('HL2DEMO\0', 'latin1'), Buffer.alloc(32)])).expect(415);
      expect(csgo.body.code).to.equal('csgo_demo');
      await owner.post(`/api/teams/${teamId}/demos`).set('Content-Type', 'text/plain').send('x').expect(415);

      const { demo } = (await upload(member, teamId).expect(201)).body;
      uploaded.push((await connection('demos').where('demo_id', demo.demo_id).first('storage_key')).storage_key);
      expect(demo).to.include({ status: 'queued', title: 'match', byte_size: DEMO_BYTES.length });
      expect((await upload(owner, teamId).expect(409)).body.code).to.equal('demo_exists');
      // Upload files never land in storage when rejected.
      const files = fs.readdirSync(config.demoStorageDir).filter((f) => f.endsWith('.dem'));
      expect(files).to.have.length(1);

      const outsider = await signUp('Outsider');
      await outsider.get(`/api/demos/${demo.demo_id}`).expect(404);
      await outsider.get(`/api/teams/${teamId}/demos`).expect(404);
      await upload(outsider, teamId, Buffer.concat([DEMO_BYTES, Buffer.from('z')])).expect(404);
      await outsider.get(`/api/demos/${demo.demo_id}/annotations`).expect(404);
      await outsider.delete(`/api/demos/${demo.demo_id}`).expect(404);
      expect((await member.get(`/api/teams/${teamId}/demos`).expect(200)).body.demos).to.have.length(1);
    });

    it('processes demos in the background, serves round data and reports failures', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const { demo } = (await upload(owner, teamId).expect(201)).body;
      uploaded.push((await connection('demos').where('demo_id', demo.demo_id).first('storage_key')).storage_key);
      const replay = buildReplay(syntheticDemo());
      expect(await demoJobs.processNext({ parse: async () => replay })).to.include({ status: 'ready' });
      const detail = (await member.get(`/api/demos/${demo.demo_id}`).expect(200)).body.demo;
      expect(detail).to.include({ status: 'ready', map: 'de_nuke', round_count: 2 });
      expect(detail.players.map((p) => p.name)).to.deep.equal(['alpha', 'bravo']);
      expect(JSON.stringify(detail)).not.to.include('7656');
      const round = await member.get(`/api/demos/${demo.demo_id}/rounds/1`).expect(200).expect('Content-Encoding', 'gzip');
      expect(round.body.roster).to.have.length(2);
      expect(round.body.events.map((e) => e.type)).to.include.members(['kill', 'round_end']);
      await member.get(`/api/demos/${demo.demo_id}/rounds/9`).expect(404);

      const { demo: second } = (await upload(owner, teamId, Buffer.concat([DEMO_BYTES, Buffer.from('2')]), 'b.dem').expect(201)).body;
      uploaded.push((await connection('demos').where('demo_id', second.demo_id).first('storage_key')).storage_key);
      await demoJobs.processNext({ parse: async () => { throw new DemoError('unsupported_map', 'cs_office isn\'t supported for 2D replay yet.'); } });
      const failed = (await owner.get(`/api/demos/${second.demo_id}`).expect(200)).body.demo;
      expect(failed).to.include({ status: 'failed', error_code: 'unsupported_map' });
      await member.post(`/api/demos/${second.demo_id}/retry`).expect(403);
      await owner.post(`/api/demos/${second.demo_id}/retry`).expect(200);
    });

    it('runs the real parser in a child process and reports unreadable files', async () => {
      const { owner, teamId } = await teamWithMember();
      const { demo } = (await upload(owner, teamId).expect(201)).body;
      uploaded.push((await connection('demos').where('demo_id', demo.demo_id).first('storage_key')).storage_key);
      const result = await demoJobs.processNext();
      expect(result.status).to.equal('failed');
      const row = await connection('demos').where('demo_id', demo.demo_id).first();
      expect(row.status).to.equal('failed');
      expect(row.error_message).to.be.a('string').and.not.equal('');
    });

    it('saves, lists and removes annotations with author permissions', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const { demo } = (await upload(owner, teamId).expect(201)).body;
      uploaded.push((await connection('demos').where('demo_id', demo.demo_id).first('storage_key')).storage_key);
      await demoJobs.processNext({ parse: async () => buildReplay(syntheticDemo()) });
      const third = await addMember(owner, teamId, 'Third');
      const text = { kind: 'text', round_number: 1, tick: 140, level: 'lower', data: { x: 0.5, y: 0.5, text: 'Rotate earlier' } };
      const { annotation } = (await member.post(`/api/demos/${demo.demo_id}/annotations`).send(text).expect(201)).body;
      expect(annotation).to.include({ round_number: 1, tick: 140, level: 'lower', kind: 'text' });
      await member.post(`/api/demos/${demo.demo_id}/annotations`).send({ ...text, round_number: 7 }).expect(400);
      await member.post(`/api/demos/${demo.demo_id}/annotations`)
        .send({ kind: 'drawing', round_number: 1, tick: 150, data: { points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] } }).expect(201);
      expect((await third.get(`/api/demos/${demo.demo_id}/annotations?round=1`).expect(200)).body.annotations).to.have.length(2);
      await third.delete(`/api/demos/${demo.demo_id}/annotations/${annotation.annotation_id}`).expect(403);
      await owner.delete(`/api/demos/${demo.demo_id}/annotations/${annotation.annotation_id}`).expect(200);
      expect((await member.get(`/api/demos/${demo.demo_id}/annotations?round=1`).expect(200)).body.annotations).to.have.length(1);
    });
  });

  describe('live demo review', () => {
    async function readyDemo() {
      const t = await teamWithMember();
      const { demo } = (await t.owner.post(`/api/teams/${t.teamId}/demos?file_name=live.dem`)
        .set('Content-Type', 'application/octet-stream').send(DEMO_BYTES).expect(201)).body;
      const key = (await connection('demos').where('demo_id', demo.demo_id).first('storage_key')).storage_key;
      await demoJobs.processNext({ parse: async () => buildReplay(syntheticDemo()) });
      return { ...t, demo, key };
    }

    it('is controlled by the IGL, followed read-only by teammates and independent of Game Mode', async () => {
      const { owner, member, teamId, demo, key } = await readyDemo();
      try {
        await member.post(`/api/teams/${teamId}/review`).send({ demo_id: demo.demo_id }).expect(403);
        const { review } = (await owner.post(`/api/teams/${teamId}/review`).send({ demo_id: demo.demo_id }).expect(201)).body;
        expect(review).to.include({ round_number: 1, playing: false, can_control: true });
        await owner.post(`/api/teams/${teamId}/review`).send({ demo_id: demo.demo_id }).expect(409);

        // The teammate joins late and sees the same state, read-only.
        const cmd = (who, body, version) => who.post(`/api/reviews/${review.review_id}/command`).send({ ...body, expected_version: version });
        let r = (await cmd(owner, { action: 'seek', tick: 150 }, 1).expect(200)).body.review;
        r = (await cmd(owner, { action: 'play' }, r.version).expect(200)).body.review;
        const joined = (await member.get(`/api/teams/${teamId}/review`).expect(200)).body.review;
        expect(joined).to.include({ review_id: review.review_id, playing: true, can_control: false, version: r.version });
        expect(joined.position_tick).to.be.at.least(150);
        await cmd(member, { action: 'pause' }, r.version).expect(403);
        await member.post(`/api/reviews/${review.review_id}/annotations`)
          .send({ kind: 'text', round_number: 1, tick: 160, data: { x: 0.1, y: 0.1, text: 'mine' } }).expect(403);

        // Stale versions are rejected with the latest state.
        const stale = await cmd(owner, { action: 'pause' }, 1).expect(409);
        expect(stale.body.review.version).to.equal(r.version);
        r = (await cmd(owner, { action: 'pause' }, r.version).expect(200)).body.review;
        expect(r.playing).to.equal(false);
        r = (await cmd(owner, { action: 'seek', tick: 999999 }, r.version).expect(200)).body.review;
        const round1 = await connection('demo_rounds').where({ demo_id: demo.demo_id, round_number: 1 }).first('end_tick');
        expect(r.anchor_tick).to.equal(round1.end_tick);

        // Drawings sync to followers; clearing removes only this review's drawings for the round.
        await member.post(`/api/demos/${demo.demo_id}/annotations`)
          .send({ kind: 'text', round_number: 1, tick: 140, data: { x: 0.3, y: 0.3, text: 'saved note' } }).expect(201);
        r = (await owner.post(`/api/reviews/${review.review_id}/annotations`)
          .send({ kind: 'drawing', round_number: 1, tick: 150, data: { points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.4 }] } }).expect(201)).body.review;
        expect((await member.get(`/api/reviews/${review.review_id}`).expect(200)).body.review.annotations).to.have.length(1);
        r = (await cmd(owner, { action: 'round', round_number: 2 }, r.version).expect(200)).body.review;
        expect(r).to.include({ round_number: 2, playing: false });
        r = (await cmd(owner, { action: 'round', round_number: 1 }, r.version).expect(200)).body.review;
        r = (await cmd(owner, { action: 'clear' }, r.version).expect(200)).body.review;
        expect(r.annotations).to.have.length(0);
        expect((await member.get(`/api/demos/${demo.demo_id}/annotations?round=1`).expect(200)).body.annotations).to.have.length(1);

        // Non-members can't see it; Game Mode was never touched.
        const outsider = await signUp('Outsider');
        await outsider.get(`/api/reviews/${review.review_id}`).expect(404);
        await outsider.get(`/api/teams/${teamId}/review`).expect(404);
        expect(await connection('game_sessions').where('team_id', teamId).count('* as n').first()).to.deep.equal({ n: '0' });

        // Transferring IGL revokes control immediately.
        await owner.patch(`/api/teams/${teamId}/members/${member.user.user_id}`).send({ player_role: 'igl' }).expect(200);
        await cmd(owner, { action: 'play' }, r.version).expect(403);
        r = (await cmd(member, { action: 'play' }, r.version).expect(200)).body.review;
        expect(r.can_control).to.equal(true);
        await member.post(`/api/reviews/${review.review_id}/end`).expect(200);
        expect((await owner.get(`/api/teams/${teamId}/review`).expect(200)).body.review).to.equal(null);
      } finally {
        fs.rmSync(demoJobs.storagePath(key), { force: true });
      }
    });
  });

  describe('demo parsing', () => {
    it('converts world positions to the radar, including the lower floor on Nuke', () => {
      const nuke = radarTransform('de_nuke');
      expect(nuke(-3453, 2887, 0)).to.deep.equal({ x: 0, y: 0, level: 'main' });
      expect(nuke(-3453 + 7 * 512, 2887 - 7 * 512, -600)).to.deep.equal({ x: 0.5, y: 0.5, level: 'lower' });
      expect(radarTransform('de_mirage')(-3230 + 5 * 1024, 1713, 0).x).to.equal(1);
      expect(radarTransform('cs_office')).to.equal(null);
      expect(() => buildReplay({ ...syntheticDemo(), header: { map_name: 'cs_office' } })).to.throw(/isn't supported/);
    });

    it('finds rounds and replaces restarted ones', () => {
      const ev = (event_name, tick, extra = {}) => ({ event_name, tick, ...extra });
      // Round 2 is played, then restored from a backup and replayed (won by T).
      const rounds = findRounds([
        ev('round_start', 10), ev('round_end', 100, { winner: 'T', total_rounds_played: 1 }),
        ev('round_start', 120), ev('round_end', 200, { winner: 'CT', total_rounds_played: 2 }),
        ev('round_start', 230), ev('round_end', 320, { winner: 'T', total_rounds_played: 2 }),
        ev('round_start', 340), ev('round_end', 400, { winner: 'CT', total_rounds_played: 3 }),
      ]);
      expect(rounds.map((r) => [r.round_number, r.winner, r.start_tick])).to.deep.equal([[1, 'T', 10], [2, 'T', 230], [3, 'CT', 340]]);
    });

    const fixture = process.env.CS_DEMO_FIXTURE;
    (fixture ? it : it.skip)(`parses a real CS2 demo (CS_DEMO_FIXTURE=${fixture || 'unset'})`, async function realDemo() {
      this.timeout(120000);
      const result = await demoJobs.parseInChild(fixture);
      expect(result.rounds.length).to.be.greaterThan(0);
      expect(Object.keys(require('../domain/constants').RADAR_TRANSFORMS)).to.include(result.map);
      for (const r of result.rounds) {
        for (const t of r.data.tracks) {
          t.x.forEach((x, i) => { if (t.hp[i] > 0) expect(x).to.be.within(0, 1); });
        }
      }
      const json = JSON.stringify(result.rounds[0].data);
      expect(zlib.gzipSync(json).length).to.be.lessThan(2 * 1024 * 1024);
    });
  });
});

// Two short rounds on Nuke with one player on each side.
function syntheticDemo() {
  const events = [
    { event_name: 'round_start', tick: 100 },
    { event_name: 'round_freeze_end', tick: 120 },
    { event_name: 'player_death', tick: 160, attacker_steamid: '76561190000000001', user_steamid: '76561190000000002', weapon: 'ak47', headshot: true, user_X: 0, user_Y: 0, user_Z: -600 },
    { event_name: 'round_end', tick: 200, winner: 'T', reason: 't_killed' },
    { event_name: 'round_start', tick: 400 },
    { event_name: 'round_freeze_end', tick: 420 },
    { event_name: 'round_end', tick: 500, winner: 'CT', reason: 'bomb_defused' },
  ];
  const ticks = [];
  for (let t = 96; t <= 700; t += 8) {
    ticks.push({ tick: t, steamid: '76561190000000001', name: 'alpha', X: -1000 + t, Y: 0, Z: 0, yaw: 90, is_alive: true, health: 100, team_num: t < 300 ? 2 : 3 });
    ticks.push({ tick: t, steamid: '76561190000000002', name: 'bravo', X: 0, Y: -t, Z: -600, yaw: 0, is_alive: t < 160 || t > 300, health: 50, team_num: t < 300 ? 3 : 2 });
  }
  return { header: { map_name: 'de_nuke', server_name: 'test' }, events, ticks };
}
