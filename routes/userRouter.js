const userRouter = require('express').Router();
const c = require('../controllers/users');
const { handle405 } = require('../errors');

userRouter.route('/').get(c.sendUsers).post(c.sendNewUser).all(handle405);

// Filter routes are registered before /:user_id/* so they always win.
userRouter.route('/name/:user_name').get(c.sendUsersByName).all(handle405);
userRouter.route('/lang/:language').get(c.sendUsersByLanguage).all(handle405);
userRouter.route('/reg/:region').get(c.sendUsersByRegion).all(handle405);
userRouter.route('/plat/:platform').get(c.sendUsersByPlatform).all(handle405);
userRouter.route('/skill/:skill_level').get(c.sendUsersBySkillLevel).all(handle405);
userRouter.route('/role/:role').get(c.sendUsersByRole).all(handle405);
userRouter.route('/team/:team_id').get(c.sendUsersByTeam).all(handle405);

userRouter
  .route('/:user_id')
  .get(c.sendUsersByID)
  .patch(c.sendPatchedUser)
  .delete(c.sendDeletedUser)
  .all(handle405);

userRouter.route('/:user_id/remove-team').patch(c.removeTeamFromUser).all(handle405);

module.exports = userRouter;
