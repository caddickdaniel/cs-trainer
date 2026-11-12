import { useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { EVENT_LABEL } from '../lib/constants';
import { useDocumentTitle, useLoad } from '../lib/hooks';
import { formatEventTime, toInstant, toLocalParts, viewerTimeZone, zoneLabel } from '../lib/time';
import type { TeamEvent } from '../lib/types';
import { Alert, Badge, Loading, NeedsTeam, Panel } from '../components/ui';
import { Icon } from '../components/Icons';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function monthGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday first
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - offset + i));
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

type Draft = { kind: 'training' | 'game'; title: string; date: string; time: string; opponent: string; notes: string };

function EventForm({ initial, onSubmit, onCancel, busy }: { initial: Draft; onSubmit: (d: Draft) => void; onCancel: () => void; busy: boolean }) {
  const [d, setD] = useState(initial);
  const submit = (e: FormEvent) => { e.preventDefault(); onSubmit(d); };
  return (
    <form className="form compact" onSubmit={submit}>
      <div className="segmented" role="group" aria-label="Event type">
        {(['training', 'game'] as const).map((k) => (
          <button key={k} type="button" className={d.kind === k ? 'on' : ''} aria-pressed={d.kind === k} onClick={() => setD({ ...d, kind: k })}>{EVENT_LABEL[k]}</button>
        ))}
      </div>
      <label>Title<input required maxLength={80} value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} /></label>
      <div className="grid2">
        <label>Date<input type="date" required value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} /></label>
        <label>Start time<input type="time" required value={d.time} onChange={(e) => setD({ ...d, time: e.target.value })} /></label>
      </div>
      <p className="muted small">Times are in your time zone: {zoneLabel()}.</p>
      {d.kind === 'game' ? <label>Opponent (optional)<input maxLength={80} value={d.opponent} onChange={(e) => setD({ ...d, opponent: e.target.value })} /></label> : null}
      <label>{d.kind === 'game' ? 'Details (optional)' : 'Practice notes (optional)'}
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
  const [editing, setEditing] = useState<{ event?: TeamEvent; date?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedId = Number(params.get('event')) || null;
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
    const body = { kind: d.kind, title: d.title, starts_at: toInstant(d.date, d.time), time_zone: viewerTimeZone(), opponent: d.kind === 'game' ? d.opponent || null : null, notes: d.notes };
    try {
      const res = editing?.event
        ? await api.patch<{ event: TeamEvent }>(`/teams/${teamId}/events/${editing.event.event_id}`, body)
        : await api.post<{ event: TeamEvent }>(`/teams/${teamId}/events`, body);
      setEditing(null);
      await data.reload();
      setParams({ event: String(res.event.event_id) });
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
      return { kind: ev.kind, title: ev.title, date: p.date, time: p.time, opponent: ev.opponent ?? '', notes: ev.notes };
    }
    return { kind: 'training', title: '', date: date ?? toLocalParts(new Date().toISOString()).date, time: '19:00', opponent: '', notes: '' };
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Training</h1>
          <p className="muted">Shown in your time zone: {zoneLabel()}</p>
        </div>
        {canManage ? <button type="button" className="btn primary" onClick={() => setEditing({})}><Icon name="plus" /> Add event</button> : null}
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
              return (
                <div key={day.toISOString()} role="gridcell" className={`cal-day${outside ? ' outside' : ''}${isToday ? ' today' : ''}`}
                  onDoubleClick={() => canManage && setEditing({ date: toLocalParts(day.toISOString()).date })}>
                  <span className="cal-num">{day.getDate()}</span>
                  {items.map((e) => (
                    <button key={e.event_id} type="button" className={`cal-event ${e.kind}${e.event_id === selectedId ? ' on' : ''}`}
                      onClick={() => setParams({ event: String(e.event_id) })}>
                      {new Date(e.starts_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} {e.title}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
          <p className="muted small">
            <span className="legend-dot training" /> Training <span className="legend-dot game" /> Game
            {canManage ? ' · Double-click a day to add an event there.' : ''}
          </p>
        </Panel>
        <div className="stack">
          {editing ? (
            <Panel title={editing.event ? 'Edit event' : 'New event'}>
              <EventForm initial={draftFor(editing.event, editing.date)} onSubmit={save} onCancel={() => setEditing(null)} busy={busy} />
            </Panel>
          ) : selected ? (
            <Panel title={selected.title} actions={<button type="button" className="btn ghost small" onClick={() => setParams({})}>Close</button>}>
              <p><Badge tone={selected.kind === 'game' ? 'red' : 'blue'}>{EVENT_LABEL[selected.kind]}</Badge></p>
              <p className="big">{formatEventTime(selected.starts_at)}</p>
              <p className="muted small">Your time ({zoneLabel(new Date(selected.starts_at))}). Entered in {selected.time_zone}.</p>
              {selected.opponent ? <p><strong>Opponent:</strong> {selected.opponent}</p> : null}
              {selected.notes ? <p className="bio">{selected.notes}</p> : null}
              {canManage ? (
                <div className="row">
                  <button type="button" className="btn" onClick={() => setEditing({ event: selected })}><Icon name="edit" /> Edit</button>
                  <button type="button" className="btn ghost danger" onClick={() => remove(selected)}><Icon name="trash" /> Remove</button>
                </div>
              ) : null}
            </Panel>
          ) : null}
          <Panel title="Upcoming">
            {upcoming.length ? (
              <ul className="plain-list">
                {upcoming.map((e) => (
                  <li key={e.event_id}>
                    <button type="button" className="linkish" onClick={() => setParams({ event: String(e.event_id) })}>{e.title}</button>
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

export function TrainingPage() {
  useDocumentTitle('Training');
  const { active_team: team } = useAuth();
  if (!team) return <NeedsTeam what="Training calendars" />;
  return <Calendar teamId={team.team_id} />;
}
