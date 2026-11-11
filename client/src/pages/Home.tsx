import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { useDocumentTitle, useLoad } from '../lib/hooks';
import type { GameState, TacticSummary } from '../lib/types';
import { Badge, Panel } from '../components/ui';
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
  const live = game.data?.session;

  return (
    <div className="stack">
      <h1>Welcome back, {user?.user_name}</h1>
      <div className="grid3">
        <Panel title={<><Icon name="team" /> Team</>}>
          {team ? (
            <>
              <p className="big">{team.team_name}</p>
              <p className="muted">
                {team.is_owner ? <Badge tone="gold">Owner</Badge> : team.is_igl ? <Badge tone="green">IGL</Badge> : <Badge>Player</Badge>}
                {team.player_role ? <> <Badge>{team.player_role}</Badge></> : null}
              </p>
              <Link className="btn" to="/team">View roster</Link>
            </>
          ) : (
            <>
              <p>You are not on a team yet.</p>
              <Link className="btn primary" to="/team">Create or join a team</Link>
            </>
          )}
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
              <p><Badge tone="red">LIVE</Badge> {live.tactic.tactic_name}</p>
              <p className="muted">Phase {live.current_phase + 1} of {live.phase_count}: {live.phase.name}</p>
              <Link className="btn primary" to="/game">Open Game Mode</Link>
            </>
          ) : (
            <>
              <p className="muted">No session running.</p>
              <Link className="btn" to="/game">{team.can_lead ? 'Start a session' : 'Open Game Mode'}</Link>
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
