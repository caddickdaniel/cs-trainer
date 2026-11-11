const { ZodError } = require('zod');

class HttpError extends Error {
  constructor(status, message, code, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const httpError = (status, message, code, extra) => new HttpError(status, message, code, extra);
exports.HttpError = HttpError;
exports.httpError = httpError;
exports.badRequest = (message, code = 'bad_request') => httpError(400, message, code);
exports.unauthorized = (message = 'Please sign in to continue') => httpError(401, message, 'unauthenticated');
exports.forbidden = (message = 'You do not have permission to do that') => httpError(403, message, 'forbidden');
exports.notFound = (message = 'Not found', code = 'not_found') => httpError(404, message, code);
exports.conflict = (message, code = 'conflict', extra) => httpError(409, message, code, extra);

// Wraps async route handlers so rejected promises reach the error handlers.
exports.asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const send = (res, status, body) => res.status(status).json(body);

exports.handleValidation = (err, req, res, next) => {
  if (err instanceof ZodError) {
    return send(res, 400, {
      message: 'Some of the submitted data is invalid',
      code: 'validation_failed',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return next(err);
};

exports.handleHttpError = (err, req, res, next) => {
  if (err instanceof HttpError) {
    return send(res, err.status, { message: err.message, code: err.code, ...(err.extra || {}) });
  }
  if (err.code === 'EBADCSRFTOKEN') {
    return send(res, 403, { message: 'Your session token is missing or out of date. Refresh and try again.', code: 'csrf_invalid' });
  }
  if (err.type === 'entity.parse.failed') {
    return send(res, 400, { message: 'Request body is not valid JSON', code: 'invalid_json' });
  }
  if (err.type === 'entity.too.large') {
    return send(res, 413, { message: 'Request body is too large', code: 'payload_too_large' });
  }
  return next(err);
};

// Legacy handlers (kept for existing behaviour).
exports.handle404 = (err, req, res, next) => {
  if (err.status === 404) {
    res.status(404).send({
      status: 404,
      message: err.message || 'Sorry, the page you have entered does not exist. Please try again',
    });
  } else {
    next(err);
  }
};

exports.handle422 = (err, req, res, next) => {
  if (err.code === '23505' || err.code === '23503') {
    res.status(422).json({
      message: 'Sorry, but the key you entered already exists',
    });
  } else {
    next(err);
  }
};

exports.handle400 = (err, req, res, next) => {
  if (err.code === '42703' || err.code === '22P02' || err.code === '23514') {
    res.status(400).json({
      message:
        'Sorry, an incorrect format has been detected. Ensure you have typed in the correct format and try again',
    });
  } else if (err.status === 400) {
    res.status(400).json({
      message: err.message,
    });
  } else next(err);
};

exports.handle405 = (req, res) => {
  res.status(405).json({ message: 'Method Not Allowed' });
};

exports.handle500 = (err, req, res, next) => {
  if (process.env.NODE_ENV !== 'test') console.error(err);
  res.status(500).send({ message: 'Oops! Something went wrong' });
};
