// express-session store that keeps sessions in the app's MongoDB database,
// so logins survive server restarts and work across Render instances.
// A TTL index on `expires` (see db.js) makes MongoDB delete expired sessions.
const session = require('express-session');
const { createLogger } = require('../lib/logger');

const log = createLogger('Session');
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

class MongoSessionStore extends session.Store {
  constructor(db) {
    super();
    this.sessions = db.collection('sessions');
  }

  expiryFor(sess) {
    const expires = sess.cookie && sess.cookie.expires;
    return expires ? new Date(expires) : new Date(Date.now() + ONE_DAY_MS);
  }

  // Session ids are secrets, so failures are logged without them.
  get(sid, callback) {
    this.sessions
      .findOne({ _id: sid, expires: { $gt: new Date() } })
      .then((doc) => callback(null, doc ? doc.session : null))
      .catch((err) => {
        log.error('Could not read session from the database', { error: err });
        callback(err);
      });
  }

  set(sid, sess, callback) {
    // Stored as a plain object (not JSON text) so `session.userId` can be queried
    // when signing a user out of every device.
    const plain = JSON.parse(JSON.stringify(sess));
    this.sessions
      .updateOne({ _id: sid }, { $set: { session: plain, expires: this.expiryFor(sess) } }, { upsert: true })
      .then(() => callback && callback(null))
      .catch((err) => {
        log.error('Could not save session to the database', { error: err });
        callback && callback(err);
      });
  }

  touch(sid, sess, callback) {
    this.sessions
      .updateOne({ _id: sid }, { $set: { expires: this.expiryFor(sess) } })
      .then(() => callback && callback(null))
      .catch((err) => {
        log.error('Could not extend session expiry', { error: err });
        callback && callback(err);
      });
  }

  destroy(sid, callback) {
    this.sessions
      .deleteOne({ _id: sid })
      .then(() => callback && callback(null))
      .catch((err) => {
        log.error('Could not delete session from the database', { error: err });
        callback && callback(err);
      });
  }

  // Ends every session for a user except (optionally) the current one.
  async destroyAllForUser(userId, exceptSid) {
    const filter = { 'session.userId': String(userId) };
    if (exceptSid) filter._id = { $ne: exceptSid };
    const { deletedCount } = await this.sessions.deleteMany(filter);
    return deletedCount;
  }
}

module.exports = MongoSessionStore;
