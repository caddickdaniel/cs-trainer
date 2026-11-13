// Phase 7: combined rank ranges, per-map Create Tactic drafts, supplied radar
// landmarks, grenade flights in Demo Review and the timeline rows.
// The client helpers are plain TypeScript with type-only imports, so Node
// (with type stripping) loads them directly.
const fs = require('fs');
const path = require('path');
const { expect } = require('chai');
const { RANKS } = require('../domain/catalogue');
const { buildReplay, groupFlights, REPLAY_VERSION, TRAIL_STEP } = require('../services/demoParse');

const client = (file) => import(path.join(__dirname, '../client/src/lib', file));

describe('phase 7', () => {
  describe('rank requirement display', () => {
    let formatRequirement;
    before(async () => { ({ formatRequirement } = await client('rankRange.ts')); });
    const fmt = (min, max = min, platform = min.split(':')[0]) => formatRequirement(RANKS, { premier: 'Premier', faceit: 'FACEIT', esea: 'ESEA' }[platform], { min, max });

    it('shows two Level 10 bands as one badge, the platform once and one Elo range', () => {
      const d = fmt('faceit:10-2001', 'faceit:10-2251');
      expect(d.badges.map((r) => r.id)).to.deep.equal(['faceit:10-2001']);
      expect(d.text).to.equal('FACEIT (2,001–2,500)');
      expect(d.label).to.equal('FACEIT Level 10, 2,001 to 2,500 Elo');
    });

    it('handles single bands, ranges across badges, open ends and leaderboard ranks without inventing bounds', () => {
      expect(fmt('faceit:7').text).to.equal('FACEIT (1,351–1,530)');
      const across = fmt('faceit:7', 'faceit:10-2001');
      expect(across.badges.map((r) => r.id)).to.deep.equal(['faceit:7', 'faceit:10-2001']);
      expect(across.text).to.equal('FACEIT (1,351–2,250)');
      expect(fmt('faceit:10-3001').text).to.equal('FACEIT (3,001+)');
      expect(fmt('premier:25000', 'premier:30000').text).to.equal('Premier (25,000+)');
      expect(fmt('premier:20000', 'premier:22500').text).to.equal('Premier (20,000–24,999)');
      expect(fmt('esea:b-', 'esea:a').text).to.equal('ESEA (3,000–5,499)');
      // Challenger is a leaderboard distinction: no numbers for it.
      expect(fmt('faceit:challenger').text).to.equal('FACEIT Challenger (top 1,000)');
      expect(fmt('faceit:10-2501', 'faceit:challenger').text).to.equal('FACEIT (2,501+ to Challenger)');
      expect(fmt('faceit:challenger').label).to.not.match(/\d{4}/);
      expect(formatRequirement(RANKS, 'FACEIT', { min: 'faceit:nope', max: 'faceit:7' })).to.equal(null);
    });
  });

  describe('Create Tactic map drafts', () => {
    let switchMapDraft; let otherDrafts; let draftHasWork;
    before(async () => { ({ switchMapDraft, otherDrafts, draftHasWork } = await client('mapDrafts.ts')); });
    const phase = (name, markers = []) => ({ name, notes: '', board: { markers, routes: [], holds: [] }, assignments: [] });
    const fresh = () => ({ phases: [phase('Phase 1')], index: 0, level: 'main' });

    it('starts a clean board on a new map and restores each map exactly when switching back', () => {
      const mirage = { phases: [phase('Mirage exec', [{ id: 'm1', kind: 'smoke', x: 0.5, y: 0.5, level: 'main' }]), phase('Plant')], index: 1, level: 'main' };
      let state = switchMapDraft({}, 'de_mirage', mirage, 'de_inferno', fresh);
      expect(state.next).to.deep.equal(fresh());
      const inferno = { phases: [phase('Banana', [{ id: 'i1', kind: 'player', x: 0.2, y: 0.6, level: 'main', user_id: 3 }])], index: 0, level: 'main' };
      state = switchMapDraft(state.drafts, 'de_inferno', inferno, 'de_mirage', fresh);
      expect(state.next).to.equal(mirage);
      state = switchMapDraft(state.drafts, 'de_mirage', state.next, 'de_inferno', fresh);
      expect(state.next).to.equal(inferno);
      expect(otherDrafts(state.drafts, 'de_inferno', draftHasWork)).to.deep.equal(['de_mirage']);
      expect(draftHasWork(fresh())).to.equal(false);
    });
  });

  describe('radar landmarks', () => {
    it('uses the supplied percentages for the listed markers and keeps the rest', async () => {
      const { LANDMARKS } = await client('landmarks.ts');
      const at = (map, kind) => LANDMARKS[map].points.find((p) => p.kind === kind);
      const supplied = [
        ['de_mirage', 'a', 54.4, 76.7], ['de_mirage', 'b', 23, 27.9], ['de_inferno', 'a', 81.4, 68.1], ['de_inferno', 'b', 48.8, 21.9],
        ['de_overpass', 'a', 43, 19.7], ['de_overpass', 'b', 69.3, 32.2], ['de_overpass', 't', 64.8, 93.5], ['de_overpass', 'ct', 47.8, 17.1],
        ['de_train', 'a', 65, 52.3], ['de_train', 'b', 54.3, 80.7], ['de_train', 'ct', 89.8, 80.5],
      ];
      for (const [map, kind, x, y] of supplied) {
        const p = at(map, kind);
        expect(p.x, `${map} ${kind} x`).to.be.closeTo(x / 100, 1e-9);
        expect(p.y, `${map} ${kind} y`).to.be.closeTo(y / 100, 1e-9);
        expect(p.level, `${map} ${kind} floor`).to.equal('main');
        expect(LANDMARKS[map].source[kind]).to.equal('supplied');
      }
      // Not in the list: unchanged.
      expect(at('de_train', 't')).to.include({ x: 0.12, y: 0.17 });
      expect(at('de_mirage', 'ct')).to.include({ x: 0.305, y: 0.7 });
      expect(at('de_nuke', 'b').level).to.equal('lower');
    });
  });

  describe('grenade flights', () => {
    const steam = (n) => `7656119000000000${n}`;
    // A flight sample per tick, moving +10 game units in x each tick.
    const flight = (type, entity, steamid, from, to, x0 = -1000) => {
      const rows = [];
      for (let t = from; t <= to; t += 1) rows.push({ grenade_type: type, grenade_entity_id: entity, steamid, tick: t, x: x0 + (t - from) * 10, y: 0, z: 0 });
      return rows;
    };
    function demo() {
      const events = [
        { event_name: 'round_start', tick: 100 },
        { event_name: 'round_freeze_end', tick: 120 },
        { event_name: 'smokegrenade_detonate', tick: 300, entityid: 7, user_steamid: steam(1), x: -500, y: 0, z: 0 },
        { event_name: 'smokegrenade_expired', tick: 1708, entityid: 7, user_steamid: steam(1), x: -500, y: 0, z: 0 },
        { event_name: 'flashbang_detonate', tick: 504, entityid: 7, user_steamid: steam(2), x: -900, y: 0, z: 0 },
        { event_name: 'inferno_startburn', tick: 700, entityid: 40, user_steamid: steam(2), x: -600, y: 0, z: 0 },
        { event_name: 'inferno_expire', tick: 1148, entityid: 40, user_steamid: steam(2), x: -600, y: 0, z: 0 },
        // No projectile samples for this one: thrower and position only.
        { event_name: 'hegrenade_detonate', tick: 900, entityid: 50, user_steamid: steam(1), x: -700, y: 0, z: 0 },
        { event_name: 'round_end', tick: 2000, winner: 'CT', reason: 'ct_win' },
      ];
      const ticks = [];
      for (let t = 96; t <= 2200; t += 8) {
        ticks.push({ tick: t, steamid: steam(1), name: 'alpha', X: -1000, Y: 0, Z: 0, yaw: 0, is_alive: true, health: 100, team_num: 2 });
        ticks.push({ tick: t, steamid: steam(2), name: 'bravo', X: -1200, Y: 0, Z: 0, yaw: 0, is_alive: true, health: 100, team_num: 3 });
      }
      const rows = [
        // Smoke thrown at 250, rolls until it pops at 300, then the entity lingers.
        ...flight('CSmokeGrenadeProjectile', 7, steam(1), 250, 380),
        // The same entity id reused after the smoke entity is gone (a separate flight).
        ...flight('CFlashbangProjectile', 7, steam(2), 400, 506, -1200),
        // Molotov removed as the fire (a new entity) starts.
        ...flight('CMolotovProjectile', 33, steam(2), 640, 699, -1200),
        // Carried grenades and decoys are ignored.
        { grenade_type: 'CSmokeGrenade', grenade_entity_id: 99, steamid: steam(1), tick: 200, x: null, y: null, z: null },
      ];
      return { header: { map_name: 'de_mirage', server_name: 'test' }, events, ticks, flights: groupFlights(rows) };
    }

    it('groups projectile samples into flights, splitting reused entity ids', () => {
      const flights = demo().flights;
      expect(flights.map((f) => [f.type, f.entity, f.ticks[0]])).to.deep.equal([['smoke', 7, 250], ['flash', 7, 400], ['fire', 33, 640]]);
    });

    it('attaches the throw, the thrower position and the path up to detonation', () => {
      const replay = buildReplay(demo());
      expect(REPLAY_VERSION).to.equal(3);
      const ev = replay.rounds[0].data.events;
      const smoke = ev.find((e) => e.type === 'smoke');
      expect(smoke.throw_tick).to.equal(250);
      expect(smoke.from).to.include({ level: 'main' });
      // Every TRAIL_STEP ticks from the throw, then the detonation point; nothing after it.
      expect(smoke.trail.t[0]).to.equal(250);
      expect(smoke.trail.t[1] - smoke.trail.t[0]).to.equal(TRAIL_STEP);
      expect(smoke.trail.t[smoke.trail.t.length - 1]).to.equal(300);
      expect(smoke.trail.x[smoke.trail.x.length - 1]).to.equal(smoke.x);
      expect(smoke.end_tick).to.equal(1708);
      const flash = ev.find((e) => e.type === 'flash');
      expect(flash).to.include({ throw_tick: 400, player: replay.meta.players.find((p) => p.name === 'bravo').index });
      // The fire is matched to bravo's molotov whose flight ends as it starts.
      const fire = ev.find((e) => e.type === 'fire');
      expect(fire).to.include({ throw_tick: 640, variant: 'incendiary', end_tick: 1148 });
      expect(fire.trail.t[fire.trail.t.length - 1]).to.equal(700);
      // No samples: no trail, but thrower and position stay.
      const he = ev.find((e) => e.type === 'he');
      expect(he).to.not.have.property('trail');
      expect(he.player).to.be.a('number');
      expect(he.x).to.be.a('number');
    });

    it('shows a trail only while the grenade is in the air, from the tick alone', async () => {
      const { flightsAt, recordedAt } = await client('replay.ts');
      const events = buildReplay(demo()).rounds[0].data.events;
      expect(flightsAt(events, 249)).to.have.length(0);
      const mid = flightsAt(events, 275);
      expect(mid.map((f) => f.event.type)).to.deep.equal(['smoke']);
      const pts = mid[0].runs.flatMap((r) => r.points);
      expect(pts[0].x).to.be.below(mid[0].head.x);
      // Seeking back and forth gives the same answer every time.
      expect(flightsAt(events, 275)).to.deep.equal(mid);
      // Detonation clears the trail; the smoke effect takes over until it expires.
      expect(flightsAt(events, 300).some((f) => f.event.type === 'smoke')).to.equal(false);
      expect(recordedAt(events, 300).smokes).to.have.length(1);
      expect(recordedAt(events, 1707).smokes).to.have.length(1);
      expect(recordedAt(events, 1708).smokes).to.have.length(0);
      expect(flightsAt(events, 650).map((f) => f.event.type)).to.deep.equal(['fire']);
      expect(recordedAt(events, 700).fires).to.have.length(1);
    });

    it('stacks close timeline icons in rows so each stays separate', async () => {
      const { timelineRows } = await client('replay.ts');
      expect(timelineRows([0, 5, 10, 40, 41, 42, 43], 20)).to.deep.equal([0, 1, 2, 0, 1, 2, 2]);
      expect(timelineRows([0, 30, 60], 20)).to.deep.equal([0, 0, 0]);
    });

    // The 253 MB HLTV demo is not in the repository. Point DEMO_FIXTURE at it to run this.
    const fixture = process.env.DEMO_FIXTURE;
    (fixture && fs.existsSync(fixture) ? it : it.skip)('links every grenade in spirit-vs-g2-m3-ancient.dem to its flight (DEMO_FIXTURE)', function () {
      this.timeout(180000);
      const { parseDemoFile } = require('../services/demoParse');
      const replay = parseDemoFile(fixture);
      const grenades = replay.rounds.flatMap((r) => r.data.events).filter((e) => ['smoke', 'flash', 'he', 'fire'].includes(e.type));
      expect(grenades).to.have.length(391);
      for (const e of grenades) {
        expect(e.trail, `${e.type} at ${e.tick}`).to.be.an('object');
        expect(e.throw_tick).to.be.below(e.tick);
        expect(e.trail.t[e.trail.t.length - 1]).to.equal(e.tick);
        expect(e.from).to.be.an('object');
      }
    });
  });
});
