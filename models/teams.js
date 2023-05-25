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
    )
    .from('teams')
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
      'teams.skill_level'
    )
    .groupBy('teams.team_id')
    .from('teams')
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
        'teams.skill_level'
      )
      .groupBy('teams.team_name')
      .from('teams')
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
        'teams.skill_level'
    )
    .groupBy('teams.language')
    .from('teams')
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
        'teams.skill_level'
    )
    .groupBy('teams.region')
    .from('teams')
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
        'teams.skill_level'
    )
    .groupBy('teams.platform')
    .from('teams')
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
        'teams.skill_level'
    )
    .groupBy('teams.skill_level')
    .from('teams')
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