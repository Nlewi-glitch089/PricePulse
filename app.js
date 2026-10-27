// Builds the Express application. server.js starts it; the tests import it directly
// and pass in a test database.
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');

const MongoSessionStore = require('./database/sessionStore');
const { HttpError } = require('./lib/errors');
const requestLogger = require('./middleware/requestLogger');
const { requireAuth, requireAuthPage, redirectIfLoggedIn } = require('./middleware/auth');
const { securityHeaders, sameOriginOnly } = require('./middleware/security');
const { authRoutes } = require('./routes/auth');
const { accountRoutes } = require('./routes/account');
const { watchlistRoutes } = require('./routes/watchlist');
const { purchasesRoutes } = require('./routes/purchases');
const { notificationsRoutes } = require('./routes/notifications');
const { dashboardRoutes } = require('./routes/dashboard');
const { createLogger } = require('./lib/logger');

const log = createLogger('App');
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const publicDir = path.join(__dirname, 'public');

function getSessionSecret(isProduction) {
  // The old .env.example placeholder is public, so it can't protect a real deployment.
  if (isProduction && process.env.SESSION_SECRET === 'replace-with-a-long-random-string') {
    throw new Error('SESSION_SECRET is still the example placeholder. Set a long random value.');
  }
  if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }
  if (isProduction) {
    throw new Error('SESSION_SECRET must be set when NODE_ENV=production.');
  }
  log.warn('SESSION_SECRET is not set; using a random secret. Logins will reset when the server restarts.');
  return crypto.randomBytes(32).toString('hex');
}

// Errors from the MongoDB driver that mean "the database can't be reached right now".
function isDatabaseUnavailable(err) {
  return ['MongoServerSelectionError', 'MongoNetworkError', 'MongoNetworkTimeoutError', 'MongoTopologyClosedError', 'MongoNotConnectedError'].includes(
    err && err.name,
  );
}

function createApp(db, { providers = [] } = {}) {
  const isProduction = process.env.NODE_ENV === 'production';
  const app = express();
  const sessionStore = new MongoSessionStore(db);

  if (isProduction) {
    // Needed for Secure cookies and the real client IP behind Render's HTTPS proxy.
    app.set('trust proxy', 1);
  }
  app.disable('x-powered-by');

  app.use(requestLogger);
  app.use(securityHeaders({ isProduction }));

  // For Render's health check: confirms the server and database respond.
  // Registered before the session middleware so health pings never create sessions.
  app.get('/healthz', async (req, res) => {
    try {
      await db.command({ ping: 1 });
      res.json({ status: 'ok', database: 'connected' });
    } catch (err) {
      log.error('Health check failed: database unavailable', { error: err });
      res.status(503).json({ status: 'unavailable', database: 'unreachable' });
    }
  });

  app.use(express.json({ limit: '20kb' }));
  app.use(
    session({
      name: 'pricepulse.sid',
      secret: getSessionSecret(isProduction),
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        maxAge: SEVEN_DAYS_MS,
      },
    }),
  );

  // API
  const deps = { db, sessionStore, providers };
  app.use('/api', sameOriginOnly);
  app.use('/api/auth', authRoutes(deps));
  app.use('/api/account', requireAuth, accountRoutes(deps));
  app.use('/api/watchlist', requireAuth, watchlistRoutes(deps));
  app.use('/api/purchases', requireAuth, purchasesRoutes(deps));
  app.use('/api/notifications', requireAuth, notificationsRoutes(deps));
  app.use('/api/dashboard', requireAuth, dashboardRoutes(deps));
  app.get('/api/providers', requireAuth, (req, res) => {
    const list = providers.map((p) => ({ name: p.name, displayName: p.displayName }));
    res.json({ providers: list, manualEntryOnly: list.length === 0 });
  });
  app.use('/api', (req, res) => res.status(404).json({ error: `No API route for ${req.method} ${req.originalUrl}.` }));

  // Pages
  app.get(['/', '/index.html', '/login.html', '/register.html'], redirectIfLoggedIn);
  app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  app.get('/app.html', requireAuthPage);
  app.use(express.static(publicDir, { index: false }));
  app.use((req, res) => res.status(404).send('Page not found.'));

  // Errors (Express 5 passes errors from async handlers here)
  app.use((err, req, res, next) => {
    const context = { requestId: req.id, route: `${req.method} ${req.originalUrl}` };
    if (err instanceof HttpError) {
      if (err.status >= 500) log.error(err.message, { ...context, userId: req.session && req.session.userId });
      const body = { error: err.message };
      if (err.fields) body.fields = err.fields;
      if (err.code) body.code = err.code;
      if (err.details) body.details = err.details;
      return res.status(err.status).json(body);
    }
    if (err.type === 'entity.parse.failed') {
      log.warn('Rejected request with malformed JSON', context);
      return res.status(400).json({ error: 'Request body must be valid JSON.' });
    }
    if (err.type === 'entity.too.large') {
      log.warn('Rejected request body over the size limit', context);
      return res.status(413).json({ error: 'Request body is too large.' });
    }
    if (isDatabaseUnavailable(err)) {
      log.error('Database unavailable while handling request', { ...context, operation: res.locals.operation, error: err });
      if (res.headersSent) return next(err);
      return res.status(503).json({ error: 'The database is unavailable right now. Please try again in a moment.' });
    }

    // Anything else is a bug or an infrastructure problem.
    // Routes set res.locals.operation so the log says what was being attempted.
    log.error('Unexpected error while handling request', {
      ...context,
      operation: res.locals.operation,
      userId: req.session && req.session.userId,
      error: err,
    });
    if (res.headersSent) {
      return next(err);
    }
    return res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
  });

  return app;
}

module.exports = { createApp };
