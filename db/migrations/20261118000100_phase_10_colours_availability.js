// Phase 10 (additive):
// - team_memberships.game_color: the player's CS2 teammate colour on this
//   team (one of the five, unique per team; unassigned by default). Leaving
//   the team deletes the membership, which frees the colour.
// - team_events.ends_at: optional end time (used for availability conflicts).
// - team_availability: each member's own Available / Unavailable entries
//   (all-day or a time range), shown on the team calendar.
const COLORS = ['yellow', 'purple', 'green', 'blue', 'orange'];

exports.up = async function (knex) {
  await knex.schema.alterTable('team_memberships', (t) => {
    t.string('game_color', 10);
  });
  await knex.raw(`ALTER TABLE team_memberships ADD CONSTRAINT team_memberships_game_color_check
    CHECK (game_color IS NULL OR game_color IN (${COLORS.map((c) => `'${c}'`).join(', ')}))`);
  await knex.raw(`CREATE UNIQUE INDEX team_memberships_one_color_per_team
    ON team_memberships (team_id, game_color) WHERE game_color IS NOT NULL`);

  await knex.schema.alterTable('team_events', (t) => {
    t.timestamp('ends_at', { useTz: true });
  });

  await knex.schema.createTable('team_availability', (t) => {
    t.increments('availability_id').primary();
    t.integer('team_id').notNullable().references('team_id').inTable('teams').onDelete('CASCADE');
    t.integer('user_id').notNullable().references('user_id').inTable('users').onDelete('CASCADE');
    t.string('status', 12).notNullable(); // available | unavailable
    t.boolean('all_day').notNullable().defaultTo(false);
    // The local calendar date the entry is for (YYYY-MM-DD in time_zone).
    t.date('day').notNullable();
    // Absolute instants; for all-day entries, local midnight to midnight.
    t.timestamp('starts_at', { useTz: true }).notNullable();
    t.timestamp('ends_at', { useTz: true }).notNullable();
    t.string('time_zone', 64).notNullable();
    t.string('note', 200).notNullable().defaultTo('');
    // Set for generated demonstration entries so seeding stays idempotent.
    t.string('sample_key', 60);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['team_id', 'starts_at']);
    t.unique(['team_id', 'sample_key']);
  });
  await knex.raw(`ALTER TABLE team_availability
    ADD CONSTRAINT team_availability_status_check CHECK (status IN ('available', 'unavailable')),
    ADD CONSTRAINT team_availability_range_check CHECK (ends_at > starts_at)`);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('team_availability');
  await knex.schema.alterTable('team_events', (t) => t.dropColumn('ends_at'));
  await knex.raw('DROP INDEX IF EXISTS team_memberships_one_color_per_team');
  await knex.schema.alterTable('team_memberships', (t) => t.dropColumn('game_color'));
};
