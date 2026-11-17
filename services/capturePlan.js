// Capture planning (Phases 14–15), built from parsed events before CS2 starts.
//
// Every requested output becomes a window: a POV and demo ticks to record.
// - Kill: the killer's and the victim's view, one second either side of the
//   kill (tick rate from the demo), clamped to the round. No stills.
// - Utility: the thrower's view one second either side of the release (the
//   detonation if the release isn't linked), plus a lineup still on the
//   player's stable aim before the throw setup (services/throwSetup.js; the
//   tick before release when no setup moment is known).
// Flash-affected and through-smoke kills record with spectator X-ray on.
//
// Grouping (Phase 15): nearby events by one player in a round share one
// continuous video, from a second before the first to a second after the
// last. Kills group when they are by the same killer with the same capture
// settings (X-ray), each within GROUP_GAP_S of the previous one and the
// whole group within GROUP_SPAN_S; each kill keeps its own victim clip.
// Throws group the same way by thrower; each keeps its own lineup still.
// The shared clip is recorded once and linked into every member capture
// (`copies`), so each event keeps its own identity and media.
//
// A schedule orders the windows into recording segments:
// - chronological: one segment per window, in tick order;
// - player: one segment per window, a player's windows in tick order before
//   the next player's (fewer POV switches, more backward seeks);
// - hybrid: per round and POV, windows that overlap and share settings
//   (X-ray) merge into one segment; each output keeps its own window and
//   is cut from the shared recording.
// Lineup stills go right before the segment holding their throw's clip, so
// the seek back to that segment's start is a single backward seek.
//
// Phase 16 adds two pass schedules, built from the same windows:
// - match_player: one pass per player over the whole match (their kills,
//   deaths and throws in tick order), then the next player;
// - round_player: per round, one pass per player (the previous round's last
//   player first, so a round boundary often needs no POV switch).
// In both, a player's windows with the same capture settings (X-ray, speed)
// in one round merge when they overlap or the gap between them is at most
// `mergeGapS` (playing through a short gap is cheaper than stopping and
// seeking). A throw's lineup still is taken from that recording when its
// still tick is inside it or at most `stillExtendS` before it (the recording
// starts earlier instead); otherwise it is a separate still step in the
// player's pass. Every output keeps its own window and event.
const path = require('path');

const SCHEDULES = ['chronological', 'player', 'hybrid', 'match_player', 'round_player'];
const PASS_SCHEDULES = ['match_player', 'round_player'];
// Defaults for the pass schedules (measured crossovers, see README Phase 16).
const MERGE_GAP_S = 1.5;
const STILL_EXTEND_S = 1.5;
// A still taken from a recording sits this many ticks after the recording
// starts at the earliest (the first frames follow the pre-roll).
const STILL_LEAD_TICKS = 2;
// Grouping window: consecutive events at most this far apart, the whole
// group at most this long (so a grouped clip stays short).
const GROUP_GAP_S = 3;
const GROUP_SPAN_S = 8;

function window2s(round, tick, tickrate, lastTick = tick) {
  const lo = round.start_tick ?? round.first_tick;
  const hi = round.end_tick ?? Number.MAX_SAFE_INTEGER;
  return { start: Math.max(lo, Math.round(tick - tickrate)), end: Math.min(hi, Math.round(lastTick + tickrate)) };
}

// Splits events (sorted by tick) into runs: same key, each within gap of the
// previous one and within span of the first.
function groupRuns(list, keyOf, tickOf, tickrate) {
  const runs = [];
  const open = new Map();
  for (const it of [...list].sort((a, b) => tickOf(a) - tickOf(b))) {
    const k = keyOf(it);
    const cur = open.get(k);
    const t = tickOf(it);
    if (cur && t - tickOf(cur[cur.length - 1]) <= GROUP_GAP_S * tickrate && t - tickOf(cur[0]) <= GROUP_SPAN_S * tickrate) cur.push(it);
    else { const run = [it]; runs.push(run); open.set(k, run); }
  }
  return runs;
}

// The stable timeline identity of an event an output belongs to.
const eventOf = (it, tick) => ({ capture_id: it.capture_id, round_number: it.round_number, event_index: it.event_index ?? null, kind: it.kind, event_tick: tick });

