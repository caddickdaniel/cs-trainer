// Game Mode. A session is a match for one team: the IGL picks a map and side,
// browses that side's saved tactics, and starts rounds. Each round copies the
// selected tactic into `snapshot`, so edits to saved tactics never change a
// round in progress. State lives in PostgreSQL and clients poll it.
//
// Only the team's current IGL (roster role 'igl') can send commands; this is
// checked on every request, so transferring the IGL role revokes control
// immediately. Every command is compare-and-set on `version`.
const db = require('../db/connection');
const { notFound, conflict, badRequest } = require('../errors');
const { requireMember, requireIgl, getAccess } = require('./access');
const { loadTactic, loadPhases } = require('./tactics');
const { ECONOMIES } = require('../domain/constants');
const { utilityPlan } = require('../domain/utility');

const userName = (trx, userId) =>
  userId == null ? null : trx('users').where('user_id', userId).first('user_id', 'user_name');

// Saved tactics for one map and side that can be played (at least one phase),
// ordered by economy category (Pistol ... Full buy) and then name. The IGL's
// dropdown groups this list and the next/previous shortcuts walk it in order.
function sideTactics(trx, teamId, map, side) {
  return trx('tactics as t')
    .where('t.team_id', teamId)
    .whereRaw('t.map IS NOT DISTINCT FROM ?', [map])
    .whereRaw('t.side IS NOT DISTINCT FROM ?', [side])
    .whereExists(trx('tactic_phases as p').whereRaw('p.tactic_id = t.tactic_id'))
    .orderByRaw('coalesce(array_position(?::text[], t.economy), 99), t.tactic_name, t.tactic_id', [ECONOMIES])
    .select('t.tactic_id', 't.tactic_name', 't.economy');
}

async function currentIgl(trx, teamId) {
  const row = await trx('team_memberships as m').join('users as u', 'u.user_id', 'm.user_id')
    .where({ 'm.team_id': teamId, 'm.player_role': 'igl' }).first('u.user_id', 'u.user_name');
  return row || null;
}

// One player's utility for the current phase (null without a buy list or plan).
function utilityFor(plan, key, phaseIndex) {
  const p = plan.find((x) => x.key === key);
  if (!p) return null;
  const at = p.phases[phaseIndex] || { start: p.buy, used: {} };
  return {
    user_id: p.user_id, slot: p.slot,
    buy: p.buy, kit: p.kit, bomb: p.bomb,
    available: at.start,
    planned: at.used,
    over: p.over.filter((o) => o.phase === phaseIndex),
  };
}

async function present(session, userId, canControl, trx = db) {
  const snap = session.snapshot;
  const phase = snap.phases[session.current_phase];
  const mine = phase.assignments.find((a) => a.user_id === userId) || null;
  // Sessions started before buy lists existed have none.
  const plan = utilityPlan({ loadouts: snap.loadouts || [], phases: snap.phases, side: snap.tactic.side, bomb: snap.bomb_carrier || null });
  const [startedBy, endedBy, igl, tactics] = await Promise.all([
    userName(trx, session.started_by),
    userName(trx, session.ended_by),
    currentIgl(trx, session.team_id),
    sideTactics(trx, session.team_id, session.map, session.side),
  ]);
  const selected = tactics.find((t) => t.tactic_id === session.selected_tactic_id) || null;
  return {
    session_id: session.session_id,
    team_id: session.team_id,
    status: session.status,
    version: session.version,
    round_number: session.round_number,
    map: session.map,
    side: session.side,
    current_phase: session.current_phase,
    phase_count: session.phase_count,
    started_at: session.started_at,
    updated_at: session.updated_at,
    ended_at: session.ended_at,
    started_by: startedBy || null,
    ended_by: endedBy || null,
    igl,
    // The round being played (from the snapshot).
    tactic: snap.tactic,
    phases: snap.phases.map((p, index) => ({ index, name: p.name })),
    phase: { index: session.current_phase, name: phase.name, notes: phase.notes, board: phase.board },
    my_assignment: mine,
    // The player's buy list and what they have at the start of this phase.
    my_utility: utilityFor(plan, `u${userId}`, session.current_phase),
    bomb_carrier: snap.tactic.side === 'T' ? snap.bomb_carrier || null : null,
    // The IGL sees every player's instruction for the current phase.
    assignments: canControl ? phase.assignments : undefined,
    utility: canControl ? plan.map((p) => utilityFor(plan, p.key, session.current_phase)) : undefined,
    // The tactic queued for the next round, within the current map and side.
    selected_tactic: selected,
    side_tactic_count: tactics.length,
    side_tactics: canControl ? tactics : undefined,
    can_control: canControl,
  };
}

