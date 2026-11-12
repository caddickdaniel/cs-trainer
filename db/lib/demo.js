// Idempotent creation of the development demo accounts (see db/data/demo.js).
// Accounts are matched by email; existing ones are refreshed, never deleted.
const { teamlessPlayers, testTeamOwner, testTeammates } = require('../data/demo');

const PROFILE = ['user_name', 'language', 'region', 'platform', 'skill_level', 'bio', 'steam_url', 'faceit_url', 'esea_url', 'hltv_url'];
const profileOf = (p) => Object.fromEntries(PROFILE.map((k) => [k, p[k] ?? null]));

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
    log(`${created ? 'created' : 'updated'} ${p.user_name} <${p.email}>${member ? ` (note: now on team ${member.team_id})` : ''}`);
  }
}

// Adds the four demo teammates to a team, without touching existing members.
async function ensureTeammates(knex, teamId, passwordHash, log = () => {}) {
  for (const p of testTeammates) {
    const { user_id: userId } = await upsertUser(knex, p, passwordHash);
    const membership = await knex('team_memberships').where('user_id', userId).first('team_id');
    if (membership && membership.team_id !== teamId) {
      log(`skipped ${p.user_name}: already on team ${membership.team_id}`);
      continue;
    }
    if (membership) {
      log(`${p.user_name} is already on the team`);
      continue;
    }
    let role = p.role;
    if (role === 'igl' && await knex('team_memberships').where({ team_id: teamId, player_role: 'igl' }).first('user_id')) {
      role = p.fallbackRole;
    }
    await knex('team_memberships').insert({ team_id: teamId, user_id: userId, player_role: role, is_igl: role === 'igl' });
    await knex('users').where('user_id', userId).update({ team_id: teamId });
    log(`added ${p.user_name} <${p.email}> as ${role}`);
  }
}

// Development seed: Test Team 1 owned by "Test Owner", with four teammates.
async function seedTestTeam(knex, passwordHash) {
  const { user_id: ownerId } = await upsertUser(knex, testTeamOwner, passwordHash);
  const [team] = await knex('teams')
    .insert({ team_name: 'Test Team 1', owner: ownerId, language: 'English', region: 'EU', platform: 'FACEIT', skill_level: '8',
      description: 'Development team for testing tactics and Game Mode.' })
    .returning('team_id');
  await knex('team_memberships').insert({ team_id: team.team_id, user_id: ownerId, player_role: 'rifler', is_igl: false });
  await knex('users').where('user_id', ownerId).update({ team_id: team.team_id });
  await ensureTeammates(knex, team.team_id, passwordHash);
  return team.team_id;
}

module.exports = { ensureTeamlessPlayers, ensureTeammates, seedTestTeam };
