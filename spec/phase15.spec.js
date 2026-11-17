// Phase 15: route-based pickups with one deterministic inventory simulation
// (server and client agree), throw order, the lineup catalogue and picker,
// lineup still timing from per-tick samples, grouped captures (one shared
// clip, own victim clips / lineups per event, media linked per capture),
// and the live review's shared Replay Inspector selection.
const fs = require('fs');
const config = require('../config/env');
const path = require('path');
const { expect } = require('chai');
const { connection, reseed, teamWithMember } = require('./helpers');
const U = require('../domain/utility');
const L = require('../domain/lineups');
const T = require('../services/throwSetup');
const P = require('../services/capturePlan');
const { buildReplay } = require('../services/demoParse');
const demoJobs = require('../services/demoJobs');
const captures = require('../services/captures');

const client = (file) => import(path.join(__dirname, '../client/src/lib', file));
const player = (id, uid, x, y, level = 'main') => ({ id, kind: 'player', x, y, level, user_id: uid, label: '', images: [] });
const util = (id, kind, uid, x, y, extra = {}) => ({ id, kind, x, y, level: 'main', user_id: uid, label: '', images: [], ...extra });
const route = (id, uid, pts, level = 'main') => ({ id, level, user_id: uid, color: '#fff', points: pts.map(([x, y]) => ({ x, y })) });
const drop = (id, uid, kind, x, y, extra = {}) => ({ id, type: 'drop', user_id: uid, kind, x, y, level: 'main', ...extra });
const none = { smoke: 0, flash: 0, molly: 0, he: 0, decoy: 0 };
const buys = (list) => list.map(([uid, c]) => ({ user_id: uid, slot: null, ...none, ...c, kit: false }));

