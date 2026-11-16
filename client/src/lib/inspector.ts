// Replay Inspector (Phase 11): which events can be inspected, navigation
// between them, and the tactical data derived from the replay for a kill or a
// utility throw. Everything comes from recorded demo data; nothing here is a
// first-person image. Pure (type imports only) so the server tests can load it.
import type { PlayerFrame } from './replay';
import type { ReplayEvent, ReplayRound } from './types';

// Frame lookup (lib/replay frameAt), passed in so this module stays type-only.
export type FrameAt = (round: ReplayRound, slot: number, tick: number) => PlayerFrame | null;

export type InspectFilter = 'all' | 'kill' | 'utility';
const UTILITY: ReplayEvent['type'][] = ['smoke', 'flash', 'he', 'fire'];
export const isKill = (e: ReplayEvent) => e.type === 'kill';
// A utility event is inspectable when its thrower is known.
export const isUtility = (e: ReplayEvent) => UTILITY.includes(e.type) && e.player != null;
export const inspectable = (e: ReplayEvent, filter: InspectFilter = 'all') =>
  (filter === 'kill' ? isKill(e) : filter === 'utility' ? isUtility(e) : isKill(e) || isUtility(e));

// The moment an event is about: a kill's tick; a utility's release (throw)
// tick when the projectile was linked to its detonation, else the detonation.
export const eventMoment = (e: ReplayEvent) => (isUtility(e) && e.throw_tick != null ? e.throw_tick : e.tick);

// Indexes of inspectable events in a round, in chronological order of their moment.
export function inspectableIndexes(events: ReplayEvent[], filter: InspectFilter = 'all') {
  return events.map((e, i) => ({ e, i })).filter(({ e }) => inspectable(e, filter))
    .sort((a, b) => eventMoment(a.e) - eventMoment(b.e) || a.i - b.i).map(({ i }) => i);
}
// The next / previous inspectable event in the round, or null at either end.
export function neighbourIndex(events: ReplayEvent[], index: number, dir: 1 | -1, filter: InspectFilter = 'all') {
  const list = inspectableIndexes(events, filter);
  const at = list.indexOf(index);
  if (at === -1) {
    // Not in the filtered list: the nearest one after / before its moment.
    const m = events[index] ? eventMoment(events[index]) : 0;
    const pick = dir === 1 ? list.find((i) => eventMoment(events[i]) > m) : [...list].reverse().find((i) => eventMoment(events[i]) < m);
    return pick ?? null;
  }
  return list[at + dir] ?? null;
}

const slotOf = (round: ReplayRound, player: number | null | undefined) => (player == null ? -1 : round.roster.findIndex((r) => r.player === player));
const sampleTick = (round: ReplayRound, i: number) => round.first_tick + i * round.step;

// The victim's last recorded moment alive before the kill (positions are
// sampled every `step` ticks), so a pre-death view is never labelled as the
// death frame. Null when the victim has no alive sample before the kill.
export function victimLastAliveTick(round: ReplayRound, victim: number | null | undefined, killTick: number): number | null {
  const slot = slotOf(round, victim);
  const track = round.tracks[slot];
  if (!track) return null;
  for (let i = Math.min(track.hp.length - 1, Math.floor((killTick - round.first_tick) / round.step)); i >= 0; i -= 1) {
    const t = sampleTick(round, i);
    if (t < killTick && track.hp[i] > 0) return t;
  }
  return null;
}

// Angle in degrees from a yaw to the bearing towards a target, wrapped to
// -180..180. Radar y grows downwards, game y upwards, so dy is flipped.
const bearing = (from: { x: number; y: number }, to: { x: number; y: number }) => (Math.atan2(-(to.y - from.y), to.x - from.x) * 180) / Math.PI;
const wrap = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;
export const FACING_DEGREES = 30;

export interface PlayerAt { player: number; tick: number; x: number; y: number; level: string; yaw: number; hp: number }
export interface KillTactics {
  killer: PlayerAt | null;
  victim: PlayerAt | null;
  // Victim view: the last alive sample before death (not the death frame).
  victimTick: number | null;
  distanceUnits: number | null;
  sameFloor: boolean | null;
  // Degrees between where each was facing and the direction to the other
  // (0 = facing straight at them). Facing is not visibility: walls, smoke and
  // cover aren't accounted for.
  killerFacingOff: number | null;
  victimFacingOff: number | null;
}
function playerAt(frameAt: FrameAt, round: ReplayRound, player: number | null | undefined, tick: number): PlayerAt | null {
  const slot = slotOf(round, player);
  if (slot < 0 || player == null) return null;
  const f = frameAt(round, slot, tick);
  if (!f || (f.x === 0 && f.y === 0)) return null;
  return { player, tick, x: f.x, y: f.y, level: f.level, yaw: f.yaw, hp: f.hp };
}
export function killTactics(round: ReplayRound, kill: ReplayEvent, frameAt: FrameAt): KillTactics {
  const victimTick = victimLastAliveTick(round, kill.victim, kill.tick);
  const killer = playerAt(frameAt, round, kill.attacker, kill.tick);
  const victim = victimTick != null ? playerAt(frameAt, round, kill.victim, victimTick) : null;
  const both = killer && victim;
  const units = round.units_per_radar ?? null;
  return {
    killer, victim, victimTick,
    distanceUnits: both && units ? Math.round(Math.hypot(victim.x - killer.x, victim.y - killer.y) * units) : null,
    sameFloor: both ? killer.level === victim.level : null,
    killerFacingOff: both ? Math.round(Math.abs(wrap(killer.yaw - bearing(killer, victim)))) : null,
    victimFacingOff: both ? Math.round(Math.abs(wrap(victim.yaw - bearing(victim, killer)))) : null,
  };
}

export interface UtilityTactics {
  thrower: number | null;
  releaseTick: number | null;
  // Seconds from release to detonation (from the linked projectile).
  flightSeconds: number | null;
  from: { x: number; y: number; level: string } | null;
  landed: { x: number; y: number; level: string } | null;
  throwDistanceUnits: number | null;
  linked: boolean;
}
export function utilityTactics(round: ReplayRound, ev: ReplayEvent, tickrate: number): UtilityTactics {
  const linked = ev.throw_tick != null;
  const from = ev.from ?? null;
  const landed = ev.x != null && ev.y != null ? { x: ev.x, y: ev.y, level: ev.level ?? 'main' } : null;
  const units = round.units_per_radar ?? null;
  return {
    thrower: ev.player ?? null,
    releaseTick: ev.throw_tick ?? null,
    flightSeconds: linked ? Math.max(0, (ev.tick - ev.throw_tick!) / tickrate) : null,
    from, landed, linked,
    throwDistanceUnits: from && landed && units ? Math.round(Math.hypot(landed.x - from.x, landed.y - from.y) * units) : null,
  };
}

// Frame-step sizes for the inspector, in ticks for the demo's tick rate.
export const STEP_SECONDS = [0.1, 0.25, 0.5] as const;
export const stepTicks = (seconds: number, tickrate: number) => Math.max(1, Math.round(seconds * tickrate));

// Export / capture file names: map, round, event, player, tick; safe characters only.
export function mediaFileName(parts: { map: string | null; round: number; kind: string; player: string | null; tick: number; ext: string }) {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x';
  return `${clean(parts.map ?? 'map')}_r${parts.round}_${clean(parts.kind)}_${clean(parts.player ?? 'player')}_t${parts.tick}.${parts.ext.replace(/[^a-z0-9]/g, '')}`;
}
