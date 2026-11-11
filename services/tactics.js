// Tactic documents: metadata + ordered phases, each with per-player
// assignments and board annotations.
const db = require('../db/connection');
const { notFound, conflict, httpError } = require('../errors');
const { requireMember, requireLead } = require('./access');
const { assertTeamImages } = require('./images');

const SUMMARY_COLUMNS = [
  'tactic_id', 'tactic_name', 'team_id', 'map', 'side', 'economy',
  'grenade', 'molly', 'flash', 'smoke', 'revision', 'created_at', 'updated_at',
];

async function loadTactic(tacticId, trx = db, lock = false) {
  let query = trx('tactics').where('tactic_id', tacticId);
  if (lock) query = query.forUpdate();
  const tactic = await query.first(SUMMARY_COLUMNS);
  // Tactics without a team are inaccessible (see migration review items).
  if (!tactic || tactic.team_id == null) throw notFound('Tactic not found');
  return tactic;
}

async function listTeamTactics(teamId, userId) {
  const access = await requireMember(teamId, userId);
  const tactics = await db('tactics as t')
    .where('t.team_id', teamId)
    .select(SUMMARY_COLUMNS.map((c) => `t.${c}`))
    .select(db.raw('(select count(*)::int from tactic_phases p where p.tactic_id = t.tactic_id) as phase_count'))
    .orderBy([{ column: 't.tactic_name' }, { column: 't.tactic_id' }]);
  return { tactics, can_edit: access.canLead };
}

async function loadPhases(tacticId, trx = db) {
  const phases = await trx('tactic_phases').where('tactic_id', tacticId).orderBy('position')
    .select('phase_id', 'position', 'name', 'notes', 'board');
  const assignments = phases.length
    ? await trx('phase_assignments as a')
      .join('users as u', 'u.user_id', 'a.user_id')
      .whereIn('a.phase_id', phases.map((p) => p.phase_id))
      .orderBy([{ column: 'a.phase_id' }, { column: 'a.user_id' }])
      .select('a.phase_id', 'a.user_id', 'u.user_name', 'a.instruction', 'a.utility', 'a.reference_url')
    : [];
  return phases.map((p) => ({
    position: p.position,
    name: p.name,
    notes: p.notes,
    board: p.board,
    assignments: assignments
      .filter((a) => a.phase_id === p.phase_id)
      .map(({ phase_id, ...a }) => a),
  }));
}

async function teamRoster(teamId, trx = db) {
  return trx('team_memberships as m')
    .join('users as u', 'u.user_id', 'm.user_id')
    .where('m.team_id', teamId)
    .orderBy([{ column: 'm.joined_at' }, { column: 'm.membership_id' }])
    .select('u.user_id', 'u.user_name', 'm.player_role');
}

async function getDocument(tacticId, userId) {
  const tactic = await loadTactic(tacticId);
  const access = await requireMember(tactic.team_id, userId).catch((err) => {
    if (err.status === 404) throw notFound('Tactic not found');
    throw err;
  });
  const [phases, roster] = await Promise.all([loadPhases(tacticId), teamRoster(tactic.team_id)]);
  const memberIds = new Set(roster.map((r) => r.user_id));
  for (const phase of phases) {
    for (const a of phase.assignments) a.is_member = memberIds.has(a.user_id);
  }
  return { tactic: { ...tactic, phases }, roster, can_edit: access.canLead };
}

// Every player referenced by an assignment or board item must be on the team.
async function assertAssigneesAreMembers(trx, teamId, doc) {
  const ids = new Set();
  for (const phase of doc.phases) {
    phase.assignments.forEach((a) => ids.add(a.user_id));
    phase.board.markers.forEach((m) => m.user_id != null && ids.add(m.user_id));
    phase.board.routes.forEach((r) => r.user_id != null && ids.add(r.user_id));
  }
  if (!ids.size) return;
  const members = new Set(
    await trx('team_memberships').where('team_id', teamId).whereIn('user_id', [...ids]).pluck('user_id')
  );
  const outsiders = [...ids].filter((id) => !members.has(id));
  if (outsiders.length) {
    throw httpError(400, 'Instructions can only be assigned to players on this team', 'assignee_not_member', {
      user_ids: outsiders,
    });
  }
}

function assertImages(trx, teamId, doc) {
  const ids = doc.phases.flatMap((p) => p.board.markers.flatMap((m) => m.images.map((i) => i.image_id)));
  return assertTeamImages(trx, teamId, ids);
}

const tacticRow = (doc) => ({
  tactic_name: doc.tactic_name,
  map: doc.map,
  side: doc.side,
  economy: doc.economy,
  grenade: doc.grenade,
  molly: doc.molly,
  flash: doc.flash,
  smoke: doc.smoke,
  // Legacy boolean columns kept in sync for existing callers.
  T: doc.side === 'T',
  CT: doc.side === 'CT',
});

async function writePhases(trx, tacticId, phases) {
  for (const [position, phase] of phases.entries()) {
    const [{ phase_id }] = await trx('tactic_phases')
      .insert({
        tactic_id: tacticId,
        position,
        name: phase.name,
        notes: phase.notes,
        board: JSON.stringify(phase.board),
      })
      .returning('phase_id');
    if (phase.assignments.length) {
      await trx('phase_assignments').insert(
        phase.assignments.map((a) => ({
          phase_id,
          user_id: a.user_id,
          instruction: a.instruction,
          utility: a.utility,
          reference_url: a.reference_url || null,
        }))
      );
    }
  }
}

async function createDocument(teamId, userId, doc) {
  await requireLead(teamId, userId);
  const tacticId = await db.transaction(async (trx) => {
    await assertAssigneesAreMembers(trx, teamId, doc);
    await assertImages(trx, teamId, doc);
    const [{ tactic_id }] = await trx('tactics')
      .insert({
        ...tacticRow(doc),
        team_id: teamId,
        steps: JSON.stringify([]),
        created_by: userId,
        updated_by: userId,
      })
      .returning('tactic_id');
    await writePhases(trx, tactic_id, doc.phases);
    return tactic_id;
  });
  return getDocument(tacticId, userId);
}

// Replaces a tactic's content. `revision` must match the stored revision so
// concurrent edits are detected instead of silently overwritten.
async function updateDocument(tacticId, userId, doc) {
  await db.transaction(async (trx) => {
    const tactic = await loadTactic(tacticId, trx, true);
    await requireLead(tactic.team_id, userId, trx).catch((err) => {
      if (err.status === 404) throw notFound('Tactic not found');
      throw err;
    });
    if (tactic.revision !== doc.revision) {
      throw conflict('This tactic was changed by someone else. Reload to see the latest version.', 'stale_revision', {
        current_revision: tactic.revision,
      });
    }
    await assertAssigneesAreMembers(trx, tactic.team_id, doc);
    await assertImages(trx, tactic.team_id, doc);
    await trx('tactic_phases').where('tactic_id', tacticId).del();
    await writePhases(trx, tacticId, doc.phases);
    await trx('tactics').where('tactic_id', tacticId).update({
      ...tacticRow(doc),
      revision: tactic.revision + 1,
      updated_by: userId,
      updated_at: trx.fn.now(),
    });
  });
  return getDocument(tacticId, userId);
}

module.exports = {
  loadTactic,
  loadPhases,
  listTeamTactics,
  getDocument,
  createDocument,
  updateDocument,
  assertAssigneesAreMembers,
};
