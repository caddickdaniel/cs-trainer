const bcrypt = require('bcryptjs');
const db = require('../db/connection');
const config = require('../config/env');
const { conflict } = require('../errors');

const PUBLIC_USER = ['user_id', 'user_name', 'email', 'created_at'];

// Constant-time-ish failure path: compare against a dummy hash when the user
// does not exist so response time does not reveal registered emails.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', config.bcryptRounds);

async function createUser({ email, user_name, password }) {
  const password_hash = await bcrypt.hash(password, config.bcryptRounds);
  try {
    const [user] = await db('users').insert({ email, user_name, password_hash }).returning(PUBLIC_USER);
    return user;
  } catch (err) {
    if (err.code === '23505' && /email/.test(err.constraint || '')) {
      throw conflict('An account with that email already exists', 'email_taken');
    }
    throw err;
  }
}

async function verifyCredentials(email, password) {
  const user = await db('users').whereRaw('lower(email) = ?', [email.toLowerCase()]).first();
  const ok = await bcrypt.compare(password, (user && user.password_hash) || DUMMY_HASH);
  if (!user || !user.password_hash || !ok) return null;
  return { user_id: user.user_id, user_name: user.user_name, email: user.email };
}

function findUser(userId) {
  return db('users').where('user_id', userId).first(PUBLIC_USER.concat('team_id'));
}

// Memberships for the signed-in user, plus the active team the UI focuses on:
// users.team_id when it is one of the memberships, otherwise the earliest one.
async function getMemberships(userId, trx = db) {
  const user = await trx('users').where('user_id', userId).first('team_id');
  const rows = await trx('team_memberships as m')
    .join('teams as t', 't.team_id', 'm.team_id')
    .where('m.user_id', userId)
    .orderBy([{ column: 'm.joined_at' }, { column: 'm.membership_id' }])
    .select('t.team_id', 't.team_name', 't.owner', 'm.player_role', 'm.joined_at');
  const teams = rows.map((r) => ({
    team_id: r.team_id,
    team_name: r.team_name,
    is_owner: r.owner === userId,
    is_igl: r.player_role === 'igl',
    can_lead: r.owner === userId || r.player_role === 'igl',
    can_control: r.player_role === 'igl',
    player_role: r.player_role,
    joined_at: r.joined_at,
  }));
  const active = teams.find((t) => user && t.team_id === user.team_id) || teams[0] || null;
  return { teams, active_team: active };
}

// Keeps the legacy users.team_id pointer on one of the user's memberships.
async function syncActiveTeam(trx, userId) {
  const user = await trx('users').where('user_id', userId).first('team_id');
  if (!user) return null;
  const teamIds = await trx('team_memberships')
    .where('user_id', userId)
    .orderBy([{ column: 'joined_at' }, { column: 'membership_id' }])
    .pluck('team_id');
  if (user.team_id != null && teamIds.includes(user.team_id)) return user.team_id;
  const next = teamIds[0] ?? null;
  await trx('users').where('user_id', userId).update({ team_id: next, updated_at: trx.fn.now() });
  return next;
}

module.exports = { createUser, verifyCredentials, findUser, getMemberships, syncActiveTeam };
