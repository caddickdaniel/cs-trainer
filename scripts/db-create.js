// Creates the local development and/or test databases if they do not exist.
// Never drops anything. Usage: node scripts/db-create.js [--test]
const { Client } = require('pg');
const { databaseUrl } = require('../config/env');

async function ensureDatabase(url) {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (!/^[a-z0-9_]+$/i.test(name)) throw new Error(`Refusing unusual database name "${name}"`);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rowCount) {
      console.log(`database "${name}" already exists`);
    } else {
      await client.query(`CREATE DATABASE "${name}"`);
      console.log(`created database "${name}"`);
    }
  } finally {
    await client.end();
  }
}

(async () => {
  const onlyTest = process.argv.includes('--test');
  const urls = onlyTest ? [databaseUrl('test')] : [databaseUrl('development'), databaseUrl('test')];
  for (const url of urls) await ensureDatabase(url);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
