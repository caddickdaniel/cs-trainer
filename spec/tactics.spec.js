const { expect } = require('chai');
const { reseed, signIn, signUp, tacticDoc, teamWithMember } = require('./helpers');

describe('tactic documents', () => {
  beforeEach(reseed);

  const strip = (doc) => doc.tactic.phases.map((p) => ({
    name: p.name,
    notes: p.notes,
    board: p.board,
    assignments: p.assignments.map(({ user_id, instruction, utility }) => ({ user_id, instruction, utility })),
  }));

  it('saves and reopens with the same phase order, assignments and board geometry', async () => {
    const { owner, member, teamId } = await teamWithMember();
    const ids = [owner.user.user_id, member.user.user_id];
    const doc = tacticDoc(ids);
    const created = (await owner.post(`/api/teams/${teamId}/tactics`).send(doc).expect(201)).body;
    const tacticId = created.tactic.tactic_id;
    expect(created.tactic.revision).to.equal(1);

    const reopened = (await member.get(`/api/tactics/${tacticId}/document`).expect(200)).body;
    expect(reopened.can_edit).to.equal(false);
    expect(reopened.tactic).to.include({ tactic_name: 'Test Split', map: 'practice_yard', side: 'T', economy: 'Fullbuy', smoke: 3 });
    expect(reopened.tactic.phases.map((p) => p.name)).to.deep.equal(['Setup', 'Execute']);
    // Boards come back with Phase 3 defaults (no player slot, no holds).
    const withDefaults = (b) => ({
      markers: b.markers.map((m) => ({ ...m, slot: null })),
      routes: b.routes.map((r) => ({ ...r, slot: null })),
      holds: [],
    });
    expect(reopened.tactic.phases[0].board).to.deep.equal(withDefaults(doc.phases[0].board));
    expect(reopened.tactic.phases[0].board.markers[1]).to.include({ x: 0.123456, y: 0.654321 });
    expect(strip(reopened)[0].assignments).to.deep.equal(
      [...doc.phases[0].assignments].sort((a, b) => a.user_id - b.user_id)
    );
    expect(reopened.roster.map((r) => r.user_id)).to.have.members(ids);

    // Reorder phases and edit; the new order is preserved.
    const edited = { ...doc, revision: 1, phases: [doc.phases[1], { ...doc.phases[0], name: 'Setup v2' }] };
    const saved = (await owner.put(`/api/tactics/${tacticId}/document`).send(edited).expect(200)).body;
    expect(saved.tactic.revision).to.equal(2);
    const again = (await owner.get(`/api/tactics/${tacticId}/document`).expect(200)).body;
    expect(again.tactic.phases.map((p) => p.name)).to.deep.equal(['Execute', 'Setup v2']);
    expect(again.tactic.phases[1].board).to.deep.equal(withDefaults(doc.phases[0].board));

    // Library and legacy endpoint see the same tactic.
    const library = (await member.get(`/api/teams/${teamId}/tactics`).expect(200)).body;
    expect(library.tactics[0]).to.include({ tactic_id: tacticId, phase_count: 2 });
    const legacy = (await member.get(`/api/tactics/${tacticId}`).expect(200)).body.tactics;
    expect(legacy).to.include({ T: true, CT: false, side: 'T' });
  });

  it('detects concurrent edits with the revision number', async () => {
    const { owner, member, teamId } = await teamWithMember();
    const doc = tacticDoc([owner.user.user_id, member.user.user_id]);
    const { tactic } = (await owner.post(`/api/teams/${teamId}/tactics`).send(doc).expect(201)).body;
    await owner.put(`/api/tactics/${tactic.tactic_id}/document`).send({ ...doc, revision: 1 }).expect(200);
    const { body } = await owner.put(`/api/tactics/${tactic.tactic_id}/document`).send({ ...doc, revision: 1 }).expect(409);
    expect(body).to.include({ code: 'stale_revision', current_revision: 2 });
  });

  it('only allows instructions and board items for players on the tactic\'s team', async () => {
    const { owner, member, teamId } = await teamWithMember();
    const outsider = 3; // User C, another team
    const bad = tacticDoc([owner.user.user_id, outsider]);
    const res = await owner.post(`/api/teams/${teamId}/tactics`).send(bad).expect(400);
    expect(res.body).to.include({ code: 'assignee_not_member' });
    expect(res.body.user_ids).to.deep.equal([outsider]);

    const boardOnly = tacticDoc([owner.user.user_id, member.user.user_id]);
    boardOnly.phases[1].board.markers.push({ id: 'x1', kind: 'player', x: 0.5, y: 0.5, user_id: outsider });
    await owner.post(`/api/teams/${teamId}/tactics`).send(boardOnly).expect(400);
  });

  it('validates enums, coordinates and ids at the boundary', async () => {
    const { owner, member, teamId } = await teamWithMember();
    const ids = [owner.user.user_id, member.user.user_id];
    const cases = [
      tacticDoc(ids, { side: 'X' }),
      tacticDoc(ids, { economy: 'Rich' }),
      tacticDoc(ids, { map: 'unknown_map' }),
      tacticDoc(ids, { phases: [] }),
      (() => { const d = tacticDoc(ids); d.phases[0].board.markers[0].x = 1.5; return d; })(),
      (() => { const d = tacticDoc(ids); d.phases[0].board.routes[0].points = [{ x: 0.1, y: 0.1 }]; return d; })(),
      (() => { const d = tacticDoc(ids); d.phases[0].board.markers[0].kind = 'nuke'; return d; })(),
      (() => { const d = tacticDoc(ids); d.phases[0].assignments.push({ ...d.phases[0].assignments[0] }); return d; })(),
      (() => { const d = tacticDoc(ids); d.phases[0].assignments[0].user_id = -4; return d; })(),
      (() => { const d = tacticDoc(ids); d.phases[0].board.markers[1].id = 'm1'; return d; })(),
    ];
    for (const doc of cases) {
      const { body } = await owner.post(`/api/teams/${teamId}/tactics`).send(doc).expect(400);
      expect(body.code).to.equal('validation_failed');
    }
    await owner.get('/api/tactics/abc/document').expect(400);
  });

  it('members cannot edit; IGLs can; non-members cannot read', async () => {
    const { owner, member, teamId } = await teamWithMember();
    const doc = tacticDoc([owner.user.user_id, member.user.user_id]);
    const { tactic } = (await owner.post(`/api/teams/${teamId}/tactics`).send(doc).expect(201)).body;
    await member.post(`/api/teams/${teamId}/tactics`).send(doc).expect(403);
    await member.put(`/api/tactics/${tactic.tactic_id}/document`).send({ ...doc, revision: 1 }).expect(403);
    await owner.patch(`/api/teams/${teamId}/members/${member.user.user_id}`).send({ is_igl: true }).expect(200);
    await member.put(`/api/tactics/${tactic.tactic_id}/document`).send({ ...doc, revision: 1 }).expect(200);
    const outsider = await signUp('Spy');
    await outsider.get(`/api/tactics/${tactic.tactic_id}/document`).expect(404);
    await (await signIn('A')).get(`/api/tactics/${tactic.tactic_id}`).expect(404);
  });

  it('exposes migrated legacy steps as ordered phases', async () => {
    const a = await signIn('A');
    const { body } = await a.get('/api/tactics/1/document').expect(200);
    expect(body.tactic.phases.map((p) => p.name)).to.deep.equal(['Step 1', 'Step 2', 'Step 3']);
    expect(body.tactic.phases[0].assignments.map((x) => x.user_id)).to.deep.equal([1, 2]);
    expect(body.tactic.phases[0].assignments[0]).to.include({
      // "imageurl.com" is not an http(s) URL, so it stays only in the legacy steps.
      instruction: 'run over here and do this', reference_url: null,
    });
  });
});
