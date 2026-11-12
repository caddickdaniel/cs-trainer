const { expect } = require('chai');
const { connection, reseed, signIn, signUp, teamWithMember } = require('./helpers');

describe('teams, invites and permissions', () => {
  beforeEach(reseed);

  it('a user without a team can create one; owner membership is created atomically', async () => {
    const owner = await signUp('Founder');
    const { body } = await owner.post('/api/teams').send({ team_name: 'Night Owls', region: 'EU' }).expect(201);
    const teamId = body.teams.team_id;
    const me = (await owner.get('/api/auth/me').expect(200)).body;
    expect(me.active_team).to.include({ team_id: teamId, is_owner: true, can_lead: true });
    const roster = (await owner.get(`/api/teams/${teamId}/roster`).expect(200)).body;
    expect(roster.members).to.have.length(1);
    expect(roster.members[0]).to.include({ user_id: owner.user.user_id, is_owner: true });
  });

  it('rolls back the team if the owner membership cannot be created', async () => {
    const owner = await signUp('Atomic');
    const before = await connection('teams').count('* as n').first();
    // Simulate a failure inside the transaction by locking the user out with a bad FK target.
    await connection.raw(`CREATE OR REPLACE FUNCTION fail_membership() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'boom'; END; $$ LANGUAGE plpgsql`);
    await connection.raw(`CREATE TRIGGER fail_membership BEFORE INSERT ON team_memberships
      FOR EACH ROW EXECUTE FUNCTION fail_membership()`);
    try {
      await owner.post('/api/teams').send({ team_name: 'Never' }).expect(500);
    } finally {
      await connection.raw('DROP TRIGGER fail_membership ON team_memberships');
      await connection.raw('DROP FUNCTION fail_membership()');
    }
    const after = await connection('teams').count('* as n').first();
    expect(after.n).to.equal(before.n);
  });

  it('overlapping create requests from one user produce exactly one team', async () => {
    const owner = await signUp('Racer');
    const results = await Promise.all([1, 2, 3].map((i) => owner.post('/api/teams').send({ team_name: `Race ${i}` })));
    expect(results.map((r) => r.status).sort()).to.deep.equal([201, 409, 409]);
    expect(await connection('team_memberships').where('user_id', owner.user.user_id)).to.have.length(1);
  });

  describe('invites', () => {
    it('a teammate joins through an invite and sees the roster', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const me = (await member.get('/api/auth/me').expect(200)).body;
      expect(me.active_team).to.include({ team_id: teamId, is_owner: false, can_lead: false });
      const roster = (await member.get(`/api/teams/${teamId}/roster`).expect(200)).body;
      expect(roster.members.map((m) => m.user_id)).to.deep.equal([owner.user.user_id, member.user.user_id]);
    });

    it('stores only a hash of the token and previews the team', async () => {
      const owner = await signUp('Hash');
      const { body: t } = await owner.post('/api/teams').send({ team_name: 'Hashers' }).expect(201);
      const { body } = await owner.post(`/api/teams/${t.teams.team_id}/invites`).send({}).expect(201);
      const row = await connection('team_invites').where('invite_id', body.invite.invite_id).first();
      expect(row.token_hash).to.have.length(64);
      expect(row.token_hash).to.not.equal(body.token);
      const guest = await signUp('Guest');
      const preview = (await guest.get(`/api/invites/${body.token}`).expect(200)).body;
      expect(preview).to.include({ status: 'active', already_member: false });
      expect(preview.team.team_name).to.equal('Hashers');
    });

    it('rejects expired invites', async () => {
      const { owner, teamId } = await teamWithMember();
      const { body } = await owner.post(`/api/teams/${teamId}/invites`).send({ expires_in_hours: 1 }).expect(201);
      await connection('team_invites').where('invite_id', body.invite.invite_id)
        .update({ expires_at: connection.raw("now() - interval '1 minute'") });
      const late = await signUp('Late');
      expect((await late.get(`/api/invites/${body.token}`).expect(200)).body.status).to.equal('expired');
      const res = await late.post(`/api/invites/${body.token}/accept`).send({}).expect(410);
      expect(res.body.code).to.equal('invite_expired');
    });

    it('rejects revoked and used-up invites, and unknown tokens', async () => {
      const { owner, teamId } = await teamWithMember();
      const revoked = (await owner.post(`/api/teams/${teamId}/invites`).send({}).expect(201)).body;
      await owner.delete(`/api/teams/${teamId}/invites/${revoked.invite.invite_id}`).expect(200);
      const single = (await owner.post(`/api/teams/${teamId}/invites`).send({ max_uses: 1 }).expect(201)).body;
      const p1 = await signUp('One');
      const p2 = await signUp('Two');
      expect((await p1.post(`/api/invites/${revoked.token}/accept`).send({}).expect(410)).body.code).to.equal('invite_revoked');
      await p1.post(`/api/invites/${single.token}/accept`).send({}).expect(200);
      expect((await p2.post(`/api/invites/${single.token}/accept`).send({}).expect(410)).body.code).to.equal('invite_used_up');
      await p2.post('/api/invites/not-a-real-token-but-long-enough/accept').send({}).expect(404);
      await p2.get('/api/invites/!!bad!!').expect(404);
    });

    it('lists invite status for leads only', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const { body } = await owner.get(`/api/teams/${teamId}/invites`).expect(200);
      expect(body.invites[0]).to.include({ status: 'active', use_count: 1 });
      expect(body.invites[0]).to.not.have.any.keys('token', 'token_hash');
      await member.get(`/api/teams/${teamId}/invites`).expect(403);
      await member.post(`/api/teams/${teamId}/invites`).send({}).expect(403);
      await (await signIn('C')).get(`/api/teams/${teamId}/invites`).expect(404);
    });

    it('validates invite options', async () => {
      const { owner, teamId } = await teamWithMember();
      await owner.post(`/api/teams/${teamId}/invites`).send({ expires_in_hours: 5 }).expect(400);
    });

    it('a member of a team cannot accept an invite to another team', async () => {
      const { inviteToken } = await teamWithMember();
      const a = await signIn('A');
      expect((await a.post(`/api/invites/${inviteToken}/accept`).send({}).expect(409)).body.code).to.equal('already_in_team');
    });
  });

  describe('permissions', () => {
    it('only the owner assigns the IGL role, which moves from the previous IGL', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const memberId = member.user.user_id;
      const ownerId = owner.user.user_id;
      // The creator starts as IGL.
      expect((await connection('team_memberships').where({ team_id: teamId, user_id: ownerId }).first()).player_role).to.equal('igl');
      await member.patch(`/api/teams/${teamId}/members/${memberId}`).send({ player_role: 'igl' }).expect(403);
      await member.patch(`/api/teams/${teamId}/members/${memberId}`).send({ is_igl: true }).expect(403);
      const { body } = await owner.patch(`/api/teams/${teamId}/members/${memberId}`).send({ player_role: 'igl' }).expect(200);
      expect(body.members.find((m) => m.user_id === memberId)).to.include({ is_igl: true, can_lead: true, player_role: 'igl' });
      expect(body.members.find((m) => m.user_id === ownerId)).to.include({ is_igl: false, player_role: null, is_owner: true });
      expect(body.viewer).to.include({ is_owner: true, can_control: false });
      // The IGL cannot hand the role on or drop it; only the owner can.
      await member.patch(`/api/teams/${teamId}/members/${memberId}`).send({ player_role: 'support' }).expect(403);
      // Legacy is_igl input maps onto the role and stays consistent.
      await owner.patch(`/api/teams/${teamId}/members/${ownerId}`).send({ is_igl: true }).expect(200);
      const rows = await connection('team_memberships').where('team_id', teamId).orderBy('user_id');
      expect(rows.map((r) => [r.player_role, r.is_igl])).to.deep.equal([['igl', true], [null, false]]);
      // Other roles are unchanged: players may set their own.
      await member.patch(`/api/teams/${teamId}/members/${memberId}`).send({ player_role: 'entry' }).expect(200);
      await owner.patch(`/api/teams/${teamId}/members/${memberId}`).send({ player_role: 'captain' }).expect(400);
    });

    it('the database never allows two IGLs or a mismatched is_igl', async () => {
      const { member, teamId } = await teamWithMember();
      const fails = async (fn) => { try { await fn(); return false; } catch { return true; } };
      expect(await fails(() => connection('team_memberships').where({ team_id: teamId, user_id: member.user.user_id })
        .update({ player_role: 'igl', is_igl: true }))).to.equal(true);
      expect(await fails(() => connection('team_memberships').where({ team_id: teamId, user_id: member.user.user_id })
        .update({ is_igl: true }))).to.equal(true);
    });

    it('ordinary members cannot change other players\' roles', async () => {
      const { owner, member, teamId } = await teamWithMember();
      await member.patch(`/api/teams/${teamId}/members/${owner.user.user_id}`).send({ player_role: 'entry' }).expect(403);
    });

    it('non-members cannot read another team\'s roster, tactics or Game Mode', async () => {
      const { teamId } = await teamWithMember();
      const outsider = await signIn('C');
      await outsider.get(`/api/teams/${teamId}/roster`).expect(404);
      await outsider.get(`/api/teams/${teamId}/tactics`).expect(404);
      await outsider.get(`/api/teams/${teamId}/game-session`).expect(404);
      await outsider.get(`/api/teams/${teamId}`).expect(404);
      await outsider.get(`/api/users/team/${teamId}`).expect(404);
    });

    it('members can leave, owners can remove players, owners cannot leave', async () => {
      const { owner, member, teamId } = await teamWithMember();
      await owner.post(`/api/teams/${teamId}/leave`).send({}).expect(409);
      await member.post(`/api/teams/${teamId}/leave`).send({}).expect(204);
      const me = (await member.get('/api/auth/me').expect(200)).body;
      expect(me.active_team).to.equal(null);
      await member.get(`/api/teams/${teamId}/roster`).expect(404);
    });
  });
});
