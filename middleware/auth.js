const { unauthorized } = require('../errors');
const { findUser } = require('../services/users');

// Loads the signed-in user from the server-side session (if any).
exports.loadUser = async (req, res, next) => {
  try {
    if (req.session && req.session.userId) {
      const user = await findUser(req.session.userId);
      if (user) req.user = user;
      else delete req.session.userId;
    }
    next();
  } catch (err) {
    next(err);
  }
};

exports.requireAuth = (req, res, next) => {
  if (!req.user) return next(unauthorized());
  return next();
};
