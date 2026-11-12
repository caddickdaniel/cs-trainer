// Live team demo review. The server owns the state: demo, round, play/pause,
// speed and an anchor (anchor_tick at anchor_at). Clients compute the current
// position from the anchor and the server clock, so a late joiner or a
// reconnecting teammate lands on the same frame without restarting anything.
//
// Only the team's current IGL controls a review (checked on every request,
// so an IGL transfer revokes control immediately). Teammates follow read-only.
// Reviews are separate from Game Mode: nothing here touches game_sessions.
const db = require('../db/connection');
const { badRequest, conflict, notFound } = require('../errors');
const { requireMember, requireIgl, getAccess } = require('./access');
const { notify, teamMemberIds } = require('./notifications');
const demos = require('./demos');

const nowMs = () => Date.now();

function positionAt(review, round, tickrate, atMs = nowMs()) {
  let tick = review.anchor_tick;
  if (review.playing) tick += ((atMs - new Date(review.anchor_at).getTime()) / 1000) * tickrate * review.speed;
  if (round) tick = Math.min(round.end_tick, Math.max(round.start_tick, tick));
  return tick;
}

async function roundOf(trx, demoId, roundNumber) {
  return trx('demo_rounds').where({ demo_id: demoId, round_number: roundNumber })
    .first('round_number', 'start_tick', 'freeze_end_tick', 'end_tick');
}

async function present(review, userId, trx = db) {
  const [demo, round, access, igl, starter] = await Promise.all([
    trx('demos').where('demo_id', review.demo_id).first('demo_id', 'title', 'map', 'tickrate', 'round_count'),
    roundOf(trx, review.demo_id, review.round_number),
    getAccess(review.team_id, userId, trx),
    trx('team_memberships as m').join('users as u', 'u.user_id', 'm.user_id')
      .where({ 'm.team_id': review.team_id, 'm.player_role': 'igl' }).first('u.user_id', 'u.user_name'),
    review.started_by ? trx('users').where('user_id', review.started_by).first('user_id', 'user_name') : null,
  ]);
  const at = nowMs();
  const annotations = await trx('demo_annotations')
    .where({ review_id: review.review_id, round_number: review.round_number })
    .orderBy([{ column: 'tick' }, { column: 'annotation_id' }]);
  const names = await demos.userNames(annotations.map((a) => a.author_id));
  const position = positionAt(review, round, demo.tickrate || 64, at);
  return {
    review_id: review.review_id,
    team_id: review.team_id,
    status: review.status,
    version: review.version,
    demo: { demo_id: demo.demo_id, title: demo.title, map: demo.map, tickrate: demo.tickrate, round_count: demo.round_count },
    round_number: review.round_number,
    playing: review.playing && review.status === 'active' && position < (round ? round.end_tick : Infinity),
    speed: review.speed,
    anchor_tick: review.anchor_tick,
    anchor_at: new Date(review.anchor_at).toISOString(),
    position_tick: position,
    server_time: new Date(at).toISOString(),
    started_by: starter || null,
    started_at: review.started_at,
    ended_at: review.ended_at,
    igl: igl || null,
    can_control: Boolean(access && access.canControl),
    annotations: annotations.map((a) => demos.presentAnnotation(a, names)),
  };
}

async function getCurrent(teamId, userId) {
  const access = await requireMember(teamId, userId);
  const review = await db('review_sessions').where({ team_id: teamId, status: 'active' }).first();
  return { review: review ? await present(review, userId) : null, can_control: access.canControl };
}

async function loadReview(reviewId, userId) {
  const review = await db('review_sessions').where('review_id', reviewId).first();
  if (!review) throw notFound('Review not found');
  const access = await getAccess(review.team_id, userId);
  if (!access || !access.isMember) throw notFound('Review not found');
  return { review, access };
}

async function getReview(reviewId, userId) {
  const { review } = await loadReview(reviewId, userId);
  return { review: await present(review, userId) };
}

async function start(teamId, userId, { demo_id: demoId, round_number: roundNumber = 1 }) {
  await requireIgl(teamId, userId);
  const demo = await db('demos').where({ demo_id: demoId, team_id: teamId }).first();
  if (!demo) throw notFound('Demo not found');
  if (demo.status !== 'ready') throw conflict('This demo is not ready yet', 'demo_not_ready');
  const round = await roundOf(db, demoId, roundNumber);
  if (!round) throw badRequest('That round is not in this demo', 'round_not_found');
  try {
    const review = await db.transaction(async (trx) => {
      const [row] = await trx('review_sessions').insert({
        team_id: teamId,
        demo_id: demoId,
        round_number: roundNumber,
        playing: false,
        anchor_tick: round.freeze_end_tick ?? round.start_tick,
        started_by: userId,
      }).returning('*');
      const actor = await trx('users').where('user_id', userId).first('user_name');
      await notify(trx, await teamMemberIds(trx, teamId), {
        kind: 'review_started',
        teamId,
        actorId: userId,
        targetType: 'review',
        targetId: row.review_id,
        payload: { title: demo.title, actor_name: actor && actor.user_name },
        key: `review:${row.review_id}:started`,
      });
      return row;
    });
    return { review: await present(review, userId) };
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'review_sessions_one_active_per_team') {
      const current = await getCurrent(teamId, userId);
      throw conflict('A live review is already running for this team', 'review_active', { review: current.review });
    }
    throw err;
  }
}

