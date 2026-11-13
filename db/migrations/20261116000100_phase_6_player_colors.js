// Phase 6 (additive): in-game player colours per tactic,
// [{ user_id | slot, color: 'orange' | 'green' | 'blue' | 'yellow' | 'purple' }].
// Existing tactics start with none and fall back to the derived colours.
exports.up = async function (knex) {
  await knex.schema.alterTable('tactics', (t) => {
    t.jsonb('player_colors').notNullable().defaultTo('[]');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('tactics', (t) => {
    t.dropColumn('player_colors');
  });
};
