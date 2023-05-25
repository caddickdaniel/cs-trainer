const connection = require('../db/connection');

exports.getUsers = (sort_by = 'name', order = 'desc') =>
  connection
    .select(
        'users.user_id',
        'users.name',
        'users.language',
        'users.region',
        'users.platform',
        'users.skill_level',
        'users.role',
        'users.team_name'
    )
    .from('users')
    .orderBy(sort_by, order)
    .returning('*');

exports.getUsersByID = userID =>
  connection
    .select(
        'users.user_id',
        'users.name',
        'users.language',
        'users.region',
        'users.platform',
        'users.skill_level',
        'users.role',
        'users.team_name'
    )
    .groupBy('users.user_id')
    .from('users')
    .where('users.user_id', '=', userID)
    .returning('*');

exports.getUsersByName = userName =>
    connection
      .select(
        'users.user_id',
        'users.name',
        'users.language',
        'users.region',
        'users.platform',
        'users.skill_level',
        'users.role',
        'users.team_name'
      )
      .groupBy('users.name')
      .from('users')
      .where('users.name', '=', userName)
      .returning('*');

exports.getUsersByLanguage = languageName =>
  connection
    .select(
        'users.user_id',
        'users.name',
        'users.language',
        'users.region',
        'users.platform',
        'users.skill_level',
        'users.role',
        'users.team_name'
    )
    .groupBy('users.language')
    .from('users')
    .where('users.language', '=', languageName)
    .returning('*');

exports.getUsersByRegion = regionName =>
  connection
    .select(
        'users.user_id',
        'users.name',
        'users.language',
        'users.region',
        'users.platform',
        'users.skill_level',
        'users.role',
        'users.team_name'
    )
    .groupBy('users.region')
    .from('users')
    .where('users.region', '=', regionName)
    .returning('*');

exports.getUsersByPlatform = platformName =>
  connection
    .select(
        'users.user_id',
        'users.name',
        'users.language',
        'users.region',
        'users.platform',
        'users.skill_level',
        'users.role',
        'users.team_name'
    )
    .groupBy('users.platform')
    .from('users')
    .where('users.platform', '=', platformName)
    .returning('*');

exports.getUsersBySkillLevel = skillLevelName =>
  connection
    .select(
        'users.user_id',
        'users.name',
        'users.language',
        'users.region',
        'users.platform',
        'users.skill_level',
        'users.role',
        'users.team_name'
    )
    .groupBy('users.skill_level')
    .from('users')
    .where('users.skill_level', '=', skillLevelName)
    .returning('*');

exports.getUsersByRole = roleName =>
  connection
    .select(
        'users.user_id',
        'users.name',
        'users.language',
        'users.region',
        'users.platform',
        'users.skill_level',
        'users.role',
        'users.team_name'
    )
    .groupBy('users.role')
    .from('users')
    .where('users.role', '=', roleName)
    .returning('*');
  
exports.getUsersByTeam = teamName =>
  connection
    .select(
        'users.user_id',
        'users.name',
        'users.language',
        'users.region',
        'users.platform',
        'users.skill_level',
        'users.role',
        'users.team_name'
    )
    .groupBy('users.team_name')
    .from('users')
    .where('users.team_name', '=', teamName)
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