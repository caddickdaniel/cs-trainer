// Development-only records layered on top of the legacy sample data so the
// milestone journey can be demonstrated straight after `npm run setup`.
module.exports = {
  // A signed-up user who has not joined a team yet.
  users: [{ user_name: 'User M', email: 'user-m@cs-trainer.test', language: 'English', region: 'EU' }],
  // A tactic built with the new phase model for Team A (team_id 1).
  tactics: [
    {
      tactic_name: 'A Split (demo)', economy: 'Fullbuy', grenade: 1, molly: 2, flash: 4, smoke: 3,
      team_id: 1, T: true, CT: false, side: 'T', map: 'practice_yard',
      phases: [
        {
          name: 'Early round', notes: 'Default spread, take map control quietly.',
          board: {
            markers: [
              { id: 'm1', kind: 'player', x: 0.5, y: 0.86, user_id: 1, label: 'A' },
              { id: 'm2', kind: 'player', x: 0.44, y: 0.84, user_id: 2, label: 'B' },
            ],
            routes: [{ id: 'r1', user_id: 1, color: '#f5a524', points: [{ x: 0.5, y: 0.86 }, { x: 0.5, y: 0.62 }, { x: 0.62, y: 0.5 }] }],
          },
          assignments: [
            { user_id: 1, instruction: 'Walk mid, hold the connector for info.', utility: 'Keep smoke for Connector.' },
            { user_id: 2, instruction: 'Lurk B halls, call rotations.', utility: 'Flash for yourself if pushed.' },
          ],
        },
        {
          name: 'Execute A', notes: 'Smokes land, then go on the flash.',
          board: {
            markers: [
              { id: 'm3', kind: 'smoke', x: 0.72, y: 0.28, user_id: 1, label: 'CT smoke' },
              { id: 'm4', kind: 'flash', x: 0.66, y: 0.3, user_id: 2, label: '' },
            ],
            routes: [{ id: 'r2', user_id: 2, color: '#4cc38a', points: [{ x: 0.3, y: 0.55 }, { x: 0.5, y: 0.4 }, { x: 0.7, y: 0.3 }] }],
          },
          assignments: [
            { user_id: 1, instruction: 'Smoke CT cross, entry through main.', utility: 'Smoke CT, flash over the wall.' },
            { user_id: 2, instruction: 'Rotate through mid and trade the entry.', utility: 'Pop flash for the entry.' },
          ],
        },
        {
          name: 'Post-plant', notes: 'Default plant, crossfire.',
          board: { markers: [{ id: 'm5', kind: 'molly', x: 0.74, y: 0.22, user_id: null, label: 'Defuse molly' }], routes: [] },
          assignments: [{ user_id: 1, instruction: 'Hold from site box. Molly the defuse.', utility: 'Molly on the stick.' }],
        },
      ],
    },
  ],
};
