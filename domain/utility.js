// Per-player buy lists, prices and planned utility (shared by the API, Game
// Mode and the migration; client/src/lib/utility.ts mirrors it for the
// editor, and spec/phase14.spec.js checks they agree).
//
// A tactic stores what each player buys (loadouts) and, on T, who carries the
// bomb. In each phase a player's utility actions run in their own order
// (`seq`): planned throws (utility markers assigned to them and not marked
// as a reference), drops (an item left on the map) and pickups (taking a
// specific earlier drop). A marker that stays on the board in later phases
// (same id) is one throw, counted in the phase it first appears. What a
// player has at the start of a phase is derived from the buy list and the
// earlier phases only, so moving back, refreshing or reconnecting always
// gives the same numbers. Buy cost is the starting buy list: drops, pickups
// and throws change what a player carries, not what they paid.

const GRENADES = ['smoke', 'flash', 'molly', 'he', 'decoy'];
// Utility kinds a marker can throw (decoys are bought and dropped only).
const THROWN = ['smoke', 'flash', 'molly', 'he'];
// CS2 carry limits per player.
const BUY_LIMITS = { smoke: 1, flash: 2, molly: 1, he: 1, decoy: 1 };
const MAX_GRENADES = 4;
// CS2 prices. Fire is a molotov on T ($400) and an incendiary on CT ($500).
const PRICES = { flash: 200, smoke: 300, he: 300, molly: { T: 400, CT: 500 }, decoy: 50, kit: 400 };
const priceOf = (kind, side) => (kind === 'molly' ? PRICES.molly[side === 'CT' ? 'CT' : 'T'] : PRICES[kind]);

const ownerKey = (item) => {
  if (!item) return null;
  if (item.user_id != null) return `u${item.user_id}`;
  if (item.slot != null) return `s${item.slot}`;
  return null;
};

const empty = () => ({ smoke: 0, flash: 0, molly: 0, he: 0, decoy: 0 });
const total = (c) => GRENADES.reduce((n, g) => n + (c[g] || 0), 0);

// What a buy list costs: each item at its CS2 price (kit on CT only).
function buyCost(loadout, side) {
  if (!loadout) return 0;
  let cost = 0;
  for (const g of GRENADES) cost += (Number(loadout[g]) || 0) * priceOf(g, side);
  if (side === 'CT' && loadout.kit) cost += PRICES.kit;
  return cost;
}

