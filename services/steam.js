// Steam sign-in (OpenID 2.0, Steam's supported website sign-in flow) and
// account linking.
//
// Flow: /api/auth/steam/start stores a random state in the session and
// redirects to Steam. Steam redirects back to /api/auth/steam/callback with a
// signed assertion, which is checked here and then verified server-side with
// Steam (openid.mode=check_authentication). Only then is the SteamID64 trusted.
//
// The verified SteamID64 (user_identities.subject, unique) is what signs in
// and matches stats. The editable users.steam_url profile link is separate.
const crypto = require('crypto');
const db = require('../db/connection');
const config = require('../config/env');
const { badRequest, conflict, httpError, notFound } = require('../errors');

const NS = 'http://specs.openid.net/auth/2.0';
const IDENTIFIER_SELECT = `${NS}/identifier_select`;
const CLAIMED_ID = /^https:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/;
const NONCE_MAX_AGE_MS = 5 * 60 * 1000;
const PENDING_MAX_AGE_MS = 15 * 60 * 1000;

class SteamAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Browser-facing origin used for return_to/realm. Production must configure
// APP_ORIGIN; development may derive it from a localhost Host header.
function appOrigin(req) {
  if (config.appOrigin) return config.appOrigin;
  const host = req.get('host') || '';
  const hostname = host.split(':')[0];
  if (!config.isProduction && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost'))) {
    return `${req.protocol}://${host}`;
  }
  throw httpError(500, 'APP_ORIGIN must be configured for Steam sign-in', 'app_origin_missing');
}

const callbackUrl = (origin) => `${origin}/api/auth/steam/callback`;

// Step 1: the redirect to Steam. intent is 'signin' (also creates accounts)
// or 'link' (signed-in users only).
function startUrl(req, { intent, next }) {
  const origin = appOrigin(req);
  const state = crypto.randomBytes(24).toString('base64url');
  req.session.steamAuth = { state, intent, next: next || null, at: Date.now() };
  const params = new URLSearchParams({
    'openid.ns': NS,
    'openid.mode': 'checkid_setup',
    'openid.return_to': `${callbackUrl(origin)}?state=${state}`,
    'openid.realm': origin,
    'openid.identity': IDENTIFIER_SELECT,
    'openid.claimed_id': IDENTIFIER_SELECT,
  });
  return `${config.steamOpenIdEndpoint}?${params}`;
}

// Step 2: checks the assertion and verifies it with Steam. Returns the
// SteamID64 and the stored intent.
async function verifyCallback(req) {
  const pending = req.session.steamAuth;
  delete req.session.steamAuth;
  const q = req.query;
  if (!pending || !q.state || q.state !== pending.state || Date.now() - pending.at > PENDING_MAX_AGE_MS) {
    throw new SteamAuthError('state_mismatch', 'The Steam sign-in request expired or did not start here. Please try again.');
  }
  if (q['openid.mode'] === 'cancel') throw new SteamAuthError('cancelled', 'Steam sign-in was cancelled.');
  const origin = appOrigin(req);
  const expectedReturn = `${callbackUrl(origin)}?state=${pending.state}`;
  if (q['openid.ns'] !== NS || q['openid.mode'] !== 'id_res'
    || q['openid.op_endpoint'] !== config.steamOpenIdEndpoint
    || q['openid.return_to'] !== expectedReturn) {
    throw new SteamAuthError('invalid_response', 'Steam returned an unexpected response.');
  }
  const match = CLAIMED_ID.exec(q['openid.claimed_id'] || '');
  if (!match || q['openid.identity'] !== q['openid.claimed_id']) {
    throw new SteamAuthError('invalid_response', 'Steam did not return a valid Steam account.');
  }
  const signed = String(q['openid.signed'] || '').split(',');
  for (const field of ['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce', 'assoc_handle']) {
    if (!signed.includes(field)) throw new SteamAuthError('invalid_response', 'Steam returned an unsigned response.');
  }
  const nonce = String(q['openid.response_nonce'] || '');
  const nonceTime = Date.parse(nonce.slice(0, 20));
  if (!nonce || Number.isNaN(nonceTime) || Math.abs(Date.now() - nonceTime) > NONCE_MAX_AGE_MS) {
    throw new SteamAuthError('expired', 'The Steam response is too old. Please try again.');
  }

  // Server-side verification with Steam.
  const body = new URLSearchParams();
  for (const [k, value] of Object.entries(q)) if (k.startsWith('openid.')) body.set(k, String(value));
  body.set('openid.mode', 'check_authentication');
  let text;
  try {
    const res = await fetch(config.steamOpenIdEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/plain' },
      body,
      signal: AbortSignal.timeout(10000),
    });
    text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    throw new SteamAuthError('steam_unavailable', `Steam could not be reached to verify the sign-in (${err.message}).`);
  }
  if (!/(^|\n)is_valid:true(\n|$)/.test(text)) throw new SteamAuthError('not_verified', 'Steam did not confirm this sign-in.');

  // Each assertion is accepted once.
  try {
    await db('openid_nonces').insert({ nonce: nonce.slice(0, 120) });
  } catch (err) {
    if (err.code === '23505') throw new SteamAuthError('replayed', 'This Steam sign-in was already used. Please try again.');
    throw err;
  }
  await db('openid_nonces').where('created_at', '<', new Date(Date.now() - 24 * 3600 * 1000)).del();
  return { steamid: match[1], intent: pending.intent, next: pending.next };
}

const findLinkedUser = (steamid) => db('user_identities').where({ provider: 'steam', subject: steamid }).first('user_id');

