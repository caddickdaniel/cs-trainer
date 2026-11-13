// Phase 6: owner-only team deletion, in-game player colours (saved, shared
// through Player 1-5 slots, in Game Mode), legacy instruction fields, desktop
// hotkey registration rules, recorded utility in Demo Review (parser output,
// reprocessing that keeps annotations) and the rebuilt demo fixtures.
const fs = require('fs');
const zlib = require('zlib');
const bcrypt = require('bcryptjs');
const { expect } = require('chai');
const { connection, reseed, signUp, teamWithMember } = require('./helpers');
const { buildReplay, REPLAY_VERSION, SMOKE_TICKS } = require('../services/demoParse');
const demoJobs = require('../services/demoJobs');
const { createHotkeyManager, validateAccelerator, DEFAULT_BINDINGS } = require('../desktop/src/hotkeys');
const { ensureDemoData } = require('../db/lib/demo');
const fixtures = require('../db/data/demo');

const player = (id, uid, slot = null) => ({ id, kind: 'player', x: 0.5, y: 0.5, level: 'main', user_id: uid, slot, label: '', images: [] });
function colorDoc(p1, p2, overrides = {}) {
  return {
    tactic_name: 'Colours', map: 'de_mirage', side: 'T', economy: 'Fullbuy',
    player_colors: [{ user_id: p1, slot: null, color: 'purple' }, { user_id: p2, slot: null, color: 'yellow' }],
    phases: [{ name: 'One', board: { markers: [player('a', p1), player('b', p2)], routes: [] },
      assignments: [{ user_id: p1, instruction: 'Entry', utility: 'Old utility text', reference_url: 'https://example.test/lineup' }] }],
    ...overrides,
  };
}

