const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { csrfSync } = require('csrf-sync');
const { rateLimit } = require('express-rate-limit');
const config = require('../config/env');

const SESSION_COOKIE = 'cst.sid';

function sessionMiddleware() {
  return session({
    name: SESSION_COOKIE,
    store: new PgSession({
      conString: config.databaseUrl(),
      tableName: 'user_sessions',
      createTableIfMissing: false,
      pruneSessionInterval: config.isTest ? false : 15 * 60,
    }),
    secret: config.sessionSecret(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: config.trustProxy > 0,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      maxAge: 1000 * 60 * 60 * 24 * 14,
    },
  });
}

// Synchroniser-token CSRF protection for cookie-authenticated mutations.
// Clients fetch a token (GET /api/auth/csrf or /api/auth/me) and send it in
// the X-CSRF-Token header. GET/HEAD/OPTIONS are not checked.
const csrf = csrfSync({
  getTokenFromRequest: (req) => req.headers['x-csrf-token'],
});

const json429 = (message) => (req, res) =>
  res.status(429).json({ message, code: 'rate_limited' });

function authLimiter(limit) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: json429('Too many sign-in attempts. Please wait a few minutes and try again.'),
  });
}

function apiLimiter(limit) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: json429('Too many requests. Please slow down.'),
  });
}

module.exports = { sessionMiddleware, csrf, authLimiter, apiLimiter, SESSION_COOKIE };
