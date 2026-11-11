const express = require('express');
const c = require('../controllers/auth');
const { handle405 } = require('../errors');

// Built per app so each app instance gets its own rate limiter.
module.exports = ({ limiter }) => {
  const authRouter = express.Router();
  authRouter.route('/csrf').get(c.sendCsrfToken).all(handle405);
  authRouter.route('/me').get(c.sendMe).all(handle405);
  authRouter.route('/signup').post(limiter, c.signup).all(handle405);
  authRouter.route('/signin').post(limiter, c.signin).all(handle405);
  authRouter.route('/signout').post(c.signout).all(handle405);
  return authRouter;
};
