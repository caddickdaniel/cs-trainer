// Development only: 30 shared tactics for the community Browse page (three
// for every side × economy), published by a "Community Library" team.
//
// Idempotent: listings are matched by name within the library team, so
// running it again refreshes their content but never duplicates a listing or
// resets votes, imports or anything else users did.
//
// Content is plausible placeholder: every tactic has 2-3 phases, all five
// player slots have a position and an instruction in every phase, and the
// boards include routes, utility markers matching each player's buy list,
// the bomb carrier on T and defuse kits on CT.
const { upsertUser } = require('./demo');

const LIBRARY_OWNER = { email: 'demo-library@cs-trainer.test', user_name: 'Library', language: 'English', region: 'EU West' };
const LIBRARY_TEAM = 'Community Library';

// Spawn and bombsite positions (radar coordinates; mirrors client/src/lib/landmarks.ts).
const MAPS = {
  de_mirage: { ct: [0.363, 0.682], t: [0.868, 0.363], a: [0.537, 0.699], b: [0.24, 0.289], mid: [0.5, 0.45] },
  de_inferno: { ct: [0.89, 0.35], t: [0.1, 0.67], a: [0.81, 0.68], b: [0.485, 0.22], mid: [0.6, 0.5] },
  de_dust2: { ct: [0.6, 0.2], t: [0.38, 0.9], a: [0.8, 0.16], b: [0.21, 0.13], mid: [0.48, 0.5] },
  de_ancient: { ct: [0.508, 0.091], t: [0.475, 0.857], a: [0.255, 0.293], b: [0.77, 0.381], mid: [0.5, 0.45] },
  de_anubis: { ct: [0.42, 0.22], t: [0.47, 0.89], a: [0.74, 0.26], b: [0.33, 0.49], mid: [0.55, 0.55] },
  de_nuke: { ct: [0.828, 0.463], t: [0.21, 0.553], a: [0.566, 0.554], b: [0.602, 0.454], mid: [0.45, 0.6], bLevel: 'lower' },
  de_overpass: { ct: [0.5, 0.08], t: [0.62, 0.87], a: [0.37, 0.2], b: [0.8, 0.33], mid: [0.55, 0.5] },
};
const MAP_IDS = Object.keys(MAPS);
const MAP_NAME = { de_mirage: 'Mirage', de_inferno: 'Inferno', de_dust2: 'Dust II', de_ancient: 'Ancient', de_anubis: 'Anubis', de_nuke: 'Nuke', de_overpass: 'Overpass' };
const ECONOMY_NAME = { Pistol: 'pistol', Eco: 'eco', Force: 'force', Halfbuy: 'half buy', Fullbuy: 'full buy' };

// What each of the five slots buys per economy (within CS2 carry limits).
const BUYS = {
  Pistol: [{ flash: 1 }, { smoke: 1 }, {}, { flash: 1 }, {}],
  Eco: [{ flash: 1 }, {}, { smoke: 1 }, {}, {}],
  Force: [{ flash: 2 }, { smoke: 1 }, { molly: 1 }, { he: 1 }, { flash: 1 }],
  Halfbuy: [{ flash: 2, smoke: 1 }, { smoke: 1 }, { molly: 1, flash: 1 }, { he: 1 }, { flash: 1 }],
  Fullbuy: [{ flash: 2, smoke: 1 }, { smoke: 1, he: 1 }, { molly: 1, flash: 2 }, { smoke: 1, flash: 1 }, { he: 1, flash: 1, molly: 1 }],
};

const PLANS = {
  T: [
    { key: 'exec', target: 'a', name: (m) => `${m} A execute` },
    { key: 'split', target: 'b', name: (m) => `${m} B split` },
    { key: 'fake', target: 'a', fakeTo: 'b', name: (m) => `${m} B fake into A` },
  ],
  CT: [
    { key: 'default', target: 'a', name: (m) => `${m} 2-1-2 default` },
    { key: 'stack', target: 'b', name: (m) => `${m} B stack` },
    { key: 'retake', target: 'a', name: (m) => `${m} A retake` },
  ],
};

const round4 = (n) => Math.round(Math.min(0.97, Math.max(0.03, n)) * 10000) / 10000;
const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
const OFFSETS = [[-0.03, -0.02], [0.03, -0.02], [0, 0.03], [-0.035, 0.025], [0.035, 0.025]];
const at = (p, i, scale = 1) => [round4(p[0] + OFFSETS[i][0] * scale), round4(p[1] + OFFSETS[i][1] * scale)];

