const crypto = require('crypto');
const db = require('../db/connection');
const { LIMITS } = require('../domain/constants');
const { conflict, notFound, forbidden, httpError } = require('../errors');
const { requireMember, requireLead, requireOwner } = require('./access');
const { syncActiveTeam } = require('./users');
const { notify } = require('./notifications');
const { pictureUrl } = require('./pictures');

const TEAM_FIELDS = ['team_name', 'language', 'region', 'platform', 'skill_level', 'description'];
const RECRUITING_FIELDS = ['is_recruiting', 'recruiting_leagues', 'roles_needed', 'recruiting_notes'];
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

// Serialises membership changes for one user (prevents double create/join).
async function lockUser(trx, userId) {
  const user = await trx('users').where('user_id', userId).forUpdate().first('user_id', 'team_id');
  if (!user) throw notFound('User not found');
  return user;
}

async function assertNoTeam(trx, userId, message = 'You are already in a team. Leave it before creating or joining another.') {
  const existing = await trx('team_memberships').where('user_id', userId).first('team_id');
  if (existing) throw conflict(message, 'already_in_team');
}

async function joinTeam(trx, teamId, userId) {
  await trx('team_memberships').insert({ team_id: teamId, user_id: userId });
  await trx('users').where('user_id', userId).update({ team_id: teamId, updated_at: trx.fn.now() });
}

// Live sessions re-render when their version changes; bump it when who
// controls the team changes so every screen picks it up on the next poll.
const touchActiveSession = (trx, teamId) =>
  trx('game_sessions').where({ team_id: teamId, status: 'active' })
    .update({ version: trx.raw('version + 1'), updated_at: trx.fn.now() });

