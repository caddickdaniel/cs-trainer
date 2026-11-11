// Additive: adds credentials to users, a server-side session table, the
// relational team_memberships table and a review table for ambiguous legacy
// records. Existing columns (users.team_id, teams.users) are preserved.
const { backfillMemberships } = require('../lib/legacy-backfill');

exports.up = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    t.string('email', 254);
    t.string('password_hash', 100);
  });
  await knex.raw('CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email)) WHERE email IS NOT NULL');

  // Store used by connect-pg-simple (express-session).
  await knex.schema.createTable('user_sessions', (t) => {
    t.string('sid').primary();
    t.json('sess').notNullable();
    t.timestamp('expire', { precision: 6 }).notNullable().index();
  });

  await knex.schema.createTable('migration_review_items', (t) => {
    t.increments('review_item_id').primary();
    t.string('kind').notNullable();
    t.string('entity').notNullable();
    t.string('entity_ref').notNullable();
    t.text('detail').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('resolved_at');
    t.unique(['kind', 'entity', 'entity_ref']);
  });

  await knex.schema.createTable('team_memberships', (t) => {
    t.increments('membership_id').primary();
    t.integer('team_id').notNullable().references('team_id').inTable('teams').onDelete('CASCADE');
    t.integer('user_id').notNullable().references('user_id').inTable('users').onDelete('CASCADE');
    // Access permission: may edit tactics and control Game Mode. The team owner
    // (teams.owner) always has it implicitly.
    t.boolean('is_igl').notNullable().defaultTo(false);
    // In-game role (entry, support, ...). Independent of access permissions.
    t.string('player_role', 20);
    t.timestamp('joined_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['team_id', 'user_id']);
    t.index('user_id');
  });

  // Report dangling legacy references before adding foreign keys. NOT VALID
  // keys enforce integrity for new writes without rejecting existing rows.
  const danglingTactics = await knex('tactics')
    .whereNotNull('team_id')
    .whereNotIn('team_id', knex('teams').select('team_id'))
    .pluck('tactic_id');
  for (const id of danglingTactics) {
    await knex('migration_review_items').insert({
      kind: 'dangling_tactic_team', entity: 'tactic', entity_ref: String(id),
      detail: 'tactics.team_id references a team that does not exist',
    }).onConflict(['kind', 'entity', 'entity_ref']).ignore();
  }
  await knex.raw(`ALTER TABLE tactics ADD CONSTRAINT tactics_team_id_foreign
    FOREIGN KEY (team_id) REFERENCES teams(team_id) ON DELETE CASCADE NOT VALID`);
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_team_id_foreign
    FOREIGN KEY (team_id) REFERENCES teams(team_id) ON DELETE SET NULL NOT VALID`);

  await backfillMemberships(knex);
};

exports.down = async function (knex) {
  await knex.raw('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_team_id_foreign');
  await knex.raw('ALTER TABLE tactics DROP CONSTRAINT IF EXISTS tactics_team_id_foreign');
  await knex.schema.dropTableIfExists('team_memberships');
  await knex.schema.dropTableIfExists('migration_review_items');
  await knex.schema.dropTableIfExists('user_sessions');
  await knex.raw('DROP INDEX IF EXISTS users_email_lower_unique');
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('email');
    t.dropColumn('password_hash');
  });
};
