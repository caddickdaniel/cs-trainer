// Local development only: data to try the Phase 15 tactic features
// (`node scripts/seed-phase15-demo.js`). Refuses to run in production.
//
// Uses the "Phase 14 Test" team (run scripts/seed-phase14-demo.js first) and
// adds a third local player, then creates (once):
// - "Phase 15 route pickups" (T, Nuke): the lead drops a flash on the main
//   floor and an HE on the lower floor; two teammates' routes both pass the
//   flash (the earlier one picks it up), a main-floor route passes over the
//   lower-floor HE without taking it, and in phase 2 a lower-floor route
//   picks it up. The lead's throws have a set order; the member holds an
//   angle (the cone pulses during Play Phase).
// - "Phase 15 lineups" (Ancient, T and CT): empty boards for trying the
//   lineup picker.
// The accounts use the local test password from seed-phase14-demo.js.
const db = require('../db/connection');
const config = require('../config/env');
const users = require('../services/users');
const tactics = require('../services/tactics');
const v = require('../validation');

const PASSWORD = 'phase14-local-only';
const THIRD = { email: 'phase15-third@cs-trainer.test', user_name: 'Phase 15 Third' };

const player = (id, uid, x, y, level = 'main') => ({ id, kind: 'player', x, y, level, user_id: uid, label: '', images: [] });
const util = (id, kind, uid, x, y, seq) => ({ id, kind, x, y, level: 'main', user_id: uid, label: '', images: [], seq });
const route = (id, uid, pts, level = 'main') => ({ id, level, user_id: uid, color: '#ffffff', points: pts.map(([x, y]) => ({ x, y })) });
const drop = (id, uid, kind, x, y, level, seq) => ({ id, type: 'drop', user_id: uid, kind, x, y, level, seq });

function pickupsDoc(lead, member, third) {
  return {
    tactic_name: 'Phase 15 route pickups', map: 'de_nuke', side: 'T', economy: 'Fullbuy', grenade: 0, molly: 0, flash: 0, smoke: 0,
    loadouts: [
      { user_id: lead, slot: null, smoke: 1, flash: 2, molly: 0, he: 1, decoy: 0, kit: false },
      { user_id: member, slot: null, smoke: 1, flash: 0, molly: 0, he: 0, decoy: 0, kit: false },
    ],
    phases: [
      {
        name: 'Outside', notes: 'Lead drops a flash (main) and an HE (lower). Third gets to the flash first.',
        board: {
          markers: [player('l1', lead, 0.5, 0.5), player('m1', member, 0.3, 0.52), player('t1', third, 0.42, 0.48),
            util('s1', 'smoke', lead, 0.62, 0.3, 2), util('f1', 'flash', lead, 0.66, 0.36, 3)],
          routes: [route('rm1', member, [[0.3, 0.52], [0.5, 0.5], [0.7, 0.5]]), route('rt1', third, [[0.42, 0.48], [0.5, 0.5], [0.58, 0.48]])],
          holds: [{ id: 'h1', marker_id: 'm1', angle: -30, spread: 50, length: 0.12 }],
          actions: [drop('d-flash', lead, 'flash', 0.5, 0.5, 'main', 0), drop('d-he', lead, 'he', 0.5, 0.5, 'lower', 1)],
        },
        assignments: [
          { user_id: lead, instruction: 'Drop a flash here and an HE downstairs, then smoke and flash.', utility: '' },
          { user_id: member, instruction: 'Run through outside; hold the angle first.', utility: '' },
          { user_id: third, instruction: 'Grab the flash on the way.', utility: '' },
        ],
      },
      {
        name: 'Ramp', notes: 'Member goes downstairs and picks up the HE.',
        board: {
          markers: [player('l2', lead, 0.62, 0.3), player('m2', member, 0.3, 0.5, 'lower'), player('t2', third, 0.58, 0.48)],
          routes: [route('rm2', member, [[0.3, 0.5], [0.6, 0.5]], 'lower')],
          holds: [], actions: [],
        },
        assignments: [{ user_id: member, instruction: 'Downstairs, take the HE.', utility: '' }],
      },
    ],
  };
}

const lineupDoc = (side) => ({
  tactic_name: `Phase 15 lineups (${side})`, map: 'de_ancient', side, economy: 'Fullbuy', grenade: 0, molly: 0, flash: 0, smoke: 0,
  loadouts: [], phases: [{ name: 'Setup', notes: '', board: { markers: [], routes: [], holds: [], actions: [] }, assignments: [] }],
});

async function main() {
  if (config.isProduction) throw new Error('Local development only.');
  const team = await db('teams').where('team_name', 'Phase 14 Test').first();
  if (!team) throw new Error('Run scripts/seed-phase14-demo.js first.');
  const lead = await db('users').where('email', 'phase14-lead@cs-trainer.test').first();
  const member = await db('users').where('email', 'phase14-member@cs-trainer.test').first();
  const third = (await db('users').where('email', THIRD.email).first()) || await users.createUser({ ...THIRD, password: PASSWORD });
  if (!(await db('team_memberships').where({ team_id: team.team_id, user_id: third.user_id }).first())) {
    await db('team_memberships').insert({ team_id: team.team_id, user_id: third.user_id, player_role: 'entry', is_igl: false });
    await db('users').where('user_id', third.user_id).update({ team_id: team.team_id });
  }
  for (const doc of [pickupsDoc(lead.user_id, member.user_id, third.user_id), lineupDoc('T'), lineupDoc('CT')]) {
    if (await db('tactics').where({ team_id: team.team_id, tactic_name: doc.tactic_name }).first()) continue;
    await tactics.createDocument(team.team_id, lead.user_id, v.tacticDocument.parse(doc));
  }
  const list = await db('tactics').where('team_id', team.team_id).select('tactic_id', 'tactic_name');
  console.log(JSON.stringify({ team_id: team.team_id, third: third.user_id, tactics: list }));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
