// Team calendar (Training and Game events). Times are stored as absolute
// instants (timestamptz); time_zone records where the event was entered.
const db = require('../db/connection');
const { notFound } = require('../errors');
const { requireMember, requireOwner } = require('./access');
const { notify, teamMemberIds } = require('./notifications');

const FIELDS = ['kind', 'title', 'starts_at', 'time_zone', 'opponent', 'notes'];
const pick = (obj) => Object.fromEntries(FIELDS.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

const present = (e) => ({
  event_id: e.event_id,
  team_id: e.team_id,
  kind: e.kind,
  title: e.title,
  starts_at: e.starts_at,
  time_zone: e.time_zone,
  opponent: e.opponent,
  notes: e.notes,
  created_at: e.created_at,
  updated_at: e.updated_at,
});

async function listEvents(teamId, userId, { from, to } = {}) {
  const access = await requireMember(teamId, userId);
  let q = db('team_events').where('team_id', teamId).orderBy([{ column: 'starts_at' }, { column: 'event_id' }]);
  if (from) q = q.where('starts_at', '>=', from);
  if (to) q = q.where('starts_at', '<', to);
  return { events: (await q.limit(500)).map(present), can_manage: access.isOwner };
}

async function nextEvent(teamId, userId) {
  await requireMember(teamId, userId);
  const e = await db('team_events').where('team_id', teamId).where('starts_at', '>', db.fn.now())
    .orderBy([{ column: 'starts_at' }, { column: 'event_id' }]).first();
  return { event: e ? present(e) : null, server_time: new Date().toISOString() };
}

async function getEvent(teamId, userId, eventId) {
  const access = await requireMember(teamId, userId);
  const e = await db('team_events').where({ team_id: teamId, event_id: eventId }).first();
  if (!e) throw notFound('Event not found');
  return { event: present(e), can_manage: access.isOwner };
}

async function announce(trx, kind, e, actorId, key) {
  const [team, actor] = await Promise.all([
    trx('teams').where('team_id', e.team_id).first('team_name'),
    trx('users').where('user_id', actorId).first('user_name'),
  ]);
  await notify(trx, await teamMemberIds(trx, e.team_id), {
    kind,
    teamId: e.team_id,
    actorId,
    targetType: 'event',
    targetId: e.event_id,
    payload: { title: e.title, starts_at: e.starts_at, event_kind: e.kind, team_name: team.team_name, actor_name: actor && actor.user_name },
    key,
  });
}

async function createEvent(teamId, userId, fields) {
  await requireOwner(teamId, userId);
  return db.transaction(async (trx) => {
    const [e] = await trx('team_events')
      .insert({ ...pick(fields), team_id: teamId, created_by: userId, updated_by: userId })
      .returning('*');
    await announce(trx, 'event_created', e, userId, `event:${e.event_id}:created`);
    return { event: present(e) };
  });
}

async function updateEvent(teamId, userId, eventId, fields) {
  await requireOwner(teamId, userId);
  return db.transaction(async (trx) => {
    const [e] = await trx('team_events').where({ team_id: teamId, event_id: eventId })
      .update({ ...pick(fields), updated_by: userId, updated_at: trx.fn.now() })
      .returning('*');
    if (!e) throw notFound('Event not found');
    await announce(trx, 'event_updated', e, userId, `event:${e.event_id}:updated:${new Date(e.updated_at).getTime()}`);
    return { event: present(e) };
  });
}

async function deleteEvent(teamId, userId, eventId) {
  await requireOwner(teamId, userId);
  await db.transaction(async (trx) => {
    const [e] = await trx('team_events').where({ team_id: teamId, event_id: eventId }).del().returning('*');
    if (!e) throw notFound('Event not found');
    await announce(trx, 'event_deleted', e, userId, `event:${e.event_id}:deleted`);
  });
}

module.exports = { listEvents, nextEvent, getEvent, createEvent, updateEvent, deleteEvent };
