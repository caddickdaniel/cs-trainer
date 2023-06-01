const connection = require('../db/connection');

exports.getUsers = (sort_by = 'user_name', order = 'desc') =>
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
    )
    .from('users')
    .join('teams', 'users.team_id', '=', 'teams.team_id')
    .orderBy(sort_by, order)
    .returning('*');

exports.getUsersByID = userID =>
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
    )
    .from('users')
    .join('teams', 'users.team_id', '=', 'teams.team_id')
    .groupBy('users.user_id')
    .where('users.user_id', '=', userID)
    .returning('*');

exports.getUsersByName = userName =>
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
      )
      .from('users')
      .join('teams', 'users.team_id', '=', 'teams.team_id')
      .groupBy('users.user_name')
      .where('users.user_name', '=', userName)
      .returning('*');

exports.getUsersByLanguage = languageName =>
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
    )
    .from('users')
    .join('teams', 'users.team_id', '=', 'teams.team_id')
    .groupBy('users.language')
    .where('users.language', '=', languageName)
    .returning('*');

exports.getUsersByRegion = regionName =>
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
    )
    .from('users')
    .join('teams', 'users.team_id', '=', 'teams.team_id')
    .groupBy('users.region')
    .where('users.region', '=', regionName)
    .returning('*');

exports.getUsersByPlatform = platformName =>
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
    )
    .from('users')
    .join('teams', 'users.team_id', '=', 'teams.team_id')
    .groupBy('users.platform')
    .where('users.platform', '=', platformName)
    .returning('*');

exports.getUsersBySkillLevel = skillLevelName =>
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
    )
    .from('users')
    .join('teams', 'users.team_id', '=', 'teams.team_id')
    .groupBy('users.skill_level')
    .where('users.skill_level', '=', skillLevelName)
    .returning('*');

exports.getUsersByRole = roleName =>
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
    )
    .from('users')
    .join('teams', 'users.team_id', '=', 'teams.team_id')
    .groupBy('users.role')
    .where('users.role', '=', roleName)
    .returning('*');
  
exports.getUsersByTeam = teamID =>
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
    )
    .from('users')
    .join('teams', 'users.team_id', '=', 'teams.team_id')
    .groupBy('users.team_id')
    .where('users.team_id', '=', teamID)
    .returning('*');    

exports.addUser = newUser =>
  connection
    .insert(newUser)
    .into('users')
    .returning('*');

exports.deleteUserByID = userID =>
  connection('users')
    .where('users.user_id', '=', userID)
    .del();