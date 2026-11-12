const gameRouter = require('express').Router();
const game = require('../services/game');
const v = require('../validation');
const { asyncHandler, handle405 } = require('../errors');

const sessionId = (req) => v.parseId(req.params.session_id, 'session_id');

gameRouter
  .route('/:session_id')
  .get(asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(200).send(await game.getSession(sessionId(req), req.user.user_id));
  }))
  .all(handle405);

gameRouter
  .route('/:session_id/phase')
  .post(asyncHandler(async (req, res) => {
    res.status(200).send(await game.changePhase(sessionId(req), req.user.user_id, v.phaseChange.parse(req.body)));
  }))
  .all(handle405);

gameRouter
  .route('/:session_id/command')
  .post(asyncHandler(async (req, res) => {
    res.status(200).send(await game.command(sessionId(req), req.user.user_id, v.gameCommand.parse(req.body)));
  }))
  .all(handle405);

gameRouter
  .route('/:session_id/end')
  .post(asyncHandler(async (req, res) => {
    res.status(200).send(await game.end(sessionId(req), req.user.user_id, v.endSession.parse(req.body || {})));
  }))
  .all(handle405);

module.exports = gameRouter;
