// Player Stats: aggregates of matches attributed to a player's verified
// SteamID64, per source (uploaded demos, FACEIT). Sources are never summed
// together, because a match imported from both can't always be matched
// confidently; each source shows its own sample size and update time.
//
// Metrics (see README "Player Stats"):
//   matches   matches the player appears in
//   win rate  wins / (wins + losses); draws excluded; null with no decided matches
//   K/D       kills / deaths; with zero deaths it equals kills (flagged)
//   ADR       damage / rounds played, over matches that report damage
//   HS%       headshot kills / kills, over matches that report headshots
// Payloads contain no demo ids, replay links, team names or annotations.
const db = require('../db/connection');
const { badRequest, notFound } = require('../errors');
const { canViewProfile } = require('./profiles');

const SOURCES = [
  { id: 'demo', label: 'Uploaded demos' },
  { id: 'faceit', label: 'FACEIT' },
];
const RECENT = 10;

async function steamIdOf(userId) {
  const row = await db('user_identities').where({ user_id: userId, provider: 'steam' }).first('subject');
  return row ? row.subject : null;
}

async function statsSettings(userId) {
  const { settings } = await db('users').where('user_id', userId).first('settings');
  const s = (settings || {}).stats || {};
  return { track: Boolean(s.track), visibility: s.visibility === 'profile' ? 'profile' : 'private' };
}

async function updateStatsSettings(userId, { track, visibility }) {
  if (track && !(await steamIdOf(userId))) throw badRequest('Link Steam first: stats are matched by your verified Steam ID', 'steam_required');
  const { settings } = await db('users').where('user_id', userId).first('settings');
  const current = (settings || {}).stats || {};
  const next = { ...(settings || {}), stats: { ...current, ...(track !== undefined ? { track } : {}), ...(visibility ? { visibility } : {}) } };
  await db('users').where('user_id', userId).update({ settings: JSON.stringify(next) });
  return statsSettings(userId);
}

const num = (v) => (v == null ? null : Number(v));
const ratio = (a, b) => (a == null || b == null || b === 0 ? null : a / b);

async function sourceSummary(steamid, source) {
  const base = () => db('match_players as mp').join('matches as m', 'm.match_id', 'mp.match_id')
    .where({ 'mp.steamid64': steamid, 'm.source': source });
  const agg = await base().first(
    db.raw('count(*)::int as matches'),
    db.raw("count(*) filter (where mp.result = 'W')::int as wins"),
    db.raw("count(*) filter (where mp.result = 'L')::int as losses"),
    db.raw("count(*) filter (where mp.result = 'D')::int as draws"),
    db.raw('sum(mp.kills)::int as kills'),
    db.raw('sum(mp.deaths)::int as deaths'),
    db.raw('sum(mp.assists)::int as assists'),
    db.raw('sum(mp.headshot_kills) filter (where mp.headshot_kills is not null)::int as hs_kills'),
    db.raw('sum(mp.kills) filter (where mp.headshot_kills is not null)::int as hs_sample_kills'),
    db.raw('sum(mp.damage) filter (where mp.damage is not null and mp.rounds_played > 0)::int as damage'),
    db.raw('sum(mp.rounds_played) filter (where mp.damage is not null and mp.rounds_played > 0)::int as damage_rounds'),
    db.raw('count(*) filter (where mp.damage is not null and mp.rounds_played > 0)::int as damage_matches'),
    db.raw('max(m.updated_at) as last_updated'),
  );
  if (!agg.matches) return null;
  const recent = await base().orderByRaw('m.played_at desc nulls last, m.match_id desc').limit(RECENT)
    .select('m.map', 'm.played_at', 'm.rounds', 'm.score_a', 'm.score_b', 'mp.team', 'mp.result', 'mp.kills', 'mp.deaths', 'mp.assists');
  const kills = num(agg.kills);
  const deaths = num(agg.deaths);
  return {
    source,
    matches: agg.matches,
    wins: agg.wins,
    losses: agg.losses,
    draws: agg.draws,
    win_rate: ratio(agg.wins, agg.wins + agg.losses),
    kills,
    deaths,
    assists: num(agg.assists),
    kd: kills == null || deaths == null ? null : deaths === 0 ? kills : kills / deaths,
    kd_no_deaths: deaths === 0,
    adr: ratio(num(agg.damage), num(agg.damage_rounds)),
    adr_matches: agg.damage_matches,
    hs_pct: ratio(num(agg.hs_kills), num(agg.hs_sample_kills)),
    last_updated: agg.last_updated,
    recent: recent.map((r) => {
      const own = r.team === 'B' ? r.score_b : r.score_a;
      const opp = r.team === 'B' ? r.score_a : r.score_b;
      return {
        map: r.map, played_at: r.played_at, result: r.result, kills: r.kills, deaths: r.deaths, assists: r.assists,
        score: own != null && opp != null ? `${own}–${opp}` : null,
      };
    }),
  };
}

async function providerRatings(userId) {
  const rows = await db('provider_accounts').where('user_id', userId)
    .select('provider', 'nickname', 'rating', 'level', 'status', 'last_error', 'last_synced_at');
  return rows.map((r) => ({
    provider: r.provider, nickname: r.nickname, rating: r.rating, level: r.level, status: r.status,
    error: r.status === 'ok' ? null : r.last_error, last_synced_at: r.last_synced_at,
  }));
}

async function buildStats(userId) {
  const steamid = await steamIdOf(userId);
  const settings = await statsSettings(userId);
  const sources = [];
  if (steamid && settings.track) {
    for (const s of SOURCES) {
      const summary = await sourceSummary(steamid, s.id);
      if (summary) sources.push({ ...summary, label: s.label });
    }
  }
  return {
    steam_linked: Boolean(steamid),
    tracking: settings.track,
    visibility: settings.visibility,
    sources,
    providers: settings.track ? await providerRatings(userId) : [],
  };
}

// The player's own (private) view.
const myStats = (userId) => buildStats(userId);

// Another player's profile: aggregates only, and only when they opted in.
async function profileStats(viewerId, targetId) {
  if (!(await canViewProfile(viewerId, targetId))) throw notFound('Player not found');
  if (viewerId === targetId) return { ...(await buildStats(targetId)), shared: true };
  const settings = await statsSettings(targetId);
  if (!settings.track || settings.visibility !== 'profile') return { shared: false };
  const { sources, providers } = await buildStats(targetId);
  return { shared: true, sources, providers: providers.map(({ error, status, ...p }) => p) };
}

module.exports = { SOURCES, myStats, profileStats, statsSettings, updateStatsSettings, steamIdOf, sourceSummary };