async function loadForControl(reviewId, userId) {
  const review = await db('review_sessions').where('review_id', reviewId).first();
  if (!review) throw notFound('Review not found');
  await requireIgl(review.team_id, userId).catch((err) => {
    if (err.status === 404) throw notFound('Review not found');
    throw err;
  });
  if (review.status !== 'active') {
    throw conflict('This review has ended', 'review_ended', { review: await present(review, userId) });
  }
  return review;
}

// Applies one IGL command with compare-and-set on version.
async function command(reviewId, userId, body) {
  const review = await loadForControl(reviewId, userId);
  if (review.version !== body.expected_version) {
    throw conflict('The review changed; showing the latest state', 'version_conflict', { review: await present(review, userId) });
  }
  const demo = await db('demos').where('demo_id', review.demo_id).first('tickrate');
  const round = await roundOf(db, review.demo_id, review.round_number);
  const at = nowMs();
  const current = positionAt(review, round, demo.tickrate || 64, at);
  const anchorAt = new Date(at);
  let changes;
  switch (body.action) {
    case 'play': {
      // Playing from the end of a round restarts it.
      const from = current >= round.end_tick ? (round.freeze_end_tick ?? round.start_tick) : current;
      changes = { playing: true, anchor_tick: from, anchor_at: anchorAt };
      break;
    }
    case 'pause':
      changes = { playing: false, anchor_tick: current, anchor_at: anchorAt };
      break;
    case 'seek':
      changes = { anchor_tick: Math.min(round.end_tick, Math.max(round.start_tick, body.tick)), anchor_at: anchorAt };
      break;
    case 'speed':
      changes = { speed: body.speed, anchor_tick: current, anchor_at: anchorAt };
      break;
    case 'round': {
      const next = await roundOf(db, review.demo_id, body.round_number);
      if (!next) throw badRequest('That round is not in this demo', 'round_not_found');
      changes = { round_number: next.round_number, playing: false, anchor_tick: next.freeze_end_tick ?? next.start_tick, anchor_at: anchorAt };
      break;
    }
    case 'clear':
      changes = {};
      break;
    default:
      throw badRequest('Unknown command', 'unknown_command');
  }
  const updated = await db.transaction(async (trx) => {
    const [row] = await trx('review_sessions')
      .where({ review_id: reviewId, status: 'active', version: body.expected_version })
      .update({ ...changes, version: trx.raw('version + 1'), updated_at: trx.fn.now() })
      .returning('*');
    if (!row) return null;
    if (body.action === 'clear') {
      await trx('demo_annotations').where({ review_id: reviewId, round_number: review.round_number }).del();
    }
    return row;
  });
  if (!updated) {
    const latest = await db('review_sessions').where('review_id', reviewId).first();
    throw conflict('The review changed; showing the latest state', 'version_conflict', { review: await present(latest, userId) });
  }
  return { review: await present(updated, userId) };
}

// Drawings and text during a live review (IGL only), shown to everyone.
async function annotate(reviewId, userId, body) {
  const review = await loadForControl(reviewId, userId);
  if (body.round_number !== review.round_number) throw badRequest('Annotate the round being reviewed', 'wrong_round');
  const demo = await db('demos').where('demo_id', review.demo_id).first();
  const updated = await db.transaction(async (trx) => {
    await demos.insertAnnotation(trx, demo, userId, body, reviewId);
    const [row] = await trx('review_sessions').where('review_id', reviewId)
      .update({ version: trx.raw('version + 1'), updated_at: trx.fn.now() }).returning('*');
    return row;
  });
  return { review: await present(updated, userId) };
}

async function removeAnnotation(reviewId, annotationId, userId) {
  await loadForControl(reviewId, userId);
  const updated = await db.transaction(async (trx) => {
    const n = await trx('demo_annotations').where({ review_id: reviewId, annotation_id: annotationId }).del();
    if (!n) throw notFound('Annotation not found');
    const [row] = await trx('review_sessions').where('review_id', reviewId)
      .update({ version: trx.raw('version + 1'), updated_at: trx.fn.now() }).returning('*');
    return row;
  });
  return { review: await present(updated, userId) };
}

async function end(reviewId, userId) {
  const review = await db('review_sessions').where('review_id', reviewId).first();
  if (!review) throw notFound('Review not found');
  await requireIgl(review.team_id, userId).catch((err) => {
    if (err.status === 404) throw notFound('Review not found');
    throw err;
  });
  const [row] = await db('review_sessions').where({ review_id: reviewId, status: 'active' })
    .update({ status: 'ended', playing: false, ended_by: userId, ended_at: db.fn.now(), version: db.raw('version + 1'), updated_at: db.fn.now() })
    .returning('*');
  return { review: await present(row || review, userId) };
}

module.exports = { getCurrent, getReview, start, command, annotate, removeAnnotation, end, positionAt };
