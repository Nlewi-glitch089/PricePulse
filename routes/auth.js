// Authentication routes: register, login, logout, and current user.
const express = require('express');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const { requireAuth } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { DEFAULT_PREFERENCES } = require('../lib/domain');
const { isDuplicateKeyError } = require('../database/db');
const { serializeUser } = require('../services/serializers');
const demo = require('../services/demo');
const { createLogger } = require('../lib/logger');

const log = createLogger('Auth');

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const SALT_ROUNDS = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Compared against when an email doesn't exist, so failed logins take similar time either way.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', SALT_ROUNDS);

function validatePassword(password, field = 'password') {
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
    return { [field]: 'Password must be between 8 and 72 characters.' };
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return { [field]: 'Password must include at least one letter and one number.' };
  }
  return null;
}

function validateRegistration(body) {
  const fields = {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!name) fields.name = 'Name is required.';
  else if (name.length > 80) fields.name = 'Name must be 80 characters or fewer.';
  if (!EMAIL_PATTERN.test(email) || email.length > 254) fields.email = 'Enter a valid email address.';
  Object.assign(fields, validatePassword(body.password));
  return { fields, name, email, password: body.password };
}

// Start a fresh session for the user (prevents session fixation).
function logIn(req, userId) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = String(userId);
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

function authRoutes({ db, sessionStore }) {
  const router = express.Router();
  const users = db.collection('users');

  // Only failed logins count, so people sharing one network aren't locked out by normal use.
  const loginLimit = rateLimit({
    name: 'Login',
    windowMs: FIFTEEN_MINUTES_MS,
    max: 10,
    countIf: (status) => status === 401,
    message: 'Too many failed login attempts. Wait 15 minutes and try again.',
  });
  // Only accounts actually created count.
  const registerLimit = rateLimit({
    name: 'Registration',
    windowMs: ONE_HOUR_MS,
    max: process.env.NODE_ENV === 'test' ? 10_000 : 20,
    countIf: (status) => status === 201,
    message: 'Too many accounts have been created from this network. Try again in an hour.',
  });

  const demoLimit = rateLimit({
    name: 'Demo',
    windowMs: ONE_HOUR_MS,
    max: process.env.NODE_ENV === 'test' ? 10_000 : 10,
    countIf: (status) => status === 201,
    message: 'Too many demos have been started from this network. Try again in an hour.',
  });

  // Starts a private demo account with sample products (see services/demo.js).
  router.post('/demo', demoLimit, async (req, res) => {
    res.locals.operation = 'start demo';
    await demo.removeExpiredDemoAccounts(db, sessionStore);
    const user = await demo.createDemoAccount(db);
    await logIn(req, user._id);
    return res.status(201).json({ user: serializeUser(user) });
  });

  router.post('/register', registerLimit, async (req, res) => {
    res.locals.operation = 'register user';
    const { fields, name, email, password } = validateRegistration(req.body || {});
    if (Object.keys(fields).length) {
      log.warn('Registration rejected: validation failed', { fields: Object.keys(fields), requestId: req.id });
      return res.status(400).json({ error: 'Some fields need attention.', fields });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const doc = { name, email, passwordHash, preferences: { ...DEFAULT_PREFERENCES }, createdAt: new Date() };
    try {
      const { insertedId } = await users.insertOne(doc);
      doc._id = insertedId;
    } catch (err) {
      // The unique index on email catches both existing accounts and simultaneous signups.
      if (isDuplicateKeyError(err)) {
        log.warn('Registration rejected: email already registered', { requestId: req.id });
        return res.status(409).json({ error: 'An account with this email already exists.', fields: { email: 'An account with this email already exists.' } });
      }
      throw err;
    }

    await logIn(req, doc._id);
    log.info('User registered; session started', { userId: doc._id, requestId: req.id });
    return res.status(201).json({ user: serializeUser(doc) });
  });

  router.post('/login', loginLimit, async (req, res) => {
    res.locals.operation = 'log in';
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      log.warn('Login rejected: missing email or password', { requestId: req.id });
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await users.findOne({ email: email.trim().toLowerCase() });
    const passwordMatches = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
    if (!user || !passwordMatches) {
      log.warn('Login rejected: invalid credentials', { reason: user ? 'wrong password' : 'unknown email', requestId: req.id });
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    await logIn(req, user._id);
    log.info('User logged in; session started', { userId: user._id, requestId: req.id });
    return res.json({ user: serializeUser(user) });
  });

  router.post('/logout', async (req, res, next) => {
    res.locals.operation = 'log out';
    const userId = req.session.userId;
    // Leaving a demo deletes it; for any other account this does nothing.
    if (userId && ObjectId.isValid(userId)) await demo.endDemoAccount(db, sessionStore, new ObjectId(userId));
    req.session.destroy((err) => {
      if (err) return next(err);
      if (userId) log.info('User logged out; session ended', { userId, requestId: req.id });
      res.clearCookie('pricepulse.sid');
      return res.json({ message: 'Logged out.' });
    });
  });

  router.get('/me', requireAuth, async (req, res) => {
    let user = await users.findOne({ _id: new ObjectId(req.session.userId) });
    if (user && user.isDemo && user.demoExpiresAt <= new Date()) {
      await demo.endDemoAccount(db, sessionStore, user._id);
      user = null;
    }
    if (!user) {
      // The account was removed after the session was created.
      log.warn('Session refers to a user that no longer exists; ending it', { userId: req.session.userId, requestId: req.id });
      return req.session.destroy(() => res.status(401).json({ error: 'Please log in to continue.' }));
    }
    return res.json({ user: serializeUser(user) });
  });

  return router;
}

module.exports = { authRoutes, validatePassword, SALT_ROUNDS };
