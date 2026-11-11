import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api, errorMessage } from '../lib/api';
import { INVITE_TTL_HOURS, PLAYER_ROLES } from '../lib/constants';
import { formatDateTime, useDocumentTitle, useLoad } from '../lib/hooks';
import type { Invite, Member, RosterResponse } from '../lib/types';
import { Alert, Badge, Loading, Panel } from '../components/ui';
import { Icon } from '../components/Icons';

const TEAM_FIELDS = [
  ['language', 'Language'],
  ['region', 'Region'],
  ['platform', 'Platform'],
  ['skill_level', 'Skill level'],
] as const;

// Accepts a full invite link or just the code.
export function extractInviteToken(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/invite\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : trimmed;
}

function NoTeam() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<Record<string, string>>({ team_name: '' });
  const [invite, setInvite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== ''));
      await api.post('/teams', body);
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    const token = extractInviteToken(invite);
    if (token) navigate(`/invite/${token}`);
  };

  return (
    <div className="split">
      <Panel title="Create a Team">
        <form className="form" onSubmit={create}>
          <label>Team name<input required minLength={2} maxLength={60} value={form.team_name}
            onChange={(e) => setForm({ ...form, team_name: e.target.value })} /></label>
          <div className="grid2">
            {TEAM_FIELDS.map(([key, label]) => (
              <label key={key}>{label}<input maxLength={40} value={form[key] ?? ''}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>
            ))}
          </div>
          <label>Description<textarea rows={4} maxLength={1000} value={form.description ?? ''}
            onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <Alert>{error}</Alert>
          <div><button className="btn primary" disabled={busy}>Create</button></div>
        </form>
      </Panel>
      <Panel title="Join with an invite">
        <p className="muted">Ask your team owner or IGL for an invite link, then paste it here.</p>
        <form className="form" onSubmit={join}>
          <label>Invite link or code<input required value={invite} onChange={(e) => setInvite(e.target.value)}
            placeholder="https://…/invite/…" /></label>
          <div><button className="btn">Continue</button></div>
        </form>
      </Panel>
    </div>
  );
}

