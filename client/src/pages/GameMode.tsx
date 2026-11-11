import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ECONOMY_LABEL, mapName } from '../lib/constants';
import { formatDateTime, useDocumentTitle } from '../lib/hooks';
import type { GameSession, GameState, Marker, TacticSummary } from '../lib/types';
import type { Level } from '../lib/constants';
import { Alert, Badge, Loading, NeedsTeam, Panel, SideBadge } from '../components/ui';
import { Icon } from '../components/Icons';
import { MapBoard } from '../components/MapBoard';
import { PhaseInstructions } from '../components/PhaseInstructions';
import { LevelSwitch, LineupGallery, LineupLightbox, lineupMarkers, preferredLevel } from '../components/Lineups';

const POLL_MS = 2000;
const MAX_BACKOFF_MS = 15000;

// Polls the team's Game Mode state. Survives refreshes (state lives on the
// server) and reconnects with backoff when requests fail.
function useGameState(teamId: number) {
  const [state, setState] = useState<GameState | null>(null);
  const [offline, setOffline] = useState(false);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const failures = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const fetchRef = useRef<() => void>(() => {});

  const fetchNow = useCallback(async () => {
    window.clearTimeout(timer.current);
    try {
      const data = await api.get<GameState>(`/teams/${teamId}/game-session`);
      setState(data);
      setOffline(false);
      setLastOk(Date.now());
      failures.current = 0;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 404)) return;
      failures.current += 1;
      setOffline(true);
    }
    const delay = Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** failures.current);
    const hidden = document.visibilityState === 'hidden';
    timer.current = window.setTimeout(() => fetchRef.current(), hidden ? Math.max(delay, 5000) : delay);
  }, [teamId]);

  useLayoutEffect(() => {
    fetchRef.current = fetchNow;
  }, [fetchNow]);

  useEffect(() => {
    timer.current = window.setTimeout(() => fetchRef.current(), 0);
    const wake = () => { if (document.visibilityState === 'visible') fetchNow(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    return () => {
      window.clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
    };
  }, [fetchNow]);

  return { state, setState, offline, lastOk, refetch: fetchNow };
}

function StartPanel({ teamId, onStarted }: { teamId: number; onStarted: (s: GameState) => void }) {
  const [params] = useSearchParams();
  const [tactics, setTactics] = useState<TacticSummary[] | null>(null);
  const [choice, setChoice] = useState(params.get('tactic') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ tactics: TacticSummary[] }>(`/teams/${teamId}/tactics`)
      .then((r) => setTactics(r.tactics.filter((t) => t.phase_count > 0)))
      .catch((err) => setError(errorMessage(err)));
  }, [teamId]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ session: GameSession }>(`/teams/${teamId}/game-session`, { tactic_id: Number(choice) });
      onStarted({ session: res.session, last_ended: null, can_control: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'session_active' && err.body.session) {
        onStarted({ session: err.body.session as GameSession, last_ended: null, can_control: true });
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  if (!tactics) return <Loading />;
  return (
    <Panel title="Start a session">
      {tactics.length ? (
        <div className="row wrap">
          <select aria-label="Tactic to run" value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">Choose a saved tactic…</option>
            {tactics.map((t) => (
              <option key={t.tactic_id} value={t.tactic_id}>{t.tactic_name} · {t.side ?? '?'} · {ECONOMY_LABEL[t.economy] ?? t.economy} · {t.phase_count} phases</option>
            ))}
          </select>
          <button type="button" className="btn primary" disabled={!choice || busy} onClick={start}>Start session</button>
        </div>
      ) : <p className="muted">No saved tactics with phases yet. <Link to="/tactics/new">Create one</Link>.</p>}
      <p className="muted small">Players see the version saved when you press Start. Later edits apply to the next session.</p>
      <Alert>{error}</Alert>
    </Panel>
  );
}

function LiveSession({ session, onUpdate, focus }: { session: GameSession; onUpdate: (s: GameState) => void; focus: boolean }) {
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [levelChoice, setLevelChoice] = useState<{ key: string; level: Level } | null>(null);
  const [open, setOpen] = useState<{ marker: Marker; index: number } | null>(null);
  const mine = session.my_assignment;
  const map = session.tactic.map ?? 'practice_yard';
  const phaseKey = `${session.session_id}:${session.current_phase}`;
  const level = levelChoice?.key === phaseKey ? levelChoice.level : preferredLevel(map, session.phase.board, user?.user_id);
  const myLineups = lineupMarkers(session.phase.board, user?.user_id ?? null);
  const otherLineups = lineupMarkers(session.phase.board).filter((m) => m.user_id !== user?.user_id);
  const players = (session.assignments ?? []).map((a) => a.user_id);
  if (user && !players.includes(user.user_id)) players.push(user.user_id);
  const boardPlayers = (session.assignments ?? (mine ? [mine] : [])).map((a) => ({ user_id: a.user_id, user_name: a.user_name ?? '' }));

  const control = useCallback(async (path: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ session: GameSession }>(`/game-sessions/${session.session_id}/${path}`, body);
      onUpdate({ session: res.session.status === 'active' ? res.session : null, last_ended: res.session.status === 'ended'
        ? { session_id: res.session.session_id, ended_at: res.session.ended_at as string, ended_by: res.session.ended_by, tactic_name: res.session.tactic.tactic_name }
        : null, can_control: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.body.session) {
        const latest = err.body.session as GameSession;
        onUpdate({ session: latest.status === 'active' ? latest : null, last_ended: null, can_control: true });
        setError(err.code === 'version_conflict' ? 'Someone else changed the phase first. You are now on the latest phase.' : err.message);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }, [session.session_id, onUpdate]);

  const step = useCallback((action: 'next' | 'prev') => control('phase', { action, expected_version: session.version }), [control, session.version]);

  useEffect(() => {
    if (!session.can_control) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName) || busy) return;
      if (e.key === 'ArrowRight' && session.current_phase < session.phase_count - 1) step('next');
      if (e.key === 'ArrowLeft' && session.current_phase > 0) step('prev');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session, step, busy]);

  return (
    <div className={`live ${focus ? 'focus' : ''}`}>
      <div className="live-head">
        <div>
          <p className="eyebrow"><Badge tone="red">LIVE</Badge> {session.tactic.tactic_name} <SideBadge side={session.tactic.side} /> {ECONOMY_LABEL[session.tactic.economy] ?? session.tactic.economy} · {mapName(session.tactic.map)}</p>
          <h1 className="phase-title">Phase {session.current_phase + 1}/{session.phase_count}: {session.phase.name}</h1>
        </div>
        <ol className="phase-dots" aria-label="Phases">
          {session.phases.map((p) => (
            <li key={p.index} className={p.index === session.current_phase ? 'on' : p.index < session.current_phase ? 'done' : ''} title={p.name}>
              {session.can_control ? (
                <button type="button" disabled={busy || p.index === session.current_phase}
                  onClick={() => control('phase', { action: 'goto', index: p.index, expected_version: session.version })}>{p.index + 1}</button>
              ) : <span>{p.index + 1}</span>}
            </li>
          ))}
        </ol>
      </div>

      <div className="live-grid">
        <div className="stack">
          <section className={`my-call ${mine ? '' : 'empty'}`} aria-live="polite">
            <h2>Your instruction</h2>
            {mine && (mine.instruction || mine.utility) ? (
              <>
                {mine.instruction ? <p className="call-text">{mine.instruction}</p> : null}
                {mine.utility ? <p className="call-utility"><strong>Utility:</strong> {mine.utility}</p> : null}
                {mine.reference_url && /^https?:\/\//i.test(mine.reference_url)
                  ? <p><a href={mine.reference_url} target="_blank" rel="noreferrer noopener">Open reference</a></p> : null}
              </>
            ) : (
              <p className="call-text muted">No instruction for you this phase. Hold your position and follow the IGL's call.</p>
            )}
            {myLineups.length ? (
              <>
                <h2 className="lineup-heading">Your lineups</h2>
                <LineupGallery markers={myLineups} large onOpen={(m, i) => setOpen({ marker: m, index: i })} />
              </>
            ) : null}
          </section>
          {session.phase.notes ? <Panel title="Team notes"><p>{session.phase.notes}</p></Panel> : null}
          {session.can_control ? (
            <Panel title="Controls">
              <div className="row wrap">
                <button type="button" className="btn big" disabled={busy || session.current_phase === 0} onClick={() => step('prev')}><Icon name="left" /> Previous</button>
                <button type="button" className="btn primary big" disabled={busy || session.current_phase >= session.phase_count - 1} onClick={() => step('next')}>Next phase <Icon name="right" /></button>
                <button type="button" className="btn ghost danger" disabled={busy}
                  onClick={() => { if (window.confirm('End this Game Mode session for the whole team?')) control('end', { expected_version: session.version }); }}>
                  <Icon name="stop" /> End session
                </button>
              </div>
              <p className="muted small">Arrow keys ← → also change phase.</p>
              <Alert>{error}</Alert>
              <h3>All instructions this phase</h3>
              <PhaseInstructions assignments={session.assignments ?? []} players={players} highlight={user?.user_id} />
            </Panel>
          ) : <Alert kind="warn">{error}</Alert>}
        </div>
        <div className="stack">
          <LevelSwitch map={map} level={level} board={session.phase.board} onChange={(l) => setLevelChoice({ key: phaseKey, level: l })} />
          <MapBoard board={session.phase.board} map={map} level={level} players={boardPlayers} highlightUserId={user?.user_id ?? null}
            onMarkerActivate={(m) => setOpen({ marker: m, index: 0 })} label={`Board for phase ${session.phase.name}`} />
          {otherLineups.length ? (
            <details className="panel">
              <summary>Team lineups this phase ({otherLineups.length})</summary>
              <LineupGallery markers={otherLineups} onOpen={(m, i) => setOpen({ marker: m, index: i })} />
            </details>
          ) : null}
        </div>
      </div>
      <LineupLightbox marker={open?.marker ?? null} index={open?.index ?? 0}
        onIndex={(i) => setOpen((o) => (o ? { ...o, index: i } : o))} onClose={() => setOpen(null)} />
      <p className="muted small">Started by {session.started_by?.user_name ?? 'unknown'} at {formatDateTime(session.started_at)} · tactic revision {session.tactic.revision}</p>
    </div>
  );
}

