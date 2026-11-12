import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ECONOMIES, ECONOMY_LABEL, mapName } from '../lib/constants';
import { formatDateTime, useDocumentTitle } from '../lib/hooks';
import type { GameSession, GameState, Marker, SideTactic, TacticSummary } from '../lib/types';
import type { Level } from '../lib/constants';
import { Alert, Badge, Loading, NeedsTeam, Panel, SideBadge } from '../components/ui';
import { Icon } from '../components/Icons';
import { bindingFromEvent, formatBinding, isTyping, useShortcutSettings, type Shortcuts } from '../lib/shortcuts';
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
    <Panel title="Start a match">
      {tactics.length ? (
        <div className="row wrap">
          <select aria-label="Opening tactic" value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">Choose the opening tactic…</option>
            {tactics.map((t) => (
              <option key={t.tactic_id} value={t.tactic_id}>{mapName(t.map)} · {t.side ?? '?'} · {t.tactic_name} ({t.phase_count} phases)</option>
            ))}
          </select>
          <button type="button" className="btn primary" disabled={!choice || busy} onClick={start}>Start round 1</button>
        </div>
      ) : <p className="muted">No saved tactics with phases yet. <Link to="/tactics/new">Create one</Link>.</p>}
      <p className="muted small">The tactic's map and side become the match's. During the match you can switch tactics within that map and side, switch T/CT and start new rounds. Each round uses the tactic as it was saved when the round started.</p>
      <Alert>{error}</Alert>
    </Panel>
  );
}

type Command = 'phase_prev' | 'phase_next' | 'tactic_prev' | 'tactic_next' | 'new_round' | 'switch_side';

