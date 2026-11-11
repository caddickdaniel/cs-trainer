// Additive: map/side/revision on tactics plus ordered phases and per-player
// assignments. Legacy columns (T, CT, steps, utility counts) are preserved.
const { backfillTacticMetadata, backfillPhasesFromSteps } = require('../lib/legacy-backfill');

exports.up = async function (knex) {
  await knex.schema.alterTable('tactics', (t) => {
    t.string('map', 40);
    t.string('side', 2);
    t.integer('revision').notNullable().defaultTo(1);
    t.integer('created_by').references('user_id').inTable('users').onDelete('SET NULL');
    t.integer('updated_by').references('user_id').inTable('users').onDelete('SET NULL');
  });
  await knex.raw(`ALTER TABLE tactics ADD CONSTRAINT tactics_side_check CHECK (side IN ('T', 'CT'))`);

  await knex.schema.createTable('tactic_phases', (t) => {
    t.increments('phase_id').primary();
    t.integer('tactic_id').notNullable().references('tactic_id').inTable('tactics').onDelete('CASCADE');
    t.integer('position').notNullable();
    t.string('name', 60).notNullable();
    t.text('notes').notNullable().defaultTo('');
    // { markers: [...], routes: [...] } with coordinates normalised to 0..1.
    t.jsonb('board').notNullable().defaultTo(JSON.stringify({ markers: [], routes: [] }));
    t.unique(['tactic_id', 'position']);
  });

  await knex.schema.createTable('phase_assignments', (t) => {
    t.increments('assignment_id').primary();
    t.integer('phase_id').notNullable().references('phase_id').inTable('tactic_phases').onDelete('CASCADE');
    t.integer('user_id').notNullable().references('user_id').inTable('users').onDelete('CASCADE');
    t.text('instruction').notNullable().defaultTo('');
    t.text('utility').notNullable().defaultTo('');
    t.string('reference_url', 500);
    t.unique(['phase_id', 'user_id']);
  });

  await backfillTacticMetadata(knex);
  await backfillPhasesFromSteps(knex);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('phase_assignments');
  await knex.schema.dropTableIfExists('tactic_phases');
  await knex.raw('ALTER TABLE tactics DROP CONSTRAINT IF EXISTS tactics_side_check');
  await knex.schema.alterTable('tactics', (t) => {
    t.dropColumn('updated_by');
    t.dropColumn('created_by');
    t.dropColumn('revision');
    t.dropColumn('side');
    t.dropColumn('map');
  });
};
