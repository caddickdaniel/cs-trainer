// Idempotent backfills that map the legacy data model (users.team_id,
// teams.users[], tactics.T/CT and tactics.steps) onto the relational tables
// added for milestone 1. Used by the migrations and by the seeds so that seeded
// data goes through exactly the same path as existing databases.
//
// Nothing here modifies or deletes legacy columns. Records that cannot be
// mapped unambiguously are written to migration_review_items for review
// (`npm run db:review`).
//
// These functions are referenced by migrations: change their behaviour only
// with a new migration in mind.

async function review(knex, kind, entity, entityRef, detail) {
  await knex('migration_review_items')
    .insert({ kind, entity, entity_ref: String(entityRef), detail })
    .onConflict(['kind', 'entity', 'entity_ref'])
    .ignore();
}

async function addMembership(knex, teamId, userId) {
  await knex('team_memberships')
    .insert({ team_id: teamId, user_id: userId })
    .onConflict(['team_id', 'user_id'])
    .ignore();
}

async function backfillMemberships(knex) {
  const teams = await knex('teams').select('team_id', 'owner', 'users').orderBy('team_id');
  const teamIds = new Set(teams.map((t) => t.team_id));
  const users = await knex('users').select('user_id', 'team_id').orderBy('user_id');
  const userTeam = new Map(users.map((u) => [u.user_id, u.team_id]));

  // 1. users.team_id is the primary legacy association.
  for (const user of users) {
    if (user.team_id == null) continue;
    if (teamIds.has(user.team_id)) {
      await addMembership(knex, user.team_id, user.user_id);
    } else {
      await review(knex, 'dangling_user_team', 'user', user.user_id,
        `users.team_id=${user.team_id} references a team that does not exist; no membership created`);
    }
  }

  for (const team of teams) {
    // 2. Every owner is a member of the team they own.
    await addMembership(knex, team.team_id, team.owner);

    // 3. teams.users[] is a secondary, denormalised association.
    for (const userId of team.users || []) {
      if (!userTeam.has(userId)) {
        await review(knex, 'dangling_team_users_entry', 'team', `${team.team_id}:${userId}`,
          `teams.users contains user ${userId}, who does not exist; ignored`);
        continue;
      }
      await addMembership(knex, team.team_id, userId);
      const legacyTeam = userTeam.get(userId);
      if (legacyTeam !== team.team_id) {
        await review(knex, 'conflicting_team_users_entry', 'team', `${team.team_id}:${userId}`,
          `teams.users lists user ${userId} but users.team_id=${legacyTeam ?? 'null'}; membership created in both`);
      }
    }
  }

  // 4. Users who end up in more than one team: the UI shows one active team
  //    (users.team_id when it is a membership, otherwise the earliest membership).
  const multi = await knex('team_memberships')
    .select('user_id')
    .count('* as teams')
    .groupBy('user_id')
    .havingRaw('count(*) > 1')
    .orderBy('user_id');
  for (const row of multi) {
    const teamsOf = await knex('team_memberships').where('user_id', row.user_id).pluck('team_id');
    await review(knex, 'multiple_memberships', 'user', row.user_id,
      `member of teams ${teamsOf.sort((a, b) => a - b).join(', ')}; active team is users.team_id=${userTeam.get(row.user_id) ?? 'null'}`);
  }
}

const KNOWN_ECONOMIES = ['Pistol', 'Eco', 'Force', 'Halfbuy', 'Fullbuy'];

