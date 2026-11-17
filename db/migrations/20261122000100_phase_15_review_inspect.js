// Phase 15: the live review shares the host's Replay Inspector selection
// (which kill, death or utility throw, and which victim or lineup tab) so
// followers and late joiners see the same event and footage. Null when the
// host has nothing selected. The radar replay's own state is unchanged.
exports.up = async function (knex) {
  await knex.schema.alterTable('review_sessions', (t) => {
    t.jsonb('inspect');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('review_sessions', (t) => {
    t.dropColumn('inspect');
  });
};
