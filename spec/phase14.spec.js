// Phase 14 (tactics): buy-list prices and totals, decoys, drops with ordered
// inventory, their survival through save / reopen / share / import (Player
// 1-5 slots), parity between the server and client utility rules, and the
// Play Phase timeline. Updated for Phase 15: pickups follow from routes
// (spec/phase15.spec.js covers them in detail).
const path = require('path');
const { expect } = require('chai');
const { reseed, teamWithMember } = require('./helpers');
const U = require('../domain/utility');

const client = (file) => import(path.join(__dirname, '../client/src/lib', file));
const player = (id, uid, x = 0.5, y = 0.5) => ({ id, kind: 'player', x, y, level: 'main', user_id: uid, label: '', images: [] });
const util = (id, kind, uid, extra = {}) => ({ id, kind, x: 0.4, y: 0.4, level: 'main', user_id: uid, label: '', images: [], ...extra });

// p1 buys a smoke + 2 flashes + a decoy and drops a flash in phase 1; p2's
// route crosses it in phase 2 (picking it up) and p2 throws it in phase 3.
function dropDoc(p1, p2, side = 'T', overrides = {}) {
  return {
    tactic_name: 'Drop plan', map: 'de_mirage', side, economy: 'Fullbuy', grenade: 0, molly: 0, flash: 0, smoke: 0,
    loadouts: [
      { user_id: p1, slot: null, smoke: 1, flash: 2, molly: 0, he: 0, decoy: 1, kit: false },
      { user_id: p2, slot: null, smoke: 0, flash: 0, molly: 1, he: 1, kit: side === 'CT' },
    ],
    phases: [
      { name: 'Set up', board: {
        markers: [player('a', p1), player('b', p2, 0.6, 0.6), util('s1', 'smoke', p1, { seq: 1, path: [{ x: 0.45, y: 0.45 }] })],
        routes: [{ id: 'r1', level: 'main', user_id: p1, color: '#ffffff', points: [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.4 }] }],
        actions: [{ id: 'd1', type: 'drop', user_id: p1, kind: 'flash', x: 0.5, y: 0.4, level: 'main', seq: 0 }],
      }, assignments: [{ user_id: p1, instruction: 'Drop a flash, then smoke', utility: '' }] },
      { name: 'Pick up', board: {
        markers: [player('c', p1), player('e', p2, 0.6, 0.6)],
        routes: [{ id: 'r2', level: 'main', user_id: p2, color: '#ffffff', points: [{ x: 0.6, y: 0.6 }, { x: 0.5, y: 0.4 }] }],
        actions: [],
      }, assignments: [{ user_id: p2, instruction: 'Grab the flash', utility: '' }] },
      { name: 'Execute', board: { markers: [player('f', p1), player('g', p2), util('f9', 'flash', p2)], routes: [] }, assignments: [] },
    ],
    ...overrides,
  };
}

