// Phase 6: version of the replay data stored in demo_rounds. Existing demos
// are version 1 (positions, kills, plants/defusals); the demo worker
// re-parses ready demos below the current version (2: recorded utility) in
// the background and replaces each round's data in place, so annotations and
// reviews are kept. `npm run demos:reprocess` does the same on demand.
exports.up = async function (knex) {
  await knex.schema.alterTable('demos', (t) => {
    t.integer('replay_version').notNullable().defaultTo(1);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('demos', (t) => {
    t.dropColumn('replay_version');
  });
};
