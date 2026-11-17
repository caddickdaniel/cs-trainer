// Phase 12: capture sessions. Upload capture options queue a batch after the
// demo parses; a session drives one CS2 (here a stand-in that speaks the
// capture tool's protocol) in tick order, keeps going past one failed event,
// stops on fatal errors, always closes, and keeps old media until a
// replacement succeeds. Watch this round, the user's current session, and
// the job details (2 s windows clamped to the round, X-ray for flash/smoke).
const fs = require('fs');
const path = require('path');
const { expect } = require('chai');
const { connection, reseed, teamWithMember } = require('./helpers');
const { buildReplay } = require('../services/demoParse');
const demoJobs = require('../services/demoJobs');
const captures = require('../services/captures');
const config = require('../config/env');

const DEMO_BYTES = Buffer.concat([Buffer.from('PBDEMS2\0', 'latin1'), Buffer.alloc(64, 12)]);
const steam = (n) => `7656119000000000${n}`;

// Round 1 (ticks 100–900): alpha (T) throws a smoke released at 300, then
// kills bravo (CT) through it at 500.
function demo() {
  const events = [
    { event_name: 'round_start', tick: 100 },
    { event_name: 'round_freeze_end', tick: 164 },
    { event_name: 'smokegrenade_detonate', tick: 400, entityid: 7, user_steamid: steam(1), x: -1000, y: 0, z: 0 },
    { event_name: 'player_death', tick: 500, user_steamid: steam(2), attacker_steamid: steam(1), weapon: 'ak47', headshot: true, penetrated: 0, thrusmoke: true, user_X: 0, user_Y: 0, user_Z: 0 },
    { event_name: 'round_end', tick: 900, winner: 'T', reason: 't_killed', total_rounds_played: 1 },
  ];
  const ticks = [];
  for (let t = 96; t <= 1100; t += 8) {
    ticks.push({ tick: t, steamid: steam(1), name: 'alpha', X: -1000, Y: 0, Z: 0, yaw: 0, is_alive: true, health: 100, team_num: 2 });
    ticks.push({ tick: t, steamid: steam(2), name: 'bravo', X: 0, Y: 0, Z: 0, yaw: 90, is_alive: t < 500, health: t < 500 ? 100 : 0, team_num: 3 });
  }
  const flights = [{ entity: 7, type: 'smoke', steamid: steam(1), ticks: [300, 304, 400], x: [-1500, -1300, -1000], y: [0, 0, 0], z: [0, 0, 0] }];
  return buildReplay({ header: { map_name: 'de_mirage' }, events, ticks, flights });
}

// Stand-in for `capture.py session`: records every call and writes
// placeholder bytes where the real tool writes what CS2 rendered.
function fakeTool({ fail = {}, open = { ok: true, pid: 4242, launched: true, focus: 'click', size: [1280, 720], timings: { menu: 1 } } } = {}) {
  const calls = [];
  let closed = 0;
  const write = (f) => { fs.writeFileSync(f, 'fixture'); return f; };
  return {
    calls,
    closed: () => closed,
    check: async () => ({ cs2_installed: true, runtime: true, uinput: true, encoder: true, cs2_running: false, cs2_usable: false }),
    inputs: async (file, ranges) => Object.fromEntries(ranges.map((r) => [r.key, { start: r.start, bits: Array.from({ length: r.end - r.start + 1 }, (_, i) => (i < 10 ? 8 | 65536 : 1)) }])),
    open: () => ({
      async call(req) {
        calls.push(req);
        if (req.op === 'open') return { id: 1, ...open };
        if (fail[req.op]) return { ok: false, ...fail[req.op] };
        if (req.op === 'load') return { ok: true, loaded: true, timings: { demo_load: 2 } };
        if (req.op === 'watch') return { ok: true, demo: req.demo, tick: req.tick, timings: { seek: 1 } };
        // Phase 14 protocol: recording segments cut into clips, lineup stills, flush.
        const kindOf = (r) => (r.op === 'lineup' || (r.outputs || []).some((o) => o.file.endsWith('replay.webm')) ? 'utility' : 'kill');
        if ((req.op === 'segment' || req.op === 'lineup') && fail[kindOf(req)]) return { ok: false, ...fail[kindOf(req)] };
        if (req.op === 'segment') {
          const outputs = req.outputs.map((o) => ({ file: write(o.file), start: o.start, end: o.end, player: req.player, fps: 30, xray: req.xray, width: 1280, height: 720 }));
          return { ok: true, outputs, encoded: outputs.map((o) => o.file), encode_failed: [], timings: { record: 4, wall: 5 } };
        }
        if (req.op === 'lineup') return { ok: true, still: { file: write(req.file), tick: req.tick, player: req.player, width: 1280, height: 720 }, encoded: [], timings: { wall: 2 } };
        if (req.op === 'flush') return { ok: true, encoded: [], encode_failed: [], timings: {} };
        return { ok: false, code: 'bad_job', error: 'unknown' };
      },
      async close() { closed += 1; return { closed: true, timings: { close: 1 } }; },
    }),
  };
}

