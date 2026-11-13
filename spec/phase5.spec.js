// Phase 5: per-platform ranks, team requirements and competitions, voting,
// seeded shared tactics, per-player buy lists, shortcut defaults, share code
// import and utility annotations in Demo Review.
const fs = require('fs');
const http = require('http');
const { execSync } = require('child_process');
const { expect } = require('chai');
const { connection, reseed, signUp, teamWithMember, addMember } = require('./helpers');
const config = require('../config/env');
const demoJobs = require('../services/demoJobs');
const { buildReplay, DemoError } = require('../services/demoParse');
const { decodeShareCode, encodeShareCode } = require('../services/shareCode');
const { mergeShortcuts } = require('../services/profiles');
const U = require('../domain/utility');
const { ensureSharedTactics, sharedTacticSnapshots } = require('../db/lib/sharedTactics');

const DEMO_BYTES = Buffer.concat([Buffer.from('PBDEMS2\0', 'latin1'), Buffer.alloc(64, 1)]);

function syntheticDemo() {
  const events = [
    { event_name: 'round_start', tick: 100 },
    { event_name: 'round_freeze_end', tick: 120 },
    { event_name: 'round_end', tick: 200, winner: 'T', reason: 't_killed' },
  ];
  const ticks = [];
  for (let t = 96; t <= 300; t += 8) ticks.push({ tick: t, steamid: '76561190000000001', name: 'alpha', X: 0, Y: 0, Z: 0, yaw: 0, is_alive: true, health: 100, team_num: 2 });
  return { header: { map_name: 'de_mirage', server_name: 'test' }, events, ticks };
}

// A T tactic on Mirage: player 1 buys two flashes and throws one in each phase.
function buyDoc(p1, p2, overrides = {}) {
  const player = (id, uid) => ({ id, kind: 'player', x: 0.5, y: 0.5, level: 'main', user_id: uid, label: '', images: [] });
  return {
    tactic_name: 'Flash split', map: 'de_mirage', side: 'T', economy: 'Fullbuy', grenade: 2, molly: 1, flash: 5, smoke: 3,
    loadouts: [{ user_id: p1, slot: null, smoke: 1, flash: 2, molly: 0, he: 0, kit: false }],
    bomb_carrier: { user_id: p2, slot: null },
    phases: [
      { name: 'One', board: { markers: [player('a', p1), player('b', p2), { id: 'f1', kind: 'flash', x: 0.4, y: 0.4, level: 'main', user_id: p1, label: '', images: [] },
        { id: 's-ref', kind: 'smoke', x: 0.3, y: 0.3, level: 'main', user_id: p1, label: '', images: [], reference: true }], routes: [] },
      assignments: [{ user_id: p1, instruction: 'Flash A', utility: '' }, { user_id: p2, instruction: 'Bomb', utility: '' }] },
      { name: 'Two', board: { markers: [player('c', p1), player('d', p2), { id: 'f2', kind: 'flash', x: 0.42, y: 0.4, level: 'main', user_id: p1, label: '', images: [] }], routes: [] },
        assignments: [] },
      { name: 'Three', board: { markers: [player('e', p1), player('g', p2)], routes: [] }, assignments: [] },
    ],
    ...overrides,
  };
}

