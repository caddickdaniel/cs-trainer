// Runs the production build on this machine over plain HTTP (no reverse proxy),
// for example on a Windows PC: one origin serves client/dist and the API.
// Works the same on every OS, so no shell-specific `NODE_ENV=... npm start`.
//
//   npm run serve          # builds the client, migrates, then serves on :9090
//
// Not for a public deployment: cookies are sent without the Secure flag so they
// work on http://localhost. Behind HTTPS use `npm start` with NODE_ENV=production.
const fs = require('fs');
const path = require('path');

const port = process.env.PORT || '9090';
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.COOKIE_SECURE = process.env.COOKIE_SECURE || 'false';
process.env.APP_ORIGIN = process.env.APP_ORIGIN || `http://localhost:${port}`;
process.env.PORT = port;

if (!fs.existsSync(path.join(__dirname, '..', 'client', 'dist', 'index.html'))) {
  console.error('client/dist is missing: run `npm run build` first (or use `npm run serve`).');
  process.exit(1);
}

const db = require('../db/connection');

db.migrate.latest()
  .then(([batch, applied]) => {
    console.log(applied.length ? `migrations: batch ${batch}, ${applied.length} applied` : 'migrations: up to date');
    require('../listen');
    console.log(`CS Trainer: ${process.env.APP_ORIGIN}`);
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
