const tacticRouter = require('express').Router();
const {
  sendTactics,
  sendTacticsByID,
  sendTacticsByName,
  sendTacticsByEconomy,
  sendNewTactic,
  sendDeletedTactic,
  sendPatchedTactic
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
  .route('/name/:tactic_name')
  .get(sendTacticsByName)
  .all(handle405);

tacticRouter
  .route('/econ/:economy')
  .get(sendTacticsByEconomy)
  .all(handle405);

module.exports = tacticRouter;