// Account settings: profile, notification preferences, password, sessions, deletion.
const express = require('express');
const bcrypt = require('bcryptjs');
const { DEFAULT_PREFERENCES, THEMES } = require('../lib/domain');
const { HttpError } = require('../lib/errors');
const { validate } = require('../lib/validation');
const { userIdOf } = require('./helpers');
const { validatePassword, SALT_ROUNDS } = require('./auth');
const { serializeUser } = require('../services/serializers');
const { deleteUserData } = require('../services/accounts');
const { createLogger } = require('../lib/logger');

const log = createLogger('Account');

function accountRoutes({ db, sessionStore }) {
  const router = express.Router();
  const users = db.collection('users');

  async function checkPassword(userId, password, field) {
    const user = await users.findOne({ _id: userId });
    if (typeof password !== 'string' || !password || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new HttpError(400, 'Password is incorrect.', { fields: { [field]: 'Password is incorrect.' } });
    }
    return user;
  }

  router.get('/preferences', async (req, res) => {
    const user = await users.findOne({ _id: userIdOf(req) }, { projection: { preferences: 1 } });
    res.json({ preferences: { ...DEFAULT_PREFERENCES, ...(user && user.preferences) } });
  });

  router.patch('/preferences', async (req, res) => {
    res.locals.operation = 'update preferences';
    const input = validate(req.body)
      .only(['targetAlerts', 'priceDropAlerts', 'priceDropMinPercent', 'defaultCurrency', 'theme'])
      .boolean('targetAlerts', { label: 'Target alerts' })
      .boolean('priceDropAlerts', { label: 'Price-drop alerts' })
      .integer('priceDropMinPercent', { label: 'Minimum drop', min: 1, max: 90 })
      .currency('defaultCurrency')
      .oneOf('theme', THEMES, { label: 'Theme' })
      .done();
    const set = Object.fromEntries(Object.entries(input).map(([k, v]) => [`preferences.${k}`, v]));
    const user = await users.findOneAndUpdate({ _id: userIdOf(req) }, { $set: set }, { returnDocument: 'after', projection: { preferences: 1 } });
    log.info('Preferences updated', { userId: req.session.userId, fields: Object.keys(input) });
    res.json({ preferences: { ...DEFAULT_PREFERENCES, ...user.preferences } });
  });

  router.patch('/profile', async (req, res) => {
    const { name } = validate(req.body).only(['name']).text('name', { label: 'Name', required: true, max: 80 }).done();
    const user = await users.findOneAndUpdate({ _id: userIdOf(req) }, { $set: { name } }, { returnDocument: 'after' });
    res.json({ user: serializeUser(user) });
  });

  router.post('/password', async (req, res) => {
    res.locals.operation = 'change password';
    const { currentPassword, newPassword } = req.body || {};
    const problem = validatePassword(newPassword, 'newPassword');
    if (problem) throw new HttpError(400, 'Some fields need attention.', { fields: problem });
    const userId = userIdOf(req);
    await checkPassword(userId, currentPassword, 'currentPassword');
    await users.updateOne({ _id: userId }, { $set: { passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS) } });
    // Everyone else who had this account open is signed out; this browser stays signed in.
    const ended = await sessionStore.destroyAllForUser(userId, req.sessionID);
    log.info('Password changed; other sessions ended', { userId, endedSessions: ended });
    res.json({ message: 'Password changed.' });
  });

  router.post('/logout-all', async (req, res, next) => {
    const userId = userIdOf(req);
    const ended = await sessionStore.destroyAllForUser(userId);
    log.info('Signed out everywhere', { userId, endedSessions: ended });
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('pricepulse.sid');
      return res.json({ message: 'Signed out everywhere.' });
    });
  });

  // Deletes the account and everything that belongs to it.
  router.delete('/', async (req, res, next) => {
    res.locals.operation = 'delete account';
    const userId = userIdOf(req);
    await checkPassword(userId, (req.body || {}).password, 'password');
    await deleteUserData(db, userId);
    await sessionStore.destroyAllForUser(userId, req.sessionID);
    log.info('Account deleted', { userId });
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('pricepulse.sid');
      return res.json({ message: 'Account deleted.' });
    });
  });

  return router;
}

module.exports = { accountRoutes };
