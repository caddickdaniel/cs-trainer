const crypto = require('crypto');
const db = require('../db/connection');
const { conflict, notFound, forbidden, badRequest, httpError } = require('../errors');
const { requireMember, requireLead, requireOwner } = require('./access');
const { syncActiveTeam } = require('./users');

const TEAM_FIELDS = ['team_name', 'language', 'region', 'platform', 'skill_level', 'description'];
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

// Serialises membership changes for one user (prevents double create/join).
async function lockUser(trx, userId) {
  const user = await trx('users').where('user_id', userId).forUpdate().first('user_id', 'team_id');
  if (!user) throw notFound('User not found');
  return user;
}

async function assertNoTeam(trx, userId) {
  const existing = await trx('team_memberships').where('user_id', userId).first('team_id');
  if (existing) {
    throw conflict('You are already in a team. Leave it before creating or joining another.', 'already_in_team');
  }
}

// Creates a team and its owner membership atomically.
async function createTeam(userId, fields) {
  return db.transaction(async (trx) => {
    await lockUser(trx, userId);
    await assertNoTeam(trx, userId);
    const [team] = await trx('teams')
      .insert({ ...pick(fields, TEAM_FIELDS), owner: userId })
      .returning('*');
    await trx('team_memberships').insert({ team_id: team.team_id, user_id: userId });
    await trx('users').where('user_id', userId).update({ team_id: team.team_id, updated_at: trx.fn.now() });
    return team;
  });
}

async function updateTeam(teamId, userId, fields) {
  await requireOwner(teamId, userId);
  const changes = pick(fields, TEAM_FIELDS);
  if (Object.keys(changes).length) {
    await db('teams').where('team_id', teamId).update({ ...changes, updated_at: db.fn.now() });
  }
}

async function deleteTeam(teamId, userId) {
  await requireOwner(teamId, userId);
  await db.transaction(async (trx) => {
    const memberIds = await trx('team_memberships').where('team_id', teamId).pluck('user_id');
    await trx('teams').where('team_id', teamId).del();
    for (const id of memberIds) await syncActiveTeam(trx, id);
  });
}

async function getRoster(teamId, userId) {
  const access = await requireMember(teamId, userId);
  const team = await db('teams').where('team_id', teamId)
    .first('team_id', 'team_name', 'owner', ...TEAM_FIELDS.slice(1));
  const members = await db('team_memberships as m')
    .join('users as u', 'u.user_id', 'm.user_id')
    .where('m.team_id', teamId)
    .orderBy([{ column: 'm.joined_at' }, { column: 'm.membership_id' }])
    .select('u.user_id', 'u.user_name', 'm.is_igl', 'm.player_role', 'm.joined_at');
  return {
    team,
    members: members.map((m) => ({
      ...m,
      is_owner: m.user_id === team.owner,
      can_lead: m.user_id === team.owner || m.is_igl,
    })),
    viewer: { is_owner: access.isOwner, is_igl: access.isIgl, can_lead: access.canLead },
  };
}

async function updateMember(teamId, actorId, targetId, changes) {
  const access = await requireMember(teamId, actorId);
  const membership = await db('team_memberships').where({ team_id: teamId, user_id: targetId }).first();
  if (!membership) throw notFound('That player is not on this team');
  const update = {};
  if (changes.is_igl !== undefined) {
    if (!access.isOwner) throw forbidden('Only the team owner can change IGL permissions');
    const team = await db('teams').where('team_id', teamId).first('owner');
    if (team.owner === targetId) throw badRequest('The owner always has IGL permissions', 'owner_is_lead');
    update.is_igl = changes.is_igl;
  }
  if (changes.player_role !== undefined) {
    if (!access.canLead && actorId !== targetId) {
      throw forbidden('Only the owner or an IGL can set another player\'s role');
    }
    update.player_role = changes.player_role;
  }
  await db('team_memberships').where({ team_id: teamId, user_id: targetId }).update(update);
}

async function removeMember(teamId, actorId, targetId) {
  const isSelf = actorId === targetId;
  if (isSelf) await requireMember(teamId, actorId);
  else await requireOwner(teamId, actorId);
  await db.transaction(async (trx) => {
    const team = await trx('teams').where('team_id', teamId).first('owner');
    if (team.owner === targetId) {
      throw conflict(isSelf ? 'The owner cannot leave their own team' : 'The owner cannot be removed', 'owner_cannot_leave');
    }
    await lockUser(trx, targetId);
    const removed = await trx('team_memberships').where({ team_id: teamId, user_id: targetId }).del();
    if (!removed) throw notFound('That player is not on this team');
    await syncActiveTeam(trx, targetId);
  });
}

