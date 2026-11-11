const knex = require('knex');
const { NODE_ENV } = require('../config/env');
const config = require('../knexfile')[NODE_ENV];

if (!config) throw new Error(`No database configuration for NODE_ENV=${NODE_ENV}`);

module.exports = knex(config);
