// Phase 11: Replay Inspector — inspectable events and navigation, tactical
// data for kills and throws, safe export names, and the capture API (which
// validates requests and reports that first-person capture is unavailable).
const path = require('path');
const zlib = require('zlib');
const { expect } = require('chai');
const { connection, reseed, teamWithMember } = require('./helpers');
const { buildReplay, REPLAY_VERSION } = require('../services/demoParse');

const client = (file) => import(path.join(__dirname, '../client/src/lib', file));
const steam = (n) => `7656119000000000${n}`;

// Killer (T, west) faces east at the victim (CT, east, facing north); a smoke
// thrown by the killer is linked to its projectile.
function demo() {
  const events = [
    { event_name: 'round_start', tick: 100 },
    { event_name: 'round_freeze_end', tick: 164 },
    { event_name: 'smokegrenade_detonate', tick: 400, entityid: 7, user_steamid: steam(1), x: -1000, y: 0, z: 0 },
    { event_name: 'player_death', tick: 500, user_steamid: steam(2), attacker_steamid: steam(1), weapon: 'ak47', headshot: true, penetrated: 0, user_X: 0, user_Y: 0, user_Z: 0 },
    { event_name: 'round_end', tick: 900, winner: 'T', reason: 't_killed', total_rounds_played: 1 },
  ];
  const ticks = [];
  for (let t = 96; t <= 1100; t += 8) {
    ticks.push({ tick: t, steamid: steam(1), name: 'alpha', X: -1000, Y: 0, Z: 0, yaw: 0, is_alive: true, health: 100, team_num: 2 });
    ticks.push({ tick: t, steamid: steam(2), name: 'bravo', X: 0, Y: 0, Z: 0, yaw: 90, is_alive: t < 500, health: t < 500 ? 100 : 0, team_num: 3 });
  }
  const flights = [{ entity: 7, type: 'smoke', steamid: steam(1), ticks: [300, 304, 400], x: [-1500, -1300, -1000], y: [0, 0, 0], z: [0, 0, 0] }];
  return buildReplay({ header: { map_name: 'de_mirage' }, events, ticks, flights });
}

