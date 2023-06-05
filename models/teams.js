const connection = require('../db/connection');

exports.getTeams = (sort_by = 'team_name', order = 'asc') =>
  connection
    .select(
        'teams.team_id',
        'teams.team_name',
        'teams.language',
        'teams.region',
        'teams.platform',
        'teams.skill_level',
        'teams.description',
        connection.raw('ARRAY_AGG(DISTINCT users.user_name) AS users'),
        connection.raw('ARRAY_AGG(DISTINCT tactics.tactic_name) AS tactics')
    )
    .from('teams')
    .leftJoin('users', 'teams.team_id', '=', 'users.team_id')
    .leftJoin('tactics', 'teams.team_id', '=', 'tactics.team_id')
    .groupBy('teams.team_id')
    .orderBy(sort_by, order)
    .returning('*');

exports.getTeamsByID = teamID =>
  connection
    .select(
      'teams.team_id',
      'teams.team_name',
      'teams.language',
      'teams.region',
      'teams.platform',
      'teams.skill_level',
      'teams.description',
      connection.raw('ARRAY_AGG(DISTINCT users.user_name) AS users'),
      connection.raw('ARRAY_AGG(DISTINCT tactics.tactic_name) AS tactics')
    )
    .from('teams')
    .leftJoin('users', 'teams.team_id', '=', 'users.team_id')
    .leftJoin('tactics', 'teams.team_id', '=', 'tactics.team_id')
    .groupBy('teams.team_id')
    .where('teams.team_id', '=', teamID)
    .returning('*');

exports.getTeamsByName = teamName =>
    connection
      .select(
        'teams.team_id',
        'teams.team_name',
        'teams.language',
        'teams.region',
        'teams.platform',
        'teams.skill_level',
        'teams.description',
        connection.raw('ARRAY_AGG(DISTINCT users.user_name) AS users'),
        connection.raw('ARRAY_AGG(DISTINCT tactics.tactic_name) AS tactics')
      )
      .from('teams')
      .leftJoin('users', 'teams.team_id', '=', 'users.team_id')
      .leftJoin('tactics', 'teams.team_id', '=', 'tactics.team_id')
      .where('teams.team_name', '=', teamName)
      .groupBy('teams.team_id')
      .returning('*');

exports.getTeamsByLanguage = languageName =>
  connection
    .select(
        'teams.team_id',
        'teams.team_name',
        'teams.language',
        'teams.region',
        'teams.platform',
        'teams.skill_level',
        'teams.description',
        connection.raw('ARRAY_AGG(DISTINCT users.user_name) AS users'),
        connection.raw('ARRAY_AGG(DISTINCT tactics.tactic_name) AS tactics')
    )
    .from('teams')
    .leftJoin('users', 'teams.team_id', '=', 'users.team_id')
    .leftJoin('tactics', 'teams.team_id', '=', 'tactics.team_id')
    .where('teams.language', '=', languageName)
    .groupBy('teams.team_id', 'teams.team_name', 'teams.language', 'teams.region', 'teams.platform', 'teams.skill_level')
    .returning('*');

exports.getTeamsByRegion = regionName =>
  connection
    .select(
        'teams.team_id',
        'teams.team_name',
        'teams.language',
        'teams.region',
        'teams.platform',
        'teams.skill_level',
        'teams.description',
        connection.raw('ARRAY_AGG(DISTINCT users.user_name) AS users'),
        connection.raw('ARRAY_AGG(DISTINCT tactics.tactic_name) AS tactics')
    )
    .from('teams')
    .leftJoin('users', 'teams.team_id', '=', 'users.team_id')
    .leftJoin('tactics', 'teams.team_id', '=', 'tactics.team_id')
    .where('teams.region', '=', regionName)
    .groupBy('teams.team_id', 'teams.team_name', 'teams.language', 'teams.region', 'teams.platform', 'teams.skill_level')
    .returning('*');

exports.getTeamsByPlatform = platformName =>
  connection
    .select(
        'teams.team_id',
        'teams.team_name',
        'teams.language',
        'teams.region',
        'teams.platform',
        'teams.skill_level',
        'teams.description',
        connection.raw('ARRAY_AGG(DISTINCT users.user_name) AS users'),
        connection.raw('ARRAY_AGG(DISTINCT tactics.tactic_name) AS tactics')
    )
    .from('teams')
    .leftJoin('users', 'teams.team_id', '=', 'users.team_id')
    .leftJoin('tactics', 'teams.team_id', '=', 'tactics.team_id')
    .where('teams.platform', '=', platformName)
    .groupBy('teams.team_id', 'teams.team_name', 'teams.language', 'teams.region', 'teams.platform', 'teams.skill_level')
    .returning('*');

exports.getTeamsBySkillLevel = skillLevelName =>
  connection
    .select(
        'teams.team_id',
        'teams.team_name',
        'teams.language',
        'teams.region',
        'teams.platform',
        'teams.skill_level',
        'teams.description',
        connection.raw('ARRAY_AGG(DISTINCT users.user_name) AS users'),
        connection.raw('ARRAY_AGG(DISTINCT tactics.tactic_name) AS tactics')
    )
    .from('teams')
    .leftJoin('users', 'teams.team_id', '=', 'users.team_id')
    .leftJoin('tactics', 'teams.team_id', '=', 'tactics.team_id')
    .where('teams.skill_level', '=', skillLevelName)
    .groupBy('teams.team_id', 'teams.team_name', 'teams.language', 'teams.region', 'teams.platform', 'teams.skill_level')
    .returning('*');

exports.addTeam = newTeam =>
  connection
    .insert(newTeam)
    .into('teams')
    .returning('*');

exports.deleteTeamByID = teamID =>
  connection('teams')
    .where('teams.team_id', '=', teamID)
    .del();

exports.updateTeamByID = (teamID, updatedTeam) => {
  return connection('teams')
    .where('team_id', teamID)
    .update(updatedTeam);
};    

exports.removeUserFromTeam = (teamID, userID) => {
  return connection('users')
    .where({ user_id: userID })
    .andWhere({ team_id: teamID })
    .update({ team_id: null });
};