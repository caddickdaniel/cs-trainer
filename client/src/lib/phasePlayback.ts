// Play Phase (Phase 14): a preview of one tactic phase from its saved state.
// Players with drawn routes move from their marker through the route at a
// CS2-like running pace scaled to the map's radar; players without routes
// stay put. Each player's throws, drops and pickups then run in that
// player's order, one after another with a 0.5 s gap, independently of the
// other players (a pickup waits for its drop). Pure (type imports only): the
// saved board is never changed, and the same phase always plays the same way.
import type { Board, BoardAction, GrenadeCounts, Marker, Point } from './types';
import type { Grenade, Step } from './utility';

// lib/utility phaseSteps, passed in so this module stays type-only (tests).
export type StepsOf = (board: Board, seenMarkers: Set<string>) => Step[];
const refKey = (r: { user_id: number | null; slot?: number | null }) => (r.user_id != null ? `u${r.user_id}` : r.slot ? `s${r.slot}` : null);

// World units per radar pixel (1024 px radar = the whole board), from
// domain/constants RADAR_TRANSFORMS; maps without a radar use 5.
const RADAR_SCALE: Record<string, number> = {
  de_ancient: 5, de_anubis: 5.22, de_cache: 5.5, de_dust2: 4.4, de_inferno: 4.9, de_mirage: 5,
  de_nuke: 7, de_overpass: 5.2, de_train: 4.082077, de_vertigo: 4,
};
export const RUN_SPEED = 230; // units/s, a rifle carrier running (knife 250)
export const GRENADE_SPEED = 750; // units/s along the drawn throw path
export const GAP_S = 0.5; // between one player's actions
export const ACTION_S = 0.4; // a drop or pickup
const unitsPerBoard = (map: string) => 1024 * (RADAR_SCALE[map] ?? 5);

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const length = (pts: Point[]) => pts.slice(1).reduce((n, p, i) => n + dist(pts[i], p), 0);
// The point a given distance along a polyline.
function along(pts: Point[], d: number): Point {
  if (pts.length === 1 || d <= 0) return pts[0];
  let left = d;
  for (let i = 1; i < pts.length; i += 1) {
    const seg = dist(pts[i - 1], pts[i]);
    if (left <= seg) {
      const f = seg ? left / seg : 1;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f };
    }
    left -= seg;
  }
  return pts[pts.length - 1];
}

export interface Timed { step: Step; start: number; end: number; path?: Point[] }
export interface Timeline {
  duration: number;
  moves: Map<string, { markerId: string; path: Point[]; end: number }>;
  steps: Timed[];
  // Utility markers already thrown in earlier phases (always shown).
  earlier: Set<string>;
}

// Builds the phase's timeline. `earlierMarkerIds`: utility markers seen in
// earlier phases (a marker kept on the board is one throw, made earlier).
export function phaseTimeline(board: Board, map: string, phaseSteps: StepsOf, earlierMarkerIds: Set<string> = new Set()): Timeline {
  const scale = unitsPerBoard(map);
  const moves = new Map<string, { markerId: string; path: Point[]; end: number }>();
  for (const m of board.markers.filter((x) => x.kind === 'player')) {
    const key = refKey(m);
    if (!key || moves.has(key)) continue;
    const routes = board.routes.filter((r) => refKey(r) === key && r.points.length >= 2 && (r.level ?? 'main') === (m.level ?? 'main'));
    const path: Point[] = [{ x: m.x, y: m.y }, ...routes.flatMap((r) => r.points)];
    moves.set(key, { markerId: m.id, path, end: routes.length ? (length(path) * scale) / RUN_SPEED : 0 });
  }
  const steps = phaseSteps(board, new Set(earlierMarkerIds));
  const nextFree = new Map<string, number>();
  const dropEnd = new Map<string, number>();
  const timed: Timed[] = [];
  // Drops first in each step position so a same-phase pickup can wait on it.
  for (const s of steps) {
    let start = nextFree.get(s.key) ?? (moves.get(s.key)?.end ?? 0);
    let end = start + ACTION_S;
    let path: Point[] | undefined;
    if (s.type === 'throw') {
      const m = board.markers.find((x) => x.id === s.id)!;
      const mv = moves.get(s.key);
      const from = mv ? mv.path[mv.path.length - 1] : null;
      path = [...(from ? [from] : []), ...(m.path ?? []), { x: m.x, y: m.y }];
      const flight = Math.min(2.2, Math.max(0.5, (length(path) * scale) / GRENADE_SPEED));
      end = start + flight;
    } else if (s.type === 'pickup' && s.drop_id && dropEnd.has(s.drop_id)) {
      start = Math.max(start, dropEnd.get(s.drop_id)!);
      end = start + ACTION_S;
    }
    if (s.type === 'drop') dropEnd.set(s.id, end);
    timed.push({ step: s, start, end, path });
    nextFree.set(s.key, end + GAP_S);
  }
  const moveEnd = Math.max(0, ...[...moves.values()].map((m) => m.end));
  const duration = Math.max(moveEnd, ...timed.map((t) => t.end), 0.5);
  return { duration, moves, steps: timed, earlier: earlierMarkerIds };
}