// items: [{ capture_id, kind, round_number, event_index, round, ev, dir, setup, have }]
// `have`: roles this capture already has from an earlier attempt (kept, so
// only missing outputs are planned).
function planWindows(demo, items, { group = true } = {}) {
  const players = (demo.meta && demo.meta.players) || [];
  const nameOf = (i) => (i == null ? null : (players.find((p) => p.index === i) || {}).name || null);
  const tickrate = demo.tickrate || 64;
  const windows = [];
  const lineups = [];
  const skipped = [];
  const kills = [];
  const throws = [];
  for (const it of items) {
    const { ev, round } = it;
    const has = new Set(it.have || []);
    if (!ev || !round) { skipped.push({ capture_id: it.capture_id, code: 'event_missing' }); continue; }
    if (it.kind === 'kill') {
      const xray = !!(ev.attacker_blind || ev.flash_assist || ev.through_smoke);
      const killer = ev.attacker != null && ev.attacker !== ev.victim ? nameOf(ev.attacker) : null;
      const victim = nameOf(ev.victim);
      if (!killer && !victim) { skipped.push({ capture_id: it.capture_id, code: 'nothing_to_capture' }); continue; }
      const w = window2s(round, ev.tick, tickrate);
      if (victim && !has.has('victim_clip')) windows.push({ capture_id: it.capture_id, role: 'victim_clip', player: victim, xray, round: it.round_number, ...w, event_tick: ev.tick, file: path.join(it.dir, 'victim.webm'), events: [eventOf(it, ev.tick)] });
      if (killer && !has.has('killer_clip')) kills.push({ it, killer, xray, tick: ev.tick });
    } else {
      const thrower = nameOf(ev.player);
      if (!thrower) { skipped.push({ capture_id: it.capture_id, code: 'nothing_to_capture' }); continue; }
      const center = ev.throw_tick != null ? ev.throw_tick : ev.tick;
      if (!has.has('replay')) throws.push({ it, thrower, tick: center });
      if (ev.throw_tick != null && !has.has('lineup')) {
        const setup = it.setup || null;
        const tick = setup && setup.still_tick != null && setup.still_tick < ev.throw_tick ? setup.still_tick : ev.throw_tick - 1;
        lineups.push({ capture_id: it.capture_id, role: 'lineup', player: thrower, round: it.round_number, tick, release_tick: ev.throw_tick, setup, file: path.join(it.dir, 'lineup.jpg'), events: [eventOf(it, ev.throw_tick)] });
      }
    }
  }
  const member = (x) => eventOf(x.it, x.tick);
  const addGroup = (run, role, player, xray, name) => {
    const first = run[0];
    const w = window2s(first.it.round, first.tick, tickrate, run[run.length - 1].tick);
    const members = run.map(member);
    const groupInfo = run.length > 1 ? {
      id: `${role === 'replay' ? 'u' : 'k'}:${first.it.round_number}:${player}:${first.tick}`, kind: role === 'replay' ? 'utility' : 'kill', start: w.start, end: w.end, members,
    } : null;
    windows.push({
      capture_id: first.it.capture_id, role, player, xray, round: first.it.round_number, ...w, event_tick: first.tick,
      file: path.join(first.it.dir, name), group: groupInfo, events: members,
      copies: run.slice(1).map((x) => ({ capture_id: x.it.capture_id, file: path.join(x.it.dir, name), event_tick: x.tick })),
    });
  };
  const killRuns = group ? groupRuns(kills, (k) => `${k.it.round_number}\u0000${k.killer}\u0000${k.xray ? 1 : 0}`, (k) => k.tick, tickrate) : kills.map((k) => [k]);
  for (const run of killRuns) addGroup(run, 'killer_clip', run[0].killer, run[0].xray, 'killer.webm');
  const throwRuns = group ? groupRuns(throws, (u) => `${u.it.round_number}\u0000${u.thrower}`, (u) => u.tick, tickrate) : throws.map((u) => [u]);
  for (const run of throwRuns) addGroup(run, 'replay', run[0].thrower, false, 'replay.webm');
  return { windows, lineups, skipped, tickrate };
}

const bySegmentStart = (a, b) => a.start - b.start || (a.player < b.player ? -1 : a.player > b.player ? 1 : 0);

