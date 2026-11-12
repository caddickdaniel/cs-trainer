// Player profiles, the available-player directory and per-user settings.
const db = require('../db/connection');
const { DEFAULT_SHORTCUTS } = require('../domain/constants');
const { notFound } = require('../errors');
const { getAccess } = require('./access');
const { pictureUrl, replace } = require('./pictures');
const { pendingPlayerInvite } = require('./teams');
const { getMemberships } = require('./users');

const PROFILE_FIELDS = ['language', 'region', 'platform', 'skill_level', 'bio', 'steam_url', 'faceit_url', 'esea_url', 'hltv_url'];

const presentProfile = (u) => ({
  user_id: u.user_id,
  user_name: u.user_name,
  avatar_url: pictureUrl(u.avatar_image_id),
  language: u.language,
  region: u.region,
  platform: u.platform,
  skill_level: u.skill_level,
  bio: u.bio,
  steam_url: u.steam_url,
  faceit_url: u.faceit_url,
  esea_url: u.esea_url,
  hltv_url: u.hltv_url,
});

const hasNoTeam = (q, alias = 'u') =>
  q.whereNotExists(db('team_memberships as tm').whereRaw(`tm.user_id = ${alias}.user_id`));

async function getOwnProfile(userId) {
  const u = await db('users').where('user_id', userId).first();
  return { ...presentProfile(u), email: u.email };
}

async function updateOwnProfile(userId, fields) {
  const changes = Object.fromEntries(PROFILE_FIELDS.filter((k) => fields[k] !== undefined).map((k) => [k, fields[k] || null]));
  if (Object.keys(changes).length) {
    await db('users').where('user_id', userId).update({ ...changes, updated_at: db.fn.now() });
  }
  return getOwnProfile(userId);
}

const setAvatar = (userId, buf, contentType) =>
  replace({ table: 'users', idColumn: 'user_id', id: userId, column: 'avatar_image_id', purpose: 'avatar', userId, buf, contentType });

// The viewer's active team when they can send invites from it.
async function invitingTeam(viewerId) {
  const { active_team: team } = await getMemberships(viewerId);
  return team && team.can_lead ? team : null;
}

// Who may see a profile: the player, teammates, players without a team
// (they are discoverable), and owners reviewing that player's join request.
async function canViewProfile(viewerId, targetId) {
  if (viewerId === targetId) return true;
  const shared = await db('team_memberships as a')
    .join('team_memberships as b', 'a.team_id', 'b.team_id')
    .where({ 'a.user_id': viewerId, 'b.user_id': targetId }).first('a.team_id');
  if (shared) return true;
  const teamless = await hasNoTeam(db('users as u').where('u.user_id', targetId).whereNotNull('u.password_hash')).first('u.user_id');
  if (teamless) return true;
  const requested = await db('team_join_requests as r')
    .join('teams as t', 't.team_id', 'r.team_id')
    .where({ 'r.user_id': targetId, 't.owner': viewerId }).first('r.request_id');
  return Boolean(requested);
}

async function inviteState(viewerId, targetId) {
  const team = await invitingTeam(viewerId);
  if (!team) return { can_invite: false, invite_status: null };
  const target = await db('team_memberships').where('user_id', targetId).first('team_id');
  const pending = await pendingPlayerInvite(db, team.team_id, targetId);
  return {
    can_invite: !target && !pending && viewerId !== targetId,
    invite_status: pending ? 'pending' : null,
    inviting_team: { team_id: team.team_id, team_name: team.team_name },
  };
}

async function getPublicProfile(viewerId, targetId) {
  const u = await db('users').where('user_id', targetId).first();
  if (!u || !(await canViewProfile(viewerId, targetId))) throw notFound('Player not found');
  const membership = await db('team_memberships as m').join('teams as t', 't.team_id', 'm.team_id')
    .where('m.user_id', targetId).first('t.team_id', 't.team_name');
  return { profile: { ...presentProfile(u), team: membership || null }, ...(await inviteState(viewerId, targetId)) };
}

// Players with no team memberships, for "Invite Players".
async function availablePlayers(viewerId) {
  const rows = await hasNoTeam(db('users as u'))
    .whereNotNull('u.password_hash')
    .whereNot('u.user_id', viewerId)
    .orderBy([{ column: 'u.user_name' }, { column: 'u.user_id' }])
    .limit(200)
    .select('u.user_id', 'u.user_name', 'u.avatar_image_id', 'u.language', 'u.region', 'u.platform', 'u.skill_level');
  const team = await invitingTeam(viewerId);
  const pending = team
    ? new Set(await db('team_invites').where('team_id', team.team_id).whereNotNull('invitee_user_id')
      .whereNull('response').whereNull('revoked_at').where('expires_at', '>', db.fn.now()).pluck('invitee_user_id'))
    : new Set();
  return {
    players: rows.map(({ avatar_image_id, ...p }) => ({
      ...p,
      avatar_url: pictureUrl(avatar_image_id),
      invite_status: pending.has(p.user_id) ? 'pending' : null,
    })),
    can_invite: Boolean(team),
    inviting_team: team ? { team_id: team.team_id, team_name: team.team_name } : null,
  };
}

async function getSettings(userId) {
  const { settings } = await db('users').where('user_id', userId).first('settings');
  return { shortcuts: { ...DEFAULT_SHORTCUTS, ...((settings || {}).shortcuts || {}) }, defaults: DEFAULT_SHORTCUTS };
}

async function updateSettings(userId, { shortcuts }) {
  const { settings } = await db('users').where('user_id', userId).first('settings');
  const next = { ...(settings || {}) };
  if (shortcuts === null) delete next.shortcuts;
  else if (shortcuts) next.shortcuts = shortcuts;
  await db('users').where('user_id', userId).update({ settings: JSON.stringify(next) });
  return getSettings(userId);
}

module.exports = {
  PROFILE_FIELDS,
  presentProfile,
  getOwnProfile,
  updateOwnProfile,
  setAvatar,
  getPublicProfile,
  availablePlayers,
  getSettings,
  updateSettings,
  canViewProfile,
  getAccess,
};
