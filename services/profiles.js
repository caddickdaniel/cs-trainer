// Player profiles, the available-player directory and per-user settings.
const db = require('../db/connection');
const { DEFAULT_SHORTCUTS, PREVIOUS_SHORTCUTS } = require('../domain/constants');
const { notFound, badRequest } = require('../errors');
const CAT = require('../domain/catalogue');
const { getAccess } = require('./access');
const { pictureUrl, replace } = require('./pictures');
const { pendingPlayerInvite } = require('./teams');
const { getMemberships } = require('./users');

const PROFILE_FIELDS = ['language', 'region', 'bio', 'steam_url', 'faceit_url', 'esea_url', 'hltv_url'];

// Self-reported ranks: one optional catalogue band per platform. Legacy free
// text entered before the catalogue existed stays visible for review unless
// it is already represented by the matching rank.
function rankFields(u) {
  const ranks = Object.fromEntries(CAT.PLATFORM_IDS.map((p) => [p, u[CAT.RANK_COLUMNS[p]] || null]));
  let legacy = Boolean(u.platform || u.skill_level);
  if (legacy && u.platform) {
    const mapped = CAT.mapLegacyRank(u.platform, u.skill_level);
    if (mapped && mapped.rank && ranks[mapped.platform]) legacy = false;
  }
  return {
    ranks,
    legacy_platform: legacy ? u.platform || null : null,
    legacy_skill_level: legacy ? u.skill_level || null : null,
  };
}
const RANK_SELECT = ['premier_rank', 'faceit_rank', 'esea_rank', 'platform', 'skill_level'];

// A sign-in method: a password or a verified identity (Steam). Accounts with
// neither are unclaimed legacy rows and stay out of discovery.
const canSignIn = (q, alias = 'u') => q.where((w) => w.whereNotNull(`${alias}.password_hash`)
  .orWhereExists(db('user_identities as ui').whereRaw(`ui.user_id = ${alias}.user_id`)));

const presentProfile = (u) => ({
  user_id: u.user_id,
  user_name: u.user_name,
  avatar_url: pictureUrl(u.avatar_image_id),
  language: u.language,
  region: u.region,
  ...rankFields(u),
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

// Language and region must come from the catalogue; a legacy value the player
// already has may be kept unchanged until they pick a catalogue option.
function checkOption(list, field, value, current) {
  if (value == null || value === '' || value === current || list.includes(value)) return;
  throw badRequest(`Choose a ${field} from the list`, `invalid_${field}`);
}

async function updateOwnProfile(userId, fields) {
  const current = await db('users').where('user_id', userId).first('language', 'region');
  checkOption(CAT.LANGUAGES, 'language', fields.language, current.language);
  checkOption(CAT.REGIONS, 'region', fields.region, current.region);
  const changes = Object.fromEntries(PROFILE_FIELDS.filter((k) => fields[k] !== undefined).map((k) => [k, fields[k] || null]));
  // Each platform's rank is optional and saved independently.
  for (const p of CAT.PLATFORM_IDS) {
    if (fields.ranks && fields.ranks[p] !== undefined) changes[CAT.RANK_COLUMNS[p]] = fields.ranks[p] || null;
  }
  // The player reviewed their legacy text and chose to drop it.
  if (fields.clear_legacy_rank) { changes.platform = null; changes.skill_level = null; }
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
  const teamless = await canSignIn(hasNoTeam(db('users as u').where('u.user_id', targetId))).first('u.user_id');
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

// Players with no team memberships, for "Invite Players", filtered by the
// same catalogue options the profile editor uses.
async function availablePlayers(viewerId, filters = {}) {
  let q = canSignIn(hasNoTeam(db('users as u')))
    .whereNot('u.user_id', viewerId)
    .orderBy([{ column: 'u.user_name' }, { column: 'u.user_id' }])
    .limit(200)
    .select('u.user_id', 'u.user_name', 'u.avatar_image_id', 'u.language', 'u.region', ...RANK_SELECT.map((c) => `u.${c}`));
  if (filters.language) q = q.where('u.language', filters.language);
  if (filters.region) q = q.where('u.region', filters.region);
  // One rank filter per platform; a player must match every active filter.
  for (const p of CAT.PLATFORM_IDS) {
    if (filters[p]) q = q.where(`u.${CAT.RANK_COLUMNS[p]}`, filters[p]);
  }
  const rows = await q;
  const team = await invitingTeam(viewerId);
  const pending = team
    ? new Set(await db('team_invites').where('team_id', team.team_id).whereNotNull('invitee_user_id')
      .whereNull('response').whereNull('revoked_at').where('expires_at', '>', db.fn.now()).pluck('invitee_user_id'))
    : new Set();
  return {
    players: rows.map(({ avatar_image_id, premier_rank, faceit_rank, esea_rank, platform, skill_level, ...p }) => ({
      ...p,
      ...rankFields({ premier_rank, faceit_rank, esea_rank, platform, skill_level }),
      avatar_url: pictureUrl(avatar_image_id),
      invite_status: pending.has(p.user_id) ? 'pending' : null,
    })),
    can_invite: Boolean(team),
    inviting_team: team ? { team_id: team.team_id, team_name: team.team_name } : null,
  };
}

// Saved bindings always win. An action the player never set takes the
// current default, unless that key is already one of their saved bindings;
// then it keeps its previous default so two actions never share a key.
function mergeShortcuts(saved = {}) {
  const used = new Set(Object.values(saved));
  const out = {};
  for (const [action, key] of Object.entries(DEFAULT_SHORTCUTS)) {
    if (saved[action]) out[action] = saved[action];
    else if (used.has(key) && PREVIOUS_SHORTCUTS[action] && !used.has(PREVIOUS_SHORTCUTS[action])) out[action] = PREVIOUS_SHORTCUTS[action];
    else out[action] = key;
  }
  return out;
}

async function getSettings(userId) {
  const { settings } = await db('users').where('user_id', userId).first('settings');
  return { shortcuts: mergeShortcuts((settings || {}).shortcuts || {}), defaults: DEFAULT_SHORTCUTS };
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
  canSignIn,
  rankFields,
  RANK_SELECT,
  PROFILE_FIELDS,
  presentProfile,
  getOwnProfile,
  updateOwnProfile,
  setAvatar,
  getPublicProfile,
  availablePlayers,
  getSettings,
  mergeShortcuts,
  updateSettings,
  canViewProfile,
  getAccess,
};
