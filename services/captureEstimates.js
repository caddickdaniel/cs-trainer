// Capture time estimates shown to users, from measured runs on the capture
// machine (see README, Phase 12 benchmarks). `measured` is false until real
// benchmarks are recorded; the UI then says no estimate is available.
const BENCH = {
  measured: true,
  // Seconds, measured live on 17 Nov 2026 (RTX 4090) with the capture
  // profile (CS2 muted, -novid, 1280x720, low settings), 1x recording,
  // pasted console commands and the hybrid batch schedule (one recording per
  // POV for overlapping windows, POV-first seeks, no fixed waits). Sources:
  // tools/cs2-capture/bench14.py (round 3: 6 kills + 10 throws, 107 s) and
  // the website (round 17: 6 kills + 5 throws, 100 s of steps, 121 s total).
  // Per-event figures are fitted to those two rounds (within about 10%).
  cold_start: 10, // launch → main menu (5.9–10.4 s) → focused
  demo_load: 6, // playdemo → seekable (4.3–6.0 s, 253 MB demo)
  per_kill: 11, // killer + victim clips, no stills
  per_utility: 5.5, // clip + lineup still
  first_event_extra: 3, // the first event also sets up the view (hide demo bar etc.)
  close: 3, // restore settings and quit CS2 (2.8 s)
  // Recorded events in spirit-vs-g2-m3-ancient.dem (18 rounds), used for
  // full-match estimates before a demo is parsed. Full-match times are
  // ESTIMATES from the per-event sample, not a measured full-match run.
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
