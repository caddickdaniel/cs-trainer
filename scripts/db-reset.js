// Rebuilds the development database: rolls back every migration, migrates to
// latest and runs the deterministic seeds. Refuses to touch production.
const { NODE_ENV } = require('../config/env');

if (NODE_ENV === 'production') {
  console.error('db:reset refuses to run with NODE_ENV=production');
  process.exit(1);
}

const db = require('../db/connection');
const { assertSafeToReset } = require('../db/guard');

(async () => {
  await assertSafeToReset(db);
  await db.migrate.rollback(undefined, true);
  await db.migrate.latest();
  await db.seed.run();
  const [{ current_database: name }] = (await db.raw('SELECT current_database()')).rows;
  console.log(`reset and seeded "${name}" (${NODE_ENV})`);
})()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
