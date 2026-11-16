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
  // Demo Review: where uploaded .dem files are kept, and processing limits.
  demoStorageDir: path.resolve(process.env.DEMO_STORAGE_DIR
    || path.join(__dirname, '..', 'storage', NODE_ENV === 'test' ? 'demos-test' : 'demos')),
  demoMaxBytes: (Number(process.env.DEMO_MAX_MB) || 600) * 1024 * 1024,
  demoParseTimeoutMs: (Number(process.env.DEMO_PARSE_TIMEOUT_S) || 300) * 1000,
  demoDemosPerTeam: Number(process.env.DEMO_LIMIT_PER_TEAM) || 50,
  // The background demo worker runs in the web process unless disabled.
  demoWorker: process.env.DEMO_WORKER ? process.env.DEMO_WORKER !== 'off' : NODE_ENV !== 'test',
  // Replay Inspector capture: drives a local CS2 client (tools/cs2-capture)
  // to record real first-person frames. Opt-in (CAPTURE_WORKER=on) because it
  // types into the CS2 window on this machine's desktop.
  captureWorker: process.env.CAPTURE_WORKER === 'on' && NODE_ENV !== 'test',
  // CS2 window size for capture sessions ("1280x720" default: media is
  // saved at 1280x720; at 1920x1080 grabs fall behind at full speed), demo
  // speed while recording clips (1 = real time; no frame lag measured at
  // 720p), and how far a forward seek may go with one command (0 = always
  // overshoot and come back: forward skips left stale views in benchmarks).
  captureSize: (process.env.CAPTURE_SIZE || '1280x720').split('x').map(Number),
  captureTimescale: Number(process.env.CAPTURE_TIMESCALE) || 1,
  // Video profile while capturing: 'native' keeps the player's own quality
  // settings (only the window size changes); 'capture' lowers shadows etc.
  // Benchmarks showed no speed gain from lower settings (seeking is CPU-bound).
  captureProfile: process.env.CAPTURE_PROFILE || 'native',
  captureShortForward: process.env.CAPTURE_SHORT_FORWARD != null ? Number(process.env.CAPTURE_SHORT_FORWARD) : 0,
  captureStorageDir: path.resolve(process.env.CAPTURE_STORAGE_DIR
    || path.join(__dirname, '..', 'storage', NODE_ENV === 'test' ? 'captures-test' : 'captures')),
  // Public origin of the app (scheme://host[:port]) used for Steam sign-in
  // return URLs. Required in production; development derives it from localhost hosts.
  appOrigin: process.env.APP_ORIGIN ? process.env.APP_ORIGIN.replace(/\/$/, '') : null,
  steamOpenIdEndpoint: process.env.STEAM_OPENID_ENDPOINT || 'https://steamcommunity.com/openid/login',
  // Optional: prefill display name and avatar from Steam (GetPlayerSummaries).
  steamWebApiKey: process.env.STEAM_WEB_API_KEY || null,
  steamApiBase: process.env.STEAM_API_BASE || 'https://api.steampowered.com',
  // Optional: FACEIT Data API (server-side key).
  faceitApiKey: process.env.FACEIT_API_KEY || null,
  faceitApiBase: process.env.FACEIT_API_BASE || 'https://open.faceit.com/data/v4',
  // Optional: match share code import through a Game Coordinator bridge
  // (see services/replayProvider.js). Without it share codes are rejected
  // with a clear message.
  matchReplayProviderUrl: process.env.MATCH_REPLAY_PROVIDER_URL || null,
  matchReplayProviderToken: process.env.MATCH_REPLAY_PROVIDER_TOKEN || null,
  // Hosts replays may be downloaded from (comma-separated, * wildcards).
  matchReplayHosts: (process.env.MATCH_REPLAY_HOSTS || 'replay*.valve.net')
    .split(',').map((h) => h.trim()).filter(Boolean)
    .map((h) => new RegExp(`^${h.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]*')}$`, 'i')),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || (NODE_ENV === 'test' ? 4 : 12),
};
