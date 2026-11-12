// Team membership and permission checks. Every team-scoped route goes through
// these helpers; the acting user always comes from the server-side session.
const db = require('../db/connection');
const { notFound, forbidden } = require('../errors');

async function getAccess(teamId, userId, trx = db) {
  const row = await trx('teams')
    .leftJoin('team_memberships as m', function joinMember() {
      this.on('m.team_id', '=', 'teams.team_id').andOn('m.user_id', '=', trx.raw('?', [userId]));
    })
    .where('teams.team_id', teamId)
    .first('teams.team_id', 'teams.owner', 'm.membership_id', 'm.player_role');
  if (!row) return null;
  const isMember = row.membership_id != null;
  const isOwner = isMember && row.owner === userId;
  const isIgl = isMember && row.player_role === 'igl';
  return {
    teamId: row.team_id,
    isMember,
    isOwner,
    isIgl,
    // Tactic editing and invite links: owner or IGL (unchanged from milestone 1).
    canLead: isOwner || isIgl,
    // Live Game Mode control: only the team's current IGL.
    canControl: isIgl,
  };
}

// Non-members get 404 so team existence is not disclosed.
async function requireMember(teamId, userId, trx) {
  const access = await getAccess(teamId, userId, trx);
  if (!access || !access.isMember) throw notFound('Team not found');
  return access;
}

async function requireLead(teamId, userId, trx) {
  const access = await requireMember(teamId, userId, trx);
  if (!access.canLead) throw forbidden('Only the team owner or an IGL can do that');
  return access;
}

async function requireIgl(teamId, userId, trx) {
  const access = await requireMember(teamId, userId, trx);
  if (!access.canControl) throw forbidden('Only the team\'s IGL controls live Game Mode', 'not_igl');
  return access;
}

async function requireOwner(teamId, userId, trx) {
  const access = await requireMember(teamId, userId, trx);
  if (!access.isOwner) throw forbidden('Only the team owner can do that');
  return access;
}

function memberTeamIds(userId, trx = db) {
  return trx('team_memberships').where('user_id', userId).select('team_id');
}

// Users visible to the actor: themselves and anyone sharing a team.
function visibleUserIds(userId, trx = db) {
  return trx('team_memberships').whereIn('team_id', memberTeamIds(userId, trx)).select('user_id')
    .union(trx.raw('select ?::int', [userId]));
}

module.exports = { getAccess, requireMember, requireLead, requireIgl, requireOwner, memberTeamIds, visibleUserIds };
