// Phase 16: faster full-match capture. Pass schedules (one pass per player
// over the match or per round) built before CS2 opens, short gaps played
// through, lineup stills taken from recordings, every output tied to its
// timeline event, only missing or wrong-POV outputs retried, kept outputs
// surviving a failed capture, and the console command trace.
const fs = require('fs');
const path = require('path');
const { expect } = require('chai');
const { connection, reseed, teamWithMember } = require('./helpers');
const P = require('../services/capturePlan');
const config = require('../config/env');
const { buildReplay } = require('../services/demoParse');
const demoJobs = require('../services/demoJobs');
const captures = require('../services/captures');

describe('phase 16', () => {
  describe('pass schedules', () => {
    const players = [{ index: 0, name: 'A' }, { index: 1, name: 'B' }, { index: 2, name: 'C' }];
    const r1 = { start_tick: 0, end_tick: 5000 };
    const r2 = { start_tick: 6000, end_tick: 11000 };
    const kill = (id, round, n, tick, attacker, victim, extra = {}) => ({ capture_id: id, kind: 'kill', round_number: n, event_index: id, round, ev: { type: 'kill', tick, attacker, victim, ...extra }, dir: `/c${id}` });
    const nade = (id, round, n, tick, player, still) => ({ capture_id: id, kind: 'utility', round_number: n, event_index: id, round, ev: { type: 'smoke', tick: tick + 300, throw_tick: tick, player }, dir: `/c${id}`, setup: still ? { still_tick: still } : null });
    // Round 1: A throws at 1000 (still 900) and kills B at 1300 and C at 1700
    // (gap 400 ticks: not grouped, but within a 6 s merge gap); C kills A at
    // 4000 through smoke. Round 2: A throws at 7000 with its still 3 s
    // before (6740), B kills C at 8000.
    const items = [
      nade(1, r1, 1, 1000, 0, 900), kill(2, r1, 1, 1300, 0, 1), kill(3, r1, 1, 1700, 0, 2), kill(4, r1, 1, 4000, 2, 0, { through_smoke: true }),
      nade(5, r2, 2, 7000, 0, 6740), kill(6, r2, 2, 8000, 1, 2),
    ];
    const plan = P.planWindows({ tickrate: 64, meta: { players } }, items);

    it('records each player\'s whole match in tick order, merging short gaps and keeping every output\'s own window', () => {
      const steps = P.schedule(plan, 'match_player', { mergeGapS: 6 });
      expect([...new Set(steps.map((s) => s.player))]).to.deep.equal(['A', 'B', 'C']);
      const a = steps.filter((s) => s.player === 'A');
      // Round 1: throw (936-1064) and both kills (1236-1764) are one recording; the
      // X-ray victim clip is its own; round 2's throw is separate (never across rounds).
      expect(a.map((s) => [s.op, s.round, s.start, s.end, !!s.xray])).to.deep.equal([
        ['segment', 1, 898, 1764, false], ['segment', 1, 3936, 4064, true], ['lineup', 2, undefined, undefined, false], ['segment', 2, 6936, 7064, false],
      ]);
      expect(a[0].outputs.map((o) => [o.capture_id, o.role, o.start, o.end])).to.deep.equal([[1, 'replay', 936, 1064], [2, 'killer_clip', 1236, 1364], [3, 'killer_clip', 1636, 1764]]);
      // The still 100 ticks before the clip is taken from the recording (it starts earlier);
      // the one 3 s before its clip is a separate still, just before it in A's pass.
      expect(a[0].stills.map((l) => [l.capture_id, l.tick])).to.deep.equal([[1, 900]]);
      expect(a[2]).to.include({ op: 'lineup', capture_id: 5, tick: 6740 });
      // Every output and event is still there exactly once, each with its event identity.
      const files = steps.flatMap((s) => (s.op === 'segment' ? [...s.outputs.map((o) => o.file), ...s.stills.map((l) => l.file)] : [s.file]));
      expect(files).to.have.length(new Set(files).size).and.length(plan.windows.length + plan.lineups.length);
      expect(a[0].outputs[1].events).to.deep.equal([{ capture_id: 2, round_number: 1, event_index: 2, kind: 'kill', event_tick: 1300 }]);
      const st = P.scheduleStats(steps);
      expect(st).to.include({ pov_switches: 2, stills_in_recording: 1, lineups: 1 });
      // With the default 2 s gap the kills 400 ticks apart record separately.
      expect(P.schedule(plan, 'match_player').filter((s) => s.player === 'A' && s.op === 'segment')).to.have.length(5);
    });

    it('per round, starts each round with the previous round\'s last player', () => {
      const steps = P.schedule(plan, 'round_player', { mergeGapS: 6 });
      expect(steps.map((s) => [s.round, s.player])).to.deep.equal([
        [1, 'A'], [1, 'A'], [1, 'B'], [1, 'C'], [1, 'C'], [2, 'C'], [2, 'A'], [2, 'A'], [2, 'B'],
      ]);
    });

    it('never takes a still from an X-ray or fast recording, and keeps kill speed apart from throws', () => {
      const p = P.planWindows({ tickrate: 64, meta: { players } }, [nade(1, r1, 1, 1000, 0, 990), kill(2, r1, 1, 1010, 0, 1, { through_smoke: true })]);
      const steps = P.schedule(p, 'match_player', { killTimescale: 2 });
      const seg = (role) => steps.find((s) => s.op === 'segment' && s.outputs.some((o) => o.role === role));
      expect(seg('killer_clip')).to.include({ speed: 2, xray: true });
      expect(seg('killer_clip').stills).to.deep.equal([]);
      expect(seg('replay')).to.include({ speed: 1 });
      expect(seg('replay').stills.map((l) => l.tick)).to.deep.equal([990]);
    });

    it('estimates a schedule from per-operation costs', () => {
      const steps = P.schedule(plan, 'match_player', { mergeGapS: 6 });
      const e = P.estimate(steps);
      expect(e.total_s).to.be.above(0);
      expect(e.pov_s).to.equal(2 * P.COSTS.pov_s);
      expect(Math.round((e.move_s + e.pov_s + e.record_s + e.overhead_s + e.still_s) * 10) / 10).to.be.closeTo(e.total_s, 0.3);
      expect(P.estimate(P.schedule(plan, 'hybrid')).pov_s).to.be.above(e.pov_s);
    });

    it('plans only the outputs a capture is missing', () => {
      const p = P.planWindows({ tickrate: 64, meta: { players } }, [{ ...kill(2, r1, 1, 1300, 0, 1), have: ['killer_clip'] }, { ...nade(1, r1, 1, 1000, 0, 900), have: ['replay'] }]);
      expect(p.windows.map((w) => w.role)).to.deep.equal(['victim_clip']);
      expect(p.lineups.map((l) => l.capture_id)).to.deep.equal([1]);
    });
  });

  describe('capture session with pass schedules', () => {
    const DEMO_BYTES = Buffer.concat([Buffer.from('PBDEMS2\0', 'latin1'), Buffer.alloc(64, 16)]);
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
    const events = replay.rounds[0].data.events;
    const idx = (type, tick) => events.findIndex((e) => e.type === type && (tick == null || e.tick === tick));
    let uploaded = [];
    let saved;
    // Kill clips at 1x here, so kills and throws by one player share a pass.
    beforeEach(async () => { await reseed(); saved = [config.captureSchedule, config.captureKillTimescale]; config.captureSchedule = 'match_player'; config.captureKillTimescale = 1; });
    afterEach(() => {
      [config.captureSchedule, config.captureKillTimescale] = saved;
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
    const write = (f) => { fs.writeFileSync(f, `media ${f}`); return f; };
    // A fake CS2: `segment` writes every output and still; `behave(req, n)`
    // can change a reply (n: how many segment calls so far).
    function fakeDriver(calls, behave = () => null) {
      let n = 0;
      return {
        check: async () => ({ cs2_installed: true, runtime: true, uinput: true, encoder: true, cs2_running: false, cs2_usable: false }),
        inputs: async (file, ranges) => Object.fromEntries(ranges.map((r) => [r.key, { start: r.start, bits: [] }])),
        // Standing still until 290, then a jump into each release.
        throws: async (file, list) => Object.fromEntries(list.map((t) => [t.key, Array.from({ length: t.lookback + 1 }, (_, i) => {
          const tick = t.tick - t.lookback + i;
          return { tick, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: tick >= t.tick - 10 ? 250 : 0, buttons: tick === t.tick - 10 ? 2 : 0 };
        })])),
        open: () => ({
          async call(req) {
            calls.push(req);
            if (req.op === 'segment') {
              n += 1;
              const custom = behave(req, n);
              if (custom) return custom;
              const outputs = req.outputs.map((o) => ({ file: write(o.file), start: o.start, end: o.end, player: req.player, fps: 30, frames: 60, width: 1280, height: 720, pov_left_at: null }));
              const stills = req.stills.map((x) => ({ file: write(x.file), tick: x.tick, player: req.player, from_recording: true, lag_ticks: 0.2, width: 1280, height: 720 }));
              return { ok: true, outputs, stills, encoded: outputs.map((o) => o.file), encode_failed: [], timings: { wall: 1 }, trace: [{ t: 1, cmd: 'demo_resume', why: 'record', console_s: 0.01, submit_s: 0.05 }] };
            }
            if (req.op === 'lineup') return { ok: true, still: { file: write(req.file), tick: req.tick, player: req.player }, encoded: [], timings: {}, trace: [] };
            return { ok: true, encoded: [], encode_failed: [], timings: {}, trace: [] };
          },
          async close() { return { closed: true, timings: {} }; },
        }),
      };
    }

    it('records alpha\'s pass once with both lineup stills from the recording, and ties every output to its event', async () => {
      const calls = [];
      captures._test.setEnabled(true);
      captures._test.setDriver(fakeDriver(calls));
      const { owner, teamId } = await teamWithMember();
      const d = await uploadParsed(owner, teamId);
      await owner.post(`/api/demos/${d.demo_id}/captures/batch`).send({ selection: 'all', round_number: 1 }).expect(202);
      expect(await captures._test.runOnce()).to.equal(true);
      const rows = await connection('demo_captures').where('demo_id', d.demo_id).orderBy('moment_tick');
      expect(rows.map((r) => r.status)).to.deep.equal(['ready', 'ready', 'ready', 'ready']);
      // The plan was built before CS2 opened.
      expect(calls[0].op).to.equal('open');
      const segs = calls.filter((c) => c.op === 'segment');
      expect(segs.map((s) => s.player)).to.deep.equal(['alpha', 'bravo', 'charlie']);
      expect(segs[0].stills.map((x) => x.tick)).to.deep.equal([289, 369]);
      expect(segs[0].start).to.equal(236); // the smoke clip's window; both stills are inside
      expect(calls.filter((c) => c.op === 'lineup')).to.deep.equal([]);
      const smoke = rows.find((r) => r.event_index === idx('smoke'));
      expect(smoke.media.find((m) => m.role === 'lineup')).to.deep.include({ tick: 289, release_tick: 300, from_recording: true });
      // Each capture's media names its own timeline event, also for a shared (grouped) clip.
      const k2 = rows.find((r) => r.event_index === idx('kill', 560));
      expect(k2.media.find((m) => m.role === 'killer_clip').event).to.deep.include({ round_number: 1, event_index: idx('kill', 560), kind: 'kill' });
      expect(k2.media.find((m) => m.role === 'victim_clip').player).to.equal('charlie');
      // Published mapping, command trace and timings.
      const s = await connection('capture_sessions').where('demo_id', d.demo_id).first();
      const dir = path.join(config.captureStorageDir, String(d.demo_id));
      const plan = JSON.parse(fs.readFileSync(path.join(dir, `session-${s.session_id}-plan.json`), 'utf8'));
      expect(plan.events.map((e) => e.event_index).sort()).to.deep.equal(rows.map((r) => r.event_index).sort());
      expect(plan.events.find((e) => e.event_index === idx('kill', 560)).outputs.find((o) => o.role === 'killer_clip')).to.include({ step: 0 });
      expect(fs.readFileSync(path.join(dir, `session-${s.session_id}-trace.jsonl`), 'utf8').trim().split('\n')).to.have.length(3);
      expect(s.timings.commands).to.include({ total: 3 });
      expect(s.timings.schedule).to.include({ mode: 'match_player', pov_switches: 2, stills_in_recording: 2 });
      expect(s.timings.schedule.planned.total_s).to.be.above(0);
    });

    it('retries only a clip from the wrong POV and a still the recording could not supply', async () => {
      const calls = [];
      captures._test.setEnabled(true);
      captures._test.setDriver(fakeDriver(calls, (req, n) => {
        if (n === 1) {
          // The flash still was too far from its tick; the camera left alpha before the second kill.
          const outputs = req.outputs.map((o) => ({ file: write(o.file), start: o.start, end: o.end, player: req.player, frames: 60, pov_left_at: o.file.endsWith('killer.webm') ? 540 : null }));
          const stills = req.stills.map((x) => (x.tick === 369 ? { file: x.file, tick: x.tick, error: 'grab too far from the tick' } : { file: write(x.file), tick: x.tick, from_recording: true }));
          return { ok: true, outputs, stills, encoded: outputs.filter((o) => o.pov_left_at == null).map((o) => o.file), encode_failed: [], timings: {}, trace: [] };
        }
        return null;
      }));
      const { owner, teamId } = await teamWithMember();
      const d = await uploadParsed(owner, teamId);
      await owner.post(`/api/demos/${d.demo_id}/captures/batch`).send({ selection: 'all', round_number: 1 }).expect(202);
      expect(await captures._test.runOnce()).to.equal(true);
      const rows = await connection('demo_captures').where('demo_id', d.demo_id);
      expect(rows.map((r) => r.status)).to.deep.equal(['ready', 'ready', 'ready', 'ready']);
      const segs = calls.filter((c) => c.op === 'segment');
      // Retried: alpha's grouped killer clip only (window 436-624), not the throw clip.
      expect(segs).to.have.length(4);
      expect(segs[3]).to.include({ player: 'alpha', start: 436, end: 624 });
      expect(segs[3].outputs.map((o) => path.basename(o.file))).to.deep.equal(['killer.webm']);
      expect(segs[3].stills).to.deep.equal([]);
      // The flash still fell back to a separate verified still.
      expect(calls.filter((c) => c.op === 'lineup').map((c) => c.tick)).to.deep.equal([369]);
      const s = await connection('capture_sessions').where('demo_id', d.demo_id).first();
      expect(s.timings.steps).to.include({ pov_rejected_count: 1, still_fallback_count: 1 });
    });

    it('keeps a clip the demo\'s end cut short (stopped on the last tick) and does not retry one that would start after it', async () => {
      const calls = [];
      captures._test.setEnabled(true);
      // The demo ends during alpha's grouped kill clip (window 436-624) at 600;
      // the next round of footage (a second output) would start after it.
      captures._test.setDriver(fakeDriver(calls, (req, n) => {
        if (n !== 1) return null;
        const outputs = req.outputs.map((o) => (o.file.endsWith('killer.webm')
          ? { file: write(o.file), start: o.start, end: 600, player: req.player, frames: 49, pov_left_at: null, stopped_at_demo_end: true }
          : { file: o.file, start: o.start, end: o.end, player: req.player, frames: 0, error: 'demo_ended' }));
        const stills = req.stills.map((x) => ({ file: write(x.file), tick: x.tick, from_recording: true }));
        return { ok: true, outputs, stills, encoded: outputs.filter((o) => !o.error).map((o) => o.file), encode_failed: [], timings: { demo_end_count: 1 }, trace: [] };
      }));
      const { owner, teamId } = await teamWithMember();
      const d = await uploadParsed(owner, teamId);
      await owner.post(`/api/demos/${d.demo_id}/captures/batch`).send({ selection: 'all', round_number: 1 }).expect(202);
      expect(await captures._test.runOnce()).to.equal(true);
      const segs = calls.filter((c) => c.op === 'segment');
      // Nothing of alpha's pass is recorded again.
      expect(segs.filter((c) => c.player === 'alpha')).to.have.length(1);
      const rows = await connection('demo_captures').where('demo_id', d.demo_id);
      const k2 = rows.find((r) => r.event_index === idx('kill', 560));
      expect(k2.status).to.equal('ready');
      expect(k2.media.find((m) => m.role === 'killer_clip')).to.include({ end: 600, stopped_at_demo_end: true });
      const smoke = rows.find((r) => r.event_index === idx('smoke'));
      expect(smoke).to.include({ status: 'failed', error_code: 'demo_ended' });
    });

    it('keeps the outputs a failed capture did get, and a retry captures only the rest', async () => {
      const calls = [];
      captures._test.setEnabled(true);
      // Bravo's view can't be recorded in this session (also on the retry).
      captures._test.setDriver(fakeDriver(calls, (req) => (req.player === 'bravo' ? { ok: false, code: 'spectate', error: 'CS2 could not switch to bravo\'s view.', trace: [] } : null)));
      const { owner, teamId } = await teamWithMember();
      const d = await uploadParsed(owner, teamId);
      await owner.post(`/api/demos/${d.demo_id}/captures/batch`).send({ selection: 'kill', round_number: 1 }).expect(202);
      expect(await captures._test.runOnce()).to.equal(true);
      const k1 = () => connection('demo_captures').where({ demo_id: d.demo_id, event_index: idx('kill', 500) }).first();
      let row = await k1();
      expect(row).to.include({ status: 'failed', error_code: 'spectate' });
      expect(row.timings.partial.media.map((m) => m.role)).to.deep.equal(['killer_clip']);
      expect(calls.filter((c) => c.op === 'segment' && c.player === 'bravo')).to.have.length(2); // tried, retried once
      // The other kill is complete.
      expect((await connection('demo_captures').where({ demo_id: d.demo_id, event_index: idx('kill', 560) }).first()).status).to.equal('ready');
      // Retry in a new session: only bravo's victim clip is recorded; the kept killer clip is reused.
      const sessionId = row.session_id;
      calls.length = 0;
      captures._test.setDriver(fakeDriver(calls));
      await owner.post(`/api/demos/${d.demo_id}/captures/retry`).send({ session_id: sessionId }).expect(202);
      expect(await captures._test.runOnce()).to.equal(true);
      const segs = calls.filter((c) => c.op === 'segment');
      expect(segs.map((s) => [s.player, s.outputs.map((o) => path.basename(o.file))])).to.deep.equal([['bravo', ['victim.webm']]]);
      row = await k1();
      expect(row.status).to.equal('ready');
      expect(row.media.map((m) => m.role)).to.deep.equal(['killer_clip', 'victim_clip']);
      const killer = await captures.mediaFile(d.demo_id, owner.user.user_id, row.capture_id, 'killer.webm');
      expect(fs.existsSync(killer)).to.equal(true);
      expect(row.timings).to.not.have.property('partial');
    });
  });
});
