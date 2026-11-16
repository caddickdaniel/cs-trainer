// Time helpers. Events are stored as instants and shown in the viewer's zone.
export const viewerTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function zoneLabel(date = new Date()) {
  const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(date);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  return `${viewerTimeZone()}${name ? ` (${name})` : ''}`;
}

// Dates are always shown as dd/mm/yyyy.
const pad2 = (n: number) => String(n).padStart(2, '0');
export const formatDMY = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
export const formatEventTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${formatDMY(d)}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
};
// "2026-11-20" <-> "20/11/2026" for the event form. Returns null for an
// invalid or impossible date (e.g. 31/02/2026).
export const isoToDMY = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};
export function dmyToIso(text: string): string | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(text);
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

// "2026-11-20" + "18:30" in the viewer's zone -> ISO instant.
export function toInstant(date: string, time: string) {
  return new Date(`${date}T${time}`).toISOString();
}

export function toLocalParts(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

export function countdown(ms: number) {
  if (ms <= 0) return 'starting now';
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  if (d) return `in ${d}d ${h}h`;
  if (h) return `in ${h}h ${min}m`;
  return `in ${Math.max(1, min)} min`;
}
