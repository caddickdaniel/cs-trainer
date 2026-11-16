// Player availability on the team calendar (Phase 10): local-day bounds,
// time ranges, the per-day team overview and scheduling conflicts. Pure (type
// imports only) so the server tests can load it.
import type { Availability } from './types';

const pad = (n: number) => String(n).padStart(2, '0');
// YYYY-MM-DD -> local midnight at the start of that day, and of the next.
export function dayBounds(day: string): { start: Date; end: Date } {
  const [y, m, d] = day.split('-').map(Number);
  return { start: new Date(y, m - 1, d), end: new Date(y, m - 1, d + 1) };
}
// Local date + "HH:MM" -> Date.
export const at = (day: string, time: string) => {
  const [y, m, d] = day.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, min);
};
export const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// The body sent to the API for an entry (all-day = local midnight to midnight).
export function availabilityBody(e: { status: Availability['status']; all_day: boolean; day: string; start: string; end: string; note: string }, timeZone: string) {
  const range = e.all_day ? dayBounds(e.day) : { start: at(e.day, e.start), end: at(e.day, e.end) };
  return { status: e.status, all_day: e.all_day, day: e.day, starts_at: range.start.toISOString(), ends_at: range.end.toISOString(), time_zone: timeZone, note: e.note };
}
// Validation for the form: an end time after the start when not all day.
export function availabilityError(e: { all_day: boolean; start: string; end: string }) {
  if (e.all_day) return null;
  if (!/^\d{2}:\d{2}$/.test(e.start) || !/^\d{2}:\d{2}$/.test(e.end)) return 'Enter a start and an end time.';
  if (e.end <= e.start) return 'The end time must be after the start time.';
  return null;
}

export const rangeLabel = (a: Pick<Availability, 'all_day' | 'starts_at' | 'ends_at'>) =>
  (a.all_day ? 'All day' : `${hhmm(new Date(a.starts_at))}–${hhmm(new Date(a.ends_at))}`);

const overlaps = (a: Pick<Availability, 'starts_at' | 'ends_at'>, start: Date, end: Date) =>
  new Date(a.starts_at).getTime() < end.getTime() && new Date(a.ends_at).getTime() > start.getTime();

// Entries touching a local day, in start order.
export const entriesOnDay = (list: Availability[], day: string) => {
  const { start, end } = dayBounds(day);
  return list.filter((a) => a.day === day || overlaps(a, start, end)).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
};

// One row per member for a day: what they submitted, or "not specified"
// (no entry is never treated as available).
export type DayStatus = 'available' | 'unavailable' | 'mixed' | 'none';
export function dayOverview<M extends { user_id: number; user_name: string }>(members: M[], list: Availability[], day: string) {
  const onDay = entriesOnDay(list, day);
  return members.map((m) => {
    const mine = onDay.filter((a) => a.user.user_id === m.user_id);
    const statuses = new Set(mine.map((a) => a.status));
    const status: DayStatus = !mine.length ? 'none' : statuses.size > 1 ? 'mixed' : (mine[0].status as DayStatus);
    return { member: m, status, entries: mine };
  });
}

// Members who marked themselves unavailable during [start, end).
export function unavailableDuring(list: Availability[], start: Date, end: Date) {
  const ids = new Map<number, string>();
  for (const a of list) if (a.status === 'unavailable' && overlaps(a, start, end)) ids.set(a.user.user_id, a.user.user_name ?? `Player ${a.user.user_id}`);
  return [...ids.entries()].map(([user_id, user_name]) => ({ user_id, user_name }));
}
// Default length assumed for an event without an end time, for conflict checks.
export const DEFAULT_EVENT_MINUTES = 120;
