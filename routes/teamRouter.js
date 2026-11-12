const express = require('express');
const { LIMITS } = require('../domain/constants');
const { pictureBody } = require('./helpers');

const teamRouter = express.Router();
const c = require('../controllers/teams');
const { handle405 } = require('../errors');

teamRouter.route('/').get(c.sendTeams).post(c.sendNewTeam).all(handle405);

teamRouter
  .route('/:team_id')
  .get(c.sendTeamsByID)
  .patch(c.sendPatchedTeam)
  .delete(c.sendDeletedTeam)
  .all(handle405);

teamRouter.route('/name/:team_name').get(c.sendTeamsByName).all(handle405);
teamRouter.route('/lang/:language').get(c.sendTeamsByLanguage).all(handle405);
teamRouter.route('/reg/:region').get(c.sendTeamsByRegion).all(handle405);
teamRouter.route('/plat/:platform').get(c.sendTeamsByPlatform).all(handle405);
teamRouter.route('/skill/:skill_level').get(c.sendTeamsBySkillLevel).all(handle405);
teamRouter.route('/:team_id/owner').get(c.sendTeamOwner).all(handle405);
teamRouter.route('/:team_id/users/:user_id').patch(c.removeUserFromTeam).all(handle405);

// Milestone 1
teamRouter.route('/:team_id/roster').get(c.sendRoster).all(handle405);
teamRouter.route('/:team_id/members/:user_id').patch(c.patchMember).delete(c.deleteMember).all(handle405);
teamRouter.route('/:team_id/leave').post(c.leaveTeam).all(handle405);
teamRouter.route('/:team_id/invites').get(c.sendInvites).post(c.sendNewInvite).all(handle405);
teamRouter.route('/:team_id/invites/:invite_id').delete(c.revokeInvite).all(handle405);
teamRouter.route('/:team_id/tactics').get(c.sendTeamTactics).post(c.sendNewTacticDocument).all(handle405);
teamRouter.route('/:team_id/game-session').get(c.sendGameSession).post(c.startGameSession).all(handle405);

teamRouter.route('/:team_id/recruiting').patch(c.patchRecruiting).all(handle405);
teamRouter.route('/:team_id/logo').post(pictureBody, c.uploadLogo).delete(c.deleteLogo).all(handle405);
teamRouter.route('/:team_id/requests').get(c.sendJoinRequests).all(handle405);
teamRouter.route('/:team_id/requests/:request_id/invite').post(c.approveJoinRequest).all(handle405);
teamRouter.route('/:team_id/requests/:request_id/decline').post(c.declineJoinRequest).all(handle405);
teamRouter.route('/:team_id/events').get(c.sendEvents).post(c.createEvent).all(handle405);
teamRouter.route('/:team_id/events/next').get(c.sendNextEvent).all(handle405);
teamRouter.route('/:team_id/events/:event_id').get(c.sendEvent).patch(c.patchEvent).delete(c.deleteEvent).all(handle405);

teamRouter
  .route('/:team_id/lineup-images')
  .post(express.raw({ type: 'image/png', limit: LIMITS.imageBytes }), c.uploadLineupImage)
  .all(handle405);

// Demo Review: the team's demo library and its live review.
const demos = require('../services/demos');
const reviews = require('../services/reviews');
const v = require('../validation');
const { asyncHandler } = require('../errors');

const tid = (req) => v.parseId(req.params.team_id, 'team_id');
teamRouter.route('/:team_id/demos')
  .get(asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(200).send(await demos.listDemos(tid(req), req.user.user_id));
  }))
  // Body: the raw .dem file (application/octet-stream), streamed to disk.
  .post(asyncHandler(async (req, res) => {
    res.status(201).send(await demos.upload(tid(req), req.user.user_id, req, v.demoUploadQuery.parse(req.query)));
  }))
  .all(handle405);
teamRouter.route('/:team_id/review')
  .get(asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(200).send(await reviews.getCurrent(tid(req), req.user.user_id));
  }))
  .post(asyncHandler(async (req, res) => {
    res.status(201).send(await reviews.start(tid(req), req.user.user_id, v.reviewStart.parse(req.body)));
  }))
  .all(handle405);

module.exports = teamRouter;
