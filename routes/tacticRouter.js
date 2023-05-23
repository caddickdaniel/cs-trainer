const tacticRouter = require('express').Router();
const {
  sendTactics,
  sendTacticsByID,
  sendTacticsByName,
  sendTacticsByEconomy,
  sendNewTactic,
  sendDeletedTactic,
} = require('../controllers/tactics');
const { handle405 } = require('../errors');

tacticRouter
  .route('/')
  .get(sendTactics)
  .post(sendNewTactic)
  .all(handle405);

tacticRouter
  .route('/tactics/:tactic_id')
  .get(sendTacticsByID)
  .delete(sendDeletedTactic)
  .all(handle405);

tacticRouter
  .route('/tactics/:name')
  .get(sendTacticsByName)
  .all(handle405);

tacticRouter
  .route('/tactics/:economy')
  .get(sendTacticsByEconomy)
  .all(handle405);

module.exports = tacticRouter;