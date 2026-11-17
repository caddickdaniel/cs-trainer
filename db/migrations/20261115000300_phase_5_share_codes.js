// Phase 5 (additive): demos imported from a CS2 match share code. The share
// code identifies a match; the replay is fetched later by the processing job
// through the configured replay provider. One import per match per team.
exports.up = async function (knex) {
  await knex.schema.alterTable('demos', (t) => {
    t.string('source', 12).notNullable().defaultTo('upload'); // upload | share_code
    t.string('share_code', 40);
    t.string('valve_match_id', 24);
  });
  await knex.raw(`ALTER TABLE demos ADD CONSTRAINT demos_source_check CHECK (source IN ('upload', 'share_code'))`);
  await knex.raw('CREATE UNIQUE INDEX demos_team_valve_match ON demos (team_id, valve_match_id) WHERE valve_match_id IS NOT NULL');
};

exports.down = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS demos_team_valve_match');
  await knex.schema.alterTable('demos', (t) => {
    t.dropColumn('source');
    t.dropColumn('share_code');
    t.dropColumn('valve_match_id');
  });
};
