import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, useDocumentTitle, useLoad } from '../lib/hooks';
import { Alert, Loading, Panel } from '../components/ui';

interface Preview {
  status: 'active' | 'expired' | 'revoked' | 'used_up';
  expires_at: string;
  already_member: boolean;
  team: { team_id: number; team_name: string; region: string | null; language: string | null };
}

const STATUS_TEXT: Record<string, string> = {
  expired: 'This invite has expired. Ask for a new link.',
  revoked: 'This invite has been revoked. Ask for a new link.',
  used_up: 'This invite has already been used. Ask for a new link.',
};

export function InvitePage() {
  useDocumentTitle('Team invite');
  const { token = '' } = useParams();
  const { refresh, active_team: current } = useAuth();
  const navigate = useNavigate();
  const preview = useLoad(() => api.get<Preview>(`/invites/${encodeURIComponent(token)}`), [token]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/invites/${encodeURIComponent(token)}/accept`);
      await refresh();
      navigate('/team');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (preview.loading) return <Loading />;
  if (!preview.data) {
    return <Panel title="Invite"><Alert>{preview.error}</Alert><Link className="btn" to="/team">Back to Team</Link></Panel>;
  }
  const { team, status, already_member: alreadyMember, expires_at: expiresAt } = preview.data;
  return (
    <div className="auth-wrap">
      <Panel title={`Join ${team.team_name}`}>
        {alreadyMember ? <Alert kind="info">You are already on this team.</Alert>
          : status !== 'active' ? <Alert>{STATUS_TEXT[status]}</Alert>
            : current ? <Alert kind="warn">You are on {current.team_name}. Leave it before joining another team.</Alert>
              : <p>You have been invited to join <strong>{team.team_name}</strong>. This link expires {formatDateTime(expiresAt)}.</p>}
        <Alert>{error}</Alert>
        <div className="row">
          {status === 'active' && !alreadyMember && !current
            ? <button type="button" className="btn primary" onClick={accept} disabled={busy}>Join team</button> : null}
          <Link className="btn ghost" to="/team">Go to Team</Link>
        </div>
      </Panel>
    </div>
  );
}