const isKillRole = (role) => role === 'killer_clip' || role === 'victim_clip';
const byPlayer = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Pass schedules (Phase 16): merged per player, settings and round, with
// lineup stills taken from the recordings where they can be.
function passSchedule(plan, mode, opts) {
  const { windows, lineups, tickrate } = plan;
  const gap = Math.round((opts.mergeGapS ?? MERGE_GAP_S) * tickrate);
  const extend = Math.round((opts.stillExtendS ?? STILL_EXTEND_S) * tickrate);
  const ts = opts.timescale || 1;
  const killTs = opts.killTimescale || ts;
  const speedOf = (w) => (isKillRole(w.role) ? killTs : ts);
  const keyOf = (x) => `${x.round}\u0000${x.player}\u0000${x.xray ? 1 : 0}\u0000${x.speed}`;
  // 1. Merge windows: same key, overlapping or within the gap.
  const merge = (list) => {
    const out = [];
    const open = new Map();
    for (const x of [...list].sort((a, b) => a.start - b.start || a.end - b.end)) {
      const cur = open.get(keyOf(x));
      if (cur && x.start <= cur.end + gap) {
        cur.end = Math.max(cur.end, x.end);
        cur.outputs.push(...x.outputs);
        cur.stills.push(...x.stills);
      } else {
        const seg = { ...x, outputs: [...x.outputs], stills: [...x.stills] };
        out.push(seg);
        open.set(keyOf(x), seg);
      }
    }
    return out;
  };
  let segments = merge(windows.map((w) => ({ player: w.player, xray: w.xray, round: w.round, speed: speedOf(w), start: w.start, end: w.end, outputs: [w], stills: [] })));
  // 2. Lineup stills from a recording of the same player without X-ray at
  // normal speed: inside it, or the recording starts earlier to include it.
  const separate = [];
  for (const l of [...lineups].sort((a, b) => a.tick - b.tick)) {
    const seg = segments.filter((g) => g.player === l.player && !g.xray && g.speed <= 1 && g.round === l.round && l.tick < g.end && l.tick >= g.start - extend)
      .sort((a, b) => a.start - b.start)[0];
    if (!seg) { separate.push(l); continue; }
    seg.start = Math.min(seg.start, l.tick - STILL_LEAD_TICKS);
    seg.stills.push(l);
  }
  segments = merge(segments); // an earlier start can reach the previous recording
  // 3. Order: passes per player (whole match or per round), each in tick order.
  const items = [
    ...segments.map((g) => ({ at: g.start, player: g.player, round: g.round, step: { op: 'segment', tickrate, ...g, stills: g.stills.sort((a, b) => a.tick - b.tick) } })),
    ...separate.map((l) => ({ at: l.tick, player: l.player, round: l.round, step: { op: 'lineup', ...l } })),
  ];
  const firstAt = (list) => {
    const m = new Map();
    for (const it of list) if (!m.has(it.player) || it.at < m.get(it.player)) m.set(it.player, it.at);
    return [...m.entries()].sort((a, b) => a[1] - b[1] || byPlayer(a[0], b[0])).map(([p]) => p);
  };
  const inPass = (list, players) => players.flatMap((p) => list.filter((it) => it.player === p).sort((a, b) => a.at - b.at || (a.step.op === 'lineup' ? -1 : 1)));
  let ordered;
  if (mode === 'match_player') ordered = inPass(items, firstAt(items));
  else {
    ordered = [];
    let last = null;
    for (const r of [...new Set(items.map((it) => it.round))].sort((a, b) => a - b)) {
      const list = items.filter((it) => it.round === r);
      let players = firstAt(list);
      if (last && players.includes(last)) players = [last, ...players.filter((p) => p !== last)];
      ordered.push(...inPass(list, players));
      last = players[players.length - 1];
    }
  }
  return ordered.map((it) => it.step);
}

