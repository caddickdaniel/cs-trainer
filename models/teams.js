const connection = require('../db/connection');

exports.getTeams = (sort_by = 'name', order = 'desc') =>
  connection
    .select(
        'teams.name',
        'teams.language',
        'teams.region',
        'teams.platform',
        'teams.skill_level',
    )
    .from('teams')
    .orderBy(sort_by, order)
    .returning('*');

exports.getTeamsByName = teamName =>
    connection
      .select(
        'teams.name',
        'teams.language',
        'teams.region',
        'teams.platform',
        'teams.skill_level'
      )
      .groupBy('teams.name')
      .from('teams')
      .where('teams.name', '=', teamName)
      .returning('*');

exports.getTeamsByLanguage = languageName =>
  connection
    .select(
        'teams.name',
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
        'teams.name',
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
        'teams.name',
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
        'teams.name',
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

exports.deleteTeamByName = teamName =>
  connection('teams')
    .where('teams.name', '=', teamName)
    .del();