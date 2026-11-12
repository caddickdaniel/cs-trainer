import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { useDocumentTitle, useLoad } from '../lib/hooks';
import type { GameState, TacticSummary, TeamEvent } from '../lib/types';
import { EVENT_LABEL } from '../lib/constants';
import { countdown, formatEventTime, zoneLabel } from '../lib/time';
import { RoleBadge } from '../components/People';
import { Alert, Badge, Panel } from '../components/ui';
import { Icon, Logo } from '../components/Icons';

function Landing() {
  return (
    <div className="landing">
      <div className="landing-hero">
        <Logo />
        <h1>CS Trainer</h1>
        <p className="lead">Plan your rounds, give every player a clear job, and follow the call live on a second screen.</p>
        <div className="row">
          <Link className="btn primary" to="/signup">Create an account</Link>
          <Link className="btn" to="/signin">Sign in</Link>
        </div>
      </div>
      <div className="grid3">
        <Panel title="Team">Create a team and invite your teammates with an expiring link.</Panel>
        <Panel title="Tactics">Build phase-by-phase plans on the board with per-player instructions and utility.</Panel>
        <Panel title="Game Mode">Your IGL starts a tactic and steps through phases. Everyone sees only their own job.</Panel>
      </div>
    </div>
  );
}

// Next team event with a live countdown; refreshes when events change.
function NextEvent({ teamId }: { teamId: number }) {
  const [event, setEvent] = useState<TeamEvent | null | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let cancelled = false;
    const load = () => api.get<{ event: TeamEvent | null }>(`/teams/${teamId}/events/next`)
      .then((r) => { if (!cancelled) setEvent(r.event); })
      .catch(() => { if (!cancelled) setEvent(null); });
    const first = window.setTimeout(load, 0);
    const poll = window.setInterval(load, 30000);
    const tick = window.setInterval(() => setNow(Date.now()), 15000);
    window.addEventListener('focus', load);
    return () => { cancelled = true; window.clearTimeout(first); window.clearInterval(poll); window.clearInterval(tick); window.removeEventListener('focus', load); };
  }, [teamId]);
  // Once the event starts, look for the next one.
  useEffect(() => {
    if (!event) return undefined;
    const ms = new Date(event.starts_at).getTime() - Date.now();
    if (ms > 2 ** 31 - 1) return undefined;
    const t = window.setTimeout(() => setEvent(undefined), Math.max(1000, ms + 1000));
    return () => window.clearTimeout(t);
  }, [event]);
  if (event === undefined) return <p className="muted">Loading…</p>;
  if (!event) return <><p className="muted">Nothing scheduled.</p><Link className="btn" to="/training">Open calendar</Link></>;
  return (
    <>
      <p className="big">{event.title}</p>
      <p><Badge tone={event.kind === 'game' ? 'red' : event.kind === 'demo_review' ? 'green' : 'blue'}>{EVENT_LABEL[event.kind]}</Badge> {formatEventTime(event.starts_at)}</p>
      <p className="countdown" aria-live="polite">Starts {countdown(new Date(event.starts_at).getTime() - now)}</p>
      <p className="muted small">Your time zone: {zoneLabel()}</p>
      <div className="row">
        <Link className="btn" to={`/training?event=${event.event_id}`}>Details</Link>
        {event.demo ? <Link className="btn ghost" to={`/demos/${event.demo.demo_id}`}>Open demo</Link> : null}
      </div>
    </>
  );
}

function Dashboard() {
  useDocumentTitle('Home');
  const { user, active_team: team } = useAuth();
  const teamId = team?.team_id;
  const tactics = useLoad(
    () => (teamId ? api.get<{ tactics: TacticSummary[] }>(`/teams/${teamId}/tactics`) : Promise.resolve(null)),
    [teamId]
  );
  const game = useLoad(
    () => (teamId ? api.get<GameState>(`/teams/${teamId}/game-session`) : Promise.resolve(null)),
    [teamId]
  );
  const invites = useLoad(() => api.get<{ invites: { status: string }[] }>('/me/invites'), []);
  const pendingInvites = (invites.data?.invites ?? []).filter((i) => i.status === 'pending').length;
  const live = game.data?.session;

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Welcome back, {user?.user_name}</h1>
        <Link className="btn" to="/profile"><Icon name="edit" /> Edit profile</Link>
      </div>
      {pendingInvites ? <Alert kind="success">You have {pendingInvites} pending team invitation{pendingInvites > 1 ? 's' : ''}. <Link to="/invites">Review invites</Link></Alert> : null}
      <div className="grid4">
        <Panel title={<><Icon name="team" /> Team</>}>
          {team ? (
            <>
              <p className="big">{team.team_name}</p>
              <p className="row wrap tight-row">
                {team.is_owner ? <Badge tone="gold">Owner</Badge> : null}
                {team.player_role ? <RoleBadge role={team.player_role} /> : null}
                {!team.is_owner && !team.player_role ? <Badge>Player</Badge> : null}
              </p>
              <Link className="btn" to="/team">View roster</Link>
            </>
          ) : (
            <>
              <p>You are not on a team yet.</p>
              <div className="row wrap">
                <Link className="btn primary" to="/team">Create or join a team</Link>
                <Link className="btn ghost" to="/recruiting">Find a team</Link>
              </div>
            </>
          )}
        </Panel>
        <Panel title={<><Icon name="calendar" /> Next event</>}>
          {team ? <NextEvent teamId={team.team_id} /> : <p className="muted">Available once you are on a team.</p>}
        </Panel>
        <Panel title={<><Icon name="tactics" /> Tactics</>}>
          {team ? (
            <>
              <p className="big">{tactics.data ? tactics.data.tactics.length : '–'} saved</p>
              <div className="row">
                <Link className="btn" to="/tactics">Open library</Link>
                {team.can_lead ? <Link className="btn ghost" to="/tactics/new">New tactic</Link> : null}
              </div>
            </>
          ) : <p className="muted">Available once you are on a team.</p>}
        </Panel>
        <Panel title={<><Icon name="game" /> Game Mode</>}>
          {!team ? <p className="muted">Available once you are on a team.</p> : live ? (
            <>
              <p><Badge tone="red">LIVE</Badge> Round {live.round_number}: {live.tactic.tactic_name}</p>
              <p className="muted">Phase {live.current_phase + 1} of {live.phase_count}: {live.phase.name}</p>
              <Link className="btn primary" to="/game">Open Game Mode</Link>
            </>
          ) : (
            <>
              <p className="muted">No session running.</p>
              <Link className="btn" to="/game">{team.can_control ? 'Start a session' : 'Open Game Mode'}</Link>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}

export function HomePage() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Dashboard /> : <Landing />;
}
