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
const path = require('path');

const SCHEDULES = ['chronological', 'player', 'hybrid'];
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

// items: [{ capture_id, kind, round_number, event_index, round, ev, dir, setup }]
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
    if (!ev || !round) { skipped.push({ capture_id: it.capture_id, code: 'event_missing' }); continue; }
    if (it.kind === 'kill') {
      const xray = !!(ev.attacker_blind || ev.flash_assist || ev.through_smoke);
      const killer = ev.attacker != null && ev.attacker !== ev.victim ? nameOf(ev.attacker) : null;
      const victim = nameOf(ev.victim);
      if (!killer && !victim) { skipped.push({ capture_id: it.capture_id, code: 'nothing_to_capture' }); continue; }
      const w = window2s(round, ev.tick, tickrate);
      if (victim) windows.push({ capture_id: it.capture_id, role: 'victim_clip', player: victim, xray, round: it.round_number, ...w, event_tick: ev.tick, file: path.join(it.dir, 'victim.webm') });
      if (killer) kills.push({ it, killer, xray, tick: ev.tick });
    } else {
      const thrower = nameOf(ev.player);
      if (!thrower) { skipped.push({ capture_id: it.capture_id, code: 'nothing_to_capture' }); continue; }
      const center = ev.throw_tick != null ? ev.throw_tick : ev.tick;
      throws.push({ it, thrower, tick: center });
      if (ev.throw_tick != null) {
        const setup = it.setup || null;
        const tick = setup && setup.still_tick != null && setup.still_tick < ev.throw_tick ? setup.still_tick : ev.throw_tick - 1;
        lineups.push({ capture_id: it.capture_id, role: 'lineup', player: thrower, round: it.round_number, tick, release_tick: ev.throw_tick, setup, file: path.join(it.dir, 'lineup.jpg') });
      }
    }
  }
  const member = (x) => ({ capture_id: x.it.capture_id, round_number: x.it.round_number, event_index: x.it.event_index ?? null, event_tick: x.tick });
  const addGroup = (run, role, player, xray, name) => {
    const first = run[0];
    const w = window2s(first.it.round, first.tick, tickrate, run[run.length - 1].tick);
    const members = run.map(member);
    const groupInfo = run.length > 1 ? {
      id: `${role === 'replay' ? 'u' : 'k'}:${first.it.round_number}:${player}:${first.tick}`, kind: role === 'replay' ? 'utility' : 'kill', start: w.start, end: w.end, members,
    } : null;
    windows.push({
      capture_id: first.it.capture_id, role, player, xray, round: first.it.round_number, ...w, event_tick: first.tick,
      file: path.join(first.it.dir, name), group: groupInfo,
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

// Orders windows into segments for a schedule; lineups placed before the
// segment holding their capture's clip. Returns the steps to run.
function schedule(plan, mode = 'chronological') {
  if (!SCHEDULES.includes(mode)) throw new Error(`Unknown schedule ${mode}`);
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
  const s = { segments: 0, lineups: 0, outputs: 0, merged_outputs: 0, grouped_events: 0, pov_switches: 0, backward_seeks: 0, forward_seeks: 0, recorded_ticks: 0 };
  for (const st of steps) {
    const target = st.op === 'segment' ? st.start : st.tick;
    if (at != null) { if (target < at) s.backward_seeks += 1; else s.forward_seeks += 1; } else s.forward_seeks += 1;
    if (st.player !== pov) { s.pov_switches += pov == null ? 0 : 1; pov = st.player; }
    if (st.op === 'segment') {
      s.segments += 1;
      s.outputs += st.outputs.length;
      for (const o of st.outputs) s.grouped_events += o.copies && o.copies.length ? o.copies.length + 1 : 0;
      if (st.outputs.length > 1) s.merged_outputs += st.outputs.length;
      s.recorded_ticks += st.end - st.start;
      at = st.end;
    } else {
      s.lineups += 1;
      at = st.tick;
    }
  }
  return s;
}

module.exports = { SCHEDULES, GROUP_GAP_S, GROUP_SPAN_S, window2s, groupRuns, planWindows, schedule, scheduleStats };
