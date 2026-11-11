// Game Mode: one active session per team, persisted in PostgreSQL and read by
// polling. The tactic is snapshotted at start so edits made to the saved tactic
// while a round is being played cannot change the live instructions.
const db = require('../db/connection');
const { notFound, conflict, badRequest } = require('../errors');
const { requireMember, requireLead, getAccess } = require('./access');
const { loadTactic, loadPhases } = require('./tactics');

const userName = (trx, userId) =>
  userId == null ? null : trx('users').where('user_id', userId).first('user_id', 'user_name');

function buildView(session, userId, canControl, names) {
  const snap = session.snapshot;
  const phase = snap.phases[session.current_phase];
  const mine = phase.assignments.find((a) => a.user_id === userId) || null;
  return {
    session_id: session.session_id,
    team_id: session.team_id,
    status: session.status,
    version: session.version,
    current_phase: session.current_phase,
    phase_count: session.phase_count,
    started_at: session.started_at,
    updated_at: session.updated_at,
    ended_at: session.ended_at,
    started_by: names.started_by,
    ended_by: names.ended_by,
    tactic: snap.tactic,
    phases: snap.phases.map((p, index) => ({ index, name: p.name })),
    phase: { index: session.current_phase, name: phase.name, notes: phase.notes, board: phase.board },
    my_assignment: mine,
    // Owners/IGLs see every player's instruction for the current phase.
    assignments: canControl ? phase.assignments : undefined,
    can_control: canControl,
  };
}

async function present(session, userId, canControl, trx = db) {
  const [startedBy, endedBy] = await Promise.all([
    userName(trx, session.started_by),
    userName(trx, session.ended_by),
  ]);
  return buildView(session, userId, canControl, { started_by: startedBy || null, ended_by: endedBy || null });
}

async function getCurrent(teamId, userId) {
  const access = await requireMember(teamId, userId);
  const active = await db('game_sessions').where({ team_id: teamId, status: 'active' }).first();
  if (active) {
    return { session: await present(active, userId, access.canLead), last_ended: null, can_control: access.canLead };
  }
  const last = await db('game_sessions')
    .where({ team_id: teamId, status: 'ended' })
    .orderBy('ended_at', 'desc')
    .first('session_id', 'ended_at', 'ended_by', 'snapshot');
  const lastEnded = last
    ? {
      session_id: last.session_id,
      ended_at: last.ended_at,
      ended_by: (await userName(db, last.ended_by)) || null,
      tactic_name: last.snapshot.tactic.tactic_name,
    }
    : null;
  return { session: null, last_ended: lastEnded, can_control: access.canLead };
}

async function getSession(sessionId, userId) {
  const session = await db('game_sessions').where('session_id', sessionId).first();
  if (!session) throw notFound('Session not found');
  const access = await getAccess(session.team_id, userId);
  if (!access || !access.isMember) throw notFound('Session not found');
  return { session: await present(session, userId, access.canLead), can_control: access.canLead };
}

async function buildSnapshot(tactic) {
  const phases = await loadPhases(tactic.tactic_id);
  return {
    tactic: {
      tactic_id: tactic.tactic_id,
      tactic_name: tactic.tactic_name,
      map: tactic.map,
      side: tactic.side,
      economy: tactic.economy,
      grenade: tactic.grenade,
      molly: tactic.molly,
      flash: tactic.flash,
      smoke: tactic.smoke,
      revision: tactic.revision,
    },
    phases: phases.map((p) => ({
      name: p.name,
      notes: p.notes,
      board: p.board,
      assignments: p.assignments,
    })),
  };
}

const isActiveSessionConflict = (err) =>
  err.code === '23505' && err.constraint === 'game_sessions_one_active_per_team';

async function activeConflict(teamId, userId) {
  const current = await getCurrent(teamId, userId);
  return conflict('A Game Mode session is already running for this team', 'session_active', {
    session: current.session,
  });
}

async function start(teamId, userId, tacticId) {
  await requireLead(teamId, userId);
  const tactic = await loadTactic(tacticId).catch(() => null);
  if (!tactic || tactic.team_id !== teamId) throw notFound('Tactic not found');
  const snapshot = await buildSnapshot(tactic);
  if (!snapshot.phases.length) throw badRequest('This tactic has no phases yet', 'tactic_has_no_phases');
  if (await db('game_sessions').where({ team_id: teamId, status: 'active' }).first('session_id')) {
    throw await activeConflict(teamId, userId);
  }
  try {
    const [session] = await db('game_sessions')
      .insert({
        team_id: teamId,
        tactic_id: tactic.tactic_id,
        tactic_revision: tactic.revision,
        snapshot: JSON.stringify(snapshot),
        phase_count: snapshot.phases.length,
        started_by: userId,
      })
      .returning('*');
    return { session: await present(session, userId, true), can_control: true };
  } catch (err) {
    // Two overlapping starts: the partial unique index lets exactly one win.
    if (isActiveSessionConflict(err)) throw await activeConflict(teamId, userId);
    throw err;
  }
}

async function loadForControl(sessionId, userId) {
  const session = await db('game_sessions').where('session_id', sessionId).first();
  if (!session) throw notFound('Session not found');
  await requireLead(session.team_id, userId).catch((err) => {
    if (err.status === 404) throw notFound('Session not found');
    throw err;
  });
  return session;
}

function targetPhase(session, { action, index }) {
  if (action === 'next') return session.current_phase + 1;
  if (action === 'prev') return session.current_phase - 1;
  return index;
}

// Phase changes are compare-and-set on `version`: of two overlapping requests
// based on the same version, one applies and the other receives 409 with the
// latest state.
async function changePhase(sessionId, userId, body) {
  const session = await loadForControl(sessionId, userId);
  const versionConflict = async (message, code) => {
    const latest = await db('game_sessions').where('session_id', sessionId).first();
    return conflict(message, code, { session: await present(latest, userId, true) });
  };
  if (session.status !== 'active') throw await versionConflict('This session has ended', 'session_ended');
  if (session.version !== body.expected_version) {
    throw await versionConflict('The phase was changed by someone else', 'version_conflict');
  }
  const target = targetPhase(session, body);
  if (target < 0 || target >= session.phase_count) {
    throw badRequest('There is no phase in that direction', 'phase_out_of_range');
  }
  const [updated] = await db('game_sessions')
    .where({ session_id: sessionId, status: 'active', version: body.expected_version })
    .update({ current_phase: target, version: db.raw('version + 1'), updated_at: db.fn.now() })
    .returning('*');
  if (!updated) throw await versionConflict('The phase was changed by someone else', 'version_conflict');
  return { session: await present(updated, userId, true), can_control: true };
}

async function end(sessionId, userId, { expected_version: expected } = {}) {
  const session = await loadForControl(sessionId, userId);
  if (session.status === 'ended') return { session: await present(session, userId, true), can_control: true };
  let query = db('game_sessions').where({ session_id: sessionId, status: 'active' });
  if (expected) query = query.andWhere('version', expected);
  const [updated] = await query
    .update({
      status: 'ended',
      ended_at: db.fn.now(),
      ended_by: userId,
      version: db.raw('version + 1'),
      updated_at: db.fn.now(),
    })
    .returning('*');
  if (!updated) {
    const latest = await db('game_sessions').where('session_id', sessionId).first();
    if (latest.status === 'ended') return { session: await present(latest, userId, true), can_control: true };
    throw conflict('The session changed before it could be ended', 'version_conflict', {
      session: await present(latest, userId, true),
    });
  }
  return { session: await present(updated, userId, true), can_control: true };
}

module.exports = { getCurrent, getSession, start, changePhase, end };
