process.env.NODE_ENV = 'test';
const { expect } = require('chai');
const app = require('../app');
const request = require('supertest')(app);
const connection = require('../db/connection');

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
        //   console.log(body);
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
        //   console.log(body);
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
        //   console.log(body);
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
        //   console.log(body);
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
        //   console.log(body);
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
        //   console.log(body.teams);
          expect(body.teams).to.be.an('object');
          expect(body.teams.team_name).to.equal('Team B');
        })
    );
    it('GET/ status 200/ responds with a single team object that has a team name of Team A', () =>
      request
        .get('/api/teams/name/Team%20A')
        .expect(200)
        .then(({ body }) => {
        //   console.log(body.teams);
          expect(body.teams).to.be.an('object');
          expect(body.teams.team_name).to.equal('Team A');
        })
    );
    it('GET/ status 200/ responds with an array of teams that has a language of English', () =>
      request
        .get('/api/teams/lang/English')
        .expect(200)
        .then(({ body }) => {
        //   console.log(body.teams[1]);
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
        //   console.log(body.teams);
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
        //   console.log(body.teams);
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
        //   console.log(body.teams);
          expect(body.teams).to.be.an('array');
          expect(body.teams[2]).to.be.an('object');
          expect(body.teams[2].skill_level).to.equal('10');
        })
    );
    it('POST/ status 201/ responds with the posted team', () => {
        const newTeam = {
          team_name: 'Team 10',
          language: 'French',
          region: 'EU',
          platform: 'MM',
          skill_level: 'Global'
        };
        return request
          .post('/api/teams')
          .send(newTeam)
          .expect(201)
          .then(({ body }) => {
            // console.log(body);
            expect(body.teams.team_name).to.equal(newTeam.team_name);
            expect(body.teams.team_id).to.equal(13);
          });
      });
    it('DELETE/ status 204/ responds with a 204 and no-content', () => request.delete('/api/teams/12').expect(204));
  });
});