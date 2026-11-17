// Phase 8: Demo Review HUD and scoreboard data (parser output and the
// tick-derived client helpers), round notes, saving notes and annotations
// (drafts, live review promotion, conflicts) and text annotation edits.
const path = require('path');
const { pathToFileURL } = require('url');
const zlib = require('zlib');
const { expect } = require('chai');
const { connection, reseed, teamWithMember } = require('./helpers');
const { buildReplay, equipmentOf, REPLAY_VERSION, statDeltas } = require('../services/demoParse');

// A file:// URL, since import() rejects absolute Windows paths such as C:...
const client = (file) => import(pathToFileURL(path.join(__dirname, '../client/src/lib', file)).href);
const steam = (n) => `7656119000000000${n}`;

// Two players (alpha T, bravo CT) over two rounds, with money, armour, kit,
// weapons, utility, a flash on bravo, kills, damage, assists and a plant.
function hudDemo() {
  const events = [
    { event_name: 'round_start', tick: 100 },
    { event_name: 'round_freeze_end', tick: 164 },
    { event_name: 'player_hurt', tick: 300, user_steamid: steam(2), attacker_steamid: steam(1), dmg_health: 40, health: 60 },
    { event_name: 'flashbang_detonate', tick: 400, entityid: 5, user_steamid: steam(1), x: 0, y: 0, z: 0 },
    { event_name: 'player_hurt', tick: 500, user_steamid: steam(2), attacker_steamid: steam(1), dmg_health: 100, health: 0 },
    { event_name: 'player_death', tick: 500, user_steamid: steam(2), attacker_steamid: steam(1), headshot: true, weapon: 'ak47' },
    { event_name: 'bomb_planted', tick: 600, user_steamid: steam(1), user_X: 0, user_Y: 0, user_Z: 0 },
    { event_name: 'round_end', tick: 1000, winner: 'T', reason: 'bomb_exploded', total_rounds_played: 1 },
    { event_name: 'round_start', tick: 1300 },
    { event_name: 'round_freeze_end', tick: 1364 },
    { event_name: 'player_hurt', tick: 1500, user_steamid: steam(1), attacker_steamid: steam(2), dmg_health: 30, health: 70 },
    { event_name: 'round_end', tick: 2000, winner: 'CT', reason: 'ct_killed', total_rounds_played: 2 },
  ];
  const ticks = [];
  const row = (tick, n, extra) => ({
    tick, steamid: steam(n), name: n === 1 ? 'alpha' : 'bravo', X: 0, Y: 0, Z: 0, yaw: 0, is_alive: true, health: 100, team_num: n === 1 ? 2 : 3,
    balance: 800, armor_value: 0, has_helmet: false, has_defuser: false, active_weapon_name: 'Glock-18', inventory: ['Glock-18'],
    flash_duration: 0, team_clan_name: n === 1 ? 'Reds' : 'Blues', ...extra,
  });
  for (let t = 96; t <= 2200; t += 8) {
    ticks.push(row(t, 1, t >= 200 ? { balance: 0, armor_value: 100, has_helmet: true, active_weapon_name: 'AK-47',
      inventory: ['Karambit', 'AK-47', 'Flashbang', 'C4 Explosive', 'Smoke Grenade'] } : {}));
    ticks.push(row(t, 2, {
      ...(t >= 200 ? { balance: 50, armor_value: 100, has_defuser: true, inventory: ['USP-S', 'M4A4', 'High Explosive Grenade'], active_weapon_name: 'M4A4' } : {}),
      ...(t >= 400 ? { flash_duration: 2.5 } : {}),
      ...(t >= 500 && t < 1300 ? { is_alive: false, health: 0 } : {}),
    }));
  }
  // Flash detection samples either side of the detonation.
  ticks.push(row(399, 1, {}), row(399, 2, { flash_duration: 0 }), row(402, 1, {}), row(402, 2, { flash_duration: 2.5 }));
  return { header: { map_name: 'de_mirage', server_name: 'test' }, events, ticks };
}

