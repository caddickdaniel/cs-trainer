const { getTeams, getTeamsByID, getTeamsByColumn, getTeamOwner, SORTABLE } = require('../models/teams');
const teams = require('../services/teams');
const tactics = require('../services/tactics');
const game = require('../services/game');
const images = require('../services/images');
const events = require('../services/events');
const pictures = require('../services/pictures');
const { pictureUpload } = require('../routes/helpers');
const { requireMember, requireOwner } = require('../services/access');
const v = require('../validation');
const { asyncHandler, notFound, httpError } = require('../errors');

const teamId = (req) => v.parseId(req.params.team_id, 'team_id');
const me = (req) => req.user.user_id;

exports.sendTeams = asyncHandler(async (req, res) => {
  const { sort_by, order } = v.sortQuery(SORTABLE, 'team_name').parse(req.query);
  res.status(200).send({ teams: await getTeams(me(req), sort_by, order) });
});

exports.sendTeamsByID = asyncHandler(async (req, res) => {
  const [team] = await getTeamsByID(me(req), teamId(req));
  if (!team) throw notFound("That team doesn't exist");
  res.status(200).send({ teams: team });
});

const byColumn = (column, param, single, emptyMessage) =>
  asyncHandler(async (req, res) => {
    const rows = await getTeamsByColumn(me(req), column, req.params[param]);
    if (!rows.length) throw notFound(emptyMessage);
    res.status(200).send({ teams: single ? rows[0] : rows });
  });

exports.sendTeamsByName = byColumn('team_name', 'team_name', true, "That team doesn't exist");
exports.sendTeamsByLanguage = byColumn('language', 'language', false, 'No teams found for the specified language');
exports.sendTeamsByRegion = byColumn('region', 'region', false, 'No teams found for the specified region');
exports.sendTeamsByPlatform = byColumn('platform', 'platform', false, 'No teams found for the specified platform');
exports.sendTeamsBySkillLevel = byColumn('skill_level', 'skill_level', false, 'No teams found for the specified skill level');

// Creates a team owned by the signed-in user (body.owner is ignored).
exports.sendNewTeam = asyncHandler(async (req, res) => {
  const team = await teams.createTeam(me(req), v.createTeam.parse(req.body));
  res.status(201).send({ teams: team });
});

exports.sendDeletedTeam = asyncHandler(async (req, res) => {
  await teams.deleteTeam(teamId(req), me(req));
  res.sendStatus(204);
});

exports.sendPatchedTeam = asyncHandler(async (req, res) => {
  const id = teamId(req);
  await teams.updateTeam(id, me(req), v.patchTeam.parse(req.body));
  const [team] = await getTeamsByID(me(req), id);
  res.status(200).send(team);
});

exports.sendTeamOwner = asyncHandler(async (req, res) => {
  const id = teamId(req);
  await requireMember(id, me(req));
  res.status(200).send({ team: await getTeamOwner(id) });
});

// Legacy: owner removes a player. The acting owner comes from the session.
exports.removeUserFromTeam = asyncHandler(async (req, res) => {
  await teams.removeMember(teamId(req), me(req), v.parseId(req.params.user_id, 'user_id'));
  res.status(204).send();
});

exports.sendRoster = asyncHandler(async (req, res) => {
  res.status(200).send(await teams.getRoster(teamId(req), me(req)));
});

exports.patchMember = asyncHandler(async (req, res) => {
  const id = teamId(req);
  await teams.updateMember(id, me(req), v.parseId(req.params.user_id, 'user_id'), v.patchMember.parse(req.body));
  res.status(200).send(await teams.getRoster(id, me(req)));
});

exports.deleteMember = asyncHandler(async (req, res) => {
  await teams.removeMember(teamId(req), me(req), v.parseId(req.params.user_id, 'user_id'));
  res.status(204).send();
});

exports.leaveTeam = asyncHandler(async (req, res) => {
  await teams.removeMember(teamId(req), me(req), me(req));
  res.status(204).send();
});

exports.sendInvites = asyncHandler(async (req, res) => {
  res.status(200).send({ invites: await teams.listInvites(teamId(req), me(req)) });
});