describe('phase 11', () => {
  const replay = demo();
  const round = replay.rounds[0].data;
  const idx = (name) => replay.meta.players.find((p) => p.name === name).index;

  describe('inspector helpers', () => {
    let i; let r;
    before(async () => { i = await client('inspector.ts'); r = await client('replay.ts'); });

    it('lists kills and linked throws by their moment and steps between them', () => {
      const ev = round.events;
      const kill = ev.findIndex((e) => e.type === 'kill');
      const smoke = ev.findIndex((e) => e.type === 'smoke');
      expect(i.eventMoment(ev[smoke])).to.equal(300); // the release, not the detonation
      expect(i.inspectableIndexes(ev)).to.deep.equal([smoke, kill]);
      expect(i.inspectableIndexes(ev, 'kill')).to.deep.equal([kill]);
      expect(i.inspectableIndexes(ev, 'utility')).to.deep.equal([smoke]);
      expect(i.neighbourIndex(ev, smoke, 1)).to.equal(kill);
      expect(i.neighbourIndex(ev, kill, 1)).to.equal(null);
      expect(i.neighbourIndex(ev, kill, -1, 'utility')).to.equal(smoke);
      // Round end isn't inspectable.
      expect(i.inspectable(ev.find((e) => e.type === 'round_end'))).to.equal(false);
    });

    it('uses the victim\'s last alive sample before death, and works out distance and facing from the demo', () => {
      const kill = round.events.find((e) => e.type === 'kill');
      expect(i.victimLastAliveTick(round, kill.victim, kill.tick)).to.equal(496);
      const k = i.killTactics(round, kill, r.frameAt);
      expect(k.victimTick).to.equal(496);
      expect(k.killer.player).to.equal(idx('alpha'));
      expect(k.distanceUnits).to.be.closeTo(1000, 2);
      expect(k.sameFloor).to.equal(true);
      // alpha faces east (yaw 0) straight at bravo; bravo faces north, 90° off.
      expect(k.killerFacingOff).to.equal(0);
      expect(k.victimFacingOff).to.equal(90);
    });

    it('describes a throw: release, flight time, from, landing and how it was linked', () => {
      const smoke = round.events.find((e) => e.type === 'smoke');
      const u = i.utilityTactics(round, smoke, 64);
      expect(u).to.include({ thrower: idx('alpha'), releaseTick: 300, linked: true });
      expect(u.flightSeconds).to.be.closeTo(100 / 64, 1e-9);
      expect(u.landed).to.not.equal(null);
      expect(i.stepTicks(0.25, 64)).to.equal(16);
      expect(i.stepTicks(0.1, 128)).to.equal(13);
      expect(i.mediaFileName({ map: 'de_mirage', round: 4, kind: 'kill/pov', player: '../evil name', tick: 500, ext: 'jpg' }))
        .to.equal('de_mirage_r4_kill-pov_evil-name_t500.jpg');
    });
  });

  describe('capture API', () => {
    const captures = require('../services/captures');
    beforeEach(reseed);
    afterEach(() => { captures._test.setEnabled(false); captures._test.setDriver(null); });

    async function readyDemo() {
      const t = await teamWithMember();
      const [d] = await connection('demos').insert({
        team_id: t.teamId, uploaded_by: t.owner.user.user_id, title: 'Inspector demo', original_name: 'i.dem', byte_size: 10, sha256: 'c'.repeat(64),
        storage_key: 'i.dem', status: 'ready', map: 'de_mirage', tickrate: 64, round_count: 1, replay_version: REPLAY_VERSION, meta: JSON.stringify(replay.meta),
      }).returning('*');
      const rr = replay.rounds[0];
      await connection('demo_rounds').insert({ demo_id: d.demo_id, round_number: 1, start_tick: rr.start_tick, freeze_end_tick: rr.freeze_end_tick, end_tick: rr.end_tick,
        winner: rr.winner, data: zlib.gzipSync(JSON.stringify(rr.data)) });
      return { ...t, demo: d };
    }
    const kill = () => round.events.findIndex((e) => e.type === 'kill');
    const smoke = () => round.events.findIndex((e) => e.type === 'smoke');
    it('refuses capture with the reason while the worker is off, after validating the request', async () => {
      const { member, demo: d } = await readyDemo();
      const url = `/api/demos/${d.demo_id}/captures`;
      const status = (await member.get(url).expect(200)).body;
      expect(status).to.include({ enabled: false, available: false });
      expect(status.reason).to.match(/turned off/);
      expect(status.captures).to.deep.equal([]);
      const other = await teamWithMember();
      await other.member.get(url).expect(404);

      const res = await member.post(url).send({ kind: 'kill', round_number: 1, event_index: kill() }).expect(503);
      expect(res.body.code).to.equal('capture_unavailable');
      expect(res.body.status.available).to.equal(false);
      await member.post(url).send({ kind: 'utility', round_number: 1, event_index: smoke() }).expect(503);
      await member.post(url).send({ kind: 'utility', round_number: 1, event_index: kill() }).expect(400);
      await member.post(url).send({ kind: 'kill', round_number: 1, event_index: 999 }).expect(404);
      await member.post(url).send({ kind: 'kill', round_number: 7, event_index: 0 }).expect(404);
      await member.post(url).send({ kind: 'kill', round_number: 1, event_index: -1 }).expect(400);
      // No paths, commands or unknown fields from the client.
      await member.post(url).send({ kind: 'kill', round_number: 1, event_index: kill(), path: '/etc/passwd' }).expect(400);
      await member.post(url).send({ kind: 'video', round_number: 1, event_index: kill() }).expect(400);
      await other.member.post(url).send({ kind: 'kill', round_number: 1, event_index: kill() }).expect(404);
    });

    it('picks the same victim frame as the inspector', async () => {
      const i = await client('inspector.ts');
      const k = round.events.find((e) => e.type === 'kill');
      expect(captures.victimLastAliveTick(round, k.victim, k.tick)).to.equal(i.victimLastAliveTick(round, k.victim, k.tick));
    });
  });
});
