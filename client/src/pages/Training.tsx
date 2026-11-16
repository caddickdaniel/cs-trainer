import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { EVENT_KINDS, EVENT_LABEL } from '../lib/constants';
import { useDocumentTitle, useLoad } from '../lib/hooks';
import { dmyToIso, formatDMY, formatEventTime, isoToDMY, toInstant, toLocalParts, viewerTimeZone, zoneLabel } from '../lib/time';
import { at, availabilityBody, availabilityError, DEFAULT_EVENT_MINUTES, dayOverview, entriesOnDay, hhmm, rangeLabel, unavailableDuring } from '../lib/availability';
import { paletteHex } from '../lib/playerColors';
import type { Availability, DemoSummary, Member, RosterResponse, TeamEvent } from '../lib/types';
import { Alert, Badge, Loading, NeedsTeam, Panel } from '../components/ui';
import { Icon } from '../components/Icons';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// Entries shown in a day cell before "+N more".
const CELL_LIMIT = 3;

function monthGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday first
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - offset + i));
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
// YYYY-MM-DD in local time (the ?date= parameter and the forms' date).
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseDay = (s: string | null) => {
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

// One form for every calendar entry. Everyone records their own availability;
// the owner and the IGL also see Training, Game and Demo Review.
type EntryKind = 'availability' | TeamEvent['kind'];
type Draft = {
  kind: EntryKind; date: string;
  // availability
  status: Availability['status']; all_day: boolean; start: string; end: string; note: string;
  // events
  title: string; time: string; end_time: string; opponent: string; notes: string; demo_id: number | null;
};
const STATUS_LABEL = { available: 'Available', unavailable: 'Unavailable' } as const;

export const eventTone = (kind: string) => (kind === 'game' ? 'red' : kind === 'demo_review' ? 'green' : 'blue');

function EntryForm({ initial, canManage, lockKind, onSubmit, onCancel, busy, demos, availability, editingTitle }: {
  initial: Draft; canManage: boolean; lockKind: boolean; onSubmit: (d: Draft) => void; onCancel: () => void; busy: boolean;
  demos: DemoSummary[]; availability: Availability[]; editingTitle: string;
}) {
  const [d, setD] = useState(initial);
  // Clicking another day while the form is open moves it there.
  const [lastDate, setLastDate] = useState(initial.date);
  // The date as typed (dd/mm/yyyy); d.date holds it as yyyy-mm-dd once valid.
  const [dateText, setDateText] = useState(isoToDMY(initial.date));
  const [error, setError] = useState<string | null>(null);
  if (initial.date !== lastDate) {
    setLastDate(initial.date);
    setD((cur) => ({ ...cur, date: initial.date }));
    setDateText(isoToDMY(initial.date));
    setError(null);
  }
  const isEvent = d.kind !== 'availability';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const iso = dmyToIso(dateText);
    if (!iso) { setError('Enter the date as dd/mm/yyyy, for example 20/11/2026.'); return; }
    if (!isEvent) {
      const err = availabilityError(d);
      if (err) { setError(err); return; }
    } else if (d.end_time && d.end_time <= d.time) {
      setError('The end time must be after the start time.');
      return;
    }
    onSubmit({ ...d, date: iso });
  };
  // Scheduling conflicts: players who marked themselves unavailable during the event.
  const conflicts = isEvent && d.date && /^\d{2}:\d{2}$/.test(d.time) ? (() => {
    const start = at(d.date, d.time);
    const end = d.end_time && d.end_time > d.time ? at(d.date, d.end_time) : new Date(start.getTime() + DEFAULT_EVENT_MINUTES * 60000);
    return unavailableDuring(availability, start, end);
  })() : [];
  const kinds: EntryKind[] = canManage ? ['availability', ...EVENT_KINDS] : ['availability'];
  return (
    <form className="form compact" onSubmit={submit} aria-label={editingTitle}>
      {kinds.length > 1 && !lockKind ? (
        <div className="segmented" role="group" aria-label="Entry type">
          {kinds.map((k) => (
            <button key={k} type="button" className={d.kind === k ? 'on' : ''} aria-pressed={d.kind === k} onClick={() => setD((cur) => ({ ...cur, kind: k }))}>
              {k === 'availability' ? 'Availability' : EVENT_LABEL[k]}</button>
          ))}
        </div>
      ) : null}
      {!isEvent ? (
        <div className="segmented availability-status" role="group" aria-label="Availability">
          {(['available', 'unavailable'] as const).map((s) => (
            <button key={s} type="button" className={`${s}${d.status === s ? ' on' : ''}`} aria-pressed={d.status === s} onClick={() => setD((cur) => ({ ...cur, status: s }))}>{STATUS_LABEL[s]}</button>
          ))}
        </div>
      ) : <label>Title<input required maxLength={80} value={d.title} onChange={(e) => { const v = e.target.value; setD((cur) => ({ ...cur, title: v })); }} /></label>}
      <label>Date (dd/mm/yyyy)<input required inputMode="numeric" placeholder="dd/mm/yyyy" maxLength={10} value={dateText}
        onChange={(e) => { setDateText(e.target.value); setError(null); const iso = dmyToIso(e.target.value); if (iso) setD((cur) => ({ ...cur, date: iso })); }} /></label>
      {!isEvent ? (
        <>
          <label className="inline-check"><input type="checkbox" checked={d.all_day} onChange={(e) => { const v = e.target.checked; setD((cur) => ({ ...cur, all_day: v })); }} /> All day</label>
          {!d.all_day ? (
            <div className="grid2">
              <label>From<input type="time" required value={d.start} onChange={(e) => { const v = e.target.value; setD((cur) => ({ ...cur, start: v })); setError(null); }} /></label>
              <label>Until<input type="time" required value={d.end} onChange={(e) => { const v = e.target.value; setD((cur) => ({ ...cur, end: v })); setError(null); }} /></label>
            </div>
          ) : null}
          <label>Note (optional)<input maxLength={200} value={d.note} onChange={(e) => { const v = e.target.value; setD((cur) => ({ ...cur, note: v })); }} placeholder="e.g. back from work at 18:00" /></label>
        </>
      ) : (
        <>
          <div className="grid2">
            <label>Start time<input type="time" required value={d.time} onChange={(e) => { const v = e.target.value; setD((cur) => ({ ...cur, time: v })); }} /></label>
            <label>End time (optional)<input type="time" value={d.end_time} onChange={(e) => { const v = e.target.value; setD((cur) => ({ ...cur, end_time: v })); setError(null); }} /></label>
          </div>
          {conflicts.length ? (
            <div className="alert warn" role="status">
              {conflicts.length} player{conflicts.length === 1 ? ' has' : 's have'} marked themselves unavailable during this session: {conflicts.map((c) => c.user_name).join(', ')}.
              {d.end_time ? '' : ` (Checked for ${DEFAULT_EVENT_MINUTES / 60} hours from the start; add an end time to be exact.)`}
            </div>
          ) : null}
          {d.kind === 'demo_review' ? (
            <label>Demo (optional)
              <select value={d.demo_id ?? ''} onChange={(e) => { const v = e.target.value; setD((cur) => ({ ...cur, demo_id: v ? Number(v) : null })); }}>
                <option value="">No demo linked</option>
                {demos.map((x) => <option key={x.demo_id} value={x.demo_id}>{x.title}{x.status !== 'ready' ? ` (${x.status})` : ''}</option>)}
              </select>
              <span className="muted small">Upload demos on the Demo Review page.</span>
            </label>
          ) : null}
          {d.kind === 'game' ? <label>Opponent (optional)<input maxLength={80} value={d.opponent} onChange={(e) => { const v = e.target.value; setD((cur) => ({ ...cur, opponent: v })); }} /></label> : null}
          <label>{d.kind === 'game' ? 'Details (optional)' : d.kind === 'demo_review' ? 'What to look at (optional)' : 'Practice notes (optional)'}
            <textarea rows={3} maxLength={2000} value={d.notes} onChange={(e) => { const v = e.target.value; setD((cur) => ({ ...cur, notes: v })); }} /></label>
        </>
      )}
      <p className="muted small">Times are in your time zone: {zoneLabel()}.</p>
      <Alert>{error}</Alert>
      <div className="row">
        <button className="btn primary" disabled={busy}>Save</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

type Editing = { event?: TeamEvent; availability?: Availability; date?: string; kind?: EntryKind } | null;

function Calendar({ teamId }: { teamId: number }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const data = useLoad(() => api.get<{ events: TeamEvent[]; can_manage: boolean }>(`/teams/${teamId}/events`), [teamId]);
  const avail = useLoad(() => api.get<{ availability: Availability[]; can_manage_events: boolean }>(`/teams/${teamId}/availability`), [teamId]);
  const roster = useLoad(() => api.get<RosterResponse>(`/teams/${teamId}/roster`), [teamId]);
  const demoList = useLoad(() => api.get<{ demos: DemoSummary[] }>(`/teams/${teamId}/demos`), [teamId]);
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedId = Number(params.get('event')) || null;
  const selectedDay = parseDay(params.get('date'));
  const events = useMemo(() => data.data?.events ?? [], [data.data]);
  const availability = useMemo(() => avail.data?.availability ?? [], [avail.data]);
  const members: Member[] = useMemo(() => roster.data?.members ?? [], [roster.data]);
  const colorOf = (userId: number) => members.find((m) => m.user_id === userId)?.game_color ?? null;
  const byDay = useMemo(() => {
    const map = new Map<string, TeamEvent[]>();
    events.forEach((e) => {
      const key = dayKey(new Date(e.starts_at));
      map.set(key, [...(map.get(key) ?? []), e]);
    });
    return map;
  }, [events]);
  const selected = events.find((e) => e.event_id === selectedId) ?? null;
  const canManage = Boolean(data.data?.can_manage);
  const upcoming = events.filter((e) => new Date(e.starts_at) > new Date()).slice(0, 8);
  const me = user?.user_id ?? 0;

  const save = async (d: Draft) => {
    setBusy(true);
    setError(null);
    try {
      if (d.kind === 'availability') {
        const body = availabilityBody({ ...d, day: d.date }, viewerTimeZone());
        if (editing?.availability) await api.patch(`/teams/${teamId}/availability/${editing.availability.availability_id}`, body);
        else await api.post(`/teams/${teamId}/availability`, body);
        setEditing(null);
        await avail.reload();
        setParams({ date: d.date });
      } else {
        const body = {
          kind: d.kind, title: d.title, starts_at: toInstant(d.date, d.time), ends_at: d.end_time ? toInstant(d.date, d.end_time) : null, time_zone: viewerTimeZone(),
          opponent: d.kind === 'game' ? d.opponent || null : null, notes: d.notes, demo_id: d.kind === 'demo_review' ? d.demo_id : null,
        };
        const res = editing?.event
          ? await api.patch<{ event: TeamEvent }>(`/teams/${teamId}/events/${editing.event.event_id}`, body)
          : await api.post<{ event: TeamEvent }>(`/teams/${teamId}/events`, body);
        setEditing(null);
        await data.reload();
        setParams({ event: String(res.event.event_id), date: toLocalParts(res.event.starts_at).date });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (e: TeamEvent) => {
    if (!window.confirm(`Remove "${e.title}" from the calendar? Your team will be notified.`)) return;
    try {
      await api.delete(`/teams/${teamId}/events/${e.event_id}`);
      setParams(selectedDay ? { date: isoDay(selectedDay) } : {});
      await data.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const removeAvailability = async (a: Availability) => {
    if (!window.confirm(`Delete your ${STATUS_LABEL[a.status].toLowerCase()} entry for ${formatDMY(new Date(a.starts_at))}?`)) return;
    try {
      await api.delete(`/teams/${teamId}/availability/${a.availability_id}`);
      await avail.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if ((data.loading && !data.data) || (avail.loading && !avail.data)) return <Loading />;
  const grid = monthGrid(cursor.y, cursor.m);
  const monthName = new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const draftFor = (ed: NonNullable<Editing>): Draft => {
    const base: Draft = {
      kind: ed.kind ?? 'availability', date: ed.date ?? toLocalParts(new Date().toISOString()).date,
      status: 'available', all_day: true, start: '18:00', end: '23:00', note: '',
      title: '', time: '19:00', end_time: '', opponent: '', notes: '', demo_id: null,
    };
    if (ed.event) {
      const p = toLocalParts(ed.event.starts_at);
      return { ...base, kind: ed.event.kind, date: p.date, title: ed.event.title, time: p.time, end_time: ed.event.ends_at ? toLocalParts(ed.event.ends_at).time : '',
        opponent: ed.event.opponent ?? '', notes: ed.event.notes, demo_id: ed.event.demo_id };
    }
    if (ed.availability) {
      const a = ed.availability;
      return { ...base, kind: 'availability', date: a.day, status: a.status, all_day: a.all_day,
        start: a.all_day ? base.start : hhmm(new Date(a.starts_at)), end: a.all_day ? base.end : hhmm(new Date(a.ends_at)), note: a.note };
    }
    return base;
  };

  // Click (or Enter on a focused day): select that date and show what's on it.
  // While the form is open for a new entry, it moves to that date.
  const selectDay = (day: Date) => {
    const date = isoDay(day);
    if (day.getMonth() !== cursor.m || day.getFullYear() !== cursor.y) setCursor({ y: day.getFullYear(), m: day.getMonth() });
    if (editing && !editing.event && !editing.availability) setEditing({ ...editing, date });
    setParams({ date });
  };
  // Double-click: open a new entry on that date (events for the owner / IGL,
  // availability for everyone else).
  const addOnDay = (day: Date) => {
    selectDay(day);
    setEditing({ date: isoDay(day), kind: canManage ? 'training' : 'availability' });
  };
  const dayEvents = selectedDay ? byDay.get(dayKey(selectedDay)) ?? [] : [];
  const openEvent = (e: TeamEvent) => setParams({ event: String(e.event_id), date: toLocalParts(e.starts_at).date });
  const eventDetails = (ev: TeamEvent, heading = false) => (
    <div className="cal-event-details" key={ev.event_id}>
      {heading ? <h3>{ev.title}</h3> : null}
      <p><Badge tone={eventTone(ev.kind)}>{EVENT_LABEL[ev.kind]}</Badge></p>
      <p className="big">{formatEventTime(ev.starts_at)}{ev.ends_at ? `–${time(ev.ends_at)}` : ''}</p>
      <p className="muted small">Your time ({zoneLabel(new Date(ev.starts_at))}). Entered in {ev.time_zone}.</p>
      {ev.opponent ? <p><strong>Opponent:</strong> {ev.opponent}</p> : null}
      {ev.notes ? <p className="bio">{ev.notes}</p> : null}
      {ev.kind === 'demo_review' ? (
        ev.demo ? (
          <p><Link className="btn" to={`/demos/${ev.demo.demo_id}`}><Icon name="demo" /> Open demo: {ev.demo.title}</Link>
            {ev.demo.status !== 'ready' ? <span className="muted small"> ({ev.demo.status})</span> : null}</p>
        ) : <p className="muted small">No demo linked{ev.demo_id ? ' (the linked demo was deleted)' : ''}.</p>
      ) : null}
      {(() => {
        const start = new Date(ev.starts_at);
        const end = ev.ends_at ? new Date(ev.ends_at) : new Date(start.getTime() + DEFAULT_EVENT_MINUTES * 60000);
        const out = unavailableDuring(availability, start, end);
        return out.length ? <p className="warn-text small">{out.length} player{out.length === 1 ? ' is' : 's are'} marked unavailable: {out.map((o) => o.user_name).join(', ')}.</p> : null;
      })()}
      {canManage ? (
        <div className="row">
          <button type="button" className="btn" onClick={() => setEditing({ event: ev })}><Icon name="edit" /> Edit</button>
          <button type="button" className="btn ghost danger" onClick={() => remove(ev)}><Icon name="trash" /> Remove</button>
        </div>
      ) : null}
    </div>
  );
  const overview = selectedDay ? dayOverview(members, availability, isoDay(selectedDay)) : [];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <p className="muted">Shown in your time zone: {zoneLabel()}</p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => setEditing({ date: selectedDay ? isoDay(selectedDay) : undefined, kind: 'availability' })}>
            <Icon name="plus" /> Add availability</button>
          <button type="button" className="btn primary" disabled={!canManage} title={canManage ? undefined : 'Only the team owner or the IGL can add events'}
            onClick={() => setEditing({ date: selectedDay ? isoDay(selectedDay) : undefined, kind: 'training' })}><Icon name="plus" /> Add event</button>
        </div>
      </div>
      <Alert>{error ?? data.error ?? avail.error}</Alert>
      <div className="board-layout">
        <Panel title={monthName} actions={(
          <>
            <button type="button" className="btn ghost small" aria-label="Previous month" onClick={() => setCursor(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))}><Icon name="left" /></button>
            <button type="button" className="btn ghost small" onClick={() => setCursor({ y: today.getFullYear(), m: today.getMonth() })}>Today</button>
            <button type="button" className="btn ghost small" aria-label="Next month" onClick={() => setCursor(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))}><Icon name="right" /></button>
          </>
        )}>
          <div className="calendar" role="grid" aria-label={monthName}>
            {WEEKDAYS.map((d) => <div key={d} className="cal-head" role="columnheader">{d}</div>)}
            {grid.map((day) => {
              const items = byDay.get(dayKey(day)) ?? [];
              const free = entriesOnDay(availability, isoDay(day));
              const outside = day.getMonth() !== cursor.m;
              const isToday = dayKey(day) === dayKey(today);
              const isSelected = selectedDay != null && dayKey(day) === dayKey(selectedDay);
              // Events first (by time), then availability, compacted to CELL_LIMIT.
              const all = [...items.map((e) => ({ kind: 'event' as const, e, at: e.starts_at })), ...free.map((a) => ({ kind: 'availability' as const, a, at: a.starts_at }))];
              const shown = all.slice(0, CELL_LIMIT);
              const more = all.length - shown.length;
              return (
                <div key={day.toISOString()} role="gridcell" tabIndex={0} aria-selected={isSelected}
                  aria-label={`${day.toLocaleDateString(undefined, { weekday: 'long' })} ${formatDMY(day)}${isToday ? ', today' : ''}${items.length ? `, ${items.length} event${items.length === 1 ? '' : 's'}` : ''}${free.length ? `, ${free.length} availability entr${free.length === 1 ? 'y' : 'ies'}` : ''}`}
                  className={`cal-day${outside ? ' outside' : ''}${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}`} data-date={isoDay(day)}
                  onClick={() => selectDay(day)} onDoubleClick={() => addOnDay(day)}
                  onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); selectDay(day); } }}>
                  <span className="cal-num">{day.getDate()}</span>
                  {shown.map((it) => (it.kind === 'event' ? (
                    <button key={`e${it.e.event_id}`} type="button" className={`cal-event ${it.e.kind}${it.e.event_id === selectedId ? ' on' : ''}`}
                      onClick={(ev) => { ev.stopPropagation(); openEvent(it.e); }} onDoubleClick={(ev) => ev.stopPropagation()}
                      title={`${time(it.e.starts_at)} ${it.e.title} (${EVENT_LABEL[it.e.kind]})`}>
                      {time(it.e.starts_at)} {it.e.title}
                    </button>
                  ) : (
                    <span key={`a${it.a.availability_id}`} className={`cal-avail ${it.a.status}`} title={`${it.a.user.user_name}: ${STATUS_LABEL[it.a.status]} ${rangeLabel(it.a)}${it.a.note ? ` (${it.a.note})` : ''}`}>
                      <span className="cal-avail__dot" style={colorOf(it.a.user.user_id) ? { background: paletteHex(colorOf(it.a.user.user_id)!) } : undefined} />
                      {it.a.status === 'available' ? '✓' : '✕'} {it.a.user.user_name} <span className="cal-avail__time">{it.a.all_day ? 'all day' : rangeLabel(it.a)}</span>
                    </span>
                  )))}
                  {more > 0 ? (
                    <button type="button" className="cal-more" onClick={(ev) => { ev.stopPropagation(); selectDay(day); }} onDoubleClick={(ev) => ev.stopPropagation()}>
                      +{more} more</button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="muted small cal-legend">
            <span className="legend-dot training" /> Training <span className="legend-dot game" /> Game <span className="legend-dot demo_review" /> Demo Review
            <span className="cal-avail available inline">✓ Available</span> <span className="cal-avail unavailable inline">✕ Unavailable</span>
            {canManage ? ' · Click a day to see it; double-click to add an event on it.' : ' · Click a day to see it; double-click to add your availability on it.'}
          </p>
        </Panel>
        <div className="stack">
          {editing ? (
            <Panel title={editing.event ? 'Edit event' : editing.availability ? 'Edit availability' : 'Add calendar entry'}>
              <EntryForm key={editing.event?.event_id ?? editing.availability?.availability_id ?? `new-${editing.kind}`} initial={draftFor(editing)}
                canManage={canManage} lockKind={Boolean(editing.event || editing.availability)} onSubmit={save} onCancel={() => setEditing(null)} busy={busy}
                demos={demoList.data?.demos ?? []} availability={availability} editingTitle={editing.event ? 'Edit event' : 'Calendar entry'} />
            </Panel>
          ) : selected ? (
            <Panel title={selected.title} actions={<button type="button" className="btn ghost small" onClick={() => setParams(selectedDay ? { date: isoDay(selectedDay) } : {})}>Close</button>}>
              {eventDetails(selected)}
            </Panel>
          ) : null}
          {selectedDay && !editing ? (
            <Panel title={`${selectedDay.toLocaleDateString(undefined, { weekday: 'long' })} ${formatDMY(selectedDay)}`} className="cal-day-pane"
              actions={<button type="button" className="btn ghost small" onClick={() => setParams({})}>Close</button>}>
              {!selected ? (dayEvents.length ? dayEvents.map((e) => eventDetails(e, true)) : <p className="muted">No team events on this day.</p>) : null}
              <h3 className="cal-subhead">Team availability</h3>
              <table className="table compact availability-table">
                <thead><tr><th>Player</th><th>Availability</th><th>Time</th><th /></tr></thead>
                <tbody>
                  {overview.map((row) => (row.entries.length ? row.entries.map((a, i) => (
                    <tr key={a.availability_id} className={a.status}>
                      <td>{i === 0 ? <><span className="cal-avail__dot" style={row.member.game_color ? { background: paletteHex(row.member.game_color) } : undefined} /> {row.member.user_name}</> : null}</td>
                      <td><span className={`avail-pill ${a.status}`}>{STATUS_LABEL[a.status]}</span>{a.note ? <div className="muted small">{a.note}</div> : null}</td>
                      <td>{rangeLabel(a)}</td>
                      <td className="right">{a.user.user_id === me ? (
                        <span className="row tight">
                          <button type="button" className="btn ghost small" aria-label="Edit your availability" onClick={() => setEditing({ availability: a })}><Icon name="edit" size={14} /></button>
                          <button type="button" className="btn ghost small danger" aria-label="Delete your availability" onClick={() => removeAvailability(a)}><Icon name="trash" size={14} /></button>
                        </span>
                      ) : null}</td>
                    </tr>
                  )) : (
                    <tr key={`none-${row.member.user_id}`} className="none">
                      <td><span className="cal-avail__dot" style={row.member.game_color ? { background: paletteHex(row.member.game_color) } : undefined} /> {row.member.user_name}</td>
                      <td><span className="avail-pill none">Not specified</span></td>
                      <td>—</td>
                      <td />
                    </tr>
                  )))}
                </tbody>
              </table>
              <p className="muted small">A player with no entry is shown as not specified, not as available.</p>
              <div className="row wrap">
                <button type="button" className="btn" onClick={() => setEditing({ date: isoDay(selectedDay), kind: 'availability' })}><Icon name="plus" /> Add my availability</button>
                {canManage ? <button type="button" className="btn" onClick={() => setEditing({ date: isoDay(selectedDay), kind: 'training' })}><Icon name="plus" /> Add event on this day</button> : null}
              </div>
            </Panel>
          ) : null}
          <Panel title="Upcoming">
            {upcoming.length ? (
              <ul className="plain-list">
                {upcoming.map((e) => (
                  <li key={e.event_id}>
                    <button type="button" className="linkish" onClick={() => openEvent(e)}>{e.title}</button>
                    {' '}<span className="muted small">{EVENT_LABEL[e.kind]} · {formatEventTime(e.starts_at)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Nothing scheduled{canManage ? '. Add the first event.' : '.'}</p>}
          </Panel>
          {selectedId && !selected && !data.loading ? <Alert kind="info">That event is no longer on the calendar.</Alert> : null}
        </div>
      </div>
    </div>
  );
}

// The team calendar (route /training, shown as Calendar).
export function TrainingPage() {
  useDocumentTitle('Calendar');
  const { active_team: team } = useAuth();
  if (!team) return <NeedsTeam what="Calendars" />;
  return <Calendar teamId={team.team_id} />;
}
