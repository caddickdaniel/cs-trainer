// The signed-in player's own profile, settings, invites and requests.
const meRouter = require('express').Router();
const profiles = require('../services/profiles');
const teams = require('../services/teams');
const v = require('../validation');
const { asyncHandler, handle405 } = require('../errors');
const { pictureBody, pictureUpload } = require('./helpers');

const me = (req) => req.user.user_id;

meRouter.route('/profile')
  .get(asyncHandler(async (req, res) => res.send({ profile: await profiles.getOwnProfile(me(req)) })))
  .patch(asyncHandler(async (req, res) => res.send({ profile: await profiles.updateOwnProfile(me(req), v.profile.parse(req.body)) })))
  .all(handle405);

meRouter.route('/avatar')
  .post(pictureBody, asyncHandler(async (req, res) => {
    const { buf, contentType } = pictureUpload(req);
    await profiles.setAvatar(me(req), buf, contentType);
    res.status(201).send({ profile: await profiles.getOwnProfile(me(req)) });
  }))
  .delete(asyncHandler(async (req, res) => {
    await profiles.setAvatar(me(req), null);
    res.send({ profile: await profiles.getOwnProfile(me(req)) });
  }))
  .all(handle405);

meRouter.route('/settings')
  .get(asyncHandler(async (req, res) => res.send(await profiles.getSettings(me(req)))))
  .put(asyncHandler(async (req, res) => res.send(await profiles.updateSettings(me(req), v.settings.parse(req.body)))))
  .all(handle405);

meRouter.route('/invites')
  .get(asyncHandler(async (req, res) => res.send({ invites: await teams.myInvites(me(req)) })))
  .all(handle405);

const respond = (accept) => asyncHandler(async (req, res) => {
  const team = await teams.respondToInvite(v.parseId(req.params.invite_id, 'invite_id'), me(req), accept);
  res.send({ team, status: accept ? 'accepted' : 'declined' });
});
meRouter.route('/invites/:invite_id/accept').post(respond(true)).all(handle405);
meRouter.route('/invites/:invite_id/decline').post(respond(false)).all(handle405);

meRouter.route('/requests')
  .get(asyncHandler(async (req, res) => res.send({ requests: await teams.myJoinRequests(me(req)) })))
  .all(handle405);

module.exports = meRouter;
