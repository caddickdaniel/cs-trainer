// Time helpers. Events are stored as instants and shown in the viewer's zone.
export const viewerTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function zoneLabel(date = new Date()) {
  const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(date);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  return `${viewerTimeZone()}${name ? ` (${name})` : ''}`;
}

export const formatEventTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

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
