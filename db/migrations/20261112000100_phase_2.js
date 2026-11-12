// Phase 2 (additive): profiles and pictures, recruiting, player-specific
// invites and join requests, IGL as a roster role, training calendar,
// notifications, per-user settings and Game Mode rounds.
const ROLES = ['entry', 'support', 'lurker', 'awper', 'anchor', 'rifler', 'igl'];

async function review(knex, kind, entity, ref, detail) {
  await knex('migration_review_items')
    .insert({ kind, entity, entity_ref: String(ref), detail })
    .onConflict(['kind', 'entity', 'entity_ref'])
    .ignore();
}

exports.up = async function (knex) {
  // Pictures for profiles and teams. These are discovery information, so any
  // signed-in user may fetch them (lineup screenshots stay team-private).
  await knex.schema.createTable('public_images', (t) => {
    t.uuid('image_id').primary();
    t.integer('uploaded_by').references('user_id').inTable('users').onDelete('SET NULL');
    t.string('purpose', 20).notNullable(); // avatar | team_logo
    t.string('content_type', 40).notNullable();
    t.integer('byte_size').notNullable();
    t.integer('width').notNullable();
    t.integer('height').notNullable();
    t.string('sha256', 64).notNullable();
    t.binary('data').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('users', (t) => {
    t.uuid('avatar_image_id').references('image_id').inTable('public_images').onDelete('SET NULL');
    t.string('steam_url', 300);
    t.string('faceit_url', 300);
    t.string('esea_url', 300);
    t.string('hltv_url', 300);
    // Per-user preferences, e.g. { shortcuts: { phase_next: 'ArrowRight', ... } }.
    t.jsonb('settings').notNullable().defaultTo('{}');
  });

  await knex.schema.alterTable('teams', (t) => {
    t.uuid('logo_image_id').references('image_id').inTable('public_images').onDelete('SET NULL');
    t.boolean('is_recruiting').notNullable().defaultTo(false);
    t.string('recruiting_leagues', 300);
    t.specificType('roles_needed', 'text[]').notNullable().defaultTo('{}');
    t.text('recruiting_notes');
  });

  // ---- IGL as a roster role -------------------------------------------------
  // is_igl is kept as a column for existing callers but must always equal
  // (player_role = 'igl'), and a team has at most one IGL.
  const rows = await knex('team_memberships as m')
    .join('teams as t', 't.team_id', 'm.team_id')
    .select('m.membership_id', 'm.team_id', 'm.user_id', 'm.is_igl', 'm.player_role', 't.owner')
    .orderBy([{ column: 'm.team_id' }, { column: 'm.joined_at' }, { column: 'm.membership_id' }]);
  const byTeam = new Map();
  rows.forEach((r) => {
    if (!byTeam.has(r.team_id)) byTeam.set(r.team_id, []);
    byTeam.get(r.team_id).push(r);
  });
  for (const [teamId, members] of byTeam) {
    // Unknown legacy role values are cleared (and reported) so the role enum holds.
    for (const m of members) {
      if (m.player_role && !ROLES.includes(m.player_role)) {
        await review(knex, 'unknown_player_role', 'membership', m.membership_id,
          `player_role "${m.player_role}" is not a known role; cleared`);
        m.player_role = null;
        await knex('team_memberships').where('membership_id', m.membership_id).update({ player_role: null });
      }
    }
    const flagged = members.filter((m) => m.is_igl || m.player_role === 'igl');
    let igl = flagged[0] || null;
    if (flagged.length > 1) {
      await review(knex, 'multiple_igls', 'team', teamId,
        `${flagged.length} members had IGL access; user ${igl.user_id} (earliest) kept it`);
    }
    if (!igl) {
      // Owners controlled Game Mode before; keep that when it costs no role.
      const owner = members.find((m) => m.user_id === m.owner);
      if (owner && !owner.player_role) igl = owner;
      else {
        await review(knex, 'team_without_igl', 'team', teamId,
          'no IGL could be assigned without overwriting a role; the owner should assign one on the Team page');
      }
    }
    if (igl && igl.player_role && igl.player_role !== 'igl') {
      await review(knex, 'role_replaced_by_igl', 'membership', igl.membership_id,
        `player_role "${igl.player_role}" replaced by "igl" because this player held IGL access`);
    }
    for (const m of members) {
      const isIgl = Boolean(igl && m.membership_id === igl.membership_id);
      await knex('team_memberships').where('membership_id', m.membership_id).update({
        is_igl: isIgl,
        player_role: isIgl ? 'igl' : (m.player_role === 'igl' ? null : m.player_role),
      });
    }
  }
  await knex.raw(`ALTER TABLE team_memberships
    ADD CONSTRAINT team_memberships_role_check CHECK (player_role IS NULL OR player_role IN (${ROLES.map((r) => `'${r}'`).join(', ')})),
    ADD CONSTRAINT team_memberships_igl_sync CHECK (is_igl = (player_role IS NOT DISTINCT FROM 'igl'))`);
  await knex.raw(`CREATE UNIQUE INDEX team_memberships_one_igl ON team_memberships (team_id) WHERE player_role = 'igl'`);

  // ---- Player-specific invites and join requests -----------------------------
  await knex.raw('ALTER TABLE team_invites ALTER COLUMN token_hash DROP NOT NULL');
  await knex.schema.alterTable('team_invites', (t) => {
    t.integer('invitee_user_id').references('user_id').inTable('users').onDelete('CASCADE');
    t.string('response', 10); // accepted | declined
    t.timestamp('responded_at');
    t.integer('join_request_id');
  });
  await knex.raw(`ALTER TABLE team_invites ADD CONSTRAINT team_invites_kind_check
    CHECK ((invitee_user_id IS NULL) <> (token_hash IS NULL))`);
  await knex.raw(`CREATE UNIQUE INDEX team_invites_one_pending_per_player
    ON team_invites (team_id, invitee_user_id)
    WHERE invitee_user_id IS NOT NULL AND response IS NULL AND revoked_at IS NULL`);

  await knex.schema.createTable('team_join_requests', (t) => {
    t.increments('request_id').primary();
    t.integer('team_id').notNullable().references('team_id').inTable('teams').onDelete('CASCADE');
    t.integer('user_id').notNullable().references('user_id').inTable('users').onDelete('CASCADE');
    t.text('message').notNullable().defaultTo('');
    t.string('status', 10).notNullable().defaultTo('pending'); // pending | invited | declined
    t.integer('resolved_by').references('user_id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('resolved_at');
    t.index('user_id');
  });
  await knex.raw(`ALTER TABLE team_join_requests ADD CONSTRAINT team_join_requests_status_check
    CHECK (status IN ('pending', 'invited', 'declined'))`);
  await knex.raw(`CREATE UNIQUE INDEX team_join_requests_one_pending
    ON team_join_requests (team_id, user_id) WHERE status = 'pending'`);

  // ---- Training calendar ------------------------------------------------------
  await knex.schema.createTable('team_events', (t) => {
    t.increments('event_id').primary();
    t.integer('team_id').notNullable().references('team_id').inTable('teams').onDelete('CASCADE');
    t.string('kind', 10).notNullable(); // training | game
    t.string('title', 80).notNullable();
    // Stored as an absolute instant (UTC); time_zone records the zone it was entered in.
    t.timestamp('starts_at', { useTz: true }).notNullable();
    t.string('time_zone', 64).notNullable();
    t.string('opponent', 80);
    t.text('notes').notNullable().defaultTo('');
    t.integer('created_by').references('user_id').inTable('users').onDelete('SET NULL');
    t.integer('updated_by').references('user_id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['team_id', 'starts_at']);
  });
  await knex.raw(`ALTER TABLE team_events ADD CONSTRAINT team_events_kind_check CHECK (kind IN ('training', 'game'))`);

  // ---- Notifications ------------------------------------------------------------
  await knex.schema.createTable('notifications', (t) => {
    t.increments('notification_id').primary();
    t.integer('user_id').notNullable().references('user_id').inTable('users').onDelete('CASCADE');
    t.string('kind', 30).notNullable();
    t.integer('team_id').references('team_id').inTable('teams').onDelete('SET NULL');
    t.integer('actor_id').references('user_id').inTable('users').onDelete('SET NULL');
    // Targets are plain ids (no FK) so a notification survives its target's deletion.
    t.string('target_type', 20);
    t.integer('target_id');
    // Display data captured at creation (titles, names, times).
    t.jsonb('payload').notNullable().defaultTo('{}');
    // Retried actions produce the same key and are ignored.
    t.string('dedupe_key', 120).notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('read_at');
    t.timestamp('dismissed_at');
    t.unique(['user_id', 'dedupe_key']);
    t.index(['user_id', 'created_at']);
  });

  // ---- Game Mode matches and rounds ------------------------------------------
  // A session is now a match: the IGL picks map and side, browses that side's
  // tactics (selected_tactic_id) and starts rounds; each round snapshots the
  // selected tactic.
  await knex.schema.alterTable('game_sessions', (t) => {
    t.string('map', 40);
    t.string('side', 2);
    t.integer('selected_tactic_id').references('tactic_id').inTable('tactics').onDelete('SET NULL');
    t.integer('round_number').notNullable().defaultTo(1);
  });
  await knex.raw(`UPDATE game_sessions SET map = snapshot->'tactic'->>'map', side = snapshot->'tactic'->>'side',
    selected_tactic_id = tactic_id`);
};

exports.down = async function (knex) {
  await knex.schema.alterTable('game_sessions', (t) => {
    t.dropColumn('round_number');
    t.dropColumn('selected_tactic_id');
    t.dropColumn('side');
    t.dropColumn('map');
  });
  await knex.schema.dropTableIfExists('notifications');
  await knex.schema.dropTableIfExists('team_events');
  await knex.schema.dropTableIfExists('team_join_requests');
  await knex.raw('DROP INDEX IF EXISTS team_invites_one_pending_per_player');
  await knex.raw('ALTER TABLE team_invites DROP CONSTRAINT IF EXISTS team_invites_kind_check');
  await knex('team_invites').whereNull('token_hash').del();
  await knex.schema.alterTable('team_invites', (t) => {
    t.dropColumn('join_request_id');
    t.dropColumn('responded_at');
    t.dropColumn('response');
    t.dropColumn('invitee_user_id');
  });
  await knex.raw('ALTER TABLE team_invites ALTER COLUMN token_hash SET NOT NULL');
  await knex.raw('DROP INDEX IF EXISTS team_memberships_one_igl');
  await knex.raw(`ALTER TABLE team_memberships DROP CONSTRAINT IF EXISTS team_memberships_igl_sync,
    DROP CONSTRAINT IF EXISTS team_memberships_role_check`);
  await knex.schema.alterTable('teams', (t) => {
    t.dropColumn('recruiting_notes');
    t.dropColumn('roles_needed');
    t.dropColumn('recruiting_leagues');
    t.dropColumn('is_recruiting');
    t.dropColumn('logo_image_id');
  });
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('settings');
    t.dropColumn('hltv_url');
    t.dropColumn('esea_url');
    t.dropColumn('faceit_url');
    t.dropColumn('steam_url');
    t.dropColumn('avatar_image_id');
  });
  await knex.schema.dropTableIfExists('public_images');
};
