// Development only: adds the demo accounts to an existing database without
// resetting it. Safe to run repeatedly.
//
//   npm run db:demo                          # 10 teamless demo players + 30 shared tactics
//   npm run db:demo -- --team "Test Team 1"  # ...and 4 teammates for that team
const bcrypt = require('bcryptjs');
const { NODE_ENV } = require('../config/env');

if (NODE_ENV === 'production') {
  console.error('db:demo refuses to run with NODE_ENV=production');
  process.exit(1);
}

const db = require('../db/connection');
const { SEED_PASSWORD } = require('../db/seeds');
const { ensureTeamlessPlayers, ensureTeammates } = require('../db/lib/demo');
const { ensureSharedTactics } = require('../db/lib/sharedTactics');

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

(async () => {
  const [{ name }] = (await db.raw('SELECT current_database() AS name')).rows;
  console.log(`database "${name}" (${NODE_ENV})`);
  const hash = await bcrypt.hash(SEED_PASSWORD, 10);
  await db.transaction(async (trx) => {
    await ensureTeamlessPlayers(trx, hash, (m) => console.log(`  ${m}`));
    await ensureSharedTactics(trx, hash, (m) => console.log(`  ${m}`));
    const teamName = arg('--team');
    if (teamName) {
      const teams = await trx('teams').where('team_name', teamName).select('team_id');
      if (teams.length !== 1) throw new Error(`Expected exactly one team named "${teamName}", found ${teams.length}`);
      console.log(`team "${teamName}" (${teams[0].team_id}):`);
      await ensureTeammates(trx, teams[0].team_id, hash, (m) => console.log(`  ${m}`));
    }
  });
  console.log(`Demo accounts use the password in db/seeds/index.js (SEED_PASSWORD).`);
})()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
