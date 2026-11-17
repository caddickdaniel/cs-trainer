import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, useDocumentTitle, useLoad } from '../lib/hooks';
import type { ReceivedInvite } from '../lib/types';
import { Alert, Badge, Loading, Panel } from '../components/ui';
import { Avatar, Facts } from '../components/People';
import { RequirementList } from '../components/Recruitment';
import { useCatalogue } from '../lib/catalogue';

interface MyRequest { request_id: number; team_id: number; team_name: string; status: string; created_at: string }

export function InvitesPage() {
  useDocumentTitle('Invites');
  const cat = useCatalogue();
  const { refresh, active_team: team } = useAuth();
  const invites = useLoad(() => api.get<{ invites: ReceivedInvite[] }>('/me/invites'), []);
  const requests = useLoad(() => api.get<{ requests: MyRequest[] }>('/me/requests'), []);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const respond = async (inv: ReceivedInvite, accept: boolean) => {
    setError(null);
    try {
      await api.post(`/me/invites/${inv.invite_id}/${accept ? 'accept' : 'decline'}`);
      setDone(accept ? `You joined ${inv.team.team_name}.` : `You declined ${inv.team.team_name}'s invite.`);
      await Promise.all([invites.reload(), refresh()]);
    } catch (err) {
      setError(errorMessage(err));
      await invites.reload();
    }
  };

  if (invites.loading && !invites.data) return <Loading />;
  const pending = (invites.data?.invites ?? []).filter((i) => i.status === 'pending');
  const past = (invites.data?.invites ?? []).filter((i) => i.status !== 'pending');
  return (
    <div className="stack narrow-page">
      <h1>Invites</h1>
      <Alert>{error ?? invites.error}</Alert>
      {done ? <Alert kind="success">{done} {team ? <Link to="/team">Go to your team</Link> : null}</Alert> : null}
      <Panel title="Team invitations">
        {pending.length ? pending.map((inv) => (
          <div key={inv.invite_id} id={`invite-${inv.invite_id}`} className="list-card">
            <Avatar name={inv.team.team_name} url={inv.team.logo_url} size={48} />
            <div className="stack tight grow">
              <strong>{inv.team.team_name}</strong>
              <Facts items={[['Players', inv.team.roster_size], ['Region', inv.team.region], ['Language', inv.team.language],
                ['Recruiting', inv.team.rank_requirements.length || inv.team.legacy_requirement ? <RequirementList cat={cat} list={inv.team.rank_requirements} legacy={inv.team.legacy_requirement} /> : null]]} />
              <span className="muted small">Expires {formatDateTime(inv.expires_at)}</span>
            </div>
            <div className="row">
              {team ? <span className="muted small">Leave {team.team_name} to accept</span> : (
                <button type="button" className="btn primary" onClick={() => respond(inv, true)}>Accept</button>
              )}
              <button type="button" className="btn ghost" onClick={() => respond(inv, false)}>Decline</button>
            </div>
          </div>
        )) : <p className="muted">No pending invitations. <Link to="/recruiting">Browse teams that are recruiting</Link>.</p>}
        {past.length ? (
          <details>
            <summary className="muted">Earlier invitations ({past.length})</summary>
            <ul className="plain-list">
              {past.map((inv) => <li key={inv.invite_id}>{inv.team.team_name} — <Badge>{inv.status.replace('_', ' ')}</Badge></li>)}
            </ul>
          </details>
        ) : null}
      </Panel>
      <Panel title="Your requests to join">
        {requests.data?.requests.length ? (
          <ul className="plain-list">
            {requests.data.requests.map((r) => (
              <li key={r.request_id}>
                <Link to={`/recruiting/${r.team_id}`}>{r.team_name}</Link> — <Badge tone={r.status === 'pending' ? 'gold' : r.status === 'invited' ? 'green' : 'default'}>
                  {r.status === 'invited' ? 'invite sent' : r.status}</Badge> <span className="muted small">{formatDateTime(r.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="muted">You haven't asked to join any teams.</p>}
      </Panel>
    </div>
  );
}
