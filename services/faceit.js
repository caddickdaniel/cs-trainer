// FACEIT source for Player Stats, using the official FACEIT Data API v4 with
// a server-side key (FACEIT_API_KEY). The FACEIT account is resolved from the
// player's verified SteamID64 (game_player_id), so nobody can attach someone
// else's FACEIT stats by typing a nickname.
//
// Stored per match under source 'faceit' with the FACEIT match id as the
// stable key, so re-syncing never duplicates. Rate limits (429) and errors
// are recorded on the connection and shown to the player.
const db = require('../db/connection');
const config = require('../config/env');
const { conflict, httpError, notFound } = require('../errors');

const MIN_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const MATCH_LIMIT = 30;

class FaceitError extends Error {
  constructor(status, code, message, retryAfter) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

async function call(path) {
  if (!config.faceitApiKey) {
    throw new FaceitError(503, 'faceit_unavailable', 'FACEIT stats are not configured on this server (FACEIT_API_KEY is not set).');
  }
  let res;
  try {
    res = await fetch(`${config.faceitApiBase}${path}`, {
      headers: { Authorization: `Bearer ${config.faceitApiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    throw new FaceitError(502, 'faceit_unreachable', `FACEIT could not be reached (${err.message}).`);
  }
  if (res.status === 429) {
    const retry = Number(res.headers.get('retry-after')) || 60;
    throw new FaceitError(429, 'faceit_rate_limited', `FACEIT is rate limiting requests. Try again in ${retry} seconds.`, retry);
  }
  if (res.status === 404) throw new FaceitError(404, 'faceit_not_found', 'FACEIT has no CS2 player for this Steam account.');
  if (res.status === 401 || res.status === 403) throw new FaceitError(502, 'faceit_rejected', 'FACEIT rejected the server\'s API key.');
  if (!res.ok) throw new FaceitError(502, 'faceit_error', `FACEIT returned an error (HTTP ${res.status}).`);
  return res.json();
}

const toInt = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : null;
};

// One item of /players/{id}/games/cs2/stats. Field names follow FACEIT's
// stats labels; anything missing stays null rather than guessed.
function mapMatchStats(item) {
  const s = item.stats || item;
  const matchId = s['Match Id'] || s.match_id;
  if (!matchId) return null;
  const rounds = toInt(s.Rounds);
  const adr = Number(s.ADR);
  const finished = toInt(s['Match Finished At'] ?? s['Updated At'] ?? s['Created At']);
  const [a, b] = String(s.Score || s['Final Score'] || '').split('/').map((x) => toInt(x.trim()));
  const result = s.Result === '1' || s.Result === 1 ? 'W' : s.Result === '0' || s.Result === 0 ? 'L' : null;
  return {
    match_id: String(matchId),
    map: s.Map || null,
    played_at: finished ? new Date(finished > 1e12 ? finished : finished * 1000) : null,
    rounds,
    score: Number.isInteger(a) && Number.isInteger(b) ? [a, b] : null,
    result,
    kills: toInt(s.Kills),
    deaths: toInt(s.Deaths),
    assists: toInt(s.Assists),
    headshot_kills: toInt(s.Headshots),
    damage: Number.isFinite(adr) && rounds ? Math.round(adr * rounds) : null,
  };
}

async function steamIdOf(userId) {
  const row = await db('user_identities').where({ user_id: userId, provider: 'steam' }).first('subject');
  return row ? row.subject : null;
}

async function saveMatches(trx, steamid, matches) {
  for (const m of matches) {
    // FACEIT's score string isn't ordered by team; the winner has the higher score.
    const own = m.score ? (m.result === 'L' ? Math.min(...m.score) : Math.max(...m.score)) : null;
    const opp = m.score ? (m.result === 'L' ? Math.max(...m.score) : Math.min(...m.score)) : null;
    const [row] = await trx('matches')
      .insert({ source: 'faceit', source_key: m.match_id, map: m.map, played_at: m.played_at, rounds: m.rounds || 0, score_a: own, score_b: opp, faceit_match_id: m.match_id })
      .onConflict(['source', 'source_key'])
      .merge({ map: m.map, played_at: m.played_at, rounds: m.rounds || 0, updated_at: trx.fn.now() })
      .returning('match_id');
    await trx('match_players')
      .insert({
        match_id: row.match_id, steamid64: steamid, team: 'A', result: m.result,
        kills: m.kills, deaths: m.deaths, assists: m.assists, headshot_kills: m.headshot_kills, damage: m.damage, rounds_played: m.rounds,
      })
      .onConflict(['match_id', 'steamid64'])
      .merge();
  }
}

async function sync(userId, { force = false } = {}) {
  const account = await db('provider_accounts').where({ user_id: userId, provider: 'faceit' }).first();
  if (!account) throw notFound('FACEIT is not connected');
  if (!force && account.next_sync_at && new Date(account.next_sync_at) > new Date()) return status(userId);
  const steamid = await steamIdOf(userId);
  try {
    const player = await call(`/players/${encodeURIComponent(account.external_id)}`);
    const cs2 = (player.games || {}).cs2 || {};
    const stats = await call(`/players/${encodeURIComponent(account.external_id)}/games/cs2/stats?offset=0&limit=${MATCH_LIMIT}`);
    const matches = (stats.items || []).map(mapMatchStats).filter(Boolean);
    await db.transaction(async (trx) => {
      await saveMatches(trx, steamid, matches);
      await trx('provider_accounts').where('provider_account_id', account.provider_account_id).update({
        nickname: player.nickname || account.nickname,
        rating: toInt(cs2.faceit_elo),
        level: toInt(cs2.skill_level),
        status: 'ok',
        last_error: null,
        last_synced_at: trx.fn.now(),
        next_sync_at: new Date(Date.now() + MIN_SYNC_INTERVAL_MS),
      });
    });
  } catch (err) {
    if (!(err instanceof FaceitError)) throw err;
    await db('provider_accounts').where('provider_account_id', account.provider_account_id).update({
      status: err.status === 429 ? 'rate_limited' : 'error',
      last_error: err.message,
      next_sync_at: new Date(Date.now() + (err.retryAfter ? err.retryAfter * 1000 : MIN_SYNC_INTERVAL_MS)),
    });
  }
  return status(userId);
}

async function status(userId) {
  const a = await db('provider_accounts').where({ user_id: userId, provider: 'faceit' }).first();
  return {
    configured: Boolean(config.faceitApiKey),
    connection: a ? {
      nickname: a.nickname, rating: a.rating, level: a.level, status: a.status, error: a.last_error,
      last_synced_at: a.last_synced_at, next_sync_at: a.next_sync_at,
    } : null,
  };
}

// Resolves the FACEIT player from the verified SteamID64 and syncs.
async function connect(userId) {
  const steamid = await steamIdOf(userId);
  if (!steamid) throw httpError(400, 'Link Steam first: FACEIT is matched to your verified Steam account', 'steam_required');
  let player;
  try {
    player = await call(`/players?game=cs2&game_player_id=${steamid}`);
  } catch (err) {
    if (err instanceof FaceitError) throw httpError(err.status, err.message, err.code);
    throw err;
  }
  const verified = (((player.games || {}).cs2 || {}).game_player_id || player.steam_id_64 || '') === steamid;
  if (!player.player_id || !verified) throw httpError(404, 'FACEIT has no CS2 player for this Steam account.', 'faceit_not_found');
  const taken = await db('provider_accounts').where({ provider: 'faceit', external_id: player.player_id }).whereNot('user_id', userId).first('user_id');
  if (taken) throw conflict('That FACEIT account is connected to another CS-Trainer account.', 'faceit_taken');
  await db('provider_accounts')
    .insert({ user_id: userId, provider: 'faceit', external_id: player.player_id, nickname: player.nickname || null })
    .onConflict(['user_id', 'provider'])
    .merge({ external_id: player.player_id, nickname: player.nickname || null, status: 'pending', next_sync_at: null });
  return sync(userId, { force: true });
}

// Removes the connection and the FACEIT matches imported for this player.
async function disconnect(userId) {
  const steamid = await steamIdOf(userId);
  await db.transaction(async (trx) => {
    await trx('provider_accounts').where({ user_id: userId, provider: 'faceit' }).del();
    if (steamid) {
      await trx('match_players').where('steamid64', steamid)
        .whereIn('match_id', trx('matches').where('source', 'faceit').select('match_id')).del();
      await trx('matches').where('source', 'faceit')
        .whereNotExists(trx('match_players as mp').whereRaw('mp.match_id = matches.match_id')).del();
    }
  });
  return status(userId);
}

module.exports = { connect, sync, disconnect, status, mapMatchStats, FaceitError };
