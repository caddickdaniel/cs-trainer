// Lineup catalogue (Phase 15) for the tactics editor's lineup picker.
//
// Each entry links to one specific lineup on CSNADES.gg (attributed; the
// link opens the exact throw there). Nothing from CSNADES is copied: no
// screenshots, videos or throw instructions. Bulk import waits for CSNADES
// to confirm usage. This first set is a small, manually supplied test set:
// - url / title: the CSNADES entry, checked by hand on 17 Nov 2026;
// - start / release / landing: radar positions (0..1 on the map's radar,
//   like the tactics board) measured from real throws of that lineup in a
//   pro demo (spirit-vs-g2-m3-ancient, via services/throwSetup.js), not
//   taken from CSNADES;
// - technique / movement: how the measured throw was made, in our words.
// Running and run-jump throws have a release point separate from the start.
//
// The catalogue covers every Active Duty and Reserve map the app supports
// (entries are added per map); maps without entries return none.
const C = require('./constants');

const SOURCE = 'CSNADES.gg';
const ORIGIN = 'https://csnades.gg/';

const ENTRIES = [
  {
    id: 'ancient-t-smoke-top-mid-t-spawn',
    map: 'de_ancient', level: 'main', utility: 'smoke', side: 'T',
    title: 'Top Mid from T Spawn',
    technique: 'jump',
    instructions: 'Stand at the spawn position, aim, then jump and throw at the top of the jump (jump throw). No run-up.',
    start: { x: 0.5127, y: 0.8695 }, release: { x: 0.5127, y: 0.8695 }, landing: { x: 0.4757, y: 0.3822 },
    url: 'https://csnades.gg/ancient/smokes/top-mid-from-t-spawn',
    measured: 'HeavyGod, rounds 5, 8, 10 and 11',
  },
  {
    id: 'ancient-t-smoke-top-mid-t-spawn-1',
    map: 'de_ancient', level: 'main', utility: 'smoke', side: 'T',
    title: 'Top Mid from T Spawn 1',
    technique: 'run-jump',
    instructions: 'Aim from the start position, run forward, then jump and throw while still running (run-jump throw). The grenade leaves at the release point.',
    start: { x: 0.4424, y: 0.9045 }, release: { x: 0.441, y: 0.883 }, landing: { x: 0.4195, y: 0.4459 },
    url: 'https://csnades.gg/ancient/smokes/top-mid-from-t-spawn-1',
    measured: 'r1nkle, round 8',
  },
  {
    id: 'ancient-ct-smoke-elbow-ct-spawn',
    map: 'de_ancient', level: 'main', utility: 'smoke', side: 'CT',
    title: 'Elbow from CT Spawn',
    technique: 'jump',
    instructions: 'Stand at the spawn position, aim, then jump and throw (jump throw). No run-up.',
    start: { x: 0.5392, y: 0.0916 }, release: { x: 0.5392, y: 0.0916 }, landing: { x: 0.3579, y: 0.5935 },
    url: 'https://csnades.gg/ancient/smokes/elbow-from-ct-spawn',
    measured: 'sh1ro, rounds 4, 6 and 11',
  },
];

const MOVING = new Set(['run', 'run-jump', 'walk']);

// Entries for a map (optionally one utility type, side and floor).
function list({ map, utility = null, side = null, level = null } = {}) {
  return ENTRIES.filter((e) => e.map === map && (!utility || e.utility === utility) && (!side || e.side === side) && (!level || e.level === level))
    .map((e) => ({ ...e, source: SOURCE, moving: MOVING.has(e.technique) }));
}

// Entries whose landing is within `tolerance` (a fraction of the radar
// width) of the clicked point, nearest first.
function near(point, opts, tolerance = 0.05) {
  return list(opts)
    .map((e) => ({ e, d: Math.hypot(e.landing.x - point.x, e.landing.y - point.y) }))
    .filter((x) => x.d <= tolerance)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.e);
}

const isCatalogueUrl = (url) => typeof url === 'string' && url.startsWith(ORIGIN);

module.exports = { SOURCE, ORIGIN, ENTRIES, MOVING, list, near, isCatalogueUrl, MAPS: C.MAPS };
