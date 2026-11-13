// Development only: adds or refreshes the demo data (db/data/demo.js) in an
// existing database without resetting it. Safe to run repeatedly; it never
// deletes anything or moves players who have joined other teams.
//
//   npm run db:demo   # recruits, Practice Roster, recruiting teams, 30 shared tactics
const bcrypt = require('bcryptjs');
const { NODE_ENV } = require('../config/env');

if (NODE_ENV === 'production') {
  console.error('db:demo refuses to run with NODE_ENV=production');
  process.exit(1);
}

const db = require('../db/connection');
const { SEED_PASSWORD } = require('../db/seeds');
const { ensureDemoData } = require('../db/lib/demo');
const { ensureSharedTactics } = require('../db/lib/sharedTactics');

(async () => {
  const [{ name }] = (await db.raw('SELECT current_database() AS name')).rows;
  console.log(`database "${name}" (${NODE_ENV})`);
  const hash = await bcrypt.hash(SEED_PASSWORD, 10);
  await db.transaction(async (trx) => {
    if (process.argv.includes('--team')) console.log('  note: --team is no longer supported; the test roster is the "Practice Roster" team.');
    await ensureDemoData(trx, hash, (m) => console.log(`  ${m}`));
    await ensureSharedTactics(trx, hash, (m) => console.log(`  ${m}`));
  });
  console.log(`Demo accounts use the password in db/seeds/index.js (SEED_PASSWORD).`);
})()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
