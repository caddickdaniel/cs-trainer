// Idempotent creation of the development demo data (see db/data/demo.js).
//
// Accounts are matched by email and teams by (name, owner). Running it again
// refreshes their seeded fields (profile, ranks, recruitment settings) and
// adds anything missing; it never deletes users, teams, memberships, tactics,
// demos or anything else, and never moves a player who has since joined a
// different team.
const { teamlessPlayers, testRoster, recruitingTeams } = require('../data/demo');
const { RANK_COLUMNS, isValidRank } = require('../../domain/catalogue');

const PROFILE = ['user_name', 'language', 'region', 'bio', 'steam_url', 'faceit_url', 'esea_url', 'hltv_url'];

function profileOf(p) {
  const profile = Object.fromEntries(PROFILE.map((k) => [k, p[k] ?? null]));
  for (const [platform, col] of Object.entries(RANK_COLUMNS)) {
    const rank = (p.ranks || {})[platform] ?? null;
    if (rank && !isValidRank(platform, rank)) throw new Error(`Demo data: ${p.email} has an unknown ${platform} rank "${rank}"`);
    profile[col] = rank;
  }
  // Free text from before rank options existed (kept for the player to review).
  profile.platform = p.legacy ? p.legacy.platform : null;
  profile.skill_level = p.legacy ? p.legacy.skill_level : null;
  profile.rank_platform = null;
  profile.rank_id = null;
  return profile;
}

async function upsertUser(knex, person, passwordHash) {
  const existing = await knex('users').whereRaw('lower(email) = ?', [person.email.toLowerCase()]).first('user_id');
  if (existing) {
    await knex('users').where('user_id', existing.user_id).update(profileOf(person));
    return { user_id: existing.user_id, created: false };
  }
  const [row] = await knex('users')
    .insert({ ...profileOf(person), email: person.email, password_hash: passwordHash })
    .returning('user_id');
  return { user_id: row.user_id, created: true };
}

async function ensureTeamlessPlayers(knex, passwordHash, log = () => {}) {
  for (const p of teamlessPlayers) {
    const { user_id: userId, created } = await upsertUser(knex, p, passwordHash);
    const member = await knex('team_memberships').where('user_id', userId).first('team_id');
    log(`${created ? 'created' : 'updated'} ${p.user_name} <${p.email}>${member ? ` (note: has since joined team ${member.team_id}; left there)` : ''}`);
  }
}

const recruitment = (t) => ({
  language: t.language ?? null,
  region: t.region ?? null,
  description: t.description ?? null,
  is_recruiting: Boolean(t.is_recruiting ?? true),
  roles_needed: t.roles_needed ?? [],
  recruiting_notes: t.recruiting_notes ?? null,
  rank_requirements: JSON.stringify(t.rank_requirements ?? []),
  competitions: t.competitions ?? [],
  // Seeded teams use the current model only.
  platform: null,
  skill_level: null,
  recruiting_leagues: null,
});

// Finds the team by name and owner, creating it (with the owner as a member)
// if it doesn't exist; refreshes its seeded recruitment fields otherwise.
async function ensureTeam(knex, def, ownerId, ownerRole) {
  const existing = await knex('teams').where({ team_name: def.team_name, owner: ownerId }).first('team_id');
  if (existing) {
    await knex('teams').where('team_id', existing.team_id).update({ ...recruitment(def), updated_at: knex.fn.now() });
    return { team_id: existing.team_id, created: false };
  }
  const [team] = await knex('teams').insert({ team_name: def.team_name, owner: ownerId, ...recruitment(def) }).returning('team_id');
  await addMember(knex, team.team_id, ownerId, ownerRole);
  return { team_id: team.team_id, created: true };
}

async function addMember(knex, teamId, userId, role) {
  // One IGL per team: a seeded IGL only takes the role if nobody has it.
  let playerRole = role;
  if (role === 'igl' && await knex('team_memberships').where({ team_id: teamId, player_role: 'igl' }).first('user_id')) playerRole = 'rifler';
  await knex('team_memberships').insert({ team_id: teamId, user_id: userId, player_role: playerRole, is_igl: playerRole === 'igl' });
  await knex('users').where('user_id', userId).update({ team_id: teamId });
  return playerRole;
}

// The five-player test roster (owner, IGL, three teammates).
async function ensureTestRoster(knex, passwordHash, log = () => {}) {
  const ids = [];
  for (const p of testRoster.players) ids.push((await upsertUser(knex, p, passwordHash)).user_id);
  const ownerIndex = testRoster.players.findIndex((p) => p.owner);
  const owner = testRoster.players[ownerIndex];
  const ownerTeam = await knex('team_memberships').where('user_id', ids[ownerIndex]).first('team_id');
  const mine = ownerTeam && await knex('teams').where({ team_id: ownerTeam.team_id, owner: ids[ownerIndex], team_name: testRoster.team.team_name }).first('team_id');
  if (ownerTeam && !mine) {
    log(`skipped ${testRoster.team.team_name}: ${owner.user_name} is on team ${ownerTeam.team_id}`);
    return null;
  }
  const { team_id: teamId, created } = await ensureTeam(knex, testRoster.team, ids[ownerIndex], owner.role);
  log(`${created ? 'created' : 'updated'} team ${testRoster.team.team_name} (${teamId}), owner ${owner.user_name} <${owner.email}>`);
  for (const [i, p] of testRoster.players.entries()) {
    if (i === ownerIndex) continue;
    const membership = await knex('team_memberships').where('user_id', ids[i]).first('team_id', 'player_role');
    if (membership && membership.team_id !== teamId) { log(`  skipped ${p.user_name}: on team ${membership.team_id}`); continue; }
    if (membership) { log(`  ${p.user_name} <${p.email}> already on the roster (${membership.player_role ?? 'no role'})`); continue; }
    const role = await addMember(knex, teamId, ids[i], p.role);
    log(`  added ${p.user_name} <${p.email}> as ${role}`);
  }
  return teamId;
}

async function ensureRecruitingTeams(knex, passwordHash, log = () => {}) {
  for (const t of recruitingTeams) {
    const { user_id: ownerId } = await upsertUser(knex, t.owner, passwordHash);
    const membership = await knex('team_memberships').where('user_id', ownerId).first('team_id');
    const own = membership && await knex('teams').where({ team_id: membership.team_id, owner: ownerId, team_name: t.team_name }).first('team_id');
    if (membership && !own) { log(`skipped ${t.team_name}: ${t.owner.user_name} is on team ${membership.team_id}`); continue; }
    const { team_id: teamId, created } = await ensureTeam(knex, t, ownerId, 'igl');
    log(`${created ? 'created' : 'updated'} recruiting team ${t.team_name} (${teamId}), owner ${t.owner.user_name} <${t.owner.email}>`);
  }
}

// Everything above, in order. Used by the development seed and `npm run db:demo`.
async function ensureDemoData(knex, passwordHash, log = () => {}) {
  await ensureTeamlessPlayers(knex, passwordHash, log);
  const rosterId = await ensureTestRoster(knex, passwordHash, log);
  await ensureRecruitingTeams(knex, passwordHash, log);
  return { rosterId };
}

module.exports = { ensureDemoData, ensureTeamlessPlayers, ensureTestRoster, ensureRecruitingTeams, upsertUser, profileOf };
