// Mirrors domain/utility.js (keep in sync): per-player buy lists and the
// utility each player has at the start of every phase.
import type { GrenadeCounts, Loadout, Phase, PlayerRef } from './types';

export const GRENADES = ['smoke', 'flash', 'molly', 'he'] as const;
export type Grenade = (typeof GRENADES)[number];
export const BUY_LIMITS: GrenadeCounts = { smoke: 1, flash: 2, molly: 1, he: 1 };
export const MAX_GRENADES = 4;
export const GRENADE_LABEL: Record<Grenade, [string, string]> = {
  smoke: ['Smoke', 'Smokes'], flash: ['Flash', 'Flashes'], molly: ['Molotov', 'Molotovs'], he: ['HE', 'HEs'],
};

const empty = (): GrenadeCounts => ({ smoke: 0, flash: 0, molly: 0, he: 0 });
export const refKey = (r: { user_id: number | null; slot?: number | null } | null | undefined) =>
  (!r ? null : r.user_id != null ? `u${r.user_id}` : r.slot ? `s${r.slot}` : null);
export const grenadeTotal = (c: GrenadeCounts) => GRENADES.reduce((n, g) => n + c[g], 0);
export const emptyLoadout = (who: PlayerRef): Loadout => ({ ...who, smoke: 0, flash: 0, molly: 0, he: 0, kit: false });

export function plannedThrows(phases: Phase[]) {
  const seen = new Set<string>();
  return phases.map((p) => {
    const byOwner = new Map<string, GrenadeCounts>();
    for (const m of p.board.markers) {
      if (!(GRENADES as readonly string[]).includes(m.kind) || m.reference) continue;
      const key = refKey(m);
      if (!key || seen.has(m.id)) continue;
      seen.add(m.id);
      if (!byOwner.has(key)) byOwner.set(key, empty());
      byOwner.get(key)![m.kind as Grenade] += 1;
    }
    return byOwner;
  });
}

export interface PlayerPlan {
  key: string;
  buy: GrenadeCounts;
  kit: boolean;
  phases: { start: GrenadeCounts; used: GrenadeCounts }[];
  over: { phase: number; kind: Grenade; planned: number; available: number }[];
}

export function utilityPlan(loadouts: Loadout[], phases: Phase[]): Map<string, PlayerPlan> {
  const throws = plannedThrows(phases);
  const keys = new Set<string>();
  loadouts.forEach((l) => { const k = refKey(l); if (k) keys.add(k); });
  throws.forEach((t) => t.forEach((_, k) => keys.add(k)));
  const out = new Map<string, PlayerPlan>();
  for (const key of keys) {
    const l = loadouts.find((x) => refKey(x) === key);
    const buy = l ? { smoke: l.smoke, flash: l.flash, molly: l.molly, he: l.he } : empty();
    const left = { ...buy };
    const over: PlayerPlan['over'] = [];
    const perPhase = throws.map((t, phase) => {
      const used = t.get(key) ?? empty();
      const start = { ...left };
      for (const g of GRENADES) {
        if (used[g] > Math.max(0, start[g])) over.push({ phase, kind: g, planned: used[g], available: Math.max(0, start[g]) });
        left[g] = start[g] - used[g];
      }
      return { start: Object.fromEntries(GRENADES.map((g) => [g, Math.max(0, start[g])])) as GrenadeCounts, used };
    });
    out.set(key, { key, buy, kit: Boolean(l?.kit), phases: perPhase, over });
  }
  return out;
}

// "1 smoke, 2 flashes" (empty string when nothing).
export function describeCounts(c: GrenadeCounts) {
  return GRENADES.filter((g) => c[g] > 0).map((g) => `${c[g]} ${GRENADE_LABEL[g][c[g] === 1 ? 0 : 1]}`).join(', ');
}
