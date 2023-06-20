const userRouter = require('express').Router();
const {
  sendUsers,
  sendUsersByID,
  sendUsersByName,
  sendUsersByLanguage,
  sendUsersByRegion,
  sendUsersByPlatform,
  sendUsersBySkillLevel,
  sendUsersByRole,
  sendUsersByTeam,
  sendNewUser,
  sendDeletedUser,
  sendPatchedUser,
  removeTeamFromUser
} = require('../controllers/users');
const { handle405 } = require('../errors');

userRouter
  .route('/')
  .get(sendUsers)
  .post(sendNewUser)
  .all(handle405);

userRouter
  .route('/:user_id')
  .get(sendUsersByID)
  .patch(sendPatchedUser)
  .delete(sendDeletedUser)
  .all(handle405);

userRouter
  .route('/name/:user_name')
  .get(sendUsersByName)
  .all(handle405);

userRouter
  .route('/lang/:language')
  .get(sendUsersByLanguage)
  .all(handle405);

userRouter
  .route('/reg/:region')
  .get(sendUsersByRegion)
  .all(handle405);

userRouter
  .route('/plat/:platform')
  .get(sendUsersByPlatform)
  .all(handle405);

userRouter
  .route('/skill/:skill_level')
  .get(sendUsersBySkillLevel)
  .all(handle405);  

userRouter
  .route('/role/:role')
  .get(sendUsersByRole)
  .all(handle405);    

userRouter
  .route('/team/:team_id')
  .get(sendUsersByTeam)
  .all(handle405);  

userRouter
  .route('/:user_id/remove-team')
  .patch(removeTeamFromUser)
  .all(handle405);

module.exports = userRouter;