// Creates a team and its owner membership atomically. The creator starts as
// the team's IGL so they can run Game Mode straight away.
async function createTeam(userId, fields) {
  return db.transaction(async (trx) => {
    await lockUser(trx, userId);
    await assertNoTeam(trx, userId);
    const [team] = await trx('teams')
      .insert({ ...pick(fields, TEAM_FIELDS), owner: userId })
      .returning('*');
    await trx('team_memberships').insert({ team_id: team.team_id, user_id: userId, player_role: 'igl', is_igl: true });
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

async function updateRecruiting(teamId, userId, fields) {
  await requireOwner(teamId, userId);
  const changes = pick(fields, RECRUITING_FIELDS);
  if (Object.keys(changes).length) {
    await db('teams').where('team_id', teamId).update({ ...changes, updated_at: db.fn.now() });
  }
}

// Deletes the team; memberships, tactics, invites, requests, events, images
// and Game Mode sessions cascade. Every former member's active team is moved
// to another membership (or cleared). Notifications keep their snapshot text.
async function deleteTeam(teamId, userId) {
  await requireOwner(teamId, userId);
  const demoKeys = await db.transaction(async (trx) => {
    await trx('teams').where('team_id', teamId).forUpdate().first('team_id');
    const keys = await trx('demos').where('team_id', teamId).pluck('storage_key');
    const memberIds = await trx('team_memberships').where('team_id', teamId).pluck('user_id');
    const logo = await trx('teams').where('team_id', teamId).first('logo_image_id');
    await trx('teams').where('team_id', teamId).del();
    if (logo && logo.logo_image_id) await trx('public_images').where('image_id', logo.logo_image_id).del();
    for (const id of memberIds) await syncActiveTeam(trx, id);
    return keys;
  });
  // Uploaded demo files live on disk; their rows were removed by the cascade.
  const { demoStorageDir } = require('../config/env');
  const path = require('path');
  await Promise.all(demoKeys.map((k) => require('fs/promises').rm(path.join(demoStorageDir, k), { force: true })));
}

function presentTeam(team) {
  return {
    team_id: team.team_id,
    team_name: team.team_name,
    owner: team.owner,
    language: team.language,
    region: team.region,
    platform: team.platform,
    skill_level: team.skill_level,
    description: team.description,
    logo_url: pictureUrl(team.logo_image_id),
    is_recruiting: team.is_recruiting,
    recruiting_leagues: team.recruiting_leagues,
    roles_needed: team.roles_needed || [],
    recruiting_notes: team.recruiting_notes,
  };
}

async function getRoster(teamId, userId) {
  const access = await requireMember(teamId, userId);
  const team = await db('teams').where('team_id', teamId).first();
  const members = await db('team_memberships as m')
    .join('users as u', 'u.user_id', 'm.user_id')
    .where('m.team_id', teamId)
    .orderBy([{ column: 'm.joined_at' }, { column: 'm.membership_id' }])
    .select('u.user_id', 'u.user_name', 'u.avatar_image_id', 'm.player_role', 'm.joined_at');
  return {
    team: presentTeam(team),
    members: members.map(({ avatar_image_id, ...m }) => ({
      ...m,
      avatar_url: pictureUrl(avatar_image_id),
      is_igl: m.player_role === 'igl',
      is_owner: m.user_id === team.owner,
      can_lead: m.user_id === team.owner || m.player_role === 'igl',
    })),
    viewer: {
      is_owner: access.isOwner,
      is_igl: access.isIgl,
      can_lead: access.canLead,
      can_control: access.canControl,
    },
  };
}

// Changes a roster role. 'igl' is special: only the owner assigns or removes
// it, and assigning it moves it (and live Game Mode control) from the previous
// IGL in the same transaction. `is_igl` is accepted for compatibility.
async function updateMember(teamId, actorId, targetId, changes) {
  const access = await requireMember(teamId, actorId);
  await db.transaction(async (trx) => {
    // Serialise role changes per team so two transfers cannot both win.
    await trx('teams').where('team_id', teamId).forUpdate().first('team_id');
    const membership = await trx('team_memberships').where({ team_id: teamId, user_id: targetId }).first();
    if (!membership) throw notFound('That player is not on this team');

    let role = changes.player_role;
    if (changes.is_igl === true) role = 'igl';
    if (changes.is_igl === false && role === undefined) role = membership.player_role === 'igl' ? null : membership.player_role;
    if (role === undefined || role === membership.player_role) return;

    const touchesIgl = role === 'igl' || membership.player_role === 'igl';
    if (touchesIgl && !access.isOwner) throw forbidden('Only the team owner can assign or remove the IGL', 'owner_only');
    if (!access.canLead && actorId !== targetId) {
      throw forbidden('Only the owner or the IGL can set another player\'s role');
    }

    if (role === 'igl') {
      await trx('team_memberships').where({ team_id: teamId, player_role: 'igl' })
        .update({ player_role: null, is_igl: false });
    }
    await trx('team_memberships').where({ team_id: teamId, user_id: targetId })
      .update({ player_role: role, is_igl: role === 'igl' });
    if (touchesIgl) await touchActiveSession(trx, teamId);
  });
}

async function removeMember(teamId, actorId, targetId) {
  const isSelf = actorId === targetId;
  if (isSelf) await requireMember(teamId, actorId);
  else await requireOwner(teamId, actorId);
  await db.transaction(async (trx) => {
    const team = await trx('teams').where('team_id', teamId).forUpdate().first('owner');
    if (team.owner === targetId) {
      throw conflict(isSelf ? 'The owner cannot leave their own team' : 'The owner cannot be removed', 'owner_cannot_leave');
    }
    await lockUser(trx, targetId);
    const membership = await trx('team_memberships').where({ team_id: teamId, user_id: targetId }).first('player_role');
    if (!membership) throw notFound('That player is not on this team');
    await trx('team_memberships').where({ team_id: teamId, user_id: targetId }).del();
    await syncActiveTeam(trx, targetId);
    if (membership.player_role === 'igl') await touchActiveSession(trx, teamId);
  });
}

// ---- Invites -------------------------------------------------------------

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function inviteStatus(invite, now = new Date()) {
  if (invite.response) return invite.response; // accepted | declined (player invites)
  if (invite.revoked_at) return 'revoked';
  if (new Date(invite.expires_at) <= now) return 'expired';
  if (invite.max_uses != null && invite.use_count >= invite.max_uses) return 'used_up';
  return invite.invitee_user_id ? 'pending' : 'active';
}

const presentInvite = (invite) => ({
  invite_id: invite.invite_id,
  team_id: invite.team_id,
  kind: invite.invitee_user_id ? 'player' : 'link',
  invitee_user_id: invite.invitee_user_id ?? null,
  invitee_name: invite.invitee_name ?? undefined,
  created_at: invite.created_at,
  expires_at: invite.expires_at,
  revoked_at: invite.revoked_at,
  responded_at: invite.responded_at ?? null,
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

// A player can be invited when they can sign in and have no team at all.
async function assertAvailablePlayer(trx, userId) {
  const user = await trx('users').where('user_id', userId).first('user_id', 'user_name', 'password_hash');
  if (!user || !user.password_hash) throw notFound('Player not found');
  const member = await trx('team_memberships').where('user_id', userId).first('team_id');
  if (member) throw conflict('That player is already on a team', 'player_not_available');
  return user;
}

const pendingPlayerInvite = (trx, teamId, userId) =>
  trx('team_invites')
    .where({ team_id: teamId, invitee_user_id: userId })
    .whereNull('response').whereNull('revoked_at')
    .where('expires_at', '>', trx.fn.now())
    .first();

// Sends a player-specific invite (Invite buttons, and approving a join request).
async function invitePlayer(teamId, actorId, targetId, { joinRequestId = null } = {}, outer = null) {
  await requireLead(teamId, actorId, outer || undefined);
  const run = async (trx) => {
    await trx('teams').where('team_id', teamId).forUpdate().first('team_id');
    const target = await assertAvailablePlayer(trx, targetId);
    const existing = await pendingPlayerInvite(trx, teamId, targetId);
    if (existing) {
      throw conflict(`${target.user_name} already has a pending invite from this team`, 'invite_pending', {
        invite: presentInvite(existing),
      });
    }
    // Expired-but-unanswered rows would block the partial unique index.
    await trx('team_invites').where({ team_id: teamId, invitee_user_id: targetId })
      .whereNull('response').whereNull('revoked_at').where('expires_at', '<=', trx.fn.now())
      .update({ revoked_at: trx.fn.now() });
    const [invite] = await trx('team_invites')
      .insert({
        team_id: teamId,
        invitee_user_id: targetId,
        created_by: actorId,
        join_request_id: joinRequestId,
        expires_at: trx.raw(`now() + make_interval(days => ?)`, [LIMITS.playerInviteDays]),
      })
      .returning('*');
    const team = await trx('teams').where('team_id', teamId).first('team_name');
    await notify(trx, [targetId], {
      kind: 'team_invite',
      teamId,
      actorId,
      targetType: 'invite',
      targetId: invite.invite_id,
      payload: { team_name: team.team_name },
      key: `invite:${invite.invite_id}`,
    });
    return presentInvite(invite);
  };
  return outer ? run(outer) : db.transaction(run);
}

async function listInvites(teamId, userId) {
  await requireLead(teamId, userId);
  const invites = await db('team_invites as i')
    .leftJoin('users as u', 'u.user_id', 'i.invitee_user_id')
    .where('i.team_id', teamId)
    .orderBy('i.created_at', 'desc')
    .limit(50)
    .select('i.*', 'u.user_name as invitee_name');
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
  revoked: [410, 'This invite has been revoked', 'invite_revoked'],
  expired: [410, 'This invite has expired', 'invite_expired'],
  used_up: [410, 'This invite has already been used', 'invite_used_up'],
  accepted: [409, 'You already accepted this invite', 'invite_answered'],
  declined: [409, 'You already declined this invite', 'invite_answered'],
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
      const [code, message, errCode] = INVITE_ERRORS[status];
      throw httpError(code, message, errCode);
    }
    await lockUser(trx, userId);
    const member = await trx('team_memberships').where({ team_id: invite.team_id, user_id: userId }).first();
    if (member) throw conflict('You are already on this team', 'already_member');
    await assertNoTeam(trx, userId);
    await joinTeam(trx, invite.team_id, userId);
    await trx('team_invites').where('invite_id', invite.invite_id).increment('use_count', 1);
    return trx('teams').where('team_id', invite.team_id).first('team_id', 'team_name');
  });
}

// Invites addressed to the signed-in player.
async function myInvites(userId) {
  const rows = await db('team_invites as i')
    .join('teams as t', 't.team_id', 'i.team_id')
    .where('i.invitee_user_id', userId)
    .orderBy('i.created_at', 'desc')
    .limit(50)
    .select('i.*', 't.team_name', 't.logo_image_id', 't.region', 't.language', 't.platform', 't.skill_level',
      db.raw('(select count(*)::int from team_memberships m where m.team_id = t.team_id) as roster_size'));
  return rows.map((r) => ({
    ...presentInvite(r),
    team: {
      team_id: r.team_id,
      team_name: r.team_name,
      logo_url: pictureUrl(r.logo_image_id),
      region: r.region,
      language: r.language,
      platform: r.platform,
      skill_level: r.skill_level,
      roster_size: r.roster_size,
    },
  }));
}

// Accept or decline a player invite. Eligibility is re-checked on accept
// because the player may have joined another team since it was sent.
async function respondToInvite(inviteId, userId, accept) {
  return db.transaction(async (trx) => {
    const invite = await trx('team_invites').where({ invite_id: inviteId, invitee_user_id: userId }).forUpdate().first();
    if (!invite) throw notFound('Invite not found');
    const status = inviteStatus(invite);
    if (status !== 'pending') {
      const [code, message, errCode] = INVITE_ERRORS[status];
      throw httpError(code, message, errCode);
    }
    if (accept) {
      await lockUser(trx, userId);
      await assertNoTeam(trx, userId, 'You are already on a team. Leave it before accepting another invite.');
      await joinTeam(trx, invite.team_id, userId);
    }
    await trx('team_invites').where('invite_id', inviteId)
      .update({ response: accept ? 'accepted' : 'declined', responded_at: trx.fn.now(), use_count: accept ? 1 : 0 });
    return trx('teams').where('team_id', invite.team_id).first('team_id', 'team_name');
  });
}

// ---- Join requests ---------------------------------------------------------

async function createJoinRequest(teamId, userId, { message = '' } = {}) {
  return db.transaction(async (trx) => {
    const team = await trx('teams').where('team_id', teamId).forUpdate().first('team_id', 'team_name', 'owner', 'is_recruiting');
    if (!team || !team.is_recruiting) throw notFound('That team is not recruiting');
    await lockUser(trx, userId);
    await assertNoTeam(trx, userId, 'You are already on a team.');
    const pending = await trx('team_join_requests').where({ team_id: teamId, user_id: userId, status: 'pending' }).first();
    if (pending) throw conflict('You already have a pending request for this team', 'request_pending', { request_id: pending.request_id });
    if (await pendingPlayerInvite(trx, teamId, userId)) {
      throw conflict('This team has already invited you — check your invites', 'invite_pending');
    }
    const [request] = await trx('team_join_requests').insert({ team_id: teamId, user_id: userId, message }).returning('*');
    const player = await trx('users').where('user_id', userId).first('user_name');
    await notify(trx, [team.owner], {
      kind: 'join_request',
      teamId,
      actorId: userId,
      targetType: 'join_request',
      targetId: request.request_id,
      payload: { team_name: team.team_name, player_name: player.user_name, player_id: userId },
      key: `request:${request.request_id}`,
    });
    return request;
  });
}

async function listJoinRequests(teamId, userId) {
  await requireOwner(teamId, userId);
  const rows = await db('team_join_requests as r')
    .join('users as u', 'u.user_id', 'r.user_id')
    .where('r.team_id', teamId)
    .orderByRaw("(r.status = 'pending') desc, r.created_at desc")
    .limit(50)
    .select('r.*', 'u.user_name', 'u.avatar_image_id', 'u.language', 'u.region', 'u.platform', 'u.skill_level',
      db.raw('exists (select 1 from team_memberships m where m.user_id = r.user_id) as has_team'));
  return rows.map(({ avatar_image_id, ...r }) => ({ ...r, avatar_url: pictureUrl(avatar_image_id) }));
}

// The owner answers a request. Approving sends an invite; it never adds the
// player to the team by itself.
async function resolveJoinRequest(teamId, userId, requestId, approve) {
  await requireOwner(teamId, userId);
  return db.transaction(async (trx) => {
    const request = await trx('team_join_requests').where({ request_id: requestId, team_id: teamId }).forUpdate().first();
    if (!request) throw notFound('Request not found');
    if (request.status !== 'pending') throw conflict(`This request was already ${request.status}`, 'request_answered');
    let invite = null;
    if (approve) invite = await invitePlayer(teamId, userId, request.user_id, { joinRequestId: requestId }, trx);
    await trx('team_join_requests').where('request_id', requestId)
      .update({ status: approve ? 'invited' : 'declined', resolved_by: userId, resolved_at: trx.fn.now() });
    return { request_id: requestId, status: approve ? 'invited' : 'declined', invite };
  });
}

async function myJoinRequests(userId) {
  return db('team_join_requests as r')
    .join('teams as t', 't.team_id', 'r.team_id')
    .where('r.user_id', userId)
    .orderBy('r.created_at', 'desc')
    .limit(50)
    .select('r.request_id', 'r.team_id', 't.team_name', 'r.status', 'r.created_at', 'r.resolved_at');
}

module.exports = {
  TEAM_FIELDS,
  presentTeam,
  createTeam,
  updateTeam,
  updateRecruiting,
  deleteTeam,
  getRoster,
  updateMember,
  removeMember,
  createInvite,
  invitePlayer,
  listInvites,
  revokeInvite,
  previewInvite,
  acceptInvite,
  myInvites,
  respondToInvite,
  createJoinRequest,
  listJoinRequests,
  resolveJoinRequest,
  myJoinRequests,
  pendingPlayerInvite,
  hashToken,
};