describe('phase 14', () => {
  describe('buy prices', () => {
    it('totals T and CT buy lists with CS2 prices (fire by side, kit on CT, decoys)', () => {
      const l = { smoke: 1, flash: 2, molly: 1, he: 1, decoy: 0, kit: true };
      expect(U.buyCost(l, 'T')).to.equal(300 + 400 + 400 + 300); // no kit on T
      expect(U.buyCost(l, 'CT')).to.equal(300 + 400 + 500 + 300 + 400);
      expect(U.buyCost({ smoke: 0, flash: 0, molly: 0, he: 0, decoy: 1 }, 'T')).to.equal(50);
      // Older buy lists have no decoy.
      expect(U.buyCost({ smoke: 1, flash: 0, molly: 0, he: 0, kit: false }, 'T')).to.equal(300);
    });

    it('keeps the cost tied to the buy list when drops, pickups and throws change what a player carries', () => {
      const plan = U.utilityPlan({ loadouts: dropDoc(1, 2).loadouts, phases: dropDoc(1, 2).phases, side: 'T' });
      const a = plan.find((p) => p.key === 'u1');
      const b = plan.find((p) => p.key === 'u2');
      expect(a.cost).to.equal(300 + 400 + 50);
      expect(b.cost).to.equal(400 + 300);
    });
  });

  describe('drops and pickups', () => {
    it('derives inventory per phase in order: drop, route pickup in a later phase, then the throw', () => {
      const { loadouts, phases } = dropDoc(1, 2);
      const plan = U.utilityPlan({ loadouts, phases, side: 'T', map: 'de_mirage' });
      const a = plan.find((p) => p.key === 'u1');
      const b = plan.find((p) => p.key === 'u2');
      expect(a.phases[0].start).to.include({ flash: 2, smoke: 1, decoy: 1 });
      expect(a.phases[0].dropped).to.include({ flash: 1 });
      expect(a.phases[1].start).to.include({ flash: 1, smoke: 0 });
      expect(b.phases[1].start.flash).to.equal(0);
      expect(b.phases[1].picked).to.include({ flash: 1 });
      expect(b.phases[2].start.flash).to.equal(1);
      expect(b.phases[2].used).to.include({ flash: 1 });
      expect(a.over).to.deep.equal([]);
      expect(b.over).to.deep.equal([]);
      // Stepping back / replaying gives the same numbers.
      expect(U.utilityPlan({ loadouts, phases, side: 'T', map: 'de_mirage' })).to.deep.equal(plan);
    });

    it('flags unavailable utility and leaves an item a player can\'t carry on the ground', () => {
      const doc = dropDoc(1, 2);
      // p2 already carries 2 flashes, so passing the dropped flash can't pick it up.
      doc.loadouts[1] = { user_id: 2, slot: null, smoke: 0, flash: 2, molly: 0, he: 0, kit: false };
      // p1 drops a molotov they never bought.
      doc.phases[2].board.actions = [{ id: 'd2', type: 'drop', user_id: 1, kind: 'molly', x: 0.3, y: 0.3, level: 'main' }];
      const plan = U.phasePlan({ loadouts: doc.loadouts, phases: doc.phases, side: 'T', map: 'de_mirage' });
      const b = plan.players.find((p) => p.key === 'u2');
      expect(b.phases[1].picked.flash).to.equal(0);
      expect(plan.sims[1].blocked.map((x) => [x.id, x.key])).to.deep.equal([['d1', 'u2']]);
      expect(plan.final.map((g) => g.id)).to.deep.equal(['d1']);
      expect(plan.players.find((p) => p.key === 'u1').over.map((o) => [o.type, o.kind, o.phase])).to.deep.include(['drop_unavailable', 'molly', 2]);
    });

    it('ignores Phase 14 pickup annotations and rejects repeated drop ids', () => {
      const old = dropDoc(1, 2);
      old.phases[1].board.routes = [];
      old.phases[1].board.actions = [{ id: 'p1', type: 'pickup', user_id: 2, drop_id: 'd1', x: 0.5, y: 0.4, level: 'main', seq: 0 }];
      const plan = U.utilityPlan({ loadouts: old.loadouts, phases: old.phases, side: 'T', map: 'de_mirage' });
      expect(plan.find((p) => p.key === 'u2').phases[1].picked.flash).to.equal(0);
      expect(U.actionErrors(old.phases)).to.deep.equal([]);
      const twice = dropDoc(1, 2);
      twice.phases[2].board.actions = [{ id: 'd1', type: 'drop', user_id: 1, kind: 'smoke', x: 0.5, y: 0.4, level: 'main' }];
      expect(U.actionErrors(twice.phases).map((e) => e.message)).to.include('Each drop needs its own id');
    });
  });

  describe('server and client agree', () => {
    it('gives the same plan and errors from domain/utility.js and lib/utility.ts', async () => {
      const c = await client('utility.ts');
      for (const side of ['T', 'CT']) {
        const { loadouts, phases } = dropDoc(1, 2, side);
        const server = U.utilityPlan({ loadouts, phases, side, map: 'de_mirage' });
        const mine = c.utilityPlan(loadouts, phases, side, 'de_mirage');
        for (const p of server) {
          const m = mine.get(p.key);
          expect({ buy: m.buy, cost: m.cost, phases: m.phases, over: m.over }).to.deep.equal({ buy: p.buy, cost: p.cost, phases: p.phases, over: p.over });
        }
        expect(c.buyCost(loadouts[1], side)).to.equal(U.buyCost(loadouts[1], side));
      }
      const bad = dropDoc(1, 2);
      bad.phases[2].board.actions = [{ ...bad.phases[0].board.actions[0] }];
      expect(c.actionErrors(bad.phases)).to.deep.equal(U.actionErrors(bad.phases));
      expect(c.actionErrors(bad.phases)).to.have.length(1);
    });
  });

  describe('Play Phase timeline', () => {
    it('moves players along routes at a map-scaled pace, then runs each player\'s actions in order 0.5 s apart', async () => {
      const { frameAt } = await client('phasePlayback.ts');
      const { simulatePhase, moveAt, GAP_S, RUN_SPEED } = await client('utility.ts');
      const board = {
        markers: [player('a', 1), player('b', 2, 0.2, 0.2), util('x1', 'flash', 1, { seq: 1 }), util('x2', 'smoke', 1, { seq: 0 }), util('y1', 'he', 2)],
        routes: [{ id: 'r1', level: 'main', user_id: 1, color: '#fff', points: [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.4 }] }],
        actions: [],
      };
      const start = new Map([['u1', { smoke: 1, flash: 1, molly: 0, he: 0, decoy: 0 }], ['u2', { smoke: 0, flash: 0, molly: 0, he: 1, decoy: 0 }]]);
      const sim = simulatePhase({ board, map: 'de_mirage', start });
      const move = sim.moves.get('u1');
      // 0.1 of the board on Mirage (1024 px × scale 5) at the running pace.
      expect(move.end).to.be.closeTo((0.1 * 1024 * 5) / RUN_SPEED, 1e-9);
      expect(sim.moves.get('u2').end).to.equal(0); // no route: stays put
      const a = sim.steps.filter((s) => s.key === 'u1');
      expect(a.map((s) => s.id)).to.deep.equal(['x2', 'x1']); // set order, not board order
      expect(a[0].start).to.be.closeTo(move.end, 1e-9);
      expect(a[1].start).to.be.closeTo(a[0].end + GAP_S, 1e-9);
      // Player 2's throw runs alongside, from t = 0.
      expect(sim.steps.find((s) => s.id === 'y1').start).to.equal(0);
      // Frames: player 1 mid-route, a utility shown only once it lands; the saved board is untouched.
      const before = JSON.stringify(board);
      const f = frameAt(board, sim, move.end / 2, start, [], moveAt);
      expect(f.board.markers.find((m) => m.id === 'a').y).to.be.closeTo(0.45, 1e-6);
      expect(f.board.markers.some((m) => m.id === 'x1')).to.equal(false);
      const end = frameAt(board, sim, sim.duration, start, [], moveAt);
      expect(end.board.markers.some((m) => m.id === 'x1')).to.equal(true);
      expect(end.inventory.get('u1')).to.include({ smoke: 0, flash: 0 });
      expect(JSON.stringify(board)).to.equal(before);
      // Replaying gives the same timeline.
      expect(JSON.stringify(simulatePhase({ board, map: 'de_mirage', start }).steps)).to.equal(JSON.stringify(sim.steps));
    });
  });

  describe('save, reopen, share and import', () => {
    beforeEach(reseed);

    it('validates side and quantity limits and drop ids on save', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const [p1, p2] = [owner.user.user_id, member.user.user_id];
      const url = `/api/teams/${teamId}/tactics`;
      await owner.post(url).send(dropDoc(p1, p2, 'T', { loadouts: [{ user_id: p1, slot: null, smoke: 0, flash: 0, molly: 0, he: 0, decoy: 2, kit: false }] })).expect(400);
      await owner.post(url).send(dropDoc(p1, p2, 'T', { loadouts: [{ user_id: p1, slot: null, smoke: 1, flash: 2, molly: 1, he: 0, decoy: 1, kit: false }] })).expect(400); // 5 grenades
      await owner.post(url).send(dropDoc(p1, p2, 'T', { loadouts: [{ user_id: p1, slot: null, smoke: 0, flash: 0, molly: 0, he: 0, kit: true }] })).expect(400); // kit on T
      const twice = dropDoc(p1, p2);
      twice.phases[2].board.actions = [{ id: 'd1', type: 'drop', user_id: p1, kind: 'smoke', x: 0.5, y: 0.4, level: 'main' }];
      const res = await owner.post(url).send(twice).expect(400);
      expect(JSON.stringify(res.body)).to.include('Each drop needs its own id');
    });

    it('keeps drops, routes, order and throw paths after saving, reopening, sharing and importing', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const [p1, p2] = [owner.user.user_id, member.user.user_id];
      const { tactic } = (await owner.post(`/api/teams/${teamId}/tactics`).send(dropDoc(p1, p2, 'CT')).expect(201)).body;
      const doc = (await member.get(`/api/tactics/${tactic.tactic_id}/document`).expect(200)).body.tactic;
      expect(doc.phases[0].board.actions[0]).to.include({ type: 'drop', kind: 'flash', seq: 0, user_id: p1 });
      expect(doc.phases[1].board.actions).to.deep.equal([]);
      expect(doc.phases[1].board.routes[0]).to.include({ id: 'r2', user_id: p2 });
      expect(doc.phases[0].board.markers.find((m) => m.id === 's1')).to.include({ seq: 1 });
      expect(doc.loadouts.find((l) => l.user_id === p1).decoy).to.equal(1);

      const { tactic: listing } = (await owner.post(`/api/tactics/${tactic.tactic_id}/share`).send({}).expect(200)).body;
      expect(JSON.stringify(listing)).to.not.include(`"user_id":${p1}`);
      const drop = listing.phases[0].board.actions[0];
      expect(drop).to.include({ type: 'drop', kind: 'flash', user_id: null, slot: 1, x: 0.5, y: 0.4, level: 'main' });
      expect(listing.phases[1].board.routes[0]).to.include({ user_id: null, slot: 2 });
      expect(listing.phases[0].board.markers.find((m) => m.id === 's1')).to.deep.include({ seq: 1, path: [{ x: 0.45, y: 0.45 }] });

      const other = await teamWithMember();
      const { tactic_id: imported } = (await other.owner.post(`/api/shared-tactics/${listing.share_id}/import`).send({ team_id: other.teamId }).expect(201)).body;
      const copy = (await other.owner.get(`/api/tactics/${imported}/document`).expect(200)).body.tactic;
      expect(copy.phases[0].board.actions[0]).to.include({ type: 'drop', kind: 'flash', slot: 1 });
      expect(copy.loadouts.find((l) => l.slot === 1).decoy).to.equal(1);
      // The imported copy derives the same inventory as the original (by slot).
      const original = U.utilityPlan({ loadouts: doc.loadouts, phases: doc.phases, side: 'CT', map: doc.map }).map((p) => p.phases);
      const again = U.utilityPlan({ loadouts: copy.loadouts, phases: copy.phases, side: 'CT', map: copy.map }).map((p) => p.phases);
      expect(again).to.deep.equal(original);
      expect(original.some((ph) => ph[1] && ph[1].picked.flash === 1)).to.equal(true);
    });

    it('opens older tactics that have no decoys or actions', async () => {
      const { owner, member, teamId } = await teamWithMember();
      const legacy = dropDoc(owner.user.user_id, member.user.user_id);
      legacy.loadouts = [{ user_id: owner.user.user_id, slot: null, smoke: 1, flash: 0, molly: 0, he: 0, kit: false }];
      legacy.phases.forEach((p) => { delete p.board.actions; p.board.markers.forEach((m) => delete m.seq); });
      const { tactic } = (await owner.post(`/api/teams/${teamId}/tactics`).send(legacy).expect(201)).body;
      const doc = (await member.get(`/api/tactics/${tactic.tactic_id}/document`).expect(200)).body.tactic;
      expect(doc.phases[0].board.actions).to.deep.equal([]);
      expect(U.buyCost(doc.loadouts[0], 'T')).to.equal(300);
    });
  });
});

