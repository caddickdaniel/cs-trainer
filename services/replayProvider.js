// Replay retrieval for match share codes.
//
// Valve only hands out a match's replay URL to a logged-in CS2 game client
// through the Game Coordinator (MatchListRequestFullGameInfo); the Steam Web
// API cannot. CS-Trainer therefore talks to a separately run "replay
// provider" (a Game Coordinator bridge with a bot account) over HTTP:
//
//   GET {MATCH_REPLAY_PROVIDER_URL}/matches/{match_id}?outcome_id=..&token=..
//   Authorization: Bearer {MATCH_REPLAY_PROVIDER_TOKEN}
//   200 { "replay_url": "http://replay123.valve.net/730/..._123.dem.bz2" }
//   404 the replay is unknown or has expired
//
// The returned URL must be on an allowed replay host (Valve's replay servers
// by default) before anything is downloaded.
const config = require('../config/env');

class ReplayError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const configured = () => Boolean(config.matchReplayProviderUrl);

function assertConfigured() {
  if (!configured()) {
    throw new ReplayError('replay_provider_missing',
      "Share code import isn't set up on this server: it needs a replay provider (MATCH_REPLAY_PROVIDER_URL). Download the demo from CS2 and upload the .dem file instead.", 503);
  }
}

function allowedReplayUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  return config.matchReplayHosts.some((pattern) => pattern.test(url.hostname));
}

// Asks the provider where the replay is. Resolves with the replay URL.
async function locateReplay({ match_id: matchId, outcome_id: outcomeId, token }) {
  assertConfigured();
  const url = `${config.matchReplayProviderUrl.replace(/\/$/, '')}/matches/${encodeURIComponent(matchId)}`
    + `?outcome_id=${encodeURIComponent(outcomeId)}&token=${encodeURIComponent(token)}`;
  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json', ...(config.matchReplayProviderToken ? { Authorization: `Bearer ${config.matchReplayProviderToken}` } : {}) },
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new ReplayError('replay_provider_unreachable', `The replay provider could not be reached (${err.message}).`);
  }
  if (res.status === 404 || res.status === 410) {
    throw new ReplayError('replay_unavailable', 'Valve no longer has a replay for this match (replays expire after a few weeks), or the share code is for a match that was never recorded.', 404);
  }
  if (!res.ok) throw new ReplayError('replay_provider_error', `The replay provider returned an error (HTTP ${res.status}).`);
  const body = await res.json().catch(() => ({}));
  if (!body.replay_url) throw new ReplayError('replay_unavailable', 'The replay provider had no replay for this match.', 404);
  if (!allowedReplayUrl(body.replay_url)) {
    throw new ReplayError('replay_provider_error', 'The replay provider returned a download address that is not a Valve replay server.');
  }
  return body.replay_url;
}

module.exports = { locateReplay, assertConfigured, configured, allowedReplayUrl, ReplayError };
