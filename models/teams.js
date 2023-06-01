const connection = require('../db/connection');

exports.getTeams = (sort_by = 'team_name', order = 'desc') =>
  connection
    .select(
        'teams.team_id',
        'teams.team_name',
        'teams.language',
        'teams.region',
        'teams.platform',
        'teams.skill_level',
        connection.raw('ARRAY_AGG(users.user_name) AS users')
    )
    .from('teams')
    .leftJoin('users', 'teams.team_id', '=', 'users.team_id')
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
      connection.raw('ARRAY_AGG(users.user_name) AS users')
    )
    .from('teams')
    .leftJoin('users', 'teams.team_id', '=', 'users.team_id')
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
        connection.raw('ARRAY_AGG(users.user_name) AS users')
      )
      .from('teams')
      .leftJoin('users', 'teams.team_id', '=', 'users.team_id')
      .groupBy('teams.team_name')
      .where('teams.team_name', '=', teamName)
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
        connection.raw('ARRAY_AGG(users.user_name) AS users')
    )
    .from('teams')
    .leftJoin('users', 'teams.team_id', '=', 'users.team_id')
    .groupBy('teams.language')
    .where('teams.language', '=', languageName)
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
        connection.raw('ARRAY_AGG(users.user_name) AS users')
    )
    .from('teams')
    .leftJoin('users', 'teams.team_id', '=', 'users.team_id')
    .groupBy('teams.region')
    .where('teams.region', '=', regionName)
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
        connection.raw('ARRAY_AGG(users.user_name) AS users')
    )
    .from('teams')
    .leftJoin('users', 'teams.team_id', '=', 'users.team_id')
    .groupBy('teams.platform')
    .where('teams.platform', '=', platformName)
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
        connection.raw('ARRAY_AGG(users.user_name) AS users')
    )
    .from('teams')
    .leftJoin('users', 'teams.team_id', '=', 'users.team_id')
    .groupBy('teams.skill_level')
    .where('teams.skill_level', '=', skillLevelName)
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