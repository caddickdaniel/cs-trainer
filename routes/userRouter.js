const teamRouter = require('express').Router();
const {
  sendTeams,
  sendTeamsByName,
  sendTeamsByLanguage,
  sendTeamsByRegion,
  sendTeamsByPlatform,
  sendTeamsBySkillLevel,
  sendNewTeam,
  sendDeletedTeam,
} = require('../controllers/teams');
const { handle405 } = require('../errors');

teamRouter
  .route('/')
  .get(sendTeams)
  .post(sendNewTeam)
  .all(handle405);

teamRouter
  .route('/teams/:name')
  .get(sendTeamsByName)
  .delete(sendDeletedTeam)
  .all(handle405);

teamRouter
  .route('/teams/:language')
  .get(sendTeamsByLanguage)
  .all(handle405);

teamRouter
  .route('/teams/:region')
  .get(sendTeamsByRegion)
  .all(handle405);

teamRouter
  .route('/teams/:platform')
  .get(sendTeamsByPlatform)
  .all(handle405);

teamRouter
  .route('/teams/:skill_level')
  .get(sendTeamsBySkillLevel)
  .all(handle405);  

module.exports = teamRouter;