describe('phase 8', () => {
  describe('HUD and scoreboard replay data', () => {
    const replay = buildReplay(hudDemo());
    const r1 = replay.rounds[0].data;
    const r2 = replay.rounds[1].data;
    const slotOf = (round, name) => round.roster.findIndex((p) => replay.meta.players[p.player].name === name);

    it('records equipment and money changes, flashes, team names and the score before each round', () => {
      expect(replay.meta.replay_version).to.equal(REPLAY_VERSION).and.to.be.at.least(4);
      const alpha = r1.state[slotOf(r1, 'alpha')];
      expect(alpha[0]).to.include({ money: 800, armor: 0, helmet: 0, weapon: 'Glock-18', bomb: 0 });
      const bought = alpha.find((e) => e.t >= 200);
      expect(bought).to.include({ money: 0, armor: 100, helmet: 1, weapon: 'AK-47', bomb: 1 });
      expect(bought.utility).to.deep.equal(['flash', 'smoke']);
      // Only changes are stored.
      expect(alpha.length).to.be.below(5);
      const bravo = r1.state[slotOf(r1, 'bravo')].find((e) => e.t >= 200);
      expect(bravo).to.include({ kit: 1, weapon: 'M4A4' });
      expect(r1.flashes).to.deep.equal([{ tick: 400, player: r1.roster[slotOf(r1, 'bravo')].player, by: r1.roster[slotOf(r1, 'alpha')].player, duration: 160 }]);
      expect(r1.teams).to.deep.equal({ CT: 'Blues', T: 'Reds' });
      expect(r1.score_before).to.deep.equal({ ct: 0, t: 0 });
      expect(r2.score_before).to.deep.equal({ ct: 0, t: 1 });
    });

    it('carries totals before each round and the changes during it, matching the match stats', () => {
      const a = slotOf(r2, 'alpha');
      expect(r1.stats_before.every((s) => s.kills === 0 && s.damage === 0)).to.equal(true);
      expect(r2.stats_before[a]).to.deep.equal({ kills: 1, deaths: 0, assists: 0, headshots: 1, damage: 100 });
      expect(r1.stat_events.map((e) => [e.tick, e.stat, e.n])).to.deep.equal([[300, 'damage', 40], [500, 'damage', 60], [500, 'deaths', 1], [500, 'kills', 1], [500, 'headshots', 1]]);
      const statsBy = Object.fromEntries(replay.stats.players.map((p) => [p.name, p]));
      expect(statsBy.alpha).to.include({ kills: 1, deaths: 0, headshot_kills: 1, damage: 100 });
      expect(statsBy.bravo).to.include({ kills: 0, deaths: 1, damage: 30 });
    });

    it('marks fields the demo does not carry as unavailable instead of inventing them', () => {
      expect(equipmentOf({ steamid: '1' })).to.deep.equal({ money: null, armor: null, helmet: null, kit: null, weapon: null, utility: null, bomb: null, best: null, score: null });
      // Team kills and flash assists don't count, as in the match stats.
      const idx = (s) => ({ a: 0, b: 1, c: 2 })[s] ?? null;
      const teamOf = new Map([[0, 'A'], [1, 'A'], [2, 'B']]);
      const d = statDeltas([
        { event_name: 'player_death', tick: 1, user_steamid: 'b', attacker_steamid: 'a' },
        { event_name: 'player_death', tick: 2, user_steamid: 'c', attacker_steamid: 'a', assister_steamid: 'b', assistedflash: true },
      ], idx, teamOf);
      expect(d.map((e) => [e.player, e.stat])).to.deep.equal([[1, 'deaths'], [2, 'deaths'], [0, 'kills']]);
    });

    // The 253 MB HLTV demo is not in the repository. Point DEMO_FIXTURE at it to run this.
    const fixture = process.env.DEMO_FIXTURE;
    (fixture && require('fs').existsSync(fixture) ? it : it.skip)('reads HUD and scoreboard data from spirit-vs-g2-m3-ancient.dem (DEMO_FIXTURE)', function () {
      this.timeout(180000);
      const { parseDemoFile } = require('../services/demoParse');
      const real = parseDemoFile(fixture);
      const rounds = real.rounds.map((r) => r.data);
      expect(rounds).to.have.length(18);
      expect(rounds[0].teams).to.deep.equal({ CT: 'Spirit', T: 'G2' });
      expect(rounds[4].score_before).to.deep.equal({ ct: 4, t: 0 });
      // Every player has money, armour, kit, weapon and utility state in every round.
      for (const r of rounds) {
        expect(r.state).to.have.length(r.roster.length);
        for (const list of r.state) {
          expect(list.length).to.be.above(0);
          expect(list.every((e) => e.money != null && e.armor != null && e.kit != null && Array.isArray(e.utility))).to.equal(true);
        }
      }
      const flashes = rounds.flatMap((r) => r.flashes);
      expect(flashes.length).to.be.above(50);
      expect(flashes.every((f) => f.duration > 0 && f.duration < 64 * 6)).to.equal(true);
      // Scoreboard totals at the end equal the match stats.
      const last = rounds[rounds.length - 1];
      const totals = new Map(last.roster.map((p, i) => [p.player, { ...last.stats_before[i] }]));
      for (const e of last.stat_events) totals.get(e.player)[e.stat] += e.n;
      for (const p of real.stats.players) {
        const idx = real.meta.players.find((x) => x.name === p.name).index;
        expect(totals.get(idx)).to.deep.equal({ kills: p.kills, deaths: p.deaths, assists: p.assists, headshots: p.headshot_kills, damage: p.damage });
      }
    });

    describe('client helpers (derived from the tick alone)', () => {
      let h;
      before(async () => { h = await client('replay.ts'); });
      const round = () => ({ ...r1, ct_score: 0, t_score: 1 });

      it('shows equipment, money and scoreboard totals at any tick, restoring earlier values when seeking back', () => {
        const a = slotOf(r1, 'alpha');
        expect(h.equipmentAt(round(), a, 150)).to.include({ money: 800, weapon: 'Glock-18' });
        expect(h.equipmentAt(round(), a, 900)).to.include({ money: 0, weapon: 'AK-47' });
        expect(h.equipmentAt(round(), a, 150)).to.include({ money: 800 });
        expect(h.totalsAt(round(), 499)[a]).to.include({ kills: 0, damage: 40 });
        expect(h.totalsAt(round(), 500)[a]).to.include({ kills: 1, damage: 100, headshots: 1 });
        expect(h.totalsAt(round(), 200)[a]).to.include({ kills: 0, damage: 0 });
        expect(h.headshotPct({ kills: 3, headshots: 1 })).to.equal(33);
        expect(h.headshotPct({ kills: 0, headshots: 0 })).to.equal(0);
        expect(h.totalsAt({ ...round(), stats_before: undefined }, 500)).to.equal(null);
      });

      it('fades a flashed player from white over the recorded duration, including after a seek', () => {
        const bravo = r1.roster[slotOf(r1, 'bravo')].player;
        expect(h.flashAmount(round(), bravo, 399)).to.equal(0);
        expect(h.flashAmount(round(), bravo, 400)).to.equal(1);
        expect(h.flashAmount(round(), bravo, 480)).to.be.closeTo(0.5, 1e-9);
        expect(h.flashAmount(round(), bravo, 560)).to.equal(0);
        // Jumping straight into the middle of the flash.
        expect(h.flashAmount(round(), bravo, 440)).to.be.closeTo(0.75, 1e-9);
      });

      it('runs the bomb countdown from replay time and clears it on defuse, explosion or round end', () => {
        const plant = { tick: 600, type: 'plant' };
        const ev = (extra = []) => [plant, ...extra, { tick: 9000, type: 'round_end' }];
        expect(h.bombAt(ev(), 599, 64)).to.equal(null);
        expect(h.bombAt(ev(), 600, 64).left).to.equal(1);
        expect(h.bombAt(ev(), 600 + 20 * 64, 64).left).to.be.closeTo(0.5, 1e-9);
        expect(h.bombAt(ev(), 600 + 40 * 64, 64)).to.equal(null);
        expect(h.bombAt(ev([{ tick: 700, type: 'defuse' }]), 701, 64)).to.equal(null);
        expect(h.bombAt(ev([{ tick: 700, type: 'explode' }]), 700, 64)).to.equal(null);
        expect(h.bombAt([plant, { tick: 650, type: 'round_end' }], 660, 64)).to.equal(null);
      });

      it('keeps the in-game round clock separate from the playback position, with the score after the result', () => {
        const info = { start_tick: 100, freeze_end_tick: 164, end_tick: 1192 };
        expect(h.hudClock(info, [], 100, 64)).to.deep.equal({ kind: 'freeze', text: '0:01' });
        expect(h.hudClock(info, [], 164, 64)).to.deep.equal({ kind: 'live', text: '1:55' });
        expect(h.hudClock(info, [], 164 + 64 * 60, 64).text).to.equal('0:55');
        expect(h.hudClock(info, [{ tick: 600, type: 'plant' }], 700, 64).kind).to.equal('bomb');
        expect(h.hudClock(info, [{ tick: 1000, type: 'round_end' }], 1000, 64).kind).to.equal('over');
        expect(h.playbackText(info, 164 + 64 * 30, 64)).to.equal('0:30 / 0:16');
        expect(h.hudScore(round(), 900)).to.deep.equal({ ct: 0, t: 0 });
        expect(h.hudScore(round(), 1000)).to.deep.equal({ ct: 0, t: 1 });
      });
    });
  });

  describe('calendar dates (dd/mm/yyyy)', () => {
    let t;
    before(async () => { t = await client('time.ts'); });

    it('shows and reads dates as dd/mm/yyyy, rejecting impossible dates', () => {
      expect(t.formatDMY(new Date(2026, 10, 5))).to.equal('05/11/2026');
      expect(t.isoToDMY('2026-11-20')).to.equal('20/11/2026');
      expect(t.dmyToIso('20/11/2026')).to.equal('2026-11-20');
      expect(t.dmyToIso(' 5/1/2027 ')).to.equal('2027-01-05');
      expect(t.dmyToIso('31/02/2026')).to.equal(null);
      expect(t.dmyToIso('11/20/2026')).to.equal(null);
      expect(t.dmyToIso('2026-11-20')).to.equal(null);
      expect(t.formatEventTime(new Date(2026, 10, 20, 19, 0).toISOString())).to.match(/ 20\/11\/2026, /);
    });
  });

  describe('round notes and saving', () => {
    beforeEach(reseed);

    async function readyDemo() {
      const t = await teamWithMember();
      const replay = buildReplay(hudDemo());
      const [demo] = await connection('demos').insert({
        team_id: t.teamId, uploaded_by: t.owner.user.user_id, title: 'Notes demo', original_name: 'n.dem', byte_size: 10, sha256: 'b'.repeat(64),
        storage_key: 'n.dem', status: 'ready', map: 'de_mirage', tickrate: 64, round_count: 2, replay_version: REPLAY_VERSION, meta: JSON.stringify(replay.meta),
      }).returning('*');
      for (const r of replay.rounds) {
        await connection('demo_rounds').insert({
          demo_id: demo.demo_id, round_number: r.round_number, start_tick: r.start_tick, freeze_end_tick: r.freeze_end_tick, end_tick: r.end_tick,
          winner: r.winner, data: zlib.gzipSync(JSON.stringify(r.data)),
        });
      }
      // The owner leads the team; make them its IGL for live reviews.
      await connection('team_memberships').where({ team_id: t.teamId, user_id: t.owner.user.user_id }).update({ player_role: 'igl', is_igl: true });
      return { ...t, demo };
    }
    const text = (round, extra = {}) => ({ kind: 'text', round_number: round, tick: 400, level: 'main', data: { x: 0.4, y: 0.6, text: 'Rotate B', size: 30 }, ...extra });

    it('keeps new annotations as drafts until saved, then shows notes and annotations to teammates', async () => {
      const { owner, member, demo } = await readyDemo();
      const id = demo.demo_id;
      const { annotation } = (await member.post(`/api/demos/${id}/annotations`).send(text(1)).expect(201)).body;
      expect(annotation).to.include({ saved: false, tick: 400, level: 'main', round_number: 1 });
      expect(annotation.data).to.include({ text: 'Rotate B', size: 30 });
      await member.post(`/api/demos/${id}/annotations`).send(text(2, { data: { x: 0.1, y: 0.1, text: 'Round 2 call' } })).expect(201);
      // A teammate doesn't see someone else's drafts.
      expect((await owner.get(`/api/demos/${id}/annotations?round=1`).expect(200)).body.annotations).to.have.length(0);
      expect((await member.get(`/api/demos/${id}/annotations?round=1`).expect(200)).body.annotations).to.have.length(1);

      // Text content and size can be edited.
      await member.patch(`/api/demos/${id}/annotations/${annotation.annotation_id}`).send({ text: 'Rotate B early', size: 34 }).expect(200);
      await member.patch(`/api/demos/${id}/annotations/${annotation.annotation_id}`).send({ size: 200 }).expect(400);
      await member.patch(`/api/demos/${id}/annotations/${annotation.annotation_id}`).send({ utility: 'smoke' }).expect(400);

      const saved = (await member.post(`/api/demos/${id}/save`).send({
        notes: [{ round_number: 1, body: 'Lost the retake', expected_version: 0 }, { round_number: 2, body: 'Good hit', expected_version: 0 }],
      }).expect(200)).body;
      expect(saved.saved_annotations).to.equal(2);
      expect(saved.notes.map((n) => [n.round_number, n.body, n.version])).to.deep.equal([[1, 'Lost the retake', 1], [2, 'Good hit', 1]]);

      // Reopened by a teammate: both rounds' content is there.
      const notes = (await owner.get(`/api/demos/${id}/notes`).expect(200)).body.notes;
      expect(notes.map((n) => [n.round_number, n.body, n.updated_by.user_name])).to.deep.equal([[1, 'Lost the retake', member.user.user_name], [2, 'Good hit', member.user.user_name]]);
      const r1 = (await owner.get(`/api/demos/${id}/annotations?round=1`).expect(200)).body.annotations;
      expect(r1).to.have.length(1);
      expect(r1[0]).to.include({ saved: true, tick: 400, level: 'main' });
      expect(r1[0].data).to.include({ text: 'Rotate B early', size: 34 });
      expect((await owner.get(`/api/demos/${id}/annotations?round=2`).expect(200)).body.annotations[0].data.text).to.equal('Round 2 call');
    });

    it('reports a note saved by someone else since it was loaded instead of overwriting it', async () => {
      const { owner, member, demo } = await readyDemo();
      const id = demo.demo_id;
      await owner.post(`/api/demos/${id}/save`).send({ notes: [{ round_number: 1, body: 'Owner notes', expected_version: 0 }] }).expect(200);
      const res = await member.post(`/api/demos/${id}/save`).send({ notes: [{ round_number: 1, body: 'Member notes', expected_version: 0 }] }).expect(409);
      expect(res.body.code).to.equal('notes_conflict');
      expect(res.body.notes[0]).to.include({ round_number: 1, body: 'Owner notes', version: 1 });
      expect((await member.get(`/api/demos/${id}/notes`).expect(200)).body.notes[0].body).to.equal('Owner notes');
      // With the current version it saves.
      await member.post(`/api/demos/${id}/save`).send({ notes: [{ round_number: 1, body: 'Merged notes', expected_version: 1 }] }).expect(200);
      await member.post(`/api/demos/${id}/save`).send({ notes: [{ round_number: 9, body: 'x' }] }).expect(400);
    });

    it('shows saved content in a live review and lets the IGL keep the live drawings', async () => {
      const { owner, member, teamId, demo } = await readyDemo();
      const id = demo.demo_id;
      await member.post(`/api/demos/${id}/annotations`).send(text(1)).expect(201);
      await member.post(`/api/demos/${id}/save`).send({ notes: [{ round_number: 1, body: 'Saved before the review', expected_version: 0 }] }).expect(200);

      const { review } = (await owner.post(`/api/teams/${teamId}/review`).send({ demo_id: id }).expect(201)).body;
      expect(review.note).to.include({ round_number: 1, body: 'Saved before the review' });
      expect(review.annotations.map((a) => [a.data.text, a.saved])).to.deep.equal([['Rotate B', true]]);

      const live = (await owner.post(`/api/reviews/${review.review_id}/annotations`).send(text(1, { data: { x: 0.2, y: 0.2, text: 'Live call' } })).expect(201)).body.review;
      const liveText = live.annotations.find((a) => a.data.text === 'Live call');
      expect(liveText).to.include({ saved: false, review_id: review.review_id });
      // The IGL edits the live text; the follower sees it.
      await owner.patch(`/api/reviews/${review.review_id}/annotations/${liveText.annotation_id}`).send({ text: 'Live call: fake A', size: 28 }).expect(200);
      const followed = (await member.get(`/api/teams/${teamId}/review`).expect(200)).body.review;
      expect(followed.annotations.find((a) => a.annotation_id === liveText.annotation_id).data).to.include({ text: 'Live call: fake A', size: 28 });

      // Only the IGL can keep the review's drawings.
      await member.post(`/api/demos/${id}/save`).send({ review_id: review.review_id }).expect(403);
      const res = (await owner.post(`/api/demos/${id}/save`).send({ review_id: review.review_id, notes: [{ round_number: 1, body: 'Updated live', expected_version: 1 }] }).expect(200)).body;
      expect(res.saved_annotations).to.equal(1);
      const after = (await member.get(`/api/teams/${teamId}/review`).expect(200)).body.review;
      expect(after.note.body).to.equal('Updated live');
      expect(after.version).to.be.above(followed.version);
      // Clearing live drawings no longer removes the kept one; ending keeps it too.
      await owner.post(`/api/reviews/${review.review_id}/command`).send({ action: 'clear', expected_version: after.version }).expect(200);
      await owner.post(`/api/reviews/${review.review_id}/end`).expect(200);
      const kept = (await member.get(`/api/demos/${id}/annotations?round=1`).expect(200)).body.annotations.map((a) => a.data.text).sort();
      expect(kept).to.deep.equal(['Live call: fake A', 'Rotate B']);
    });

    it('keeps existing annotations saved after the migration and hides other teams', async () => {
      const { owner, demo } = await readyDemo();
      await connection('demo_annotations').insert({ demo_id: demo.demo_id, author_id: owner.user.user_id, round_number: 1, tick: 300, level: 'main', kind: 'text', data: JSON.stringify({ x: 0.5, y: 0.5, text: 'old' }) });
      const other = await teamWithMember();
      expect((await other.member.get(`/api/demos/${demo.demo_id}/annotations?round=1`).expect(404)));
      await other.member.get(`/api/demos/${demo.demo_id}/notes`).expect(404);
      await other.member.post(`/api/demos/${demo.demo_id}/save`).send({ notes: [] }).expect(404);
      const list = (await owner.get(`/api/demos/${demo.demo_id}/annotations?round=1`).expect(200)).body.annotations;
      expect(list[0]).to.include({ saved: true });
    });
  });
});
