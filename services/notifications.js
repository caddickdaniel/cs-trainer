// Per-recipient notifications. Each row stores display data captured when it
// was created, so links can degrade gracefully if the target is deleted.
// (user_id, dedupe_key) is unique: retrying an action never duplicates rows.
const db = require('../db/connection');
const { notFound } = require('../errors');
const { getAccess } = require('./access');

const KINDS = ['team_invite', 'join_request', 'event_created', 'event_updated', 'event_deleted', 'tactic_updated'];

async function notify(trx, recipients, { kind, teamId = null, actorId = null, targetType = null, targetId = null, payload = {}, key }) {
  const ids = [...new Set(recipients)].filter((id) => id != null && id !== actorId);
  if (!ids.length) return;
  await trx('notifications')
    .insert(ids.map((userId) => ({
      user_id: userId,
      kind,
      team_id: teamId,
      actor_id: actorId,
      target_type: targetType,
      target_id: targetId,
      payload: JSON.stringify(payload),
      dedupe_key: key,
    })))
    .onConflict(['user_id', 'dedupe_key'])
    .ignore();
}

const teamMemberIds = (trx, teamId) => trx('team_memberships').where('team_id', teamId).pluck('user_id');

function describe(n) {
  const p = n.payload || {};
  const by = p.actor_name ? `${p.actor_name} ` : '';
  switch (n.kind) {
    case 'team_invite': return `${p.team_name} invited you to join their team`;
    case 'join_request': return `${p.player_name} asked to join ${p.team_name}`;
    case 'event_created': return `${by}added "${p.title}" to the ${p.team_name} calendar`;
    case 'event_updated': return `${by}updated "${p.title}" on the ${p.team_name} calendar`;
    case 'event_deleted': return `${by}cancelled "${p.title}" on the ${p.team_name} calendar`;
    case 'tactic_updated': return `${by}updated the tactic "${p.tactic_name}"`;
    default: return 'Notification';
  }
}

const present = (n) => ({
  notification_id: n.notification_id,
  kind: n.kind,
  message: describe(n),
  created_at: n.created_at,
  read: Boolean(n.read_at),
  payload: n.payload,
});

async function list(userId) {
  const rows = await db('notifications')
    .where('user_id', userId)
    .whereNull('dismissed_at')
    .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'notification_id', order: 'desc' }])
    .limit(50);
  const unread = await db('notifications').where('user_id', userId).whereNull('dismissed_at').whereNull('read_at')
    .count('* as n').first();
  return { notifications: rows.map(present), unread_count: Number(unread.n) };
}

async function markAllRead(userId) {
  await db('notifications').where('user_id', userId).whereNull('read_at').update({ read_at: db.fn.now() });
}

async function own(userId, id) {
  const n = await db('notifications').where({ notification_id: id, user_id: userId }).first();
  if (!n) throw notFound('Notification not found');
  return n;
}

async function dismiss(userId, id) {
  await own(userId, id);
  await db('notifications').where({ notification_id: id, user_id: userId })
    .update({ dismissed_at: db.raw('coalesce(dismissed_at, now())'), read_at: db.raw('coalesce(read_at, now())') });
}

// Resolves where a notification should take the user, re-checking access and
// whether the target still exists. Returns { href, message? }.
async function open(userId, id) {
  const n = await own(userId, id);
  await db('notifications').where('notification_id', id).update({ read_at: db.raw('coalesce(read_at, now())') });
  const p = n.payload || {};
  const member = async () => {
    if (n.team_id == null) return false;
    const access = await getAccess(n.team_id, userId);
    return Boolean(access && access.isMember);
  };
  switch (n.kind) {
    case 'team_invite': {
      const invite = await db('team_invites').where({ invite_id: n.target_id, invitee_user_id: userId }).first();
      if (!invite || invite.revoked_at) return { href: '/invites', message: 'This invite is no longer available.' };
      if (invite.response) return { href: '/invites', message: `You already ${invite.response} this invite.` };
      return { href: `/invites#invite-${invite.invite_id}` };
    }
    case 'join_request': {
      const team = n.team_id == null ? null : await db('teams').where('team_id', n.team_id).first('owner');
      if (!team || team.owner !== userId) return { href: '/team', message: 'You no longer manage this team.' };
      const request = await db('team_join_requests').where('request_id', n.target_id).first('status');
      if (!request) return { href: '/team', message: 'This request no longer exists.' };
      return { href: `/team#requests`, message: request.status === 'pending' ? undefined : `This request was already ${request.status}.` };
    }
    case 'event_created':
    case 'event_updated':
    case 'event_deleted': {
      if (!(await member())) return { href: '/', message: 'You are no longer on this team.' };
      const event = await db('team_events').where({ event_id: n.target_id, team_id: n.team_id }).first('event_id');
      if (!event) return { href: '/training', message: `"${p.title}" was cancelled and removed from the calendar.` };
      return { href: `/training?event=${event.event_id}` };
    }
    case 'tactic_updated': {
      if (!(await member())) return { href: '/', message: 'You are no longer on this team.' };
      const tactic = await db('tactics').where({ tactic_id: n.target_id, team_id: n.team_id }).first('tactic_id');
      if (!tactic) return { href: '/tactics', message: `"${p.tactic_name}" has been deleted.` };
      return { href: `/tactics/${tactic.tactic_id}` };
    }
    default:
      return { href: '/' };
  }
}

module.exports = { KINDS, notify, teamMemberIds, list, markAllRead, dismiss, open };
