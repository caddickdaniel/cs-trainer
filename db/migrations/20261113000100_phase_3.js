// Phase 3 (additive): player slots for shared tactics, the community tactic
// library (published snapshots, images and votes), Demo Review (demo library,
// parsed rounds, annotations and live review sessions) and the Demo Review
// calendar event type. Board additions (holds, note sizes) live inside the
// existing board jsonb and need no schema change; older boards load with
// defaults.

exports.up = async function (knex) {
  // ---- Player slots ------------------------------------------------------------
  // Imported tactics refer to "Player 1-5" until the team maps the slots to its
  // roster, so an assignment may belong to a slot instead of a user.
  await knex.raw('ALTER TABLE phase_assignments ALTER COLUMN user_id DROP NOT NULL');
  await knex.schema.alterTable('phase_assignments', (t) => {
    t.smallint('slot');
  });
  await knex.raw(`ALTER TABLE phase_assignments
    ADD CONSTRAINT phase_assignments_slot_check CHECK (slot IS NULL OR slot BETWEEN 1 AND 5),
    ADD CONSTRAINT phase_assignments_owner_check CHECK (user_id IS NOT NULL OR slot IS NOT NULL)`);
  await knex.raw(`CREATE UNIQUE INDEX phase_assignments_one_slot
    ON phase_assignments (phase_id, slot) WHERE user_id IS NULL`);

  // ---- Shared tactics ------------------------------------------------------------
  // A listing is a snapshot: editing the team's private tactic never changes it.
  // The snapshot holds no user ids, names, team identity or private URLs.
  await knex.schema.createTable('shared_tactics', (t) => {
    t.increments('share_id').primary();
    t.integer('source_team_id').notNullable().references('team_id').inTable('teams').onDelete('CASCADE');
    t.integer('source_tactic_id').references('tactic_id').inTable('tactics').onDelete('SET NULL');
    t.integer('published_by').references('user_id').inTable('users').onDelete('SET NULL');
    t.string('tactic_name', 60).notNullable();
    t.string('map', 40).notNullable();
    t.string('side', 2).notNullable();
    t.string('economy', 40).notNullable();
    t.integer('phase_count').notNullable();
    t.integer('source_revision').notNullable();
    t.jsonb('snapshot').notNullable();
    t.integer('import_count').notNullable().defaultTo(0);
    t.timestamp('published_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('withdrawn_at');
    t.index(['map', 'side']);
  });
  await knex.raw(`CREATE UNIQUE INDEX shared_tactics_one_listing
    ON shared_tactics (source_tactic_id) WHERE withdrawn_at IS NULL`);

  // Lineup screenshots copied into a listing (never a team's private image).
  await knex.schema.createTable('shared_tactic_images', (t) => {
    t.uuid('image_id').primary();
    t.integer('share_id').notNullable().references('share_id').inTable('shared_tactics').onDelete('CASCADE');
    t.string('content_type', 40).notNullable();
    t.integer('byte_size').notNullable();
    t.integer('width').notNullable();
    t.integer('height').notNullable();
    t.string('sha256', 64).notNullable();
    t.binary('data').notNullable();
    t.index('share_id');
  });

  // One vote per user per listing; the score is always derived from these rows.
  await knex.schema.createTable('shared_tactic_votes', (t) => {
    t.integer('share_id').notNullable().references('share_id').inTable('shared_tactics').onDelete('CASCADE');
    t.integer('user_id').notNullable().references('user_id').inTable('users').onDelete('CASCADE');
    t.smallint('value').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['share_id', 'user_id']);
  });
  await knex.raw('ALTER TABLE shared_tactic_votes ADD CONSTRAINT shared_tactic_votes_value_check CHECK (value IN (-1, 1))');

  await knex.schema.alterTable('tactics', (t) => {
    t.integer('imported_from_share_id').references('share_id').inTable('shared_tactics').onDelete('SET NULL');
  });

  // ---- Demo Review -----------------------------------------------------------------
  await knex.schema.createTable('demos', (t) => {
    t.increments('demo_id').primary();
    t.integer('team_id').notNullable().references('team_id').inTable('teams').onDelete('CASCADE');
    t.integer('uploaded_by').references('user_id').inTable('users').onDelete('SET NULL');
    t.string('title', 120).notNullable();
    t.string('original_name', 255).notNullable();
    t.bigInteger('byte_size').notNullable();
    t.string('sha256', 64).notNullable();
    // File name inside DEMO_STORAGE_DIR (the upload itself is kept on disk).
    t.string('storage_key', 80).notNullable();
    t.string('status', 12).notNullable().defaultTo('queued'); // queued | processing | ready | failed
    t.string('error_code', 40);
    t.text('error_message');
    t.integer('attempts').notNullable().defaultTo(0);
    t.string('map', 40);
    t.integer('tickrate');
    t.integer('round_count');
    // Players, scores and parser details (no Steam ids are exposed by the API).
    t.jsonb('meta').notNullable().defaultTo('{}');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('processing_started_at');
    t.timestamp('processed_at');
    t.unique(['team_id', 'sha256']);
    t.index(['status', 'created_at']);
  });
  await knex.raw(`ALTER TABLE demos ADD CONSTRAINT demos_status_check
    CHECK (status IN ('queued', 'processing', 'ready', 'failed'))`);

  // Parsed replay data per round (gzip-compressed JSON).
  await knex.schema.createTable('demo_rounds', (t) => {
    t.integer('demo_id').notNullable().references('demo_id').inTable('demos').onDelete('CASCADE');
    t.integer('round_number').notNullable();
    t.integer('start_tick').notNullable();
    t.integer('freeze_end_tick');
    t.integer('end_tick').notNullable();
    t.string('winner', 2);
    t.string('reason', 40);
    t.integer('ct_score');
    t.integer('t_score');
    t.binary('data').notNullable();
    t.primary(['demo_id', 'round_number']);
  });

  // Live team review of one demo; independent of Game Mode sessions.
  await knex.schema.createTable('review_sessions', (t) => {
    t.increments('review_id').primary();
    t.integer('team_id').notNullable().references('team_id').inTable('teams').onDelete('CASCADE');
    t.integer('demo_id').notNullable().references('demo_id').inTable('demos').onDelete('CASCADE');
    t.string('status', 10).notNullable().defaultTo('active'); // active | ended
    t.integer('round_number').notNullable();
    t.boolean('playing').notNullable().defaultTo(false);
    // Playback position = anchor_tick (+ elapsed since anchor_at while playing).
    t.double('anchor_tick').notNullable();
    t.timestamp('anchor_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.double('speed').notNullable().defaultTo(1);
    t.integer('version').notNullable().defaultTo(1);
    t.integer('started_by').references('user_id').inTable('users').onDelete('SET NULL');
    t.integer('ended_by').references('user_id').inTable('users').onDelete('SET NULL');
    t.timestamp('started_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('ended_at');
  });
  await knex.raw(`ALTER TABLE review_sessions ADD CONSTRAINT review_sessions_status_check
    CHECK (status IN ('active', 'ended'))`);
  await knex.raw(`CREATE UNIQUE INDEX review_sessions_one_active_per_team
    ON review_sessions (team_id) WHERE status = 'active'`);

  // Drawings and text tied to a round and playback position. review_id is set
  // for drawings made during a live review (cleared by the IGL), null otherwise.
  await knex.schema.createTable('demo_annotations', (t) => {
    t.increments('annotation_id').primary();
    t.integer('demo_id').notNullable().references('demo_id').inTable('demos').onDelete('CASCADE');
    t.integer('review_id').references('review_id').inTable('review_sessions').onDelete('CASCADE');
    t.integer('author_id').references('user_id').inTable('users').onDelete('SET NULL');
    t.integer('round_number').notNullable();
    t.integer('tick').notNullable();
    t.string('level', 10).notNullable().defaultTo('main');
    t.string('kind', 10).notNullable(); // drawing | text
    t.jsonb('data').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['demo_id', 'round_number']);
  });
  await knex.raw(`ALTER TABLE demo_annotations ADD CONSTRAINT demo_annotations_kind_check
    CHECK (kind IN ('drawing', 'text'))`);

  // ---- Calendar: Demo Review events, optionally linked to a demo ----------------
  await knex.raw('ALTER TABLE team_events DROP CONSTRAINT IF EXISTS team_events_kind_check');
  await knex.raw('ALTER TABLE team_events ALTER COLUMN kind TYPE varchar(20)');
  await knex.raw(`ALTER TABLE team_events ADD CONSTRAINT team_events_kind_check
    CHECK (kind IN ('training', 'game', 'demo_review'))`);
  await knex.schema.alterTable('team_events', (t) => {
    t.integer('demo_id').references('demo_id').inTable('demos').onDelete('SET NULL');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('team_events', (t) => t.dropColumn('demo_id'));
  await knex('team_events').where('kind', 'demo_review').update({ kind: 'training' });
  await knex.raw('ALTER TABLE team_events DROP CONSTRAINT IF EXISTS team_events_kind_check');
  await knex.raw(`ALTER TABLE team_events ADD CONSTRAINT team_events_kind_check CHECK (kind IN ('training', 'game'))`);
  await knex.schema.dropTableIfExists('demo_annotations');
  await knex.schema.dropTableIfExists('review_sessions');
  await knex.schema.dropTableIfExists('demo_rounds');
  await knex.schema.dropTableIfExists('demos');
  await knex.schema.alterTable('tactics', (t) => t.dropColumn('imported_from_share_id'));
  await knex.schema.dropTableIfExists('shared_tactic_votes');
  await knex.schema.dropTableIfExists('shared_tactic_images');
  await knex.schema.dropTableIfExists('shared_tactics');
  await knex.raw('DROP INDEX IF EXISTS phase_assignments_one_slot');
  await knex.raw(`ALTER TABLE phase_assignments DROP CONSTRAINT IF EXISTS phase_assignments_owner_check,
    DROP CONSTRAINT IF EXISTS phase_assignments_slot_check`);
  // Slot-only instructions cannot exist in the older schema.
  await knex('phase_assignments').whereNull('user_id').del();
  await knex.schema.alterTable('phase_assignments', (t) => t.dropColumn('slot'));
  await knex.raw('ALTER TABLE phase_assignments ALTER COLUMN user_id SET NOT NULL');
};
