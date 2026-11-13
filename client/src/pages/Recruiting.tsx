import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useDocumentTitle, useLoad } from '../lib/hooks';
import type { RecruitingTeam } from '../lib/types';
import { Alert, Badge, Loading, Panel } from '../components/ui';
import { Avatar, Facts, RoleBadge } from '../components/People';
import { CompetitionList, RequirementList } from '../components/Recruitment';
import { useCatalogue, type Catalogue } from '../lib/catalogue';

function TeamFacts({ cat, t }: { cat: Catalogue | null; t: RecruitingTeam }) {
  return (
    <Facts items={[['Language', t.language], ['Region', t.region],
      ['Plays', t.competitions.length || t.recruiting_leagues ? <CompetitionList cat={cat} ids={t.competitions} legacy={t.recruiting_leagues} /> : null],
      ['Rank requirements', <RequirementList cat={cat} list={t.rank_requirements} legacy={t.legacy_requirement} />]]} />
  );
}

// Same request from the directory entry and the details page.
function RequestInviteButton({ team, onDone }: { team: RecruitingTeam; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (team.is_member) return <Badge tone="green">Your team</Badge>;
  if (team.request_status === 'pending') return <Badge tone="gold">Request pending</Badge>;
  if (team.request_status === 'invited') return <Link className="btn small" to="/invites">Invite received — review</Link>;
  if (!team.can_request) return null;
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/recruiting/teams/${team.team_id}/requests`, {});
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      onDone();
    }
  };
  return (
    <span className="inline-action">
      <button type="button" className="btn primary small" onClick={send} disabled={busy}>Request invite</button>
      {error ? <span className="error-text">{error}</span> : null}
    </span>
  );
}

function RolesNeeded({ roles }: { roles: string[] }) {
  if (!roles.length) return <span className="muted">Any role</span>;
  return <span className="row wrap tight-row">{roles.map((r) => <RoleBadge key={r} role={r} />)}</span>;
}

export function RecruitingPage() {
  useDocumentTitle('Recruiting');
  const cat = useCatalogue();
  const data = useLoad(() => api.get<{ teams: RecruitingTeam[]; viewer_has_team: boolean }>('/recruiting/teams'), []);
  if (data.loading && !data.data) return <Loading />;
  const teams = data.data?.teams ?? [];
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Teams looking for players</h1>
          <p className="muted">Teams that are recruiting right now. Requesting an invite lets the owner review your profile; it never adds you to a team by itself.</p>
        </div>
        <Link className="btn ghost" to="/profile">Edit your profile</Link>
      </div>
      <Alert>{data.error}</Alert>
      {data.data?.viewer_has_team ? <Alert kind="info">You are on a team, so you can't request invites. Leave your team first to look for a new one.</Alert> : null}
      {teams.length ? (
        <div className="card-grid">
          {teams.map((t) => (
            <Panel key={t.team_id} className="team-card">
              <div className="row">
                <Avatar name={t.team_name} url={t.logo_url} size={52} />
                <div className="grow">
                  <Link to={`/recruiting/${t.team_id}`} className="team-card-name">{t.team_name}</Link>
                  <div className="muted small">{t.roster_size} player{t.roster_size === 1 ? '' : 's'}</div>
                </div>
              </div>
              <TeamFacts cat={cat} t={t} />
              <div><span className="muted small">Looking for</span><br /><RolesNeeded roles={t.roles_needed} /></div>
              <div className="row space">
                <Link className="btn ghost small" to={`/recruiting/${t.team_id}`}>Details</Link>
                <RequestInviteButton team={t} onDone={data.reload} />
              </div>
            </Panel>
          ))}
        </div>
      ) : <Panel><p className="muted">No teams are recruiting right now. Check back later, or make sure your profile is up to date so teams can invite you.</p></Panel>}
    </div>
  );
}

export function RecruitingTeamPage() {
  const { teamId } = useParams();
  const data = useLoad(() => api.get<{ team: RecruitingTeam }>(`/recruiting/teams/${teamId}`), [teamId]);
  useDocumentTitle(data.data?.team.team_name ?? 'Team');
  const cat = useCatalogue();
  if (data.loading && !data.data) return <Loading />;
  if (!data.data) return <Panel title="Team"><Alert>{data.error}</Alert><Link to="/recruiting">Back to recruiting</Link></Panel>;
  const t = data.data.team;
  return (
    <div className="stack narrow-page">
      <Panel>
        <div className="profile-head">
          <Avatar name={t.team_name} url={t.logo_url} size={88} />
          <div className="stack tight">
            <h1>{t.team_name}</h1>
            <p className="muted">{t.roster_size} player{t.roster_size === 1 ? '' : 's'} on the roster</p>
            <RequestInviteButton team={t} onDone={data.reload} />
          </div>
        </div>
        <TeamFacts cat={cat} t={t} />
        <h3>Roles needed</h3>
        <RolesNeeded roles={t.roles_needed} />
        {t.recruiting_notes ? <><h3>About the opening</h3><p className="bio">{t.recruiting_notes}</p></> : null}
        {t.description ? <><h3>About the team</h3><p className="bio">{t.description}</p></> : null}
      </Panel>
      <Link to="/recruiting">Back to recruiting</Link>
    </div>
  );
}
