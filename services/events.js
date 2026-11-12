// Team calendar (Training and Game events). Times are stored as absolute
// instants (timestamptz); time_zone records where the event was entered.
const db = require('../db/connection');
const { notFound, badRequest } = require('../errors');
const { requireMember, requireOwner } = require('./access');
const { notify, teamMemberIds } = require('./notifications');

const FIELDS = ['kind', 'title', 'starts_at', 'time_zone', 'opponent', 'notes', 'demo_id'];
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
  demo_id: e.demo_id ?? null,
  // Linked demo (Demo Review events), when it still exists.
  demo: e.demo_title ? { demo_id: e.demo_id, title: e.demo_title, status: e.demo_status } : null,
  created_at: e.created_at,
  updated_at: e.updated_at,
});

// Events joined with their linked demo's title and status.
const eventsQuery = (trx = db) => trx('team_events as e')
  .leftJoin('demos as d', 'd.demo_id', 'e.demo_id')
  .select('e.*', 'd.title as demo_title', 'd.status as demo_status');

// A linked demo must be in the team's library, and only Demo Review events link one.
async function checkDemo(trx, teamId, fields, existing) {
  const kind = fields.kind ?? existing?.kind;
  if (kind !== 'demo_review') {
    if (fields.demo_id != null) throw badRequest('Only Demo Review events can link a demo', 'demo_not_allowed');
    if (existing?.demo_id != null || fields.kind !== undefined) fields.demo_id = null;
    return;
  }
  if (fields.demo_id == null) return;
  const demo = await trx('demos').where({ demo_id: fields.demo_id, team_id: teamId }).first('demo_id');
  if (!demo) throw badRequest("That demo isn't in your team's library", 'demo_not_found');
}

async function listEvents(teamId, userId, { from, to } = {}) {
  const access = await requireMember(teamId, userId);
  let q = eventsQuery().where('e.team_id', teamId).orderBy([{ column: 'e.starts_at' }, { column: 'e.event_id' }]);
  if (from) q = q.where('e.starts_at', '>=', from);
  if (to) q = q.where('e.starts_at', '<', to);
  return { events: (await q.limit(500)).map(present), can_manage: access.isOwner };
}

async function nextEvent(teamId, userId) {
  await requireMember(teamId, userId);
  const e = await eventsQuery().where('e.team_id', teamId).where('e.starts_at', '>', db.fn.now())
    .orderBy([{ column: 'e.starts_at' }, { column: 'e.event_id' }]).first();
  return { event: e ? present(e) : null, server_time: new Date().toISOString() };
}

async function getEvent(teamId, userId, eventId) {
  const access = await requireMember(teamId, userId);
  const e = await eventsQuery().where({ 'e.team_id': teamId, 'e.event_id': eventId }).first();
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
    const values = pick(fields);
    await checkDemo(trx, teamId, values, null);
    const [e] = await trx('team_events')
      .insert({ ...values, team_id: teamId, created_by: userId, updated_by: userId })
      .returning('*');
    await announce(trx, 'event_created', e, userId, `event:${e.event_id}:created`);
    return { event: present(await eventsQuery(trx).where('e.event_id', e.event_id).first()) };
  });
}

async function updateEvent(teamId, userId, eventId, fields) {
  await requireOwner(teamId, userId);
  return db.transaction(async (trx) => {
    const existing = await trx('team_events').where({ team_id: teamId, event_id: eventId }).forUpdate().first();
    if (!existing) throw notFound('Event not found');
    const values = pick(fields);
    await checkDemo(trx, teamId, values, existing);
    const [e] = await trx('team_events').where({ team_id: teamId, event_id: eventId })
      .update({ ...values, updated_by: userId, updated_at: trx.fn.now() })
      .returning('*');
    await announce(trx, 'event_updated', e, userId, `event:${e.event_id}:updated:${new Date(e.updated_at).getTime()}`);
    return { event: present(await eventsQuery(trx).where('e.event_id', e.event_id).first()) };
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
