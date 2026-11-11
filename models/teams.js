// Legacy team queries, scoped to teams the acting user belongs to.
const connection = require('../db/connection');
const { memberTeamIds } = require('../services/access');

const SORTABLE = ['team_id', 'team_name', 'language', 'region', 'platform', 'skill_level'];
exports.SORTABLE = SORTABLE;

// Members are aggregated from team_memberships (the source of truth).
const baseQuery = (userId) =>
  connection
    .select(
      'teams.team_id',
      'teams.team_name',
      'teams.owner',
      'teams.language',
      'teams.region',
      'teams.platform',
      'teams.skill_level',
      'teams.description',
      connection.raw('ARRAY_AGG(DISTINCT users.user_name) AS users'),
      connection.raw('ARRAY_AGG(DISTINCT tactics.tactic_name) AS tactics')
    )
    .from('teams')
    .leftJoin('team_memberships', 'teams.team_id', '=', 'team_memberships.team_id')
    .leftJoin('users', 'team_memberships.user_id', '=', 'users.user_id')
    .leftJoin('tactics', 'teams.team_id', '=', 'tactics.team_id')
    .whereIn('teams.team_id', memberTeamIds(userId))
    .groupBy('teams.team_id');

exports.getTeams = (userId, sort_by = 'team_name', order = 'asc') =>
  baseQuery(userId).orderBy(`teams.${sort_by}`, order);

exports.getTeamsByID = (userId, teamID) => baseQuery(userId).where('teams.team_id', '=', teamID);

exports.getTeamsByColumn = (userId, column, value) =>
  baseQuery(userId).where(`teams.${column}`, '=', value).orderBy('teams.team_id');

exports.getTeamOwner = (teamID) =>
  connection('teams').select('owner').where('team_id', teamID).first();