function levelFor(map, spot) {
  const m = MAPS[map];
  if (spot === 'b' && m.bLevel) return m.bLevel;
  if (map === 'de_vertigo' && spot === 't') return 'lower';
  return 'main';
}

const INSTRUCTIONS = {
  T: [
    ['Lead the entry and clear close angles', 'Entry onto site, call what you see'],
    ['Smoke the CT cross and follow the entry', 'Trade the entry, then hold the CT side'],
    ['Flash for the entry from the side lane', 'Plant the bomb in the safe spot, then hold it'],
    ['Lurk mid and watch for rotations', 'Cut off the rotation through mid'],
    ['AWP the long angle for an early pick', 'Hold the plant from distance'],
  ],
  CT: [
    ['Anchor A and play off your smoke', 'Fall back and wait for the retake utility'],
    ['Hold the A entrance with crossfire', 'Rotate through CT to the site under attack'],
    ['Watch mid for early aggression', 'Flash your teammates in and trade'],
    ['Anchor B and play the close corner', 'Hold B until the call, then retake together'],
    ['Support B with utility and info', 'Molly the plant spot and check corners'],
  ],
};

function buildTactic(side, economy, plan, map, variant) {
  const m = MAPS[map];
  const target = plan.target;
  const buys = BUYS[economy].map((b) => ({ smoke: 0, flash: 0, molly: 0, he: 0, ...b }));
  const loadouts = buys.map((b, i) => ({ user_id: null, slot: i + 1, ...b, kit: side === 'CT' && (i === 1 || i === 3) }));
  const slot = (i) => i + 1;
  let id = 0;
  const nid = (p) => `${p}${variant}${(id += 1).toString(36)}`;

  // Where each slot stands in each phase.
  let positions;
  let spots;
  if (side === 'T') {
    const site = m[target];
    const start = m.t;
    const approach = lerp(start, plan.fakeTo ? m[plan.fakeTo] : site, 0.55);
    positions = [
      [0, 1, 2, 3, 4].map((i) => at(start, i, 1.2)),
      [0, 1, 2, 3, 4].map((i) => (i === 3 ? at(m.mid, i) : at(approach, i, 1.4))),
      [0, 1, 2, 3, 4].map((i) => (i === 3 ? at(lerp(m.mid, m.ct, 0.3), i) : at(site, i, 1.6))),
    ];
    spots = [['t', 't', 't', 't', 't'], [null, null, null, null, null], [target, target, target, null, target]];
  } else {
    const hold = [m.a, m.a, m.mid, m.b, m.b];
    const site = m[target];
    positions = [
      hold.map((p, i) => at(p, i)),
      [0, 1, 2, 3, 4].map((i) => at(lerp(hold[i], site, plan.key === 'retake' ? 0.6 : 0.3), i, 1.3)),
      [0, 1, 2, 3, 4].map((i) => at(site, i, 1.5)),
    ];
    spots = [['a', 'a', null, 'b', 'b'], [null, null, null, null, null], [target, target, target, target, target]];
  }
  const phaseCount = variant % 3 === 2 ? 3 : 2;
  const names = side === 'T'
    ? ['Default and gather', plan.fakeTo ? 'Fake pressure' : 'Take control', 'Execute and plant']
    : ['Set up', plan.key === 'retake' ? 'Fall back' : 'Rotate on info', 'Retake together'];

  const phases = [];
  // Utility is thrown in phase 2 (the take / rotation); later phases keep the rest.
  for (let p = 0; p < phaseCount; p += 1) {
    const markers = positions[p].map((pos, i) => ({
      id: nid('m'), kind: 'player', x: pos[0], y: pos[1], level: spots[p][i] ? levelFor(map, spots[p][i]) : 'main',
      user_id: null, slot: slot(i), label: '', images: [],
    }));
    const routes = p === 0 ? [] : [0, 1, 2].map((i) => ({
      id: nid('r'), level: markers[i].level, user_id: null, slot: slot(i), color: '#ffffff',
      points: [{ x: positions[p - 1][i][0], y: positions[p - 1][i][1] }, { x: positions[p][i][0], y: positions[p][i][1] }],
    }));
    const utility = [];
    if (p === 1) {
      const site = m[target];
      buys.forEach((b, i) => {
        // Each player throws one of each grenade they bought (the second flash is kept for later).
        ['smoke', 'flash', 'molly', 'he'].forEach((kind, k) => {
          if (!b[kind]) return;
          const spot = at(site, (i + k) % 5, 2.4);
          utility.push({ id: nid('u'), kind, x: spot[0], y: spot[1], level: levelFor(map, target), user_id: null, slot: slot(i), label: '', images: [] });
        });
      });
    }
    const holds = side === 'CT' && p === 0
      ? [0, 3].map((i) => ({ id: nid('h'), marker_id: markers[i].id, angle: 90 * ((i + variant) % 4), spread: 60, length: 0.12 }))
      : [];
    const notes = p === 0 ? `${ECONOMY_NAME[economy][0].toUpperCase()}${ECONOMY_NAME[economy].slice(1)} round. Placeholder plan for testing.` : '';
    phases.push({
      name: names[p],
      notes,
      board: { markers: [...markers, ...utility], routes, holds },
      assignments: [0, 1, 2, 3, 4].map((i) => ({
        slot: slot(i),
        instruction: INSTRUCTIONS[side][i][Math.min(p, 1)] + (side === 'T' && i === 2 ? ' (you carry the bomb)' : ''),
        // Utility lives on the buy lists and map markers (no free-text utility).
        utility: '',
      })),
    });
  }
  const totals = buys.reduce((t, b) => ({ smoke: t.smoke + b.smoke, flash: t.flash + b.flash, molly: t.molly + b.molly, grenade: t.grenade + b.he }),
    { smoke: 0, flash: 0, molly: 0, grenade: 0 });
  return {
    tactic: {
      tactic_name: plan.name(MAP_NAME[map]) + (economy === 'Fullbuy' ? '' : ` (${ECONOMY_NAME[economy]})`),
      map, side, economy, ...totals,
      loadouts,
      bomb_carrier: side === 'T' ? { user_id: null, slot: 3 } : null,
      // In-game colours, in palette order for Player 1-5.
      player_colors: ['orange', 'green', 'blue', 'yellow', 'purple'].map((color, i) => ({ user_id: null, slot: i + 1, color })),
    },
    slot_count: 5,
    phases,
  };
}

