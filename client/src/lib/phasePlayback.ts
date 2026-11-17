// Play Phase: a preview of one tactic phase from its saved state, drawn from
// the same simulation that carries utility between phases (lib/utility
// simulatePhase). Players with routes move from their marker along them at a
// CS2-like running pace scaled to the radar; players without routes stay
// put. Each player's throws and drops then run in their order, 0.5 s apart,
// independently of the other players. A teammate whose route passes over a
// dropped item after it lands picks it up (it leaves the map and joins their
// utility) if they can carry it. Pure (type imports only): the saved board
// is never changed, and the same phase always plays the same way.
import type { Board, BoardAction, GrenadeCounts, Marker, Point } from './types';
import type { Grenade, GroundItem, Move, PhaseSim } from './utility';

// lib/utility moveAt, passed in so this module stays type-only (tests).
export type MoveAt = (mv: Move, t: number) => Point;

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const length = (pts: Point[]) => pts.slice(1).reduce((n, p, i) => n + dist(pts[i], p), 0);
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

export interface Frame {
  board: Board;
  flying: { id: string; kind: string; at: Point; owner: Marker }[];
  inventory: Map<string, GrenadeCounts>;
  // Items on the map at time t (from earlier phases or dropped here).
  ground: GroundItem[];
}

// The board at time t of a phase simulation. `start`: what each player
// carried when the phase began; `ground`: items lying there at the start.
export function frameAt(board: Board, sim: PhaseSim, t: number, start: Map<string, GrenadeCounts>, ground: GroundItem[], moveAt: MoveAt): Frame {
  const pos = new Map<string, Point>();
  for (const mv of sim.moves.values()) pos.set(mv.markerId, moveAt(mv, Math.min(t, mv.end)));
  const thrown = new Map(sim.steps.filter((s) => s.type === 'throw').map((s) => [s.id, s]));
  const markers = board.markers
    .filter((m) => !thrown.has(m.id) || thrown.get(m.id)!.end <= t)
    .map((m) => (pos.has(m.id) ? { ...m, ...pos.get(m.id)! } : m));
  // Drop markers are shown as ground items while they lie on the map.
  const actions: BoardAction[] = (board.actions ?? []).filter((a) => a.type !== 'drop');
  const pickedAt = new Map(sim.pickups.map((p) => [p.id, p.t]));
  const dropEnd = new Map(sim.steps.filter((s) => s.type === 'drop').map((s) => [s.id, s.end]));
  const failed = new Set(sim.over.map((o) => o.id));
  const onMap: GroundItem[] = [];
  const gone = (id: string) => pickedAt.has(id) && pickedAt.get(id)! <= t;
  for (const g of ground) if (!gone(g.id)) onMap.push(g);
  for (const a of board.actions ?? []) {
    if (a.type !== 'drop' || failed.has(a.id) || !dropEnd.has(a.id) || dropEnd.get(a.id)! > t || gone(a.id)) continue;
    onMap.push({ id: a.id, kind: a.kind as Grenade, x: a.x, y: a.y, level: a.level ?? 'main', key: '' });
  }
  const flying: Frame['flying'] = [];
  for (const s of thrown.values()) {
    if (s.start <= t && t < s.end && s.path) {
      const m = board.markers.find((x) => x.id === s.id)!;
      const f = (t - s.start) / (s.end - s.start);
      flying.push({ id: m.id, kind: m.kind, at: along(s.path, f * length(s.path)), owner: m });
    }
  }
  // Inventory: the same events the simulation applied, up to time t.
  const inventory = new Map([...start].map(([k, c]) => [k, { ...c }]));
  const get = (k: string) => { if (!inventory.has(k)) inventory.set(k, { smoke: 0, flash: 0, molly: 0, he: 0, decoy: 0 }); return inventory.get(k)!; };
  for (const s of sim.steps) {
    if (failed.has(s.id)) continue;
    const at = s.type === 'throw' ? s.start : s.end;
    if (at > t) continue;
    const c = get(s.key);
    const kind = s.kind as Grenade;
    if (kind in c) c[kind] = Math.max(0, c[kind] - 1);
  }
  for (const p of sim.pickups) if (p.t <= t) get(p.key)[p.kind] += 1;
  return { board: { ...board, markers, actions }, flying, inventory, ground: onMap };
}