describe('phase 14 capture schedules', () => {
  const P = require('../services/capturePlan');
  // Round 1: A kills B at 1000 and 1100 (overlapping windows), C kills A at
  // 1050 through smoke (X-ray), B throws a smoke released at 900.
  const players = [{ index: 0, name: 'A' }, { index: 1, name: 'B' }, { index: 2, name: 'C' }];
  const round = { start_tick: 0, end_tick: 5000 };
  const items = [
    { capture_id: 1, kind: 'kill', round_number: 1, round, ev: { tick: 1000, attacker: 0, victim: 1 }, dir: '/1' },
    { capture_id: 2, kind: 'kill', round_number: 1, round, ev: { tick: 1100, attacker: 0, victim: 1 }, dir: '/2' },
    { capture_id: 3, kind: 'kill', round_number: 1, round, ev: { tick: 1050, attacker: 2, victim: 0, through_smoke: true }, dir: '/3' },
    { capture_id: 4, kind: 'utility', round_number: 1, round, ev: { type: 'smoke', tick: 1200, throw_tick: 900, player: 1 }, dir: '/4' },
  ];
  const plan = P.planWindows({ tickrate: 64, meta: { players } }, items, { group: false }); // grouping: spec/phase15.spec.js

  it('chronological records each window in tick order', () => {
    const steps = P.schedule(plan, 'chronological');
    const segs = steps.filter((s) => s.op === 'segment');
    expect(segs).to.have.length(plan.windows.length);
    expect(segs.map((s) => s.start)).to.deep.equal([...segs.map((s) => s.start)].sort((a, b) => a - b));
    // The lineup comes right before the throw's clip.
    const li = steps.findIndex((s) => s.op === 'lineup');
    expect(steps[li + 1].outputs[0]).to.include({ capture_id: 4, role: 'replay' });
  });

  it('by player keeps one POV until its windows are done', () => {
    const segs = P.schedule(plan, 'player').filter((s) => s.op === 'segment');
    const order = segs.map((s) => s.player);
    expect(order).to.deep.equal([...order].sort());
    const stats = P.scheduleStats(P.schedule(plan, 'player'));
    expect(stats.pov_switches).to.equal(2);
  });

  it('hybrid merges overlapping windows with the same POV and settings only, keeping each clip\'s own window', () => {
    const steps = P.schedule(plan, 'hybrid');
    const segs = steps.filter((s) => s.op === 'segment');
    const aKiller = segs.find((s) => s.player === 'A' && !s.xray);
    // A's two kills (936-1064 and 1036-1164) are one recording...
    expect(aKiller).to.include({ start: 936, end: 1164 });
    expect(aKiller.outputs.map((o) => [o.capture_id, o.role, o.start, o.end])).to.deep.equal([[1, 'killer_clip', 936, 1064], [2, 'killer_clip', 1036, 1164]]);
    // ...but A as an X-ray victim (C's through-smoke kill) is not merged with them.
    expect(segs.find((s) => s.player === 'A' && s.xray).outputs.map((o) => o.capture_id)).to.deep.equal([3]);
    // B's two victim clips merge; B's smoke clip (836-964) overlaps them too and has the same settings.
    const b = segs.filter((s) => s.player === 'B');
    expect(b).to.have.length(1);
    expect(b[0].outputs.map((o) => o.role).sort()).to.deep.equal(['replay', 'victim_clip', 'victim_clip']);
    const stats = P.scheduleStats(steps);
    expect(stats.segments).to.be.below(plan.windows.length);
    expect(stats.outputs).to.equal(plan.windows.length);
    // Every requested output is still produced once, with its own file.
    expect(new Set(segs.flatMap((s) => s.outputs.map((o) => o.file))).size).to.equal(plan.windows.length);
  });

  it('never merges across rounds', () => {
    const r2 = { start_tick: 1000, end_tick: 9000 };
    const two = P.planWindows({ tickrate: 64, meta: { players } }, [
      { capture_id: 5, kind: 'kill', round_number: 1, round: { start_tick: 0, end_tick: 1010 }, ev: { tick: 1000, attacker: 0, victim: 1 }, dir: '/5' },
      { capture_id: 6, kind: 'kill', round_number: 2, round: r2, ev: { tick: 1020, attacker: 0, victim: 1 }, dir: '/6' },
    ]);
    expect(P.schedule(two, 'hybrid').filter((s) => s.op === 'segment' && s.player === 'A')).to.have.length(2);
  });
});
