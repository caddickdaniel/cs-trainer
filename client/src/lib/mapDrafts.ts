// Create Tactic keeps one in-memory draft per map visited, so switching maps
// never carries a board onto a radar it wasn't drawn for. A draft is the
// map-specific part of the tactic: its phases (positions, routes, holds,
// utility and notes with their floors, and per-player instructions), the
// phase being edited and the floor on view. General fields (name, side,
// economy, buy lists, bomb carrier, colours) live outside and carry over.
//
// Nothing here is persisted: the drafts last for the creation flow only, and
// Save submits just the selected map's draft. Self-contained (type imports
// only) so the server tests can load it.
import type { Level } from './constants';
import type { Phase } from './types';

export interface MapDraft { phases: Phase[]; index: number; level: Level }
export type MapDrafts = Record<string, MapDraft>;

/**
 * Stores the current map's draft and returns the one for `to`: the draft
 * saved earlier when that map was visited, or a fresh one the first time.
 */
export function switchMapDraft(drafts: MapDrafts, from: string, current: MapDraft, to: string, fresh: () => MapDraft) {
  const stored = { ...drafts, [from]: current };
  return { drafts: stored, next: to === from ? current : stored[to] ?? fresh() };
}

/** Maps other than `current` that hold work (shown so the user knows they exist). */
export function otherDrafts(drafts: MapDrafts, current: string, hasWork: (d: MapDraft) => boolean) {
  return Object.keys(drafts).filter((m) => m !== current && hasWork(drafts[m]));
}

/** Whether a draft holds anything beyond a single empty phase. */
export function draftHasWork(d: MapDraft) {
  return d.phases.length > 1 || d.phases.some((p) => p.notes.trim() || p.board.markers.length || p.board.routes.length
    || (p.board.holds ?? []).length || p.assignments.some((a) => a.instruction.trim()));
}