describe('phase 5', () => {
  beforeEach(reseed);

  describe('ranks, requirements and competitions', () => {
    it('saves one rank per platform independently and filters players by every active platform filter', async () => {
      const p = await signUp('Ranked');
      let res = await p.patch('/api/me/profile').send({ ranks: { premier: 'premier:15000', faceit: 'faceit:8', esea: 'esea:b' } }).expect(200);
      expect(res.body.profile.ranks).to.deep.equal({ premier: 'premier:15000', faceit: 'faceit:8', esea: 'esea:b' });
      // Editing one keeps the other two.
      res = await p.patch('/api/me/profile').send({ ranks: { faceit: 'faceit:9' } }).expect(200);
      expect(res.body.profile.ranks).to.deep.equal({ premier: 'premier:15000', faceit: 'faceit:9', esea: 'esea:b' });
      res = await p.patch('/api/me/profile').send({ ranks: { esea: null } }).expect(200);
      expect(res.body.profile.ranks.esea).to.equal(null);
      await p.patch('/api/me/profile').send({ ranks: { premier: 'faceit:9' } }).expect(400);
      await p.patch('/api/me/profile').send({ ranks: { valve: 'x' } }).expect(400);

      const q = await signUp('FaceitOnly');
      await q.patch('/api/me/profile').send({ ranks: { faceit: 'faceit:9' } }).expect(200);
      const viewer = await signUp('Viewer');
      const ids = async (qs) => (await viewer.get(`/api/players/available?${qs}`).expect(200)).body.players.map((x) => x.user_id);
      expect(await ids('faceit=faceit:9')).to.include.members([p.user.user_id, q.user.user_id]);
      expect(await ids('faceit=faceit:9&premier=premier:15000')).to.deep.equal([p.user.user_id]);
      expect(await ids('premier=premier:15000&esea=esea:b')).to.deep.equal([]);
      const row = (await viewer.get('/api/players/available?faceit=faceit:9').expect(200)).body.players.find((x) => x.user_id === q.user.user_id);
      expect(row.ranks).to.deep.equal({ premier: null, faceit: 'faceit:9', esea: null });
    });

    it('migrates a single legacy rank into the matching platform and keeps ambiguous text for review', async () => {
      const p = await signUp('Legacy');
      await connection('users').where('user_id', p.user.user_id).update({ platform: 'FACEIT', skill_level: '10' });
      let res = await p.get('/api/me/profile').expect(200);
      // "FACEIT 10" spans several Elo bands: kept as legacy text, no rank invented.
      expect(res.body.profile).to.include({ legacy_platform: 'FACEIT', legacy_skill_level: '10' });
      expect(res.body.profile.ranks.faceit).to.equal(null);
      res = await p.patch('/api/me/profile').send({ ranks: { faceit: 'faceit:10-2251' } }).expect(200);
      expect(res.body.profile.legacy_platform).to.equal('FACEIT');
      res = await p.patch('/api/me/profile').send({ clear_legacy_rank: true }).expect(200);
      expect(res.body.profile).to.include({ legacy_platform: null, legacy_skill_level: null });
      // A legacy value that maps exactly is represented by the rank instead.
      await connection('users').where('user_id', p.user.user_id).update({ platform: 'ESEA', skill_level: 'B+', esea_rank: 'esea:b+' });
      res = await p.get('/api/me/profile').expect(200);
      expect(res.body.profile.legacy_platform).to.equal(null);
    });

    it('stores several team requirements (exact or range) and competitions, distinct from player ranks', async () => {
      const owner = await signUp('Founder');
      const reqs = [{ platform: 'faceit', min: 'faceit:6', max: 'faceit:9' }, { platform: 'premier', min: 'premier:20000', max: 'premier:20000' }];
      const { body } = await owner.post('/api/teams').send({ team_name: 'Req Team', language: 'English', region: 'EU West', rank_requirements: reqs, competitions: ['ukic-league', 'premier'] }).expect(201);
      const teamId = body.teams.team_id;
      await owner.post('/api/teams').send({ team_name: 'Bad' }).expect(409);
      await owner.patch(`/api/teams/${teamId}/recruiting`).send({ rank_requirements: [{ platform: 'faceit', min: 'faceit:9', max: 'faceit:6' }] }).expect(400);
      await owner.patch(`/api/teams/${teamId}/recruiting`).send({ rank_requirements: [reqs[0], reqs[0]] }).expect(400);
      await owner.patch(`/api/teams/${teamId}/recruiting`).send({ competitions: ['made-up'] }).expect(400);
      await connection('teams').where('team_id', teamId).update({ recruiting_leagues: 'Old league text' });
      await owner.patch(`/api/teams/${teamId}/recruiting`).send({ is_recruiting: true }).expect(200);
      const viewer = await signUp('Looker');
      let team = (await viewer.get(`/api/recruiting/teams/${teamId}`).expect(200)).body.team;
      expect(team.rank_requirements).to.deep.equal(reqs);
      expect(team.competitions).to.deep.equal(['ukic-league', 'premier']);
      expect(team.recruiting_leagues).to.equal('Old league text');
      // Editing the competitions replaces the legacy free text.
      await owner.patch(`/api/teams/${teamId}/recruiting`).send({ competitions: ['esea-league'] }).expect(200);
      team = (await viewer.get(`/api/recruiting/teams/${teamId}`).expect(200)).body.team;
      expect(team).to.include({ recruiting_leagues: null });
      expect(team.competitions).to.deep.equal(['esea-league']);
      const listed = (await viewer.get('/api/recruiting/teams').expect(200)).body.teams.find((t) => t.team_id === teamId);
      expect(listed.rank_requirements).to.have.length(2);
      // The owner's own profile ranks are untouched.
      expect((await owner.get('/api/me/profile').expect(200)).body.profile.ranks).to.deep.equal({ premier: null, faceit: null, esea: null });
      const cat = (await viewer.get('/api/catalogue').expect(200)).body;
      expect(cat.competitions.map((c) => c.group)).to.include.members(['Leagues', 'Matchmaking']);
    });
  });

  describe('shared tactic voting', () => {
    it('applies +1 / -2 / clear arithmetic, persists the choice and refuses votes from the publishing team', async () => {
      await ensureSharedTactics(connection, 'x');
      const listing = await connection('shared_tactics').first('share_id', 'source_team_id');
      const voter = await signUp('Voter');
      const second = await signUp('Second');
      const vote = (who, value) => who.put(`/api/shared-tactics/${listing.share_id}/vote`).send({ value });
      expect((await vote(voter, 1).expect(200)).body.tactic).to.include({ score: 1, my_vote: 1 });
      expect((await vote(voter, -1).expect(200)).body.tactic).to.include({ score: -1, my_vote: -1 });
      expect((await vote(second, -1).expect(200)).body.tactic).to.include({ score: -2, my_vote: -1 });
      expect((await vote(voter, 0).expect(200)).body.tactic).to.include({ score: -1, my_vote: 0 });
      // Reload: the stored vote and score are what the browser shows.
      const again = (await second.get(`/api/shared-tactics/${listing.share_id}`).expect(200)).body.tactic;
      expect(again).to.include({ score: -1, my_vote: -1, is_mine: false });
      const listed = (await second.get('/api/shared-tactics').expect(200)).body.tactics.find((t) => t.share_id === listing.share_id);
      expect(listed).to.include({ score: -1, my_vote: -1 });
      // The publishing team can't vote and is told so by is_mine.
      const ownerRow = await connection('teams').where('team_id', listing.source_team_id).first('owner');
      const ownerEmail = (await connection('users').where('user_id', ownerRow.owner).first('email')).email;
      await connection('users').where('email', ownerEmail).update({ password_hash: require('bcryptjs').hashSync('library-pass-1', 4) });
      const { signIn } = require('./helpers');
      const owner = await signIn(ownerEmail, { password: 'library-pass-1' });
      expect((await owner.get(`/api/shared-tactics/${listing.share_id}`).expect(200)).body.tactic.is_mine).to.equal(true);
      expect((await vote(owner, 1).expect(403)).body.code).to.equal('own_listing');
      await vote(voter, 2).expect(400);
    });
  });

  describe('seeded shared tactics', () => {
    it('creates 30 complete listings once and refreshes them without duplicating or resetting votes', async () => {
      const snaps = sharedTacticSnapshots();
      expect(snaps).to.have.length(30);
      const combos = {};
      for (const s of snaps) {
        combos[`${s.tactic.side}:${s.tactic.economy}`] = (combos[`${s.tactic.side}:${s.tactic.economy}`] || 0) + 1;
        expect(s.phases.length).to.be.at.least(2);
        for (const p of s.phases) {
          expect(p.board.markers.filter((m) => m.kind === 'player').map((m) => m.slot).sort()).to.deep.equal([1, 2, 3, 4, 5]);
          expect(p.assignments.map((a) => a.slot)).to.deep.equal([1, 2, 3, 4, 5]);
          p.assignments.forEach((a) => expect(a.instruction).to.not.equal(''));
        }
        const plan = U.utilityPlan({ loadouts: s.tactic.loadouts, phases: s.phases, side: s.tactic.side, bomb: s.tactic.bomb_carrier });
        expect(plan.flatMap((x) => x.over)).to.deep.equal([]);
      }
      expect(Object.values(combos)).to.deep.equal(Array(10).fill(3));
      expect(new Set(snaps.map((s) => s.tactic.map)).size).to.be.at.least(5);

      await ensureSharedTactics(connection, 'x');
      const first = await connection('shared_tactics').where('phase_count', '>', 0).first('share_id');
      const voter = await signUp('Fan');
      await voter.put(`/api/shared-tactics/${first.share_id}/vote`).send({ value: 1 }).expect(200);
      await ensureSharedTactics(connection, 'x');
      expect(Number((await connection('shared_tactics').count('* as n').first()).n)).to.equal(30);
      expect(Number((await connection('shared_tactic_votes').where('share_id', first.share_id).count('* as n').first()).n)).to.equal(1);
    });

    it('imports seeded T and CT tactics with all five slots, buy lists and the bomb carrier mappable', async () => {
      await ensureSharedTactics(connection, 'x');
      const { owner, teamId } = await teamWithMember();
      for (const side of ['T', 'CT']) {
        const listing = await connection('shared_tactics').where({ side }).first('share_id');
        const { tactic_id: tacticId } = (await owner.post(`/api/shared-tactics/${listing.share_id}/import`).send({ team_id: teamId }).expect(201)).body;
        const doc = (await owner.get(`/api/tactics/${tacticId}/document`).expect(200)).body.tactic;
        expect(doc.loadouts.map((l) => l.slot).sort()).to.deep.equal([1, 2, 3, 4, 5]);
        expect(doc.bomb_carrier).to.deep.equal(side === 'T' ? { user_id: null, slot: 3 } : null);
        if (side === 'CT') expect(doc.loadouts.some((l) => l.kit)).to.equal(true);
        doc.phases.forEach((p) => expect(new Set(p.assignments.map((a) => a.slot)).size).to.equal(5));
      }
    });
  });

  describe('per-player buy lists', () => {
    it('validates buy lists, the bomb and kits and keeps legacy team totals', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const [p1, p2] = [owner.user.user_id, member.user.user_id];
      const { tactic } = (await owner.post(`/api/teams/${teamId}/tactics`).send(buyDoc(p1, p2)).expect(201)).body;
      expect(tactic).to.include({ flash: 5, smoke: 3, molly: 1, grenade: 2 });
      expect(tactic.loadouts[0]).to.include({ user_id: p1, flash: 2 });
      expect(tactic.bomb_carrier).to.deep.equal({ user_id: p2, slot: null });
      const bad = (o) => owner.post(`/api/teams/${teamId}/tactics`).send(buyDoc(p1, p2, o)).expect(400);
      await bad({ loadouts: [{ user_id: p1, flash: 3 }] });
      await bad({ loadouts: [{ user_id: p1, smoke: 1, flash: 2, molly: 1, he: 1 }] }); // 5 grenades
      await bad({ loadouts: [{ user_id: p1, kit: true }] }); // kit on T
      await bad({ side: 'CT', bomb_carrier: { user_id: p2 } });
      await bad({ loadouts: [{ user_id: 999999, flash: 1 }] });
      await owner.post(`/api/teams/${teamId}/tactics`).send(buyDoc(p1, p2, { side: 'CT', bomb_carrier: null, loadouts: [{ user_id: p1, kit: true }] })).expect(201);
    });

    it('derives remaining utility per phase in Game Mode, identically after moving back and reconnecting, from the round snapshot', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const [p1, p2] = [owner.user.user_id, member.user.user_id];
      const { tactic } = (await owner.post(`/api/teams/${teamId}/tactics`).send(buyDoc(p1, p2)).expect(201)).body;
      let s = (await owner.post(`/api/teams/${teamId}/game-session`).send({ tactic_id: tactic.tactic_id }).expect(201)).body.session;
      expect(s.my_utility).to.deep.include({ buy: { smoke: 1, flash: 2, molly: 0, he: 0 }, available: { smoke: 1, flash: 2, molly: 0, he: 0 } });
      expect(s.my_utility.planned).to.include({ flash: 1, smoke: 0 }); // the reference smoke is not a throw
      expect(s.utility.find((u) => u.user_id === p2)).to.include({ bomb: true });
      expect(s.bomb_carrier).to.deep.equal({ user_id: p2, slot: null });
      const step = async (action) => (await owner.post(`/api/game-sessions/${s.session_id}/command`).send({ action, expected_version: s.version }).expect(200)).body.session;
      s = await step('phase_next');
      expect(s.my_utility.available).to.include({ flash: 1, smoke: 1 });
      s = await step('phase_next');
      expect(s.my_utility.available).to.include({ flash: 0, smoke: 1 });
      s = await step('phase_prev');
      expect(s.my_utility.available).to.include({ flash: 1 });
      // Editing the saved tactic doesn't change the live round.
      const doc = (await owner.get(`/api/tactics/${tactic.tactic_id}/document`).expect(200)).body.tactic;
      await owner.put(`/api/tactics/${tactic.tactic_id}/document`).send({ ...buyDoc(p1, p2, { loadouts: [] }), revision: doc.revision }).expect(200);
      const fresh = (await owner.get(`/api/teams/${teamId}/game-session`).expect(200)).body.session;
      expect(fresh.my_utility.available).to.include({ flash: 1 });
      // The teammate sees their own (bomb) responsibility only, not everyone's.
      const theirs = (await member.get(`/api/teams/${teamId}/game-session`).expect(200)).body.session;
      expect(theirs.my_utility).to.include({ bomb: true });
      expect(theirs.utility).to.equal(undefined);
    });

    it('flags plans that throw more than the player buys and counts a repeated marker once', () => {
      const phases = [
        { board: { markers: [{ id: 'x', kind: 'he', user_id: 1 }] } },
        { board: { markers: [{ id: 'x', kind: 'he', user_id: 1 }, { id: 'y', kind: 'he', user_id: 1 }] } },
      ];
      const [plan] = U.utilityPlan({ loadouts: [{ user_id: 1, he: 1 }], phases, side: 'T' });
      expect(plan.phases.map((p) => p.used.he)).to.deep.equal([1, 1]);
      expect(plan.over).to.deep.equal([{ phase: 1, kind: 'he', planned: 1, available: 0 }]);
      expect(U.loadoutsFromThrows([{ board: { markers: [{ id: 'a', kind: 'flash', user_id: 3 }, { id: 'b', kind: 'flash', user_id: 3 }, { id: 'c', kind: 'flash', user_id: 3 }] } }]))
        .to.deep.equal([{ user_id: 3, slot: null, smoke: 0, flash: 2, molly: 0, he: 0, kit: false }]);
    });

    it('carries buy lists and the bomb through Player 1-5 slots when sharing', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const [p1, p2] = [owner.user.user_id, member.user.user_id];
      const { tactic } = (await owner.post(`/api/teams/${teamId}/tactics`).send(buyDoc(p1, p2)).expect(201)).body;
      const { tactic: listing } = (await owner.post(`/api/tactics/${tactic.tactic_id}/share`).send({}).expect(200)).body;
      expect(JSON.stringify(listing)).to.not.include(`"user_id":${p1}`);
      expect(listing.loadouts).to.deep.equal([{ user_id: null, slot: 1, smoke: 1, flash: 2, molly: 0, he: 0, kit: false }]);
      expect(listing.bomb_carrier).to.deep.equal({ user_id: null, slot: 2 });
      expect(listing.phases[0].board.markers.find((m) => m.id === 's-ref').reference).to.equal(true);
    });
  });

  describe('shortcut defaults', () => {
    it('uses the new defaults, keeps saved bindings and never gives two actions the same key', async () => {
      const p = await signUp('Keys');
      expect((await p.get('/api/me/settings').expect(200)).body.shortcuts).to.deep.equal({
        phase_prev: 'ArrowLeft', phase_next: 'ArrowRight', tactic_prev: 'ArrowUp', tactic_next: 'ArrowDown', new_round: 'Home', switch_side: 'End',
      });
      await p.put('/api/me/settings').send({ shortcuts: { phase_prev: 'A', phase_next: 'D', tactic_prev: '[', tactic_next: ']', new_round: 'N', switch_side: 'S' } }).expect(200);
      expect((await p.get('/api/me/settings').expect(200)).body.shortcuts).to.include({ phase_prev: 'A', new_round: 'N' });
      const reset = (await p.put('/api/me/settings').send({ shortcuts: null }).expect(200)).body.shortcuts;
      expect(reset).to.include({ new_round: 'Home', switch_side: 'End' });
      expect(mergeShortcuts({ phase_next: 'ArrowUp' })).to.include({ phase_next: 'ArrowUp', tactic_prev: '[' });
    });
  });

  describe('match share codes', () => {
    let servers = [];
    const saved = {};
    beforeEach(() => { ['matchReplayProviderUrl', 'matchReplayHosts'].forEach((k) => { saved[k] = config[k]; }); });
    afterEach(async () => {
      Object.assign(config, saved);
      await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
      servers = [];
    });
    const listen = (handler) => new Promise((resolve) => {
      const s = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${s.address().port}`));
      servers.push(s);
    });

    it('decodes and validates codes', () => {
      const ids = decodeShareCode('CSGO-GADqf-jjyJ8-cSP2r-smZRo-TO2xK');
      expect(ids).to.include({ match_id: '3230642215713767580', outcome_id: '3230647599455273103', token: 55788 });
      expect(encodeShareCode(ids)).to.equal('CSGO-GADqf-jjyJ8-cSP2r-smZRo-TO2xK');
      expect(() => decodeShareCode('CSGO-GADqf-jjyJ8')).to.throw(/share code/);
      expect(() => decodeShareCode('CSGO-IIIII-jjyJ8-cSP2r-smZRo-TO2xK')).to.throw(/share code/);
    });

    it('explains missing configuration, fetches a replay through the provider and processes it like an upload', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const code = encodeShareCode({ match_id: '3230642215713767581', outcome_id: '3230647599455273103', token: 55788 });
      config.matchReplayProviderUrl = null;
      expect((await owner.post(`/api/teams/${teamId}/demos/share-code`).send({ share_code: code }).expect(503)).body.code).to.equal('replay_provider_missing');
      expect((await owner.post(`/api/teams/${teamId}/demos/share-code`).send({ share_code: 'nope' }).expect(400)).body.code).to.equal('invalid_share_code');

      const replay = await listen((req, res) => res.end(execSync('bzip2 -c', { input: DEMO_BYTES })));
      let asked = null;
      config.matchReplayProviderUrl = await listen((req, res) => {
        asked = req.url;
        if (req.url.startsWith('/matches/3230642215713767581')) return res.end(JSON.stringify({ replay_url: `${replay}/730/match.dem.bz2` }));
        res.statusCode = 404;
        return res.end('{}');
      });
      config.matchReplayHosts = [/^127\.0\.0\.1$/];
      const res = await member.post(`/api/teams/${teamId}/demos/share-code`).send({ share_code: code }).expect(202);
      expect(res.body.demo).to.include({ status: 'queued', source: 'share_code', share_code: code });
      // The same match is reused rather than imported again.
      expect((await owner.post(`/api/teams/${teamId}/demos/share-code`).send({ share_code: code }).expect(200)).body).to.include({ existing: true });

      let parsedFile = null;
      const out = await demoJobs.processNext({ parse: async (file) => { parsedFile = file; return buildReplay(syntheticDemo()); } });
      expect(out).to.include({ status: 'ready' });
      expect(asked).to.include('outcome_id=3230647599455273103').and.include('token=55788');
      expect(fs.readFileSync(parsedFile).equals(DEMO_BYTES)).to.equal(true);
      fs.rmSync(parsedFile, { force: true });
      const demo = (await owner.get(`/api/demos/${res.body.demo.demo_id}`).expect(200)).body.demo;
      expect(demo).to.include({ status: 'ready', byte_size: DEMO_BYTES.length, round_count: 1 });

      // An expired replay and a non-Valve download address fail with clear messages.
      const expired = encodeShareCode({ match_id: '99', outcome_id: '1', token: 1 });
      await owner.post(`/api/teams/${teamId}/demos/share-code`).send({ share_code: expired }).expect(202);
      await demoJobs.processNext({ parse: async () => { throw new Error('not reached'); } });
      const failed = await connection('demos').where('valve_match_id', '99').first('status', 'error_code', 'error_message');
      expect(failed).to.include({ status: 'failed', error_code: 'replay_unavailable' });
      config.matchReplayHosts = [/^replay[a-z0-9-]*\.valve\.net$/i];
      const other = encodeShareCode({ match_id: '3230642215713767582', outcome_id: '1', token: 1 });
      config.matchReplayProviderUrl = await listen((req, res) => res.end(JSON.stringify({ replay_url: 'http://evil.example/x.dem' })));
      await owner.post(`/api/teams/${teamId}/demos/share-code`).send({ share_code: other }).expect(202);
      await demoJobs.processNext({ parse: async () => { throw new Error('not reached'); } });
      expect(await connection('demos').where('valve_match_id', '3230642215713767582').first('error_code')).to.include({ error_code: 'replay_provider_error' });
    });
  });

  describe('demo import failures', () => {
    it('re-uploading a failed demo retries it instead of reporting a duplicate', async () => {
      const { owner, teamId } = await teamWithMember();
      const up = () => owner.post(`/api/teams/${teamId}/demos?file_name=hltv.dem`).set('Content-Type', 'application/octet-stream').send(DEMO_BYTES);
      const { demo } = (await up().expect(201)).body;
      await demoJobs.processNext({ parse: async () => { throw new DemoError('parser_incompatible', 'newer build'); } });
      const again = (await up().expect(201)).body;
      expect(again).to.include({ retried: true });
      expect(again.demo).to.include({ demo_id: demo.demo_id, status: 'queued' });
      await demoJobs.processNext({ parse: async () => buildReplay(syntheticDemo()) });
      await up().expect(409);
      const key = (await connection('demos').where('demo_id', demo.demo_id).first('storage_key')).storage_key;
      fs.rmSync(demoJobs.storagePath(key), { force: true });
    });
  });

  describe('utility annotations', () => {
    async function readyDemo() {
      const t = await teamWithMember();
      const { demo } = (await t.owner.post(`/api/teams/${t.teamId}/demos?file_name=u.dem`)
        .set('Content-Type', 'application/octet-stream').send(DEMO_BYTES).expect(201)).body;
      await demoJobs.processNext({ parse: async () => buildReplay(syntheticDemo()) });
      const key = (await connection('demos').where('demo_id', demo.demo_id).first('storage_key')).storage_key;
      return { ...t, demo, key };
    }

    it('saves utility markers with round, position and floor; edits and removes them solo and in a live review', async () => {
      const { owner, member, teamId, demo, key } = await readyDemo();
      try {
        const body = { kind: 'utility', round_number: 1, tick: 150, level: 'main', data: { x: 0.4, y: 0.6, utility: 'smoke' } };
        const { annotation } = (await member.post(`/api/demos/${demo.demo_id}/annotations`).send(body).expect(201)).body;
        expect(annotation).to.deep.include({ kind: 'utility', tick: 150, level: 'main', data: { x: 0.4, y: 0.6, utility: 'smoke' } });
        await member.post(`/api/demos/${demo.demo_id}/annotations`).send({ ...body, data: { x: 0.4, y: 0.6, utility: 'decoy' } }).expect(400);
        const moved = (await member.patch(`/api/demos/${demo.demo_id}/annotations/${annotation.annotation_id}`).send({ x: 0.5, utility: 'flash' }).expect(200)).body.annotation;
        expect(moved.data).to.deep.equal({ x: 0.5, y: 0.6, utility: 'flash' });
        const third = await addMember(owner, teamId, 'Third');
        await third.patch(`/api/demos/${demo.demo_id}/annotations/${annotation.annotation_id}`).send({ x: 0.1 }).expect(403);
        const listed = (await owner.get(`/api/demos/${demo.demo_id}/annotations?round=1`).expect(200)).body.annotations;
        expect(listed.map((a) => a.kind)).to.deep.equal(['utility']);

        // Live: the IGL places, moves and removes; followers see each change.
        const { review } = (await owner.post(`/api/teams/${teamId}/review`).send({ demo_id: demo.demo_id }).expect(201)).body;
        let r = (await owner.post(`/api/reviews/${review.review_id}/annotations`).send({ ...body, data: { x: 0.2, y: 0.2, utility: 'molly' } }).expect(201)).body.review;
        const live = r.annotations[0];
        await member.post(`/api/reviews/${review.review_id}/annotations`).send(body).expect(403);
        await member.patch(`/api/reviews/${review.review_id}/annotations/${live.annotation_id}`).send({ x: 0.3 }).expect(403);
        r = (await owner.patch(`/api/reviews/${review.review_id}/annotations/${live.annotation_id}`).send({ x: 0.3, level: 'main' }).expect(200)).body.review;
        let seen = (await member.get(`/api/teams/${teamId}/review`).expect(200)).body.review;
        expect(seen.version).to.equal(r.version);
        expect(seen.annotations[0].data).to.include({ x: 0.3, utility: 'molly' });
        await owner.delete(`/api/reviews/${review.review_id}/annotations/${live.annotation_id}`).expect(200);
        seen = (await member.get(`/api/teams/${teamId}/review`).expect(200)).body.review;
        expect(seen.annotations).to.deep.equal([]);
      } finally {
        fs.rmSync(demoJobs.storagePath(key), { force: true });
      }
    });
  });
});