async function backfillTacticMetadata(knex) {
  const tactics = await knex('tactics').select('tactic_id', 'T', 'CT', 'economy', 'team_id', 'side').orderBy('tactic_id');
  const teamIds = new Set(await knex('teams').pluck('team_id'));
  for (const tactic of tactics) {
    if (tactic.side == null) {
      if (tactic.T && !tactic.CT) await knex('tactics').where('tactic_id', tactic.tactic_id).update({ side: 'T' });
      else if (tactic.CT && !tactic.T) await knex('tactics').where('tactic_id', tactic.tactic_id).update({ side: 'CT' });
      else {
        await review(knex, 'ambiguous_side', 'tactic', tactic.tactic_id,
          `legacy T=${tactic.T} CT=${tactic.CT}; side left empty until edited`);
      }
    }
    if (!KNOWN_ECONOMIES.includes(tactic.economy)) {
      await review(knex, 'unknown_economy', 'tactic', tactic.tactic_id,
        `economy "${tactic.economy}" is not one of ${KNOWN_ECONOMIES.join('/')}; kept as-is`);
    }
    if (tactic.team_id == null) {
      await review(knex, 'tactic_without_team', 'tactic', tactic.tactic_id,
        'tactic has no team_id, so no team member can access it');
    } else if (!teamIds.has(tactic.team_id)) {
      await review(knex, 'dangling_tactic_team', 'tactic', tactic.tactic_id,
        `tactics.team_id=${tactic.team_id} references a team that does not exist`);
    }
  }
}

// Converts legacy steps [{ user_id, step, desc, ref_img }] into ordered phases
// ("Step N") with one assignment per player. Only tactics that have no phases
// yet are converted. The legacy steps column is left untouched.
async function backfillPhasesFromSteps(knex) {
  const tactics = await knex('tactics')
    .select('tactic_id', 'team_id', 'steps')
    .whereNotExists(knex('tactic_phases').whereRaw('tactic_phases.tactic_id = tactics.tactic_id'))
    .orderBy('tactic_id');

  for (const tactic of tactics) {
    const steps = Array.isArray(tactic.steps) ? tactic.steps : [];
    if (!steps.length) continue;
    const members = new Set(
      tactic.team_id == null
        ? []
        : await knex('team_memberships').where('team_id', tactic.team_id).pluck('user_id')
    );

    const byStep = new Map();
    for (const step of steps) {
      const n = Number(step && step.step);
      if (!Number.isInteger(n)) {
        await review(knex, 'invalid_step', 'tactic', `${tactic.tactic_id}:${JSON.stringify(step).slice(0, 80)}`,
          'legacy step has no integer step number; skipped');
        continue;
      }
      if (!byStep.has(n)) byStep.set(n, []);
      byStep.get(n).push(step);
    }

    const ordered = [...byStep.keys()].sort((a, b) => a - b);
    let skippedRefs = false;
    for (let position = 0; position < ordered.length; position += 1) {
      const n = ordered[position];
      const [phase] = await knex('tactic_phases')
        .insert({ tactic_id: tactic.tactic_id, position, name: `Step ${n}` })
        .returning('phase_id');
      const byUser = new Map();
      for (const step of byStep.get(n)) {
        const userId = Number(step.user_id);
        if (!members.has(userId)) {
          await review(knex, 'assignee_not_member', 'tactic', `${tactic.tactic_id}:user${step.user_id}:step${n}`,
            `user ${step.user_id} is not a member of team ${tactic.team_id}; step not converted (still in tactics.steps)`);
          continue;
        }
        if (byUser.has(userId)) {
          await review(knex, 'duplicate_step', 'tactic', `${tactic.tactic_id}:user${userId}:step${n}`,
            `user ${userId} has several entries for step ${n}; descriptions were joined`);
        }
        const existing = byUser.get(userId) || { instruction: [], reference_url: null };
        if (step.desc) existing.instruction.push(String(step.desc));
        const ref = step.ref_img ? String(step.ref_img).trim() : '';
        // Only http(s) URLs become links; anything else stays in tactics.steps.
        if (!existing.reference_url && /^https?:\/\//i.test(ref) && ref.length <= 500) {
          existing.reference_url = ref;
        } else if (ref && !/^https?:\/\//i.test(ref)) {
          skippedRefs = true;
        }
        byUser.set(userId, existing);
      }
      for (const [userId, value] of byUser) {
        await knex('phase_assignments').insert({
          phase_id: phase.phase_id,
          user_id: userId,
          instruction: value.instruction.join('\n'),
          utility: '',
          reference_url: value.reference_url,
        });
      }
    }
    if (skippedRefs) {
      await review(knex, 'reference_not_url', 'tactic', tactic.tactic_id,
        'some ref_img values are not http(s) URLs; they were not converted (still in tactics.steps)');
    }
  }
}

module.exports = {
  backfillMemberships,
  backfillTacticMetadata,
  backfillPhasesFromSteps,
};
