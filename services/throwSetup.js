// Lineup still timing (Phase 15): the frame a lineup still shows is the
// player's stable aim before the throw's setup movement starts. A still on
// the tick before release can already be mid-jump or mid-run, which makes
// the lineup hard to reproduce, so the demo's per-tick samples (position,
// velocity and buttons from workers/demo-throws-child.js) are read
// backwards from the release:
// - stationary throw: still and on the ground at release -> the tick before
//   release (aim and position match the throw);
// - jump / run / run-jump: the contiguous movement leading into the release
//   is the setup; the still is the tick before it starts, provided the
//   player was standing still there (STILL_TICKS in a row);
// - otherwise (moving for the whole look-back, no still moment) there is no
//   reliable setup frame: the tick before release is kept and the result
//   says so (reliable: false, reason).
const JUMP = 2; // usercmd IN_JUMP
const STILL_SPEED = 20; // units/s on the ground counts as standing (aim jiggle)
const AIR_VZ = 60; // vertical speed above this is a jump / fall, not a slope
const STILL_TICKS = 6; // standing at least this long before the setup
const LOOKBACK_S = 3; // how far back a setup may start
const RUN_SPEED = 100; // horizontal speed at release that makes it a running throw

const speedOf = (s) => Math.hypot(s.vx || 0, s.vy || 0);
const airborne = (s) => Math.abs(s.vz || 0) > AIR_VZ;
const isStill = (s) => s && speedOf(s) < STILL_SPEED && !airborne(s) && !((s.buttons || 0) & JUMP);

// samples: per tick (any order) { tick, x, y, z, vx, vy, vz, buttons }.
function analyse(samples, release, tickrate = 64) {
  const at = new Map(samples.filter((s) => s && s.tick != null).map((s) => [s.tick, s]));
  const fallback = (reason, extra = {}) => ({ release_tick: release, still_tick: release - 1, setup_start: null, technique: 'unknown', reliable: false, reason, ...extra });
  const rel = at.get(release) || at.get(release - 1);
  if (!rel) return fallback('no_samples');
  const lookback = Math.round(LOOKBACK_S * tickrate);
  // Movement in the last few ticks before release decides the technique.
  const window = [];
  for (let t = release - Math.round(tickrate * 0.4); t <= release; t += 1) if (at.has(t)) window.push(at.get(t));
  const jumped = window.some((s) => airborne(s) || ((s.buttons || 0) & JUMP));
  const running = speedOf(rel) >= RUN_SPEED;
  const technique = jumped ? (running ? 'run-jump' : 'jump') : running ? 'run' : speedOf(rel) >= STILL_SPEED ? 'walk' : 'stationary';
  if (technique === 'stationary') {
    let still = 0;
    for (let t = release - 1; t >= release - STILL_TICKS && isStill(at.get(t)); t -= 1) still += 1;
    const pos = { x: rel.x, y: rel.y, z: rel.z };
    return {
      release_tick: release, still_tick: release - 1, setup_start: release, technique, reliable: still >= STILL_TICKS, reason: still >= STILL_TICKS ? null : 'moving_before_throw',
      setup_ticks: 0, start_pos: pos, release_pos: pos,
    };
  }
  // Walk back through the setup movement to the last still moment.
  let t = release;
  while (t > release - lookback) {
    const s = at.get(t - 1);
    if (!s) return fallback('no_samples', { technique });
    if (isStill(s)) break;
    t -= 1;
  }
  if (t <= release - lookback) return fallback('moving_before_throw', { technique });
  for (let k = 1; k <= STILL_TICKS; k += 1) {
    if (!isStill(at.get(t - k))) return fallback('no_still_moment', { technique, setup_start: t });
  }
  const start = at.get(t - 1);
  return {
    release_tick: release, still_tick: t - 1, setup_start: t, technique, reliable: true, reason: null,
    setup_ticks: release - t, start_pos: { x: start.x, y: start.y, z: start.z }, release_pos: { x: rel.x, y: rel.y, z: rel.z },
  };
}

// Human-readable note for the inspector.
function describe(r) {
  if (!r) return null;
  const tech = { stationary: 'standing throw', jump: 'jump throw', 'run-jump': 'run-jump throw', run: 'running throw', walk: 'walking throw', unknown: 'throw' }[r.technique] || 'throw';
  if (r.reliable) return r.technique === 'stationary' ? `Aim on the tick before release (${tech}).` : `Aim before the ${tech} setup starts (${r.release_tick - r.still_tick} ticks before release).`;
  return `No still aiming moment found before this ${tech}: the still is the tick before release and may show the setup movement.`;
}

module.exports = { analyse, describe, JUMP, STILL_SPEED, AIR_VZ, STILL_TICKS, LOOKBACK_S };
