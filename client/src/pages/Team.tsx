import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api, errorMessage } from '../lib/api';
import { INVITE_TTL_HOURS, LIMITS, PLAYER_ROLES, roleLabel } from '../lib/constants';
import { formatDateTime, useDocumentTitle, useLoad } from '../lib/hooks';
import type { Invite, JoinRequest, Member, PlayerSummary, RosterResponse, Team } from '../lib/types';
import { Alert, Badge, Loading, Panel } from '../components/ui';
import { Icon } from '../components/Icons';
import { Avatar, Facts, RoleBadge } from '../components/People';
import { InviteButton } from './PlayerProfile';
import { Combobox } from '../components/Combobox';
import { RankBadge } from '../components/RankBadge';
import { CompetitionList, CompetitionPicker, PlayerRankList, RankSelect, RequirementList, RequirementsEditor } from '../components/Recruitment';
import { useCatalogue, type Catalogue } from '../lib/catalogue';
import type { RankRequirement } from '../lib/types';

const PLATFORM_IDS = ['premier', 'faceit', 'esea'] as const;

// Language and region use the same searchable lists as player profiles.
function TeamOptionFields({ cat, form, setForm }: { cat: Catalogue | null; form: Record<string, string>; setForm: (f: Record<string, string>) => void }) {
  return (
    <div className="grid2">
      <Combobox label="Language" options={cat?.languages ?? []} value={form.language ?? ''} emptyLabel="Not set"
        onChange={(v) => setForm({ ...form, language: v })} />
      <Combobox label="Region" options={cat?.regions ?? []} value={form.region ?? ''} emptyLabel="Not set"
        onChange={(v) => setForm({ ...form, region: v })} />
    </div>
  );
}

// Accepts a full invite link or just the code.
export function extractInviteToken(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/invite\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : trimmed;
}

function NoTeam() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const cat = useCatalogue();
  const [form, setForm] = useState<Record<string, string>>({ team_name: '' });
  const [requirements, setRequirements] = useState<RankRequirement[]>([]);
  const [competitions, setCompetitions] = useState<string[]>([]);
  const [invite, setInvite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useLoad(() => api.get<{ invites: { status: string }[] }>('/me/invites'), []);
  const pendingCount = (pending.data?.invites ?? []).filter((i) => i.status === 'pending').length;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== ''));
      await api.post('/teams', { ...body, rank_requirements: requirements, competitions });
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
          <TeamOptionFields cat={cat} form={form} setForm={setForm} />
          <CompetitionPicker cat={cat} value={competitions} onChange={setCompetitions} />
          <RequirementsEditor cat={cat} value={requirements} onChange={setRequirements} />
          <label>Description<textarea rows={4} maxLength={1000} value={form.description ?? ''}
            onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <Alert>{error}</Alert>
          <div><button className="btn primary" disabled={busy}>Create</button></div>
        </form>
      </Panel>
      <div className="stack">
        {pendingCount ? (
          <Alert kind="success">You have {pendingCount} pending team invitation{pendingCount > 1 ? 's' : ''}. <Link to="/invites">Review invites</Link></Alert>
        ) : null}
        <Panel title="Find a team">
          <p className="muted">Browse teams that are recruiting and request an invite.</p>
          <Link className="btn" to="/recruiting"><Icon name="search" /> Teams looking for players</Link>
        </Panel>
        <Panel title="Join with an invite link">
          <form className="form" onSubmit={join}>
            <label>Invite link or code<input required value={invite} onChange={(e) => setInvite(e.target.value)}
              placeholder="https://…/invite/…" /></label>
            <div><button className="btn">Continue</button></div>
          </form>
        </Panel>
      </div>
    </div>
  );
}

