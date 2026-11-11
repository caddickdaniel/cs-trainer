// Lineup screenshots attached to utility markers. Images are immutable once
// uploaded, which keeps Game Mode snapshots stable.
exports.up = async function (knex) {
  await knex.schema.createTable('lineup_images', (t) => {
    t.uuid('image_id').primary();
    t.integer('team_id').notNullable().references('team_id').inTable('teams').onDelete('CASCADE');
    t.integer('uploaded_by').references('user_id').inTable('users').onDelete('SET NULL');
    t.string('content_type', 40).notNullable();
    t.integer('byte_size').notNullable();
    t.integer('width').notNullable();
    t.integer('height').notNullable();
    t.string('sha256', 64).notNullable();
    t.binary('data').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['team_id', 'created_at']);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('lineup_images');
};
