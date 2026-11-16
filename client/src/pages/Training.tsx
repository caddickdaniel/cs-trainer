import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { EVENT_KINDS, EVENT_LABEL } from '../lib/constants';
import { useDocumentTitle, useLoad } from '../lib/hooks';
import { dmyToIso, formatDMY, formatEventTime, isoToDMY, toInstant, toLocalParts, viewerTimeZone, zoneLabel } from '../lib/time';
import type { DemoSummary, TeamEvent } from '../lib/types';
import { Alert, Badge, Loading, NeedsTeam, Panel } from '../components/ui';
import { Icon } from '../components/Icons';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function monthGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday first
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - offset + i));
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
// YYYY-MM-DD in local time (the ?date= parameter and the event form's date).
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseDay = (s: string | null) => {
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

type Draft = { kind: TeamEvent['kind']; title: string; date: string; time: string; opponent: string; notes: string; demo_id: number | null };

export const eventTone = (kind: string) => (kind === 'game' ? 'red' : kind === 'demo_review' ? 'green' : 'blue');

function EventForm({ initial, onSubmit, onCancel, busy, demos }: {
  initial: Draft; onSubmit: (d: Draft) => void; onCancel: () => void; busy: boolean; demos: DemoSummary[];
}) {
  const [d, setD] = useState(initial);
  // Double-clicking another day while adding an event moves the new event there.
  const [lastDate, setLastDate] = useState(initial.date);
  // The date as typed (dd/mm/yyyy); d.date holds it as yyyy-mm-dd once valid.
  const [dateText, setDateText] = useState(isoToDMY(initial.date));
  const [dateError, setDateError] = useState<string | null>(null);
  if (initial.date !== lastDate) {
    setLastDate(initial.date);
    setD({ ...d, date: initial.date });
    setDateText(isoToDMY(initial.date));
    setDateError(null);
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const iso = dmyToIso(dateText);
    if (!iso) { setDateError('Enter the date as dd/mm/yyyy, for example 20/11/2026.'); return; }
    onSubmit({ ...d, date: iso });
  };
  return (
    <form className="form compact" onSubmit={submit}>
      <div className="segmented" role="group" aria-label="Event type">
        {EVENT_KINDS.map((k) => (
          <button key={k} type="button" className={d.kind === k ? 'on' : ''} aria-pressed={d.kind === k} onClick={() => setD({ ...d, kind: k })}>{EVENT_LABEL[k]}</button>
        ))}
      </div>
      <label>Title<input required maxLength={80} value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} /></label>
      <div className="grid2">
        <label>Date (dd/mm/yyyy)<input required inputMode="numeric" placeholder="dd/mm/yyyy" maxLength={10} value={dateText} aria-invalid={dateError ? true : undefined}
          onChange={(e) => { setDateText(e.target.value); setDateError(null); const iso = dmyToIso(e.target.value); if (iso) setD({ ...d, date: iso }); }} />
          {dateError ? <span className="error-text">{dateError}</span> : null}</label>
        <label>Start time<input type="time" required value={d.time} onChange={(e) => setD({ ...d, time: e.target.value })} /></label>
      </div>
      <p className="muted small">Times are in your time zone: {zoneLabel()}.</p>
      {d.kind === 'demo_review' ? (
        <label>Demo (optional)
          <select value={d.demo_id ?? ''} onChange={(e) => setD({ ...d, demo_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">No demo linked</option>
            {demos.map((x) => <option key={x.demo_id} value={x.demo_id}>{x.title}{x.status !== 'ready' ? ` (${x.status})` : ''}</option>)}
          </select>
          <span className="muted small">Upload demos on the Demo Review page.</span>
        </label>
      ) : null}
      {d.kind === 'game' ? <label>Opponent (optional)<input maxLength={80} value={d.opponent} onChange={(e) => setD({ ...d, opponent: e.target.value })} /></label> : null}
      <label>{d.kind === 'game' ? 'Details (optional)' : d.kind === 'demo_review' ? 'What to look at (optional)' : 'Practice notes (optional)'}
        <textarea rows={3} maxLength={2000} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} /></label>
      <div className="row">
        <button className="btn primary" disabled={busy}>Save event</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function Calendar({ teamId }: { teamId: number }) {
  const [params, setParams] = useSearchParams();
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const data = useLoad(() => api.get<{ events: TeamEvent[]; can_manage: boolean }>(`/teams/${teamId}/events`), [teamId]);
  const demoList = useLoad(() => api.get<{ demos: DemoSummary[] }>(`/teams/${teamId}/demos`), [teamId]);
  const [editing, setEditing] = useState<{ event?: TeamEvent; date?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedId = Number(params.get('event')) || null;
  const selectedDay = parseDay(params.get('date'));
  const events = useMemo(() => data.data?.events ?? [], [data.data]);
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

  const save = async (d: Draft) => {
    setBusy(true);
    setError(null);
    const body = {
      kind: d.kind, title: d.title, starts_at: toInstant(d.date, d.time), time_zone: viewerTimeZone(),
      opponent: d.kind === 'game' ? d.opponent || null : null, notes: d.notes, demo_id: d.kind === 'demo_review' ? d.demo_id : null,
    };
    try {
      const res = editing?.event
        ? await api.patch<{ event: TeamEvent }>(`/teams/${teamId}/events/${editing.event.event_id}`, body)
        : await api.post<{ event: TeamEvent }>(`/teams/${teamId}/events`, body);
      setEditing(null);
      await data.reload();
      setParams({ event: String(res.event.event_id), date: toLocalParts(res.event.starts_at).date });
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
      setParams({});
      await data.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (data.loading && !data.data) return <Loading />;
  const grid = monthGrid(cursor.y, cursor.m);
  const monthName = new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const draftFor = (ev?: TeamEvent, date?: string): Draft => {
    if (ev) {
      const p = toLocalParts(ev.starts_at);
      return { kind: ev.kind, title: ev.title, date: p.date, time: p.time, opponent: ev.opponent ?? '', notes: ev.notes, demo_id: ev.demo_id };
    }
    return { kind: 'training', title: '', date: date ?? toLocalParts(new Date().toISOString()).date, time: '19:00', opponent: '', notes: '', demo_id: null };
  };

  // Click (or Enter on a focused day): select that date and show its events
  // in the right-hand pane. While adding an event, the form moves to that date.
  const selectDay = (day: Date) => {
    const date = isoDay(day);
    if (day.getMonth() !== cursor.m || day.getFullYear() !== cursor.y) setCursor({ y: day.getFullYear(), m: day.getMonth() });
    if (editing && !editing.event) setEditing({ date });
    setParams({ date });
  };
  // Double-click: select the day and open a new event on that date (owners).
  const addOnDay = (day: Date) => {
    selectDay(day);
    if (canManage) setEditing({ date: isoDay(day) });
  };
  const eventDetails = (ev: TeamEvent, heading = false) => (
    <div className="cal-event-details" key={ev.event_id}>
      {heading ? <h3>{ev.title}</h3> : null}
      <p><Badge tone={eventTone(ev.kind)}>{EVENT_LABEL[ev.kind]}</Badge></p>
      <p className="big">{formatEventTime(ev.starts_at)}</p>
      <p className="muted small">Your time ({zoneLabel(new Date(ev.starts_at))}). Entered in {ev.time_zone}.</p>
      {ev.opponent ? <p><strong>Opponent:</strong> {ev.opponent}</p> : null}
      {ev.notes ? <p className="bio">{ev.notes}</p> : null}
      {ev.kind === 'demo_review' ? (
        ev.demo ? (
          <p><Link className="btn" to={`/demos/${ev.demo.demo_id}`}><Icon name="demo" /> Open demo: {ev.demo.title}</Link>
            {ev.demo.status !== 'ready' ? <span className="muted small"> ({ev.demo.status})</span> : null}</p>
        ) : <p className="muted small">No demo linked{ev.demo_id ? ' (the linked demo was deleted)' : ''}.</p>
      ) : null}
      {canManage ? (
        <div className="row">
          <button type="button" className="btn" onClick={() => setEditing({ event: ev })}><Icon name="edit" /> Edit</button>
          <button type="button" className="btn ghost danger" onClick={() => remove(ev)}><Icon name="trash" /> Remove</button>
        </div>
      ) : null}
    </div>
  );
  const dayEvents = selectedDay ? byDay.get(dayKey(selectedDay)) ?? [] : [];
  const openEvent = (e: TeamEvent) => setParams({ event: String(e.event_id), date: toLocalParts(e.starts_at).date });

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <p className="muted">Shown in your time zone: {zoneLabel()}</p>
        </div>
        <button type="button" className="btn primary" disabled={!canManage} title={canManage ? undefined : 'Only the team owner can add events'}
          onClick={() => setEditing({ date: selectedDay ? isoDay(selectedDay) : undefined })}><Icon name="plus" /> Add event</button>
      </div>
      <Alert>{error ?? data.error}</Alert>
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
              const outside = day.getMonth() !== cursor.m;
              const isToday = dayKey(day) === dayKey(today);
              const isSelected = selectedDay != null && dayKey(day) === dayKey(selectedDay);
              return (
                <div key={day.toISOString()} role="gridcell" tabIndex={0} aria-selected={isSelected}
                  aria-label={`${day.toLocaleDateString(undefined, { weekday: 'long' })} ${formatDMY(day)}${isToday ? ', today' : ''}${items.length ? `, ${items.length} event${items.length === 1 ? '' : 's'}` : ''}`}
                  className={`cal-day${outside ? ' outside' : ''}${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}`} data-date={isoDay(day)}
                  onClick={() => selectDay(day)} onDoubleClick={() => addOnDay(day)}
                  onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); selectDay(day); } }}>
                  <span className="cal-num">{day.getDate()}</span>
                  {items.map((e) => (
                    <button key={e.event_id} type="button" className={`cal-event ${e.kind}${e.event_id === selectedId ? ' on' : ''}`}
                      onClick={(ev) => { ev.stopPropagation(); openEvent(e); }} onDoubleClick={(ev) => ev.stopPropagation()}>
                      {new Date(e.starts_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} {e.title}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
          <p className="muted small">
            <span className="legend-dot training" /> Training <span className="legend-dot game" /> Game <span className="legend-dot demo_review" /> Demo Review
            {canManage ? ' · Click a day to see it; double-click to add an event on it.' : ' · Click a day to see what is on it. Only the team owner can add events.'}
          </p>
        </Panel>
        <div className="stack">
          {editing ? (
            <Panel title={editing.event ? 'Edit event' : 'New event'}>
              <EventForm initial={draftFor(editing.event, editing.date)} onSubmit={save} onCancel={() => setEditing(null)} busy={busy}
                demos={demoList.data?.demos ?? []} />
            </Panel>
          ) : selected ? (
            <Panel title={selected.title} actions={<button type="button" className="btn ghost small" onClick={() => setParams(selectedDay ? { date: isoDay(selectedDay) } : {})}>Close</button>}>
              {eventDetails(selected)}
            </Panel>
          ) : selectedDay ? (
            <Panel title={`${selectedDay.toLocaleDateString(undefined, { weekday: 'long' })} ${formatDMY(selectedDay)}`} className="cal-day-pane"
              actions={<button type="button" className="btn ghost small" onClick={() => setParams({})}>Close</button>}>
              {dayEvents.length ? dayEvents.map((e) => eventDetails(e, true)) : <p className="muted">Nothing booked on this day.</p>}
              {canManage ? <button type="button" className="btn" onClick={() => setEditing({ date: isoDay(selectedDay) })}><Icon name="plus" /> Add event on this day</button> : null}
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