export function GameModePage() {
  useDocumentTitle('Game Mode');
  const { active_team: team } = useAuth();
  if (!team) return <NeedsTeam what="Game Mode sessions" />;
  return <GameMode teamId={team.team_id} />;
}

function GameMode({ teamId }: { teamId: number }) {
  const { state, setState, offline, lastOk, refetch } = useGameState(teamId);
  const [focus, setFocus] = useState(false);
  const [seenSession, setSeenSession] = useState<number | null>(null);
  const session = state?.session ?? null;

  // Remember the last session seen on this screen so its end can be announced.
  if (session && session.session_id !== seenSession) setSeenSession(session.session_id);

  useEffect(() => {
    document.body.classList.toggle('focus-mode', focus);
    return () => document.body.classList.remove('focus-mode');
  }, [focus]);

  const onUpdate = useCallback((s: GameState) => { setState(s); }, [setState]);

  if (!state) return offline ? <Alert>Cannot reach the server. Retrying…</Alert> : <Loading />;
  const endedHere = !session && state.last_ended && seenSession === state.last_ended.session_id;

  return (
    <div className="stack game">
      <div className="row space">
        <div className="row">
          {offline ? <Badge tone="red">Reconnecting…</Badge> : <Badge tone="green">Connected</Badge>}
          {lastOk ? <span className="muted small">Updated {new Date(lastOk).toLocaleTimeString()}</span> : null}
        </div>
        <button type="button" className="btn ghost small" onClick={() => setFocus(!focus)} aria-pressed={focus}>
          <Icon name="screen" /> {focus ? 'Exit second-screen view' : 'Second-screen view'}
        </button>
      </div>
      {endedHere ? (
        <Alert kind="info">
          The session for {state.last_ended!.tactic_name} was ended{state.last_ended!.ended_by ? ` by ${state.last_ended!.ended_by.user_name}` : ''} at {formatDateTime(state.last_ended!.ended_at)}.
        </Alert>
      ) : null}
      {session ? <LiveSession session={session} onUpdate={(s) => { onUpdate(s); refetch(); }} focus={focus} /> : state.can_control ? (
        <StartPanel teamId={teamId} onStarted={onUpdate} />
      ) : (
        <Panel title="Waiting for the IGL">
          <p>No Game Mode session is running. This page updates automatically when your owner or IGL starts one.</p>
          {state.last_ended && !endedHere ? <p className="muted small">Last session: {state.last_ended.tactic_name}, ended {formatDateTime(state.last_ended.ended_at)}.</p> : null}
        </Panel>
      )}
    </div>
  );
}
