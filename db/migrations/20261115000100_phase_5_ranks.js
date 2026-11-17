// Phase 5 (additive): one optional self-reported rank per platform for
// players, and multiple rank requirements plus catalogue competitions for
// recruiting teams.
//
// Existing data is kept:
// - users.rank_platform / rank_id (Phase 4) are copied into the matching
//   per-platform column. A platform chosen without a rank can't be mapped, so
//   its label is kept as legacy text for the player to review.
// - Free-text users.platform / skill_level stay as legacy values; they are
//   mapped into a rank column only when the mapping is unambiguous.
// - teams.platform / skill_level become one requirement when they map
//   reliably; the text itself is left in place (legacy endpoints use it).
// - teams.recruiting_leagues (free text) is kept until the owner edits the
//   competitions, then cleared by the API.
const C = require('../../domain/catalogue');

const RANK_COLUMNS = { premier: 'premier_rank', faceit: 'faceit_rank', esea: 'esea_rank' };

exports.up = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    t.string('premier_rank', 30);
    t.string('faceit_rank', 30);
    t.string('esea_rank', 30);
  });
  await knex.raw(`ALTER TABLE users
    ADD CONSTRAINT users_premier_rank_check CHECK (premier_rank IS NULL OR premier_rank LIKE 'premier:%'),
    ADD CONSTRAINT users_faceit_rank_check CHECK (faceit_rank IS NULL OR faceit_rank LIKE 'faceit:%'),
    ADD CONSTRAINT users_esea_rank_check CHECK (esea_rank IS NULL OR esea_rank LIKE 'esea:%')`);

  const users = await knex('users').select('user_id', 'rank_platform', 'rank_id', 'platform', 'skill_level');
  for (const u of users) {
    const changes = {};
    if (u.rank_id && C.isValidRank(u.rank_platform, u.rank_id)) {
      changes[RANK_COLUMNS[u.rank_platform]] = u.rank_id;
    } else if (u.rank_platform && !u.platform) {
      // Platform without a rank: keep it visible as legacy text.
      changes.platform = C.PLATFORMS.find((p) => p.id === u.rank_platform).label;
    } else if (u.platform) {
      const mapped = C.mapLegacyRank(u.platform, u.skill_level);
      if (mapped && mapped.rank) {
        changes[RANK_COLUMNS[mapped.platform]] = mapped.rank;
        changes.platform = null;
        changes.skill_level = null;
      }
    }
    if (Object.keys(changes).length) await knex('users').where('user_id', u.user_id).update(changes);
  }

  await knex.schema.alterTable('teams', (t) => {
    // [{ platform, min, max }] with min/max rank ids on that platform (min = max: an exact band).
    t.jsonb('rank_requirements').notNullable().defaultTo('[]');
    // Catalogue ids of leagues / matchmaking the team plans to play.
    t.specificType('competitions', 'text[]').notNullable().defaultTo('{}');
  });
  const teams = await knex('teams').whereNotNull('platform').select('team_id', 'platform', 'skill_level');
  for (const t of teams) {
    const mapped = C.mapLegacyRank(t.platform, t.skill_level);
    if (mapped && mapped.rank) {
      await knex('teams').where('team_id', t.team_id)
        .update({ rank_requirements: JSON.stringify([{ platform: mapped.platform, min: mapped.rank, max: mapped.rank }]) });
    }
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable('teams', (t) => {
    t.dropColumn('rank_requirements');
    t.dropColumn('competitions');
  });
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('premier_rank');
    t.dropColumn('faceit_rank');
    t.dropColumn('esea_rank');
  });
};
