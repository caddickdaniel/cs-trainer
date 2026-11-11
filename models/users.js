// Legacy user queries, scoped to the acting user and their teammates.
const connection = require('../db/connection');
const { visibleUserIds } = require('../services/access');

const SORTABLE = ['user_id', 'user_name', 'language', 'region', 'platform', 'skill_level', 'role', 'team_id'];
exports.SORTABLE = SORTABLE;

// Never selects email or password_hash.
const baseQuery = (actorId) =>
  connection
    .select(
      'users.user_id',
      'users.user_name',
      'users.language',
      'users.region',
      'users.platform',
      'users.skill_level',
      'users.role',
      'users.team_id',
      'teams.team_name AS team_name',
      'users.avatar_url',
      'users.bio'
    )
    .from('users')
    .leftJoin('teams', 'users.team_id', '=', 'teams.team_id')
    .whereIn('users.user_id', visibleUserIds(actorId));

exports.getUsers = (actorId, sort_by = 'user_name', order = 'asc') =>
  baseQuery(actorId).orderBy(`users.${sort_by}`, order).orderBy('users.user_id');

exports.getUsersByColumn = (actorId, column, value) =>
  baseQuery(actorId).where(`users.${column}`, '=', value).orderBy('users.user_id');

exports.getUsersByTeam = (actorId, teamId) =>
  baseQuery(actorId)
    .whereIn('users.user_id', connection('team_memberships').where('team_id', teamId).select('user_id'))
    .orderBy('users.user_id');
