const { getTeams, getTeamsByID, getTeamsByColumn, getTeamOwner, SORTABLE } = require('../models/teams');
const teams = require('../services/teams');
const tactics = require('../services/tactics');
const game = require('../services/game');
const { requireMember } = require('../services/access');
const v = require('../validation');
const { asyncHandler, notFound } = require('../errors');

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

exports.sendNewInvite = asyncHandler(async (req, res) => {
  res.status(201).send(await teams.createInvite(teamId(req), me(req), v.createInvite.parse(req.body || {})));
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
