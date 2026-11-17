// Per-player buy lists, prices and planned utility (shared by the API, Game
// Mode and the migration; client/src/lib/utility.ts mirrors it for the
// editor, and spec/phase14.spec.js checks they agree).
//
// A tactic stores what each player buys (loadouts) and, on T, who carries the
// bomb. In each phase a player runs their routes, then makes their throws
// (utility markers assigned to them, not references) and drops (an item left
// at a point on the map) in their own order (`seq`). A teammate whose route
// passes over a dropped item after it lands picks it up if they can carry
// it (Phase 15: pickups follow from routes). A marker kept on the board in
// later phases (same id) is one throw, counted where it first appears.
// Everything is derived from the buy list and the phases in order with one
// simulation (simulatePhase), so Play Phase, the phase-to-phase carryover,
// moving back, refreshing or reconnecting always give the same numbers. Buy
// cost is the starting buy list.

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

// Play Phase timing (shared with client/src/lib/utility.ts): players run
// their routes at a rifle carrier's pace scaled to the map's radar, then
// make their throws and drops in their own order, 0.5 s apart.
const RADAR_SCALE = {
  de_ancient: 5, de_anubis: 5.22, de_cache: 5.5, de_dust2: 4.4, de_inferno: 4.9, de_mirage: 5,
  de_nuke: 7, de_overpass: 5.2, de_train: 4.082077, de_vertigo: 4,
};
const RUN_SPEED = 230; // units/s
const GRENADE_SPEED = 750; // units/s along the drawn throw path
const GAP_S = 0.5; // between one player's actions
const ACTION_S = 0.4; // a drop
// A route picks up a dropped item when it passes within this distance of
// it on the same floor (about a player's width plus a click's slack).
const PICKUP_UNITS = 96;
const unitsPerBoard = (map) => 1024 * (RADAR_SCALE[map] ?? 5);
const levelOf = (x) => (x && x.level) || 'main';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const pathLength = (pts) => pts.slice(1).reduce((n, p, i) => n + dist(pts[i], p), 0);

// One phase's throws and drops per owner, in each player's order (`seq`,
// then board order). Older Phase 14 pickup annotations are ignored: pickups
// now follow from routes. A marker kept from an earlier phase (same id) was
// thrown there.
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
    if (!key || a.type !== 'drop') return;
    items.push({ type: 'drop', id: a.id, key, kind: a.kind, seq: a.seq, n: 1000 + i });
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
  const rank = { drop: 0, throw: 1 };
  return [...byOwner.values()].flat().sort((a, b) => a.step - b.step || rank[a.type] - rank[b.type] || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// Each player's movement: from their marker through their routes on the
// marker's floor, with the time at every point.
function phaseMoves(board, map) {
  const scale = unitsPerBoard(map);
  const moves = new Map();
  for (const m of (board.markers || []).filter((x) => x.kind === 'player')) {
    const key = ownerKey(m);
    if (!key || moves.has(key)) continue;
    const routes = (board.routes || []).filter((r) => ownerKey(r) === key && (r.points || []).length >= 2 && levelOf(r) === levelOf(m));
    const path = [{ x: m.x, y: m.y }, ...routes.flatMap((r) => r.points.map((p) => ({ x: p.x, y: p.y })))];
    const times = [0];
    for (let i = 1; i < path.length; i += 1) times.push(times[i - 1] + (dist(path[i - 1], path[i]) * scale) / RUN_SPEED);
    moves.set(key, { key, markerId: m.id, level: levelOf(m), path, times, end: routes.length ? times[times.length - 1] : 0, routed: routes.length > 0 });
  }
  return moves;
}

// The first time at or after `from` that a player is within r of p (moving
// along their route, then standing at its end), or null.
function firstReach(mv, p, r, from) {
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
    const at = (s) => Math.hypot(wx + vx * s, wy + vy * s);
    if (at(s0) <= r) return t0 + s0;
    const a = vx * vx + vy * vy;
    const b = 2 * (wx * vx + wy * vy);
    const c = wx * wx + wy * wy - r * r;
    const disc = b * b - 4 * a * c;
    if (a > 0 && disc >= 0) {
      const s = (-b - Math.sqrt(disc)) / (2 * a);
      if (s >= s0 && s <= t1 - t0) return t0 + s;
    }
  }
  const last = path[path.length - 1];
  return dist(last, p) <= r ? Math.max(from, mv.end) : null;
}

