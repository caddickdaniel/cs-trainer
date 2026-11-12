const tacticRouter = require('express').Router();
const c = require('../controllers/tactics');
const { handle405 } = require('../errors');

tacticRouter.route('/').get(c.sendTactics).post(c.sendNewTactic).all(handle405);

// Filter routes are registered before /:tactic_id/* so they always win.
tacticRouter.route('/name/:tactic_name').get(c.sendTacticsByName).all(handle405);
tacticRouter.route('/econ/:economy').get(c.sendTacticsByEconomy).all(handle405);
tacticRouter.route('/team/:team_id').get(c.sendTacticsByTeam).all(handle405);

tacticRouter
  .route('/:tactic_id')
  .get(c.sendTacticsByID)
  .patch(c.sendPatchedTactic)
  .delete(c.sendDeletedTactic)
  .all(handle405);

tacticRouter.route('/:tactic_id/steps').patch(c.sendPatchedSteps).all(handle405);
tacticRouter.route('/:tactic_id/user/:user_id/steps').get(c.sendStepsByUserAndTactic).all(handle405);
tacticRouter.route('/:tactic_id/document').get(c.sendTacticDocument).put(c.putTacticDocument).all(handle405);

// Publishing a tactic to the community library (owner or IGL).
const sharing = require('../services/sharing');
const v = require('../validation');
const { asyncHandler } = require('../errors');

tacticRouter.route('/:tactic_id/share')
  .get(asyncHandler(async (req, res) => {
    const includeImages = req.query.include_images !== 'false';
    res.status(200).send(await sharing.sharePreview(v.parseId(req.params.tactic_id, 'tactic_id'), req.user.user_id,
      { include_images: includeImages }));
  }))
  .post(asyncHandler(async (req, res) => {
    res.status(200).send(await sharing.publish(v.parseId(req.params.tactic_id, 'tactic_id'), req.user.user_id,
      v.shareTactic.parse(req.body || {})));
  }))
  .all(handle405);

module.exports = tacticRouter;
