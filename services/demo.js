// Demo accounts: a throwaway account filled with sample products, so people can
// explore PricePulse without entering data. Each visitor gets their own account
// (nothing is shared, and real accounts are never touched). It is deleted when
// they sign out, or after DEMO_LIFETIME_MS if they just leave.
//
// The products, stores, and prices below are made up. Prices are recorded through
// the normal services, so the history, alerts, and dashboard behave exactly as
// they would for a real user.
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { DEFAULT_PREFERENCES } = require('../lib/domain');
const { createEntry, updateEntry, recordPurchase } = require('./watchlist');
const { recordManualPrice } = require('./prices');
const { deleteUserData } = require('./accounts');
const { createLogger } = require('../lib/logger');

const log = createLogger('Demo');

const DEMO_LIFETIME_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// [days ago, price] pairs, oldest first. `list` is the retailer's "was" price (null when unknown).
const SAMPLE_PRODUCTS = [
  { name: 'Aurora ANC Wireless Headphones', category: 'Audio', retailer: 'Brightline Electronics', list: 249.99, target: 179.99, history: [[60, 249.99], [41, 229.99], [23, 219.99], [9, 199.99], [2, 174.99]] },
  { name: 'Tidewater Portable Speaker', category: 'Audio', retailer: 'Brightline Electronics', list: 129, target: 89, history: [[52, 129], [30, 119], [12, 109]] },
  { name: 'Northfield 6 Qt Enameled Dutch Oven', category: 'Kitchen', retailer: 'Harbor & Hearth', list: 119.95, target: 79.95, history: [[58, 119.95], [35, 99.95], [16, 89.95], [4, 84.95]] },
  { name: 'Brava Espresso Machine', category: 'Kitchen', retailer: 'Harbor & Hearth', list: 449, target: 349, history: [[45, 449], [20, 399], [6, 419]] },
  { name: 'Quillmate Ergonomic Office Chair', category: 'Home office', retailer: 'Northwind Home', list: 529, target: 399, history: [[50, 529], [25, 479], [3, 389]] },
  { name: 'Lumen 27-inch 4K Monitor', category: 'Home office', retailer: 'Pixel Depot', list: null, target: 299, history: [[40, 349.99], [18, 339.99], [5, 329.99]] },
  { name: 'Ridgeline 30L Hiking Backpack', category: 'Outdoors', retailer: 'Summit Supply Co.', list: 159, target: 120, history: [[55, 159], [28, 143.1], [10, 127.2]] },
  { name: 'Basecamp Two-Person Tent', category: 'Outdoors', retailer: 'Summit Supply Co.', list: 239, target: null, history: [[33, 239], [8, 199]] },
  { name: 'Nimbus Handheld Game Console', category: 'Gaming', retailer: 'Pixel Depot', list: 399.99, target: 349.99, history: [[47, 399.99], [21, 399.99], [7, 379.99]] },
  { name: 'Kestrel Smart Thermostat', category: 'Smart home', retailer: 'Northwind Home', list: 199, target: 149, history: [[39, 179], [14, 159], [1, 139]], purchased: { price: 139, daysAgo: 1, notes: 'Bought once it dropped below my target.' } },
  { name: 'Stride Adjustable Dumbbells (pair)', category: 'Fitness', retailer: 'Fieldhouse Sports', list: 349, target: 249, history: [[44, 349], [26, 299]], status: 'NOT_INTERESTED' },
  { name: 'Cadence Fitness Tracker', category: 'Fitness', retailer: 'Fieldhouse Sports', list: null, target: 79, history: [[20, 99.99]] },
];

const toCents = (price) => (price === null ? null : Math.round(price * 100));

async function fillWithSampleProducts(db, userId, now = Date.now()) {
  for (const p of SAMPLE_PRODUCTS) {
    const entry = await createEntry(db, userId, {
      name: p.name,
      category: p.category,
      retailer: p.retailer,
      currency: 'USD',
      targetPriceCents: toCents(p.target),
      listPriceCents: toCents(p.list),
      notes: 'Sample product: the store and prices are made up.',
      allowDuplicate: true,
    });
    for (const [daysAgo, price] of p.history) {
      await recordManualPrice(db, userId, entry._id, { priceCents: toCents(price), observedAt: new Date(now - daysAgo * DAY_MS) });
    }
    if (p.purchased) {
      await recordPurchase(db, userId, entry._id, { priceCents: toCents(p.purchased.price), purchasedAt: new Date(now - p.purchased.daysAgo * DAY_MS), notes: p.purchased.notes });
    }
    if (p.status) await updateEntry(db, userId, entry._id, { status: p.status });
    // Added when its first price was seen, not when the demo started.
    await db.collection('entries').updateOne({ _id: entry._id }, { $set: { createdAt: new Date(now - p.history[0][0] * DAY_MS) } });
  }

  // Alerts were created while the history was being filled in: date each one when its
  // price was seen, and treat anything older than a week as already read.
  const weekAgo = new Date(now - 7 * DAY_MS);
  for (const n of await db.collection('notifications').find({ userId }).toArray()) {
    const point = n.pricePointId && (await db.collection('prices').findOne({ _id: n.pricePointId }, { projection: { observedAt: 1 } }));
    if (!point) continue;
    await db.collection('notifications').updateOne({ _id: n._id }, { $set: { createdAt: point.observedAt, readAt: point.observedAt < weekAgo ? point.observedAt : null } });
  }
}

async function createDemoAccount(db) {
  const now = new Date();
  const user = {
    name: 'Demo shopper',
    email: `demo-${crypto.randomBytes(6).toString('hex')}@demo.pricepulse.invalid`,
    // Nobody knows this password, so the account can only be used through its demo session.
    passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10),
    preferences: { ...DEFAULT_PREFERENCES, priceDropAlerts: true },
    isDemo: true,
    demoExpiresAt: new Date(now.getTime() + DEMO_LIFETIME_MS),
    createdAt: now,
  };
  const { insertedId } = await db.collection('users').insertOne(user);
  user._id = insertedId;
  try {
    await fillWithSampleProducts(db, insertedId);
  } catch (error) {
    await deleteUserData(db, insertedId);
    throw error;
  }
  log.info('Demo account created', { userId: insertedId });
  return user;
}

// Deletes one demo account. Refuses anything that isn't a demo account.
async function endDemoAccount(db, sessionStore, userId) {
  const user = await db.collection('users').findOne({ _id: userId, isDemo: true }, { projection: { _id: 1 } });
  if (!user) return false;
  await deleteUserData(db, userId);
  await sessionStore.destroyAllForUser(userId);
  log.info('Demo account deleted', { userId });
  return true;
}

// Demo accounts that were left open past their lifetime.
async function removeExpiredDemoAccounts(db, sessionStore, now = new Date()) {
  const expired = await db.collection('users').find({ isDemo: true, demoExpiresAt: { $lte: now } }, { projection: { _id: 1 } }).toArray();
  for (const { _id } of expired) await endDemoAccount(db, sessionStore, _id);
  return expired.length;
}

module.exports = { SAMPLE_PRODUCTS, DEMO_LIFETIME_MS, createDemoAccount, endDemoAccount, removeExpiredDemoAccounts };
