// Phase 13: capture scope. A batch can be limited to one round (Capture this
// round) or to one player's kills and utility (upload player filter); the
// session records which, by the parsed player index (not the display name).
exports.up = async function (knex) {
  await knex.schema.alterTable('capture_sessions', (t) => {
    t.integer('player_index');
    t.string('player_name', 64);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('capture_sessions', (t) => {
    t.dropColumn('player_index');
    t.dropColumn('player_name');
  });
};
