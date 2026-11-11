const model = require('../models/users');
const db = require('../db/connection');
const { requireMember } = require('../services/access');
const { syncActiveTeam } = require('../services/users');
const teams = require('../services/teams');
const v = require('../validation');
const { asyncHandler, notFound, forbidden, badRequest, conflict, httpError } = require('../errors');

const me = (req) => req.user.user_id;
const userId = (req) => v.parseId(req.params.user_id, 'user_id');

const assertSelf = (req) => {
  const id = userId(req);
  if (id !== me(req)) throw forbidden('You can only change your own account');
  return id;
};

exports.sendUsers = asyncHandler(async (req, res) => {
  const { sort_by, order } = v.sortQuery(model.SORTABLE, 'user_name').parse(req.query);
  res.status(200).send({ users: await model.getUsers(me(req), sort_by, order) });
});

exports.sendUsersByID = asyncHandler(async (req, res) => {
  const [user] = await model.getUsersByColumn(me(req), 'user_id', userId(req));
  if (!user) throw notFound("That user doesn't exist");
  res.status(200).send({ users: user });
});

const byColumn = (column, param, single, emptyMessage) =>
  asyncHandler(async (req, res) => {
    const rows = await model.getUsersByColumn(me(req), column, req.params[param]);
    if (!rows.length) throw notFound(emptyMessage);
    res.status(200).send({ users: single ? rows[0] : rows });
  });

exports.sendUsersByName = byColumn('user_name', 'user_name', true, "That user doesn't exist");
exports.sendUsersByLanguage = byColumn('language', 'language', false, 'No users found for the specified language');
exports.sendUsersByRegion = byColumn('region', 'region', false, 'No users found for the specified region');
exports.sendUsersByPlatform = byColumn('platform', 'platform', false, 'No users found for the specified platform');
exports.sendUsersBySkillLevel = byColumn('skill_level', 'skill_level', false, 'No users found for the specified skill level');
exports.sendUsersByRole = byColumn('role', 'role', false, 'No users found for the specified role');

exports.sendUsersByTeam = asyncHandler(async (req, res) => {
  const teamId = v.parseId(req.params.team_id, 'team_id');
  await requireMember(teamId, me(req));
  const rows = await model.getUsersByTeam(me(req), teamId);
  res.status(200).send({ users: rows });
});

// Accounts are created through POST /api/auth/signup (with a password).
exports.sendNewUser = (req, res, next) =>
  next(httpError(410, 'Create accounts with POST /api/auth/signup', 'use_signup'));

exports.sendDeletedUser = asyncHandler(async (req, res) => {
  const id = assertSelf(req);
  const owns = await db('teams').where('owner', id).first('team_id');
  if (owns) throw conflict('Delete or hand over your team before deleting your account', 'owner_cannot_delete');
  await db('users').where('user_id', id).del();
  req.session.destroy(() => res.sendStatus(204));
});

exports.sendPatchedUser = asyncHandler(async (req, res) => {
  const id = assertSelf(req);
  const body = v.legacyUserPatch.parse(req.body);
  const { team_id: teamId, ...profile } = body;
  const changes = Object.fromEntries(Object.entries(profile).filter(([, value]) => value !== undefined));
  // team_id can only switch the active team between existing memberships.
  if (teamId !== undefined && teamId !== null) {
    const member = await db('team_memberships').where({ team_id: teamId, user_id: id }).first();
    if (!member) throw badRequest('Join a team with an invite before making it your team', 'not_a_member');
    changes.team_id = teamId;
  }
  if (Object.keys(changes).length) {
    await db('users').where('user_id', id).update({ ...changes, updated_at: db.fn.now() });
  }
  const [user] = await model.getUsersByColumn(me(req), 'user_id', id);
  res.status(200).send(user);
});

// Legacy: leave the active team.
exports.removeTeamFromUser = asyncHandler(async (req, res) => {
  const id = assertSelf(req);
  const user = await db('users').where('user_id', id).first('team_id');
  if (user.team_id != null) {
    await teams.removeMember(user.team_id, id, id);
  } else {
    await db.transaction((trx) => syncActiveTeam(trx, id));
  }
  res.status(204).send();
});
