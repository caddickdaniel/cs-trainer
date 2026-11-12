const express = require('express');
const teamRouter = require('./teamRouter');
const tacticRouter = require('./tacticRouter');
const userRouter = require('./userRouter');
const inviteRouter = require('./inviteRouter');
const gameRouter = require('./gameRouter');
const imageRouter = require('./imageRouter');
const meRouter = require('./meRouter');
const notificationRouter = require('./notificationRouter');
const discovery = require('./discoveryRouter');
const sharedRouter = require('./sharedRouter');
const demoRouter = require('./demoRouter');
const reviewRouter = require('./reviewRouter');
const createAuthRouter = require('./authRouter');
const { endpoints } = require('../endpoints');
const { loadUser, requireAuth } = require('../middleware/auth');
const { csrf } = require('../middleware/security');

module.exports = ({ authLimiter }) => {
  const apiRouter = express.Router();

  apiRouter.get('/', (req, res) => {
    res.status(200).send(endpoints);
  });

  apiRouter.use(loadUser);
  // Every state-changing request needs a valid CSRF token, including sign-in.
  apiRouter.use(csrf.csrfSynchronisedProtection);

  apiRouter.use('/auth', createAuthRouter({ limiter: authLimiter }));

  // Everything below requires a signed-in user.
  apiRouter.use(requireAuth);
  apiRouter.use('/teams', teamRouter);
  apiRouter.use('/tactics', tacticRouter);
  apiRouter.use('/users', userRouter);
  apiRouter.use('/invites', inviteRouter);
  apiRouter.use('/game-sessions', gameRouter);
  apiRouter.use('/lineup-images', imageRouter);
  apiRouter.use('/me', meRouter);
  apiRouter.use('/notifications', notificationRouter);
  apiRouter.use('/players', discovery.players);
  apiRouter.use('/recruiting', discovery.recruit);
  apiRouter.use('/pictures', discovery.pics);
  apiRouter.use('/shared-tactics', sharedRouter);
  apiRouter.use('/demos', demoRouter);
  apiRouter.use('/reviews', reviewRouter);

  apiRouter.use((req, res) => {
    res.status(404).send({ message: 'Sorry, this endpoint was not found! Go to /api to see a list of endpoints' });
  });

  return apiRouter;
};
