// Mirrors domain/utility.js (keep in sync; spec/phase14.spec.js compares
// them): per-player buy lists, prices, drops and pickups, and the utility
// each player has at the start of every phase. Type imports only, so the
// server tests can load it.
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

export interface Step { type: 'throw' | 'drop' | 'pickup'; id: string; key: string; kind?: string; drop_id?: string; seq?: number; n: number; step: number }

// One phase's utility actions per owner, in order (same rules as the server).
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
    if (!key) return;
    items.push({ type: a.type, id: a.id, key, kind: a.kind, drop_id: a.drop_id, seq: a.seq, n: 1000 + i, step: 0 });
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
  const rank = { drop: 0, pickup: 1, throw: 2 } as const;
  return [...byOwner.values()].flat().sort((a, b) => a.step - b.step || rank[a.type] - rank[b.type] || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export interface ActionError { phase: number; id: string; message: string }
export function actionErrors(phases: Phase[]): ActionError[] {
  const errors: ActionError[] = [];
  const drops = new Map<string, { phase: number; step: number }>();
  const picked = new Map<string, string>();
  const seen = new Set<string>();
  phases.forEach((p, phase) => {
    const steps = phaseSteps(p.board, seen);
    for (const s of steps) {
      if (s.type !== 'drop') continue;
      if (drops.has(s.id)) errors.push({ phase, id: s.id, message: 'Each drop needs its own id' });
      drops.set(s.id, { phase, step: s.step });
    }
    for (const s of steps) {
      if (s.type !== 'pickup') continue;
      const d = s.drop_id ? drops.get(s.drop_id) : undefined;
      if (!d || d.phase > phase) errors.push({ phase, id: s.id, message: 'A pickup must take an item dropped in this or an earlier phase' });
      else if (d.phase === phase && d.step >= s.step) errors.push({ phase, id: s.id, message: 'A pickup must come after its drop' });
      else if (picked.has(s.drop_id!)) errors.push({ phase, id: s.id, message: 'That dropped item has already been picked up' });
      else picked.set(s.drop_id!, s.id);
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

export function utilityPlan(loadouts: Loadout[], phases: Phase[], side?: string | null): Map<string, PlayerPlan> {
  const keys: string[] = [];
  const add = (k: string | null) => { if (k && !keys.includes(k)) keys.push(k); };
  loadouts.forEach((l) => add(refKey(l)));
  for (const p of phases) {
    p.board.markers.forEach((m) => { if ((THROWN as readonly string[]).includes(m.kind) && !m.reference) add(refKey(m)); });
    (p.board.actions ?? []).forEach((a) => add(refKey(a)));
  }
  const inv = new Map<string, GrenadeCounts>();
  const out = new Map<string, PlayerPlan>();
  for (const key of keys) {
    const l = loadouts.find((x) => refKey(x) === key);
    const buy = Object.fromEntries(GRENADES.map((g) => [g, Number(l?.[g]) || 0])) as GrenadeCounts;
    inv.set(key, { ...buy });
    out.set(key, { key, buy, kit: side === 'CT' && Boolean(l?.kit), cost: buyCost(l, side), phases: [], over: [] });
  }
  const dropKind = new Map<string, Grenade>();
  const seen = new Set<string>();
  phases.forEach((p, phase) => {
    const starts = new Map([...inv].map(([k, c]) => [k, { ...c }]));
    const used = new Map(keys.map((k) => [k, empty()]));
    const dropped = new Map(keys.map((k) => [k, empty()]));
    const gained = new Map(keys.map((k) => [k, empty()]));
    for (const s of phaseSteps(p.board, seen)) {
      const c = inv.get(s.key)!;
      if (s.type === 'throw' || s.type === 'drop') {
        const kind = s.kind as Grenade;
        if (!(GRENADES as readonly string[]).includes(kind)) continue;
        if (c[kind] < 1) out.get(s.key)!.over.push({ phase, kind, type: s.type === 'throw' ? 'unavailable' : 'drop_unavailable', planned: 1, available: 0, id: s.id });
        c[kind] = Math.max(0, c[kind] - 1);
        (s.type === 'throw' ? used : dropped).get(s.key)![kind] += 1;
        if (s.type === 'drop') dropKind.set(s.id, kind);
      } else {
        const kind = s.drop_id ? dropKind.get(s.drop_id) : undefined;
        if (!kind) continue;
        c[kind] += 1;
        gained.get(s.key)![kind] += 1;
        if (c[kind] > BUY_LIMITS[kind] || grenadeTotal(c) > MAX_GRENADES) {
          out.get(s.key)!.over.push({ phase, kind, type: 'over_limit', planned: c[kind], available: BUY_LIMITS[kind], id: s.id });
        }
      }
    }
    for (const key of keys) {
      out.get(key)!.phases.push({ start: starts.get(key)!, used: used.get(key)!, dropped: dropped.get(key)!, picked: gained.get(key)! });
    }
  });
  return out;
}

// Drops still on the ground at the start of a phase (dropped earlier, not
// picked up before it), for pickups and the board.
export function groundDrops(phases: Phase[], phaseIndex: number) {
  const out: { id: string; phase: number; kind: Grenade; x: number; y: number; level: string; owner: PlayerRef }[] = [];
  const picked = new Set<string>();
  phases.slice(0, phaseIndex).forEach((p) => (p.board.actions ?? []).forEach((a) => { if (a.type === 'pickup' && a.drop_id) picked.add(a.drop_id); }));
  phases.slice(0, phaseIndex).forEach((p, phase) => (p.board.actions ?? []).forEach((a) => {
    if (a.type === 'drop' && a.kind && !picked.has(a.id)) {
      out.push({ id: a.id, phase, kind: a.kind as Grenade, x: a.x, y: a.y, level: a.level ?? 'main', owner: { user_id: a.user_id, slot: a.slot ?? null } });
    }
  }));
  return out;
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
