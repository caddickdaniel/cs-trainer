// Legacy endpoint coverage, updated for authenticated, team-scoped access.
// Seed data: User A (1) owns Team A (1); User B (2) is in Team A and owns
// Team B (2); Users C..L each own the team with the same letter.
const { expect } = require('chai');
const { request, connection, reseed, signIn, signUp } = require('./helpers');

describe('/api (legacy endpoints)', () => {
  beforeEach(reseed);

  it('GET /api lists endpoints without signing in', () =>
    request.get('/api').expect(200).then(({ body }) => {
      expect(body['/api']).to.have.property('/auth');
    }));

  it('rejects unauthenticated access with 401', () =>
    request.get('/api/teams').expect(401).then(({ body }) => {
      expect(body.code).to.equal('unauthenticated');
    }));

  describe('/teams', () => {
    it('GET/ 200/ responds with only the teams the caller belongs to', async () => {
      const a = await signIn('A');
      const { body } = await a.get('/api/teams').expect(200);
      expect(body.teams.map((t) => t.team_name)).to.deep.equal(['Team A']);
      expect(body.teams[0]).to.have.property('team_name');
      expect(body.teams[0].users).to.have.members(['User A', 'User B']);
    });
    it('GET/ 200/ sorts by team name ascending by default', async () => {
      const b = await signIn('B');
      const { body } = await b.get('/api/teams').expect(200);
      expect(body.teams[1].team_name).to.equal('Team B');
    });
    it('GET/ 200/ sorts by a query column', async () => {
      const b = await signIn('B');
      const { body } = await b.get('/api/teams?sort_by=language').expect(200);
      expect(body.teams[0].language).to.equal('English');
    });
    it('GET/ 200/ orders descending by query', async () => {
      const b = await signIn('B');
      const { body } = await b.get('/api/teams?order=desc').expect(200);
      expect(body.teams[0].team_name).to.equal('Team B');
    });
    it('GET/ 400/ rejects an unknown sort column', async () => {
      const a = await signIn('A');
      await a.get('/api/teams?sort_by=password_hash').expect(400);
    });
    it('GET/ 200/ responds with a single team the caller belongs to', async () => {
      const b = await signIn('B');
      const { body } = await b.get('/api/teams/2').expect(200);
      expect(body.teams).to.be.an('object');
      expect(body.teams.team_name).to.equal('Team B');
    });
    it('GET/ 404/ hides teams the caller does not belong to', async () => {
      const a = await signIn('A');
      await a.get('/api/teams/2').expect(404);
    });
    it('GET/ 200/ finds a team by name', async () => {
      const a = await signIn('A');
      const { body } = await a.get('/api/teams/name/Team%20A').expect(200);
      expect(body.teams.team_name).to.equal('Team A');
    });
    it('GET/ 200/ filters by language, region, platform and skill level', async () => {
      const b = await signIn('B');
      expect((await b.get('/api/teams/lang/Russian').expect(200)).body.teams[0].team_id).to.equal(2);
      expect((await b.get('/api/teams/reg/EU').expect(200)).body.teams).to.have.length(2);
      expect((await b.get('/api/teams/plat/Faceit').expect(200)).body.teams[0].platform).to.equal('Faceit');
      expect((await b.get('/api/teams/skill/10').expect(200)).body.teams[0].skill_level).to.equal('10');
      await b.get('/api/teams/reg/US').expect(404);
    });
    it('GET/ 200/ responds with the owner of a team the caller belongs to', async () => {
      const b = await signIn('B');
      const { body } = await b.get('/api/teams/2/owner').expect(200);
      expect(body.team.owner).to.equal(2);
    });
    it('POST/ 201/ creates a team owned by the caller (body.owner is ignored)', async () => {
      const newbie = await signUp('Newbie');
      const { body } = await newbie.post('/api/teams').send({
        team_name: 'Team 10', owner: 1, language: 'French', region: 'EU', platform: 'MM',
        skill_level: 'Global', description: 'This is the new teams description',
      }).expect(201);
      expect(body.teams.team_name).to.equal('Team 10');
      expect(body.teams.team_id).to.equal(13);
      expect(body.teams.owner).to.equal(newbie.user.user_id);
    });
    it('POST/ 409/ a user who is already in a team cannot create another', async () => {
      const a = await signIn('A');
      const { body } = await a.post('/api/teams').send({ team_name: 'Second' }).expect(409);
      expect(body.code).to.equal('already_in_team');
    });
    it('PATCH/ 200/ the owner can update the team', async () => {
      const a = await signIn('A');
      const { body } = await a.patch('/api/teams/1').send({
        team_name: 'Shark', language: 'Shark', region: 'Shark', platform: 'Shark', skill_level: 'Shark',
        description: 'This is the updated team description',
      }).expect(200);
      expect(body.team_name).to.equal('Shark');
    });
    it('PATCH/ 403/ 404/ members and non-members cannot update the team', async () => {
      await (await signIn('B')).patch('/api/teams/1').send({ team_name: 'Nope' }).expect(403);
      await (await signIn('C')).patch('/api/teams/1').send({ team_name: 'Nope' }).expect(404);
    });
    it('PATCH/ 204/ the owner (from the session) removes user 2 from team 1', async () => {
      const a = await signIn('A');
      await a.patch('/api/teams/1/users/2').send({ user_id: 1 }).expect(204);
      const { body } = await a.get('/api/teams/1').expect(200);
      expect(body.teams.users).to.not.include('User B');
    });
    it('PATCH/ 403/ a member cannot remove other players even if body.user_id claims to be the owner', async () => {
      const b = await signIn('B');
      await b.patch('/api/teams/1/users/1').send({ user_id: 1 }).expect(403);
    });
    it('DELETE/ 204/ the owner can delete their team', async () => {
      const l = await signIn('L');
      await l.delete('/api/teams/12').expect(204);
      const user = await connection('users').where('user_id', 12).first();
      expect(user.team_id).to.equal(null);
    });
    it('DELETE/ 404/ non-members cannot delete a team', async () => {
      await (await signIn('A')).delete('/api/teams/12').expect(404);
    });
  });

  describe('/tactics', () => {
    it('GET/ 200/ responds with the tactics of the caller\'s teams', async () => {
      const a = await signIn('A');
      const { body } = await a.get('/api/tactics').expect(200);
      expect(body.tactics.map((t) => t.tactic_name)).to.deep.equal(['Tactic A', 'Tactic B', 'Tactic C']);
      expect(body.tactics[0]).to.include.keys('tactic_name', 'steps', 'T', 'CT', 'side', 'map', 'revision');
    });
    it('GET/ 200/ sorts and orders by query', async () => {
      const b = await signIn('B');
      expect((await b.get('/api/tactics').expect(200)).body.tactics[1].tactic_name).to.equal('Tactic B');
      expect((await b.get('/api/tactics?sort_by=economy').expect(200)).body.tactics[3].tactic_name).to.equal('Tactic D');
      expect((await b.get('/api/tactics?order=desc').expect(200)).body.tactics[0].tactic_name).to.equal('Tactic D');
    });
    it('GET/ 200/ 404/ single tactic is visible to members only', async () => {
      const { body } = await (await signIn('A')).get('/api/tactics/3').expect(200);
      expect(body.tactics.tactic_name).to.equal('Tactic C');
      await (await signIn('C')).get('/api/tactics/3').expect(404);
    });
    it('GET/ 200/ by name, economy and team', async () => {
      const b = await signIn('B');
      expect((await b.get('/api/tactics/name/Tactic%20C').expect(200)).body.tactics.tactic_name).to.equal('Tactic C');
      expect((await b.get('/api/tactics/econ/Fullbuy').expect(200)).body.tactics[0].tactic_name).to.equal('Tactic D');
      expect((await b.get('/api/tactics/team/1').expect(200)).body.tactics[2].tactic_name).to.equal('Tactic C');
      await b.get('/api/tactics/team/3').expect(404);
    });
    it('GET/ 200/ responds with the legacy steps for user 1 in tactic 1', async () => {
      const { body } = await (await signIn('A')).get('/api/tactics/1/user/1/steps').expect(200);
      expect(body.steps[0].step).to.equal(1);
      expect(body.steps[1].desc).to.equal('run here now');
    });
    it('POST/ 201/ the owner creates a tactic for their team', async () => {
      const a = await signIn('A');
      const { body } = await a.post('/api/tactics').send({
        tactic_name: 'Tactic 20', economy: 'Halfbuy', grenade: 2, molly: 3, flash: 1, smoke: 3, team_id: 1, T: true,
      }).expect(201);
      expect(body.tactics.tactic_name).to.equal('Tactic 20');
      expect(body.tactics.tactic_id).to.equal(13);
      expect(body.tactics.side).to.equal('T');
    });
    it('POST/ 400/ team_id is now required and counts are validated', async () => {
      const a = await signIn('A');
      await a.post('/api/tactics').send({
        tactic_name: 'Tactic 20', economy: 'Halfbuy', grenade: 2, molly: 3, flash: 1, smoke: 3,
      }).expect(400);
      await a.post('/api/tactics').send({
        tactic_name: 'Bad', economy: 'Eco', grenade: 9, molly: 0, flash: 0, smoke: 0, team_id: 1,
      }).expect(400);
    });
    it('POST/ 403/ a member without IGL permission cannot create tactics', async () => {
      const b = await signIn('B');
      await b.post('/api/tactics').send({
        tactic_name: 'X', economy: 'Eco', grenade: 0, molly: 0, flash: 0, smoke: 0, team_id: 1,
      }).expect(403);
    });
    it('PATCH/ 200/ the owner updates a tactic; members get 403', async () => {
      const a = await signIn('A');
      const { body } = await a.patch('/api/tactics/1').send({
        tactic_name: 'Shark', economy: 'Eco', grenade: 1, molly: 3, flash: 5, smoke: 3,
      }).expect(200);
      expect(body.tactic_name).to.equal('Shark');
      expect(body.revision).to.equal(2);
      await (await signIn('B')).patch('/api/tactics/1').send({ tactic_name: 'Nope' }).expect(403);
    });
    it('PATCH/ 200/ responds with the steps that have just been patched', async () => {
      const updatedSteps = {
        steps: [
          { user_id: 1, step: 1, desc: 'Updated step 1', ref_img: 'updatedimage.com' },
          { user_id: 1, step: 2, desc: 'Updated step 2', ref_img: 'updatedimage.com' },
        ],
      };
      const { body } = await (await signIn('A')).patch('/api/tactics/1/steps').send(updatedSteps).expect(200);
      expect(body.message).to.equal('Steps updated successfully');
      expect(body.steps).to.deep.equal(updatedSteps.steps);
    });
    it('PATCH/ 400/ steps cannot be assigned to players outside the team', async () => {
      const { body } = await (await signIn('A')).patch('/api/tactics/1/steps')
        .send({ steps: [{ user_id: 3, step: 1, desc: 'x' }] }).expect(400);
      expect(body.code).to.equal('assignee_not_member');
    });
    it('DELETE/ 204/ owner deletes; other teams\' tactics are 404', async () => {
      const a = await signIn('A');
      await a.delete('/api/tactics/1').expect(204);
      await a.delete('/api/tactics/12').expect(404);
    });
  });

  describe('/users', () => {
    it('GET/ 200/ responds with the caller and teammates, without emails', async () => {
      const { body } = await (await signIn('A')).get('/api/users').expect(200);
      expect(body.users.map((u) => u.user_name)).to.deep.equal(['User A', 'User B']);
      expect(body.users[0]).to.not.have.any.keys('email', 'password_hash');
    });
    it('GET/ 200/ sorts and orders by query', async () => {
      const a = await signIn('A');
      expect((await a.get('/api/users?sort_by=language').expect(200)).body.users[0].language).to.equal('English');
      expect((await a.get('/api/users?order=desc').expect(200)).body.users[0].user_name).to.equal('User B');
    });
    it('GET/ 200/ 404/ teammates are visible, other users are not', async () => {
      const a = await signIn('A');
      expect((await a.get('/api/users/2').expect(200)).body.users.user_id).to.equal(2);
      await a.get('/api/users/3').expect(404);
    });
    it('GET/ 200/ filters by name, language, region, platform, skill, role and team', async () => {
      const a = await signIn('A');
      expect((await a.get('/api/users/name/User%20B').expect(200)).body.users.user_name).to.equal('User B');
      expect((await a.get('/api/users/lang/Russian').expect(200)).body.users[0].language).to.equal('Russian');
      expect((await a.get('/api/users/reg/EU').expect(200)).body.users).to.have.length(2);
      expect((await a.get('/api/users/plat/ESEA').expect(200)).body.users[0].platform).to.equal('ESEA');
      expect((await a.get('/api/users/skill/A').expect(200)).body.users[0].skill_level).to.equal('A');
      expect((await a.get('/api/users/role/IGL').expect(200)).body.users[0].role).to.equal('IGL');
      expect((await a.get('/api/users/team/1').expect(200)).body.users[0].team_name).to.equal('Team A');
      await a.get('/api/users/team/3').expect(404);
      await a.get('/api/users/name/User%20C').expect(404);
    });
    it('POST/ 410/ users are created through sign-up', async () => {
      const { body } = await (await signIn('A')).post('/api/users').send({ user_name: 'User 20' }).expect(410);
      expect(body.code).to.equal('use_signup');
    });
    it('PATCH/ 200/ users update their own profile', async () => {
      const { body } = await (await signIn('A')).patch('/api/users/1').send({
        language: 'Shark', region: 'Shark', platform: 'Shark', skill_level: 'Shark', role: 'Shark',
        avatar_url: 'www.google.com/hello', bio: 'hello there',
      }).expect(200);
      expect(body.bio).to.equal('hello there');
      expect(body.team_id).to.equal(1);
    });
    it('PATCH/ team_id can only switch to a team the user already belongs to', async () => {
      await (await signIn('A')).patch('/api/users/1').send({ team_id: 2 }).expect(400);
      const { body } = await (await signIn('B')).patch('/api/users/2').send({ team_id: 2 }).expect(200);
      expect(body.team_id).to.equal(2);
    });
    it('PATCH/ 403/ users cannot update someone else', async () => {
      await (await signIn('A')).patch('/api/users/2').send({ bio: 'hacked' }).expect(403);
    });
    it('PATCH/ 204/ remove-team leaves the active team', async () => {
      const b = await signIn('B');
      await b.patch('/api/users/2/remove-team').send({}).expect(204);
      const user = await connection('users').where({ user_id: 2 }).first();
      // B still owns Team B, which becomes the active team.
      expect(user.team_id).to.equal(2);
      expect(await connection('team_memberships').where({ team_id: 1, user_id: 2 }).first()).to.equal(undefined);
    });
    it('PATCH/ 409/ the owner cannot leave their own team', async () => {
      await (await signIn('A')).patch('/api/users/1/remove-team').send({}).expect(409);
    });
    it('DELETE/ 204/ users can delete their own account; owners and others cannot', async () => {
      const newbie = await signUp('Leaving');
      await newbie.delete(`/api/users/${newbie.user.user_id}`).expect(204);
      await (await signIn('A')).delete('/api/users/1').expect(409);
      await (await signIn('A')).delete('/api/users/2').expect(403);
    });
  });
});
