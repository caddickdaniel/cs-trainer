// Game Mode sessions. The tactic is copied into `snapshot` when the session
// starts, so later edits to the saved tactic cannot change live instructions.
exports.up = async function (knex) {
  await knex.schema.createTable('game_sessions', (t) => {
    t.increments('session_id').primary();
    t.integer('team_id').notNullable().references('team_id').inTable('teams').onDelete('CASCADE');
    t.integer('tactic_id').references('tactic_id').inTable('tactics').onDelete('SET NULL');
    t.integer('tactic_revision').notNullable();
    t.jsonb('snapshot').notNullable();
    t.integer('phase_count').notNullable();
    t.integer('current_phase').notNullable().defaultTo(0);
    t.string('status', 10).notNullable().defaultTo('active');
    // Incremented on every state change; clients send it back for optimistic concurrency.
    t.integer('version').notNullable().defaultTo(1);
    t.integer('started_by').references('user_id').inTable('users').onDelete('SET NULL');
    t.integer('ended_by').references('user_id').inTable('users').onDelete('SET NULL');
    t.timestamp('started_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('ended_at');
    t.index(['team_id', 'started_at']);
  });
  await knex.raw(`ALTER TABLE game_sessions
    ADD CONSTRAINT game_sessions_status_check CHECK (status IN ('active', 'ended')),
    ADD CONSTRAINT game_sessions_phase_check CHECK (phase_count > 0 AND current_phase >= 0 AND current_phase < phase_count)`);
  // At most one active session per team.
  await knex.raw(`CREATE UNIQUE INDEX game_sessions_one_active_per_team
    ON game_sessions (team_id) WHERE status = 'active'`);
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('game_sessions');
};
