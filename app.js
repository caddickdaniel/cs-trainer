const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const config = require('./config/env');
const createApiRouter = require('./routes/apiRouter');
const { sessionMiddleware, authLimiter, apiLimiter } = require('./middleware/security');
const {
  handleValidation, handleHttpError, handle400, handle422, handle404, handle500,
} = require('./errors');

const CLIENT_DIST = path.join(__dirname, 'client', 'dist');

function createApp({ authRateLimit = 20, apiRateLimit = 600, serveClient = config.isProduction } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  }));
  // The API and the client share an origin (Vite proxies /api in development),
  // so no CORS headers are sent.
  app.use(express.json({ limit: '256kb' }));
  app.use(sessionMiddleware());
  app.use('/api', apiLimiter(apiRateLimit), createApiRouter({ authLimiter: authLimiter(authRateLimit) }));

  if (serveClient && fs.existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
  }

  app.all('/*', (req, res) => {
    res.status(404).send({
      message: 'Sorry, this page was not found! Go to /api to see a list of endpoints',
    });
  });

  app.use(handleValidation, handleHttpError, handle400, handle422, handle404, handle500);
  return app;
}

module.exports = createApp(config.isTest ? { authRateLimit: 1000, apiRateLimit: 100000 } : undefined);
module.exports.createApp = createApp;
