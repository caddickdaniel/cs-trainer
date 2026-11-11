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
    .first('teams.team_id', 'teams.owner', 'm.membership_id', 'm.is_igl');
  if (!row) return null;
  const isMember = row.membership_id != null;
  const isOwner = isMember && row.owner === userId;
  return {
    teamId: row.team_id,
    isMember,
    isOwner,
    isIgl: isMember && row.is_igl,
    canLead: isOwner || (isMember && row.is_igl),
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

module.exports = { getAccess, requireMember, requireLead, requireOwner, memberTeamIds, visibleUserIds };