// All 30 snapshots, deterministic.
function sharedTacticSnapshots() {
  const out = [];
  let n = 0;
  for (const side of ['T', 'CT']) {
    for (const economy of ['Pistol', 'Eco', 'Force', 'Halfbuy', 'Fullbuy']) {
      PLANS[side].forEach((plan) => {
        const map = MAP_IDS[n % MAP_IDS.length];
        out.push(buildTactic(side, economy, plan, map, n));
        n += 1;
      });
    }
  }
  return out;
}

async function ensureSharedTactics(knex, passwordHash, log = () => {}) {
  const { user_id: ownerId } = await upsertUser(knex, LIBRARY_OWNER, passwordHash);
  let team = await knex('teams').where({ team_name: LIBRARY_TEAM, owner: ownerId }).first('team_id');
  if (!team) {
    [team] = await knex('teams').insert({ team_name: LIBRARY_TEAM, owner: ownerId, language: 'English', region: 'EU West',
      description: 'Development-only publisher of the seeded community tactics.' }).returning('team_id');
    await knex('team_memberships').insert({ team_id: team.team_id, user_id: ownerId, player_role: 'igl', is_igl: true });
    await knex('users').where('user_id', ownerId).update({ team_id: team.team_id });
  }
  let created = 0;
  for (const snap of sharedTacticSnapshots()) {
    const row = {
      tactic_name: snap.tactic.tactic_name, map: snap.tactic.map, side: snap.tactic.side, economy: snap.tactic.economy,
      phase_count: snap.phases.length, snapshot: JSON.stringify(snap),
    };
    const existing = await knex('shared_tactics')
      .where({ source_team_id: team.team_id, tactic_name: row.tactic_name }).whereNull('withdrawn_at').first('share_id');
    if (existing) {
      await knex('shared_tactics').where('share_id', existing.share_id).update({ ...row, updated_at: knex.fn.now() });
    } else {
      await knex('shared_tactics').insert({ ...row, source_team_id: team.team_id, source_tactic_id: null, published_by: ownerId, source_revision: 1 });
      created += 1;
    }
  }
  log(`shared tactics: ${created} created, ${30 - created} refreshed (team "${LIBRARY_TEAM}")`);
}

module.exports = { ensureSharedTactics, sharedTacticSnapshots, LIBRARY_TEAM };