describe('phase 12', () => {
  // These tests describe the Phase 12-15 hybrid schedule at 1x.
  let pinned;
  before(() => { pinned = [config.captureSchedule, config.captureKillTimescale]; config.captureSchedule = 'hybrid'; config.captureKillTimescale = 1; });
  after(() => { [config.captureSchedule, config.captureKillTimescale] = pinned; });
  const replay = demo();
  const round = replay.rounds[0].data;
  const kill = round.events.findIndex((e) => e.type === 'kill');
  const smoke = round.events.findIndex((e) => e.type === 'smoke');
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

  describe('upload capture options', () => {
    it('imports normally with no option, and validates the option', async () => {
      const { owner, teamId } = await teamWithMember();
      await owner.post(`/api/teams/${teamId}/demos?file_name=m.dem&capture=video`)
        .set('Content-Type', 'application/octet-stream').send(DEMO_BYTES).expect(400);
      const d = await uploadParsed(owner, teamId, null);
      expect(await connection('capture_sessions').where('demo_id', d.demo_id)).to.have.length(0);
    });

    it('queues the matching recorded events in tick order once the uploader picks players', async () => {
      captures._test.setEnabled(true);
      const { owner, member, teamId } = await teamWithMember();
      const d = await uploadParsed(owner, teamId, 'all');
      // Phase 13: the option waits for the player choice after parsing.
      expect(await connection('capture_sessions').where('demo_id', d.demo_id)).to.have.length(0);
      await owner.post(`/api/demos/${d.demo_id}/captures/batch`).send({ selection: 'all', player: null, pending: true }).expect(202);
      const [s] = await connection('capture_sessions').where('demo_id', d.demo_id);
      expect(s).to.include({ mode: 'batch', selection: 'all', status: 'queued', total: 2, requested_by: d.uploaded_by });
      const rows = await connection('demo_captures').where('session_id', s.session_id).orderBy('moment_tick');
      expect(rows.map((r) => [r.kind, r.moment_tick])).to.deep.equal([['utility', 300], ['kill', 500]]);
      expect((await connection('demos').where('demo_id', d.demo_id).first()).capture_selection).to.equal(null);
      // The uploader follows it; another member doesn't get their overlay.
      const mine = (await owner.get('/api/capture-sessions/current').expect(200)).body;
      expect(mine.session).to.include({ session_id: s.session_id, status: 'queued', total: 2 });
      expect(mine.items).to.have.length(2);
      expect((await member.get('/api/capture-sessions/current').expect(200)).body.session).to.equal(null);
    });

    it('queues only kills or only utility for those options', async () => {
      captures._test.setEnabled(true);
      const a = await teamWithMember();
      const k = await uploadParsed(a.owner, a.teamId, 'kill');
      await a.owner.post(`/api/demos/${k.demo_id}/captures/batch`).send({ selection: 'kill', pending: true }).expect(202);
      expect((await connection('demo_captures').where('demo_id', k.demo_id)).map((r) => r.kind)).to.deep.equal(['kill']);
      const b = await teamWithMember();
      const u = await uploadParsed(b.owner, b.teamId, 'utility');
      await b.owner.post(`/api/demos/${u.demo_id}/captures/batch`).send({ selection: 'utility', pending: true }).expect(202);
      expect((await connection('demo_captures').where('demo_id', u.demo_id)).map((r) => r.kind)).to.deep.equal(['utility']);
    });

    it('refuses to queue with the reason when capture is off', async () => {
      const { owner, teamId } = await teamWithMember();
      const d = await uploadParsed(owner, teamId, 'kill');
      const res = await owner.post(`/api/demos/${d.demo_id}/captures/batch`).send({ selection: 'kill', pending: true }).expect(503);
      expect(res.body.code).to.equal('capture_unavailable');
      expect(await connection('demo_captures').where('demo_id', d.demo_id)).to.have.length(0);
    });
  });

  describe('sessions', () => {
    async function batch(selection = 'all') {
      captures._test.setEnabled(true);
      const t = await teamWithMember();
      const d = await uploadParsed(t.owner, t.teamId, selection);
      await t.owner.post(`/api/demos/${d.demo_id}/captures/batch`).send({ selection, pending: true }).expect(202);
      const s = await connection('capture_sessions').where('demo_id', d.demo_id).first();
      return { ...t, d, s };
    }

    it('runs a batch on one CS2: open, load once, events in tick order, close', async () => {
      const tool = fakeTool();
      captures._test.setDriver(tool);
      const { owner, d, s } = await batch();
      expect(await captures._test.runOnce()).to.equal(true);
      // Hybrid schedule: the lineup, then the smoke clip, then killer and victim views.
      expect(tool.calls.map((c) => c.op)).to.deep.equal(['open', 'load', 'lineup', 'segment', 'segment', 'segment', 'flush']);
      expect(tool.closed()).to.equal(1);
      expect(tool.calls[1].demo).to.equal(path.join(config.demoStorageDir, d.storage_key));
      const done = await connection('capture_sessions').where('session_id', s.session_id).first();
      expect(done).to.include({ status: 'done', completed: 2, failed: 0 });
      expect(done.timings.open).to.deep.equal({ menu: 1 });

      const list = (await owner.get(`/api/demos/${d.demo_id}/captures`).expect(200)).body;
      const k = list.captures.find((c) => c.kind === 'kill');
      expect(k.status).to.equal('ready');
      // Phase 14: killer and victim clips only (no point-of-kill stills).
      expect(k.media.map((m) => [m.role, m.type])).to.deep.equal([['killer_clip', 'video'], ['victim_clip', 'video']]);
      // Through-smoke kill: X-ray on, and the media says so.
      expect(k.media.every((m) => m.xray === true)).to.equal(true);
      // One second either side of the kill.
      expect(k.media.map((m) => [m.start, m.end])).to.deep.equal([[436, 564], [436, 564]]);
      await owner.get(k.media[0].url).expect(200);
      const u = list.captures.find((c) => c.kind === 'utility');
      const clip = u.media.find((m) => m.role === 'replay');
      expect(clip.inputs.start).to.equal(clip.start);
      expect(clip.inputs.map).to.include({ W: 3, Shift: 16, LMB: 0 });
      expect(u.media.find((m) => m.role === 'lineup').tick).to.equal(299);
    });

    it('keeps going past a failed event and reports both', async () => {
      const tool = fakeTool({ fail: { utility: { code: 'seek', error: 'CS2 did not confirm the seek.' } } });
      captures._test.setDriver(tool);
      const { s } = await batch();
      await captures._test.runOnce();
      const done = await connection('capture_sessions').where('session_id', s.session_id).first();
      expect(done).to.include({ status: 'done', completed: 1, failed: 1 });
      const rows = await connection('demo_captures').where('session_id', s.session_id).orderBy('moment_tick');
      expect(rows.map((r) => [r.kind, r.status, r.error_code])).to.deep.equal([['utility', 'failed', 'seek'], ['kill', 'ready', null]]);
      expect(tool.closed()).to.equal(1);
    });

    it('stops on a fatal error, marks the rest as not captured, and still closes CS2', async () => {
      const tool = fakeTool({ fail: { utility: { code: 'cs2_closed', error: 'CS2 closed or crashed during capture.' } } });
      captures._test.setDriver(tool);
      const { s } = await batch();
      await captures._test.runOnce();
      expect(tool.calls.map((c) => c.op)).to.deep.equal(['open', 'load', 'lineup']);
      const done = await connection('capture_sessions').where('session_id', s.session_id).first();
      expect(done).to.include({ status: 'failed', error_code: 'cs2_closed', completed: 0, failed: 2 });
      const rows = await connection('demo_captures').where('session_id', s.session_id);
      expect(rows.every((r) => r.status === 'failed')).to.equal(true);
      expect(tool.closed()).to.equal(1);
    });

    it('fails every event when CS2 can\'t be started, and closes', async () => {
      const tool = fakeTool({ open: { ok: false, code: 'focus', error: 'CS2 could not be given keyboard focus.' } });
      captures._test.setDriver(tool);
      const { s } = await batch();
      await captures._test.runOnce();
      const done = await connection('capture_sessions').where('session_id', s.session_id).first();
      expect(done).to.include({ status: 'failed', error_code: 'focus', failed: 2 });
      expect(tool.closed()).to.equal(1);
    });

    it('recaptures one event and keeps the old media until the new capture succeeds', async () => {
      captures._test.setDriver(fakeTool());
      const { owner, d } = await batch('kill');
      await captures._test.runOnce();
      const url = `/api/demos/${d.demo_id}/captures`;
      const before = (await owner.get(url).expect(200)).body.captures[0];

      captures._test.setDriver(fakeTool({ fail: { kill: { code: 'seek', error: 'nope' } } }));
      const req = (await owner.post(url).send({ kind: 'kill', round_number: 1, event_index: kill, retry: true }).expect(202)).body;
      expect(req.session).to.include({ mode: 'single', total: 1 });
      const pending = (await owner.get(url).expect(200)).body.captures[0];
      expect(pending.status).to.equal('queued');
      expect(pending.media.map((m) => m.file)).to.deep.equal(before.media.map((m) => m.file));
      await owner.get(pending.media[0].url).expect(200);
      await captures._test.runOnce();
      const failed = (await owner.get(url).expect(200)).body.captures[0];
      expect(failed.status).to.equal('failed');
      await owner.get(failed.media[0].url).expect(200);

      captures._test.setDriver(fakeTool());
      await owner.post(url).send({ kind: 'kill', round_number: 1, event_index: kill, retry: true }).expect(202);
      await captures._test.runOnce();
      const after = (await owner.get(url).expect(200)).body.captures[0];
      expect(after.status).to.equal('ready');
      expect(after.media[0].attempt).to.be.greaterThan(before.media[0].attempt);
      await owner.get(after.media[0].url).expect(200);
    });

    it('opens a round to watch and leaves CS2 to the user', async () => {
      const tool = fakeTool();
      captures._test.setEnabled(true);
      captures._test.setDriver(tool);
      const { owner, member, teamId } = await teamWithMember();
      const d = await uploadParsed(owner, teamId, null);
      await member.post(`/api/demos/${d.demo_id}/watch`).send({ round_number: 7 }).expect(404);
      await member.post(`/api/demos/${d.demo_id}/watch`).send({ round_number: 1, extra: 1 }).expect(400);
      const other = await teamWithMember();
      await other.member.post(`/api/demos/${d.demo_id}/watch`).send({ round_number: 1 }).expect(404);
      const res = (await member.post(`/api/demos/${d.demo_id}/watch`).send({ round_number: 1 }).expect(202)).body;
      expect(res.session).to.include({ mode: 'watch', round_number: 1 });
      await captures._test.runOnce();
      const open = tool.calls.find((c) => c.op === 'open');
      expect(open.profile).to.equal(null); // the player's own video settings
      const w = tool.calls.find((c) => c.op === 'watch');
      expect(w.tick).to.equal(replay.rounds[0].start_tick);
      const s = (await member.get('/api/capture-sessions/current').expect(200)).body.session;
      expect(s).to.include({ mode: 'watch', status: 'done' });
    });
  });

  describe('capture planning', () => {
    const plan = require('../services/capturePlan');
    const d = { tickrate: 64, meta: { players: replay.meta.players } };
    const items = (r = round) => [
      { capture_id: 1, kind: 'kill', round_number: 1, round: r, ev: r.events[kill], dir: '/k' },
      { capture_id: 2, kind: 'utility', round_number: 1, round: r, ev: r.events[smoke], dir: '/u' },
    ];

    it('plans killer and victim clips one second either side of the kill, clamped to the round', () => {
      const p = plan.planWindows(d, items());
      expect(p.windows.filter((w) => w.capture_id === 1).map((w) => [w.role, w.player, w.start, w.end, w.xray]))
        .to.deep.equal([['victim_clip', 'bravo', 436, 564, true], ['killer_clip', 'alpha', 436, 564, true]]);
      expect(plan.planWindows(d, items({ ...round, start_tick: 480 })).windows[0]).to.include({ start: 480, end: 564 });
      expect(plan.planWindows(d, items({ ...round, end_tick: 520 })).windows[0]).to.include({ start: 436, end: 520 });
      const noSmoke = [{ ...items()[0], ev: { ...round.events[kill], through_smoke: false } }];
      expect(plan.planWindows(d, noSmoke).windows[0].xray).to.equal(false);
    });

    it('plans the throw clip around the release and a lineup the tick before', () => {
      const p = plan.planWindows(d, items());
      expect(p.windows.find((w) => w.capture_id === 2)).to.include({ role: 'replay', player: 'alpha', start: 236, end: 364 });
      // Without setup samples the still is the tick before release (Phase 15 picks an earlier aim frame when it can).
      expect(p.lineups.map(({ events, ...l }) => l)).to.deep.equal([{ capture_id: 2, role: 'lineup', player: 'alpha', round: 1, tick: 299, release_tick: 300, setup: null, file: path.join('/u', 'lineup.jpg') }]);
      // Each output names its timeline event (Phase 16).
      expect(p.lineups[0].events).to.deep.equal([{ capture_id: 2, round_number: 1, event_index: null, kind: 'utility', event_tick: 300 }]);
      const unlinked = plan.planWindows(d, [{ ...items()[1], ev: { ...round.events[smoke], throw_tick: null } }]);
      expect(unlinked.lineups).to.deep.equal([]);
    });
  });
});