describe('phase 6', () => {
  beforeEach(reseed);

  describe('team deletion', () => {
    it('only the owner can delete a team (the dialog is client-side; the server check stays)', async () => {
      const { owner, member, teamId } = await teamWithMember();
      await member.delete(`/api/teams/${teamId}`).expect(403);
      expect(await connection('teams').where('team_id', teamId).first()).to.not.equal(undefined);
      await owner.delete(`/api/teams/${teamId}`).expect(204);
      expect(await connection('teams').where('team_id', teamId).first()).to.equal(undefined);
    });
  });

  describe('player colours', () => {
    it('saves one unique in-game colour per player and rejects duplicates, unknown colours and outsiders', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const [p1, p2] = [owner.user.user_id, member.user.user_id];
      const { tactic } = (await owner.post(`/api/teams/${teamId}/tactics`).send(colorDoc(p1, p2)).expect(201)).body;
      const doc = (await member.get(`/api/tactics/${tactic.tactic_id}/document`).expect(200)).body.tactic;
      expect(doc.player_colors).to.deep.equal([{ user_id: p1, slot: null, color: 'purple' }, { user_id: p2, slot: null, color: 'yellow' }]);
      // Legacy instruction fields survive a save unchanged.
      expect(doc.phases[0].assignments[0]).to.include({ utility: 'Old utility text', reference_url: 'https://example.test/lineup' });

      const bad = (colors) => owner.post(`/api/teams/${teamId}/tactics`).send(colorDoc(p1, p2, { player_colors: colors })).expect(400);
      await bad([{ user_id: p1, color: 'purple' }, { user_id: p2, color: 'purple' }]);
      await bad([{ user_id: p1, color: 'purple' }, { user_id: p1, color: 'green' }]);
      await bad([{ user_id: p1, color: 'red' }]);
      const outsider = await signUp('Outsider');
      await bad([{ user_id: outsider.user.user_id, color: 'blue' }]);
      // Older tactics have no colours: an empty list (the client falls back).
      const plain = (await owner.post(`/api/teams/${teamId}/tactics`).send(colorDoc(p1, p2, { player_colors: undefined })).expect(201)).body.tactic;
      expect((await owner.get(`/api/tactics/${plain.tactic_id}/document`).expect(200)).body.tactic.player_colors).to.deep.equal([]);
    });

    it('keeps colours through Player 1-5 slots when sharing and importing, and copies them into the Game Mode round', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const [p1, p2] = [owner.user.user_id, member.user.user_id];
      const { tactic } = (await owner.post(`/api/teams/${teamId}/tactics`).send(colorDoc(p1, p2)).expect(201)).body;
      const { tactic: listing } = (await owner.post(`/api/tactics/${tactic.tactic_id}/share`).send({}).expect(200)).body;
      expect(listing.player_colors).to.deep.equal([{ user_id: null, slot: 1, color: 'purple' }, { user_id: null, slot: 2, color: 'yellow' }]);

      const other = await teamWithMember();
      const { tactic_id: copyId } = (await other.owner.post(`/api/shared-tactics/${listing.share_id}/import`).send({ team_id: other.teamId }).expect(201)).body;
      const copy = (await other.owner.get(`/api/tactics/${copyId}/document`).expect(200)).body.tactic;
      expect(copy.player_colors).to.deep.equal([{ user_id: null, slot: 1, color: 'purple' }, { user_id: null, slot: 2, color: 'yellow' }]);

      const s = (await owner.post(`/api/teams/${teamId}/game-session`).send({ tactic_id: tactic.tactic_id }).expect(201)).body.session;
      expect(s.player_colors).to.deep.equal([{ user_id: p1, slot: null, color: 'purple' }, { user_id: p2, slot: null, color: 'yellow' }]);
      // Changing the saved tactic doesn't recolour the live round.
      const doc = (await owner.get(`/api/tactics/${tactic.tactic_id}/document`).expect(200)).body.tactic;
      await owner.put(`/api/tactics/${tactic.tactic_id}/document`).send({ ...colorDoc(p1, p2, { player_colors: [] }), revision: doc.revision }).expect(200);
      const live = (await member.get(`/api/teams/${teamId}/game-session`).expect(200)).body.session;
      expect(live.player_colors).to.have.length(2);
    });
  });

  describe('desktop global hotkeys', () => {
    const fakeOs = (refuse = []) => {
      const held = new Map();
      return {
        held,
        register: (acc, fn) => { if (refuse.includes(acc) || held.has(acc)) return false; held.set(acc, fn); return true; },
        unregister: (acc) => held.delete(acc),
      };
    };

    it('registers only when enabled, reports refused bindings per action and unregisters everything on disable', () => {
      const os = fakeOs(['Ctrl+Alt+Home']);
      const pressed = [];
      const hk = createHotkeyManager({ globalShortcut: os, onAction: (a) => pressed.push(a) });
      expect(os.held.size).to.equal(0);
      const status = hk.enable();
      expect(status.active).to.equal(true);
      expect(status.registered).to.not.include('new_round');
      expect(status.failed).to.have.length(1);
      expect(status.failed[0]).to.include({ action: 'new_round', accelerator: 'Ctrl+Alt+Home' });
      os.held.get(DEFAULT_BINDINGS.phase_next)();
      expect(pressed).to.deep.equal(['phase_next']);
      // Rebinding the refused action while active registers the new key.
      const fixed = hk.setBindings({ new_round: 'F8' });
      expect(fixed.registered).to.include('new_round');
      expect(fixed.failed).to.deep.equal([]);
      hk.disable();
      expect(os.held.size).to.equal(0);
    });

    it('refuses unsafe or malformed combinations and keeps the previous binding', () => {
      expect(validateAccelerator('Ctrl+Alt+Right')).to.equal(null);
      expect(validateAccelerator('num6')).to.equal(null);
      expect(validateAccelerator('F8')).to.equal(null);
      expect(validateAccelerator('K')).to.match(/Ctrl, Alt or Shift/);
      expect(validateAccelerator('Ctrl+Hyper+K')).to.match(/not a supported/);
      expect(validateAccelerator('Ctrl+Alt+Right; rm -rf')).to.not.equal(null);
      const hk = createHotkeyManager({ globalShortcut: fakeOs(), onAction: () => {} });
      const res = hk.setBindings({ phase_next: 'W', unknown_action: 'F9' });
      expect(res.bindings.phase_next).to.equal(DEFAULT_BINDINGS.phase_next);
      expect(res.bindings).to.not.have.property('unknown_action');
      expect(res.failed[0]).to.include({ action: 'phase_next', accelerator: 'W' });
      // Two actions on one key: the second is reported, not silently dropped.
      const os = fakeOs();
      const dup = createHotkeyManager({ globalShortcut: os, onAction: () => {} });
      dup.setBindings({ tactic_next: DEFAULT_BINDINGS.phase_next });
      expect(dup.enable().failed.map((f) => f.action)).to.deep.equal(['tactic_next']);
    });
  });

  describe('recorded utility in Demo Review', () => {
    const steam = (n) => `7656119000000000${n}`;
    function demoWithUtility() {
      const at = (x, y, z = 0) => ({ x, y, z });
      const events = [
        { event_name: 'round_start', tick: 100 },
        { event_name: 'round_freeze_end', tick: 120 },
        { event_name: 'smokegrenade_detonate', tick: 300, entityid: 7, user_steamid: steam(1), ...at(-1000, 0) },
        { event_name: 'smokegrenade_expired', tick: 1700, entityid: 7, user_steamid: steam(1), ...at(-1000, 0) },
        // No expiry recorded: clamped to the round's end.
        { event_name: 'smokegrenade_detonate', tick: 3000, entityid: 9, user_steamid: steam(2), ...at(-900, 0) },
        { event_name: 'flashbang_detonate', tick: 400, entityid: 8, user_steamid: steam(1), ...at(-800, 100) },
        { event_name: 'hegrenade_detonate', tick: 500, entityid: 10, user_steamid: steam(2), ...at(-700, 100) },
        { event_name: 'inferno_startburn', tick: 600, entityid: 11, user_steamid: steam(2), ...at(-600, 100) },
        { event_name: 'inferno_expire', tick: 1000, entityid: 11, user_steamid: steam(2), ...at(-600, 100) },
        { event_name: 'bomb_planted', tick: 2000, user_steamid: steam(1), user_X: -500, user_Y: 200, user_Z: 0 },
        // An explosion's "user" is just someone's position; it is placed at the plant.
        { event_name: 'bomb_exploded', tick: 4000, user_steamid: steam(2), user_X: 9999, user_Y: 9999, user_Z: 0 },
        { event_name: 'round_end', tick: 4000, winner: 'T', reason: 'bomb_exploded' },
      ];
      const ticks = [];
      for (let t = 96; t <= 4200; t += 8) {
        ticks.push({ tick: t, steamid: steam(1), name: 'alpha', X: 0, Y: 0, Z: 0, yaw: 0, is_alive: true, health: 100, team_num: 2 });
        ticks.push({ tick: t, steamid: steam(2), name: 'bravo', X: 0, Y: 0, Z: 0, yaw: 0, is_alive: true, health: 100, team_num: 3 });
      }
      return { header: { map_name: 'de_mirage', server_name: 'test' }, events, ticks };
    }

    it('extracts smokes, flashes, HEs, fires, plants and explosions with time, thrower, position and duration', () => {
      const replay = buildReplay(demoWithUtility());
      expect(replay.meta.replay_version).to.equal(REPLAY_VERSION);
      const ev = replay.rounds[0].data.events;
      const of = (type) => ev.filter((e) => e.type === type);
      const players = replay.meta.players;
      const idx = (name) => players.find((p) => p.name === name).index;
      expect(of('smoke')).to.have.length(2);
      expect(of('smoke')[0]).to.include({ tick: 300, end_tick: 1700, player: idx('alpha'), level: 'main' });
      expect(of('smoke')[0].x).to.be.within(0, 1);
      const end = replay.rounds[0].end_tick;
      expect(of('smoke')[1].end_tick).to.equal(Math.min(3000 + SMOKE_TICKS, end));
      expect(of('flash')[0]).to.include({ tick: 400, player: idx('alpha') });
      expect(of('he')[0]).to.include({ tick: 500, player: idx('bravo') });
      // bravo is on CT: an incendiary.
      expect(of('fire')[0]).to.include({ tick: 600, end_tick: 1000, variant: 'incendiary' });
      const plant = of('plant')[0];
      expect(of('explode')[0]).to.include({ x: plant.x, y: plant.y });
    });

    it('reprocesses an existing import in place: new event data, saved annotations kept', async () => {
      const { owner, teamId } = await teamWithMember();
      const [demo] = await connection('demos').insert({
        team_id: teamId, uploaded_by: owner.user.user_id, title: 'Old import', original_name: 'old.dem', byte_size: 10,
        sha256: 'a'.repeat(64), storage_key: 'old.dem', status: 'ready', map: 'de_mirage', tickrate: 64, round_count: 1, replay_version: 1,
        stats_version: 99,
      }).returning('*');
      const oldData = { round_number: 1, events: [{ tick: 4000, type: 'round_end' }], roster: [], tracks: [] };
      await connection('demo_rounds').insert({ demo_id: demo.demo_id, round_number: 1, start_tick: 100, end_tick: 4192, data: zlib.gzipSync(JSON.stringify(oldData)) });
      await connection('demo_annotations').insert({ demo_id: demo.demo_id, author_id: owner.user.user_id, round_number: 1, tick: 500, level: 'main', kind: 'text', data: JSON.stringify({ x: 0.5, y: 0.5, text: 'keep me' }) });

      const replay = buildReplay(demoWithUtility());
      const res = await demoJobs.backfillNext({ parse: async () => replay });
      expect(res).to.include({ demo_id: demo.demo_id, replay: true });
      const row = await connection('demo_rounds').where({ demo_id: demo.demo_id, round_number: 1 }).first();
      const data = JSON.parse(zlib.gunzipSync(row.data));
      expect(data.events.some((e) => e.type === 'smoke')).to.equal(true);
      expect(await connection('demo_annotations').where('demo_id', demo.demo_id).pluck('data')).to.deep.equal([{ x: 0.5, y: 0.5, text: 'keep me' }]);
      expect((await connection('demos').where('demo_id', demo.demo_id).first()).replay_version).to.equal(REPLAY_VERSION);
      // Up to date: nothing more to do.
      expect(await demoJobs.backfillNext({ parse: async () => replay })).to.equal(null);
    });

    // The 253 MB HLTV demo is not in the repository. Point DEMO_FIXTURE at it to run this.
    const fixture = process.env.DEMO_FIXTURE;
    (fixture && fs.existsSync(fixture) ? it : it.skip)('parses recorded utility from spirit-vs-g2-m3-ancient.dem (DEMO_FIXTURE)', function () {
      this.timeout(120000);
      const { parseDemoFile } = require('../services/demoParse');
      const replay = parseDemoFile(fixture);
      const all = replay.rounds.flatMap((r) => r.data.events);
      const count = (t) => all.filter((e) => e.type === t).length;
      expect(replay.map).to.equal('de_ancient');
      expect(replay.rounds).to.have.length(18);
      expect(count('smoke')).to.equal(116);
      expect(count('flash')).to.equal(115);
      expect(count('he')).to.equal(69);
      expect(count('fire')).to.equal(91);
      expect(count('plant')).to.equal(9);
      expect(count('defuse')).to.equal(1);
      expect(all.filter((e) => ['smoke', 'flash', 'he', 'fire', 'plant', 'defuse', 'explode'].includes(e.type)).every((e) => e.x != null)).to.equal(true);
    });
  });

  describe('demo fixtures', () => {
    it('creates the roster, recruits and recruiting teams deterministically and repeatably', async () => {
      const hash = await bcrypt.hash('x', 4);
      const first = await ensureDemoData(connection, hash);
      const counts = async () => ({
        users: Number((await connection('users').count({ n: '*' }).first()).n),
        teams: Number((await connection('teams').count({ n: '*' }).first()).n),
        members: Number((await connection('team_memberships').count({ n: '*' }).first()).n),
      });
      const before = await counts();
      const again = await ensureDemoData(connection, hash);
      expect(again.rosterId).to.equal(first.rosterId);
      expect(await counts()).to.deep.equal(before);

      const roster = await connection('team_memberships as m').join('users as u', 'u.user_id', 'm.user_id')
        .where('m.team_id', first.rosterId).select('u.email', 'm.player_role');
      expect(roster).to.have.length(5);
      expect(roster.filter((r) => r.player_role === 'igl')).to.have.length(1);
      const team = await connection('teams').where('team_id', first.rosterId).first();
      expect((await connection('users').where('user_id', team.owner).first()).email).to.equal('test-owner@cs-trainer.test');

      const recruits = await connection('users').whereIn('email', fixtures.teamlessPlayers.map((p) => p.email));
      const ranked = (u) => ['premier_rank', 'faceit_rank', 'esea_rank'].filter((c) => u[c]).length;
      expect(recruits.some((u) => ranked(u) === 3)).to.equal(true);
      expect(recruits.some((u) => ranked(u) === 1 || ranked(u) === 2)).to.equal(true);
      expect(recruits.some((u) => ranked(u) === 0)).to.equal(true);
      expect(new Set(recruits.map((u) => u.language)).size).to.be.at.least(10);
      expect(new Set(recruits.map((u) => u.region)).size).to.be.at.least(8);
      for (const t of fixtures.recruitingTeams) {
        const row = await connection('teams').where('team_name', t.team_name).first();
        expect(row.is_recruiting).to.equal(true);
        expect(row.rank_requirements.length).to.be.at.least(2);
        expect(row.competitions.length).to.be.at.least(2);
      }
    });

    it('never moves a fixture player who has joined another team', async () => {
      const hash = await bcrypt.hash('x', 4);
      await ensureDemoData(connection, hash);
      const sable = await connection('users').where('email', 'test-igl@cs-trainer.test').first();
      const other = await teamWithMember();
      await connection('team_memberships').where('user_id', sable.user_id).update({ team_id: other.teamId, player_role: 'rifler', is_igl: false });
      await ensureDemoData(connection, hash);
      expect((await connection('team_memberships').where('user_id', sable.user_id)).map((m) => m.team_id)).to.deep.equal([other.teamId]);
    });
  });
});
