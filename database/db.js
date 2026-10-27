// MongoDB connection, indexes, and id helpers.
//
// Collections:
//   users          accounts; notification preferences are embedded
//   products       shared catalog: one product page at one retailer (no user data)
//   entries        a user's private watch-list entry for a product
//   prices         price records: provider prices belong to a product (shared),
//                  manual prices belong to one entry (private)
//   notifications  in-app alerts
//   purchases      what a user bought, kept even if the entry is later removed
//   sessions       express-session data (see sessionStore.js)

const { MongoClient, ObjectId } = require('mongodb');
const { HttpError } = require('../lib/errors');

// "mongodb+srv://user:secret@cluster0.example.net/..." -> "mongodb+srv://cluster0.example.net",
// so connection problems can be logged without the password.
function describeUri(uri) {
  try {
    const url = new URL(uri);
    return `${url.protocol}//${url.host}`;
  } catch {
    return '(unreadable MONGODB_URI)';
  }
}

// Where to connect. MONGODB_URI has no built-in default, so a missing value
// stops start-up with a clear message instead of quietly using some other database.
function readDatabaseConfig(env = process.env) {
  return {
    uri: (env.MONGODB_URI || '').trim(),
    dbName: (env.MONGODB_DB || '').trim() || 'pricepulse',
  };
}

const isLocalUri = (uri) => /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(uri);

// Connects and checks the database answers, so a wrong URI or a stopped
// database fails at start-up instead of on the first request.
async function connectToDatabase(uri, dbName) {
  if (!uri) {
    throw new Error('MONGODB_URI is not set. Put your MongoDB connection string in .env (see .env.example) and save the file.');
  }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    const db = client.db(dbName);
    await db.command({ ping: 1 });
    await ensureIndexes(db);
    return { client, db };
  } catch (error) {
    await client.close().catch(() => {});
    const hint = isLocalUri(uri)
      ? ' MONGODB_URI points at a MongoDB server on this computer. To use MongoDB Atlas, put your Atlas connection string in .env and save the file.'
      : '';
    throw new Error(`Couldn't connect to MongoDB at ${describeUri(uri)} (database "${dbName}"): ${error.message}.${hint}`);
  }
}

// Creating an index that already exists is a no-op, so this runs on every start.
async function ensureIndexes(db) {
  await Promise.all([
    db.collection('users').createIndex({ email: 1 }, { unique: true }),
    // Finding demo accounts that have expired (services/demo.js).
    db.collection('users').createIndex({ demoExpiresAt: 1 }, { partialFilterExpression: { isDemo: true } }),

    // Only products with a URL are shared; the partial filter lets many URL-less products exist.
    db.collection('products').createIndex(
      { canonicalUrl: 1 },
      { unique: true, partialFilterExpression: { canonicalUrl: { $type: 'string' } } },
    ),

    db.collection('entries').createIndexes([
      { key: { userId: 1, productId: 1 }, unique: true },
      { key: { userId: 1, status: 1 } },
      { key: { userId: 1, category: 1 } },
      { key: { userId: 1, createdAt: -1 } },
      { key: { userId: 1, lastPriceChangeAt: -1 } },
      { key: { productId: 1 } },
    ]),

    db.collection('prices').createIndexes([
      { key: { productId: 1, observedAt: 1 } },
      { key: { entryId: 1, observedAt: 1 } },
      // The same provider quote delivered twice is stored once.
      {
        key: { productId: 1, providerName: 1, observedAt: 1 },
        unique: true,
        partialFilterExpression: { source: 'PROVIDER' },
      },
    ]),

    db.collection('notifications').createIndexes([
      // The duplicate-alert guarantee: one notification per price event.
      { key: { userId: 1, dedupeKey: 1 }, unique: true },
      { key: { userId: 1, createdAt: -1 } },
      { key: { userId: 1, readAt: 1 } },
    ]),

    db.collection('purchases').createIndexes([
      { key: { userId: 1, purchasedAt: -1 } },
      { key: { entryId: 1 }, unique: true, partialFilterExpression: { entryId: { $type: 'objectId' } } },
    ]),

    db.collection('sessions').createIndexes([
      // MongoDB deletes each session document once `expires` has passed.
      { key: { expires: 1 }, expireAfterSeconds: 0 },
      { key: { 'session.userId': 1 } },
    ]),
  ]);
}

// Malformed ids can't match anything, so they're "not found" rather than a server error.
function toObjectId(id, what = 'Item') {
  if (typeof id !== 'string' || !ObjectId.isValid(id) || String(new ObjectId(id)) !== id) {
    throw new HttpError(404, `${what} not found.`);
  }
  return new ObjectId(id);
}

const isDuplicateKeyError = (error) => error && error.code === 11000;

module.exports = { connectToDatabase, readDatabaseConfig, ensureIndexes, describeUri, toObjectId, isDuplicateKeyError, ObjectId };
