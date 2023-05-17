const ENV = process.env.NODE_ENV || 'development';
const config = ENV === 'production'
  ? { client: 'postgresql', connection: process.env.DATABASE_URL }
  : require('../knexfile');

module.exports = require('knex')(config);