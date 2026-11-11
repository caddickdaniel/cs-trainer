// Mocha root hooks. Refuses to run against anything but a *_test database.
process.env.NODE_ENV = 'test';

const connection = require('../db/connection');
const { assertTestDatabase } = require('../db/guard');

exports.mochaHooks = {
  async beforeAll() {
    await assertTestDatabase(connection);
    await connection.migrate.latest();
  },
  async afterAll() {
    await connection.destroy();
  },
};
