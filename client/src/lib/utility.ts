// Mirrors domain/utility.js (keep in sync; spec/phase14.spec.js and
// spec/phase15.spec.js compare them): per-player buy lists, prices, drops,
// route pickups, and the utility each player has at the start of every
// phase, from the same simulation Play Phase animates. Type imports only, so
// the server tests can load it.
import type { Board, GrenadeCounts, Loadout, Phase, PlayerRef } from './types';

export const GRENADES = ['smoke', 'flash', 'molly', 'he', 'decoy'] as const;
export type Grenade = (typeof GRENADES)[number];
// Utility a marker can throw (decoys are bought and dropped only).
export const THROWN = ['smoke', 'flash', 'molly', 'he'] as const;
export const BUY_LIMITS: GrenadeCounts = { smoke: 1, flash: 2, molly: 1, he: 1, decoy: 1 };
export const MAX_GRENADES = 4;
// CS2 prices. Fire is a molotov on T ($400) and an incendiary on CT ($500).
export const PRICES = { flash: 200, smoke: 300, he: 300, molly: { T: 400, CT: 500 }, decoy: 50, kit: 400 } as const;
export const priceOf = (kind: Grenade, side?: string | null) => (kind === 'molly' ? PRICES.molly[side === 'CT' ? 'CT' : 'T'] : PRICES[kind]);
export const GRENADE_LABEL: Record<Grenade, [string, string]> = {
  smoke: ['Smoke', 'Smokes'], flash: ['Flash', 'Flashes'], molly: ['Molotov', 'Molotovs'], he: ['HE', 'HEs'], decoy: ['Decoy', 'Decoys'],
};
// The fire grenade's name for the side.
export const itemLabel = (kind: Grenade, side?: string | null, plural = false) =>
  (kind === 'molly' && side === 'CT' ? (plural ? 'Incendiaries' : 'Incendiary') : GRENADE_LABEL[kind][plural ? 1 : 0]);

// The item name inside a sentence: lower case, except HE.
export const itemWord = (kind: Grenade, side?: string | null, plural = false) => (kind === 'he' ? (plural ? 'HEs' : 'HE') : itemLabel(kind, side, plural).toLowerCase());
const empty = (): GrenadeCounts => ({ smoke: 0, flash: 0, molly: 0, he: 0, decoy: 0 });
export const refKey = (r: { user_id: number | null; slot?: number | null } | null | undefined) =>
  (!r ? null : r.user_id != null ? `u${r.user_id}` : r.slot ? `s${r.slot}` : null);
export const grenadeTotal = (c: Partial<GrenadeCounts>) => GRENADES.reduce((n, g) => n + (c[g] ?? 0), 0);
export const emptyLoadout = (who: PlayerRef): Loadout => ({ ...who, smoke: 0, flash: 0, molly: 0, he: 0, decoy: 0, kit: false });

// What a buy list costs (kit on CT only). Older buy lists have no decoy.
export function buyCost(l: Partial<Loadout> | undefined | null, side?: string | null) {
  if (!l) return 0;
  let cost = 0;
  for (const g of GRENADES) cost += (Number(l[g]) || 0) * priceOf(g, side);
  if (side === 'CT' && l.kit) cost += PRICES.kit;
  return cost;
}
export const money = (n: number) => `$${n.toLocaleString('en-US')}`;

export interface Step { type: 'throw' | 'drop'; id: string; key: string; kind?: string; seq?: number; n: number; step: number }

// Play Phase timing (mirrors domain/utility.js).
export const RADAR_SCALE: Record<string, number> = {
  de_ancient: 5, de_anubis: 5.22, de_cache: 5.5, de_dust2: 4.4, de_inferno: 4.9, de_mirage: 5,
  de_nuke: 7, de_overpass: 5.2, de_train: 4.082077, de_vertigo: 4,
};
export const RUN_SPEED = 230;
export const GRENADE_SPEED = 750;
export const GAP_S = 0.5;
export const ACTION_S = 0.4;
export const PICKUP_UNITS = 96;
export const unitsPerBoard = (map: string | null | undefined) => 1024 * (RADAR_SCALE[map ?? ''] ?? 5);
const levelOf = (x: { level?: string } | null | undefined) => (x && x.level) || 'main';
type Pt = { x: number; y: number };
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const pathLength = (pts: Pt[]) => pts.slice(1).reduce((n, p, i) => n + dist(pts[i], p), 0);

