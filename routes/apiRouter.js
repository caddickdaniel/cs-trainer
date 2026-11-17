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
const { asyncHandler } = require('../errors');
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

  // Profile options and rank catalogue (static, no account data).
  apiRouter.get('/catalogue', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.status(200).send(require('../domain/catalogue').catalogue());
  });

  // Everything below requires a signed-in user.
  apiRouter.use(requireAuth);
  // Lineup catalogue for the tactics editor's picker (Phase 15): attributed
  // links to individual CSNADES.gg lineups, with radar positions.
  apiRouter.get('/lineups', (req, res) => {
    const map = String(req.query.map || '');
    const lineups = require('../domain/lineups');
    if (!lineups.MAPS.includes(map)) return res.status(400).send({ message: 'Unknown map', code: 'bad_map' });
    res.set('Cache-Control', 'private, max-age=600');
    return res.status(200).send({ map, source: lineups.SOURCE, lineups: lineups.list({ map }) });
  });
  apiRouter.use('/teams', teamRouter);
  apiRouter.use('/tactics', tacticRouter);
  apiRouter.use('/users', userRouter);
  apiRouter.use('/invites', inviteRouter);
  apiRouter.use('/game-sessions', gameRouter);
  // Replay Inspector: the signed-in user's latest CS2 capture session (progress overlay).
  apiRouter.get('/capture-sessions/current', asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(200).send(await require('../services/captures').currentSession(req.user.user_id));
  }));
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
