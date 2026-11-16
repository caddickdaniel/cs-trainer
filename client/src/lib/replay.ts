// Replay helpers for Demo Review: playback clock and frame interpolation.
import type { Level } from './constants';
import type { EquipmentEntry, ReplayEvent, ReplayRound, StatTotals } from './types';

// A playback clock: position = anchorTick (+ elapsed since anchorAt while playing).
// anchorAt is in this browser's Date.now() time.
export interface Clock { playing: boolean; anchorTick: number; anchorAt: number; speed: number }

export function clockTick(clock: Clock, tickrate: number, now = Date.now(), min = -Infinity, max = Infinity) {
  let t = clock.anchorTick;
  if (clock.playing) t += ((now - clock.anchorAt) / 1000) * tickrate * clock.speed;
  return Math.min(max, Math.max(min, t));
}

export interface PlayerFrame { x: number; y: number; level: Level; yaw: number; hp: number; alive: boolean }

// Player state at a (fractional) tick, interpolated between samples. Angles
// take the short way round; death is never interpolated.
export function frameAt(round: ReplayRound, trackIndex: number, tick: number): PlayerFrame | null {
  const track = round.tracks[trackIndex];
  if (!track || !track.x.length) return null;
  const pos = (tick - round.first_tick) / round.step;
  const last = track.x.length - 1;
  const i0 = Math.max(0, Math.min(last, Math.floor(pos)));
  const i1 = Math.min(last, i0 + 1);
  const f = Math.max(0, Math.min(1, pos - i0));
  const hp = track.hp[i0];
  const alive = hp > 0;
  const lerp = (a: number, b: number) => a + (b - a) * (alive && track.hp[i1] > 0 ? f : 0);
  let dyaw = track.yaw[i1] - track.yaw[i0];
  if (dyaw > 180) dyaw -= 360;
  if (dyaw < -180) dyaw += 360;
  return {
    x: lerp(track.x[i0], track.x[i1]),
    y: lerp(track.y[i0], track.y[i1]),
    level: track.l[i0] ? 'lower' : 'main',
    yaw: track.yaw[i0] + dyaw * (alive ? f : 0),
    hp,
    alive,
  };
}

