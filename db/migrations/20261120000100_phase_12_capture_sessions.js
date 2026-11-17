// Phase 12: capture sessions. One session is one run of CS2 for a demo: a
// batch queued from an upload, a single (re)capture, or opening a round to
// watch. Existing captures and their cached files are kept as they are.
exports.up = async function (knex) {
  await knex.schema.createTable('capture_sessions', (t) => {
    t.increments('session_id').primary();
    t.integer('demo_id').notNullable().references('demo_id').inTable('demos').onDelete('CASCADE');
    t.integer('requested_by').references('user_id').inTable('users').onDelete('SET NULL');
    t.string('mode', 12).notNullable(); // batch | single | watch
    t.string('selection', 12); // all | kill | utility (batches)
    t.integer('round_number'); // watch
    t.string('status', 16).notNullable().defaultTo('queued'); // queued | running | done | failed
    t.text('stage');
    t.integer('total').notNullable().defaultTo(0);
    t.integer('completed').notNullable().defaultTo(0);
    t.integer('failed').notNullable().defaultTo(0);
    t.string('error_code', 32);
    t.text('error');
    t.jsonb('timings').notNullable().defaultTo('{}');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('started_at');
    t.timestamp('finished_at');
    t.index(['status', 'session_id']);
    t.index(['requested_by', 'session_id']);
  });
  await knex.schema.alterTable('demo_captures', (t) => {
    t.integer('session_id').references('session_id').inTable('capture_sessions').onDelete('SET NULL');
    // Media from a successful attempt lives in <capture>/<attempt>/; Phase 11
    // captures (attempt 0) stay in <capture>/.
    t.integer('attempt').notNullable().defaultTo(0);
    t.integer('moment_tick');
    t.jsonb('timings').notNullable().defaultTo('{}');
  });
  await knex.schema.alterTable('demos', (t) => {
    // Upload option: capture these events once parsing succeeds.
    t.string('capture_selection', 12);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('demos', (t) => { t.dropColumn('capture_selection'); });
  await knex.schema.alterTable('demo_captures', (t) => {
    t.dropColumn('session_id');
    t.dropColumn('attempt');
    t.dropColumn('moment_tick');
    t.dropColumn('timings');
  });
  await knex.schema.dropTableIfExists('capture_sessions');
};
