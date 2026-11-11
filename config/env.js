// Loads `.env` (if present) and exposes validated runtime configuration.
// Uses Node's built-in loader (Node >= 20.12) instead of an extra dependency.
const path = require('path');

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const NODE_ENV = process.env.NODE_ENV || 'development';

const DEFAULT_URLS = {
  development: 'postgres://localhost:5432/cs_trainer',
  test: 'postgres://localhost:5432/cs_trainer_test',
};

function databaseUrl(env = NODE_ENV) {
  if (env === 'test') return process.env.TEST_DATABASE_URL || DEFAULT_URLS.test;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (env === 'production') {
    throw new Error('DATABASE_URL must be set when NODE_ENV=production');
  }
  return DEFAULT_URLS.development;
}

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET (32+ characters) must be set when NODE_ENV=production');
  }
  return `insecure-${NODE_ENV}-session-secret-change-me-0000`;
}

module.exports = {
  NODE_ENV,
  isProduction: NODE_ENV === 'production',
  isTest: NODE_ENV === 'test',
  databaseUrl,
  sessionSecret,
  port: Number(process.env.PORT) || 9090,
  // Number of reverse proxies in front of the app (sets Express `trust proxy`).
  trustProxy: Number(process.env.TRUST_PROXY) || 0,
  // Force the `Secure` cookie flag on/off. Defaults to on in production.
  cookieSecure: process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : NODE_ENV === 'production',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || (NODE_ENV === 'test' ? 4 : 12),
};
