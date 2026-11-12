// "Teams looking for players": only discovery information is returned here.
// Tactics, calendars, invites and rosters keep their membership checks.
const db = require('../db/connection');
const { notFound } = require('../errors');
const { pictureUrl } = require('./pictures');

const teamColumns = (q) => q.select(
  't.team_id', 't.team_name', 't.logo_image_id', 't.language', 't.region', 't.platform', 't.skill_level',
  't.description', 't.recruiting_leagues', 't.roles_needed', 't.recruiting_notes', 't.is_recruiting',
  db.raw('(select count(*)::int from team_memberships m where m.team_id = t.team_id) as roster_size'),
);

async function viewerState(viewerId, teamIds) {
  const [membership, requests, invites] = await Promise.all([
    db('team_memberships').where('user_id', viewerId).first('team_id'),
    db('team_join_requests').where({ user_id: viewerId, status: 'pending' }).whereIn('team_id', teamIds).pluck('team_id'),
    db('team_invites').where('invitee_user_id', viewerId).whereIn('team_id', teamIds)
      .whereNull('response').whereNull('revoked_at').where('expires_at', '>', db.fn.now()).pluck('team_id'),
  ]);
  return { hasTeam: Boolean(membership), memberOf: membership && membership.team_id, requests: new Set(requests), invites: new Set(invites) };
}

function present(t, state) {
  const requestStatus = state.invites.has(t.team_id) ? 'invited' : state.requests.has(t.team_id) ? 'pending' : null;
  return {
    team_id: t.team_id,
    team_name: t.team_name,
    logo_url: pictureUrl(t.logo_image_id),
    language: t.language,
    region: t.region,
    platform: t.platform,
    skill_level: t.skill_level,
    description: t.description,
    recruiting_leagues: t.recruiting_leagues,
    roles_needed: t.roles_needed || [],
    recruiting_notes: t.recruiting_notes,
    roster_size: t.roster_size,
    request_status: requestStatus,
    can_request: !state.hasTeam && !requestStatus,
    is_member: state.memberOf === t.team_id,
  };
}

async function listRecruitingTeams(viewerId) {
  const teams = await teamColumns(db('teams as t').where('t.is_recruiting', true).orderBy([{ column: 't.team_name' }, { column: 't.team_id' }]));
  const state = await viewerState(viewerId, teams.map((t) => t.team_id));
  return { teams: teams.map((t) => present(t, state)), viewer_has_team: state.hasTeam };
}

// Details for a recruiting team (or the viewer's own team).
async function getRecruitingTeam(viewerId, teamId) {
  const t = await teamColumns(db('teams as t').where('t.team_id', teamId)).first();
  if (!t) throw notFound('Team not found');
  const state = await viewerState(viewerId, [teamId]);
  if (!t.is_recruiting && state.memberOf !== teamId) throw notFound('Team not found');
  return { team: present(t, state), viewer_has_team: state.hasTeam };
}

module.exports = { listRecruitingTeams, getRecruitingTeam };
