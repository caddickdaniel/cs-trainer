const tacticRouter = require('express').Router();
const {
  sendTactics,
  sendTacticsByID,
  sendTacticsByName,
  sendTacticsByEconomy,
  sendTacticsByTeam,
  sendNewTactic,
  sendDeletedTactic,
  sendPatchedTactic,
  sendStepsByUserAndTactic,
  sendPatchedSteps
} = require('../controllers/tactics');
const { handle405 } = require('../errors');

tacticRouter
  .route('/')
  .get(sendTactics)
  .post(sendNewTactic)
  .all(handle405);

tacticRouter
  .route('/:tactic_id')
  .get(sendTacticsByID)
  .patch(sendPatchedTactic)
  .delete(sendDeletedTactic)
  .all(handle405);

tacticRouter
  .route('/:tactic_id/steps')
  .patch(sendPatchedSteps)
  .all(handle405);

tacticRouter
  .route('/:tactic_id/user/:user_id/steps')
  .get(sendStepsByUserAndTactic)
  .all(handle405);

tacticRouter
  .route('/name/:tactic_name')
  .get(sendTacticsByName)
  .all(handle405);

tacticRouter
  .route('/econ/:economy')
  .get(sendTacticsByEconomy)
  .all(handle405);

tacticRouter
  .route('/team/:team_id')
  .get(sendTacticsByTeam)
  .all(handle405);

module.exports = tacticRouter;