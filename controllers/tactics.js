const model = require('../models/tactics');
const tactics = require('../services/tactics');
const { requireMember, requireLead } = require('../services/access');
const v = require('../validation');
const { asyncHandler, notFound, httpError } = require('../errors');
const db = require('../db/connection');

const me = (req) => req.user.user_id;
const tacticId = (req) => v.parseId(req.params.tactic_id, 'tactic_id');

// Loads a tactic and checks the actor's access to its team. Tactics on other
// teams are reported as not found.
async function authorise(req, lead) {
  const row = await model.getTacticRow(tacticId(req));
  if (!row || row.team_id == null) throw notFound("That tactic doesn't exist");
  const check = lead ? requireLead : requireMember;
  await check(row.team_id, me(req)).catch((err) => {
    if (err.status === 404) throw notFound("That tactic doesn't exist");
    throw err;
  });
  return row;
}

exports.sendTactics = asyncHandler(async (req, res) => {
  const { sort_by, order } = v.sortQuery(model.SORTABLE, 'tactic_name').parse(req.query);
  res.status(200).send({ tactics: await model.getTactics(me(req), sort_by, order) });
});

exports.sendTacticsByID = asyncHandler(async (req, res) => {
  const [tactic] = await model.getTacticsByColumn(me(req), 'tactic_id', tacticId(req));
  if (!tactic) throw notFound("That tactic doesn't exist");
  res.status(200).send({ tactics: tactic });
});

exports.sendTacticsByName = asyncHandler(async (req, res) => {
  const [tactic] = await model.getTacticsByColumn(me(req), 'tactic_name', req.params.tactic_name);
  if (!tactic) throw notFound("That tactic doesn't exist");
  res.status(200).send({ tactics: tactic });
});

exports.sendTacticsByEconomy = asyncHandler(async (req, res) => {
  const rows = await model.getTacticsByColumn(me(req), 'economy', req.params.economy);
  if (!rows.length) throw notFound('No tactics found for the specified economy');
  res.status(200).send({ tactics: rows });
});

exports.sendTacticsByTeam = asyncHandler(async (req, res) => {
  const teamId = v.parseId(req.params.team_id, 'team_id');
  await requireMember(teamId, me(req));
  const rows = await model.getTacticsByColumn(me(req), 'team_id', teamId);
  if (!rows.length) throw notFound('No tactics found for the specified team');
  res.status(200).send({ tactics: rows });
});

const sideFromFlags = ({ T, CT }) => {
  if (T && !CT) return 'T';
  if (CT && !T) return 'CT';
  return null;
};

// Legacy create: now requires team_id for a team the actor leads.
exports.sendNewTactic = asyncHandler(async (req, res) => {
  const body = v.legacyTactic.parse(req.body);
  await requireLead(body.team_id, me(req));
  const [tactic] = await model.addTactic({
    ...body,
    T: Boolean(body.T),
    CT: Boolean(body.CT),
    side: sideFromFlags(body),
    steps: JSON.stringify([]),
    created_by: me(req),
    updated_by: me(req),
  });
  res.status(201).send({ tactics: tactic });
});

exports.sendDeletedTactic = asyncHandler(async (req, res) => {
  const row = await authorise(req, true);
  await model.deleteTacticByID(row.tactic_id);
  res.sendStatus(204);
});

exports.sendPatchedTactic = asyncHandler(async (req, res) => {
  const row = await authorise(req, true);
  const changes = v.legacyTacticPatch.parse(req.body);
  if ('T' in changes || 'CT' in changes) {
    const current = await db('tactics').where('tactic_id', row.tactic_id).first('T', 'CT');
    const flags = { T: changes.T ?? current.T, CT: changes.CT ?? current.CT };
    changes.side = sideFromFlags(flags);
  }
  if (Object.keys(changes).length) {
    await model.updateTacticByID(row.tactic_id, { ...changes, updated_by: me(req) });
  }
  const [tactic] = await model.getTacticsByColumn(me(req), 'tactic_id', row.tactic_id);
  res.status(200).send(tactic);
});

exports.sendStepsByUserAndTactic = asyncHandler(async (req, res) => {
  const row = await authorise(req, false);
  const userId = v.parseId(req.params.user_id, 'user_id');
  const steps = (row.steps || []).filter((step) => step.user_id === userId);
  res.status(200).json({ steps });
});

// Legacy steps are kept for existing callers; the phase model (document API)
// is what the app and Game Mode use.
exports.sendPatchedSteps = asyncHandler(async (req, res) => {
  const row = await authorise(req, true);
  const { steps } = v.legacySteps.parse(req.body);
  const ids = [...new Set(steps.map((s) => s.user_id))];
  if (ids.length) {
    const members = await db('team_memberships').where('team_id', row.team_id).whereIn('user_id', ids).pluck('user_id');
    const outsiders = ids.filter((id) => !members.includes(id));
    if (outsiders.length) {
      throw httpError(400, 'Steps can only be assigned to players on this team', 'assignee_not_member', { user_ids: outsiders });
    }
  }
  await model.updateTacticStepsByID(row.tactic_id, steps);
  res.status(200).json({ message: 'Steps updated successfully', steps });
});

exports.sendTacticDocument = asyncHandler(async (req, res) => {
  res.status(200).send(await tactics.getDocument(tacticId(req), me(req)));
});

exports.putTacticDocument = asyncHandler(async (req, res) => {
  const doc = v.tacticDocumentUpdate.parse(req.body);
  res.status(200).send(await tactics.updateDocument(tacticId(req), me(req), doc));
});