function RoleSelect({ member, roster, me, onChange }: { member: Member; roster: RosterResponse; me: number; onChange: (role: string | null) => void }) {
  const { viewer } = roster;
  const isSelf = member.user_id === me;
  // Assigning or removing the IGL is owner-only; other roles follow milestone 1
  // rules (owner/IGL for anyone, players for themselves).
  const canEdit = member.is_igl ? viewer.is_owner : (viewer.can_lead || isSelf);
  if (!canEdit) return <RoleBadge role={member.player_role} />;
  const options = PLAYER_ROLES.filter((r) => r !== 'igl' || viewer.is_owner);
  return (
    <select aria-label={`Role for ${member.user_name}`} value={member.player_role ?? ''}
      onChange={(e) => {
        const role = e.target.value || null;
        if (role === 'igl') {
          const current = roster.members.find((m) => m.is_igl);
          const msg = current && current.user_id !== member.user_id
            ? `Make ${member.user_name} the IGL? Live Game Mode control moves from ${current.user_name} to ${member.user_name} immediately.`
            : `Make ${member.user_name} the IGL? They will control live Game Mode.`;
          if (!window.confirm(msg)) return;
        }
        onChange(role);
      }}>
      <option value="">No role</option>
      {options.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
    </select>
  );
}

function MemberRow({ member, roster, me, onChange }: { member: Member; roster: RosterResponse; me: number; onChange: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const teamId = roster.team.team_id;

  const setRole = async (role: string | null) => {
    setError(null);
    try {
      await api.patch(`/teams/${teamId}/members/${member.user_id}`, { player_role: role });
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const remove = async () => {
    const extra = member.is_igl ? ' They are the IGL, so nobody will control Game Mode until you assign a new IGL.' : '';
    if (!window.confirm(`Remove ${member.user_name} from ${roster.team.team_name}? They will lose access to the team's tactics, calendar and Game Mode.${extra}`)) return;
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
        <div className="row">
          <Avatar name={member.user_name} url={member.avatar_url} size={32} />
          <div>
            <Link to={`/players/${member.user_id}`}><strong>{member.user_name}</strong></Link>
            {member.user_id === me ? <span className="muted"> (you)</span> : null}
            {error ? <div className="error-text">{error}</div> : null}
          </div>
        </div>
      </td>
      <td><RoleSelect member={member} roster={roster} me={me} onChange={setRole} /></td>
      <td>
        <span className="row wrap tight-row">
          {member.is_owner ? <Badge tone="gold">Owner</Badge> : null}
          {member.is_igl ? <Badge tone="red">Controls Game Mode</Badge> : null}
        </span>
      </td>
      <td className="right">
        {roster.viewer.is_owner && !member.is_owner ? (
          <button type="button" className="btn ghost small danger" onClick={remove}>Remove</button>
        ) : null}
      </td>
    </tr>
  );
}

function TeamDetails({ roster, onChange }: { roster: RosterResponse; onChange: () => Promise<void> }) {
  const { team, viewer } = roster;
  const { refresh } = useAuth();
  const [editing, setEditing] = useState(false);
  const cat = useCatalogue();
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setForm({ team_name: team.team_name, language: team.language ?? '', region: team.region ?? '', description: team.description ?? '' });
    setEditing(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.patch(`/teams/${team.team_id}`, Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() === '' && k !== 'team_name' ? null : v])));
      setEditing(false);
      await Promise.all([onChange(), refresh()]);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const upload = async (file?: File) => {
    if (!file) return;
    setError(null);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setError('Team pictures must be PNG, JPEG or WebP.'); return; }
    if (file.size > LIMITS.pictureBytes) { setError('Team pictures must be 2 MB or smaller.'); return; }
    try {
      await api.uploadPicture(`/teams/${team.team_id}/logo`, file);
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeLogo = async () => {
    try {
      await api.delete(`/teams/${team.team_id}/logo`);
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="team-head">
      <div className="stack tight team-logo">
        <Avatar name={team.team_name} url={team.logo_url} size={84} />
        {viewer.is_owner ? (
          <>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
            <button type="button" className="btn ghost small" onClick={() => fileRef.current?.click()}>{team.logo_url ? 'Change picture' : 'Add picture'}</button>
            {team.logo_url ? <button type="button" className="btn ghost small danger" onClick={removeLogo}>Remove picture</button> : null}
          </>
        ) : null}
      </div>
      <div className="grow">
        {editing ? (
          <form className="form compact" onSubmit={save}>
            <label>Team name<input required minLength={2} maxLength={60} value={form.team_name} onChange={(e) => setForm({ ...form, team_name: e.target.value })} /></label>
            <TeamOptionFields cat={cat} form={form} setForm={setForm} />
            <label>Description<textarea rows={3} maxLength={1000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <div className="row">
              <button className="btn primary">Save details</button>
              <button type="button" className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <>
            <div className="row space">
              <h1>{team.team_name}</h1>
              {viewer.is_owner ? (
                <div className="row tight-row">
                  <button type="button" className="btn ghost small" onClick={startEdit}><Icon name="edit" /> Edit details</button>
                  <DeleteTeamButton roster={roster} />
                </div>
              ) : null}
            </div>
            <Facts items={[['Language', team.language], ['Region', team.region],
              ['Plays', team.competitions.length || team.recruiting_leagues ? <CompetitionList cat={cat} ids={team.competitions} legacy={team.recruiting_leagues} /> : null],
              ['Recruiting', team.rank_requirements.length || team.legacy_requirement ? <RequirementList cat={cat} list={team.rank_requirements} legacy={team.legacy_requirement} /> : null]]} />
            {team.description ? <p>{team.description}</p> : null}
          </>
        )}
        <Alert>{error}</Alert>
      </div>
    </div>
  );
}

function RecruitingSettings({ team, onChange }: { team: Team; onChange: () => Promise<void> }) {
  const cat = useCatalogue();
  const [form, setForm] = useState({
    is_recruiting: team.is_recruiting, roles_needed: team.roles_needed, recruiting_notes: team.recruiting_notes ?? '',
    competitions: team.competitions, rank_requirements: team.rank_requirements,
  });
  // Legacy free text is only replaced once the owner touches the list.
  const [touched, setTouched] = useState({ competitions: false, rank_requirements: false });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const { competitions, rank_requirements: reqs, ...rest } = form;
      await api.patch(`/teams/${team.team_id}/recruiting`, {
        ...rest, recruiting_notes: form.recruiting_notes || null,
        ...(touched.competitions || !team.recruiting_leagues ? { competitions } : {}),
        ...(touched.rank_requirements || !team.legacy_requirement ? { rank_requirements: reqs } : {}),
      });
      setMessage(form.is_recruiting ? 'Your team is listed under Recruiting.' : 'Your team is not listed under Recruiting.');
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const toggleRole = (r: (typeof PLAYER_ROLES)[number]) =>
    setForm({ ...form, roles_needed: form.roles_needed.includes(r) ? form.roles_needed.filter((x) => x !== r) : [...form.roles_needed, r] });
  return (
    <Panel title="Recruiting">
      <form className="form compact" onSubmit={save}>
        <label className="inline-check"><input type="checkbox" checked={form.is_recruiting} onChange={(e) => setForm({ ...form, is_recruiting: e.target.checked })} />
          Show this team in "Teams looking for players"</label>
        <CompetitionPicker cat={cat} value={form.competitions} legacy={touched.competitions ? null : team.recruiting_leagues}
          onChange={(v) => { setForm({ ...form, competitions: v }); setTouched({ ...touched, competitions: true }); }} />
        <RequirementsEditor cat={cat} value={form.rank_requirements}
          onChange={(v) => { setForm({ ...form, rank_requirements: v }); setTouched({ ...touched, rank_requirements: true }); }} />
        {team.legacy_requirement && !touched.rank_requirements ? (
          <p className="muted small">Previously entered: “{team.legacy_requirement}”. It's kept until you set requirements above.</p>
        ) : null}
        <p className="muted small">Leagues and matchmaking say where the team plans to play; rank requirements say who it's recruiting.</p>
        <fieldset className="role-picker">
          <legend>Roles needed</legend>
          {PLAYER_ROLES.map((r) => (
            <label key={r} className="inline-check"><input type="checkbox" checked={form.roles_needed.includes(r)} onChange={() => toggleRole(r)} />
              <RoleBadge role={r} /></label>
          ))}
        </fieldset>
        <label>About the opening<textarea rows={3} maxLength={1000} value={form.recruiting_notes}
          onChange={(e) => setForm({ ...form, recruiting_notes: e.target.value })} /></label>
        <Alert>{error}</Alert>
        {message ? <Alert kind="success">{message}</Alert> : null}
        <div className="row">
          <button className="btn primary">Save recruiting</button>
          {team.is_recruiting ? <Link to={`/recruiting/${team.team_id}`} className="btn ghost small">View listing</Link> : null}
        </div>
      </form>
    </Panel>
  );
}

function JoinRequests({ teamId }: { teamId: number }) {
  const requests = useLoad(() => api.get<{ requests: JoinRequest[] }>(`/teams/${teamId}/requests`), [teamId]);
  const [error, setError] = useState<string | null>(null);
  const act = async (r: JoinRequest, approve: boolean) => {
    setError(null);
    try {
      await api.post(`/teams/${teamId}/requests/${r.request_id}/${approve ? 'invite' : 'decline'}`);
    } catch (err) {
      setError(errorMessage(err));
    }
    await requests.reload();
  };
  const list = requests.data?.requests ?? [];
  const pending = list.filter((r) => r.status === 'pending');
  return (
    <Panel title={<span id="requests">Requests to join{pending.length ? ` (${pending.length})` : ''}</span>}>
      <Alert>{error}</Alert>
      {list.length ? (
        <ul className="plain-list">
          {list.map((r) => (
            <li key={r.request_id} className="list-card compact">
              <Avatar name={r.user_name} url={r.avatar_url} size={36} />
              <div className="grow">
                <Link to={`/players/${r.user_id}`}><strong>{r.user_name}</strong></Link>
                <div className="muted small row wrap">{[r.language, r.region].filter(Boolean).join(' · ')}
                  <RequestRank r={r} /></div>
                {r.message ? <div className="small">“{r.message}”</div> : null}
              </div>
              {r.status === 'pending' ? (
                r.has_team ? <span className="muted small">Joined another team</span> : (
                  <div className="row">
                    <button type="button" className="btn primary small" onClick={() => act(r, true)}>Send invite</button>
                    <button type="button" className="btn ghost small" onClick={() => act(r, false)}>Decline</button>
                  </div>
                )
              ) : <Badge tone={r.status === 'invited' ? 'green' : 'default'}>{r.status === 'invited' ? 'Invite sent' : 'Declined'}</Badge>}
            </li>
          ))}
        </ul>
      ) : <p className="muted">No requests yet. Turn on recruiting so players can find your team.</p>}
    </Panel>
  );
}

function RequestRank({ r }: { r: JoinRequest }) {
  const cat = useCatalogue();
  if (!Object.values(r.ranks).some(Boolean) && !r.legacy_platform && !r.legacy_skill_level) return null;
  return <PlayerRankList cat={cat} ranks={r.ranks} legacyPlatform={r.legacy_platform} legacySkill={r.legacy_skill_level} />;
}

// Player search filters, using the same options as the profile editor.
function PlayerFilters({ value, onChange }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const cat = useCatalogue();
  const set = (k: string, v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="filter-grid">
      <Combobox label="Language" options={cat?.languages ?? []} value={value.language ?? ''} onChange={(v) => set('language', v)} emptyLabel="Any language" />
      <Combobox label="Region" options={cat?.regions ?? []} value={value.region ?? ''} onChange={(v) => set('region', v)} emptyLabel="Any region" />
      {PLATFORM_IDS.map((p) => (
        <RankSelect key={p} cat={cat} platform={p} label={`${cat?.platforms.find((x) => x.id === p)?.label ?? p} rank`}
          emptyLabel="Any" value={value[p] ?? ''} onChange={(v) => set(p, v)} />
      ))}
    </div>
  );
}

function Invites({ teamId }: { teamId: number }) {
  const cat = useCatalogue();
  const invites = useLoad(() => api.get<{ invites: Invite[] }>(`/teams/${teamId}/invites`), [teamId]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const players = useLoad(() => api.get<{ players: PlayerSummary[]; can_invite: boolean; inviting_team: { team_id: number } | null }>(
    `/players/available${query ? `?${query}` : ''}`), [query]);
  const [hours, setHours] = useState(72);
  const [singleUse, setSingleUse] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    try {
      const res = await api.post<{ path: string }>(`/teams/${teamId}/invites`, { expires_in_hours: hours, max_uses: singleUse ? 1 : null });
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
      await Promise.all([invites.reload(), players.reload()]);
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

  const refreshAll = () => { players.reload(); invites.reload(); };
  const shownInvites = (invites.data?.invites ?? []).filter((i) => i.kind === 'player' || i.status === 'active');

  return (
    <Panel title="Invite players">
      <h3>Players looking for a team</h3>
      <PlayerFilters value={filters} onChange={setFilters} />
      {players.data?.players.length ? (
        <table className="table compact">
          <thead><tr><th>Player</th><th>Language</th><th>Region</th>
            {PLATFORM_IDS.map((p) => <th key={p}>{cat?.platforms.find((x) => x.id === p)?.label ?? p}</th>)}<th /></tr></thead>
          <tbody>
            {players.data.players.map((p) => (
              <tr key={p.user_id}>
                <td><div className="row"><Avatar name={p.user_name} url={p.avatar_url} size={28} /><div><Link to={`/players/${p.user_id}`}>{p.user_name}</Link>
                  {p.legacy_platform || p.legacy_skill_level ? <div><RankBadge cat={cat} legacyPlatform={p.legacy_platform} legacySkill={p.legacy_skill_level} /></div> : null}</div></div></td>
                <td>{p.language ?? <span className="muted">—</span>}</td>
                <td>{p.region ?? <span className="muted">—</span>}</td>
                {PLATFORM_IDS.map((k) => <td key={k}>{p.ranks[k] ? <RankBadge cat={cat} rankId={p.ranks[k]} compact /> : null}</td>)}
                <td className="right">
                  <InviteButton teamId={players.data!.inviting_team?.team_id} userId={p.user_id} status={p.invite_status}
                    canInvite={players.data!.can_invite} onDone={refreshAll} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {players.data?.players.length ? <p className="muted small">Ranks are self-reported. A blank cell means the player hasn't entered that rank.</p> : null}
      {players.data?.players.length ? null : <p className="muted">{query ? 'No players match these filters.' : 'No players without a team right now.'}</p>}

      <h3>Invite link</h3>
      <div className="row wrap">
        <label className="inline">Expires in
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {INVITE_TTL_HOURS.map((h) => <option key={h} value={h}>{h < 24 ? `${h} hour` : `${h / 24} day${h > 24 ? 's' : ''}`}</option>)}
          </select>
        </label>
        <label className="inline-check"><input type="checkbox" checked={singleUse} onChange={(e) => setSingleUse(e.target.checked)} /> Single use</label>
        <button type="button" className="btn" onClick={create}><Icon name="plus" /> Create invite link</button>
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
      {shownInvites.length ? (
        <>
          <h3>Sent invites</h3>
          <table className="table compact">
            <thead><tr><th>For</th><th>Expires</th><th>Status</th><th /></tr></thead>
            <tbody>
              {shownInvites.map((inv) => (
                <tr key={inv.invite_id}>
                  <td>{inv.kind === 'player' ? <Link to={`/players/${inv.invitee_user_id}`}>{inv.invitee_name}</Link> : `Link${inv.max_uses ? ` (${inv.use_count}/${inv.max_uses})` : ` (${inv.use_count} used)`}`}</td>
                  <td>{formatDateTime(inv.expires_at)}</td>
                  <td><Badge tone={['active', 'pending'].includes(inv.status) ? 'gold' : inv.status === 'accepted' ? 'green' : 'default'}>{inv.status.replace('_', ' ')}</Badge></td>
                  <td className="right">{['active', 'pending'].includes(inv.status) ? (
                    <button type="button" className="btn ghost small danger" onClick={() => revoke(inv.invite_id)}>Revoke</button>
                  ) : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </Panel>
  );
}

// Owner-only. Opens a confirmation dialog; the final button stays disabled
// until the owner types DELETE. The server re-checks ownership.
function DeleteTeamButton({ roster }: { roster: RosterResponse }) {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const ref = useRef<HTMLDialogElement>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = roster.team.team_name;
  const others = roster.members.length - 1;
  const open = () => { setConfirm(''); setError(null); ref.current?.showModal(); };
  const remove = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.delete(`/teams/${roster.team.team_id}`);
      ref.current?.close();
      await refresh();
      navigate('/team');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className="btn ghost small danger" onClick={open}><Icon name="trash" /> Delete team</button>
      <dialog ref={ref} className="modal" aria-labelledby="delete-team-title" aria-describedby="delete-team-desc">
        <form method="dialog" className="modal-body" onSubmit={(e) => { e.preventDefault(); if (confirm === 'DELETE') void remove(); }}>
          <h2 id="delete-team-title">Delete {name}?</h2>
          <div id="delete-team-desc" className="stack tight">
            <p>This permanently deletes the team <strong>{name}</strong> and everything that belongs to it:</p>
            <ul className="privacy-list">
              <li>its tactics, lineup screenshots and calendar events</li>
              <li>its community listings (and their votes and import counts)</li>
              <li>uploaded demos, demo reviews and annotations</li>
              <li>open invites, join requests and Game Mode history</li>
            </ul>
            <p>{others > 0 ? `${others} other member${others === 1 ? '' : 's'} will lose access. ` : ''}Player accounts and profiles are not deleted. This cannot be undone.</p>
          </div>
          <label>Type DELETE to confirm
            <input value={confirm} autoComplete="off" spellCheck={false} onChange={(e) => setConfirm(e.target.value)} aria-describedby="delete-team-hint" />
          </label>
          <span id="delete-team-hint" className="muted small">Capital letters, exactly as shown.</span>
          <Alert>{error}</Alert>
          <div className="row">
            <button type="submit" className="btn danger-solid" disabled={confirm !== 'DELETE' || busy}>{busy ? 'Deleting…' : 'Delete team permanently'}</button>
            <button type="button" className="btn ghost" onClick={() => ref.current?.close()}>Cancel</button>
          </div>
        </form>
      </dialog>
    </>
  );
}

function TeamView({ teamId }: { teamId: number }) {
  const { user, teams, refresh } = useAuth();
  const location = useLocation();
  const roster = useLoad(() => api.get<RosterResponse>(`/teams/${teamId}/roster`), [teamId]);
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle(roster.data?.team.team_name ?? 'Team');

  useEffect(() => {
    if (roster.data && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [roster.data, location.hash]);

  if (roster.loading && !roster.data) return <Loading />;
  if (!roster.data) return <Alert>{roster.error}</Alert>;
  const { team, members, viewer } = roster.data;
  const me = user?.user_id ?? 0;
  const igl = members.find((m) => m.is_igl);
  const reload = async () => { await roster.reload(); await refresh(); };

  const leave = async () => {
    if (!window.confirm(`Leave ${team.team_name}? You will lose access to its tactics, calendar and Game Mode.`)) return;
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

  return (
    <div className="split">
      <div className="stack">
        <Panel actions={teams.length > 1 ? (
          <select aria-label="Active team" value={teamId} onChange={(e) => switchTeam(Number(e.target.value))}>
            {teams.map((t) => <option key={t.team_id} value={t.team_id}>{t.team_name}</option>)}
          </select>
        ) : null}>
          <TeamDetails roster={roster.data} onChange={reload} />
          <h3>Roster ({members.length})</h3>
          <table className="table">
            <thead><tr><th>Player</th><th>Role</th><th>Access</th><th /></tr></thead>
            <tbody>
              {members.map((m) => <MemberRow key={m.user_id} member={m} roster={roster.data!} me={me} onChange={reload} />)}
            </tbody>
          </table>
          <p className="muted small">
            The IGL controls live Game Mode{igl ? ` (currently ${igl.user_name})` : ''}. Only the owner can assign the IGL, and assigning it to
            another player moves control to them immediately. The owner and the IGL can edit tactics and send invites.
          </p>
          {!igl ? <Alert kind="warn">No IGL is assigned, so nobody can control Game Mode. {viewer.is_owner ? 'Pick an IGL in the Role column.' : 'Ask the owner to assign one.'}</Alert> : null}
          <Alert>{error}</Alert>
          {!viewer.is_owner ? <button type="button" className="btn ghost danger" onClick={leave}>Leave team</button> : null}
        </Panel>
        {viewer.is_owner ? <RecruitingSettings key={`${team.team_id}-${team.is_recruiting}`} team={team} onChange={reload} /> : null}
      </div>
      <div className="stack">
        {viewer.is_owner ? <JoinRequests teamId={teamId} /> : null}
        {viewer.can_lead ? <Invites teamId={teamId} /> : (
          <Panel title="Invite players"><p className="muted">Ask your team owner or IGL to invite players.</p></Panel>
        )}
      </div>
    </div>
  );
}

export function TeamPage() {
  const { active_team: team } = useAuth();
  useDocumentTitle('Team');
  return team ? <TeamView teamId={team.team_id} /> : <NoTeam />;
}
