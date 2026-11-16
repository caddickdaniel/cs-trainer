// Phase 11: Replay Inspector captures. One row per requested capture of a
// demo event (a kill's killer/victim POV, or a throw's clip and lineup),
// queued for the capture worker and cached on disk once made.
exports.up = async function (knex) {
  await knex.schema.createTable('demo_captures', (t) => {
    t.increments('capture_id').primary();
    t.integer('demo_id').notNullable().references('demo_id').inTable('demos').onDelete('CASCADE');
    t.integer('round_number').notNullable();
    t.integer('event_index').notNullable();
    t.string('kind', 16).notNullable(); // kill | utility
    t.integer('capture_version').notNullable();
    t.string('status', 16).notNullable().defaultTo('queued'); // queued | running | ready | failed
    t.string('error_code', 32);
    t.text('error');
    t.jsonb('media').notNullable().defaultTo('[]');
    t.integer('attempts').notNullable().defaultTo(0);
    t.integer('requested_by').references('user_id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['demo_id', 'round_number', 'event_index', 'kind', 'capture_version']);
    t.index(['status', 'capture_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('demo_captures');
};
