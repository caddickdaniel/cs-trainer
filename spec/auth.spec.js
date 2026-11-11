const { expect } = require('chai');
const {
  request, supertest, connection, reseed, signIn, signUp, csrfFor, SEED_PASSWORD,
} = require('./helpers');
const { createApp } = require('../app');

describe('auth', () => {
  beforeEach(reseed);

  it('signs up a user without a team and keeps them signed in', async () => {
    const player = await signUp('Fresh');
    expect(player.me.user.user_name).to.match(/^Fresh/);
    expect(player.me.teams).to.deep.equal([]);
    expect(player.me.active_team).to.equal(null);
    const { body } = await player.get('/api/auth/me').expect(200);
    expect(body.user.user_id).to.equal(player.user.user_id);
    const row = await connection('users').where('user_id', player.user.user_id).first();
    expect(row.password_hash).to.match(/^\$2[aby]\$/);
    expect(row.password_hash).to.not.include('correct-horse');
  });

  it('rejects duplicate emails (case-insensitive) and weak input', async () => {
    const agent = supertest.agent(require('../app'));
    const token = await csrfFor(agent);
    await agent.post('/api/auth/signup').set('X-CSRF-Token', token)
      .send({ email: 'USER-A@cs-trainer.test', user_name: 'Dup', password: 'long-enough-pass' })
      .expect(409);
    const { body } = await agent.post('/api/auth/signup').set('X-CSRF-Token', token)
      .send({ email: 'not-an-email', user_name: 'x', password: 'short' })
      .expect(400);
    expect(body.code).to.equal('validation_failed');
    expect(body.issues.map((i) => i.path)).to.include.members(['email', 'user_name', 'password']);
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const agent = supertest.agent(require('../app'));
    const token = await csrfFor(agent);
    const wrong = await agent.post('/api/auth/signin').set('X-CSRF-Token', token)
      .send({ email: 'user-a@cs-trainer.test', password: 'wrong-password' }).expect(401);
    const unknown = await agent.post('/api/auth/signin').set('X-CSRF-Token', token)
      .send({ email: 'nobody@example.test', password: 'wrong-password' }).expect(401);
    expect(wrong.body).to.deep.equal(unknown.body);
  });

  it('legacy users without a password cannot sign in', async () => {
    await connection('users').where('user_id', 3).update({ password_hash: null });
    const agent = supertest.agent(require('../app'));
    const token = await csrfFor(agent);
    await agent.post('/api/auth/signin').set('X-CSRF-Token', token)
      .send({ email: 'user-c@cs-trainer.test', password: SEED_PASSWORD }).expect(401);
  });

  it('signs out and forgets the session', async () => {
    const a = await signIn('A');
    await a.post('/api/auth/signout').send({}).expect(204);
    const { body } = await a.get('/api/auth/me').expect(200);
    expect(body.user).to.equal(null);
    await a.get('/api/teams').expect(401);
  });

  it('issues an HttpOnly, SameSite=Lax session cookie and rotates it on sign-in', async () => {
    const agent = supertest.agent(require('../app'));
    const csrfRes = await agent.get('/api/auth/csrf').expect(200);
    const before = csrfRes.headers['set-cookie'][0];
    const res = await agent.post('/api/auth/signin').set('X-CSRF-Token', csrfRes.body.csrf_token)
      .send({ email: 'user-a@cs-trainer.test', password: SEED_PASSWORD }).expect(200);
    const after = res.headers['set-cookie'][0];
    expect(after).to.match(/^cst\.sid=/);
    expect(after).to.include('HttpOnly');
    expect(after).to.include('SameSite=Lax');
    expect(after).to.not.include('Secure'); // only set in production / COOKIE_SECURE=true
    expect(after.split(';')[0]).to.not.equal(before.split(';')[0]);
  });

  describe('CSRF protection', () => {
    it('rejects cookie-authenticated mutations without a token', async () => {
      const a = await signIn('A');
      const { body } = await a.agent.patch('/api/teams/1').send({ team_name: 'x' }).expect(403);
      expect(body.code).to.equal('csrf_invalid');
    });
    it('rejects a token issued to a different session', async () => {
      const a = await signIn('A');
      const b = await signIn('B');
      await a.agent.patch('/api/users/1').set('X-CSRF-Token', b.csrfToken).send({ bio: 'x' }).expect(403);
    });
    it('rejects sign-in without a token', () =>
      request.post('/api/auth/signin').send({ email: 'user-a@cs-trainer.test', password: SEED_PASSWORD }).expect(403));
  });

  it('rate limits repeated sign-in attempts', async () => {
    const limited = createApp({ authRateLimit: 3, apiRateLimit: 1000 });
    const agent = supertest.agent(limited);
    const token = await csrfFor(agent);
    for (let i = 0; i < 3; i += 1) {
      await agent.post('/api/auth/signin').set('X-CSRF-Token', token)
        .send({ email: 'user-a@cs-trainer.test', password: 'wrong-password' }).expect(401);
    }
    const { body } = await agent.post('/api/auth/signin').set('X-CSRF-Token', token)
      .send({ email: 'user-a@cs-trainer.test', password: SEED_PASSWORD }).expect(429);
    expect(body.code).to.equal('rate_limited');
  });
});