describe('phase 15', () => {
  // These tests describe the Phase 12-15 hybrid schedule at 1x.
  let pinned;
  before(() => { pinned = [config.captureSchedule, config.captureKillTimescale]; config.captureSchedule = 'hybrid'; config.captureKillTimescale = 1; });
  after(() => { [config.captureSchedule, config.captureKillTimescale] = pinned; });
  describe('route pickups', () => {
    // Player 1 stands at (0.5, 0.5) and drops a flash there (lands at 0.4 s).
    const dropBoard = (routes, extra = {}) => ({
      markers: [player('a', 1, 0.5, 0.5), player('b', 2, 0.3, 0.5), player('c', 3, 0.7, 0.5)],
      routes, actions: [drop('d', 1, 'flash', 0.5, 0.5)], ...extra,
    });
    const plan = (phases, loadouts = buys([[1, { flash: 2 }]]), map = 'de_mirage') => U.phasePlan({ loadouts, phases, side: 'T', map });

    it('picks up a drop when a teammate\'s route passes over it after it lands, on the same floor', () => {
      const p = plan([{ board: dropBoard([route('rb', 2, [[0.3, 0.5], [0.7, 0.5]])]) }]);
      expect(p.sims[0].pickups.map((x) => [x.id, x.key])).to.deep.equal([['d', 'u2']]);
      expect(p.final).to.deep.equal([]);
      // The same route on the lower floor (Nuke) leaves it.
      const lower = { markers: [player('a', 1, 0.5, 0.5), player('b', 2, 0.3, 0.5, 'lower')], routes: [route('rb', 2, [[0.3, 0.5], [0.7, 0.5]], 'lower')], actions: [drop('d', 1, 'flash', 0.5, 0.5)] };
      const q = plan([{ board: lower }], undefined, 'de_nuke');
      expect(q.sims[0].pickups).to.deep.equal([]);
      expect(q.final.map((g) => g.id)).to.deep.equal(['d']);
    });

    it('leaves the item when the route crosses before it is dropped, and carries it into later phases', () => {
      // Player 1 runs a long route before dropping, so player 2 passes the spot first.
      const board = {
        markers: [player('a', 1, 0.5, 0.9), player('b', 2, 0.45, 0.5)],
        routes: [route('ra', 1, [[0.5, 0.9], [0.5, 0.5]]), route('rb', 2, [[0.45, 0.5], [0.55, 0.5]])],
        actions: [drop('d', 1, 'flash', 0.5, 0.5)],
      };
      const p = plan([{ board }, { board: { markers: [player('a2', 1, 0.5, 0.5), player('b2', 2, 0.55, 0.5)], routes: [route('rb2', 2, [[0.55, 0.5], [0.45, 0.5]])], actions: [] } }]);
      expect(p.sims[0].pickups).to.deep.equal([]);
      expect(p.grounds[1].map((g) => g.id)).to.deep.equal(['d']);
      // Phase 2: the item lies there from the start, so the route picks it up on the way.
      expect(p.sims[1].pickups.map((x) => [x.id, x.key])).to.deep.equal([['d', 'u2']]);
      expect(p.sims[1].pickups[0].t).to.be.closeTo(((0.05 - 96 / 5120) * 5120) / 230, 1e-3);
      const b = p.players.find((x) => x.key === 'u2');
      expect(b.phases[1]).to.deep.include({ start: { ...none }, picked: { ...none, flash: 1 } });
    });

    it('resolves two players reaching the same drop once, earliest first, ties by player', () => {
      // Equal distance from both sides: a tie at the same moment goes to the lower key.
      const tie = plan([{ board: dropBoard([route('rb', 2, [[0.3, 0.5], [0.7, 0.5]]), route('rc', 3, [[0.7, 0.5], [0.3, 0.5]])]) }]);
      expect(tie.sims[0].pickups.map((x) => x.key)).to.deep.equal(['u2']);
      // Player 3 starting closer gets there first.
      const early = plan([{ board: dropBoard([route('rb', 2, [[0.3, 0.5], [0.7, 0.5]]), route('rc', 3, [[0.6, 0.5], [0.3, 0.5]])],
        { markers: [player('a', 1, 0.5, 0.5), player('b', 2, 0.3, 0.5), player('c', 3, 0.6, 0.5)] }) }]);
      expect(early.sims[0].pickups.map((x) => x.key)).to.deep.equal(['u3']);
      expect(early.players.find((x) => x.key === 'u2').phases[0].picked.flash).to.equal(0);
    });

    it('respects carry limits: a full player passes the item and it stays for later phases', () => {
      const p = plan([{ board: dropBoard([route('rb', 2, [[0.3, 0.5], [0.7, 0.5]])]) }], buys([[1, { flash: 2 }], [2, { flash: 2 }]]));
      expect(p.sims[0].pickups).to.deep.equal([]);
      expect(p.sims[0].blocked.map((x) => x.key)).to.deep.equal(['u2']);
      expect(p.final.map((g) => g.id)).to.deep.equal(['d']);
    });

    it('gives the same inventory for preview, carryover, replay and the client mirror', async () => {
      const c = await client('utility.ts');
      const pb = await client('phasePlayback.ts');
      const phases = [
        { board: dropBoard([route('rb', 2, [[0.3, 0.5], [0.7, 0.5]])], { markers: [player('a', 1, 0.5, 0.5), player('b', 2, 0.3, 0.5), util('s', 'smoke', 1, 0.2, 0.2, { seq: 0 })] }) },
        { board: { markers: [player('b2', 2, 0.7, 0.5), util('f', 'flash', 2, 0.9, 0.1)], routes: [], actions: [] } },
      ];
      const loadouts = buys([[1, { flash: 2, smoke: 1 }]]);
      const server = U.phasePlan({ loadouts, phases, side: 'T', map: 'de_mirage' });
      const mine = c.phasePlan(loadouts, phases, 'T', 'de_mirage');
      for (const p of server.players) {
        const m = mine.players.get(p.key);
        expect({ phases: m.phases, over: m.over }).to.deep.equal({ phases: p.phases, over: p.over });
      }
      expect(JSON.stringify(mine.sims[0].pickups)).to.equal(JSON.stringify(server.sims[0].pickups));
      // The preview's last frame matches what phase 2 starts with.
      const start = new Map([...mine.players.values()].map((p) => [p.key, { ...p.phases[0].start }]));
      const end = pb.frameAt(phases[0].board, mine.sims[0], mine.sims[0].duration, start, [], c.moveAt);
      for (const p of mine.players.values()) expect(end.inventory.get(p.key) ?? { ...none }).to.deep.equal(p.phases[1].start);
      // The picked-up drop is gone from the map at the end; the saved board still has it.
      expect(end.ground).to.deep.equal([]);
      expect(phases[0].board.actions).to.have.length(1);
      // Replaying gives the same result.
      expect(JSON.stringify(c.phasePlan(loadouts, phases, 'T', 'de_mirage').sims[0].steps)).to.equal(JSON.stringify(mine.sims[0].steps));
    });

    it('runs throws in each player\'s set order, 0.5 s apart, and keeps the marker and path when reordered', () => {
      const board = {
        markers: [player('a', 1, 0.5, 0.5), util('x', 'smoke', 1, 0.2, 0.2, { seq: 1, path: [{ x: 0.3, y: 0.3 }] }), util('y', 'flash', 1, 0.8, 0.2, { seq: 0 })],
        routes: [], actions: [],
      };
      const sim = U.simulatePhase({ board, map: 'de_mirage', start: new Map([['u1', { ...none, smoke: 1, flash: 1 }]]) });
      expect(sim.steps.map((s) => s.id)).to.deep.equal(['y', 'x']);
      expect(sim.steps[1].start).to.be.closeTo(sim.steps[0].end + U.GAP_S, 1e-9);
      // Reordering changes seq only: owner and throw path stay with the marker.
      const swapped = { ...board, markers: board.markers.map((m) => (m.id === 'x' ? { ...m, seq: 0 } : m.id === 'y' ? { ...m, seq: 1 } : m)) };
      const again = U.simulatePhase({ board: swapped, map: 'de_mirage', start: new Map([['u1', { ...none, smoke: 1, flash: 1 }]]) });
      expect(again.steps.map((s) => s.id)).to.deep.equal(['x', 'y']);
      expect(again.steps[0].path).to.deep.include({ x: 0.3, y: 0.3 });
    });
  });

  describe('lineup catalogue and picker', () => {
    it('serves attributed CSNADES entries per map and finds origins near a landing point by side and floor', async () => {
      const { owner } = await teamWithMember();
      const res = (await owner.get('/api/lineups?map=de_ancient').expect(200)).body;
      expect(res.source).to.equal('CSNADES.gg');
      expect(res.lineups.every((e) => e.url.startsWith('https://csnades.gg/ancient/'))).to.equal(true);
      await owner.get('/api/lineups?map=nowhere').expect(400);
      expect((await owner.get('/api/lineups?map=de_dust2').expect(200)).body.lineups).to.deep.equal([]);
      const topMid = { x: 0.47, y: 0.39 };
      expect(L.near(topMid, { map: 'de_ancient', utility: 'smoke', side: 'T', level: 'main' }).map((e) => e.id)).to.include('ancient-t-smoke-top-mid-t-spawn');
      expect(L.near(topMid, { map: 'de_ancient', utility: 'smoke', side: 'CT', level: 'main' })).to.deep.equal([]);
      expect(L.near(topMid, { map: 'de_ancient', utility: 'flash', side: 'T', level: 'main' })).to.deep.equal([]);
    });

    it('places the player at the start and keeps a running throw\'s release separate (client picker)', async () => {
      const { applyLineup, nearLineups } = await client('lineups.ts');
      const entries = L.list({ map: 'de_ancient' });
      let n = 0;
      const id = (p) => `${p}${(n += 1)}`;
      const board = { markers: [player('a', 7, 0.1, 0.1)], routes: [route('old', 7, [[0.1, 0.1], [0.2, 0.2]])], actions: [] };
      const stand = nearLineups(entries, { x: 0.476, y: 0.383 }, { utility: 'smoke', side: 'T', level: 'main' })[0];
      expect(stand.moving).to.equal(false);
      const a = applyLineup(board, stand, { user_id: 7, slot: null }, 'Ana', id, 0);
      expect(a.board.markers.find((m) => m.id === 'a')).to.include({ x: stand.start.x, y: stand.start.y });
      const thrown = a.board.markers.find((m) => m.kind === 'smoke');
      expect(thrown).to.deep.include({ x: stand.landing.x, y: stand.landing.y, user_id: 7, seq: 0 });
      expect(thrown.lineup).to.deep.include({ id: stand.id, url: stand.url, source: 'CSNADES.gg' });
      expect(a.changes[0]).to.match(/Moves Ana's marker/);
      expect(a.conflicts[0]).to.match(/existing route starts/);
      const run = entries.find((e) => e.technique === 'run-jump');
      const b = applyLineup(board, run, { user_id: 7, slot: null }, 'Ana', id, 0);
      const r = b.board.routes.filter((x) => x.user_id === 7);
      expect(r).to.have.length(1);
      expect(r[0].points).to.deep.equal([run.start, run.release]);
      expect(b.conflicts[0]).to.match(/will be replaced by the run-up/);
      expect(JSON.stringify(board)).to.include('"old"'); // the input board is untouched
    });

    beforeEach(reseed);

    it('saves, reopens, shares and imports the lineup reference; rejects other sites', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const ref = { id: 'ancient-t-smoke-top-mid-t-spawn', title: 'Top Mid from T Spawn', url: 'https://csnades.gg/ancient/smokes/top-mid-from-t-spawn', source: 'CSNADES.gg', technique: 'jump' };
      const doc = {
        tactic_name: 'Lineup plan', map: 'de_ancient', side: 'T', economy: 'Fullbuy', grenade: 0, molly: 0, flash: 0, smoke: 0,
        loadouts: buys([[owner.user.user_id, { smoke: 1 }]]),
        phases: [{ name: 'Mid', notes: '', board: { markers: [player('p', owner.user.user_id, 0.51, 0.87), util('s', 'smoke', owner.user.user_id, 0.48, 0.38, { lineup: ref })], routes: [], holds: [], actions: [] }, assignments: [] }],
      };
      const bad = JSON.parse(JSON.stringify(doc));
      bad.phases[0].board.markers[1].lineup.url = 'https://example.com/x';
      await owner.post(`/api/teams/${teamId}/tactics`).send(bad).expect(400);
      const { tactic } = (await owner.post(`/api/teams/${teamId}/tactics`).send(doc).expect(201)).body;
      const open = (await member.get(`/api/tactics/${tactic.tactic_id}/document`).expect(200)).body.tactic;
      expect(open.phases[0].board.markers.find((m) => m.id === 's').lineup).to.deep.equal(ref);
      const { tactic: listing } = (await owner.post(`/api/tactics/${tactic.tactic_id}/share`).send({}).expect(200)).body;
      expect(listing.phases[0].board.markers.find((m) => m.id === 's').lineup).to.deep.equal(ref);
      const other = await teamWithMember();
      const { tactic_id: imported } = (await other.owner.post(`/api/shared-tactics/${listing.share_id}/import`).send({ team_id: other.teamId }).expect(201)).body;
      const copy = (await other.owner.get(`/api/tactics/${imported}/document`).expect(200)).body.tactic;
      expect(copy.phases[0].board.markers.find((m) => m.id === 's').lineup).to.deep.equal(ref);
    });
  });

  describe('lineup still timing', () => {
    // A throw released at tick 1000 with the given movement leading into it.
    const samples = (fn) => Array.from({ length: 260 }, (_, i) => ({ tick: 760 + i, x: 0, y: 0, z: 0, ...fn(760 + i) }));
    it('uses the tick before release for a standing throw', () => {
      const r = T.analyse(samples(() => ({ vx: 0, vy: 0, vz: 0, buttons: 0 })), 1000);
      expect(r).to.include({ technique: 'stationary', still_tick: 999, reliable: true });
    });
    it('steps back past a jump to the still aim before it', () => {
      const r = T.analyse(samples((t) => (t >= 990 ? { vx: 0, vy: 0, vz: 250, buttons: t === 990 ? 2 : 0 } : { vx: 0, vy: 0, vz: 0, buttons: 0 })), 1000);
      expect(r).to.include({ technique: 'jump', setup_start: 990, still_tick: 989, reliable: true });
    });
    it('steps back past a run-up (running and run-jump throws)', () => {
      const run = T.analyse(samples((t) => (t >= 960 ? { vx: 220, vy: 0, vz: 0, buttons: 8 } : { vx: 0, vy: 0, vz: 0, buttons: 0 })), 1000);
      expect(run).to.include({ technique: 'run', setup_start: 960, still_tick: 959, reliable: true });
      const rj = T.analyse(samples((t) => (t >= 950 ? { vx: 230, vy: 0, vz: t >= 990 ? 250 : 0, buttons: t >= 990 ? 10 : 8 } : { vx: 0, vy: 0, vz: 0, buttons: 0 })), 1000);
      expect(rj).to.include({ technique: 'run-jump', setup_start: 950, still_tick: 949, reliable: true });
    });
    it('keeps the tick before release and says so when there is no still moment', () => {
      const r = T.analyse(samples(() => ({ vx: 230, vy: 0, vz: 0, buttons: 8 })), 1000);
      expect(r).to.include({ still_tick: 999, reliable: false, reason: 'moving_before_throw' });
      expect(T.describe(r)).to.match(/No still aiming moment/);
      expect(T.analyse([], 1000)).to.include({ still_tick: 999, reliable: false, reason: 'no_samples' });
    });
  });

  describe('grouped capture planning', () => {
    const players = [{ index: 0, name: 'A' }, { index: 1, name: 'B' }, { index: 2, name: 'C' }, { index: 3, name: 'D' }];
    const round = { start_tick: 0, end_tick: 5000 };
    const kill = (id, i, tick, extra = {}) => ({ capture_id: id, kind: 'kill', round_number: 1, event_index: i, round, ev: { type: 'kill', tick, attacker: 0, victim: i % 3 + 1, ...extra }, dir: `/c${id}` });
    const nade = (id, i, tick, setup) => ({ capture_id: id, kind: 'utility', round_number: 1, event_index: i, round, ev: { type: 'smoke', tick: tick + 300, throw_tick: tick, player: 0 }, dir: `/c${id}`, setup });
    const plan = (items, opts) => P.planWindows({ tickrate: 64, meta: { players } }, items, opts);

    it('shares one killer clip for nearby kills by one killer, keeping each victim clip', () => {
      const p = plan([kill(1, 1, 1000), kill(2, 2, 1100), kill(3, 3, 1250), kill(4, 4, 1700)]);
      const killers = p.windows.filter((w) => w.role === 'killer_clip');
      expect(killers.map((w) => [w.capture_id, w.start, w.end, (w.copies || []).map((c) => c.capture_id)])).to.deep.equal([[1, 936, 1314, [2, 3]], [4, 1636, 1764, []]]);
      expect(killers[0].group.members.map((m) => [m.capture_id, m.event_index, m.event_tick])).to.deep.equal([[1, 1, 1000], [2, 2, 1100], [3, 3, 1250]]);
      expect(killers[0].copies.map((c) => c.file)).to.deep.equal(['/c2/killer.webm', '/c3/killer.webm']);
      expect(p.windows.filter((w) => w.role === 'victim_clip')).to.have.length(4);
      // Different capture settings (X-ray) never share a pass.
      const x = plan([kill(1, 1, 1000), kill(2, 2, 1100, { through_smoke: true })]);
      expect(x.windows.filter((w) => w.role === 'killer_clip').map((w) => w.copies.length)).to.deep.equal([0, 0]);
      // The whole group stays within the span.
      const long = plan([0, 1, 2, 3, 4].map((k) => kill(k + 1, k + 1, 1000 + k * 150)));
      expect(long.windows.filter((w) => w.role === 'killer_clip').map((w) => w.group && w.group.members.length)).to.deep.equal([4, null]);
      expect(P.GROUP_GAP_S).to.equal(3);
    });

    it('shares one throw clip for nearby throws, with a lineup per throw on its setup tick', () => {
      const setup = { still_tick: 980, technique: 'jump', reliable: true };
      const p = plan([nade(1, 1, 1000, setup), nade(2, 2, 1120, null)]);
      const replay = p.windows.filter((w) => w.role === 'replay');
      expect(replay.map((w) => [w.start, w.end, w.copies.map((c) => c.capture_id)])).to.deep.equal([[936, 1184, [2]]]);
      expect(p.lineups.map((l) => [l.capture_id, l.tick, l.release_tick])).to.deep.equal([[1, 980, 1000], [2, 1119, 1120]]);
      const steps = P.schedule(p, 'hybrid');
      expect(steps.map((s) => s.op)).to.deep.equal(['lineup', 'lineup', 'segment']);
    });
  });

  describe('grouped capture session and shared inspector selection', () => {
    const DEMO_BYTES = Buffer.concat([Buffer.from('PBDEMS2\0', 'latin1'), Buffer.alloc(64, 12)]);
    const steam = (n) => `7656119000000000${n}`;
    // Round 1: alpha throws a smoke (300) and a flash (380), then kills bravo
    // (500) and charlie (560).
    function demo() {
      const events = [
        { event_name: 'round_start', tick: 100 },
        { event_name: 'round_freeze_end', tick: 164 },
        { event_name: 'smokegrenade_detonate', tick: 400, entityid: 7, user_steamid: steam(1), x: -1000, y: 0, z: 0 },
        { event_name: 'flashbang_detonate', tick: 420, entityid: 8, user_steamid: steam(1), x: -900, y: 0, z: 0 },
        { event_name: 'player_death', tick: 500, user_steamid: steam(2), attacker_steamid: steam(1), weapon: 'ak47', headshot: true, penetrated: 0, user_X: 0, user_Y: 0, user_Z: 0 },
        { event_name: 'player_death', tick: 560, user_steamid: steam(3), attacker_steamid: steam(1), weapon: 'ak47', headshot: false, penetrated: 0, user_X: 0, user_Y: 0, user_Z: 0 },
        { event_name: 'round_end', tick: 900, winner: 'T', reason: 't_killed', total_rounds_played: 1 },
      ];
      const ticks = [];
      for (let t = 96; t <= 1100; t += 8) {
        ticks.push({ tick: t, steamid: steam(1), name: 'alpha', X: -1000, Y: 0, Z: 0, yaw: 0, is_alive: true, health: 100, team_num: 2 });
        ticks.push({ tick: t, steamid: steam(2), name: 'bravo', X: 0, Y: 0, Z: 0, yaw: 90, is_alive: t < 500, health: t < 500 ? 100 : 0, team_num: 3 });
        ticks.push({ tick: t, steamid: steam(3), name: 'charlie', X: 0, Y: 50, Z: 0, yaw: 90, is_alive: t < 560, health: t < 560 ? 100 : 0, team_num: 3 });
      }
      const flights = [
        { entity: 7, type: 'smoke', steamid: steam(1), ticks: [300, 304, 400], x: [-1500, -1300, -1000], y: [0, 0, 0], z: [0, 0, 0] },
        { entity: 8, type: 'flash', steamid: steam(1), ticks: [380, 384, 420], x: [-1500, -1300, -900], y: [0, 0, 0], z: [0, 0, 0] },
      ];
      return buildReplay({ header: { map_name: 'de_mirage' }, events, ticks, flights });
    }
    const replay = demo();
    let uploaded = [];
    beforeEach(reseed);
    afterEach(() => {
      captures._test.setEnabled(false);
      captures._test.setDriver(null);
      uploaded.forEach((k) => fs.rmSync(demoJobs.storagePath(k), { force: true }));
      uploaded = [];
    });
    async function uploadParsed(owner, teamId) {
      const { demo: d } = (await owner.post(`/api/teams/${teamId}/demos?file_name=m.dem`).set('Content-Type', 'application/octet-stream').send(DEMO_BYTES).expect(201)).body;
      const row = await connection('demos').where('demo_id', d.demo_id).first();
      uploaded.push(row.storage_key);
      expect(await demoJobs.processNext({ parse: async () => replay })).to.include({ status: 'ready' });
      return row;
    }
    const events = replay.rounds[0].data.events;
    const idx = (type, tick) => events.findIndex((e) => e.type === type && (tick == null || e.tick === tick));

    it('records a group once and links the clip into every member capture, with setup-timed lineups', async () => {
      const calls = [];
      const write = (f) => { fs.writeFileSync(f, `clip ${f}`); return f; };
      captures._test.setEnabled(true);
      captures._test.setDriver({
        check: async () => ({ cs2_installed: true, runtime: true, uinput: true, encoder: true, cs2_running: false, cs2_usable: false }),
        inputs: async (file, ranges) => Object.fromEntries(ranges.map((r) => [r.key, { start: r.start, bits: [] }])),
        // Standing still until 290, then a jump into the 300 release.
        throws: async (file, list) => Object.fromEntries(list.map((t) => [t.key, Array.from({ length: t.lookback + 1 }, (_, i) => {
          const tick = t.tick - t.lookback + i;
          return { tick, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: tick >= t.tick - 10 ? 250 : 0, buttons: tick === t.tick - 10 ? 2 : 0 };
        })])),
        open: () => ({
          async call(req) {
            calls.push(req);
            if (req.op === 'open') return { ok: true, timings: {} };
            if (req.op === 'load') return { ok: true, timings: {} };
            if (req.op === 'segment') {
              const outputs = req.outputs.map((o) => ({ file: write(o.file), start: o.start, end: o.end, player: req.player, fps: 30, frames: 60, width: 1280, height: 720 }));
              return { ok: true, outputs, encoded: outputs.map((o) => o.file), encode_failed: [], timings: {} };
            }
            if (req.op === 'lineup') return { ok: true, still: { file: write(req.file), tick: req.tick, player: req.player }, encoded: [], timings: {} };
            return { ok: true, encoded: [], encode_failed: [], timings: {} };
          },
          async close() { return { closed: true, timings: {} }; },
        }),
      });
      const { owner, teamId } = await teamWithMember();
      const d = await uploadParsed(owner, teamId);
      await owner.post(`/api/demos/${d.demo_id}/captures/batch`).send({ selection: 'all', round_number: 1 }).expect(202);
      expect(await captures._test.runOnce()).to.equal(true);
      const rows = await connection('demo_captures').where('demo_id', d.demo_id).orderBy('moment_tick');
      expect(rows.map((r) => r.status)).to.deep.equal(['ready', 'ready', 'ready', 'ready']);
      // One killer segment for both kills, one throw segment for both throws.
      const segs = calls.filter((c) => c.op === 'segment');
      expect(segs.filter((s) => s.outputs.some((o) => o.file.endsWith('killer.webm')))).to.have.length(1);
      const throwSeg = segs.find((s) => s.outputs.some((o) => o.file.endsWith('replay.webm')));
      expect(throwSeg.outputs.filter((o) => o.file.endsWith('replay.webm'))).to.have.length(1);
      // Lineups on the still aim before the jump (tick 289 for the 300 release).
      const lineups = calls.filter((c) => c.op === 'lineup').map((c) => c.tick);
      expect(lineups).to.deep.equal([289, 369]);
      // Every kill capture has its own killer media (same clip, own file) and group info.
      const kills = rows.filter((r) => r.kind === 'kill');
      const killerFiles = kills.map((r) => r.media.find((m) => m.role === 'killer_clip'));
      expect(killerFiles.every((m) => m.group && m.group.members.length === 2)).to.equal(true);
      expect(killerFiles.map((m) => m.event_tick)).to.deep.equal([500, 560]);
      const paths = await Promise.all(kills.map((r) => captures.mediaFile(d.demo_id, owner.user.user_id, r.capture_id, 'killer.webm')));
      expect(paths[0]).to.not.equal(paths[1]);
      expect(fs.readFileSync(paths[0], 'utf8')).to.equal(fs.readFileSync(paths[1], 'utf8'));
      expect(kills.map((r) => r.media.some((m) => m.role === 'victim_clip'))).to.deep.equal([true, true]);
      const lineupMedia = rows.find((r) => r.kind === 'utility').media.find((m) => m.role === 'lineup');
      expect(lineupMedia).to.deep.include({ tick: 289, release_tick: 300 });
      expect(lineupMedia.setup).to.include({ technique: 'jump', reliable: true });
    });

    it('shares the host\'s inspector selection and tab with followers and late joiners, without moving playback', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const d = await uploadParsed(owner, teamId);
      const { review } = (await owner.post(`/api/teams/${teamId}/review`).send({ demo_id: d.demo_id }).expect(201)).body;
      const cmd = (who, body, version) => who.post(`/api/reviews/${review.review_id}/command`).send({ ...body, expected_version: version });
      const k1 = idx('kill', 500);
      const k2 = idx('kill', 560);
      // The host's seek carries the selection.
      let r = (await cmd(owner, { action: 'seek', tick: 500, inspect: { round_number: 1, event_index: k1, kind: 'kill' } }, review.version).expect(200)).body.review;
      expect(r.inspect).to.deep.equal({ round_number: 1, event_index: k1, kind: 'kill' });
      const anchor = r.anchor_tick;
      // A tab change alone leaves playback where it was.
      r = (await cmd(owner, { action: 'inspect', inspect: { round_number: 1, event_index: k1, kind: 'kill', victim: k2 } }, r.version).expect(200)).body.review;
      expect(r.anchor_tick).to.equal(anchor);
      // A teammate joining now gets the same selection and tab.
      const joined = (await member.get(`/api/teams/${teamId}/review`).expect(200)).body.review;
      expect(joined.inspect).to.deep.equal({ round_number: 1, event_index: k1, kind: 'kill', victim: k2 });
      // Followers can't change it; bad events are refused; null clears.
      await cmd(member, { action: 'inspect', inspect: null }, r.version).expect(403);
      await cmd(owner, { action: 'inspect', inspect: { round_number: 1, event_index: idx('smoke'), kind: 'kill' } }, r.version).expect(400);
      await cmd(owner, { action: 'inspect', inspect: { round_number: 1, event_index: 9999, kind: 'kill' } }, r.version).expect(400);
      r = (await cmd(owner, { action: 'inspect', inspect: null }, r.version).expect(200)).body.review;
      expect(r.inspect).to.equal(null);
    });
  });
});
