// Capture time estimates shown to users, from measured runs on the capture
// machine (see README, Phase 16 benchmarks). `measured` is false until real
// benchmarks are recorded; the UI then says no estimate is available.
const BENCH = {
  measured: true,
  // Seconds, measured live on 17 Nov 2026 (RTX 4090) with the capture
  // profile (CS2 muted, -novid, 1280x720, low settings), pasted console
  // commands and the Phase 16 match_player schedule (one pass per player
  // over the whole match, lineup stills taken from the recording, kill clips
  // at 2x with a 1x fallback). Source: a full-match run of
  // spirit-vs-g2-m3-ancient.dem (131 kills + 391 throws, all 522 captured:
  // 2,229 s wall, 2,177 s of capture steps; scripts/bench-capture-session.js).
  // per_kill / per_utility split those measured steps by the planner's cost
  // model (kills-only and utility-only runs are ESTIMATES from that split,
  // not separately measured).
  cold_start: 10, // launch → main menu (6.9–9.1 s) → focused
  demo_load: 6, // playdemo → seekable (4.4–7.2 s, 253 MB demo)
  per_kill: 5.6, // killer + victim clips (recorded in each player's pass)
  per_utility: 3.7, // clip + lineup still from the same recording
  first_event_extra: 3, // the first event also sets up the view (hide demo bar etc.)
  close: 3, // restore settings and quit CS2 (1.4–2.7 s)
  // Recorded events in spirit-vs-g2-m3-ancient.dem (18 rounds), used for
  // full-match estimates before a demo is parsed.
  typical_kills: 131,
  typical_utility: 391,
  measured_on: '2026-11-17',
};

function forCounts(kills, utility) {
  if (!BENCH.measured) return null;
  if (!kills && !utility) return 0;
  return Math.round(BENCH.cold_start + BENCH.demo_load + BENCH.first_event_extra + kills * BENCH.per_kill + utility * BENCH.per_utility + BENCH.close);
}

function summary() {
  if (!BENCH.measured) return { measured: false };
  return {
    measured: true,
    ...BENCH,
    options: {
      all: forCounts(BENCH.typical_kills, BENCH.typical_utility),
      kill: forCounts(BENCH.typical_kills, 0),
      utility: forCounts(0, BENCH.typical_utility),
    },
  };
}

module.exports = { BENCH, summary, forCounts };
