import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { PROFILE_LINKS } from '../lib/constants';
import { useDocumentTitle, useLoad } from '../lib/hooks';
import type { Profile } from '../lib/types';
import { Alert, Badge, Loading, Panel } from '../components/ui';
import { Avatar, Facts } from '../components/People';
import { PlayerRankList } from '../components/Recruitment';
import { PlayerStats } from '../components/PlayerStats';
import { useCatalogue } from '../lib/catalogue';
import type { PlayerStatsResponse } from '../lib/types';

interface Response {
  profile: Profile;
  can_invite: boolean;
  invite_status: 'pending' | null;
  inviting_team?: { team_id: number; team_name: string };
}

// The Invite button here sends the same request as the one in the Team
// page's "Invite players" list.
export function InviteButton({ teamId, userId, status, canInvite, onDone }: {
  teamId?: number; userId: number; status: 'pending' | null; canInvite: boolean; onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (status === 'pending') return <Badge tone="gold">Invite pending</Badge>;
  if (!canInvite || !teamId) return null;
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/teams/${teamId}/invites`, { user_id: userId });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-action">
      <button type="button" className="btn primary small" onClick={send} disabled={busy}>Invite</button>
      {error ? <span className="error-text">{error}</span> : null}
    </span>
  );
}

export function PlayerProfilePage() {
  const { userId } = useParams();
  const data = useLoad(() => api.get<Response>(`/players/${userId}`), [userId]);
  const stats = useLoad(() => api.get<PlayerStatsResponse>(`/players/${userId}/stats`), [userId]);
  const cat = useCatalogue();
  useDocumentTitle(data.data?.profile.user_name ?? 'Player');
  if (data.loading && !data.data) return <Loading />;
  if (!data.data) return <Panel title="Player"><Alert>{data.error}</Alert></Panel>;
  const { profile, can_invite: canInvite, invite_status: status, inviting_team: team } = data.data;
  const links = PROFILE_LINKS.filter((l) => profile[l.key]);
  return (
    <div className="stack narrow-page">
      <Panel>
        <div className="profile-head">
          <Avatar name={profile.user_name} url={profile.avatar_url} size={88} />
          <div className="stack tight">
            <h1>{profile.user_name}</h1>
            {profile.team ? <p className="muted">Plays for {profile.team.team_name}</p> : <Badge tone="green">Looking for a team</Badge>}
            <div className="row wrap">
              <InviteButton teamId={team?.team_id} userId={profile.user_id} status={status} canInvite={canInvite} onDone={data.reload} />
              {team && (canInvite || status) ? <span className="muted small">to {team.team_name}</span> : null}
            </div>
          </div>
        </div>
        <Facts items={[['Language', profile.language], ['Region', profile.region]]} />
        <div className="row wrap"><span className="muted small">Ranks (self-reported)</span>
          <PlayerRankList cat={cat} ranks={profile.ranks} legacyPlatform={profile.legacy_platform} legacySkill={profile.legacy_skill_level} /></div>
        <h3>Bio</h3>
        {profile.bio ? <p className="bio">{profile.bio}</p> : <p className="muted">No bio yet.</p>}
        {links.length ? (
          <>
            <h3>Profiles</h3>
            <div className="row wrap">
              {links.map((l) => (
                <a key={l.key} className="btn ghost small" href={profile[l.key] as string} target="_blank" rel="noreferrer noopener">{l.label}</a>
              ))}
            </div>
          </>
        ) : null}
      </Panel>
      <PlayerStats data={stats.data} own={false} />
      <Link to="/team">Back to Team</Link>
    </div>
  );
}