// Optional public profile details (needs STEAM_WEB_API_KEY). Never required.
async function fetchSteamProfile(steamid) {
  const fallback = { profile_url: `https://steamcommunity.com/profiles/${steamid}`, persona_name: null, avatar_url: null };
  if (!config.steamWebApiKey) return fallback;
  try {
    const url = `${config.steamApiBase}/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(config.steamWebApiKey)}&steamids=${steamid}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return fallback;
    const p = ((await res.json()).response?.players || [])[0];
    if (!p) return fallback;
    return {
      profile_url: /^https:\/\/steamcommunity\.com\//.test(p.profileurl || '') ? p.profileurl : fallback.profile_url,
      persona_name: typeof p.personaname === 'string' ? p.personaname.slice(0, 64) : null,
      avatar_url: /^https:\/\/avatars\.(steamstatic|akamai\.steamstatic|cloudflare\.steamstatic)\.com\//.test(p.avatarfull || '') ? p.avatarfull : null,
    };
  } catch {
    return fallback;
  }
}

async function linkIdentity(userId, steamid, trx = db) {
  const existing = await trx('user_identities').where({ provider: 'steam', subject: steamid }).first('user_id');
  if (existing && existing.user_id === userId) return { already: true };
  if (existing) {
    throw conflict('This Steam account is already linked to another CS-Trainer account. Sign in with Steam to use that account, or unlink Steam there first.', 'steam_taken');
  }
  const mine = await trx('user_identities').where({ provider: 'steam', user_id: userId }).first('subject');
  if (mine) throw conflict('Your account is already linked to a different Steam account. Unlink it first.', 'steam_already_linked');
  try {
    await trx('user_identities').insert({ user_id: userId, provider: 'steam', subject: steamid });
  } catch (err) {
    if (err.code === '23505') throw conflict('This Steam account was linked by someone else just now.', 'steam_taken');
    throw err;
  }
  return { already: false };
}

const cleanName = (s) => String(s || '').normalize('NFKC').replace(/[^\p{L}\p{N} _.-]+/gu, '').trim().slice(0, 32);

// Creates a Steam-backed account (no email or password) for a verified,
// unlinked SteamID64 held in the session.
async function createSteamAccount(steamid, { user_name: userName, use_profile_url: useProfileUrl, use_avatar: useAvatar }, profile) {
  const name = cleanName(userName);
  if (name.length < 2) throw badRequest('Choose a username of at least 2 characters', 'invalid_user_name');
  const user = await db.transaction(async (trx) => {
    if (await trx('user_identities').where({ provider: 'steam', subject: steamid }).first('user_id')) {
      throw conflict('This Steam account already has a CS-Trainer account. Sign in with Steam instead.', 'steam_taken');
    }
    const [row] = await trx('users').insert({
      user_name: name,
      steam_url: useProfileUrl && profile ? profile.profile_url : null,
    }).returning(['user_id', 'user_name', 'email']);
    await linkIdentity(row.user_id, steamid, trx);
    return row;
  });
  if (useAvatar && profile && profile.avatar_url) await importAvatar(user.user_id, profile.avatar_url).catch(() => {});
  return user;
}

// Copies a Steam avatar into the app's own picture store (never hotlinked).
async function importAvatar(userId, url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return;
  const type = (res.headers.get('content-type') || '').split(';')[0];
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 2 * 1024 * 1024) return;
  const { replace } = require('./pictures');
  await replace({ table: 'users', idColumn: 'user_id', id: userId, column: 'avatar_image_id', purpose: 'avatar', userId, buf, contentType: type });
}

// Offers Steam details to a linked account, filling only empty fields so
// nothing the player entered is overwritten.
async function prefillFromSteam(userId, { profile_url: wantUrl, avatar: wantAvatar }) {
  const identity = await db('user_identities').where({ provider: 'steam', user_id: userId }).first('subject');
  if (!identity) throw notFound('Link Steam first');
  const profile = await fetchSteamProfile(identity.subject);
  const user = await db('users').where('user_id', userId).first('steam_url', 'avatar_image_id');
  const applied = [];
  if (wantUrl && !user.steam_url) {
    await db('users').where('user_id', userId).update({ steam_url: profile.profile_url });
    applied.push('steam_url');
  }
  if (wantAvatar && !user.avatar_image_id && profile.avatar_url) {
    await importAvatar(userId, profile.avatar_url).then(() => applied.push('avatar')).catch(() => {});
  }
  return { applied };
}

async function identities(userId) {
  const [steam, user] = await Promise.all([
    db('user_identities').where({ provider: 'steam', user_id: userId }).first('subject', 'created_at'),
    db('users').where('user_id', userId).first('password_hash', 'email', 'settings'),
  ]);
  const stats = (user.settings || {}).stats || {};
  return {
    steam: steam ? { steamid64: steam.subject, linked_at: steam.created_at } : null,
    has_password: Boolean(user.password_hash),
    email: user.email,
    match_tracking: Boolean(stats.track),
    steam_web_api: Boolean(config.steamWebApiKey),
  };
}

// Unlinking is refused when Steam is the account's only way to sign in.
async function unlink(userId) {
  const user = await db('users').where('user_id', userId).first('password_hash');
  if (!user.password_hash) {
    throw conflict('Steam is your only sign-in method. Add an email and password before unlinking Steam.', 'last_sign_in_method');
  }
  const n = await db('user_identities').where({ provider: 'steam', user_id: userId }).del();
  if (!n) throw notFound('Steam is not linked');
  return identities(userId);
}

module.exports = {
  startUrl, verifyCallback, findLinkedUser, fetchSteamProfile, linkIdentity, createSteamAccount, prefillFromSteam,
  identities, unlink, SteamAuthError, PENDING_MAX_AGE_MS, appOrigin,
};