// ---- Invites -------------------------------------------------------------

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function inviteStatus(invite, now = new Date()) {
  if (invite.revoked_at) return 'revoked';
  if (new Date(invite.expires_at) <= now) return 'expired';
  if (invite.max_uses != null && invite.use_count >= invite.max_uses) return 'used_up';
  return 'active';
}

const presentInvite = (invite) => ({
  invite_id: invite.invite_id,
  team_id: invite.team_id,
  created_at: invite.created_at,
  expires_at: invite.expires_at,
  revoked_at: invite.revoked_at,
  max_uses: invite.max_uses,
  use_count: invite.use_count,
  status: inviteStatus(invite),
});

async function createInvite(teamId, userId, { expires_in_hours, max_uses }) {
  await requireLead(teamId, userId);
  const token = crypto.randomBytes(24).toString('base64url');
  const [invite] = await db('team_invites')
    .insert({
      team_id: teamId,
      token_hash: hashToken(token),
      created_by: userId,
      expires_at: db.raw(`now() + make_interval(hours => ?)`, [expires_in_hours]),
      max_uses: max_uses ?? null,
    })
    .returning('*');
  // The raw token is only returned once; only its hash is stored.
  return { invite: presentInvite(invite), token, path: `/invite/${token}` };
}

async function listInvites(teamId, userId) {
  await requireLead(teamId, userId);
  const invites = await db('team_invites').where('team_id', teamId).orderBy('created_at', 'desc').limit(50);
  return invites.map(presentInvite);
}

async function revokeInvite(teamId, userId, inviteId) {
  await requireLead(teamId, userId);
  const updated = await db('team_invites')
    .where({ team_id: teamId, invite_id: inviteId })
    .update({ revoked_at: db.raw('coalesce(revoked_at, now())') })
    .returning('*');
  if (!updated.length) throw notFound('Invite not found');
  return presentInvite(updated[0]);
}

const INVITE_ERRORS = {
  revoked: ['This invite has been revoked', 'invite_revoked'],
  expired: ['This invite has expired', 'invite_expired'],
  used_up: ['This invite has already been used', 'invite_used_up'],
};

async function findInvite(trx, token, lock = false) {
  let query = trx('team_invites').where('token_hash', hashToken(token));
  if (lock) query = query.forUpdate();
  const invite = await query.first();
  if (!invite) throw notFound('This invite link is not valid', 'invite_not_found');
  return invite;
}

async function previewInvite(token, userId) {
  const invite = await findInvite(db, token);
  const status = inviteStatus(invite);
  const team = await db('teams').where('team_id', invite.team_id).first('team_id', 'team_name', 'region', 'language');
  const member = await db('team_memberships').where({ team_id: invite.team_id, user_id: userId }).first('membership_id');
  return { status, expires_at: invite.expires_at, team, already_member: Boolean(member) };
}

async function acceptInvite(token, userId) {
  return db.transaction(async (trx) => {
    const invite = await findInvite(trx, token, true);
    const status = inviteStatus(invite);
    if (status !== 'active') {
      const [message, code] = INVITE_ERRORS[status];
      throw httpError(410, message, code);
    }
    await lockUser(trx, userId);
    const member = await trx('team_memberships').where({ team_id: invite.team_id, user_id: userId }).first();
    if (member) throw conflict('You are already on this team', 'already_member');
    await assertNoTeam(trx, userId);
    await trx('team_memberships').insert({ team_id: invite.team_id, user_id: userId });
    await trx('team_invites').where('invite_id', invite.invite_id).increment('use_count', 1);
    await trx('users').where('user_id', userId).update({ team_id: invite.team_id, updated_at: trx.fn.now() });
    return trx('teams').where('team_id', invite.team_id).first('team_id', 'team_name');
  });
}

module.exports = {
  TEAM_FIELDS,
  createTeam,
  updateTeam,
  deleteTeam,
  getRoster,
  updateMember,
  removeMember,
  createInvite,
  listInvites,
  revokeInvite,
  previewInvite,
  acceptInvite,
  hashToken,
};
