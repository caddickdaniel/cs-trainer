// Capture planning (Phase 14), built from parsed events before CS2 starts.
//
// Every requested output becomes a window: a POV and demo ticks to record.
// - Kill: the killer's and the victim's view, one second either side of the
//   kill (tick rate from the demo), clamped to the round. No stills.
// - Utility: the thrower's view one second either side of the release (the
//   detonation if the release isn't linked), plus a lineup still the tick
//   before release.
// Flash-affected and through-smoke kills record with spectator X-ray on.
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

function window2s(round, tick, tickrate) {
  const lo = round.start_tick ?? round.first_tick;
  const hi = round.end_tick ?? Number.MAX_SAFE_INTEGER;
  return { start: Math.max(lo, Math.round(tick - tickrate)), end: Math.min(hi, Math.round(tick + tickrate)) };
}

// items: [{ capture_id, kind, round_number, round, ev, dir }]
function planWindows(demo, items) {
  const players = (demo.meta && demo.meta.players) || [];
  const nameOf = (i) => (i == null ? null : (players.find((p) => p.index === i) || {}).name || null);
  const tickrate = demo.tickrate || 64;
  const windows = [];
  const lineups = [];
  const skipped = [];
  for (const it of items) {
    const { ev, round } = it;
    if (!ev || !round) { skipped.push({ capture_id: it.capture_id, code: 'event_missing' }); continue; }
    if (it.kind === 'kill') {
      const w = window2s(round, ev.tick, tickrate);
      const xray = !!(ev.attacker_blind || ev.flash_assist || ev.through_smoke);
      const killer = ev.attacker != null && ev.attacker !== ev.victim ? nameOf(ev.attacker) : null;
      const victim = nameOf(ev.victim);
      if (!killer && !victim) { skipped.push({ capture_id: it.capture_id, code: 'nothing_to_capture' }); continue; }
      if (killer) windows.push({ capture_id: it.capture_id, role: 'killer_clip', player: killer, xray, round: it.round_number, ...w, event_tick: ev.tick, file: path.join(it.dir, 'killer.webm') });
      if (victim) windows.push({ capture_id: it.capture_id, role: 'victim_clip', player: victim, xray, round: it.round_number, ...w, event_tick: ev.tick, file: path.join(it.dir, 'victim.webm') });
    } else {
      const thrower = nameOf(ev.player);
      if (!thrower) { skipped.push({ capture_id: it.capture_id, code: 'nothing_to_capture' }); continue; }
      const center = ev.throw_tick != null ? ev.throw_tick : ev.tick;
      const w = window2s(round, center, tickrate);
      windows.push({ capture_id: it.capture_id, role: 'replay', player: thrower, xray: false, round: it.round_number, ...w, event_tick: center, file: path.join(it.dir, 'replay.webm') });
      if (ev.throw_tick != null) lineups.push({ capture_id: it.capture_id, role: 'lineup', player: thrower, round: it.round_number, tick: ev.throw_tick - 1, file: path.join(it.dir, 'lineup.jpg') });
    }
  }
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
      const l = lineups.find((x) => x.capture_id === o.capture_id && !placed.has(x));
      if (l && o.role === 'replay') { steps.push({ op: 'lineup', ...l }); placed.add(l); }
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
  const s = { segments: 0, lineups: 0, outputs: 0, merged_outputs: 0, pov_switches: 0, backward_seeks: 0, forward_seeks: 0, recorded_ticks: 0 };
  for (const st of steps) {
    const target = st.op === 'segment' ? st.start : st.tick;
    if (at != null) { if (target < at) s.backward_seeks += 1; else s.forward_seeks += 1; } else s.forward_seeks += 1;
    if (st.player !== pov) { s.pov_switches += pov == null ? 0 : 1; pov = st.player; }
    if (st.op === 'segment') {
      s.segments += 1;
      s.outputs += st.outputs.length;
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

module.exports = { SCHEDULES, window2s, planWindows, schedule, scheduleStats };