// Orders windows into segments for a schedule; lineups placed before the
// segment holding their capture's clip. Returns the steps to run.
// opts (pass schedules): { mergeGapS, stillExtendS, timescale, killTimescale }.
function schedule(plan, mode = 'chronological', opts = {}) {
  if (!SCHEDULES.includes(mode)) throw new Error(`Unknown schedule ${mode}`);
  if (PASS_SCHEDULES.includes(mode)) return passSchedule(plan, mode, opts);
  const { windows, lineups, tickrate } = plan;
  let segments;
  if (mode === 'hybrid') {
    const groups = new Map();
    for (const w of windows) {
      const k = `${w.round}\u0000${w.player}\u0000${w.xray ? 1 : 0}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(w);
    }
    segments = [];
    for (const list of groups.values()) {
      list.sort((a, b) => a.start - b.start || a.end - b.end);
      let cur = null;
      for (const w of list) {
        if (cur && w.start <= cur.end) {
          cur.end = Math.max(cur.end, w.end);
          cur.outputs.push(w);
        } else {
          cur = { player: w.player, xray: w.xray, round: w.round, start: w.start, end: w.end, outputs: [w] };
          segments.push(cur);
        }
      }
    }
    segments.sort(bySegmentStart);
  } else {
    segments = windows.map((w) => ({ player: w.player, xray: w.xray, round: w.round, start: w.start, end: w.end, outputs: [w] }));
    if (mode === 'player') {
      segments.sort((a, b) => (a.player < b.player ? -1 : a.player > b.player ? 1 : 0) || a.start - b.start);
    } else segments.sort(bySegmentStart);
  }
  const steps = [];
  const placed = new Set();
  for (const seg of segments) {
    for (const o of seg.outputs) {
      if (o.role !== 'replay') continue;
      const ids = new Set([o.capture_id, ...(o.copies || []).map((c) => c.capture_id)]);
      for (const l of lineups.filter((x) => ids.has(x.capture_id) && !placed.has(x)).sort((a, b) => a.tick - b.tick)) {
        steps.push({ op: 'lineup', ...l });
        placed.add(l);
      }
    }
    steps.push({ op: 'segment', tickrate, ...seg });
  }
  for (const l of lineups) if (!placed.has(l)) steps.push({ op: 'lineup', ...l });
  return steps;
}

// What a schedule costs before running it: segments, POV switches and the
// seeks that go backward / forward between consecutive steps.
function scheduleStats(steps) {
  let pov = null;
  let at = null;
  const s = { segments: 0, lineups: 0, stills_in_recording: 0, outputs: 0, merged_outputs: 0, grouped_events: 0, pov_switches: 0, backward_seeks: 0, forward_seeks: 0, recorded_ticks: 0, output_ticks: 0 };
  for (const st of steps) {
    const target = st.op === 'segment' ? st.start : st.tick;
    if (at != null) { if (target < at) s.backward_seeks += 1; else s.forward_seeks += 1; } else s.forward_seeks += 1;
    if (st.player !== pov) { s.pov_switches += pov == null ? 0 : 1; pov = st.player; }
    if (st.op === 'segment') {
      s.segments += 1;
      s.outputs += st.outputs.length;
      for (const o of st.outputs) s.grouped_events += o.copies && o.copies.length ? o.copies.length + 1 : 0;
      if (st.outputs.length > 1) s.merged_outputs += st.outputs.length;
      s.stills_in_recording += (st.stills || []).length;
      s.recorded_ticks += st.end - st.start;
      s.output_ticks += st.outputs.reduce((n, o) => n + o.end - o.start, 0);
      at = st.end;
    } else {
      s.lineups += 1;
      at = st.tick;
    }
  }
  return s;
}

// Planned cost of a schedule (seconds), from per-operation costs measured
// on the capture machine (README Phase 16). Used to compare schedules
// before CS2 opens; the worker measures the real times.
const COSTS = {
  segment_s: 0.9, // pause, speed and console work around one recording
  preroll_s: 0.35, // real time played before a recording's first frame
  seek_back_s: 0.4, // one backward seek, any distance (0.17-0.47 s measured)
  seek_fwd_s: 0.7, // forward seek (one command up to 400 ticks: 0.17-0.27 s; longer 0.17-1.14 s)
  pov_s: 0.85, // spectator switch (0.07-0.17 s) and the overshoot seek after it (0.71 s)
  still_s: 0.5, // separate lineup still (pause check and save)
  ff_speed: 8, // fast-forward speed through a gap
  ff_overhead_s: 0.7, // changing speed, resuming and pausing exactly
};
function estimate(steps, costs = COSTS) {
  const c = { ...COSTS, ...costs };
  let pos = null;
  let pov = null;
  const t = { move: 0, pov: 0, record: 0, overhead: 0, still: 0 };
  for (const st of steps) {
    const tickrate = st.tickrate || 64;
    const target = st.op === 'segment' ? st.start : st.tick;
    if (st.player !== pov) { if (pov != null) t.pov += c.pov_s; pov = st.player; }
    if (pos == null || target < pos) t.move += c.seek_back_s;
    else t.move += Math.min(c.seek_fwd_s, c.ff_overhead_s + (target - pos) / tickrate / c.ff_speed);
    if (st.op === 'segment') {
      t.record += c.preroll_s + (st.end - st.start) / tickrate / (st.speed || 1);
      t.overhead += c.segment_s;
      pos = st.end;
    } else {
      t.still += c.still_s;
      pos = st.tick;
    }
  }
  const total = Object.values(t).reduce((a, b) => a + b, 0);
  return { total_s: Math.round(total * 10) / 10, ...Object.fromEntries(Object.entries(t).map(([k, v]) => [`${k}_s`, Math.round(v * 10) / 10])) };
}

module.exports = { COSTS, estimate, SCHEDULES, PASS_SCHEDULES, MERGE_GAP_S, STILL_EXTEND_S, STILL_LEAD_TICKS, GROUP_GAP_S, GROUP_SPAN_S, window2s, groupRuns, planWindows, schedule, scheduleStats };
