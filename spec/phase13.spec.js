// Phase 13: capture scope. Capture this round (three modes, only that
// round's events, "nothing to capture" before anything launches) and the
// upload player filter (chosen after parsing, by parsed player index so two
// players with the same display name stay apart; a filtered kill still
// captures both POVs).
const fs = require('fs');
const { expect } = require('chai');
const { connection, reseed, teamWithMember } = require('./helpers');
const { buildReplay } = require('../services/demoParse');
const demoJobs = require('../services/demoJobs');
const captures = require('../services/captures');

const DEMO_BYTES = Buffer.concat([Buffer.from('PBDEMS2\0', 'latin1'), Buffer.alloc(64, 13)]);
const steam = (n) => `7656119000000000${n}`;

// Two rounds. Two different players are both called "alpha" (T, steam 1 and
// steam 3). Round 1: alpha#1 smokes (release 300) and kills bravo (500).
// Round 2: alpha#3 throws an HE (release 1300) and kills bravo (1500).
function demo() {
  const events = [
    { event_name: 'round_start', tick: 100 },
    { event_name: 'round_freeze_end', tick: 164 },
    { event_name: 'smokegrenade_detonate', tick: 400, entityid: 7, user_steamid: steam(1), x: -1000, y: 0, z: 0 },
    { event_name: 'player_death', tick: 500, user_steamid: steam(2), attacker_steamid: steam(1), weapon: 'ak47', headshot: true, penetrated: 0, user_X: 0, user_Y: 0, user_Z: 0 },
    { event_name: 'round_end', tick: 900, winner: 'T', reason: 't_killed', total_rounds_played: 1 },
    { event_name: 'round_start', tick: 1000 },
    { event_name: 'round_freeze_end', tick: 1064 },
    { event_name: 'hegrenade_detonate', tick: 1350, entityid: 9, user_steamid: steam(3), x: -500, y: 0, z: 0 },
    { event_name: 'player_death', tick: 1500, user_steamid: steam(2), attacker_steamid: steam(3), weapon: 'm4a1', headshot: false, penetrated: 0, user_X: 0, user_Y: 0, user_Z: 0 },
    { event_name: 'round_end', tick: 1800, winner: 'T', reason: 't_killed', total_rounds_played: 2 },
  ];
  const ticks = [];
  for (let t = 96; t <= 1900; t += 8) {
    const dead = (t >= 500 && t < 1000) || t >= 1500;
    ticks.push({ tick: t, steamid: steam(1), name: 'alpha', X: -1000, Y: 0, Z: 0, yaw: 0, is_alive: true, health: 100, team_num: 2 });
    ticks.push({ tick: t, steamid: steam(3), name: 'alpha', X: -900, Y: 50, Z: 0, yaw: 0, is_alive: true, health: 100, team_num: 2 });
    ticks.push({ tick: t, steamid: steam(2), name: 'bravo', X: 0, Y: 0, Z: 0, yaw: 90, is_alive: !dead, health: dead ? 0 : 100, team_num: 3 });
  }
  const flights = [
    { entity: 7, type: 'smoke', steamid: steam(1), ticks: [300, 304, 400], x: [-1500, -1300, -1000], y: [0, 0, 0], z: [0, 0, 0] },
    { entity: 9, type: 'he', steamid: steam(3), ticks: [1300, 1304, 1350], x: [-900, -700, -500], y: [0, 0, 0], z: [0, 0, 0] },
  ];
  return buildReplay({ header: { map_name: 'de_mirage' }, events, ticks, flights });
}