function MemberRow({ member, roster, me, onChange }: { member: Member; roster: RosterResponse; me: number; onChange: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const teamId = roster.team.team_id;
  const canSetRole = roster.viewer.can_lead || member.user_id === me;

  const patch = async (body: Record<string, unknown>) => {
    setError(null);
    try {
      await api.patch(`/teams/${teamId}/members/${member.user_id}`, body);
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove ${member.user_name} from the team?`)) return;
    try {
      await api.delete(`/teams/${teamId}/members/${member.user_id}`);
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <tr>
      <td>
        <strong>{member.user_name}</strong>{member.user_id === me ? <span className="muted"> (you)</span> : null}
        {error ? <div className="error-text">{error}</div> : null}
      </td>
      <td>
        {canSetRole ? (
          <select aria-label={`Player role for ${member.user_name}`} value={member.player_role ?? ''}
            onChange={(e) => patch({ player_role: e.target.value || null })}>
            <option value="">—</option>
            {PLAYER_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        ) : member.player_role ?? <span className="muted">—</span>}
      </td>
      <td>
        {member.is_owner ? <Badge tone="gold">Owner</Badge> : roster.viewer.is_owner ? (
          <label className="inline-check">
            <input type="checkbox" checked={member.is_igl} onChange={(e) => patch({ is_igl: e.target.checked })} />
            IGL access
          </label>
        ) : member.is_igl ? <Badge tone="green">IGL</Badge> : <span className="muted">Player</span>}
      </td>
      <td className="right">
        {roster.viewer.is_owner && !member.is_owner ? (
          <button type="button" className="btn ghost small danger" onClick={remove}>Remove</button>
        ) : null}
      </td>
    </tr>
  );
}

function Invites({ teamId }: { teamId: number }) {
  const invites = useLoad(() => api.get<{ invites: Invite[] }>(`/teams/${teamId}/invites`), [teamId]);
  const [hours, setHours] = useState(72);
  const [singleUse, setSingleUse] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    try {
      const res = await api.post<{ path: string }>(`/teams/${teamId}/invites`, {
        expires_in_hours: hours, max_uses: singleUse ? 1 : null,
      });
      setLink(`${window.location.origin}${res.path}`);
      setCopied(false);
      await invites.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const revoke = async (id: number) => {
    try {
      await api.delete(`/teams/${teamId}/invites/${id}`);
      await invites.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Panel title="Invite players">
      <div className="row wrap">
        <label className="inline">Expires in
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {INVITE_TTL_HOURS.map((h) => <option key={h} value={h}>{h < 24 ? `${h} hour` : `${h / 24} day${h > 24 ? 's' : ''}`}</option>)}
          </select>
        </label>
        <label className="inline-check"><input type="checkbox" checked={singleUse} onChange={(e) => setSingleUse(e.target.checked)} /> Single use</label>
        <button type="button" className="btn primary" onClick={create}><Icon name="plus" /> Create invite link</button>
      </div>
      {link ? (
        <div className="invite-link">
          <p className="muted">Share this link now — it will not be shown again.</p>
          <div className="row">
            <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.target.select()} />
            <button type="button" className="btn" onClick={copy}><Icon name="copy" /> {copied ? 'Copied' : 'Copy'}</button>
          </div>
        </div>
      ) : null}
      <Alert>{error}</Alert>
      {invites.data && invites.data.invites.length ? (
        <table className="table compact">
          <thead><tr><th>Created</th><th>Expires</th><th>Uses</th><th>Status</th><th /></tr></thead>
          <tbody>
            {invites.data.invites.map((inv) => (
              <tr key={inv.invite_id}>
                <td>{formatDateTime(inv.created_at)}</td>
                <td>{formatDateTime(inv.expires_at)}</td>
                <td>{inv.use_count}{inv.max_uses ? ` / ${inv.max_uses}` : ''}</td>
                <td><Badge tone={inv.status === 'active' ? 'green' : 'default'}>{inv.status.replace('_', ' ')}</Badge></td>
                <td className="right">{inv.status === 'active' ? (
                  <button type="button" className="btn ghost small danger" onClick={() => revoke(inv.invite_id)}>Revoke</button>
                ) : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Panel>
  );
}

function TeamView({ teamId }: { teamId: number }) {
  const { user, teams, refresh } = useAuth();
  const roster = useLoad(() => api.get<RosterResponse>(`/teams/${teamId}/roster`), [teamId]);
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle(roster.data?.team.team_name ?? 'Team');

  if (roster.loading && !roster.data) return <Loading />;
  if (!roster.data) return <Alert>{roster.error}</Alert>;
  const { team, members, viewer } = roster.data;
  const me = user?.user_id ?? 0;

  const leave = async () => {
    if (!window.confirm(`Leave ${team.team_name}?`)) return;
    try {
      await api.post(`/teams/${teamId}/leave`);
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const switchTeam = async (id: number) => {
    await api.patch(`/users/${me}`, { team_id: id });
    await refresh();
  };

  const details = TEAM_FIELDS.map(([k, label]) => [label, team[k]] as const).filter(([, v]) => v);

  return (
    <div className="split">
      <div className="stack">
        <Panel title={team.team_name} actions={teams.length > 1 ? (
          <select aria-label="Active team" value={teamId} onChange={(e) => switchTeam(Number(e.target.value))}>
            {teams.map((t) => <option key={t.team_id} value={t.team_id}>{t.team_name}</option>)}
          </select>
        ) : null}>
          {details.length ? (
            <p className="muted">{details.map(([label, v]) => `${label}: ${v}`).join(' · ')}</p>
          ) : null}
          {team.description ? <p>{team.description}</p> : null}
          <h3>Roster</h3>
          <table className="table">
            <thead><tr><th>Player</th><th>Role</th><th>Access</th><th /></tr></thead>
            <tbody>
              {members.map((m) => <MemberRow key={m.user_id} member={m} roster={roster.data!} me={me} onChange={async () => { await roster.reload(); await refresh(); }} />)}
            </tbody>
          </table>
          <p className="muted small">The owner and IGLs can edit tactics and control Game Mode. Player roles describe in-game jobs and do not grant access.</p>
          <Alert>{error}</Alert>
          {!viewer.is_owner ? <button type="button" className="btn ghost danger" onClick={leave}>Leave team</button> : null}
        </Panel>
      </div>
      {viewer.can_lead ? <Invites teamId={teamId} /> : (
        <Panel title="Invite players"><p className="muted">Ask your team owner or IGL for an invite link to share.</p></Panel>
      )}
    </div>
  );
}

export function TeamPage() {
  const { active_team: team } = useAuth();
  useDocumentTitle('Team');
  return team ? <TeamView teamId={team.team_id} /> : <NoTeam />;
}
