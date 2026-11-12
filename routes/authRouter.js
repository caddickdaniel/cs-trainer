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
  // Steam OpenID: browser navigations (GET), then JSON steps for unlinked identities.
  authRouter.route('/steam/start').get(limiter, c.steamStart).all(handle405);
  authRouter.route('/steam/callback').get(limiter, c.steamCallback).all(handle405);
  authRouter.route('/steam/pending').get(c.steamPending).delete(c.steamCancelPending).all(handle405);
  authRouter.route('/steam/complete').post(limiter, c.steamComplete).all(handle405);
  return authRouter;
};
