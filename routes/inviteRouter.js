const inviteRouter = require('express').Router();
const teams = require('../services/teams');
const v = require('../validation');
const { asyncHandler, handle405, notFound } = require('../errors');

const token = (req) => {
  const result = v.inviteToken.safeParse(req.params.token);
  if (!result.success) throw notFound('This invite link is not valid', 'invite_not_found');
  return result.data;
};

inviteRouter
  .route('/:token')
  .get(asyncHandler(async (req, res) => {
    res.status(200).send(await teams.previewInvite(token(req), req.user.user_id));
  }))
  .all(handle405);

inviteRouter
  .route('/:token/accept')
  .post(asyncHandler(async (req, res) => {
    res.status(200).send({ team: await teams.acceptInvite(token(req), req.user.user_id) });
  }))
  .all(handle405);

module.exports = inviteRouter;