// One phase's throws and drops per owner, in each player's order (same rules
// as the server; older pickup annotations are ignored).
export function phaseSteps(board: Board, seenMarkers: Set<string>): Step[] {
  const items: Step[] = [];
  board.markers.forEach((m, i) => {
    if (!(THROWN as readonly string[]).includes(m.kind) || m.reference) return;
    const key = refKey(m);
    if (!key || seenMarkers.has(m.id)) return;
    seenMarkers.add(m.id);
    items.push({ type: 'throw', id: m.id, key, kind: m.kind, seq: m.seq, n: i, step: 0 });
  });
  (board.actions ?? []).forEach((a, i) => {
    const key = refKey(a);
    if (!key || a.type !== 'drop') return;
    items.push({ type: 'drop', id: a.id, key, kind: a.kind, seq: a.seq, n: 1000 + i, step: 0 });
  });
  const byOwner = new Map<string, Step[]>();
  for (const it of items) {
    if (!byOwner.has(it.key)) byOwner.set(it.key, []);
    byOwner.get(it.key)!.push(it);
  }
  for (const list of byOwner.values()) {
    list.sort((a, b) => (a.seq ?? 1e9) - (b.seq ?? 1e9) || a.n - b.n);
    list.forEach((it, i) => { it.step = i; });
  }
  const rank = { drop: 0, throw: 1 } as const;
  return [...byOwner.values()].flat().sort((a, b) => a.step - b.step || rank[a.type] - rank[b.type] || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export interface Move { key: string; markerId: string; level: string; path: Pt[]; times: number[]; end: number; routed: boolean }
export function phaseMoves(board: Board, map: string | null | undefined): Map<string, Move> {
  const scale = unitsPerBoard(map);
  const moves = new Map<string, Move>();
  for (const m of board.markers.filter((x) => x.kind === 'player')) {
    const key = refKey(m);
    if (!key || moves.has(key)) continue;
    const routes = board.routes.filter((r) => refKey(r) === key && r.points.length >= 2 && levelOf(r) === levelOf(m));
    const path: Pt[] = [{ x: m.x, y: m.y }, ...routes.flatMap((r) => r.points.map((p) => ({ x: p.x, y: p.y })))];
    const times = [0];
    for (let i = 1; i < path.length; i += 1) times.push(times[i - 1] + (dist(path[i - 1], path[i]) * scale) / RUN_SPEED);
    moves.set(key, { key, markerId: m.id, level: levelOf(m), path, times, end: routes.length ? times[times.length - 1] : 0, routed: routes.length > 0 });
  }
  return moves;
}

// Where a player is at time t (along their route, then standing at its end).
export function moveAt(mv: Move, t: number): Pt {
  const { path, times } = mv;
  if (t <= 0 || path.length === 1) return path[0];
  for (let i = 1; i < path.length; i += 1) {
    if (t <= times[i]) {
      const f = times[i] > times[i - 1] ? (t - times[i - 1]) / (times[i] - times[i - 1]) : 1;
      return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * f, y: path[i - 1].y + (path[i].y - path[i - 1].y) * f };
    }
  }
  return path[path.length - 1];
}

export function firstReach(mv: Move, p: Pt, r: number, from: number): number | null {
  const { path, times } = mv;
  for (let i = 1; i < path.length; i += 1) {
    const t0 = times[i - 1];
    const t1 = times[i];
    if (t1 < from || t1 <= t0) continue;
    const A = path[i - 1];
    const vx = (path[i].x - A.x) / (t1 - t0);
    const vy = (path[i].y - A.y) / (t1 - t0);
    const s0 = Math.max(from, t0) - t0;
    const wx = A.x - p.x;
    const wy = A.y - p.y;
    const at = (q: number) => Math.hypot(wx + vx * q, wy + vy * q);
    if (at(s0) <= r) return t0 + s0;
    const a = vx * vx + vy * vy;
    const b = 2 * (wx * vx + wy * vy);
    const c = wx * wx + wy * wy - r * r;
    const disc = b * b - 4 * a * c;
    if (a > 0 && disc >= 0) {
      const q = (-b - Math.sqrt(disc)) / (2 * a);
      if (q >= s0 && q <= t1 - t0) return t0 + q;
    }
  }
  const last = path[path.length - 1];
  return dist(last, p) <= r ? Math.max(from, mv.end) : null;
}

const roomFor = (c: GrenadeCounts, kind: Grenade) => c[kind] < BUY_LIMITS[kind] && grenadeTotal(c) < MAX_GRENADES;

export interface GroundItem { id: string; kind: Grenade; x: number; y: number; level: string; key: string }
export interface TimedStep extends Step { start: number; end: number; path?: Pt[] }
export interface Pickup { id: string; key: string; t: number; kind: Grenade }
export interface SimIssue { kind: Grenade; type: 'unavailable' | 'drop_unavailable'; planned: number; available: number; id: string; key: string }
export interface PhaseSim {
  moves: Map<string, Move>; steps: TimedStep[]; pickups: Pickup[]; blocked: Pickup[];
  end: Map<string, GrenadeCounts>; ground: GroundItem[];
  used: Map<string, GrenadeCounts>; dropped: Map<string, GrenadeCounts>; picked: Map<string, GrenadeCounts>;
  over: SimIssue[]; duration: number;
}

// One phase, deterministically (see domain/utility.js simulatePhase).
export function simulatePhase({ board, map, start = new Map(), ground = [], seen = new Set() }: {
  board: Board; map: string | null | undefined; start?: Map<string, GrenadeCounts>; ground?: GroundItem[]; seen?: Set<string>;
}): PhaseSim {
  const scale = unitsPerBoard(map);
  const reach = PICKUP_UNITS / scale; // board fraction (scale = units per board)
  const moves = phaseMoves(board, map);
  const steps = phaseSteps(board, seen);
  const nextFree = new Map<string, number>();
  const timed: TimedStep[] = [];
  for (const s of steps) {
    const begin = nextFree.get(s.key) ?? (moves.get(s.key)?.end ?? 0);
    let end = begin + ACTION_S;
    let path: Pt[] | undefined;
    if (s.type === 'throw') {
      const m = board.markers.find((x) => x.id === s.id)!;
      const mv = moves.get(s.key);
      const from = mv ? mv.path[mv.path.length - 1] : null;
      path = [...(from ? [from] : []), ...(m.path ?? []).map((p) => ({ x: p.x, y: p.y })), { x: m.x, y: m.y }];
      end = begin + Math.min(2.2, Math.max(0.5, (pathLength(path) * scale) / GRENADE_SPEED));
    }
    timed.push({ ...s, start: begin, end, path });
    nextFree.set(s.key, end + GAP_S);
  }
  const inv = new Map([...start].map(([k, c]) => [k, { ...c }]));
  const ensure = (k: string) => { if (!inv.has(k)) inv.set(k, empty()); return inv.get(k)!; };
  const used = new Map<string, GrenadeCounts>();
  const dropped = new Map<string, GrenadeCounts>();
  const picked = new Map<string, GrenadeCounts>();
  const bump = (m: Map<string, GrenadeCounts>, k: string, kind: Grenade) => { if (!m.has(k)) m.set(k, empty()); m.get(k)![kind] += 1; };
  const over: SimIssue[] = [];
  const pickups: Pickup[] = [];
  const blocked: Pickup[] = [];
  const items = new Map<string, GroundItem>();
  type Ev = { t: number; rank: number; key: string; id: string; type: 'reach' | 'throw' | 'drop'; step?: TimedStep };
  const queue: Ev[] = [];
  const candidates = (item: GroundItem, from: number) => {
    for (const mv of moves.values()) {
      if (!mv.routed || mv.key === item.key || mv.level !== item.level) continue;
      const t = firstReach(mv, item, reach, from);
      // Rounded to 0.1 ms so equal-distance arrivals tie (then: by player key).
      if (t != null) queue.push({ t: Math.round(t * 1e4) / 1e4, rank: 1, key: mv.key, id: item.id, type: 'reach' });
    }
  };
  for (const g of ground) {
    items.set(g.id, { ...g });
    candidates(g, 0);
  }
  for (const s of timed) queue.push({ t: s.type === 'throw' ? s.start : s.end, rank: 0, key: s.key, id: s.id, type: s.type, step: s });
  const order = (a: Ev, b: Ev) => a.t - b.t || a.rank - b.rank || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  while (queue.length) {
    queue.sort(order);
    const e = queue.shift()!;
    if (e.type === 'reach') {
      const item = items.get(e.id);
      if (!item) continue;
      const c = ensure(e.key);
      if (!roomFor(c, item.kind)) { blocked.push({ id: item.id, key: e.key, t: e.t, kind: item.kind }); continue; }
      c[item.kind] += 1;
      bump(picked, e.key, item.kind);
      items.delete(item.id);
      pickups.push({ id: item.id, key: e.key, t: e.t, kind: item.kind });
      continue;
    }
    const s = e.step!;
    const kind = s.kind as Grenade;
    if (!(GRENADES as readonly string[]).includes(kind)) continue;
    const c = ensure(s.key);
    if (c[kind] < 1) {
      over.push({ kind, type: s.type === 'throw' ? 'unavailable' : 'drop_unavailable', planned: 1, available: 0, id: s.id, key: s.key });
      if (s.type === 'throw') bump(used, s.key, kind);
      continue;
    }
    c[kind] -= 1;
    bump(s.type === 'throw' ? used : dropped, s.key, kind);
    if (s.type === 'drop') {
      const a = (board.actions ?? []).find((x) => x.id === s.id)!;
      const item: GroundItem = { id: s.id, kind, x: a.x, y: a.y, level: levelOf(a), key: s.key };
      items.set(item.id, item);
      candidates(item, e.t);
    }
  }
  const moveEnd = Math.max(0, ...[...moves.values()].map((m) => m.end));
  const duration = Math.max(moveEnd, ...timed.map((t) => t.end), ...pickups.map((p) => p.t), 0.5);
  return { moves, steps: timed, pickups, blocked, end: inv, ground: [...items.values()], used, dropped, picked, over, duration };
}

export interface ActionError { phase: number; id: string; message: string }
export function actionErrors(phases: Phase[]): ActionError[] {
  const errors: ActionError[] = [];
  const ids = new Set<string>();
  phases.forEach((p, phase) => {
    for (const a of p.board.actions ?? []) {
      if (a.type !== 'drop') continue;
      if (ids.has(a.id)) errors.push({ phase, id: a.id, message: 'Each drop needs its own id' });
      ids.add(a.id);
    }
  });
  return errors;
}

export interface PlanIssue { phase: number; kind: Grenade; type: 'unavailable' | 'drop_unavailable' | 'over_limit'; planned: number; available: number; id: string }
export interface PlayerPlan {
  key: string;
  buy: GrenadeCounts;
  kit: boolean;
  cost: number;
  phases: { start: GrenadeCounts; used: GrenadeCounts; dropped: GrenadeCounts; picked: GrenadeCounts }[];
  over: PlanIssue[];
}
export interface TacticPlan { players: Map<string, PlayerPlan>; grounds: GroundItem[][]; sims: PhaseSim[]; final: GroundItem[] }

// The whole tactic with the Play Phase simulation (mirrors phasePlan).
export function phasePlan(loadouts: Loadout[], phases: Phase[], side?: string | null, map?: string | null, bomb?: PlayerRef | null): TacticPlan {
  const keys: string[] = [];
  const add = (k: string | null) => { if (k && !keys.includes(k)) keys.push(k); };
  loadouts.forEach((l) => add(refKey(l)));
  if (side === 'T' && bomb) add(refKey(bomb));
  for (const p of phases) {
    p.board.markers.forEach((m) => { if ((THROWN as readonly string[]).includes(m.kind) && !m.reference) add(refKey(m)); });
    (p.board.actions ?? []).forEach((a) => { if (a.type === 'drop') add(refKey(a)); });
    p.board.markers.forEach((m) => { if (m.kind === 'player') add(refKey(m)); });
  }
  let inv = new Map<string, GrenadeCounts>();
  const out = new Map<string, PlayerPlan>();
  for (const key of keys) {
    const l = loadouts.find((x) => refKey(x) === key);
    const buy = Object.fromEntries(GRENADES.map((g) => [g, Number(l?.[g]) || 0])) as GrenadeCounts;
    inv.set(key, { ...buy });
    out.set(key, { key, buy, kit: side === 'CT' && Boolean(l?.kit), cost: buyCost(l, side), phases: [], over: [] });
  }
  const seen = new Set<string>();
  let ground: GroundItem[] = [];
  const grounds: GroundItem[][] = [];
  const sims: PhaseSim[] = [];
  phases.forEach((p, phase) => {
    grounds.push(ground.map((g) => ({ ...g })));
    const sim = simulatePhase({ board: p.board, map, start: inv, ground, seen });
    sims.push(sim);
    for (const o of sim.over) out.get(o.key)?.over.push({ phase, kind: o.kind, type: o.type, planned: o.planned, available: o.available, id: o.id });
    for (const key of keys) {
      out.get(key)!.phases.push({
        start: { ...(inv.get(key) ?? empty()) },
        used: sim.used.get(key) ?? empty(),
        dropped: sim.dropped.get(key) ?? empty(),
        picked: sim.picked.get(key) ?? empty(),
      });
    }
    inv = new Map(keys.map((k) => [k, { ...(sim.end.get(k) ?? inv.get(k) ?? empty()) }]));
    ground = sim.ground;
  });
  return { players: out, grounds, sims, final: ground };
}

export function utilityPlan(loadouts: Loadout[], phases: Phase[], side?: string | null, map?: string | null, bomb?: PlayerRef | null): Map<string, PlayerPlan> {
  return phasePlan(loadouts, phases, side, map, bomb).players;
}

// "1 smoke, 2 flashes" (empty string when nothing).
export function describeCounts(c: Partial<GrenadeCounts>, side?: string | null) {
  return GRENADES.filter((g) => (c[g] ?? 0) > 0).map((g) => `${c[g]} ${itemLabel(g, side, c[g] !== 1).toLowerCase()}`).join(', ');
}

export function issueText(o: PlanIssue, side?: string | null) {
  const item = itemLabel(o.kind, side).toLowerCase();
  if (o.type === 'over_limit') return `Picking up this ${item} exceeds what a player can carry (${o.available} max of that item, ${MAX_GRENADES} grenades in total).`;
  if (o.type === 'drop_unavailable') return `Drops a ${item} the player no longer has at that point.`;
  return `Throws a ${item} the player no longer has at that point.`;
}
