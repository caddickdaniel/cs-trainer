const teamRouter = require('express').Router();
const {
  sendTeams,
  sendTeamsByID,
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
  .route('/:team_id')
  .get(sendTeamsByID)
  .delete(sendDeletedTeam)
  .all(handle405); 

teamRouter
  .route('/name/:team_name')
  .get(sendTeamsByName)
  .all(handle405);

teamRouter
  .route('/lang/:language')
  .get(sendTeamsByLanguage)
  .all(handle405);

teamRouter
  .route('/reg/:region')
  .get(sendTeamsByRegion)
  .all(handle405);

teamRouter
  .route('/plat/:platform')
  .get(sendTeamsByPlatform)
  .all(handle405);

teamRouter
  .route('/skill/:skill_level')
  .get(sendTeamsBySkillLevel)
  .all(handle405);  

module.exports = teamRouter;