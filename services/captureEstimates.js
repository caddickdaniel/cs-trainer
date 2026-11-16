// Capture time estimates shown to users, from measured runs on the capture
// machine (see README, Phase 12 benchmarks). `measured` is false until real
// benchmarks are recorded; the UI then says no estimate is available.
const BENCH = {
  measured: true,
  // Seconds, measured 16 Nov 2026 on the capture PC (RTX 4090, CS2 in a
  // 1280x720 window with the player's own quality settings, clips at 1x) with
  // spirit-vs-g2-m3-ancient.dem: tools/cs2-capture/bench.py, variant "final".
  cold_start: 8, // launch → main menu → focused (7.1 s; up to ~55 s when CS2 rebuilds shaders)
  demo_load: 19, // playdemo → seekable (18.9 s for a 253 MB demo)
  per_kill: 26, // killer + victim clips and stills (25.0–27.1 s; 35 s in dense smoke)
  per_utility: 13.5, // clip + lineup (12.8–14.7 s)
  close: 4, // restore settings and quit CS2 (3.8 s)
  // Recorded events in that demo (18 rounds): used for full-match estimates
  // before the demo is parsed; afterwards the real counts are used.
  typical_kills: 131,
  typical_utility: 391,
  measured_on: '2026-11-16',
};

function forCounts(kills, utility) {
  if (!BENCH.measured) return null;
  return Math.round(BENCH.cold_start + BENCH.demo_load + kills * BENCH.per_kill + utility * BENCH.per_utility + BENCH.close);
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
