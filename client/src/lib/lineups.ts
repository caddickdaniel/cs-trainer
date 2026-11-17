// Lineup picker (Phase 15): catalogue entries (GET /api/lineups, from
// domain/lineups.js) are attributed links to individual CSNADES.gg lineups
// with radar positions. The editor picks a utility type and player, clicks
// where the utility should land, and is shown the matching throw origins
// (same map, floor, utility and side, landing within a small tolerance).
// Applying one places the player at the lineup's start, adds the throw at
// its landing point with the reference, and for running throws adds the
// run-up from the start to the release point as the player's route.
// Type imports only, so the server tests can load it.
import type { Board, LineupRef, Marker, PlayerRef, Point, Route } from './types';

export interface LineupEntry {
  id: string; map: string; level: string; utility: 'smoke' | 'flash' | 'molly' | 'he'; side: 'T' | 'CT';
  title: string; technique: string; instructions?: string; start: Point; release: Point; landing: Point;
  url: string; source: 'CSNADES.gg'; moving: boolean; measured?: string;
}

// Map-relative tolerance around the clicked landing point (fraction of the
// radar width, about 250 units on a 5-scale map).
export const LINEUP_TOLERANCE = 0.05;

export function nearLineups(entries: LineupEntry[], at: Point, f: { utility: string; side: string | null; level: string }, tolerance = LINEUP_TOLERANCE) {
  return entries
    .filter((e) => e.utility === f.utility && (!f.side || e.side === f.side) && e.level === f.level)
    .map((e) => ({ e, d: Math.hypot(e.landing.x - at.x, e.landing.y - at.y) }))
    .filter((x) => x.d <= tolerance)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.e);
}

export const TECHNIQUE_LABEL: Record<string, string> = {
  stationary: 'Standing throw', jump: 'Jump throw (standing)', walk: 'Walking throw', run: 'Running throw', 'run-jump': 'Run-jump throw',
};

export const lineupRef = (e: LineupEntry): LineupRef => ({
  id: e.id, title: e.title, url: e.url, source: 'CSNADES.gg', technique: e.technique, ...(e.instructions ? { instructions: e.instructions } : {}),
});

const sameOwner = (a: { user_id: number | null; slot?: number | null }, who: PlayerRef) => (who.user_id != null ? a.user_id === who.user_id : a.user_id == null && (a.slot ?? null) === (who.slot ?? null));
const pct = (p: Point) => `${Math.round(p.x * 100)}%, ${Math.round(p.y * 100)}%`;

export interface LineupPlan { board: Board; changes: string[]; conflicts: string[] }

// What applying a lineup does to a phase's board, described before it's
// applied. newId: id factory (passed in so this stays type-only).
export function applyLineup(board: Board, e: LineupEntry, who: PlayerRef, name: string, newId: (prefix: string) => string, seq: number): LineupPlan {
  const changes: string[] = [];
  const conflicts: string[] = [];
  const level = e.level as Marker['level'];
  const existing = board.markers.find((m) => m.kind === 'player' && sameOwner(m, who));
  let markers = board.markers;
  if (existing) {
    const moved = Math.hypot(existing.x - e.start.x, existing.y - e.start.y) > 0.002 || (existing.level ?? 'main') !== e.level;
    if (moved) {
      changes.push(`Moves ${name}'s marker from ${pct(existing)} to the lineup start (${pct(e.start)}).`);
      markers = markers.map((m) => (m.id === existing.id ? { ...m, x: e.start.x, y: e.start.y, level } : m));
    } else changes.push(`${name} is already at the lineup start.`);
  } else {
    changes.push(`Places ${name} at the lineup start (${pct(e.start)}).`);
    markers = [...markers, { id: newId('m'), kind: 'player', x: e.start.x, y: e.start.y, level, user_id: who.user_id ?? null, slot: who.user_id != null ? null : who.slot ?? null, label: '', images: [] }];
  }
  let routes = board.routes;
  const mine = routes.filter((r) => sameOwner(r, who));
  if (e.moving) {
    if (mine.length) conflicts.push(`${name}'s ${mine.length === 1 ? 'route' : `${mine.length} routes`} in this phase will be replaced by the run-up from the start to the release point.`);
    const run: Route = { id: newId('r'), level, user_id: who.user_id ?? null, slot: who.user_id != null ? null : who.slot ?? null, color: '#ffffff', points: [{ ...e.start }, { ...e.release }] };
    routes = [...routes.filter((r) => !sameOwner(r, who)), run];
    changes.push(`Adds the run-up from the start to the release point (${pct(e.release)}); the throw leaves from there.`);
  } else if (mine.length && existing && (Math.hypot(existing.x - e.start.x, existing.y - e.start.y) > 0.002)) {
    conflicts.push(`${name}'s existing ${mine.length === 1 ? 'route starts' : 'routes start'} from their old position; Play Phase will run it from the lineup start instead.`);
  }
  const throwMarker: Marker = {
    id: newId('m'), kind: e.utility, x: e.landing.x, y: e.landing.y, level, user_id: who.user_id ?? null, slot: who.user_id != null ? null : who.slot ?? null,
    label: '', images: [], seq, lineup: lineupRef(e),
  };
  changes.push(`Adds the ${e.utility === 'molly' ? 'molotov' : e.utility} landing at ${pct(e.landing)}, linked to "${e.title}" on CSNADES.gg.`);
  return { board: { ...board, markers: [...markers, throwMarker], routes }, changes, conflicts };
}
