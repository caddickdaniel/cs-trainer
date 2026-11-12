// Discovery: available players, public profiles, recruiting teams and
// pictures. Only profile and recruiting information is exposed here.
const express = require('express');
const profiles = require('../services/profiles');
const recruiting = require('../services/recruiting');
const teams = require('../services/teams');
const pictures = require('../services/pictures');
const v = require('../validation');
const { asyncHandler, handle405, notFound } = require('../errors');

const me = (req) => req.user.user_id;

const players = express.Router();
players.route('/available')
  .get(asyncHandler(async (req, res) => res.send(await profiles.availablePlayers(me(req), v.playerFilters.parse(req.query)))))
  .all(handle405);
players.route('/:user_id/stats')
  .get(asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.send(await require('../services/stats').profileStats(me(req), v.parseId(req.params.user_id, 'user_id')));
  }))
  .all(handle405);
players.route('/:user_id')
  .get(asyncHandler(async (req, res) => res.send(await profiles.getPublicProfile(me(req), v.parseId(req.params.user_id, 'user_id')))))
  .all(handle405);

const recruit = express.Router();
recruit.route('/teams')
  .get(asyncHandler(async (req, res) => res.send(await recruiting.listRecruitingTeams(me(req)))))
  .all(handle405);
recruit.route('/teams/:team_id')
  .get(asyncHandler(async (req, res) => res.send(await recruiting.getRecruitingTeam(me(req), v.parseId(req.params.team_id, 'team_id')))))
  .all(handle405);
recruit.route('/teams/:team_id/requests')
  .post(asyncHandler(async (req, res) => {
    const request = await teams.createJoinRequest(v.parseId(req.params.team_id, 'team_id'), me(req), v.joinRequest.parse(req.body || {}));
    res.status(201).send({ request: { request_id: request.request_id, team_id: request.team_id, status: request.status } });
  }))
  .all(handle405);

const pics = express.Router();
pics.route('/:image_id')
  .get(asyncHandler(async (req, res) => {
    const parsed = v.imageId.safeParse(req.params.image_id);
    if (!parsed.success) throw notFound('Image not found');
    const image = await pictures.fetch(parsed.data);
    res.set({
      'Content-Type': image.content_type,
      'Cache-Control': 'private, max-age=86400, immutable',
      ETag: `"${image.sha256}"`,
      'Content-Security-Policy': "default-src 'none'",
    });
    if (req.headers['if-none-match'] === `"${image.sha256}"`) return res.status(304).end();
    return res.send(image.data);
  }))
  .all(handle405);

module.exports = { players, recruit, pics };
