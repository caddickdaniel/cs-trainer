// Phase 4 (additive): catalogue-based recruitment ranks, Steam identities,
// match statistics (demo and FACEIT sources) and provider connections.
//
// Legacy free-text platform / skill_level / language / region values are kept.
// Ranks are filled in only where the legacy text maps confidently; language
// and region are normalised only on an exact (case-insensitive) catalogue match.
const C = require('../../domain/catalogue');

exports.up = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    // Self-reported recruitment rank from the catalogue (e.g. 'faceit', 'faceit:7').
    t.string('rank_platform', 10);
    t.string('rank_id', 30);
  });
  await knex.raw(`ALTER TABLE users
    ADD CONSTRAINT users_rank_platform_check CHECK (rank_platform IS NULL OR rank_platform IN (${C.PLATFORM_IDS.map((p) => `'${p}'`).join(', ')})),
    ADD CONSTRAINT users_rank_matches_platform CHECK (rank_id IS NULL OR (rank_platform IS NOT NULL AND split_part(rank_id, ':', 1) = rank_platform))`);

  const users = await knex('users').select('user_id', 'platform', 'skill_level', 'language', 'region');
  for (const u of users) {
    const changes = {};
    const mapped = u.platform ? C.mapLegacyRank(u.platform, u.skill_level) : null;
    if (mapped) {
      changes.rank_platform = mapped.platform;
      if (mapped.rank) changes.rank_id = mapped.rank;
    }
    const lang = u.language && C.matchOption(C.LANGUAGES, u.language);
    if (lang && lang !== u.language) changes.language = lang;
    const region = u.region && C.matchOption(C.REGIONS, u.region);
    if (region && region !== u.region) changes.region = region;
    if (Object.keys(changes).length) await knex('users').where('user_id', u.user_id).update(changes);
  }

  // Verified sign-in identities (Steam OpenID). subject = SteamID64 as a string.
  await knex.schema.createTable('user_identities', (t) => {
    t.increments('identity_id').primary();
    t.integer('user_id').notNullable().references('user_id').inTable('users').onDelete('CASCADE');
    t.string('provider', 20).notNullable();
    t.string('subject', 40).notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['provider', 'subject']);
    t.unique(['user_id', 'provider']);
  });
  await knex.raw(`ALTER TABLE user_identities ADD CONSTRAINT user_identities_steam_format
    CHECK (provider <> 'steam' OR subject ~ '^7656119[0-9]{10}$')`);

  // OpenID response nonces already accepted (replay protection).
  await knex.schema.createTable('openid_nonces', (t) => {
    t.string('nonce', 120).primary();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // A match from one source. source_key is stable per source: a fingerprint of
  // the parsed demo (map, players, round results) or the FACEIT match id.
  await knex.schema.createTable('matches', (t) => {
    t.increments('match_id').primary();
    t.string('source', 10).notNullable(); // demo | faceit
    t.string('source_key', 120).notNullable();
    t.string('map', 40);
    t.timestamp('played_at', { useTz: true });
    t.integer('rounds').notNullable().defaultTo(0);
    t.integer('score_a');
    t.integer('score_b');
    // FACEIT match id when known for a demo (e.g. from a FACEIT demo file name).
    t.string('faceit_match_id', 80);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['source', 'source_key']);
  });
  await knex.raw(`ALTER TABLE matches ADD CONSTRAINT matches_source_check CHECK (source IN ('demo', 'faceit'))`);

  // Per-player results. Matched to accounts by SteamID64 at read time, so
  // linking Steam later picks up earlier imports.
  await knex.schema.createTable('match_players', (t) => {
    t.integer('match_id').notNullable().references('match_id').inTable('matches').onDelete('CASCADE');
    t.string('steamid64', 20).notNullable();
    t.string('name', 64);
    t.string('team', 1); // A | B
    t.string('result', 1); // W | L | D
    t.integer('kills');
    t.integer('deaths');
    t.integer('assists');
    t.integer('headshot_kills');
    t.integer('damage');
    t.integer('rounds_played');
    t.primary(['match_id', 'steamid64']);
    t.index('steamid64');
  });

  // Which uploaded demos produced which match (several uploads can share one).
  await knex.schema.createTable('demo_matches', (t) => {
    t.integer('demo_id').notNullable().references('demo_id').inTable('demos').onDelete('CASCADE');
    t.integer('match_id').notNullable().references('match_id').inTable('matches').onDelete('CASCADE');
    t.primary(['demo_id']);
  });
  await knex.schema.alterTable('demos', (t) => {
    // Version of the stats extraction applied; older demos are re-parsed in the background.
    t.integer('stats_version').notNullable().defaultTo(0);
  });

  // External stat providers connected by a player (FACEIT).
  await knex.schema.createTable('provider_accounts', (t) => {
    t.increments('provider_account_id').primary();
    t.integer('user_id').notNullable().references('user_id').inTable('users').onDelete('CASCADE');
    t.string('provider', 20).notNullable();
    t.string('external_id', 80).notNullable();
    t.string('nickname', 80);
    t.integer('rating');
    t.integer('level');
    t.string('status', 20).notNullable().defaultTo('pending'); // pending | ok | error | rate_limited
    t.text('last_error');
    t.timestamp('last_synced_at', { useTz: true });
    t.timestamp('next_sync_at', { useTz: true });
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['user_id', 'provider']);
    t.unique(['provider', 'external_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('provider_accounts');
  await knex.schema.alterTable('demos', (t) => t.dropColumn('stats_version'));
  await knex.schema.dropTableIfExists('demo_matches');
  await knex.schema.dropTableIfExists('match_players');
  await knex.schema.dropTableIfExists('matches');
  await knex.schema.dropTableIfExists('openid_nonces');
  await knex.schema.dropTableIfExists('user_identities');
  await knex.raw('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_rank_matches_platform, DROP CONSTRAINT IF EXISTS users_rank_platform_check');
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('rank_id');
    t.dropColumn('rank_platform');
  });
};