export interface Frame {
  board: Board;
  flying: { id: string; kind: string; at: Point; owner: Marker }[];
  inventory: Map<string, GrenadeCounts>;
}

// The board at time t: players along their routes, utility shown once it
// lands (flying grenades separately), drops appear and picked-up drops go,
// and inventories follow the order.
export function frameAt(board: Board, tl: Timeline, t: number, start: Map<string, GrenadeCounts>, dropKinds: Map<string, string>): Frame {
  const pos = new Map<string, Point>();
  for (const mv of tl.moves.values()) {
    const total = length(mv.path);
    const f = mv.end > 0 ? Math.min(1, t / mv.end) : 0;
    pos.set(mv.markerId, along(mv.path, f * total));
  }
  const thrown = new Map(tl.steps.filter((s) => s.step.type === 'throw').map((s) => [s.step.id, s]));
  const acted = new Map(tl.steps.filter((s) => s.step.type !== 'throw').map((s) => [s.step.id, s]));
  const markers = board.markers
    .filter((m) => !thrown.has(m.id) || thrown.get(m.id)!.end <= t)
    .map((m) => (pos.has(m.id) ? { ...m, ...pos.get(m.id)! } : m));
  const pickedAt = new Map<string, number>();
  for (const s of tl.steps) if (s.step.type === 'pickup' && s.step.drop_id) pickedAt.set(s.step.drop_id, s.end);
  const actions: BoardAction[] = (board.actions ?? []).filter((a) => {
    const s = acted.get(a.id);
    if (!s) return false;
    if (a.type === 'drop') return s.end <= t && !(pickedAt.has(a.id) && pickedAt.get(a.id)! <= t);
    return s.start <= t && t < s.end + 0.6;
  });
  const flying: Frame['flying'] = [];
  for (const s of thrown.values()) {
    if (s.start <= t && t < s.end && s.path) {
      const m = board.markers.find((x) => x.id === s.step.id)!;
      const f = (t - s.start) / (s.end - s.start);
      flying.push({ id: m.id, kind: m.kind, at: along(s.path, f * length(s.path)), owner: m });
    }
  }
  const inventory = new Map([...start].map(([k, c]) => [k, { ...c }]));
  for (const s of tl.steps) {
    if (s.end > t) continue;
    const c = inventory.get(s.step.key);
    if (!c) continue;
    const kind = (s.step.type === 'pickup' ? dropKinds.get(s.step.drop_id ?? '') : s.step.kind) as Grenade | undefined;
    if (!kind || !(kind in c)) continue;
    c[kind] = s.step.type === 'pickup' ? c[kind] + 1 : Math.max(0, c[kind] - 1);
  }
  return { board: { ...board, markers, actions }, flying, inventory };
}
