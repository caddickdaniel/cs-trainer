// Safety checks for destructive database operations.
const { NODE_ENV } = require('../config/env');

async function currentDatabase(db) {
  const { rows } = await db.raw('SELECT current_database() AS name');
  return rows[0].name;
}

// Tests may only reset a database whose name ends in "_test".
async function assertTestDatabase(db) {
  const name = await currentDatabase(db);
  if (NODE_ENV !== 'test' || !name.endsWith('_test')) {
    throw new Error(
      `Refusing to reset database "${name}" (NODE_ENV=${NODE_ENV}). ` +
        'Tests only run against a database whose name ends in "_test".'
    );
  }
  return name;
}

// db:reset is allowed for development and test databases only.
async function assertSafeToReset(db) {
  if (NODE_ENV === 'production') throw new Error('Refusing to reset in production');
  const name = await currentDatabase(db);
  if (NODE_ENV === 'test') return assertTestDatabase(db);
  return name;
}

module.exports = { assertTestDatabase, assertSafeToReset, currentDatabase };
