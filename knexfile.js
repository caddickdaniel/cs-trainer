const ENV = process.env.NODE_ENV || 'development';
const dbConfig = {
  client: 'pg',
  migrations: {
    directory: './db/migrations',
  },
  seeds: {
    directory: './db/seeds',
  },
};
const customConfigs = {
  development: { connection: { database: 'cs_trainer_test', user: 'danny', password: 'password', } },
  test: { connection: { database: 'cs_trainer_test', user: 'danny', password: 'password', } },
  production: { connection: { database: 'cs_trainer', user: 'danny', password: 'password', } }
};
module.exports = { ...dbConfig, ...customConfigs[ENV] };
