process.env.NODE_ENV = 'test';
const supertest = require('supertest');
const app = require('../app');
const connection = require('../db/connection');
const { SEED_PASSWORD } = require('../db/seeds');

const reseed = () => connection.seed.run();

const emailFor = (letter) => `user-${letter.toLowerCase()}@cs-trainer.test`;

function client(agent, csrfToken) {
  const withToken = (method) => (url) => agent[method](url).set('X-CSRF-Token', csrfToken);
  return {
    agent,
    csrfToken,
    get: (url) => agent.get(url),
    post: withToken('post'),
    put: withToken('put'),
    patch: withToken('patch'),
    delete: withToken('delete'),
  };
}

async function csrfFor(agent) {
  const { body } = await agent.get('/api/auth/csrf').expect(200);
  return body.csrf_token;
}

// Signs in a seeded user by letter ("A".."L") or by email.
async function signIn(who, { password = SEED_PASSWORD, target = app } = {}) {
  const agent = supertest.agent(target);
  const email = who.includes('@') ? who : emailFor(who);
  const token = await csrfFor(agent);
  const res = await agent.post('/api/auth/signin').set('X-CSRF-Token', token)
    .send({ email, password }).expect(200);
  return Object.assign(client(agent, res.body.csrf_token), { me: res.body });
}

let counter = 0;
async function signUp(name = 'Player') {
  counter += 1;
  const agent = supertest.agent(app);
  const token = await csrfFor(agent);
  const res = await agent.post('/api/auth/signup').set('X-CSRF-Token', token).send({
    email: `${name.toLowerCase().replace(/\W/g, '')}${counter}@example.test`,
    user_name: `${name} ${counter}`,
    password: 'correct-horse-battery',
  }).expect(201);
  return Object.assign(client(agent, res.body.csrf_token), { me: res.body, user: res.body.user });
}

// A minimal valid tactic document.
function tacticDoc(players, overrides = {}) {
  const [p1, p2] = players;
  return {
    tactic_name: 'Test Split',
    map: 'practice_yard',
    side: 'T',
    economy: 'Fullbuy',
    grenade: 1,
    molly: 2,
    flash: 4,
    smoke: 3,
    phases: [
      {
        name: 'Setup',
        notes: 'Default',
        board: {
          markers: [
            { id: 'm1', kind: 'player', x: 0.25, y: 0.75, level: 'main', user_id: p1, label: 'P1', images: [] },
            { id: 'm2', kind: 'smoke', x: 0.123456, y: 0.654321, level: 'main', user_id: null, label: 'Smoke', images: [] },
          ],
          routes: [{ id: 'r1', level: 'main', user_id: p1, color: '#ff0000', points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }, { x: 0.9, y: 0.95 }] }],
        },
        assignments: [
          { user_id: p1, instruction: 'Hold mid', utility: 'Smoke window' },
          ...(p2 ? [{ user_id: p2, instruction: 'Lurk B', utility: '' }] : []),
        ],
      },
      {
        name: 'Execute',
        notes: '',
        board: { markers: [], routes: [] },
        assignments: [{ user_id: p1, instruction: 'Entry A', utility: 'Flash' }],
      },
    ],
    ...overrides,
  };
}

// Owner + member on a fresh team, joined through a real invite.
async function teamWithMember() {
  const owner = await signUp('Owner');
  const { body: created } = await owner.post('/api/teams').send({ team_name: `Squad ${counter}` }).expect(201);
  const teamId = created.teams.team_id;
  const { body: invite } = await owner.post(`/api/teams/${teamId}/invites`).send({ expires_in_hours: 24 }).expect(201);
  const member = await signUp('Member');
  await member.post(`/api/invites/${invite.token}/accept`).send({}).expect(200);
  return { owner, member, teamId, inviteToken: invite.token };
}

module.exports = {
  app,
  request: supertest(app),
  supertest,
  connection,
  reseed,
  signIn,
  signUp,
  csrfFor,
  tacticDoc,
  teamWithMember,
  SEED_PASSWORD,
};
