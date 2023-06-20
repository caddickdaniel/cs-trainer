process.env.NODE_ENV = 'test';
const { expect } = require('chai');
const app = require('../app');
const request = require('supertest')(app);
const connection = require('../db/connection');
const chai = require('chai');
const chaiHttp = require('chai-http');

chai.use(chaiHttp);

describe('/api', () => {
  beforeEach(() =>
    connection.migrate
      .rollback()
      .then(() => connection.migrate.latest())
      .then(() => connection.seed.run())
  );
  after(() => connection.destroy());
  describe('/teams', () => {
    it('GET/ status 200/ responds with an array of team objects', () =>
      request
        .get('/api/teams')
        .expect(200)
        .then(({ body }) => {
          expect(body.teams).to.be.an('array');
          expect(body.teams[0]).to.be.an('object');
          expect(body.teams[0]).to.have.property('team_name');
        })
    );
    it('GET/ status 200/ responds with an array of team objects sorted by team name (DEFAULT_CASE)', () =>
      request
        .get('/api/teams')
        .expect(200)
        .then(({ body }) => {
          expect(body.teams).to.be.an('array');
          expect(body.teams[0]).to.be.an('object');
          expect(body.teams[1].team_name).to.equal('Team B');
        })
    );
    it('GET/ status 200/ responds with an array of team objects sorted by team name (QUERY)', () =>
      request
        .get('/api/teams?sort_by=language')
        .expect(200)
        .then(({ body }) => {
          expect(body.teams).to.be.an('array');
          expect(body.teams[0]).to.be.an('object');
          expect(body.teams[0].language).to.equal('English');
        })
    );
    it('GET/ status 200/ responds with an array of team objects ordered by ascending (DEFAULT_CASE)', () =>
      request
        .get('/api/teams')
        .expect(200)
        .then(({ body }) => {
          expect(body.teams).to.be.an('array');
          expect(body.teams[0]).to.be.an('object');
          expect(body.teams[11].team_name).to.equal('Team L');
        })
    );
    it('GET/ status 200/ responds with an array of team objects ordered by descending (QUERY)', () =>
      request
        .get('/api/teams?order=desc')
        .expect(200)
        .then(({ body }) => {
          expect(body.teams).to.be.an('array');
          expect(body.teams[0]).to.be.an('object');
          expect(body.teams[11].team_name).to.equal('Team A');
        })
    );
    it('GET/ status 200/ responds with a single team object that has an id of 2', () =>
      request
        .get('/api/teams/2')
        .expect(200)
        .then(({ body }) => {
          expect(body.teams).to.be.an('object');
          expect(body.teams.team_name).to.equal('Team B');
        })
    );
    it('GET/ status 200/ responds with a single team object that has a team name of Team A', () =>
      request
        .get('/api/teams/name/Team%20A')
        .expect(200)
        .then(({ body }) => {
          expect(body.teams).to.be.an('object');
          expect(body.teams.team_name).to.equal('Team A');
        })
    );
    it('GET/ status 200/ responds with an array of teams that has a language of English', () =>
      request
        .get('/api/teams/lang/English')
        .expect(200)
        .then(({ body }) => {
          expect(body.teams).to.be.an('array');
          expect(body.teams[1]).to.be.an('object');
          expect(body.teams[1].language).to.equal('English');
          expect(body.teams[1].team_id).to.equal(3);
        })
    );
    it('GET/ status 200/ responds with an array of teams that has a region of EU', () =>
      request
        .get('/api/teams/reg/EU')
        .expect(200)
        .then(({ body }) => {
          expect(body.teams).to.be.an('array');
          expect(body.teams[1]).to.be.an('object');
          expect(body.teams[1].region).to.equal('EU');
        })
    );
    it('GET/ status 200/ responds with an array of teams that has a platform of Faceit', () =>
      request
        .get('/api/teams/plat/Faceit')
        .expect(200)
        .then(({ body }) => {
          expect(body.teams).to.be.an('array');
          expect(body.teams[2]).to.be.an('object');
          expect(body.teams[2].platform).to.equal('Faceit');
        })
    );
    it('GET/ status 200/ responds with an array of teams that has a platform of Faceit', () =>
      request
        .get('/api/teams/skill/10')
        .expect(200)
        .then(({ body }) => {
          expect(body.teams).to.be.an('array');
          expect(body.teams[2]).to.be.an('object');
          expect(body.teams[2].skill_level).to.equal('10');
        })
    );
    it('GET/ status 200/ responds with the owner of the team with team_id 2', () =>
      request
        .get('/api/teams/2/owner')
        .expect(200)
        .then(({ body }) => {
          expect(body.team).to.be.an('object');
          expect(body.team.owner).to.equal(2);
        })
    );
    it('POST/ status 201/ responds with the posted team', () => {
        const newTeam = {
          team_name: 'Team 10',
          owner: 1,
          language: 'French',
          region: 'EU',
          platform: 'MM',
          skill_level: 'Global',
          description: 'This is the new teams description'
        };
        return request
          .post('/api/teams')
          .send(newTeam)
          .expect(201)
          .then(({ body }) => {
            expect(body.teams.team_name).to.equal(newTeam.team_name);
            expect(body.teams.team_id).to.equal(13);
          });
      });
    it('PATCH/ status 200/ responds with the team that has just been patched', () => {
        const updatedTeam = {
          team_name: "Shark",
          language: "Shark",
          region: "Shark",
          platform: "Shark",
          skill_level: "Shark",
          description: "This is the updated team description"
        };
        return request
          .patch('/api/teams/1')
          .send(updatedTeam)
          .expect(200)
          .then(({ body }) => {
            expect(body).to.be.an('object');
            expect(body.team_name).to.equal("Shark");
          });
      });
    it('PATCH/ checks for owner carrying out request then removes user 2 from team 1', (done) => {
      const ownerCheck = { user_id: 1 };
    
      request
        .patch('/api/teams/1/users/2')
        .send(ownerCheck)
        .expect(204)
        .then(() => {
          request
            .get('/api/teams/1')
            .expect(200)
            .then((response) => {
              const updatedTeam = response.body.teams;
              expect(updatedTeam.users).to.not.include('User B');
              done();
            })
            .catch((err) => done(err));
        })
        .catch((err) => done(err));
    });
    it('DELETE/ status 204/ responds with a 204 and no-content', () => request.delete('/api/teams/12').expect(204));
  });
  describe('/tactics', () => {
    it('GET/ status 200/ responds with an array of tactic objects', () =>
      request
        .get('/api/tactics')
        .expect(200)
        .then(({ body }) => {
          expect(body.tactics).to.be.an('array');
          expect(body.tactics[0]).to.be.an('object');
          expect(body.tactics[0]).to.have.property('tactic_name');
        })
    );
    it('GET/ status 200/ responds with an array of tactic objects sorted by tactic name (DEFAULT_CASE)', () =>
      request
        .get('/api/tactics')
        .expect(200)
        .then(({ body }) => {
          expect(body.tactics).to.be.an('array');
          expect(body.tactics[0]).to.be.an('object');
          expect(body.tactics[1].tactic_name).to.equal('Tactic B');
        })
    );
    it('GET/ status 200/ responds with an array of tactic objects sorted by economy (QUERY)', () =>
      request
        .get('/api/tactics?sort_by=economy')
        .expect(200)
        .then(({ body }) => {
          expect(body.tactics).to.be.an('array');
          expect(body.tactics[9]).to.be.an('object');
          expect(body.tactics[9].tactic_name).to.equal('Tactic D');
        })
    );
    it('GET/ status 200/ responds with an array of tactic objects ordered by ascending (DEFAULT_CASE)', () =>
      request
        .get('/api/tactics')
        .expect(200)
        .then(({ body }) => {
          expect(body.tactics).to.be.an('array');
          expect(body.tactics[1]).to.be.an('object');
          expect(body.tactics[1].tactic_name).to.equal('Tactic B');
        })
    );
    it('GET/ status 200/ responds with an array of tactic objects ordered by descending (QUERY)', () =>
      request
        .get('/api/tactics?order=desc')
        .expect(200)
        .then(({ body }) => {
          expect(body.tactics).to.be.an('array');
          expect(body.tactics[0]).to.be.an('object');
          expect(body.tactics[0].tactic_name).to.equal('Tactic L');
        })
    );
    it('GET/ status 200/ responds with a single tactic object that has an id of 3', () =>
      request
        .get('/api/tactics/3')
        .expect(200)
        .then(({ body }) => {
          expect(body.tactics).to.be.an('object');
          expect(body.tactics.tactic_name).to.equal('Tactic C');
        })
    );
    it('GET/ status 200/ responds with a single tactic object that has a tactic name of Tactic C', () =>
      request
        .get('/api/tactics/name/Tactic%20C')
        .expect(200)
        .then(({ body }) => {
          expect(body.tactics).to.be.an('object');
          expect(body.tactics.tactic_name).to.equal('Tactic C');
        })
    );
    it('GET/ status 200/ responds with an array of tactic objects that has a economy of Fullbuy', () =>
      request
        .get('/api/tactics/econ/Fullbuy')
        .expect(200)
        .then(({ body }) => {
          expect(body.tactics[0]).to.be.an('object');
          expect(body.tactics[0].tactic_name).to.equal('Tactic D');
        })
    );
    it('GET/ status 200/ responds with an array of tactic objects that has a team_id of 1', () =>
      request
        .get('/api/tactics/team/1')
        .expect(200)
        .then(({ body }) => {
          expect(body.tactics).to.be.an('array');
          expect(body.tactics[2].tactic_name).to.equal('Tactic C');
        })
    );
    it('GET/ status 200/ responds with an array of tactic steps for user 1 in tactic 1', () =>
      request
        .get('/api/tactics/1/user/1')
        .expect(200)
        .then(({ body }) => {
          expect(body.steps).to.be.an('array');
          expect(body.steps[0].step).to.equal(1);
          expect(body.steps[1].desc).to.equal('run here now');
        })
    );
    it('POST/ status 201/ responds with the posted tactic', () => {
        const newTactic = {
          tactic_name: 'Tactic 20',
          economy: 'Halfbuy',
          grenade: 2,
          molly: 3,
          flash: 1,
          smoke: 3
        };
        return request
          .post('/api/tactics')
          .send(newTactic)
          .expect(201)
          .then(({ body }) => {
            expect(body.tactics.tactic_name).to.equal(newTactic.tactic_name);
            expect(body.tactics.tactic_id).to.equal(13);
          });
      });
    it('PATCH/ status 200/ responds with the tactic that has just been patched', () => {
        const updatedTactic = {
          tactic_name: "Shark",
          economy: "Eco",
          grenade: 1,
          molly: 3,
          flash: 5,
          smoke: 3
        };
        return request
          .patch('/api/tactics/1')
          .send(updatedTactic)
          .expect(200)
          .then(({ body }) => {
            expect(body).to.be.an('object');
            expect(body.tactic_name).to.equal("Shark");
          });
      });
    it('DELETE/ status 204/ responds with a 204 and no-content', () => request.delete('/api/tactics/12').expect(204));
  });
  describe('/users', () => {
    it('GET/ status 200/ responds with an array of user objects', () =>
      request
        .get('/api/users')
        .expect(200)
        .then(({ body }) => {
          expect(body.users).to.be.an('array');
          expect(body.users[0]).to.be.an('object');
          expect(body.users[0]).to.have.property('user_name');
        })
    );
    it('GET/ status 200/ responds with an array of user objects sorted by user name (DEFAULT_CASE)', () =>
      request
        .get('/api/users')
        .expect(200)
        .then(({ body }) => {
          expect(body.users).to.be.an('array');
          expect(body.users[1]).to.be.an('object');
          expect(body.users[1].user_name).to.equal('User B');
        })
    );
    it('GET/ status 200/ responds with an array of user objects sorted by language (QUERY)', () =>
      request
        .get('/api/users?sort_by=language')
        .expect(200)
        .then(({ body }) => {
          expect(body.users).to.be.an('array');
          expect(body.users[0]).to.be.an('object');
          expect(body.users[0].language).to.equal('English');
        })
    );
    it('GET/ status 200/ responds with an array of user objects ordered by ascending (DEFAULT_CASE)', () =>
      request
        .get('/api/users')
        .expect(200)
        .then(({ body }) => {
          expect(body.users).to.be.an('array');
          expect(body.users[1]).to.be.an('object');
          expect(body.users[1].user_name).to.equal('User B');
        })
    );
    it('GET/ status 200/ responds with an array of user objects ordered by descending (QUERY)', () =>
      request
        .get('/api/users?order=desc')
        .expect(200)
        .then(({ body }) => {
          expect(body.users).to.be.an('array');
          expect(body.users[0]).to.be.an('object');
          expect(body.users[0].user_name).to.equal('User L');
        })
    );
    it('GET/ status 200/ responds with a user object with the id of 3', () =>
      request
        .get('/api/users/3')
        .expect(200)
        .then(({ body }) => {
          expect(body.users).to.be.an('object');
          expect(body.users.user_id).to.equal(3);
        })
    );
    it('GET/ status 200/ responds with a user object with the id of 3', () =>
      request
        .get('/api/users/3')
        .expect(200)
        .then(({ body }) => {
          expect(body.users).to.be.an('object');
          expect(body.users.user_id).to.equal(3);
        })
    );
    it('GET/ status 200/ responds with a user object with the user name User C', () =>
      request
        .get('/api/users/name/User%20C')
        .expect(200)
        .then(({ body }) => {
          expect(body.users).to.be.an('object');
          expect(body.users.user_name).to.equal('User C');
        })
    );
    it('GET/ status 200/ responds with an array of user objects with the language Swedish', () =>
      request
        .get('/api/users/lang/Swedish')
        .expect(200)
        .then(({ body }) => {
          expect(body.users).to.be.an('array');
          expect(body.users[0]).to.be.an('object');
          expect(body.users[0].language).to.equal('Swedish');
        })
    );
    it('GET/ status 200/ responds with an array of user objects with the region US', () =>
      request
        .get('/api/users/reg/US')
        .expect(200)
        .then(({ body }) => {
          expect(body.users).to.be.an('array');
          expect(body.users[0]).to.be.an('object');
          expect(body.users[0].region).to.equal('US');
        })
    );
    it('GET/ status 200/ responds with an array of user objects with the platform ESEA', () =>
      request
        .get('/api/users/plat/ESEA')
        .expect(200)
        .then(({ body }) => {
          expect(body.users).to.be.an('array');
          expect(body.users[0]).to.be.an('object');
          expect(body.users[0].platform).to.equal('ESEA');
        })
    );
    it('GET/ status 200/ responds with an array of user objects with the skill level A', () =>
      request
        .get('/api/users/skill/A')
        .expect(200)
        .then(({ body }) => {
          expect(body.users).to.be.an('array');
          expect(body.users[0]).to.be.an('object');
          expect(body.users[0].skill_level).to.equal('A');
        })
    );
    it('GET/ status 200/ responds with an array of user objects with the role IGL', () =>
      request
        .get('/api/users/role/IGL')
        .expect(200)
        .then(({ body }) => {
          expect(body.users).to.be.an('array');
          expect(body.users[0]).to.be.an('object');
          expect(body.users[0].role).to.equal('IGL');
        })
    );
    it('GET/ status 200/ responds with an array of user objects with the team id 1', () =>
      request
        .get('/api/users/team/1')
        .expect(200)
        .then(({ body }) => {
          expect(body.users).to.be.an('array');
          expect(body.users[0]).to.be.an('object');
          expect(body.users[0].team_name).to.equal('Team A');
        })
    );
    it('POST/ status 201/ responds with the posted user', () => {
        const newUser = {
          user_name: 'User 20',
          language: 'French', 
          region: 'EU', 
          platform: 'Faceit', 
          skill_level: '10', 
          role: 'Awper', 
          team_id: 2
        };
        return request
          .post('/api/users')
          .send(newUser)
          .expect(201)
          .then(({ body }) => {
            expect(body.users.user_name).to.equal(newUser.user_name);
            expect(body.users.user_id).to.equal(13);
          });
      });
    it('PATCH/ status 200/ responds with the user that has just been patched', () => {
        const updatedUser = {
          language: "Shark",
          region: "Shark",
          platform: "Shark",
          skill_level: "Shark",
          role: "Shark",
          team_id: 2,
          avatar_url: "www.google.com/hello",
          bio: "hello there"
        };
        return request
          .patch('/api/users/1')
          .send(updatedUser)
          .expect(200)
          .then(({ body }) => {
            expect(body).to.be.an('object');
            expect(body.team_id).to.equal(2);
          });
      });
      it('PATCH/ status 200/ responds with the user that has just been patched', () => {
        const updatedUser = {
          language: "Shark",
          region: "Shark",
          platform: "Shark",
          skill_level: "Shark",
          role: "Shark",
          team_id: 2,
          avatar_url: "www.google.com/hello",
          bio: "hello there"
        };
        return request
          .patch('/api/users/1')
          .send(updatedUser)
          .expect(200)
          .then(({ body }) => {
            expect(body).to.be.an('object');
            expect(body.team_id).to.equal(2);
          });
      });
      it('PATCH/ status 204/ should update the team_id of the user to null', async () => {
        const user = {
          user_name: 'User A',
          team_id: 1,
        };
        const insertedUser = await connection('users').insert(user).returning('*');
        const response = await request
          .patch(`/api/users/${insertedUser[0].user_id}/remove-team`)
          .expect(204);
    
        const updatedUser = await connection('users')
          .where({ user_id: insertedUser[0].user_id })
          .first();
    
        expect(updatedUser.team_id).to.be.null;
      });
    it('DELETE/ status 204/ responds with a 204 and no-content', () => request.delete('/api/tactics/12').expect(204));
  })
});