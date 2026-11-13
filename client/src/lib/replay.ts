// Replay helpers for Demo Review: playback clock and frame interpolation.
import type { Level } from './constants';
import type { ReplayEvent, ReplayRound } from './types';

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
