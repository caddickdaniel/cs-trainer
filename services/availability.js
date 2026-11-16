// Player availability on the team calendar (Phase 10). Every member records
// their own Available / Unavailable entries; everyone on the team can see
// them; only the player who made an entry can change or remove it (not the
// owner or the IGL either). Entries are not announced as notifications.
const db = require('../db/connection');
const { forbidden, notFound } = require('../errors');
const { requireMember } = require('./access');

const present = (a) => ({
  availability_id: a.availability_id,
  team_id: a.team_id,
  user: { user_id: a.user_id, user_name: a.user_name ?? null },
  status: a.status,
  all_day: a.all_day,
  day: typeof a.day === 'string' ? a.day.slice(0, 10) : localDay(a.day),
  starts_at: a.starts_at,
  ends_at: a.ends_at,
  time_zone: a.time_zone,
  note: a.note,
  sample: Boolean(a.sample_key),
  updated_at: a.updated_at,
});
// pg returns DATE columns as local-midnight Dates; format them back to YYYY-MM-DD.
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const query = (trx = db) => trx('team_availability as a').join('users as u', 'u.user_id', 'a.user_id').select('a.*', 'u.user_name');

async function list(teamId, userId, { from, to } = {}) {
  const access = await requireMember(teamId, userId);
  let q = query().where('a.team_id', teamId)
    // Only current members' entries (a player who left keeps nothing visible).
    .whereIn('a.user_id', db('team_memberships').where('team_id', teamId).select('user_id'))
    .orderBy([{ column: 'a.starts_at' }, { column: 'a.availability_id' }]);
  if (from) q = q.where('a.ends_at', '>', from);
  if (to) q = q.where('a.starts_at', '<', to);
  return { availability: (await q.limit(1000)).map(present), can_manage_events: access.canLead, user_id: userId };
}

async function create(teamId, userId, body) {
  await requireMember(teamId, userId);
  const [row] = await db('team_availability').insert({ ...body, team_id: teamId, user_id: userId }).returning('availability_id');
  return { availability: present(await query().where('a.availability_id', row.availability_id).first()) };
}

async function own(teamId, userId, id) {
  await requireMember(teamId, userId);
  const row = await db('team_availability').where({ team_id: teamId, availability_id: id }).first();
  if (!row) throw notFound('Entry not found');
  if (row.user_id !== userId) throw forbidden("You can only change your own availability", 'not_yours');
  return row;
}

async function update(teamId, userId, id, body) {
  await own(teamId, userId, id);
  await db('team_availability').where('availability_id', id).update({ ...body, sample_key: null, updated_at: db.fn.now() });
  return { availability: present(await query().where('a.availability_id', id).first()) };
}

async function remove(teamId, userId, id) {
  await own(teamId, userId, id);
  await db('team_availability').where('availability_id', id).del();
  return { deleted: true };
}

module.exports = { list, create, update, remove };
