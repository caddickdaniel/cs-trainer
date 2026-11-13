// Per-player buy lists and planned utility (shared by the API, Game Mode and
// the migration; client/src/lib/utility.ts mirrors it for the editor).
//
// A tactic stores what each player buys (loadouts) and, on T, who carries the
// bomb. Planned throws are the utility markers on the board that are assigned
// to a player and not marked as a reference. A marker that stays on the board
// in later phases (same id) is one throw, counted in the phase it first
// appears. What a player has at the start of a phase is derived from the buy
// list and earlier phases only, so moving back, refreshing or reconnecting
// always gives the same numbers.

const GRENADES = ['smoke', 'flash', 'molly', 'he'];
// CS2 carry limits per player.
const BUY_LIMITS = { smoke: 1, flash: 2, molly: 1, he: 1 };
const MAX_GRENADES = 4;

const ownerKey = (item) => {
  if (!item) return null;
  if (item.user_id != null) return `u${item.user_id}`;
  if (item.slot != null) return `s${item.slot}`;
  return null;
};

const empty = () => ({ smoke: 0, flash: 0, molly: 0, he: 0 });

// Planned throws per phase: an array (one entry per phase) of Map(owner -> counts).
function plannedThrows(phases) {
  const seen = new Set();
  return phases.map((p) => {
    const byOwner = new Map();
    for (const m of (p.board && p.board.markers) || []) {
      if (!GRENADES.includes(m.kind) || m.reference) continue;
      const key = ownerKey(m);
      if (!key || seen.has(m.id)) continue;
      seen.add(m.id);
      if (!byOwner.has(key)) byOwner.set(key, empty());
      byOwner.get(key)[m.kind] += 1;
    }
    return byOwner;
  });
}

// The full plan: for every player with a buy list or a planned throw, what
// they buy, what they have at the start of each phase, and any phase where
// the plan uses more than they have.
function utilityPlan({ loadouts = [], phases = [], side = null, bomb = null } = {}) {
  const throws = plannedThrows(phases);
  const owners = new Map();
  const add = (item) => {
    const key = ownerKey(item);
    if (key && !owners.has(key)) owners.set(key, { user_id: item.user_id ?? null, slot: item.user_id != null ? null : item.slot ?? null });
  };
  loadouts.forEach(add);
  if (side === 'T' && bomb) add(bomb);
  for (const t of throws) for (const key of t.keys()) add(key.startsWith('u') ? { user_id: Number(key.slice(1)) } : { slot: Number(key.slice(1)) });
  return [...owners.entries()].map(([key, who]) => {
    const l = loadouts.find((x) => ownerKey(x) === key) || {};
    const buy = { ...empty(), ...Object.fromEntries(GRENADES.map((g) => [g, Number(l[g]) || 0])) };
    const kit = side === 'CT' && Boolean(l.kit);
    let left = { ...buy };
    const over = [];
    const perPhase = throws.map((t, index) => {
      const used = t.get(key) || empty();
      const start = { ...left };
      for (const g of GRENADES) {
        if (used[g] > Math.max(0, start[g])) over.push({ phase: index, kind: g, planned: used[g], available: Math.max(0, start[g]) });
        left[g] = start[g] - used[g];
      }
      return { start: clampAll(start), used };
    });
    left = null;
    return {
      key, ...who, buy, kit,
      bomb: side === 'T' && ownerKey(bomb) === key,
      phases: perPhase,
      over,
    };
  });
}

const clampAll = (c) => Object.fromEntries(GRENADES.map((g) => [g, Math.max(0, c[g])]));

// A buy list that only includes what the player's assigned markers plan to
// throw (used to populate legacy tactics), capped at the carry limits.
function loadoutsFromThrows(phases) {
  const totals = new Map();
  for (const t of plannedThrows(phases)) {
    for (const [key, c] of t) {
      if (!totals.has(key)) totals.set(key, empty());
      for (const g of GRENADES) totals.get(key)[g] += c[g];
    }
  }
  return [...totals.entries()].map(([key, c]) => {
    const capped = Object.fromEntries(GRENADES.map((g) => [g, Math.min(BUY_LIMITS[g], c[g])]));
    // Keep within four grenades, dropping second flashes first, then HE.
    for (const g of ['flash', 'he', 'molly', 'smoke']) {
      while (GRENADES.reduce((n, k) => n + capped[k], 0) > MAX_GRENADES && capped[g] > 0) capped[g] -= 1;
    }
    return {
      user_id: key.startsWith('u') ? Number(key.slice(1)) : null,
      slot: key.startsWith('s') ? Number(key.slice(1)) : null,
      ...capped,
      kit: false,
    };
  });
}

module.exports = { GRENADES, BUY_LIMITS, MAX_GRENADES, ownerKey, plannedThrows, utilityPlan, loadoutsFromThrows };