// Round clock text: time since the freeze time ended (or round start).
export function roundTime(round: { freeze_end_tick: number | null; start_tick: number }, tick: number, tickrate: number) {
  const zero = round.freeze_end_tick ?? round.start_tick;
  const s = Math.round((tick - zero) / tickrate);
  const sign = s < 0 ? '-' : '';
  const a = Math.abs(s);
  return `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}

// Recorded utility and bomb state at a tick, derived only from the round's
// events and the tick. Nothing accumulates between frames, so seeking,
// rewinding, switching rounds or joining a live review mid-way always shows
// exactly what was happening at that moment (no stale smokes or fires).
export const FLASH_SHOW_TICKS = 64; // flashes and HEs are instant; show them for ~1 s
export const BLAST_SHOW_TICKS = 48;
export interface RecordedState {
  smokes: ReplayEvent[];
  fires: ReplayEvent[];
  flashes: ReplayEvent[];
  hes: ReplayEvent[];
  bomb: { state: 'planted' | 'defused' | 'exploded'; event: ReplayEvent; plant?: ReplayEvent } | null;
}
export function recordedAt(events: ReplayEvent[], tick: number): RecordedState {
  const active = (e: ReplayEvent) => e.tick <= tick && tick < (e.end_tick ?? e.tick);
  const recent = (e: ReplayEvent, span: number) => e.tick <= tick && tick < e.tick + span;
  const plant = [...events].reverse().find((e) => e.type === 'plant' && e.tick <= tick);
  const after = plant ? events.find((e) => (e.type === 'defuse' || e.type === 'explode') && e.tick >= plant.tick && e.tick <= tick) : undefined;
  return {
    smokes: events.filter((e) => e.type === 'smoke' && active(e)),
    fires: events.filter((e) => e.type === 'fire' && active(e)),
    flashes: events.filter((e) => e.type === 'flash' && recent(e, FLASH_SHOW_TICKS)),
    hes: events.filter((e) => e.type === 'he' && recent(e, BLAST_SHOW_TICKS)),
    bomb: after ? { state: after.type === 'defuse' ? 'defused' : 'exploded', event: after, plant } : plant ? { state: 'planted', event: plant } : null,
  };
}

export const RECORDED_LABEL: Record<string, string> = {
  smoke: 'Smoke', flash: 'Flash', he: 'HE', fire: 'Molotov', plant: 'Bomb planted', defuse: 'Bomb defused', explode: 'Bomb exploded', kill: 'Kill', round_end: 'Round end',
};

// Grenades in the air at a tick: the recorded path from the throw up to this
// moment, split into runs per radar floor, and the projectile's current
// (interpolated) position. A grenade leaves this list at detonation, which
// clears its trail; its effect (smoke, fire, flash, HE) is in recordedAt.
// Derived from the tick alone, like recordedAt.
export interface TrailPoint { x: number; y: number; level: Level }
export interface Flight { event: ReplayEvent; runs: { level: Level; points: TrailPoint[] }[]; head: TrailPoint }
export function flightsAt(events: ReplayEvent[], tick: number): Flight[] {
  const out: Flight[] = [];
  for (const event of events) {
    const tr = event.trail;
    if (!tr || !tr.t.length || event.throw_tick == null || tick < event.throw_tick || tick >= event.tick) continue;
    const at = (i: number): TrailPoint => ({ x: tr.x[i], y: tr.y[i], level: tr.l[i] ? 'lower' : 'main' });
    let n = 0;
    while (n < tr.t.length && tr.t[n] <= tick) n += 1;
    if (!n) continue;
    const prev = at(n - 1);
    let head = prev;
    if (n < tr.t.length && tr.t[n] > tr.t[n - 1]) {
      const next = at(n);
      const f = (tick - tr.t[n - 1]) / (tr.t[n] - tr.t[n - 1]);
      head = { x: prev.x + (next.x - prev.x) * f, y: prev.y + (next.y - prev.y) * f, level: prev.level };
    }
    const runs: Flight['runs'] = [];
    for (let i = 0; i < n; i += 1) {
      const p = at(i);
      const run = runs[runs.length - 1];
      if (run && run.level === p.level) run.points.push(p);
      // A new floor starts where the old one ended, so the line stays joined.
      else runs.push({ level: p.level, points: run ? [run.points[run.points.length - 1], p] : [p] });
    }
    runs[runs.length - 1].points.push(head);
    out.push({ event, runs, head });
  }
  return out;
}

// Timeline icon rows: events close together are stacked in rows so each icon
// stays readable and clickable. `xs` are pixel positions in event order;
// returns the row of each (0 = top), never more than `maxRows` rows (the last
// row takes any overflow, which still keeps every event focusable).
export function timelineRows(xs: number[], gap: number, maxRows = 3): number[] {
  const lastX: number[] = [];
  return xs.map((x) => {
    let row = lastX.findIndex((l) => x - l >= gap);
    if (row === -1) row = lastX.length < maxRows ? lastX.length : maxRows - 1;
    lastX[row] = x;
    return row;
  });
}

// ---- HUD and scoreboard (replay version 4) ------------------------------------
// Everything below is derived from the round data and the tick alone, like
// recordedAt: seeking, rewinding, switching rounds or joining a live review
// mid-way shows exactly the state at that moment.

// CS2 competitive timings: 1:55 rounds, 40 s bomb timer.
export const ROUND_SECONDS = 115;
export const BOMB_SECONDS = 40;

// Equipment and money at a tick: the last change at or before it (or the
// first known state, for the moments before the first sample).
export function equipmentAt(round: ReplayRound, slot: number, tick: number): EquipmentEntry | null {
  const list = round.state?.[slot];
  if (!list || !list.length) return null;
  let lo = 0;
  let hi = list.length - 1;
  if (tick < list[0].t) return list[0];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid].t <= tick) lo = mid; else hi = mid - 1;
  }
  return list[lo];
}

// Scoreboard totals per roster slot at a tick (match so far), or null when
// the replay data predates the scoreboard.
export function totalsAt(round: ReplayRound, tick: number): StatTotals[] | null {
  if (!round.stats_before) return null;
  const totals = round.stats_before.map((t) => ({ ...t }));
  const slot = new Map(round.roster.map((p, i) => [p.player, i]));
  for (const e of round.stat_events ?? []) {
    if (e.tick > tick) break;
    const i = slot.get(e.player);
    if (i != null) totals[i][e.stat] += e.n;
  }
  return totals;
}
export const headshotPct = (t: StatTotals) => (t.kills ? Math.round((t.headshots / t.kills) * 100) : 0);

// How white a player's marker is at a tick: 1 at the flash, fading linearly
// to 0 over the recorded flash duration (the latest overlapping flash wins).
export function flashAmount(round: ReplayRound, player: number, tick: number): number {
  let best = 0;
  for (const f of round.flashes ?? []) {
    if (f.player !== player || f.tick > tick || f.duration <= 0) continue;
    const left = 1 - (tick - f.tick) / f.duration;
    if (left > best) best = left;
  }
  return Math.min(1, Math.max(0, best));
}

// Bomb countdown at a tick: the share of the 40 s left (1 at the plant), or
// null when no bomb is ticking (not planted, defused, exploded or round over).
export function bombAt(events: ReplayEvent[], tick: number, tickrate: number): { plant: ReplayEvent; left: number; secondsLeft: number } | null {
  const plant = [...events].reverse().find((e) => e.type === 'plant' && e.tick <= tick);
  if (!plant) return null;
  const over = events.some((e) => (e.type === 'defuse' || e.type === 'explode' || e.type === 'round_end') && e.tick >= plant.tick && e.tick <= tick);
  if (over) return null;
  const total = BOMB_SECONDS * tickrate;
  const elapsed = tick - plant.tick;
  if (elapsed >= total) return null;
  return { plant, left: 1 - elapsed / total, secondsLeft: (total - elapsed) / tickrate };
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// The in-game round clock: freeze time counting down, then 1:55 counting
// down; 'bomb' once the bomb is planted (the HUD shows the bomb instead);
// 'over' after the round result.
export function hudClock(info: { start_tick: number; freeze_end_tick: number | null }, events: ReplayEvent[], tick: number, tickrate: number):
  { kind: 'freeze' | 'live'; text: string } | { kind: 'bomb' | 'over'; text: string } {
  const end = events.find((e) => e.type === 'round_end');
  if (end && tick >= end.tick) return { kind: 'over', text: 'Round over' };
  if (events.some((e) => e.type === 'plant' && e.tick <= tick)) return { kind: 'bomb', text: 'Bomb planted' };
  if (info.freeze_end_tick != null && tick < info.freeze_end_tick) return { kind: 'freeze', text: mmss(Math.ceil((info.freeze_end_tick - tick) / tickrate)) };
  const zero = info.freeze_end_tick ?? info.start_tick;
  return { kind: 'live', text: mmss(Math.max(0, Math.ceil(ROUND_SECONDS - (tick - zero) / tickrate))) };
}

// Score shown in the HUD: before the round until its result, then after it.
export function hudScore(round: ReplayRound, tick: number): { ct: number; t: number } | null {
  const end = round.events.find((e) => e.type === 'round_end');
  if (end && tick >= end.tick && round.ct_score != null && round.t_score != null) return { ct: round.ct_score, t: round.t_score };
  return round.score_before ?? null;
}

// Playback position text for the controls (elapsed / total since freeze end),
// distinct from the in-game round clock.
export function playbackText(info: { start_tick: number; freeze_end_tick: number | null; end_tick: number }, tick: number, tickrate: number) {
  const zero = info.freeze_end_tick ?? info.start_tick;
  const fmt = (t: number) => { const s = Math.round((t - zero) / tickrate); return `${s < 0 ? '-' : ''}${mmss(Math.abs(s))}`; };
  return `${fmt(tick)} / ${fmt(info.end_tick)}`;
}

// ---- Kill feed and bomb detonation (replay version 5) ---------------------------
// Like everything above, derived from the round data and the tick alone.

// CS2's death notice lifetime and fade (huddeathnotice.vcss: DeathNoticeLifetime
// 5.0, DeathNoticeFadeOutTime 1.0s).
export const KILLFEED_LIFETIME = 5;
export const KILLFEED_FADE = 1;
export interface KillFeedEntry { event: ReplayEvent; index: number; opacity: number }
// Kills shown at a tick: those within the lifetime, oldest first (CS2 adds new
// notices at the bottom), fading over the last second. Multiple kills on the
// same tick keep their recorded order.
export function killFeedAt(events: ReplayEvent[], tick: number, tickrate: number, lifetime = KILLFEED_LIFETIME): KillFeedEntry[] {
  const out: KillFeedEntry[] = [];
  events.forEach((event, index) => {
    if (event.type !== 'kill' || event.tick > tick) return;
    const age = (tick - event.tick) / tickrate;
    if (age >= lifetime) return;
    const opacity = age <= lifetime - KILLFEED_FADE ? 1 : Math.max(0, (lifetime - age) / KILLFEED_FADE);
    out.push({ event, index, opacity });
  });
  return out;
}

// Detonation: the recorded bomb_exploded event is authoritative (never the
// countdown reaching zero). Placed where the bomb was planted.
export const SHOCKWAVE_SECONDS = 1.5;
export interface Detonation { event: ReplayEvent; x: number; y: number; level: string; elapsed: number }
export function detonationAt(events: ReplayEvent[], tick: number, tickrate: number): Detonation | null {
  const ex = [...events].reverse().find((e) => e.type === 'explode' && e.tick <= tick);
  if (!ex || ex.x == null || ex.y == null) return null;
  return { event: ex, x: ex.x, y: ex.y, level: ex.level ?? 'main', elapsed: (tick - ex.tick) / tickrate };
}
// Shockwave stages over 1.5 s of demo time: flash (0-0.2 s), expansion
// (0.2-1.0 s), dissipation (1.0-1.5 s). Returns null outside the animation.
export function shockwaveFrame(elapsed: number) {
  if (elapsed < 0 || elapsed >= SHOCKWAVE_SECONDS) return null;
  const grow = Math.min(1, elapsed / 1.0);
  const ease = 1 - (1 - grow) ** 3;
  return {
    flash: elapsed < 0.2 ? 1 - elapsed / 0.2 : 0,
    ring: ease, // 0..1 of the maximum radius
    ringOpacity: elapsed < 1.0 ? 0.9 - 0.5 * grow : 0.4 * (1 - (elapsed - 1.0) / 0.5),
    secondRing: elapsed > 0.15 ? Math.min(1, (elapsed - 0.15) / 1.0) : 0,
  };
}

// Estimated bomb damage (analysis aid, NOT what the game computed): the CS:GO
// formula, 500 damage with a Gaussian falloff (sigma = radius / 3) over a
// 1750-unit radius, unarmoured. CS2 maps can set other bomb damage, and cover
// matters, so recorded bomb damage (bomb_damage) is always shown separately.
export const BOMB_ESTIMATE = { damage: 500, radius: 1750 };
export const estimatedBombDamage = (distanceUnits: number) =>
  BOMB_ESTIMATE.damage * Math.exp(-(distanceUnits ** 2) / (2 * (BOMB_ESTIMATE.radius / 3) ** 2));
// Radius (in game units) at which the estimate falls to `damage`.
export const estimatedRadiusFor = (damage: number) => (BOMB_ESTIMATE.radius / 3) * Math.sqrt(2 * Math.log(BOMB_ESTIMATE.damage / damage));

// Recorded bomb damage that has happened by this tick (players hurt or killed by the explosion).
export const bombDamageAt = (round: ReplayRound, tick: number) => (round.bomb_damage ?? []).filter((d) => d.tick <= tick);

// CS2 competitive/Premier scoreboard order (scoreboard.js sortOrder_tmm):
// damage, kills, assists (all highest first), then fewest deaths.
export function scoreboardOrder(a: StatTotals, b: StatTotals) {
  return b.damage - a.damage || b.kills - a.kills || b.assists - a.assists || a.deaths - b.deaths;
}
