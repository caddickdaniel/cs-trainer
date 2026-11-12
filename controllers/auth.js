const users = require('../services/users');
const steam = require('../services/steam');
const v = require('../validation');
const { csrf, SESSION_COOKIE } = require('../middleware/security');
const { asyncHandler, httpError } = require('../errors');

const regenerate = (req) => new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
const save = (req) => new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));

// Starts a fresh session for the user (prevents session fixation) and issues
// a new CSRF token bound to it.
// A verified-but-unlinked Steam identity survives the session regeneration so
// a player can sign in with a password and then choose to link it.
async function signInAs(req, user) {
  const steamPending = req.session.steamPending;
  await regenerate(req);
  req.session.userId = user.user_id;
  if (steamPending) req.session.steamPending = steamPending;
  const csrfToken = csrf.generateToken(req, true);
  await save(req);
  return csrfToken;
}

async function mePayload(req) {
  if (!req.user) return { user: null, teams: [], active_team: null };
  const { teams, active_team } = await users.getMemberships(req.user.user_id);
  const { user_id, user_name, email } = req.user;
  return { user: { user_id, user_name, email }, teams, active_team };
}

exports.sendCsrfToken = (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(200).send({ csrf_token: csrf.generateToken(req) });
};

exports.sendMe = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(200).send({ ...(await mePayload(req)), csrf_token: csrf.generateToken(req) });
});

exports.signup = asyncHandler(async (req, res) => {
  const body = v.signup.parse(req.body);
  const user = await users.createUser(body);
  const csrfToken = await signInAs(req, user);
  req.user = user;
  res.status(201).send({ ...(await mePayload(req)), csrf_token: csrfToken });
});

exports.signin = asyncHandler(async (req, res) => {
  const { email, password } = v.signin.parse(req.body);
  const user = await users.verifyCredentials(email, password);
  if (!user) throw httpError(401, 'Email or password is incorrect', 'invalid_credentials');
  const csrfToken = await signInAs(req, user);
  req.user = user;
  res.status(200).send({ ...(await mePayload(req)), csrf_token: csrfToken });
});

exports.signout = (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie(SESSION_COOKIE);
    return res.status(204).send();
  });
};

// ---- Steam --------------------------------------------------------------------

const safeNext = (n) => (typeof n === 'string' && /^\/(?!\/)[\w\-./?=&%#]*$/.test(n) ? n : null);

exports.steamStart = asyncHandler(async (req, res) => {
  const intent = req.query.intent === 'link' ? 'link' : 'signin';
  if (intent === 'link' && !req.user) return res.redirect(302, '/signin?next=/settings');
  const url = steam.startUrl(req, { intent, next: safeNext(req.query.next) });
  await save(req);
  return res.redirect(302, url);
});

// Steam redirects the browser here. Every outcome is a redirect to a page
// that explains it.
exports.steamCallback = async (req, res, next) => {
  const fail = (code) => res.redirect(302, `${req.user ? '/settings' : '/signin'}?steam_error=${encodeURIComponent(code)}`);
  let verified;
  try {
    verified = await steam.verifyCallback(req);
  } catch (err) {
    if (err instanceof steam.SteamAuthError) return fail(err.code);
    return next(err);
  }
  try {
    const linked = await steam.findLinkedUser(verified.steamid);
    if (verified.intent === 'link' && req.user) {
      try {
        await steam.linkIdentity(req.user.user_id, verified.steamid);
      } catch (err) {
        if (err.code && err.status === 409) return fail(err.code);
        throw err;
      }
      await save(req);
      return res.redirect(302, '/settings?steam=linked');
    }
    if (linked) {
      const user = await users.findUser(linked.user_id);
      delete req.session.steamPending;
      await signInAs(req, user);
      return res.redirect(302, verified.next || '/');
    }
    // Unlinked: offer to create a Steam account or link an existing one.
    req.session.steamPending = { steamid: verified.steamid, at: Date.now() };
    await save(req);
    return res.redirect(302, '/steam/finish');
  } catch (err) {
    return next(err);
  }
};

function pendingSteam(req) {
  const p = req.session.steamPending;
  if (!p || Date.now() - p.at > steam.PENDING_MAX_AGE_MS) {
    delete req.session.steamPending;
    throw httpError(404, 'No verified Steam sign-in is waiting. Start again with Continue with Steam.', 'no_pending_steam');
  }
  return p;
}

exports.steamPending = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const p = pendingSteam(req);
  const profile = await steam.fetchSteamProfile(p.steamid);
  res.send({
    steamid64: p.steamid,
    suggestions: { user_name: profile.persona_name, avatar_url: profile.avatar_url, profile_url: profile.profile_url },
    signed_in_as: req.user ? { user_id: req.user.user_id, user_name: req.user.user_name } : null,
  });
});

exports.steamComplete = asyncHandler(async (req, res) => {
  if (req.user) throw httpError(409, 'You are signed in. Link Steam to this account instead.', 'signed_in');
  const p = pendingSteam(req);
  const body = v.steamComplete.parse(req.body);
  const profile = await steam.fetchSteamProfile(p.steamid);
  const user = await steam.createSteamAccount(p.steamid, body, profile);
  delete req.session.steamPending;
  const csrfToken = await signInAs(req, user);
  req.user = user;
  res.status(201).send({ ...(await mePayload(req)), csrf_token: csrfToken });
});

// Explicitly links the waiting verified Steam identity to the signed-in account.
exports.steamLinkPending = asyncHandler(async (req, res) => {
  const p = pendingSteam(req);
  await steam.linkIdentity(req.user.user_id, p.steamid);
  delete req.session.steamPending;
  await save(req);
  res.send(await steam.identities(req.user.user_id));
});

exports.steamCancelPending = asyncHandler(async (req, res) => {
  delete req.session.steamPending;
  await save(req);
  res.status(204).send();
});
