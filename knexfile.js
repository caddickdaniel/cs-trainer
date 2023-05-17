`module.exports = {
  development: {
    client: 'pg',
    connection: {
      host: 'localhost',
      user: 'danny',
      password: 'password',
      database: 'cs_trainer_test',
    },
    migrations: {
      directory: './db/migrations',
    },
    seeds: {
      directory: './db/seeds',
    },
  },
};`

module.exports = {
  development: {
    client: 'postgresql',
    connection: {
      host: 'localhost',
      user: 'danny',
      password: 'password',
      database: 'cs_trainer_test',
    },
    migrations: {
      directory: './db/migrations',
    },
    seeds: {
      directory: './db/seeds',
    },
  },
  production: {
    client: 'postgresql',
    connection: process.env.DATABASE_URL,
    migrations: {
      directory: './db/migrations',
    },
    seeds: {
      directory: './db/seeds',
    },
  },
};