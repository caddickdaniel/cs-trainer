// Local development only: a small team to try the Phase 14 tactic features
// (`node scripts/seed-phase14-demo.js`). Refuses to run in production.
//
// Creates (once; running again changes nothing):
// - "Phase 14 Lead" (IGL/owner) and "Phase 14 Member" (an ordinary member,
//   role Support) on the team "Phase 14 Test";
// - a T tactic on Mirage: buy lists with prices, a flash dropped by the lead
//   in phase 1 and picked up by the member in phase 2, routes, and throws in
//   a set order (Play Phase);
// - a CT tactic with kits, an incendiary and a decoy (CT buy totals).
// Both accounts use the local test password below.
const db = require('../db/connection');
const config = require('../config/env');
const users = require('../services/users');
const teams = require('../services/teams');
const tactics = require('../services/tactics');
const v = require('../validation');

const PASSWORD = 'phase14-local-only';
const LEAD = { email: 'phase14-lead@cs-trainer.test', user_name: 'Phase 14 Lead' };
const MEMBER = { email: 'phase14-member@cs-trainer.test', user_name: 'Phase 14 Member' };

const player = (id, uid, x, y) => ({ id, kind: 'player', x, y, level: 'main', user_id: uid, label: '', images: [] });
const util = (id, kind, uid, x, y, seq, path) => ({ id, kind, x, y, level: 'main', user_id: uid, label: '', images: [], seq, ...(path ? { path } : {}) });

function tDoc(lead, member) {
  return {
    tactic_name: 'Phase 14 drop and execute', map: 'de_mirage', side: 'T', economy: 'Fullbuy', grenade: 0, molly: 0, flash: 0, smoke: 0,
    loadouts: [
      { user_id: lead, slot: null, smoke: 1, flash: 2, molly: 0, he: 0, decoy: 1, kit: false },
      { user_id: member, slot: null, smoke: 1, flash: 0, molly: 1, he: 1, decoy: 0, kit: false },
    ],
    bomb_carrier: { user_id: member, slot: null },
    phases: [
      {
        name: 'Take mid', notes: 'Lead drops a flash for the member, then smokes window.',
        board: {
          markers: [player('pl1', lead, 0.62, 0.70), player('pm1', member, 0.70, 0.74),
            util('s-window', 'smoke', lead, 0.47, 0.42, 1, [{ x: 0.56, y: 0.55 }]), util('f-mid', 'flash', lead, 0.50, 0.50, 2),
            util('m-molly', 'molly', member, 0.44, 0.47, 0)],
          routes: [
            { id: 'rl1', level: 'main', user_id: lead, color: '#f5a524', points: [{ x: 0.62, y: 0.70 }, { x: 0.60, y: 0.62 }, { x: 0.58, y: 0.58 }] },
            { id: 'rm1', level: 'main', user_id: member, color: '#88cef5', points: [{ x: 0.70, y: 0.74 }, { x: 0.66, y: 0.66 }] },
          ],
          holds: [],
          actions: [{ id: 'drop-flash', type: 'drop', user_id: lead, kind: 'flash', x: 0.60, y: 0.62, level: 'main', seq: 0 }],
        },
        assignments: [
          { user_id: lead, instruction: 'Drop a flash on the way, smoke window, flash mid.', utility: '' },
          { user_id: member, instruction: 'Molly top-mid, follow to connector.', utility: '' },
        ],
      },
      {
        name: 'Connector', notes: 'Member picks up the dropped flash.',
        board: {
          markers: [player('pl2', lead, 0.58, 0.58), player('pm2', member, 0.66, 0.66), util('h-con', 'he', member, 0.52, 0.40, 1)],
          routes: [{ id: 'rm2', level: 'main', user_id: member, color: '#88cef5', points: [{ x: 0.66, y: 0.66 }, { x: 0.60, y: 0.62 }] }],
          holds: [],
          actions: [{ id: 'pick-flash', type: 'pickup', user_id: member, drop_id: 'drop-flash', x: 0.60, y: 0.62, level: 'main', seq: 0 }],
        },
        assignments: [{ user_id: member, instruction: 'Grab the flash, HE connector.', utility: '' }],
      },
      {
        name: 'Execute', notes: '',
        board: {
          markers: [player('pl3', lead, 0.58, 0.58), player('pm3', member, 0.60, 0.62), util('f-exec', 'flash', member, 0.52, 0.35, 0)],
          routes: [], holds: [], actions: [],
        },
        assignments: [],
      },
    ],
  };
}

function ctDoc(lead, member) {
  return {
    tactic_name: 'Phase 14 CT hold', map: 'de_mirage', side: 'CT', economy: 'Fullbuy', grenade: 0, molly: 0, flash: 0, smoke: 0,
    loadouts: [
      { user_id: lead, slot: null, smoke: 1, flash: 1, molly: 1, he: 0, decoy: 1, kit: true },
      { user_id: member, slot: null, smoke: 0, flash: 2, molly: 0, he: 1, decoy: 0, kit: true },
    ],
    phases: [{
      name: 'Hold', notes: '',
      board: { markers: [player('c1', lead, 0.40, 0.30), player('c2', member, 0.30, 0.40), util('ci', 'molly', lead, 0.45, 0.45, 0)], routes: [], holds: [], actions: [] },
      assignments: [{ user_id: lead, instruction: 'Incendiary the ramp.', utility: '' }],
    }],
  };
}

async function account(info) {
  const existing = await db('users').where('email', info.email).first();
  return existing || users.createUser({ ...info, password: PASSWORD });
}

async function main() {
  if (config.isProduction) throw new Error('Local development only.');
  const lead = await account(LEAD);
  const member = await account(MEMBER);
  let team = await db('teams').where('team_name', 'Phase 14 Test').first();
  if (!team) team = await teams.createTeam(lead.user_id, { team_name: 'Phase 14 Test' });
  if (!(await db('team_memberships').where({ team_id: team.team_id, user_id: member.user_id }).first())) {
    await db('team_memberships').insert({ team_id: team.team_id, user_id: member.user_id, player_role: 'support', is_igl: false });
    await db('users').where('user_id', member.user_id).update({ team_id: team.team_id });
  }
  for (const doc of [tDoc(lead.user_id, member.user_id), ctDoc(lead.user_id, member.user_id)]) {
    if (await db('tactics').where({ team_id: team.team_id, tactic_name: doc.tactic_name }).first()) continue;
    await tactics.createDocument(team.team_id, lead.user_id, v.tacticDocument.parse(doc));
  }
  const list = await db('tactics').where('team_id', team.team_id).select('tactic_id', 'tactic_name');
  console.log(JSON.stringify({ team_id: team.team_id, lead: lead.user_id, member: member.user_id, tactics: list }));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