describe('phase 13', () => {
  const replay = demo();
  const players = replay.meta.players;
  const alphas = players.filter((p) => p.name === 'alpha').map((p) => p.index);
  let uploaded = [];

  beforeEach(reseed);
  afterEach(() => {
    captures._test.setEnabled(false);
    captures._test.setDriver(null);
    uploaded.forEach((k) => fs.rmSync(demoJobs.storagePath(k), { force: true }));
    uploaded = [];
  });

  async function uploadParsed(client, teamId, capture) {
    const q = capture ? `&capture=${capture}` : '';
    const { demo: d } = (await client.post(`/api/teams/${teamId}/demos?file_name=m.dem${q}`)
      .set('Content-Type', 'application/octet-stream').send(DEMO_BYTES).expect(201)).body;
    const row = await connection('demos').where('demo_id', d.demo_id).first();
    uploaded.push(row.storage_key);
    expect(await demoJobs.processNext({ parse: async () => replay })).to.include({ status: 'ready' });
    return row;
  }
  const kinds = async (sessionId) => (await connection('demo_captures').where('session_id', sessionId).orderBy('moment_tick'))
    .map((r) => [r.round_number, r.kind]);

  it('has two players with the same display name and different parsed identities', () => {
    expect(alphas).to.have.length(2);
    expect(alphas[0]).to.not.equal(alphas[1]);
  });

  describe('capture this round', () => {
    it('counts and queues only the selected round, for each mode', async () => {
      captures._test.setEnabled(true);
      const { member, owner, teamId } = await teamWithMember();
      const d = await uploadParsed(owner, teamId, null);
      const url = `/api/demos/${d.demo_id}/captures/batch`;
      const dry = (await member.post(url).send({ selection: 'all', round_number: 2, dry_run: true }).expect(200)).body;
      expect(dry).to.include({ total: 2, kills: 1, utility: 1 });
      expect(await connection('capture_sessions').where('demo_id', d.demo_id)).to.have.length(0);

      for (const [selection, want] of [['all', [[2, 'utility'], [2, 'kill']]], ['kill', [[2, 'kill']]], ['utility', [[2, 'utility']]]]) {
        const res = (await member.post(url).send({ selection, round_number: 2 }).expect(202)).body;
        // Queued only once all its events are attached (never picked up half-built).
        expect(res.session).to.include({ mode: 'batch', selection, round_number: 2, status: 'queued' });
        expect(await kinds(res.session.session_id)).to.deep.equal(want);
        // Let the next mode requeue the same events.
        await connection('demo_captures').where('demo_id', d.demo_id).update({ status: 'failed' });
        await connection('capture_sessions').where('session_id', res.session.session_id).update({ status: 'done' });
      }
      await member.post(url).send({ selection: 'all', round_number: 9 }).expect(404);
      const other = await teamWithMember();
      await other.member.post(url).send({ selection: 'all', round_number: 2 }).expect(404);
    });

    it('says there is nothing to capture before anything is queued or launched', async () => {
      captures._test.setEnabled(true);
      const { member, owner, teamId } = await teamWithMember();
      const d = await uploadParsed(owner, teamId, null);
      const url = `/api/demos/${d.demo_id}/captures/batch`;
      // Round 1's kill is by alpha#1: a round + player scope can be empty.
      const dry = (await member.post(url).send({ selection: 'kill', round_number: 1, player: alphas[1], dry_run: true }).expect(200)).body;
      expect(dry.total).to.equal(0);
      const res = await member.post(url).send({ selection: 'kill', round_number: 1, player: alphas[1] }).expect(409);
      expect(res.body.code).to.equal('no_events');
      expect(await connection('capture_sessions').where('demo_id', d.demo_id)).to.have.length(0);
    });
  });

  describe('upload player filter', () => {
    it('keeps the option pending after parsing until the uploader picks players', async () => {
      captures._test.setEnabled(true);
      const { owner, member, teamId } = await teamWithMember();
      const d = await uploadParsed(owner, teamId, 'all');
      const lib = (await owner.get(`/api/teams/${teamId}/demos`).expect(200)).body.demos;
      expect(lib.find((x) => x.demo_id === d.demo_id).capture_pending).to.equal('all');
      expect(await connection('capture_sessions').where('demo_id', d.demo_id)).to.have.length(0);
      // Only the uploader answers their own upload's option.
      await member.post(`/api/demos/${d.demo_id}/captures/batch`).send({ selection: 'all', pending: true }).expect(403);
      await member.delete(`/api/demos/${d.demo_id}/capture-pending`).expect(403);
      await owner.delete(`/api/demos/${d.demo_id}/capture-pending`).expect(200);
      const after = (await owner.get(`/api/teams/${teamId}/demos`).expect(200)).body.demos;
      expect(after.find((x) => x.demo_id === d.demo_id).capture_pending).to.equal(null);
    });

    it('filters by parsed player identity: kills they made and utility they threw', async () => {
      captures._test.setEnabled(true);
      const { owner, teamId } = await teamWithMember();
      const d = await uploadParsed(owner, teamId, 'all');
      const url = `/api/demos/${d.demo_id}/captures/batch`;
      const first = (await owner.post(url).send({ selection: 'all', player: alphas[0], pending: true }).expect(202)).body;
      expect(first.session).to.include({ player_index: alphas[0], player_name: 'alpha' });
      expect(await kinds(first.session.session_id)).to.deep.equal([[1, 'utility'], [1, 'kill']]);
      await connection('capture_sessions').where('session_id', first.session.session_id).update({ status: 'done' });
      await connection('demo_captures').where('demo_id', d.demo_id).update({ status: 'failed' });
      // The other "alpha" gets only their own round-2 events.
      const second = (await owner.post(url).send({ selection: 'kill', player: alphas[1] }).expect(202)).body;
      expect(await kinds(second.session.session_id)).to.deep.equal([[2, 'kill']]);
      await owner.post(url).send({ selection: 'kill', player: 42 }).expect(400);
    });

    it('still captures both POVs of a filtered kill', async () => {
      captures._test.setEnabled(true);
      const calls = [];
      captures._test.setDriver({
        check: async () => ({ cs2_installed: true, runtime: true, uinput: true, encoder: true }),
        inputs: async () => ({}),
        open: () => ({
          async call(req) {
            calls.push(req);
            if (req.op === 'open' || req.op === 'load') return { ok: true, timings: {} };
            if (req.op === 'segment') {
              const outputs = req.outputs.map((o) => { fs.writeFileSync(o.file, 'fixture'); return { file: o.file, start: o.start, end: o.end, player: req.player }; });
              return { ok: true, outputs, encoded: outputs.map((o) => o.file), timings: {} };
            }
            if (req.op === 'flush') return { ok: true, encoded: [], timings: {} };
            return { ok: false, code: 'bad_job', error: 'unexpected' };
          },
          async close() { return { closed: true }; },
        }),
      });
      const { owner, teamId } = await teamWithMember();
      const d = await uploadParsed(owner, teamId, 'kill');
      await owner.post(`/api/demos/${d.demo_id}/captures/batch`).send({ selection: 'kill', player: alphas[1], pending: true }).expect(202);
      await captures._test.runOnce();
      const segs = calls.filter((c) => c.op === 'segment');
      expect(segs.map((c) => c.player).sort()).to.deep.equal(['alpha', 'bravo']);
      const row = await connection('demo_captures').where({ demo_id: d.demo_id, kind: 'kill' }).first();
      expect(row.status).to.equal('ready');
      expect(row.media.map((m) => m.role)).to.deep.equal(['killer_clip', 'victim_clip']);
    });
  });
});
