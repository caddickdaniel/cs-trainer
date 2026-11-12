// Deterministic seeds for development and test databases. Legacy-shaped rows
// are inserted first and then mapped onto the new tables through the same
// backfill helpers the migrations use.
const bcrypt = require('bcryptjs');
const { tacticData, userData, teamData, extra } = require('../data');
const { assertSafeToReset } = require('../guard');
const { NODE_ENV } = require('../../config/env');
const demo = require('../lib/demo');
const {
  backfillMemberships,
  backfillTacticMetadata,
  backfillPhasesFromSteps,
} = require('../lib/legacy-backfill');

// Development/test password for every seeded account. Never used in production.
const SEED_PASSWORD = 'trainer-dev-pass';

exports.SEED_PASSWORD = SEED_PASSWORD;

exports.seed = async function (knex) {
  await assertSafeToReset(knex);
  await knex.raw(`TRUNCATE notifications, team_events, team_join_requests, public_images, lineup_images, game_sessions, team_invites, phase_assignments, tactic_phases,
    team_memberships, migration_review_items, user_sessions, tactics, teams, users
    RESTART IDENTITY CASCADE`);

  // One hash shared by all seed users keeps seeding fast; salts differ per run only.
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 4);

  // users.team_id and teams.owner reference each other: insert users first,
  // then teams, then restore each user's legacy team_id.
  const users = [...userData, ...extra.users];
  const inserted = await knex('users')
    .insert(users.map(({ team_id, ...user }) => ({ ...user, password_hash: passwordHash })))
    .returning('user_id');
  await knex('teams').insert(teamData);
  for (const [i, { user_id }] of inserted.entries()) {
    if (users[i].team_id != null) {
      await knex('users').where({ user_id }).update({ team_id: users[i].team_id });
    }
  }
  await knex('tactics').insert(
    tacticData.map((tactic) => ({ ...tactic, steps: JSON.stringify(tactic.steps) }))
  );

  await backfillMemberships(knex);
  await backfillTacticMetadata(knex);
  await backfillPhasesFromSteps(knex);
  // Owners without a role become their team's IGL (as the phase 2 migration does).
  await knex.raw(`UPDATE team_memberships m SET player_role = 'igl', is_igl = true
    FROM teams t WHERE t.team_id = m.team_id AND t.owner = m.user_id AND m.player_role IS NULL
    AND NOT EXISTS (SELECT 1 FROM team_memberships o WHERE o.team_id = m.team_id AND o.player_role = 'igl')`);

  for (const { phases, ...tactic } of extra.tactics) {
    const [{ tactic_id }] = await knex('tactics')
      .insert({ ...tactic, steps: JSON.stringify([]) })
      .returning('tactic_id');
    for (const [position, { assignments, board, ...phase }] of phases.entries()) {
      const [{ phase_id }] = await knex('tactic_phases')
        .insert({ ...phase, board: JSON.stringify(board), tactic_id, position })
        .returning('phase_id');
      if (assignments.length) {
        await knex('phase_assignments').insert(assignments.map((a) => ({ ...a, phase_id })));
      }
    }
  }

  // Development only: Test Team 1 (5 players) and 10 teamless demo players.
  if (NODE_ENV === 'development') {
    await demo.seedTestTeam(knex, passwordHash);
    await demo.ensureTeamlessPlayers(knex, passwordHash);
  }
};
