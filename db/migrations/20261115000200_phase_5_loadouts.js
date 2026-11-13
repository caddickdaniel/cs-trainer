// Phase 5 (additive): per-player buy lists and the bomb carrier on tactics,
// and utility markers as Demo Review annotations.
//
// The team-wide grenade / molly / flash / smoke totals are left as stored.
// A buy list is only filled in for an existing tactic when its board already
// assigns utility markers to players (each player buys what they're assigned
// to throw, within CS2's carry limits); other tactics keep an empty list.
const { loadoutsFromThrows } = require('../../domain/utility');

exports.up = async function (knex) {
  await knex.schema.alterTable('tactics', (t) => {
    // [{ user_id | slot, smoke, flash, molly, he, kit }]
    t.jsonb('loadouts').notNullable().defaultTo('[]');
    // { user_id | slot } on T tactics.
    t.jsonb('bomb_carrier');
  });

  const tactics = await knex('tactics').whereNotNull('team_id').pluck('tactic_id');
  for (const tacticId of tactics) {
    const phases = await knex('tactic_phases').where('tactic_id', tacticId).orderBy('position').select('board');
    const loadouts = loadoutsFromThrows(phases.map((p) => ({ board: { markers: (p.board && p.board.markers) || [] } })));
    if (loadouts.length) await knex('tactics').where('tactic_id', tacticId).update({ loadouts: JSON.stringify(loadouts) });
  }

  await knex.raw('ALTER TABLE demo_annotations DROP CONSTRAINT demo_annotations_kind_check');
  await knex.raw(`ALTER TABLE demo_annotations ADD CONSTRAINT demo_annotations_kind_check
    CHECK (kind IN ('drawing', 'text', 'utility'))`);
};

exports.down = async function (knex) {
  await knex('demo_annotations').where('kind', 'utility').del();
  await knex.raw('ALTER TABLE demo_annotations DROP CONSTRAINT demo_annotations_kind_check');
  await knex.raw(`ALTER TABLE demo_annotations ADD CONSTRAINT demo_annotations_kind_check
    CHECK (kind IN ('drawing', 'text'))`);
  await knex.schema.alterTable('tactics', (t) => {
    t.dropColumn('loadouts');
    t.dropColumn('bomb_carrier');
  });
};