// With { user_id } this sends a player-specific invite; otherwise it creates
// an invite link (milestone 1 behaviour).
exports.sendNewInvite = asyncHandler(async (req, res) => {
  if (req.body && req.body.user_id !== undefined) {
    const { user_id } = v.invitePlayer.parse(req.body);
    return res.status(201).send({ invite: await teams.invitePlayer(teamId(req), me(req), user_id) });
  }
  return res.status(201).send(await teams.createInvite(teamId(req), me(req), v.createInvite.parse(req.body || {})));
});

exports.revokeInvite = asyncHandler(async (req, res) => {
  const invite = await teams.revokeInvite(teamId(req), me(req), v.parseId(req.params.invite_id, 'invite_id'));
  res.status(200).send({ invite });
});

exports.sendTeamTactics = asyncHandler(async (req, res) => {
  res.status(200).send(await tactics.listTeamTactics(teamId(req), me(req)));
});

exports.sendNewTacticDocument = asyncHandler(async (req, res) => {
  const doc = v.tacticDocument.parse(req.body);
  res.status(201).send(await tactics.createDocument(teamId(req), me(req), doc));
});

exports.sendGameSession = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(200).send(await game.getCurrent(teamId(req), me(req)));
});

exports.startGameSession = asyncHandler(async (req, res) => {
  const { tactic_id } = v.startSession.parse(req.body);
  res.status(201).send(await game.start(teamId(req), me(req), tactic_id));
});

// Body is the raw PNG (Content-Type: image/png).
exports.uploadLineupImage = asyncHandler(async (req, res) => {
  if (!req.is('image/png')) throw httpError(415, 'Upload the screenshot as a PNG (Content-Type: image/png)', 'not_png');
  const image = await images.upload(teamId(req), me(req), Buffer.isBuffer(req.body) ? req.body : null);
  res.status(201).send({ image });
});

exports.patchRecruiting = asyncHandler(async (req, res) => {
  const id = teamId(req);
  await teams.updateRecruiting(id, me(req), v.recruiting.parse(req.body));
  res.status(200).send(await teams.getRoster(id, me(req)));
});

exports.uploadLogo = asyncHandler(async (req, res) => {
  const id = teamId(req);
  await requireOwner(id, me(req));
  const { buf, contentType } = pictureUpload(req);
  await pictures.replace({ table: 'teams', idColumn: 'team_id', id, column: 'logo_image_id', purpose: 'team_logo', userId: me(req), buf, contentType });
  res.status(201).send(await teams.getRoster(id, me(req)));
});

exports.deleteLogo = asyncHandler(async (req, res) => {
  const id = teamId(req);
  await requireOwner(id, me(req));
  await pictures.replace({ table: 'teams', idColumn: 'team_id', id, column: 'logo_image_id', purpose: 'team_logo', userId: me(req), buf: null });
  res.status(200).send(await teams.getRoster(id, me(req)));
});

exports.sendJoinRequests = asyncHandler(async (req, res) => {
  res.send({ requests: await teams.listJoinRequests(teamId(req), me(req)) });
});

const resolveRequest = (approve) => asyncHandler(async (req, res) => {
  res.send(await teams.resolveJoinRequest(teamId(req), me(req), v.parseId(req.params.request_id, 'request_id'), approve));
});
exports.approveJoinRequest = resolveRequest(true);
exports.declineJoinRequest = resolveRequest(false);

const eventId = (req) => v.parseId(req.params.event_id, 'event_id');
exports.sendEvents = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.send(await events.listEvents(teamId(req), me(req), v.eventRange.parse(req.query)));
});
exports.sendNextEvent = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.send(await events.nextEvent(teamId(req), me(req)));
});
exports.sendEvent = asyncHandler(async (req, res) => res.send(await events.getEvent(teamId(req), me(req), eventId(req))));
exports.createEvent = asyncHandler(async (req, res) => {
  res.status(201).send(await events.createEvent(teamId(req), me(req), v.event.parse(req.body)));
});
exports.patchEvent = asyncHandler(async (req, res) => {
  res.send(await events.updateEvent(teamId(req), me(req), eventId(req), v.eventPatch.parse(req.body)));
});
exports.deleteEvent = asyncHandler(async (req, res) => {
  await events.deleteEvent(teamId(req), me(req), eventId(req));
  res.status(204).end();
});