// One phase's utility actions per owner, in order: throws (markers), drops
// and pickups. Items without a seq keep their board order after ordered ones.
function phaseSteps(board, seenMarkers) {
  const items = [];
  (board.markers || []).forEach((m, i) => {
    if (!THROWN.includes(m.kind) || m.reference) return;
    const key = ownerKey(m);
    if (!key || seenMarkers.has(m.id)) return;
    seenMarkers.add(m.id);
    items.push({ type: 'throw', id: m.id, key, kind: m.kind, seq: m.seq, n: i });
  });
  (board.actions || []).forEach((a, i) => {
    const key = ownerKey(a);
    if (!key) return;
    items.push({ type: a.type, id: a.id, key, kind: a.kind, drop_id: a.drop_id, seq: a.seq, n: 1000 + i });
  });
  const byOwner = new Map();
  for (const it of items) {
    if (!byOwner.has(it.key)) byOwner.set(it.key, []);
    byOwner.get(it.key).push(it);
  }
  for (const list of byOwner.values()) {
    list.sort((a, b) => (a.seq ?? 1e9) - (b.seq ?? 1e9) || a.n - b.n);
    list.forEach((it, i) => { it.step = i; });
  }
  // Phase timeline: step i of every player happens at the same moment, so
  // players run side by side; ties resolve drops first, then pickups, throws.
  const rank = { drop: 0, pickup: 1, throw: 2 };
  return [...byOwner.values()].flat().sort((a, b) => a.step - b.step || rank[a.type] - rank[b.type] || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// Structural problems with drops and pickups (the save path rejects these):
// a pickup must name a drop from this or an earlier phase, come after it,
// and each drop can be picked up once.
function actionErrors(phases) {
  const errors = [];
  const drops = new Map(); // drop id -> { phase, step }
  const picked = new Map();
  const seen = new Set();
  phases.forEach((p, phase) => {
    const steps = phaseSteps(p.board || {}, seen);
    for (const s of steps) {
      if (s.type === 'drop') {
        if (drops.has(s.id)) errors.push({ phase, id: s.id, message: 'Each drop needs its own id' });
        drops.set(s.id, { phase, step: s.step });
      }
    }
    for (const s of steps) {
      if (s.type !== 'pickup') continue;
      const d = drops.get(s.drop_id);
      if (!d || d.phase > phase) errors.push({ phase, id: s.id, message: 'A pickup must take an item dropped in this or an earlier phase' });
      else if (d.phase === phase && d.step >= s.step) errors.push({ phase, id: s.id, message: 'A pickup must come after its drop' });
      else if (picked.has(s.drop_id)) errors.push({ phase, id: s.id, message: 'That dropped item has already been picked up' });
      else picked.set(s.drop_id, s.id);
    }
  });
  return errors;
}

// The full plan: for every player with a buy list, a planned throw or a
// drop/pickup, what they buy (and its cost), what they carry at the start of
// each phase, and any step that uses unavailable utility or carries more
// than CS2 allows.
function utilityPlan({ loadouts = [], phases = [], side = null, bomb = null } = {}) {
  const owners = new Map();
  const add = (item) => {
    const key = ownerKey(item);
    if (key && !owners.has(key)) owners.set(key, { user_id: item.user_id ?? null, slot: item.user_id != null ? null : item.slot ?? null });
  };
  loadouts.forEach(add);
  if (side === 'T' && bomb) add(bomb);
  for (const p of phases) {
    for (const m of (p.board && p.board.markers) || []) if (THROWN.includes(m.kind) && !m.reference) add(m);
    for (const a of (p.board && p.board.actions) || []) add(a);
  }
  const inv = new Map();
  const buys = new Map();
  for (const [key] of owners) {
    const l = loadouts.find((x) => ownerKey(x) === key) || {};
    const buy = Object.fromEntries(GRENADES.map((g) => [g, Number(l[g]) || 0]));
    buys.set(key, { buy, kit: side === 'CT' && Boolean(l.kit), cost: buyCost(l, side) });
    inv.set(key, { ...buy });
  }
  const dropKind = new Map();
  const perPhase = new Map([...owners.keys()].map((k) => [k, []]));
  const over = new Map([...owners.keys()].map((k) => [k, []]));
  const seen = new Set();
  phases.forEach((p, phase) => {
    const starts = new Map([...inv].map(([k, c]) => [k, { ...c }]));
    const used = new Map([...owners.keys()].map((k) => [k, empty()]));
    const dropped = new Map([...owners.keys()].map((k) => [k, empty()]));
    const gained = new Map([...owners.keys()].map((k) => [k, empty()]));
    for (const s of phaseSteps(p.board || {}, seen)) {
      const c = inv.get(s.key);
      if (s.type === 'throw' || s.type === 'drop') {
        if (!GRENADES.includes(s.kind)) continue;
        if (c[s.kind] < 1) over.get(s.key).push({ phase, kind: s.kind, type: s.type === 'throw' ? 'unavailable' : 'drop_unavailable', planned: 1, available: 0, id: s.id });
        c[s.kind] = Math.max(0, c[s.kind] - 1);
        (s.type === 'throw' ? used : dropped).get(s.key)[s.kind] += 1;
        if (s.type === 'drop') dropKind.set(s.id, s.kind);
      } else {
        const kind = dropKind.get(s.drop_id);
        if (!kind) continue; // structural error, reported by actionErrors
        c[kind] += 1;
        gained.get(s.key)[kind] += 1;
        if (c[kind] > BUY_LIMITS[kind] || total(c) > MAX_GRENADES) {
          over.get(s.key).push({ phase, kind, type: 'over_limit', planned: c[kind], available: BUY_LIMITS[kind], id: s.id });
        }
      }
    }
    for (const key of owners.keys()) {
      perPhase.get(key).push({ start: starts.get(key), used: used.get(key), dropped: dropped.get(key), picked: gained.get(key) });
    }
  });
  return [...owners.entries()].map(([key, who]) => ({
    key, ...who, ...buys.get(key),
    bomb: side === 'T' && ownerKey(bomb) === key,
    phases: perPhase.get(key),
    over: over.get(key),
  }));
}

// Planned throws per phase (kept for callers counting markers only).
function plannedThrows(phases) {
  const seen = new Set();
  return phases.map((p) => {
    const byOwner = new Map();
    for (const s of phaseSteps(p.board || {}, seen)) {
      if (s.type !== 'throw') continue;
      if (!byOwner.has(s.key)) byOwner.set(s.key, empty());
      byOwner.get(s.key)[s.kind] += 1;
    }
    return byOwner;
  });
}

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
    for (const g of ['flash', 'he', 'molly', 'smoke', 'decoy']) {
      while (total(capped) > MAX_GRENADES && capped[g] > 0) capped[g] -= 1;
    }
    return {
      user_id: key.startsWith('u') ? Number(key.slice(1)) : null,
      slot: key.startsWith('s') ? Number(key.slice(1)) : null,
      ...capped,
      kit: false,
    };
  });
}

module.exports = {
  GRENADES, THROWN, BUY_LIMITS, MAX_GRENADES, PRICES, priceOf, buyCost, ownerKey,
  phaseSteps, actionErrors, plannedThrows, utilityPlan, loadoutsFromThrows,
};