// IGL dropdown of this map and side's tactics, grouped by economy. Uses the
// same list (and order) as the previous/next tactic shortcuts.
function TacticPicker({ tactics, value, liveId, disabled, onChange }: {
  tactics: SideTactic[]; value: number | null; liveId: number; disabled: boolean; onChange: (id: number) => void;
}) {
  const groups = [...ECONOMIES, 'Other'].map((eco) => ({
    eco,
    items: tactics.filter((t) => (eco === 'Other' ? !(ECONOMIES as readonly string[]).includes(t.economy) : t.economy === eco)),
  })).filter((g) => g.items.length);
  return (
    <select className="tactic-picker" aria-label="Tactic queued for the next round" value={value ?? ''} disabled={disabled}
      onChange={(e) => { if (e.target.value) onChange(Number(e.target.value)); }}>
      {value == null ? <option value="">Choose a tactic…</option> : null}
      {groups.map((g) => (
        <optgroup key={g.eco} label={ECONOMY_LABEL[g.eco] ?? g.eco}>
          {g.items.map((t) => (
            <option key={t.tactic_id} value={t.tactic_id}>{t.tactic_name}{t.tactic_id === liveId ? ' (live now)' : ''}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function Key({ binding }: { binding: string }) {
  return <kbd className="key-hint">{formatBinding(binding)}</kbd>;
}

function LiveSession({ session, onUpdate, focus, shortcuts }: {
  session: GameSession; onUpdate: (s: GameState) => void; focus: boolean; shortcuts: Shortcuts;
}) {
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [levelChoice, setLevelChoice] = useState<{ key: string; level: Level } | null>(null);
  const [open, setOpen] = useState<{ marker: Marker; index: number } | null>(null);
  const mine = session.my_assignment;
  const map = session.tactic.map ?? 'practice_yard';
  const phaseKey = `${session.session_id}:${session.round_number}:${session.current_phase}`;
  const level = levelChoice?.key === phaseKey ? levelChoice.level : preferredLevel(map, session.phase.board, user?.user_id);
  const myLineups = lineupMarkers(session.phase.board, user?.user_id ?? null);
  const otherLineups = lineupMarkers(session.phase.board).filter((m) => m.user_id !== user?.user_id);
  const players = (session.assignments ?? []).flatMap((a) => (a.user_id != null ? [a.user_id] : []));
  if (user && !players.includes(user.user_id)) players.push(user.user_id);
  const boardPlayers = (session.assignments ?? (mine ? [mine] : []))
    .flatMap((a) => (a.user_id != null ? [{ user_id: a.user_id, user_name: a.user_name ?? '' }] : []));
  const control = session.can_control;
  const lastPhase = session.current_phase >= session.phase_count - 1;

  const apply = useCallback((s: GameSession) => {
    onUpdate({ session: s.status === 'active' ? s : null, last_ended: s.status === 'ended'
      ? { session_id: s.session_id, ended_at: s.ended_at as string, ended_by: s.ended_by, tactic_name: s.tactic.tactic_name }
      : null, can_control: s.can_control });
  }, [onUpdate]);

  const send = useCallback(async (path: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ session: GameSession }>(`/game-sessions/${session.session_id}/${path}`, body);
      apply(res.session);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.body.session) {
        apply(err.body.session as GameSession);
        setError(err.code === 'version_conflict' ? 'The live state changed just before your command. You are now on the latest state.' : err.message);
      } else if (err instanceof ApiError && err.code === 'not_igl') {
        setError('You are no longer the IGL, so you cannot control live play.');
        onUpdate({ session: { ...session, can_control: false }, last_ended: null, can_control: false });
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }, [session, apply, onUpdate]);

  const run = useCallback((action: Command) => {
    if (action === 'phase_next' && lastPhase) return;
    if (action === 'phase_prev' && session.current_phase === 0) return;
    if ((action === 'tactic_next' || action === 'tactic_prev') && !session.side_tactic_count) return;
    if (action === 'new_round' && !session.selected_tactic) { setError(`There is no ${session.side} tactic to start. Switch side or create one.`); return; }
    send('command', { action, expected_version: session.version });
  }, [send, session, lastPhase]);

  // Shortcuts apply only to the IGL's focused Game Mode view, never while typing.
  useEffect(() => {
    if (!control) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (busy || isTyping(e.target) || !document.hasFocus() || document.querySelector('dialog[open]')) return;
      const binding = bindingFromEvent(e);
      const action = (Object.keys(shortcuts) as Command[]).find((a) => shortcuts[a] === binding);
      if (!action) return;
      e.preventDefault();
      run(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [control, busy, shortcuts, run]);

  return (
    <div className={`live ${focus ? 'focus' : ''}`}>
      <div className="live-head">
        <div>
          <p className="eyebrow">
            <Badge tone="red">LIVE</Badge> Round {session.round_number} · {mapName(session.map)} <SideBadge side={session.side} />
            {session.selected_tactic && session.selected_tactic.tactic_id !== session.tactic.tactic_id
              ? <span className="queued-chip" title="Starts when the IGL begins the next round">Next: {session.selected_tactic.tactic_name}</span> : null}
            {session.tactic.side !== session.side ? <span className="muted small">(playing a {session.tactic.side} tactic from before the side switch)</span> : null}
          </p>
          <h1 className="phase-title">{session.tactic.tactic_name}</h1>
          <p className="phase-sub">Phase {session.current_phase + 1}/{session.phase_count}: <strong>{session.phase.name}</strong></p>
        </div>
        <ol className="phase-dots" aria-label="Phases">
          {session.phases.map((p) => (
            <li key={p.index} className={p.index === session.current_phase ? 'on' : p.index < session.current_phase ? 'done' : ''} title={p.name}>
              {control ? (
                <button type="button" disabled={busy || p.index === session.current_phase}
                  onClick={() => send('command', { action: 'phase_goto', index: p.index, expected_version: session.version })}>{p.index + 1}</button>
              ) : <span>{p.index + 1}</span>}
            </li>
          ))}
        </ol>
      </div>

      {control ? (
        <section className="panel igl-controls" aria-label="IGL controls">
          <div className="control-group">
            <span className="control-label">Phase</span>
            <button type="button" className="btn" disabled={busy || session.current_phase === 0} onClick={() => run('phase_prev')}><Icon name="left" /> Previous <Key binding={shortcuts.phase_prev} /></button>
            <button type="button" className="btn primary" disabled={busy || lastPhase} onClick={() => run('phase_next')}>Next <Icon name="right" /> <Key binding={shortcuts.phase_next} /></button>
          </div>
          <div className="control-group">
            <span className="control-label">Queued for round {session.round_number + 1} ({session.side} on {mapName(session.map)})</span>
            {session.side_tactic_count ? (
              <>
                <button type="button" className="btn" disabled={busy} onClick={() => run('tactic_prev')} aria-label="Previous tactic"><Icon name="left" /> <Key binding={shortcuts.tactic_prev} /></button>
                <TacticPicker tactics={session.side_tactics ?? []} value={session.selected_tactic?.tactic_id ?? null} disabled={busy}
                  liveId={session.tactic.tactic_id}
                  onChange={(id) => send('command', { action: 'tactic_select', tactic_id: id, expected_version: session.version })} />
                <button type="button" className="btn" disabled={busy} onClick={() => run('tactic_next')} aria-label="Next tactic"><Key binding={shortcuts.tactic_next} /> <Icon name="right" /></button>
              </>
            ) : <span className="empty-side">No {session.side} tactics on {mapName(session.map)} yet. <Link to="/tactics/new">Create one</Link> or switch side.</span>}
          </div>
          <div className="control-group">
            <button type="button" className="btn" disabled={busy} onClick={() => run('switch_side')}>Switch to {session.side === 'CT' ? 'T' : 'CT'} <Key binding={shortcuts.switch_side} /></button>
            <button type="button" className="btn primary big-ish" disabled={busy || !session.selected_tactic} onClick={() => run('new_round')}>
              Start round {session.round_number + 1} <Key binding={shortcuts.new_round} /></button>
            <button type="button" className="btn ghost danger" disabled={busy}
              onClick={() => { if (window.confirm('End this Game Mode session for the whole team?')) send('end', { expected_version: session.version }); }}>
              <Icon name="stop" /> End match
            </button>
          </div>
          <p className="muted small">Shortcuts work while this page is focused. <Link to="/settings">Change shortcuts</Link></p>
          <Alert>{error}</Alert>
        </section>
      ) : (
        <p className="muted small read-only-note">
          Read-only view. {session.igl ? `${session.igl.user_name} (IGL) controls the round.` : 'No IGL is assigned.'}
          {session.selected_tactic && session.selected_tactic.tactic_id !== session.tactic.tactic_id ? ` Up next: ${session.selected_tactic.tactic_name}.` : ''}
          {error ? ` ${error}` : ''}
        </p>
      )}

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
          {control ? (
            <Panel title="All instructions this phase">
              <PhaseInstructions assignments={session.assignments ?? []} players={players} highlight={user?.user_id} />
            </Panel>
          ) : null}
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
      <p className="muted small">Started by {session.started_by?.user_name ?? 'unknown'} at {formatDateTime(session.started_at)} · round tactic revision {session.tactic.revision}</p>
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
  const shortcuts = useShortcutSettings();
  const [focus, setFocus] = useState(false);
  const [seenSession, setSeenSession] = useState<number | null>(null);
  const session = state?.session ?? null;

  // Remember the last session seen on this screen so its end can be announced.
  if (session && session.session_id !== seenSession) setSeenSession(session.session_id);

  useEffect(() => {
    document.body.classList.toggle('focus-mode', focus);
    return () => document.body.classList.remove('focus-mode');
  }, [focus]);

  const onUpdate = useCallback((s: GameState) => { setState((prev) => ({ ...s, igl: s.igl ?? prev?.igl })); }, [setState]);

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
          The match was ended{state.last_ended!.ended_by ? ` by ${state.last_ended!.ended_by.user_name}` : ''} at {formatDateTime(state.last_ended!.ended_at)}.
        </Alert>
      ) : null}
      {session ? <LiveSession session={session} onUpdate={(s) => { onUpdate(s); refetch(); }} focus={focus} shortcuts={shortcuts} />
        : state.can_control ? (
          <StartPanel teamId={teamId} onStarted={onUpdate} />
        ) : (
          <Panel title="Waiting for the IGL">
            <p>No match is running. This page updates automatically when {state.igl ? `${state.igl.user_name} (your IGL)` : 'your IGL'} starts one.</p>
            {!state.igl ? <Alert kind="warn">Your team has no IGL. The team owner assigns one on the Team page.</Alert> : null}
            {state.last_ended && !endedHere ? <p className="muted small">Last match: {state.last_ended.tactic_name}, ended {formatDateTime(state.last_ended.ended_at)}.</p> : null}
          </Panel>
        )}
    </div>
  );
}
