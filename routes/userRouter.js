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
  .delete(sendDeletedUser)
  .all(handle405);

userRouter
  .route(':user_name')
  .get(sendUsersByName)
  .all(handle405);

userRouter
  .route(':language')
  .get(sendUsersByLanguage)
  .all(handle405);

userRouter
  .route(':region')
  .get(sendUsersByRegion)
  .all(handle405);

userRouter
  .route(':platform')
  .get(sendUsersByPlatform)
  .all(handle405);

userRouter
  .route(':skill_level')
  .get(sendUsersBySkillLevel)
  .all(handle405);  

userRouter
  .route(':role')
  .get(sendUsersByRole)
  .all(handle405);    

userRouter
  .route(':team_name')
  .get(sendUsersByTeam)
  .all(handle405);  

module.exports = userRouter;