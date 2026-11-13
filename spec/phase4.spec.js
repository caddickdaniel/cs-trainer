// Phase 4: rank catalogue and profile options, Steam sign-in and linking,
// Player Stats from demos and FACEIT. Steam and FACEIT are exercised against
// local fake servers (no live provider calls in tests).
const fs = require('fs');
const http = require('http');
const { expect } = require('chai');
const { connection, reseed, signUp, supertest, app, teamWithMember, csrfFor } = require('./helpers');
const C = require('../domain/catalogue');
const config = require('../config/env');
const demoJobs = require('../services/demoJobs');

const STEAM_A = '76561198000000001';
const STEAM_B = '76561198000000002';
const DEMO_BYTES = Buffer.concat([Buffer.from('PBDEMS2\0', 'latin1'), Buffer.alloc(64, 7)]);

function fakeServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

describe('phase 4', () => {
  beforeEach(reseed);

  describe('rank catalogue', () => {
    it('maps boundary values to exactly one band', () => {
      expect(C.rankForValue('faceit', 3000).id).to.equal('faceit:10-2751');
      expect(C.rankForValue('faceit', 3001).id).to.equal('faceit:10-3001');
      expect(C.rankForValue('faceit', 2000).id).to.equal('faceit:9');
      expect(C.rankForValue('faceit', 2001).id).to.equal('faceit:10-2001');
      expect(C.rankForValue('faceit', 100).id).to.equal('faceit:1');
      expect(C.rankForValue('faceit', 500).id).to.equal('faceit:1');
      expect(C.rankForValue('faceit', 501).id).to.equal('faceit:2');
      expect(C.rankForValue('faceit', 99)).to.equal(null);
      expect(C.rankForValue('premier', 4999)).to.include({ id: 'premier:2500', colorName: 'Grey' });
      expect(C.rankForValue('premier', 5000)).to.include({ id: 'premier:5000', colorName: 'Light blue' });
      expect(C.rankForValue('premier', 9999).colorName).to.equal('Light blue');
      expect(C.rankForValue('premier', 10000).colorName).to.equal('Blue');
      expect(C.rankForValue('premier', 15000).colorName).to.equal('Purple');
      expect(C.rankForValue('premier', 20000).colorName).to.equal('Pink');
      expect(C.rankForValue('premier', 25000).colorName).to.equal('Red');
      expect(C.rankForValue('premier', 29999)).to.include({ id: 'premier:27500', colorName: 'Red' });
      expect(C.rankForValue('premier', 30000)).to.include({ id: 'premier:30000', colorName: 'Gold' });
      expect(C.rankForValue('esea', 6249).id).to.equal('esea:a+');
      expect(C.rankForValue('esea', 6250).id).to.equal('esea:g');
      expect(C.rankForValue('esea', 7500).id).to.equal('esea:s');
      // Exhaustive: no value falls into two bands of the same platform.
      for (const platform of C.PLATFORM_IDS) {
        const bands = C.ranksFor(platform).filter((r) => !r.leaderboard);
        for (let v = 0; v <= 35000; v += 1) {
          const hits = bands.filter((r) => v >= r.min && (r.max == null || v <= r.max));
          expect(hits.length, `${platform} ${v}`).to.be.at.most(1);
        }
      }
      // Challenger is a leaderboard distinction, never derived from Elo.
      expect(C.rankForValue('faceit', 5000).id).to.equal('faceit:10-3001');
    });

    it('maps legacy text only when confident', () => {
      expect(C.mapLegacyRank('FACEIT', 'Level 7')).to.deep.equal({ platform: 'faceit', rank: 'faceit:7' });
      expect(C.mapLegacyRank('faceit', '10')).to.deep.equal({ platform: 'faceit', rank: null });
      expect(C.mapLegacyRank('Faceit', '2,450')).to.deep.equal({ platform: 'faceit', rank: 'faceit:10-2251' });
      expect(C.mapLegacyRank('Premier', '18,250')).to.deep.equal({ platform: 'premier', rank: 'premier:17500' });
      expect(C.mapLegacyRank('MM', '15k')).to.deep.equal({ platform: 'premier', rank: 'premier:15000' });
      expect(C.mapLegacyRank('ESEA', 'B+')).to.deep.equal({ platform: 'esea', rank: 'esea:b+' });
      expect(C.mapLegacyRank('Perfect World', '2,800')).to.equal(null);
      expect(C.mapLegacyRank('ESEA', 'pretty good')).to.deep.equal({ platform: 'esea', rank: null });
    });
  });

  describe('profiles and player search', () => {
    it('validates catalogue options, keeps legacy values and filters players', async () => {
      const p = await signUp('Ranked');
      await connection('users').where('user_id', p.user.user_id).update({ language: 'Klingon', platform: 'Perfect World', skill_level: '2,800' });
      let res = await p.get('/api/me/profile').expect(200);
      expect(res.body.profile).to.include({ language: 'Klingon', legacy_platform: 'Perfect World', legacy_skill_level: '2,800' });
      expect(res.body.profile.ranks).to.deep.equal({ premier: null, faceit: null, esea: null });
      // The legacy value can be kept unchanged, but not set anew.
      await p.patch('/api/me/profile').send({ language: 'Klingon', bio: 'x' }).expect(200);
      await p.patch('/api/me/profile').send({ region: 'Mars' }).expect(400);
      // Phase 5: one rank per platform, each from its own platform.
      await p.patch('/api/me/profile').send({ ranks: { faceit: 'premier:5000' } }).expect(400);
      res = await p.patch('/api/me/profile').send({ language: 'Polish', region: 'EU East', ranks: { faceit: 'faceit:10-2751' } }).expect(200);
      expect(res.body.profile).to.include({ language: 'Polish', region: 'EU East' });
      expect(res.body.profile.ranks.faceit).to.equal('faceit:10-2751');

      const other = await signUp('Searcher');
      const all = (await other.get('/api/players/available').expect(200)).body.players;
      expect(all.map((x) => x.user_id)).to.include(p.user.user_id);
      const hit = (await other.get('/api/players/available?language=Polish&region=EU%20East&faceit=faceit:10-2751').expect(200)).body.players;
      expect(hit.map((x) => x.user_id)).to.deep.equal([p.user.user_id]);
      expect(hit[0].ranks).to.include({ faceit: 'faceit:10-2751' });
      expect((await other.get('/api/players/available?esea=esea:a').expect(200)).body.players.map((x) => x.user_id)).not.to.include(p.user.user_id);
      expect((await other.get('/api/catalogue').expect(200)).body.ranks.length).to.equal(C.RANKS.length);
    });
  });

  describe('Steam sign-in and linking', () => {
    let steam;
    let valid;
    const original = { endpoint: config.steamOpenIdEndpoint, origin: config.appOrigin };
    before(async () => {
      steam = await fakeServer((req, res) => {
        let body = '';
        req.on('data', (d) => { body += d; });
        req.on('end', () => {
          const params = new URLSearchParams(body);
          const ok = valid && params.get('openid.mode') === 'check_authentication' && params.get('openid.sig') === 'good-signature';
          res.setHeader('Content-Type', 'text/plain');
          res.end(`ns:http://specs.openid.net/auth/2.0\nis_valid:${ok ? 'true' : 'false'}\n`);
        });
      });
      config.steamOpenIdEndpoint = `${steam.url}/openid/login`;
      // supertest serves each request on a new port, so use a fixed public origin (as production does).
      config.appOrigin = 'https://cs-trainer.test';
    });
    after(() => { config.steamOpenIdEndpoint = original.endpoint; config.appOrigin = original.origin; steam.server.close(); });
    beforeEach(() => { valid = true; });

    // Simulates the browser round trip through Steam for one agent.
    async function steamRoundTrip(agent, { intent = 'signin', steamid = STEAM_A, sig = 'good-signature', nonce } = {}) {
      const start = await agent.get(`/api/auth/steam/start?intent=${intent}`).expect(302);
      const loc = new URL(start.headers.location);
      expect(`${loc.origin}${loc.pathname}`).to.equal(config.steamOpenIdEndpoint);
      const returnTo = loc.searchParams.get('openid.return_to');
      const claimed = `https://steamcommunity.com/openid/id/${steamid}`;
      const q = new URLSearchParams({
        'openid.ns': 'http://specs.openid.net/auth/2.0',
        'openid.mode': 'id_res',
        'openid.op_endpoint': config.steamOpenIdEndpoint,
        'openid.claimed_id': claimed,
        'openid.identity': claimed,
        'openid.return_to': returnTo,
        'openid.response_nonce': nonce || `${new Date().toISOString().slice(0, 19)}Z${Math.random().toString(36).slice(2)}`,
        'openid.assoc_handle': '1234567890',
        'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
        'openid.sig': sig,
      });
      const u = new URL(returnTo);
      return agent.get(`${u.pathname}?${u.searchParams}&${q}`).expect(302);
    }

    it('creates a Steam account, signs in again with Steam, and refuses to unlink the only sign-in method', async () => {
      const agent = supertest.agent(app);
      const cb = await steamRoundTrip(agent);
      expect(cb.headers.location).to.equal('/steam/finish');
      const pending = (await agent.get('/api/auth/steam/pending').expect(200)).body;
      expect(pending).to.include({ steamid64: STEAM_A });
      expect(pending.suggestions.profile_url).to.equal(`https://steamcommunity.com/profiles/${STEAM_A}`);
      const token = await csrfFor(agent);
      const created = (await agent.post('/api/auth/steam/complete').set('X-CSRF-Token', token)
        .send({ user_name: 'Steamy', use_profile_url: true }).expect(201)).body;
      expect(created.user).to.include({ user_name: 'Steamy', email: null });
      const userId = created.user.user_id;
      const csrf = created.csrf_token;
      expect((await agent.get('/api/me/profile').expect(200)).body.profile.steam_url).to.equal(`https://steamcommunity.com/profiles/${STEAM_A}`);
      // Only sign-in method: unlinking is refused.
      expect((await agent.delete('/api/me/identities/steam').set('X-CSRF-Token', csrf).expect(409)).body.code).to.equal('last_sign_in_method');

      // Sign out, then Continue with Steam signs back in to the same account.
      await agent.post('/api/auth/signout').set('X-CSRF-Token', csrf).expect(204);
      const again = await steamRoundTrip(agent);
      expect(again.headers.location).to.equal('/');
      expect((await agent.get('/api/auth/me').expect(200)).body.user.user_id).to.equal(userId);
      expect(await connection('user_identities').where({ provider: 'steam', subject: STEAM_A })).to.have.length(1);

      // Adding a password makes unlinking possible.
      const t2 = await csrfFor(agent);
      await agent.post('/api/me/password').set('X-CSRF-Token', t2).send({ email: 'steamy@example.test', password: 'correct-horse-battery' }).expect(200);
      const ids = (await agent.delete('/api/me/identities/steam').set('X-CSRF-Token', t2).expect(200)).body;
      expect(ids).to.include({ steam: null, has_password: true });
    });

    it('links Steam to an existing account and never takes over another account', async () => {
      const a = await signUp('Linker');
      const linked = await steamRoundTrip(a.agent, { intent: 'link', steamid: STEAM_B });
      expect(linked.headers.location).to.equal('/settings?steam=linked');
      expect((await a.get('/api/me/identities').expect(200)).body.steam.steamid64).to.equal(STEAM_B);

      // Another account trying to link the same Steam ID gets a clear error.
      const b = await signUp('Thief');
      const taken = await steamRoundTrip(b.agent, { intent: 'link', steamid: STEAM_B });
      expect(taken.headers.location).to.equal('/settings?steam_error=steam_taken');
      expect((await b.get('/api/me/identities').expect(200)).body.steam).to.equal(null);
      // A signed-out Continue with Steam opens A's account, not a new one.
      const anon = supertest.agent(app);
      expect((await steamRoundTrip(anon, { steamid: STEAM_B })).headers.location).to.equal('/');
      expect((await anon.get('/api/auth/me').expect(200)).body.user.user_id).to.equal(a.user.user_id);
      // The database enforces one account per Steam ID.
      let dup = null;
      try {
        await connection('user_identities').insert({ user_id: b.user.user_id, provider: 'steam', subject: STEAM_B });
      } catch (err) { dup = err; }
      expect(dup && dup.code).to.equal('23505');
    });

    it('links a pending Steam identity after a password sign-in only when asked', async () => {
      const existing = await signUp('Existing');
      const email = existing.user.email;
      const agent = supertest.agent(app);
      expect((await steamRoundTrip(agent, { steamid: STEAM_A })).headers.location).to.equal('/steam/finish');
      const token = await csrfFor(agent);
      const signin = await agent.post('/api/auth/signin').set('X-CSRF-Token', token).send({ email, password: 'correct-horse-battery' }).expect(200);
      // Not linked yet: signing in alone never links.
      expect((await agent.get('/api/me/identities').expect(200)).body.steam).to.equal(null);
      expect((await agent.get('/api/auth/steam/pending').expect(200)).body.signed_in_as.user_id).to.equal(existing.user.user_id);
      await agent.post('/api/me/steam/link-pending').set('X-CSRF-Token', signin.body.csrf_token).expect(200);
      expect((await agent.get('/api/me/identities').expect(200)).body.steam.steamid64).to.equal(STEAM_A);
      await agent.get('/api/auth/steam/pending').expect(404);
    });

    it('rejects unverified, replayed, forged and cross-session responses', async () => {
      const agent = supertest.agent(app);
      valid = false;
      expect((await steamRoundTrip(agent)).headers.location).to.equal('/signin?steam_error=not_verified');
      valid = true;
      const nonce = `${new Date().toISOString().slice(0, 19)}Zreplay`;
      expect((await steamRoundTrip(agent, { nonce })).headers.location).to.equal('/steam/finish');
      expect((await steamRoundTrip(supertest.agent(app), { nonce })).headers.location).to.equal('/signin?steam_error=replayed');
      expect((await steamRoundTrip(agent, { steamid: '12345' })).headers.location).to.equal('/signin?steam_error=invalid_response');
      const old = `${new Date(Date.now() - 3600 * 1000).toISOString().slice(0, 19)}Zold`;
      expect((await steamRoundTrip(agent, { nonce: old })).headers.location).to.equal('/signin?steam_error=expired');
      // A callback without this session's state is rejected.
      const other = supertest.agent(app);
      const res = await other.get(`/api/auth/steam/callback?state=nope&openid.mode=id_res`).expect(302);
      expect(res.headers.location).to.equal('/signin?steam_error=state_mismatch');
      expect(await connection('user_identities')).to.have.length(0);
    });
  });

  describe('Player Stats', () => {
    afterEach(() => {
      if (config.isTest && /demos-test$/.test(config.demoStorageDir)) fs.rmSync(config.demoStorageDir, { recursive: true, force: true });
    });

    function demoStats(overrides = {}) {
      return {
        map: 'de_mirage', tickrate: 64, meta: { players: [] }, rounds: [],
        stats: {
          version: 1, fingerprint: 'f'.repeat(64), rounds: 13, score_a: 13, score_b: 7,
          players: [
            { steamid64: STEAM_A, name: 'me', team: 'A', result: 'W', kills: 20, deaths: 0, assists: 3, headshot_kills: 10, damage: 1300, rounds_played: 20 },
            { steamid64: STEAM_B, name: 'them', team: 'B', result: 'L', kills: 5, deaths: 20, assists: 1, headshot_kills: 1, damage: 600, rounds_played: 20 },
          ],
          ...overrides,
        },
      };
    }
    const uploadDemo = (client, teamId, bytes) => client.post(`/api/teams/${teamId}/demos?file_name=m.dem`)
      .set('Content-Type', 'application/octet-stream').send(bytes).expect(201);

    it('imports demo stats once, respects opt-in and visibility, and exposes no private demo data', async () => {
      const { owner, member, teamId } = await teamWithMember();
      await connection('user_identities').insert({ user_id: member.user.user_id, provider: 'steam', subject: STEAM_A });
      const { demo } = (await uploadDemo(owner, teamId, DEMO_BYTES)).body;
      await demoJobs.processNext({ parse: async () => demoStats() });

      // Not tracked until the player opts in.
      let mine = (await member.get('/api/me/stats').expect(200)).body;
      expect(mine).to.include({ steam_linked: true, tracking: false });
      expect(mine.sources).to.have.length(0);
      await owner.patch('/api/me/stats/settings').send({ track: true }).expect(400); // owner has no Steam
      await member.patch('/api/me/stats/settings').send({ track: true }).expect(200);
      mine = (await member.get('/api/me/stats').expect(200)).body;
      const s = mine.sources[0];
      expect(s).to.include({ source: 'demo', matches: 1, wins: 1, losses: 0, kd: 20, kd_no_deaths: true, hs_pct: 0.5, adr: 65 });
      expect(s.win_rate).to.equal(1);
      expect(s.recent[0]).to.include({ result: 'W', score: '13–7', map: 'de_mirage' });

      // The same match uploaded again (another recording) doesn't add a match.
      await uploadDemo(owner, teamId, Buffer.concat([DEMO_BYTES, Buffer.from('second recording')]));
      await demoJobs.processNext({ parse: async () => demoStats() });
      expect((await member.get('/api/me/stats').expect(200)).body.sources[0].matches).to.equal(1);
      expect(await connection('matches')).to.have.length(1);

      // Profiles: private by default, aggregates only when shared.
      const outsider = await signUp('Viewer');
      await owner.delete(`/api/teams/${teamId}/members/${member.user.user_id}`).expect(204); // teamless players are discoverable
      expect((await outsider.get(`/api/players/${member.user.user_id}/stats`).expect(200)).body).to.deep.equal({ shared: false });
      await member.patch('/api/me/stats/settings').send({ visibility: 'profile' }).expect(200);
      const shared = (await outsider.get(`/api/players/${member.user.user_id}/stats`).expect(200)).body;
      expect(shared.shared).to.equal(true);
      expect(shared.sources[0].matches).to.equal(1);
      const text = JSON.stringify(shared);
      expect(text).not.to.match(/demo_id|annotation|replay|\/api\/demos/);
      await outsider.get(`/api/demos/${demo.demo_id}`).expect(404);
      await outsider.get(`/api/demos/${demo.demo_id}/rounds/1`).expect(404);
      // Empty history: no division by zero.
      const empty = await signUp('Empty');
      expect((await empty.get('/api/me/stats').expect(200)).body).to.include({ steam_linked: false, tracking: false });
    });

    it('backfills stats for demos processed before stats existed', async () => {
      const { owner, member, teamId } = await teamWithMember();
      await connection('user_identities').insert({ user_id: member.user.user_id, provider: 'steam', subject: STEAM_A });
      await uploadDemo(owner, teamId, DEMO_BYTES);
      const { stats, ...withoutStats } = demoStats();
      await demoJobs.processNext({ parse: async () => withoutStats });
      await connection('demos').update({ stats_version: 0 });
      expect(await connection('matches')).to.have.length(0);
      expect(await demoJobs.backfillNextStats({ parse: async () => ({ stats }) })).to.include({ status: 'stats_ready' });
      expect(await connection('matches')).to.have.length(1);
      expect(await demoJobs.backfillNextStats({ parse: async () => ({ stats }) })).to.equal(null);
    });

    describe('FACEIT', () => {
      let faceitApi;
      let mode;
      const saved = { key: config.faceitApiKey, base: config.faceitApiBase };
      before(async () => {
        faceitApi = await fakeServer((req, res) => {
          const json = (code, body, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
          if (req.headers.authorization !== 'Bearer test-key') return json(401, {});
          if (mode === 'rate') return json(429, {}, { 'Retry-After': '42' });
          const u = new URL(req.url, 'http://x');
          if (u.pathname === '/players' && u.searchParams.get('game_player_id') === STEAM_A) {
            return json(200, { player_id: 'fp-1', nickname: 'fragger', games: { cs2: { game_player_id: STEAM_A, faceit_elo: 2412, skill_level: 10 } } });
          }
          if (u.pathname === '/players') return json(404, {});
          if (u.pathname === '/players/fp-1') return json(200, { player_id: 'fp-1', nickname: 'fragger', games: { cs2: { faceit_elo: 2412, skill_level: 10 } } });
          if (u.pathname === '/players/fp-1/games/cs2/stats') {
            return json(200, { items: [
              { stats: { 'Match Id': '1-aaa', Map: 'de_inferno', Result: '1', Score: '13 / 9', Rounds: '22', Kills: '25', Deaths: '15', Assists: '4', Headshots: '12', ADR: '95.5', 'Match Finished At': 1794000000000 } },
              { stats: { 'Match Id': '1-bbb', Map: 'de_nuke', Result: '0', Score: '10 / 13', Rounds: '23', Kills: '14', Deaths: '18', Assists: '2', Headshots: '5' } },
            ] });
          }
          return json(404, {});
        });
      });
      after(() => { config.faceitApiKey = saved.key; config.faceitApiBase = saved.base; faceitApi.server.close(); });
      beforeEach(() => { mode = 'ok'; config.faceitApiKey = 'test-key'; config.faceitApiBase = faceitApi.url; });

      it('connects from the verified Steam ID, syncs idempotently and reports rate limits', async () => {
        const p = await signUp('Faceiter');
        expect((await p.post('/api/me/faceit').expect(400)).body.code).to.equal('steam_required');
        await connection('user_identities').insert({ user_id: p.user.user_id, provider: 'steam', subject: STEAM_A });
        const status = (await p.post('/api/me/faceit').expect(200)).body;
        expect(status.connection).to.include({ nickname: 'fragger', rating: 2412, level: 10, status: 'ok' });
        await p.patch('/api/me/stats/settings').send({ track: true }).expect(200);
        let stats = (await p.get('/api/me/stats').expect(200)).body;
        const f = stats.sources.find((x) => x.source === 'faceit');
        expect(f).to.include({ matches: 2, wins: 1, losses: 1, kd: 39 / 33 });
        expect(f.adr).to.be.closeTo(95.5, 0.1); // only the match that reports ADR
        expect(f.adr_matches).to.equal(1);
        expect(stats.providers[0]).to.include({ provider: 'faceit', rating: 2412 });
        // Re-sync never duplicates.
        await connection('provider_accounts').update({ next_sync_at: null });
        await p.post('/api/me/faceit/sync').expect(200);
        expect((await p.get('/api/me/stats').expect(200)).body.sources.find((x) => x.source === 'faceit').matches).to.equal(2);
        // Rate limited: status and message, data kept.
        mode = 'rate';
        await connection('provider_accounts').update({ next_sync_at: null });
        const limited = (await p.post('/api/me/faceit/sync').expect(200)).body;
        expect(limited.connection).to.include({ status: 'rate_limited' });
        expect(limited.connection.error).to.match(/42 seconds/);
        stats = (await p.get('/api/me/stats').expect(200)).body;
        expect(stats.sources.find((x) => x.source === 'faceit').matches).to.equal(2);
        // Disconnect removes the connection and its matches.
        await p.delete('/api/me/faceit').expect(200);
        expect((await p.get('/api/me/stats').expect(200)).body.sources).to.have.length(0);
      });

      it('reports a missing key or an unknown player clearly', async () => {
        const p = await signUp('NoFaceit');
        await connection('user_identities').insert({ user_id: p.user.user_id, provider: 'steam', subject: STEAM_B });
        expect((await p.post('/api/me/faceit').expect(404)).body.code).to.equal('faceit_not_found');
        config.faceitApiKey = null;
        expect((await p.get('/api/me/faceit').expect(200)).body).to.deep.equal({ configured: false, connection: null });
        expect((await p.post('/api/me/faceit').expect(503)).body.code).to.equal('faceit_unavailable');
      });
    });

    const fixture = process.env.CS_DEMO_FIXTURE;
    (fixture ? it : it.skip)('computes player stats from a real CS2 demo (CS_DEMO_FIXTURE)', async function realDemo() {
      this.timeout(120000);
      const result = await demoJobs.parseInChild(fixture);
      const byName = Object.fromEntries(result.stats.players.map((p) => [p.name, p]));
      // awpy-fixtures ground truth for valve-de_mirage-472514809 (csstats.gg).
      const o = byName['organner.pl free trial'];
      if (o) {
        expect(o).to.include({ kills: 27, deaths: 1, assists: 2, result: 'W' });
        expect(Math.round((o.damage / o.rounds_played) * 10) / 10).to.equal(183.2);
        expect(Math.round((100 * o.headshot_kills) / o.kills)).to.equal(41);
      }
      for (const p of result.stats.players) expect(p.steamid64).to.match(/^7656119\d{10}$/);
    });
  });
});
