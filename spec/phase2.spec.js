// Phase 2: team management, IGL control, profiles, recruitment, calendar,
// notifications and Game Mode rounds.
const { expect } = require('chai');
const {
  connection, reseed, signIn, signUp, tacticDoc, teamWithMember, addMember, TINY_PNG,
} = require('./helpers');
const notifications = require('../services/notifications');

const futureIso = (hours) => new Date(Date.now() + hours * 3600 * 1000).toISOString();

describe('phase 2', () => {
  beforeEach(reseed);

  describe('team management', () => {
    it('owners manage details, picture, recruiting and roles; other members cannot', async () => {
      const { owner, member, teamId } = await teamWithMember();
      await owner.patch(`/api/teams/${teamId}`).send({ team_name: 'Renamed', region: 'EU' }).expect(200);
      const logo = await owner.post(`/api/teams/${teamId}/logo`).set('Content-Type', 'image/png').send(TINY_PNG).expect(201);
      expect(logo.body.team.logo_url).to.match(/^\/api\/pictures\//);
      await member.get(logo.body.team.logo_url).expect(200).expect('Content-Type', 'image/png');
      await owner.patch(`/api/teams/${teamId}/recruiting`).send({ is_recruiting: true, roles_needed: ['awper', 'support'], recruiting_leagues: 'ESEA Open' }).expect(200);

      await member.patch(`/api/teams/${teamId}`).send({ team_name: 'Mine now' }).expect(403);
      await member.post(`/api/teams/${teamId}/logo`).set('Content-Type', 'image/png').send(TINY_PNG).expect(403);
      await member.delete(`/api/teams/${teamId}/logo`).expect(403);
      await member.patch(`/api/teams/${teamId}/recruiting`).send({ is_recruiting: false }).expect(403);
      await member.patch(`/api/teams/${teamId}/members/${owner.user.user_id}`).send({ player_role: 'entry' }).expect(403);
      await member.delete(`/api/teams/${teamId}/members/${owner.user.user_id}`).expect(403);
      await member.delete(`/api/teams/${teamId}`).expect(403);
      await member.post(`/api/teams/${teamId}/events`).send({ kind: 'training', title: 'x', starts_at: futureIso(5), time_zone: 'UTC' }).expect(403);

      await owner.delete(`/api/teams/${teamId}/logo`).expect(200);
      expect((await owner.get(`/api/teams/${teamId}/roster`).expect(200)).body.team.logo_url).to.equal(null);
    });

    it('a removed player loses access to private resources and the live session', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const ids = [owner.user.user_id, member.user.user_id];
      const { tactic } = (await owner.post(`/api/teams/${teamId}/tactics`).send(tacticDoc(ids)).expect(201)).body;
      await owner.post(`/api/teams/${teamId}/game-session`).send({ tactic_id: tactic.tactic_id }).expect(201);
      await member.get(`/api/teams/${teamId}/game-session`).expect(200);
      await owner.delete(`/api/teams/${teamId}/members/${member.user.user_id}`).expect(204);
      await member.get(`/api/teams/${teamId}/game-session`).expect(404);
      await member.get(`/api/tactics/${tactic.tactic_id}/document`).expect(404);
      await member.get(`/api/teams/${teamId}/events`).expect(404);
      expect((await member.get('/api/auth/me').expect(200)).body.active_team).to.equal(null);
    });

    it('deleting a team removes dependent records and clears members\' active team', async () => {
      const { owner, member, teamId } = await teamWithMember();
      await owner.post(`/api/teams/${teamId}/events`).send({ kind: 'game', title: 'Cup', starts_at: futureIso(10), time_zone: 'Europe/London' }).expect(201);
      const ids = [owner.user.user_id, member.user.user_id];
      const { tactic } = (await owner.post(`/api/teams/${teamId}/tactics`).send(tacticDoc(ids)).expect(201)).body;
      await owner.post(`/api/teams/${teamId}/game-session`).send({ tactic_id: tactic.tactic_id }).expect(201);
      await owner.delete(`/api/teams/${teamId}`).expect(204);
      for (const table of ['team_memberships', 'team_events', 'tactics', 'game_sessions', 'team_invites']) {
        expect(await connection(table).where('team_id', teamId)).to.have.length(0);
      }
      expect((await member.get('/api/auth/me').expect(200)).body.active_team).to.equal(null);
      expect((await owner.get('/api/auth/me').expect(200)).body.active_team).to.equal(null);
      // Notifications about the deleted team stay readable and open safely.
      const list = (await member.get('/api/notifications').expect(200)).body.notifications;
      const opened = (await member.post(`/api/notifications/${list[0].notification_id}/open`).send({}).expect(200)).body;
      expect(opened.href).to.equal('/');
    });
  });

  describe('IGL control in Game Mode', () => {
    it('transferring IGL mid-session revokes the old IGL immediately', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const third = await addMember(owner, teamId, 'Third');
      const ids = [owner.user.user_id, member.user.user_id, third.user.user_id];
      const doc = tacticDoc(ids);
      doc.phases.push({ name: 'Plant', notes: '', board: { markers: [], routes: [] }, assignments: [] });
      const { tactic } = (await owner.post(`/api/teams/${teamId}/tactics`).send(doc).expect(201)).body;
      const url = `/api/teams/${teamId}/game-session`;
      const { session } = (await owner.post(url).send({ tactic_id: tactic.tactic_id }).expect(201)).body;
      const cmd = `/api/game-sessions/${session.session_id}/command`;
      await owner.post(cmd).send({ action: 'phase_next', expected_version: 1 }).expect(200);

      await owner.patch(`/api/teams/${teamId}/members/${member.user.user_id}`).send({ player_role: 'igl' }).expect(200);
      const now = (await member.get(url).expect(200)).body;
      expect(now.session).to.include({ can_control: true, current_phase: 1 });
      expect(now.session.igl.user_id).to.equal(member.user.user_id);
      const r = await owner.post(cmd).send({ action: 'phase_next', expected_version: now.session.version }).expect(403);
      expect(r.body.code).to.equal('not_igl');
      await owner.post(`/api/game-sessions/${session.session_id}/end`).send({}).expect(403);
      await member.post(cmd).send({ action: 'phase_next', expected_version: now.session.version }).expect(200);

      // The owner (no longer IGL) and other teammates get the read-only view.
      for (const viewer of [owner, third]) {
        const view = (await viewer.get(url).expect(200)).body.session;
        expect(view).to.include({ current_phase: 2, can_control: false });
        expect(view).to.not.have.property('assignments');
        expect(view).to.not.have.property('side_tactics');
      }
      const thirdView = (await third.get(url).expect(200)).body.session;
      expect(thirdView.my_assignment).to.equal(null);
    });

    it('navigates tactics within the map and side, switches side and starts rounds', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const ids = [owner.user.user_id, member.user.user_id];
      const make = async (name, side, map = 'de_mirage') =>
        (await owner.post(`/api/teams/${teamId}/tactics`).send(tacticDoc(ids, { tactic_name: name, side, map })).expect(201)).body.tactic;
      const a = await make('A Split', 'T');
      const b = await make('B Rush', 'T');
      await make('Other map', 'T', 'de_nuke');
      const url = `/api/teams/${teamId}/game-session`;
      let s = (await owner.post(url).send({ tactic_id: a.tactic_id }).expect(201)).body.session;
      expect(s).to.include({ map: 'de_mirage', side: 'T', round_number: 1, side_tactic_count: 2 });
      expect(s.side_tactics.map((t) => t.tactic_name)).to.deep.equal(['A Split', 'B Rush']);
      const cmd = (action) => owner.post(`/api/game-sessions/${s.session_id}/command`).send({ action, expected_version: s.version });

      s = (await cmd('tactic_next').expect(200)).body.session;
      expect(s.selected_tactic.tactic_id).to.equal(b.tactic_id);
      expect(s.tactic.tactic_id).to.equal(a.tactic_id); // the live round is unchanged
      s = (await cmd('tactic_next').expect(200)).body.session; // wraps within Mirage T
      expect(s.selected_tactic.tactic_id).to.equal(a.tactic_id);
      s = (await cmd('tactic_prev').expect(200)).body.session;
      expect(s.selected_tactic.tactic_id).to.equal(b.tactic_id);

      s = (await cmd('phase_next').expect(200)).body.session;
      s = (await cmd('new_round').expect(200)).body.session;
      expect(s).to.include({ round_number: 2, current_phase: 0 });
      expect(s.tactic.tactic_id).to.equal(b.tactic_id);

      s = (await cmd('switch_side').expect(200)).body.session;
      expect(s).to.include({ side: 'CT', side_tactic_count: 0, selected_tactic: null });
      const empty = await cmd('new_round').expect(400);
      expect(empty.body.code).to.equal('no_tactic_selected');
      const ct = await make('CT Retake', 'CT');
      s = (await cmd('switch_side').expect(200)).body.session;
      s = (await cmd('switch_side').expect(200)).body.session;
      expect(s.selected_tactic.tactic_id).to.equal(ct.tactic_id);

      // Reconnect: a fresh sign-in sees the same round, tactic and phase.
      const again = await signIn(member.user.email, { password: 'correct-horse-battery' });
      const view = (await again.get(url).expect(200)).body.session;
      expect(view).to.include({ round_number: 2, side: 'CT', current_phase: 0, version: s.version });
      expect(view.selected_tactic.tactic_name).to.equal('CT Retake');
      await again.post(`/api/game-sessions/${s.session_id}/command`).send({ action: 'new_round', expected_version: s.version }).expect(403);
    });
  });

  describe('profiles and player invites', () => {
    it('players edit their profile with validated links and pictures', async () => {
      const p = await signUp('Profile');
      const { body } = await p.patch('/api/me/profile').send({
        language: 'English', region: 'EU West', bio: 'Support main',
        steam_url: 'https://steamcommunity.com/id/me', faceit_url: '', hltv_url: 'https://www.hltv.org/player/1/me',
      }).expect(200);
      expect(body.profile).to.include({ language: 'English', faceit_url: null, steam_url: 'https://steamcommunity.com/id/me' });
      await p.patch('/api/me/profile').send({ steam_url: 'https://evil.example.com/steamcommunity.com' }).expect(400);
      await p.patch('/api/me/profile').send({ esea_url: 'javascript:alert(1)' }).expect(400);
      const up = await p.post('/api/me/avatar').set('Content-Type', 'image/png').send(TINY_PNG).expect(201);
      expect(up.body.profile.avatar_url).to.match(/^\/api\/pictures\//);
      await p.post('/api/me/avatar').set('Content-Type', 'image/gif').send(Buffer.from('GIF89a......')).expect(415);
      await p.post('/api/me/avatar').set('Content-Type', 'image/jpeg').send(TINY_PNG).expect(415); // type mismatch
      await p.post('/api/me/avatar').set('Content-Type', 'image/png').send(Buffer.concat([TINY_PNG, Buffer.alloc(3 * 1024 * 1024)])).expect(413);
      const removed = await p.delete('/api/me/avatar').expect(200);
      expect(removed.body.profile.avatar_url).to.equal(null);
      expect(await connection('public_images').where('uploaded_by', p.user.user_id)).to.have.length(0);
    });

    it('lists teamless players; both Invite entry points send one pending invite; accept updates membership', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const free = await signUp('Free Agent');
      const other = await signUp('Other Agent');
      const available = (await owner.get('/api/players/available').expect(200)).body;
      const names = available.players.map((p) => p.user_id);
      expect(names).to.include.members([free.user.user_id, other.user.user_id]);
      expect(names).to.not.include(member.user.user_id);
      expect(available.can_invite).to.equal(true);

      // Entry point 1: the list. Entry point 2: the profile page. Same request.
      await owner.post(`/api/teams/${teamId}/invites`).send({ user_id: free.user.user_id }).expect(201);
      const dup = await owner.post(`/api/teams/${teamId}/invites`).send({ user_id: free.user.user_id }).expect(409);
      expect(dup.body.code).to.equal('invite_pending');
      const profile = (await owner.get(`/api/players/${free.user.user_id}`).expect(200)).body;
      expect(profile).to.include({ invite_status: 'pending', can_invite: false });
      expect((await owner.get('/api/players/available').expect(200)).body.players.find((p) => p.user_id === free.user.user_id).invite_status).to.equal('pending');
      await owner.post(`/api/teams/${teamId}/invites`).send({ user_id: other.user.user_id }).expect(201);
      await member.post(`/api/teams/${teamId}/invites`).send({ user_id: other.user.user_id }).expect(403);

      const mine = (await free.get('/api/me/invites').expect(200)).body.invites;
      expect(mine[0]).to.include({ status: 'pending', kind: 'player' });
      await free.post(`/api/me/invites/${mine[0].invite_id}/accept`).send({}).expect(200);
      expect((await free.get('/api/auth/me').expect(200)).body.active_team.team_id).to.equal(teamId);
      expect((await owner.get('/api/players/available').expect(200)).body.players.map((p) => p.user_id)).to.not.include(free.user.user_id);
      await free.post(`/api/me/invites/${mine[0].invite_id}/accept`).send({}).expect(409);

      const otherInvite = (await other.get('/api/me/invites').expect(200)).body.invites[0];
      await other.post(`/api/me/invites/${otherInvite.invite_id}/decline`).send({}).expect(200);
      await other.post(`/api/me/invites/${otherInvite.invite_id}/accept`).send({}).expect(409);
      // A declined player can be invited again.
      await owner.post(`/api/teams/${teamId}/invites`).send({ user_id: other.user.user_id }).expect(201);
    });

    it('re-checks eligibility when an invite is accepted', async () => {
      const t1 = await teamWithMember();
      const t2 = await teamWithMember();
      const p = await signUp('Popular');
      await t1.owner.post(`/api/teams/${t1.teamId}/invites`).send({ user_id: p.user.user_id }).expect(201);
      await t2.owner.post(`/api/teams/${t2.teamId}/invites`).send({ user_id: p.user.user_id }).expect(201);
      const invites = (await p.get('/api/me/invites').expect(200)).body.invites;
      await p.post(`/api/me/invites/${invites[0].invite_id}/accept`).send({}).expect(200);
      const res = await p.post(`/api/me/invites/${invites[1].invite_id}/accept`).send({}).expect(409);
      expect(res.body.code).to.equal('already_in_team');
      await t1.owner.post(`/api/teams/${t1.teamId}/invites`).send({ user_id: p.user.user_id }).expect(409);
    });

    it('profiles are visible to teammates and for teamless players, not to strangers', async () => {
      const { member } = await teamWithMember();
      const other = await teamWithMember();
      await other.owner.get(`/api/players/${member.user.user_id}`).expect(404);
      const free = await signUp('Visible');
      const p = (await other.owner.get(`/api/players/${free.user.user_id}`).expect(200)).body.profile;
      expect(p).to.not.have.property('email');
    });
  });

  describe('recruitment', () => {
    it('lists recruiting teams with discovery info only; requests show pending and never add the player', async () => {
      const { owner, teamId } = await teamWithMember();
      await owner.patch(`/api/teams/${teamId}/recruiting`).send({ is_recruiting: true, roles_needed: ['awper'], recruiting_leagues: 'FACEIT League' }).expect(200);
      const hidden = await teamWithMember();
      const p = await signUp('Seeker');
      const dir = (await p.get('/api/recruiting/teams').expect(200)).body.teams;
      expect(dir.map((t) => t.team_id)).to.deep.equal([teamId]);
      expect(dir[0]).to.include({ roster_size: 2, can_request: true, request_status: null, recruiting_leagues: 'FACEIT League' });
      expect(dir[0].roles_needed).to.deep.equal(['awper']);
      expect(dir[0]).to.not.have.any.keys('tactics', 'members', 'invites', 'owner');
      await p.get(`/api/recruiting/teams/${hidden.teamId}`).expect(404);
      await p.get(`/api/teams/${teamId}/tactics`).expect(404);

      // Entry point 1: directory. Entry point 2: details page. Same request.
      await p.post(`/api/recruiting/teams/${teamId}/requests`).send({ message: 'AWPer here' }).expect(201);
      const dup = await p.post(`/api/recruiting/teams/${teamId}/requests`).send({}).expect(409);
      expect(dup.body.code).to.equal('request_pending');
      expect((await p.get(`/api/recruiting/teams/${teamId}`).expect(200)).body.team).to.include({ request_status: 'pending', can_request: false });
      expect(await connection('team_memberships').where({ team_id: teamId, user_id: p.user.user_id })).to.have.length(0);
      await p.post(`/api/recruiting/teams/${hidden.teamId}/requests`).send({}).expect(404);

      // The owner reviews the requester's profile and issues an invite.
      const requests = (await owner.get(`/api/teams/${teamId}/requests`).expect(200)).body.requests;
      expect(requests[0]).to.include({ user_id: p.user.user_id, status: 'pending' });
      await owner.get(`/api/players/${p.user.user_id}`).expect(200);
      const approved = (await owner.post(`/api/teams/${teamId}/requests/${requests[0].request_id}/invite`).send({}).expect(200)).body;
      expect(approved).to.include({ status: 'invited' });
      expect(await connection('team_memberships').where({ team_id: teamId, user_id: p.user.user_id })).to.have.length(0);
      expect((await p.get('/api/recruiting/teams').expect(200)).body.teams[0].request_status).to.equal('invited');
      const invite = (await p.get('/api/me/invites').expect(200)).body.invites[0];
      await p.post(`/api/me/invites/${invite.invite_id}/accept`).send({}).expect(200);
      expect((await p.get('/api/recruiting/teams').expect(200)).body.teams[0]).to.include({ is_member: true, roster_size: 3 });
    });

    it('owners can decline requests; members cannot review them', async () => {
      const { owner, member, teamId } = await teamWithMember();
      await owner.patch(`/api/teams/${teamId}/recruiting`).send({ is_recruiting: true }).expect(200);
      const p = await signUp('Hopeful');
      const { body } = await p.post(`/api/recruiting/teams/${teamId}/requests`).send({}).expect(201);
      await member.get(`/api/teams/${teamId}/requests`).expect(403);
      await member.post(`/api/teams/${teamId}/requests/${body.request.request_id}/decline`).send({}).expect(403);
      await owner.post(`/api/teams/${teamId}/requests/${body.request.request_id}/decline`).send({}).expect(200);
      await owner.post(`/api/teams/${teamId}/requests/${body.request.request_id}/invite`).send({}).expect(409);
      expect((await p.get('/api/me/requests').expect(200)).body.requests[0].status).to.equal('declined');
      await p.post(`/api/recruiting/teams/${teamId}/requests`).send({}).expect(201); // may ask again
    });
  });

  describe('training calendar', () => {
    it('owners add, edit and remove events; members view; the next event updates', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const base = `/api/teams/${teamId}/events`;
      expect((await member.get(`${base}/next`).expect(200)).body.event).to.equal(null);
      const later = (await owner.post(base).send({ kind: 'game', title: 'Cup match', starts_at: futureIso(48), time_zone: 'Europe/London', opponent: 'Rivals' }).expect(201)).body.event;
      const sooner = (await owner.post(base).send({ kind: 'training', title: 'Aim practice', starts_at: futureIso(2), time_zone: 'America/New_York', notes: 'Bring headphones' }).expect(201)).body.event;
      await owner.post(base).send({ kind: 'training', title: 'Past', starts_at: futureIso(-5), time_zone: 'UTC' }).expect(201);
      expect((await member.get(`${base}/next`).expect(200)).body.event.event_id).to.equal(sooner.event_id);
      const list = (await member.get(base).expect(200)).body;
      expect(list.can_manage).to.equal(false);
      expect(list.events.map((e) => e.title)).to.deep.equal(['Past', 'Aim practice', 'Cup match']);
      expect((await member.get(`${base}/${later.event_id}`).expect(200)).body.event).to.include({ opponent: 'Rivals', time_zone: 'Europe/London' });

      await owner.patch(`${base}/${later.event_id}`).send({ starts_at: futureIso(1) }).expect(200);
      expect((await member.get(`${base}/next`).expect(200)).body.event.event_id).to.equal(later.event_id);
      await owner.delete(`${base}/${later.event_id}`).expect(204);
      expect((await member.get(`${base}/next`).expect(200)).body.event.event_id).to.equal(sooner.event_id);

      await member.patch(`${base}/${sooner.event_id}`).send({ title: 'x' }).expect(403);
      await member.delete(`${base}/${sooner.event_id}`).expect(403);
      await owner.post(base).send({ kind: 'party', title: 'x', starts_at: futureIso(1), time_zone: 'UTC' }).expect(400);
      await owner.post(base).send({ kind: 'game', title: 'x', starts_at: '2026-12-01T18:00', time_zone: 'UTC' }).expect(400);
      await (await signUp('Stranger')).get(base).expect(404);
    });
  });

  describe('notifications', () => {
    it('reach the intended recipients, open the right place and dismiss independently', async () => {
      const { owner, member, teamId } = await teamWithMember();
      await owner.patch(`/api/teams/${teamId}/recruiting`).send({ is_recruiting: true }).expect(200);
      const ids = [owner.user.user_id, member.user.user_id];
      const { tactic } = (await owner.post(`/api/teams/${teamId}/tactics`).send(tacticDoc(ids)).expect(201)).body;
      await owner.put(`/api/tactics/${tactic.tactic_id}/document`).send({ ...tacticDoc(ids), revision: 1 }).expect(200);
      const ev = (await owner.post(`/api/teams/${teamId}/events`).send({ kind: 'training', title: 'Scrim', starts_at: futureIso(3), time_zone: 'UTC' }).expect(201)).body.event;
      await owner.patch(`/api/teams/${teamId}/events/${ev.event_id}`).send({ title: 'Scrim v2' }).expect(200);
      await owner.delete(`/api/teams/${teamId}/events/${ev.event_id}`).expect(204);
      const invitee = await signUp('Invitee');
      await owner.post(`/api/teams/${teamId}/invites`).send({ user_id: invitee.user.user_id }).expect(201);
      const asker = await signUp('Asker');
      await asker.post(`/api/recruiting/teams/${teamId}/requests`).send({}).expect(201);

      const memberList = (await member.get('/api/notifications').expect(200)).body;
      expect(memberList.notifications.map((n) => n.kind)).to.deep.equal(['event_deleted', 'event_updated', 'event_created', 'tactic_updated']);
      expect(memberList.unread_count).to.equal(4);
      expect(memberList.notifications[0].message).to.include('cancelled "Scrim v2"');
      const ownerList = (await owner.get('/api/notifications').expect(200)).body.notifications;
      expect(ownerList.map((n) => n.kind)).to.deep.equal(['join_request']); // actors are not notified of their own changes
      expect((await invitee.get('/api/notifications').expect(200)).body.notifications.map((n) => n.kind)).to.deep.equal(['team_invite']);
      expect((await asker.get('/api/notifications').expect(200)).body.notifications).to.have.length(0);

      const byKind = Object.fromEntries(memberList.notifications.map((n) => [n.kind, n.notification_id]));
      const open = async (who, id) => (await who.post(`/api/notifications/${id}/open`).send({}).expect(200)).body;
      expect(await open(member, byKind.tactic_updated)).to.deep.equal({ href: `/tactics/${tactic.tactic_id}` });
      const cancelled = await open(member, byKind.event_deleted);
      expect(cancelled.href).to.equal('/training');
      expect(cancelled.message).to.include('was cancelled');
      expect((await open(member, byKind.event_created)).href).to.equal('/training'); // the event was removed
      const inviteNote = (await invitee.get('/api/notifications').expect(200)).body.notifications[0];
      expect((await open(invitee, inviteNote.notification_id)).href).to.match(/^\/invites#invite-\d+$/);
      expect((await open(owner, ownerList[0].notification_id)).href).to.equal('/team#requests');
      // Other people's notifications cannot be opened or dismissed.
      await owner.post(`/api/notifications/${byKind.tactic_updated}/open`).send({}).expect(404);
      await owner.post(`/api/notifications/${byKind.tactic_updated}/dismiss`).send({}).expect(404);

      await member.post(`/api/notifications/${byKind.event_updated}/dismiss`).send({}).expect(204);
      const after = (await member.get('/api/notifications').expect(200)).body;
      expect(after.notifications.map((n) => n.kind)).to.deep.equal(['event_deleted', 'event_created', 'tactic_updated']);
      await member.post('/api/notifications/read-all').send({}).expect(200);
      expect((await member.get('/api/notifications').expect(200)).body.unread_count).to.equal(0);
      // Dismissed entries stay dismissed for that recipient only.
      expect((await member.get('/api/notifications').expect(200)).body.notifications).to.have.length(3);
    });

    it('does not duplicate notifications when an action is retried', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const send = () => connection.transaction((trx) => notifications.notify(trx, [member.user.user_id], {
        kind: 'event_created', teamId, actorId: owner.user.user_id, targetType: 'event', targetId: 1, payload: { title: 'x', team_name: 'y' }, key: 'event:1:created',
      }));
      await send();
      await send();
      expect(await connection('notifications').where({ user_id: member.user.user_id, dedupe_key: 'event:1:created' })).to.have.length(1);
      // A retried tactic save with the same revision is rejected, so it cannot notify twice.
      const ids = [owner.user.user_id, member.user.user_id];
      const { tactic } = (await owner.post(`/api/teams/${teamId}/tactics`).send(tacticDoc(ids)).expect(201)).body;
      const body = { ...tacticDoc(ids), revision: 1 };
      await owner.put(`/api/tactics/${tactic.tactic_id}/document`).send(body).expect(200);
      await owner.put(`/api/tactics/${tactic.tactic_id}/document`).send(body).expect(409);
      expect(await connection('notifications').where({ user_id: member.user.user_id, kind: 'tactic_updated' })).to.have.length(1);
    });
  });

  describe('shortcut settings', () => {
    it('persist per user, reject conflicts and reset to defaults', async () => {
      const p = await signUp('Keys');
      const defaults = (await p.get('/api/me/settings').expect(200)).body;
      expect(defaults.shortcuts).to.deep.equal(defaults.defaults);
      const custom = { phase_prev: 'A', phase_next: 'D', tactic_prev: 'Shift+A', tactic_next: 'Shift+D', new_round: 'Ctrl+N', switch_side: 'Space' };
      await p.put('/api/me/settings').send({ shortcuts: custom }).expect(200);
      expect((await p.get('/api/me/settings').expect(200)).body.shortcuts).to.deep.equal(custom);
      expect((await (await signUp('Other')).get('/api/me/settings').expect(200)).body.shortcuts).to.deep.equal(defaults.defaults);
      const conflict = await p.put('/api/me/settings').send({ shortcuts: { ...custom, new_round: 'A' } }).expect(400);
      expect(conflict.body.issues[0].message).to.include('Conflicts with');
      await p.put('/api/me/settings').send({ shortcuts: { ...custom, new_round: 'Ctrl+' } }).expect(400);
      await p.put('/api/me/settings').send({ shortcuts: null }).expect(200);
      expect((await p.get('/api/me/settings').expect(200)).body.shortcuts).to.deep.equal(defaults.defaults);
    });
  });
});
