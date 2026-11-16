// Phase 8: round notes and saved annotations in Demo Review.
// - demo_round_notes: one shared notepad per demo round, saved explicitly.
// - demo_annotations.saved: new annotations start as drafts (visible to their
//   author, or to the live review they were made in) until the author saves.
//   Every existing annotation was already shared, so it stays saved.
exports.up = async function (knex) {
  await knex.schema.alterTable('demo_annotations', (t) => {
    t.boolean('saved').notNullable().defaultTo(true);
  });
  await knex.schema.createTable('demo_round_notes', (t) => {
    t.increments('note_id').primary();
    t.integer('demo_id').notNullable().references('demo_id').inTable('demos').onDelete('CASCADE');
    t.integer('round_number').notNullable();
    t.text('body').notNullable().defaultTo('');
    t.integer('version').notNullable().defaultTo(1);
    t.integer('updated_by').references('user_id').inTable('users').onDelete('SET NULL');
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['demo_id', 'round_number']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('demo_round_notes');
  await knex.schema.alterTable('demo_annotations', (t) => {
    t.dropColumn('saved');
  });
};
