// Phase 10: team CS2 colours and ranks on the roster, calendar availability
// and event permissions, notification Clear All / History, viewing others'
// roles in Game Mode, utility throw paths, and the shared client helpers.
const path = require('path');
const { pathToFileURL } = require('url');
const { expect } = require('chai');
const { addMember, connection, reseed, tacticDoc, teamWithMember } = require('./helpers');
const { applyTeamColors } = require('../services/teamColors');

// A file:// URL, since import() rejects absolute Windows paths such as C:...
const client = (file) => import(pathToFileURL(path.join(__dirname, '../client/src/lib', file)).href);

describe('phase 10', () => {
  beforeEach(reseed);

  describe('team colours and ranks', () => {
    it('lets the owner and the IGL assign unique CS2 colours, shows ranks, and frees a colour when a player leaves', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const third = await addMember(owner, teamId, 'Third');
      const patch = (who, target, body) => who.patch(`/api/teams/${teamId}/members/${target.user.user_id}`).send(body);
      await patch(owner, member, { game_color: 'purple' }).expect(200);
      // Duplicate colour: rejected, naming the holder.
      const dup = await patch(owner, third, { game_color: 'purple' }).expect(409);
      expect(dup.body.code).to.equal('color_taken');
      expect(dup.body.message).to.include(member.user.user_name);
      // A regular member can't assign colours (theirs or anyone's).
      await patch(third, third, { game_color: 'green' }).expect(403);
      await patch(member, third, { game_color: 'green' }).expect(403);
      await patch(owner, third, { game_color: 'nope' }).expect(400);
      // The IGL can (same as other team configuration).
      await owner.patch(`/api/teams/${teamId}/members/${member.user.user_id}`).send({ player_role: 'igl' }).expect(200);
      await patch(member, third, { game_color: 'green' }).expect(200);

      await connection('users').where('user_id', member.user.user_id).update({ faceit_rank: 'faceit:8', premier_rank: 'premier:15000' });
      const roster = (await owner.get(`/api/teams/${teamId}/roster`).expect(200)).body;
      const m = (u) => roster.members.find((x) => x.user_id === u.user.user_id);
      expect(m(member)).to.include({ game_color: 'purple' });
      expect(m(member).ranks).to.deep.equal({ premier: 'premier:15000', faceit: 'faceit:8', esea: null });
      expect(m(third)).to.include({ game_color: 'green' });
      expect(m(owner)).to.include({ game_color: null });

      // Leaving frees the colour; clearing works too.
      await third.post(`/api/teams/${teamId}/leave`).expect(204);
      await patch(owner, owner, { game_color: 'green' }).expect(200);
      await patch(owner, member, { game_color: null }).expect(200);
      expect((await owner.get(`/api/teams/${teamId}/roster`).expect(200)).body.members.find((x) => x.user_id === member.user.user_id).game_color).to.equal(null);
    });

    it('applies team colours over colours stored in tactics and Game Mode rounds', async () => {
      expect(applyTeamColors([{ user_id: 1, slot: null, color: 'yellow' }, { user_id: 2, slot: null, color: 'blue' }, { user_id: null, slot: 3, color: 'green' }],
        new Map([[1, 'blue'], [4, 'green']]))).to.deep.equal([{ user_id: 1, slot: null, color: 'blue' }, { user_id: 4, slot: null, color: 'green' }]);

      const { owner, member, teamId } = await teamWithMember();
      const doc = tacticDoc([owner.user.user_id, member.user.user_id], { player_colors: [{ user_id: member.user.user_id, slot: null, color: 'yellow' }] });
      const { tactic } = (await owner.post(`/api/teams/${teamId}/tactics`).send(doc).expect(201)).body;
      await owner.patch(`/api/teams/${teamId}/members/${member.user.user_id}`).send({ game_color: 'orange' }).expect(200);
      const got = (await member.get(`/api/tactics/${tactic.tactic_id}/document`).expect(200)).body;
      expect(got.tactic.player_colors).to.deep.include({ user_id: member.user.user_id, slot: null, color: 'orange' });
      expect(got.roster.find((r) => r.user_id === member.user.user_id).game_color).to.equal('orange');
      const { session } = (await owner.post(`/api/teams/${teamId}/game-session`).send({ tactic_id: tactic.tactic_id }).expect(201)).body;
      expect(session.player_colors).to.deep.include({ user_id: member.user.user_id, slot: null, color: 'orange' });
    });
  });

  describe('calendar availability and events', () => {
    const entry = (over = {}) => ({ status: 'unavailable', all_day: false, day: '2026-12-01', starts_at: '2026-12-01T19:00:00Z', ends_at: '2026-12-01T21:00:00Z',
      time_zone: 'Europe/London', note: 'Gym', ...over });
    const event = (over = {}) => ({ kind: 'training', title: 'Practice', starts_at: '2026-12-01T18:00:00Z', ends_at: '2026-12-01T20:00:00Z', time_zone: 'Europe/London', ...over });

    it('lets every member manage only their own availability, and everyone see it', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const url = `/api/teams/${teamId}/availability`;
      const { availability: a } = (await member.post(url).send(entry()).expect(201)).body;
      expect(a).to.include({ status: 'unavailable', all_day: false, day: '2026-12-01', note: 'Gym' });
      expect(a.user.user_id).to.equal(member.user.user_id);
      await owner.post(url).send(entry({ status: 'available', all_day: true, starts_at: '2026-12-01T00:00:00Z', ends_at: '2026-12-02T00:00:00Z', note: '' })).expect(201);
      const list = (await owner.get(url).expect(200)).body;
      expect(list.availability).to.have.length(2);
      expect(list.can_manage_events).to.equal(true);
      // Nobody else (not even the owner) can change or delete it.
      await owner.patch(`${url}/${a.availability_id}`).send(entry({ status: 'available' })).expect(403);
      await owner.delete(`${url}/${a.availability_id}`).expect(403);
      await member.patch(`${url}/${a.availability_id}`).send(entry({ status: 'available', ends_at: '2026-12-01T22:00:00Z' })).expect(200);
      // Validation: end after start; at most a day.
      await member.post(url).send(entry({ ends_at: '2026-12-01T18:00:00Z' })).expect(400);
      await member.post(url).send(entry({ ends_at: '2026-12-03T18:00:00Z' })).expect(400);
      await member.post(url).send(entry({ status: 'maybe' })).expect(400);
      await member.delete(`${url}/${a.availability_id}`).expect(200);
      // Other teams can't see it.
      const other = await teamWithMember();
      await other.member.get(url).expect(404);
    });

    it('lets the owner and the IGL schedule events with an end time; regular members cannot', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const third = await addMember(owner, teamId, 'Third');
      const url = `/api/teams/${teamId}/events`;
      await third.post(url).send(event()).expect(403);
      await owner.patch(`/api/teams/${teamId}/members/${member.user.user_id}`).send({ player_role: 'igl' }).expect(200);
      const { event: e } = (await member.post(url).send(event()).expect(201)).body;
      expect(e.ends_at).to.match(/^2026-12-01T20:00/);
      await member.patch(`${url}/${e.event_id}`).send({ ends_at: '2026-12-01T17:00:00Z' }).expect(400);
      await third.patch(`${url}/${e.event_id}`).send({ title: 'x' }).expect(403);
      await owner.patch(`${url}/${e.event_id}`).send({ title: 'Owner edit' }).expect(200);
      await member.post(url).send(event({ ends_at: '2026-12-01T17:00:00Z' })).expect(400);
      expect((await third.get(url).expect(200)).body.can_manage).to.equal(false);
      await member.delete(`${url}/${e.event_id}`).expect(204);
    });
  });

  describe('notifications: Clear All and History', () => {
    it('soft-clears active notifications into a per-user history', async () => {
      const { owner, member, teamId } = await teamWithMember();
      for (const t of ['A', 'B']) await owner.post(`/api/teams/${teamId}/events`).send({ kind: 'game', title: t, starts_at: '2026-12-02T18:00:00Z', time_zone: 'UTC' }).expect(201);
      let list = (await member.get('/api/notifications').expect(200)).body;
      expect(list.notifications).to.have.length(2);
      expect(list.unread_count).to.equal(2);
      list = (await member.post('/api/notifications/clear-all').expect(200)).body;
      expect(list).to.deep.equal({ notifications: [], unread_count: 0 });
      const history = (await member.get('/api/notifications/history').expect(200)).body.notifications;
      expect(history).to.have.length(2);
      expect(history[0]).to.include({ kind: 'event_created', title: 'New calendar event' });
      expect(history[0].cleared_at).to.be.a('string');
      // Persistent, and scoped to the user.
      expect((await member.get('/api/notifications').expect(200)).body.notifications).to.have.length(0);
      expect((await owner.get('/api/notifications/history').expect(200)).body.notifications).to.have.length(0);
      expect(await connection('notifications').where('user_id', member.user.user_id).count('* as n').first()).to.deep.equal({ n: '2' });
    });
  });

  describe('Game Mode: viewing teammates\' roles', () => {
    it('gives every member the roster roles and every instruction, without control', async () => {
      const { owner, member, teamId } = await teamWithMember();
      await owner.patch(`/api/teams/${teamId}/members/${member.user.user_id}`).send({ player_role: 'entry' }).expect(200);
      const { tactic } = (await owner.post(`/api/teams/${teamId}/tactics`).send(tacticDoc([owner.user.user_id, member.user.user_id])).expect(201)).body;
      await owner.post(`/api/teams/${teamId}/game-session`).send({ tactic_id: tactic.tactic_id }).expect(201);
      const s = (await member.get(`/api/teams/${teamId}/game-session`).expect(200)).body.session;
      expect(s.can_control).to.equal(false);
      expect(s.members.find((m) => m.user_id === member.user.user_id)).to.include({ player_role: 'entry' });
      expect(s.assignments.length).to.be.at.least(2);
      await member.post(`/api/game-sessions/${s.session_id}/phase`).send({ action: 'next', expected_version: s.version }).expect(403);
    });
  });

  describe('utility throw paths', () => {
    it('saves bounce points on utility markers only, and keeps straight throws working', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const doc = tacticDoc([owner.user.user_id, member.user.user_id]);
      const smoke = { id: 'u1', kind: 'smoke', x: 0.6, y: 0.4, level: 'main', user_id: owner.user.user_id, label: '', images: [],
        path: [{ x: 0.5, y: 0.5 }, { x: 0.55, y: 0.45 }] };
      const flash = { id: 'u2', kind: 'flash', x: 0.3, y: 0.3, level: 'main', user_id: member.user.user_id, label: '', images: [] };
      doc.phases[0].board.markers.push(smoke, flash);
      const { tactic } = (await owner.post(`/api/teams/${teamId}/tactics`).send(doc).expect(201)).body;
      const markers = (await owner.get(`/api/tactics/${tactic.tactic_id}/document`).expect(200)).body.tactic.phases[0].board.markers;
      expect(markers.find((m) => m.id === 'u1').path).to.deep.equal(smoke.path);
      expect(markers.find((m) => m.id === 'u2')).to.not.have.property('path');
      const bad = tacticDoc([owner.user.user_id, member.user.user_id]);
      bad.phases[0].board.markers.push({ ...smoke, id: 'p1', kind: 'player' });
      await owner.post(`/api/teams/${teamId}/tactics`).send(bad).expect(400);
      const tooMany = tacticDoc([owner.user.user_id, member.user.user_id]);
      tooMany.phases[0].board.markers.push({ ...smoke, path: Array.from({ length: 9 }, (_, i) => ({ x: i / 10, y: 0.5 })) });
      await owner.post(`/api/teams/${teamId}/tactics`).send(tooMany).expect(400);
    });
  });

  describe('client helpers', () => {
    it('builds availability entries, the day overview and scheduling conflicts', async () => {
      const a = await client('availability.ts');
      const allDay = a.availabilityBody({ status: 'available', all_day: true, day: '2026-12-01', start: '18:00', end: '23:00', note: '' }, 'UTC');
      expect(new Date(allDay.ends_at) - new Date(allDay.starts_at)).to.equal(24 * 3600 * 1000);
      expect(a.availabilityError({ all_day: false, start: '20:00', end: '19:00' })).to.match(/after/);
      expect(a.availabilityError({ all_day: true, start: '', end: '' })).to.equal(null);
      const mk = (id, user, status, start, end, allDayFlag = false) => ({ availability_id: id, user: { user_id: user, user_name: `P${user}` }, status, all_day: allDayFlag,
        day: '2026-12-01', starts_at: a.at('2026-12-01', start).toISOString(), ends_at: a.at('2026-12-01', end).toISOString() });
      const list = [mk(1, 1, 'available', '18:00', '23:00'), mk(2, 2, 'unavailable', '19:00', '21:00'), mk(3, 2, 'available', '21:00', '23:00')];
      const rows = a.dayOverview([{ user_id: 1, user_name: 'P1' }, { user_id: 2, user_name: 'P2' }, { user_id: 3, user_name: 'P3' }], list, '2026-12-01');
      expect(rows.map((r) => r.status)).to.deep.equal(['available', 'mixed', 'none']);
      expect(a.unavailableDuring(list, a.at('2026-12-01', '20:00'), a.at('2026-12-01', '22:00')).map((x) => x.user_id)).to.deep.equal([2]);
      expect(a.unavailableDuring(list, a.at('2026-12-01', '21:00'), a.at('2026-12-01', '22:00'))).to.deep.equal([]);
      expect(a.rangeLabel(list[0])).to.equal('18:00–23:00');
    });

    it('maps every utility identifier to one CS2 icon, by side for fire', async () => {
      const c = await client('cs2Assets.ts');
      expect(c.utilityId('smoke')).to.equal('smokegrenade');
      expect(c.utilityId('flash')).to.equal('flashbang');
      expect(c.utilityId('he')).to.equal('hegrenade');
      expect(c.utilityId('molly', { side: 'T' })).to.equal('molotov');
      expect(c.utilityId('molly', { side: 'CT' })).to.equal('incgrenade');
      expect(c.utilityId('fire', { variant: 'incendiary' })).to.equal('incgrenade');
      expect(c.utilityId('inc')).to.equal('incgrenade');
      expect(c.utilityId('weapon_decoy')).to.equal('decoy');
      expect(c.utilityId('bomb')).to.equal('c4');
      expect(c.utilityId('kit')).to.equal('defuser');
      expect(c.utilityIconSrc('smokegrenade')).to.equal('/assets/cs2/utility/smokegrenade.svg');
      expect(c.utilityIconSrc('defuser')).to.equal('/assets/cs2/equipment/defuser.svg');
      expect(c.utilityLegacySrc('molotov')).to.equal('/icons/utility/molly.png');
      expect(c.utilityId('laser')).to.equal(null);
    });
  });
});
