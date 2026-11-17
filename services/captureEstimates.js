// Capture time estimates shown to users, from measured runs on the capture
// machine (see README, Phase 12 benchmarks). `measured` is false until real
// benchmarks are recorded; the UI then says no estimate is available.
const BENCH = {
  measured: true,
  // Seconds, measured live on 16 Nov 2026 (RTX 4090) with the capture
  // profile: CS2 muted (-nosound, -novid) in a 1280x720 window with low
  // settings, clips recorded at 1x (faster recording dropped key frames),
  // verified seeks. Sources: tools/cs2-capture/bench13.py and website runs.
  cold_start: 11, // launch → main menu (8.6–11.4 s) → focused (+0–1 s)
  demo_load: 19, // playdemo → seekable (18.4–19.6 s, 253 MB demo)
  per_kill: 26.5, // killer + victim clips and stills (26.3–28.1 s; ~35 s in dense smoke)
  per_utility: 13.5, // clip + lineup (13.0–14.1 s)
  first_event_extra: 6, // the first event also sets up the view (hide demo bar etc.)
  close: 4, // restore settings and quit CS2 (3.4–5.0 s)
  // Recorded events in spirit-vs-g2-m3-ancient.dem (18 rounds), used for
  // full-match estimates before a demo is parsed. Full-match times are
  // ESTIMATES from the per-event sample, not a measured full-match run.
  typical_kills: 131,
  typical_utility: 391,
  measured_on: '2026-11-16',
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
