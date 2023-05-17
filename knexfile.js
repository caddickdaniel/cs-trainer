module.exports = {
  development: {
    client: 'pg',
    connection: {
      host: 'localhost',
      user: 'danny',
      password: 'password',
      database: 'cs_trainer',
    },
    migrations: {
      directory: './db/migrations',
    },
    seeds: {
      directory: './db/seeds',
    },
  },
};
