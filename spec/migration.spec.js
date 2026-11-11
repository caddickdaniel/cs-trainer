// Exercises the additive migrations against legacy-shaped data, including
// conflicting and dangling records that must be surfaced for review.
const { expect } = require('chai');
const { connection } = require('./helpers');

const LEGACY_MIGRATIONS = 3;

describe('legacy data migration', () => {
  before(async () => {
    await connection.migrate.rollback(undefined, true);
    for (let i = 0; i < LEGACY_MIGRATIONS; i += 1) await connection.migrate.up();

    await connection('users').insert([
      { user_id: 1, user_name: 'Owner', team_id: 1, role: 'IGL' },
      { user_id: 2, user_name: 'Listed elsewhere', team_id: 2 },
      { user_id: 3, user_name: 'Dangling', team_id: 99 },
      { user_id: 4, user_name: 'Owner two', team_id: null },
    ]);
    await connection('teams').insert([
      { team_id: 1, team_name: 'One', owner: 1, users: [2, 77] },
      { team_id: 2, team_name: 'Two', owner: 4, users: [] },
    ]);
    const steps = [
      { user_id: 1, step: 2, desc: 'second', ref_img: 'http://img/2' },
      { user_id: 1, step: 1, desc: 'first a', ref_img: '' },
      { user_id: 1, step: 1, desc: 'first b', ref_img: '' },
      { user_id: 4, step: 1, desc: 'not a member', ref_img: '' },
    ];
    await connection('tactics').insert([
      { tactic_id: 1, tactic_name: 'Legacy', economy: 'Eco', grenade: 1, molly: 2, flash: 3, smoke: 4, team_id: 1, T: true, CT: false, steps: JSON.stringify(steps) },
      { tactic_id: 2, tactic_name: 'Both sides', economy: 'Superbuy', grenade: 0, molly: 0, flash: 0, smoke: 0, team_id: 1, T: true, CT: true, steps: '[]' },
      { tactic_id: 3, tactic_name: 'Orphan', economy: 'Eco', grenade: 0, molly: 0, flash: 0, smoke: 0, team_id: null, steps: '[]' },
    ]);
    await connection.raw("SELECT setval('users_user_id_seq', 10), setval('teams_team_id_seq', 10), setval('tactics_tactic_id_seq', 10)");
    await connection.migrate.latest();
  });

  after(() => connection.seed.run());

  const reviewKinds = async () =>
    (await connection('migration_review_items').orderBy(['kind', 'entity_ref'])).map((r) => `${r.kind}:${r.entity_ref}`);

  it('backfills memberships from users.team_id, teams.owner and teams.users', async () => {
    const rows = await connection('team_memberships').orderBy(['team_id', 'user_id']).select('team_id', 'user_id', 'is_igl', 'player_role');
    expect(rows.map((r) => `${r.team_id}:${r.user_id}`)).to.deep.equal(['1:1', '1:2', '2:2', '2:4']);
    // Legacy role text never grants access and is not copied into player_role.
    expect(rows.every((r) => r.is_igl === false && r.player_role === null)).to.equal(true);
  });

  it('records ambiguous and dangling records for review', async () => {
    expect(await reviewKinds()).to.have.members([
      'ambiguous_side:2',
      'ambiguous_side:3',
      'assignee_not_member:1:user4:step1',
      'conflicting_team_users_entry:1:2',
      'dangling_team_users_entry:1:77',
      'dangling_user_team:3',
      'duplicate_step:1:user1:step1',
      'multiple_memberships:2',
      'tactic_without_team:3',
      'unknown_economy:2',
    ]);
  });

  it('preserves legacy columns and IDs', async () => {
    const user = await connection('users').where('user_id', 3).first();
    expect(user.team_id).to.equal(99);
    expect(user.role).to.equal(null);
    expect((await connection('users').where('user_id', 1).first()).role).to.equal('IGL');
    const team = await connection('teams').where('team_id', 1).first();
    expect(team.users).to.deep.equal([2, 77]);
    const tactic = await connection('tactics').where('tactic_id', 1).first();
    expect(tactic).to.include({ grenade: 1, molly: 2, flash: 3, smoke: 4, T: true, CT: false, side: 'T', revision: 1 });
    expect(tactic.steps).to.have.length(4);
    expect((await connection('tactics').where('tactic_id', 2).first()).side).to.equal(null);
  });

  it('converts legacy steps into ordered phases with joined duplicates', async () => {
    const phases = await connection('tactic_phases').where('tactic_id', 1).orderBy('position');
    expect(phases.map((p) => p.name)).to.deep.equal(['Step 1', 'Step 2']);
    const a1 = await connection('phase_assignments').where('phase_id', phases[0].phase_id);
    expect(a1).to.have.length(1);
    expect(a1[0]).to.include({ user_id: 1, instruction: 'first a\nfirst b' });
    const a2 = await connection('phase_assignments').where('phase_id', phases[1].phase_id).first();
    expect(a2).to.include({ instruction: 'second', reference_url: 'http://img/2' });
  });

  it('enforces new foreign keys for new writes', async () => {
    let error;
    try {
      await connection('tactics').insert({ tactic_name: 'x', economy: 'Eco', grenade: 0, molly: 0, flash: 0, smoke: 0, team_id: 12345 });
    } catch (err) {
      error = err;
    }
    expect(error && error.code).to.equal('23503');
  });

  it('rolls back and re-applies cleanly', async () => {
    await connection.migrate.rollback(undefined, true);
    await connection.migrate.latest();
  });
});
