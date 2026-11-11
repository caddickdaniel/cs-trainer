const { expect } = require('chai');
const { reseed, signIn, signUp, tacticDoc, teamWithMember } = require('./helpers');

describe('Game Mode', () => {
  beforeEach(reseed);

  async function setup() {
    const ctx = await teamWithMember();
    const ids = [ctx.owner.user.user_id, ctx.member.user.user_id];
    const doc = tacticDoc(ids);
    const { tactic } = (await ctx.owner.post(`/api/teams/${ctx.teamId}/tactics`).send(doc).expect(201)).body;
    return { ...ctx, doc, tacticId: tactic.tactic_id, url: `/api/teams/${ctx.teamId}/game-session` };
  }

  it('runs a session end to end; each player sees their own instruction', async () => {
    const { owner, member, tacticId, url } = await setup();
    expect((await member.get(url).expect(200)).body).to.include({ session: null, can_control: false });

    const started = (await owner.post(url).send({ tactic_id: tacticId }).expect(201)).body.session;
    expect(started).to.include({ current_phase: 0, phase_count: 2, version: 1, status: 'active' });
    expect(started.assignments).to.have.length(2);

    const seen = (await member.get(url).expect(200)).body.session;
    expect(seen.tactic.tactic_name).to.equal('Test Split');
    expect(seen.phase.name).to.equal('Setup');
    expect(seen.my_assignment).to.include({ user_id: member.user.user_id, instruction: 'Lurk B' });
    expect(seen).to.not.have.property('assignments');
    const ownerView = (await owner.get(url).expect(200)).body.session;
    expect(ownerView.my_assignment.instruction).to.equal('Hold mid');

    const next = (await owner.post(`/api/game-sessions/${started.session_id}/phase`)
      .send({ action: 'next', expected_version: 1 }).expect(200)).body.session;
    expect(next).to.include({ current_phase: 1, version: 2 });

    // Member has no instruction in the second phase.
    const phase2 = (await member.get(url).expect(200)).body.session;
    expect(phase2.phase.name).to.equal('Execute');
    expect(phase2.my_assignment).to.equal(null);

    await owner.post(`/api/game-sessions/${started.session_id}/phase`)
      .send({ action: 'prev', expected_version: 2 }).expect(200);
    await owner.post(`/api/game-sessions/${started.session_id}/phase`)
      .send({ action: 'goto', index: 1, expected_version: 3 }).expect(200);

    const ended = (await owner.post(`/api/game-sessions/${started.session_id}/end`).send({}).expect(200)).body.session;
    expect(ended.status).to.equal('ended');
    const after = (await member.get(url).expect(200)).body;
    expect(after.session).to.equal(null);
    expect(after.last_ended).to.include({ session_id: started.session_id, tactic_name: 'Test Split' });
    expect(after.last_ended.ended_by.user_id).to.equal(owner.user.user_id);
    // Ending twice is harmless; changing phase after the end is a conflict.
    await owner.post(`/api/game-sessions/${started.session_id}/end`).send({}).expect(200);
    const late = await owner.post(`/api/game-sessions/${started.session_id}/phase`)
      .send({ action: 'prev', expected_version: 5 }).expect(409);
    expect(late.body.code).to.equal('session_ended');
  });

  it('resumes the current phase after refresh and reconnect (new sign-in)', async () => {
    const { owner, member, tacticId, url } = await setup();
    const { session } = (await owner.post(url).send({ tactic_id: tacticId }).expect(201)).body;
    await owner.post(`/api/game-sessions/${session.session_id}/phase`).send({ action: 'next', expected_version: 1 }).expect(200);

    const reconnected = await signIn(member.user.email, { password: 'correct-horse-battery' });
    const view = (await reconnected.get(url).expect(200)).body.session;
    expect(view).to.include({ session_id: session.session_id, current_phase: 1, version: 2 });
    const direct = (await reconnected.get(`/api/game-sessions/${session.session_id}`).expect(200)).body.session;
    expect(direct.current_phase).to.equal(1);
  });

  it('ordinary members cannot start, advance or end a session; IGLs can', async () => {
    const { owner, member, teamId, tacticId, url } = await setup();
    await member.post(url).send({ tactic_id: tacticId }).expect(403);
    const { session } = (await owner.post(url).send({ tactic_id: tacticId }).expect(201)).body;
    await member.post(`/api/game-sessions/${session.session_id}/phase`).send({ action: 'next', expected_version: 1 }).expect(403);
    await member.post(`/api/game-sessions/${session.session_id}/end`).send({}).expect(403);
    await owner.patch(`/api/teams/${teamId}/members/${member.user.user_id}`).send({ is_igl: true }).expect(200);
    await member.post(`/api/game-sessions/${session.session_id}/phase`).send({ action: 'next', expected_version: 1 }).expect(200);
  });

  it('non-members cannot see or control the session', async () => {
    const { owner, tacticId, url } = await setup();
    const { session } = (await owner.post(url).send({ tactic_id: tacticId }).expect(201)).body;
    const outsider = await signUp('Outsider');
    await outsider.get(url).expect(404);
    await outsider.get(`/api/game-sessions/${session.session_id}`).expect(404);
    await outsider.post(`/api/game-sessions/${session.session_id}/end`).send({}).expect(404);
  });

  it('cannot start with another team\'s tactic', async () => {
    const { owner, url } = await setup();
    await owner.post(url).send({ tactic_id: 1 }).expect(404);
  });

  it('allows only one active session per team, even under overlapping starts', async () => {
    const { owner, tacticId, url } = await setup();
    const results = await Promise.all([1, 2, 3, 4].map(() => owner.post(url).send({ tactic_id: tacticId })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).to.deep.equal([201, 409, 409, 409]);
    const conflict = results.find((r) => r.status === 409).body;
    expect(conflict.code).to.equal('session_active');
    expect(conflict.session.session_id).to.equal(results.find((r) => r.status === 201).body.session.session_id);
  });

  it('applies exactly one of two overlapping phase changes', async () => {
    const { owner, member, teamId, tacticId, url } = await setup();
    await owner.patch(`/api/teams/${teamId}/members/${member.user.user_id}`).send({ is_igl: true }).expect(200);
    const { session } = (await owner.post(url).send({ tactic_id: tacticId }).expect(201)).body;
    const path = `/api/game-sessions/${session.session_id}/phase`;
    const [r1, r2] = await Promise.all([
      owner.post(path).send({ action: 'next', expected_version: 1 }),
      member.post(path).send({ action: 'next', expected_version: 1 }),
    ]);
    expect([r1.status, r2.status].sort()).to.deep.equal([200, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    expect(loser.body.code).to.equal('version_conflict');
    expect(loser.body.session).to.include({ current_phase: 1, version: 2 });
    await owner.post(path).send({ action: 'next', expected_version: 2 }).expect(400);
  });

  it('uses a snapshot: editing the saved tactic does not change the live session', async () => {
    const { owner, member, tacticId, doc, url } = await setup();
    await owner.post(url).send({ tactic_id: tacticId }).expect(201);
    const edited = JSON.parse(JSON.stringify(doc));
    edited.phases[0].assignments[1].instruction = 'CHANGED';
    edited.phases[0].name = 'Renamed';
    await owner.put(`/api/tactics/${tacticId}/document`).send({ ...edited, revision: 1 }).expect(200);
    const live = (await member.get(url).expect(200)).body.session;
    expect(live.phase.name).to.equal('Setup');
    expect(live.my_assignment.instruction).to.equal('Lurk B');
    expect(live.tactic.revision).to.equal(1);
  });

  it('validates phase-change payloads', async () => {
    const { owner, tacticId, url } = await setup();
    const { session } = (await owner.post(url).send({ tactic_id: tacticId }).expect(201)).body;
    const path = `/api/game-sessions/${session.session_id}/phase`;
    await owner.post(path).send({ action: 'jump', expected_version: 1 }).expect(400);
    await owner.post(path).send({ action: 'goto', expected_version: 1 }).expect(400);
    await owner.post(path).send({ action: 'goto', index: 9, expected_version: 1 }).expect(400);
    await owner.post(path).send({ action: 'next' }).expect(400);
  });
});