async function lastEnded(teamId) {
  const last = await db('game_sessions')
    .where({ team_id: teamId, status: 'ended' })
    .orderBy('ended_at', 'desc')
    .first('session_id', 'ended_at', 'ended_by', 'snapshot');
  if (!last) return null;
  return {
    session_id: last.session_id,
    ended_at: last.ended_at,
    ended_by: (await userName(db, last.ended_by)) || null,
    tactic_name: last.snapshot.tactic.tactic_name,
  };
}

async function getCurrent(teamId, userId) {
  const access = await requireMember(teamId, userId);
  const active = await db('game_sessions').where({ team_id: teamId, status: 'active' }).first();
  const igl = await currentIgl(db, teamId);
  if (active) {
    return { session: await present(active, userId, access.canControl), last_ended: null, can_control: access.canControl, igl };
  }
  return { session: null, last_ended: await lastEnded(teamId), can_control: access.canControl, igl };
}

async function getSession(sessionId, userId) {
  const session = await db('game_sessions').where('session_id', sessionId).first();
  if (!session) throw notFound('Session not found');
  const access = await getAccess(session.team_id, userId);
  if (!access || !access.isMember) throw notFound('Session not found');
  return { session: await present(session, userId, access.canControl), can_control: access.canControl };
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
    // Copied with the round so editing the tactic never changes a live round.
    loadouts: tactic.loadouts || [],
    bomb_carrier: tactic.bomb_carrier || null,
    phases: phases.map((p) => ({ name: p.name, notes: p.notes, board: p.board, assignments: p.assignments })),
  };
}

async function roundFor(teamId, tacticId) {
  const tactic = await loadTactic(tacticId).catch(() => null);
  if (!tactic || tactic.team_id !== teamId) throw notFound('Tactic not found');
  const snapshot = await buildSnapshot(tactic);
  if (!snapshot.phases.length) throw badRequest('This tactic has no phases yet', 'tactic_has_no_phases');
  return { tactic, snapshot };
}

const isActiveSessionConflict = (err) =>
  err.code === '23505' && err.constraint === 'game_sessions_one_active_per_team';

async function activeConflict(teamId, userId) {
  const current = await getCurrent(teamId, userId);
  return conflict('A Game Mode session is already running for this team', 'session_active', { session: current.session });
}

// Starts a match from a tactic (its map and side become the session's).
async function start(teamId, userId, tacticId) {
  await requireIgl(teamId, userId);
  const { tactic, snapshot } = await roundFor(teamId, tacticId);
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
        map: tactic.map,
        side: tactic.side,
        selected_tactic_id: tactic.tactic_id,
        round_number: 1,
      })
      .returning('*');
    return { session: await present(session, userId, true), can_control: true };
  } catch (err) {
    if (isActiveSessionConflict(err)) throw await activeConflict(teamId, userId);
    throw err;
  }
}

async function loadForControl(sessionId, userId) {
  const session = await db('game_sessions').where('session_id', sessionId).first();
  if (!session) throw notFound('Session not found');
  await requireIgl(session.team_id, userId).catch((err) => {
    if (err.status === 404) throw notFound('Session not found');
    throw err;
  });
  return session;
}

const LEGACY_ACTIONS = { next: 'phase_next', prev: 'phase_prev', goto: 'phase_goto' };

