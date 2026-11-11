const users = require('../services/users');
const v = require('../validation');
const { csrf, SESSION_COOKIE } = require('../middleware/security');
const { asyncHandler, httpError } = require('../errors');

const regenerate = (req) => new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
const save = (req) => new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));

// Starts a fresh session for the user (prevents session fixation) and issues
// a new CSRF token bound to it.
async function signInAs(req, user) {
  await regenerate(req);
  req.session.userId = user.user_id;
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