const roomFor = (c, kind) => c[kind] < BUY_LIMITS[kind] && total(c) < MAX_GRENADES;

// One phase, deterministically: movement, each player's throws and drops in
// order, and route pickups. `start`: what each player carries (Map key ->
// counts, not changed); `ground`: items lying on the map at the start. A
// player picks up a dropped item when their route passes within reach of it
// on the same floor after it lands (not their own drop) and they can carry
// it; when several players reach one item, the earliest takes it (ties: by
// player key). Uncollected items stay for later phases.
function simulatePhase({ board = {}, map = null, start = new Map(), ground = [], seen = new Set() } = {}) {
  const scale = unitsPerBoard(map);
  const reach = PICKUP_UNITS / scale; // board fraction (scale = units per board)
  const moves = phaseMoves(board, map);
  const steps = phaseSteps(board, seen);
  const nextFree = new Map();
  const timed = [];
  for (const s of steps) {
    const begin = nextFree.get(s.key) ?? (moves.get(s.key)?.end ?? 0);
    let end = begin + ACTION_S;
    let path;
    if (s.type === 'throw') {
      const m = board.markers.find((x) => x.id === s.id);
      const mv = moves.get(s.key);
      const from = mv ? mv.path[mv.path.length - 1] : null;
      path = [...(from ? [from] : []), ...((m.path || []).map((p) => ({ x: p.x, y: p.y }))), { x: m.x, y: m.y }];
      end = begin + Math.min(2.2, Math.max(0.5, (pathLength(path) * scale) / GRENADE_SPEED));
    }
    timed.push({ ...s, start: begin, end, path });
    nextFree.set(s.key, end + GAP_S);
  }
  const inv = new Map([...start].map(([k, c]) => [k, { ...c }]));
  const ensure = (k) => { if (!inv.has(k)) inv.set(k, empty()); return inv.get(k); };
  const used = new Map();
  const dropped = new Map();
  const picked = new Map();
  const bump = (m, k, kind) => { if (!m.has(k)) m.set(k, empty()); m.get(k)[kind] += 1; };
  const over = [];
  const pickups = [];
  const blocked = [];
  const items = new Map(); // id -> item on the ground
  const queue = [];
  const candidates = (item, from) => {
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
  // Throws leave the hand at their start; drops land at their end.
  for (const s of timed) queue.push({ t: s.type === 'throw' ? s.start : s.end, rank: 0, key: s.key, id: s.id, type: s.type, step: s });
  const order = (a, b) => a.t - b.t || a.rank - b.rank || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  while (queue.length) {
    queue.sort(order);
    const e = queue.shift();
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
    const s = e.step;
    if (!GRENADES.includes(s.kind)) continue;
    const c = ensure(s.key);
    if (c[s.kind] < 1) {
      over.push({ kind: s.kind, type: s.type === 'throw' ? 'unavailable' : 'drop_unavailable', planned: 1, available: 0, id: s.id, key: s.key });
      // A planned throw still counts as planned (Game Mode shows it); a drop
      // of an item the player hasn't got leaves nothing on the map.
      if (s.type === 'throw') bump(used, s.key, s.kind);
      continue;
    }
    c[s.kind] -= 1;
    bump(s.type === 'throw' ? used : dropped, s.key, s.kind);
    if (s.type === 'drop') {
      const a = (board.actions || []).find((x) => x.id === s.id);
      const item = { id: s.id, kind: s.kind, x: a.x, y: a.y, level: levelOf(a), key: s.key };
      items.set(item.id, item);
      candidates(item, e.t);
    }
  }
  const moveEnd = Math.max(0, ...[...moves.values()].map((m) => m.end));
  const duration = Math.max(moveEnd, ...timed.map((t) => t.end), ...pickups.map((p) => p.t), 0.5);
  return { moves, steps: timed, pickups, blocked, end: inv, ground: [...items.values()], used, dropped, picked, over, duration };
}

// Problems the save path rejects: every drop needs its own id.
function actionErrors(phases) {
  const errors = [];
  const ids = new Set();
  phases.forEach((p, phase) => {
    for (const a of (p.board && p.board.actions) || []) {
      if (a.type !== 'drop') continue;
      if (ids.has(a.id)) errors.push({ phase, id: a.id, message: 'Each drop needs its own id' });
      ids.add(a.id);
    }
  });
  return errors;
}

// The whole tactic, phase by phase with the same simulation as Play Phase:
// what each player carries at the start of every phase, what they throw,
// drop and pick up, and the items still on the ground. Returns the per-phase
// simulations too (Play Phase replays them).
function phasePlan({ loadouts = [], phases = [], side = null, bomb = null, map = null } = {}) {
  const owners = new Map();
  const add = (item) => {
    const key = ownerKey(item);
    if (key && !owners.has(key)) owners.set(key, { user_id: item.user_id ?? null, slot: item.user_id != null ? null : item.slot ?? null });
  };
  loadouts.forEach(add);
  if (side === 'T' && bomb) add(bomb);
  for (const p of phases) {
    for (const m of (p.board && p.board.markers) || []) if (THROWN.includes(m.kind) && !m.reference) add(m);
    for (const a of (p.board && p.board.actions) || []) if (a.type === 'drop') add(a);
    for (const m of (p.board && p.board.markers) || []) if (m.kind === 'player') add(m);
  }
  let inv = new Map();
  const buys = new Map();
  for (const [key] of owners) {
    const l = loadouts.find((x) => ownerKey(x) === key) || {};
    const buy = Object.fromEntries(GRENADES.map((g) => [g, Number(l[g]) || 0]));
    buys.set(key, { buy, kit: side === 'CT' && Boolean(l.kit), cost: buyCost(l, side) });
    inv.set(key, { ...buy });
  }
  const perPhase = new Map([...owners.keys()].map((k) => [k, []]));
  const over = new Map([...owners.keys()].map((k) => [k, []]));
  const seen = new Set();
  let ground = [];
  const grounds = [];
  const sims = [];
  phases.forEach((p, phase) => {
    grounds.push(ground.map((g) => ({ ...g })));
    const sim = simulatePhase({ board: p.board || {}, map, start: inv, ground, seen });
    sims.push(sim);
    for (const o of sim.over) if (over.has(o.key)) over.get(o.key).push({ phase, kind: o.kind, type: o.type, planned: o.planned, available: o.available, id: o.id });
    for (const key of owners.keys()) {
      perPhase.get(key).push({
        start: { ...(inv.get(key) || empty()) },
        used: sim.used.get(key) || empty(),
        dropped: sim.dropped.get(key) || empty(),
        picked: sim.picked.get(key) || empty(),
      });
    }
    inv = new Map([...owners.keys()].map((k) => [k, { ...(sim.end.get(k) || inv.get(k) || empty()) }]));
    ground = sim.ground;
  });
  const players = [...owners.entries()].map(([key, who]) => ({
    key, ...who, ...buys.get(key),
    bomb: side === 'T' && ownerKey(bomb) === key,
    phases: perPhase.get(key),
    over: over.get(key),
  }));
  return { players, grounds, sims, final: ground };
}

// Per-player plan (API, Game Mode).
function utilityPlan(opts = {}) {
  return phasePlan(opts).players;
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
  RADAR_SCALE, RUN_SPEED, GRENADE_SPEED, GAP_S, ACTION_S, PICKUP_UNITS, unitsPerBoard,
  phaseSteps, phaseMoves, firstReach, simulatePhase, phasePlan, actionErrors, plannedThrows, utilityPlan, loadoutsFromThrows,
};