// Works out the column changes for one command against the current state.
async function plan(session, { action, index, tacticId }) {
  switch (action) {
    case 'phase_next':
    case 'phase_prev':
    case 'phase_goto': {
      const target = action === 'phase_next' ? session.current_phase + 1
        : action === 'phase_prev' ? session.current_phase - 1 : index;
      if (target < 0 || target >= session.phase_count) {
        throw badRequest('There is no phase in that direction', 'phase_out_of_range');
      }
      return { current_phase: target };
    }
    case 'tactic_next':
    case 'tactic_prev': {
      const list = await sideTactics(db, session.team_id, session.map, session.side);
      if (!list.length) throw badRequest(`There are no ${session.side ?? ''} tactics for this map yet`, 'no_side_tactics');
      const at = list.findIndex((t) => t.tactic_id === session.selected_tactic_id);
      const step = action === 'tactic_next' ? 1 : -1;
      const next = at < 0 ? 0 : (at + step + list.length) % list.length;
      return { selected_tactic_id: list[next].tactic_id };
    }
    case 'tactic_select': {
      const list = await sideTactics(db, session.team_id, session.map, session.side);
      if (!list.some((t) => t.tactic_id === tacticId)) {
        throw badRequest(`That tactic isn't a playable ${session.side ?? ''} tactic for this map`, 'tactic_not_eligible');
      }
      return { selected_tactic_id: tacticId };
    }
    case 'switch_side': {
      const side = session.side === 'CT' ? 'T' : 'CT';
      const list = await sideTactics(db, session.team_id, session.map, side);
      return { side, selected_tactic_id: list.length ? list[0].tactic_id : null };
    }
    case 'new_round': {
      if (!session.selected_tactic_id) {
        throw badRequest(`Pick a ${session.side ?? ''} tactic before starting a round`, 'no_tactic_selected');
      }
      const { tactic, snapshot } = await roundFor(session.team_id, session.selected_tactic_id);
      return {
        tactic_id: tactic.tactic_id,
        tactic_revision: tactic.revision,
        snapshot: JSON.stringify(snapshot),
        phase_count: snapshot.phases.length,
        current_phase: 0,
        round_number: session.round_number + 1,
      };
    }
    default:
      throw badRequest('Unknown command', 'unknown_command');
  }
}

// Of two overlapping commands based on the same version, one applies and the
// other receives 409 with the latest state.
async function command(sessionId, userId, body) {
  const action = LEGACY_ACTIONS[body.action] || body.action;
  const session = await loadForControl(sessionId, userId);
  const versionConflict = async (message, code) => {
    const latest = await db('game_sessions').where('session_id', sessionId).first();
    return conflict(message, code, { session: await present(latest, userId, true) });
  };
  if (session.status !== 'active') throw await versionConflict('This session has ended', 'session_ended');
  if (session.version !== body.expected_version) {
    throw await versionConflict('The live state was changed by someone else', 'version_conflict');
  }
  const changes = await plan(session, { action, index: body.index, tacticId: body.tactic_id });
  const [updated] = await db('game_sessions')
    .where({ session_id: sessionId, status: 'active', version: body.expected_version })
    .update({ ...changes, version: db.raw('version + 1'), updated_at: db.fn.now() })
    .returning('*');
  if (!updated) throw await versionConflict('The live state was changed by someone else', 'version_conflict');
  // Control may have moved while the command was in flight.
  const access = await getAccess(updated.team_id, userId);
  return { session: await present(updated, userId, Boolean(access && access.canControl)), can_control: Boolean(access && access.canControl) };
}

const changePhase = (sessionId, userId, body) => command(sessionId, userId, body);

async function end(sessionId, userId, { expected_version: expected } = {}) {
  const session = await loadForControl(sessionId, userId);
  if (session.status === 'ended') return { session: await present(session, userId, true), can_control: true };
  let query = db('game_sessions').where({ session_id: sessionId, status: 'active' });
  if (expected) query = query.andWhere('version', expected);
  const [updated] = await query
    .update({ status: 'ended', ended_at: db.fn.now(), ended_by: userId, version: db.raw('version + 1'), updated_at: db.fn.now() })
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

module.exports = { getCurrent, getSession, start, command, changePhase, end };
