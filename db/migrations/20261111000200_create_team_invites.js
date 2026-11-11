// Expiring, revocable team invites. Only a SHA-256 hash of the token is stored.
exports.up = function (knex) {
  return knex.schema.createTable('team_invites', (t) => {
    t.increments('invite_id').primary();
    t.integer('team_id').notNullable().references('team_id').inTable('teams').onDelete('CASCADE');
    t.string('token_hash', 64).notNullable().unique();
    t.integer('created_by').references('user_id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at').notNullable();
    t.timestamp('revoked_at');
    t.integer('max_uses');
    t.integer('use_count').notNullable().defaultTo(0);
    t.index('team_id');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('team_invites');
};
