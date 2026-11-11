// Legacy tactic queries, scoped to teams the acting user belongs to.
const connection = require('../db/connection');
const { memberTeamIds } = require('../services/access');

const SORTABLE = ['tactic_id', 'tactic_name', 'economy', 'team_id', 'created_at', 'updated_at'];
exports.SORTABLE = SORTABLE;

const COLUMNS = [
  'tactics.tactic_id',
  'tactics.tactic_name',
  'tactics.economy',
  'tactics.grenade',
  'tactics.molly',
  'tactics.flash',
  'tactics.smoke',
  'tactics.team_id',
  'teams.team_name AS team_name',
  'tactics.T',
  'tactics.CT',
  'tactics.steps',
  // Added in milestone 1 (additive).
  'tactics.map',
  'tactics.side',
  'tactics.revision',
];

const baseQuery = (userId) =>
  connection
    .select(COLUMNS)
    .from('tactics')
    .join('teams', 'tactics.team_id', '=', 'teams.team_id')
    .whereIn('tactics.team_id', memberTeamIds(userId));

exports.getTactics = (userId, sort_by = 'tactic_name', order = 'asc') =>
  baseQuery(userId).orderBy(`tactics.${sort_by}`, order).orderBy('tactics.tactic_id');

exports.getTacticsByColumn = (userId, column, value) =>
  baseQuery(userId).where(`tactics.${column}`, '=', value).orderBy('tactics.tactic_id');

exports.getTacticRow = (tacticID) =>
  connection('tactics').where('tactic_id', tacticID).first('tactic_id', 'team_id', 'steps', 'revision');

exports.addTactic = (newTactic) => connection('tactics').insert(newTactic).returning('*');

exports.deleteTacticByID = (tacticID) => connection('tactics').where('tactic_id', tacticID).del();

exports.updateTacticByID = (tacticID, updatedTactic) =>
  connection('tactics')
    .where('tactic_id', tacticID)
    .update({ ...updatedTactic, revision: connection.raw('revision + 1'), updated_at: connection.fn.now() });

exports.updateTacticStepsByID = (tacticID, newSteps) =>
  connection('tactics')
    .where({ tactic_id: tacticID })
    .update({ steps: JSON.stringify(newSteps), updated_at: connection.fn.now() });
