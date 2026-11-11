// Committed Knex configuration. Connection details come from the environment
// (see .env.example); nothing here points at a hosted service.
const { databaseUrl, NODE_ENV } = require('./config/env');

const base = {
  client: 'pg',
  migrations: { directory: './db/migrations' },
  seeds: { directory: './db/seeds' },
  pool: { min: 0, max: 10 },
};

module.exports = {
  development: { ...base, connection: databaseUrl('development') },
  test: { ...base, connection: databaseUrl('test') },
  production: {
    ...base,
    connection: NODE_ENV === 'production' ? databaseUrl('production') : undefined,
  },
};
