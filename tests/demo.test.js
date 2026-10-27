// Demo accounts: sample data, kept apart from real accounts, deleted on sign-out or expiry.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { startTestServer, createClient, signUp, addProduct } = require('./helpers');
const { SAMPLE_PRODUCTS, removeExpiredDemoAccounts, endDemoAccount } = require('../services/demo');
const MongoSessionStore = require('../database/sessionStore');

let t;
before(async () => {
  t = await startTestServer();
});
after(() => t.stop());
beforeEach(() => t.reset());

async function startDemo() {
  const client = createClient(t.baseUrl);
  const res = await client.post('/api/auth/demo');
  assert.equal(res.status, 201);
  return { client, user: res.data.user };
}

const countFor = async (userId) => {
  const _id = new ObjectId(userId);
  const counts = {};
  for (const c of ['entries', 'notifications', 'purchases']) counts[c] = await t.db.collection(c).countDocuments({ userId: _id });
  counts.users = await t.db.collection('users').countDocuments({ _id });
  return counts;
};

describe('demo accounts', () => {
  test('a demo signs in to its own account filled with sample products, history, alerts, and a purchase', async () => {
    const { client, user } = await startDemo();
    assert.equal(user.isDemo, true);
    assert.equal((await client.get('/api/auth/me')).data.user.isDemo, true);

    const list = (await client.get('/api/watchlist?status=all&pageSize=50')).data;
    assert.equal(list.total, SAMPLE_PRODUCTS.length);
    const byName = Object.fromEntries(list.items.map((i) => [i.name, i]));

    // Prices come from the recorded history; the newest record is the current price.
    const headphones = byName['Aurora ANC Wireless Headphones'];
    assert.equal(headphones.currentPrice, 174.99);
    assert.equal(headphones.firstPrice, 249.99);
    assert.equal(headphones.status, 'TARGET_REACHED');
    assert.deepEqual(headphones.listDiscount, { amount: 75, percent: 30 });
    const history = (await client.get(`/api/watchlist/${headphones.id}/prices?range=all`)).data;
    assert.equal(history.points.length, 5);

    // Above target, no list price, no target, purchased, and not interested are all represented.
    assert.equal(byName['Tidewater Portable Speaker'].targetMet, false);
    assert.equal(byName['Lumen 27-inch 4K Monitor'].listPrice, null);
    assert.equal(byName['Lumen 27-inch 4K Monitor'].listDiscount, null);
    assert.equal(byName['Basecamp Two-Person Tent'].targetPrice, null);
    assert.equal(byName['Kestrel Smart Thermostat'].status, 'PURCHASED');
    assert.equal(byName['Stride Adjustable Dumbbells (pair)'].status, 'NOT_INTERESTED');

    // Alerts are dated when their price was seen; only the last week's are unread.
    const alerts = await t.db.collection('notifications').find({ userId: new ObjectId(user.id) }).toArray();
    const unread = (await client.get('/api/notifications')).data.unreadCount;
    assert.ok(alerts.length > 0 && unread > 0 && unread < alerts.length);
    assert.ok(alerts.every((n) => n.createdAt < new Date()) && new Set(alerts.map((n) => +n.createdAt)).size > 1);
    assert.equal((await client.get('/api/purchases')).data.items.length, 1);
  });

  test('demo data never appears in a real account, and each demo is private', async () => {
    const { client: real } = await signUp(t.baseUrl);
    await addProduct(real);
    const { client: demoA } = await startDemo();
    const { client: demoB } = await startDemo();
    assert.equal((await real.get('/api/watchlist?status=all')).data.total, 1);
    const a = (await demoA.get('/api/watchlist?status=all&pageSize=50')).data.items;
    const b = (await demoB.get('/api/watchlist?status=all&pageSize=50')).data.items;
    assert.equal(a.length, SAMPLE_PRODUCTS.length);
    assert.notDeepEqual(a.map((i) => i.id), b.map((i) => i.id));
    assert.equal((await demoB.get(`/api/watchlist/${a[0].id}`)).status, 404);
  });

  test('signing out of a demo deletes it and everything in it', async () => {
    const { client, user } = await startDemo();
    assert.ok((await countFor(user.id)).entries > 0);
    assert.equal((await client.post('/api/auth/logout')).status, 200);
    assert.deepEqual(await countFor(user.id), { entries: 0, notifications: 0, purchases: 0, users: 0 });
    assert.equal(await t.db.collection('prices').countDocuments(), 0);
    assert.equal((await client.get('/api/auth/me')).status, 401);
  });

  test('signing out of a real account deletes nothing', async () => {
    const { client, user } = await signUp(t.baseUrl);
    await addProduct(client);
    await client.post('/api/auth/logout');
    assert.equal((await countFor(user.id)).users, 1);
    assert.equal((await countFor(user.id)).entries, 1);
  });

  test('only demo accounts can be ended as demos', async () => {
    const { user } = await signUp(t.baseUrl);
    const store = new MongoSessionStore(t.db);
    assert.equal(await endDemoAccount(t.db, store, new ObjectId(user.id)), false);
    assert.equal((await countFor(user.id)).users, 1);
  });

  test('expired demo accounts are removed, and an expired demo session ends', async () => {
    const { client, user } = await startDemo();
    const { user: fresh } = await startDemo();
    await t.db.collection('users').updateOne({ _id: new ObjectId(user.id) }, { $set: { demoExpiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await client.get('/api/auth/me')).status, 401);
    assert.equal((await countFor(user.id)).users, 0);

    await t.db.collection('users').updateOne({ _id: new ObjectId(fresh.id) }, { $set: { demoExpiresAt: new Date(Date.now() - 1000) } });
    assert.equal(await removeExpiredDemoAccounts(t.db, new MongoSessionStore(t.db)), 1);
    assert.equal((await countFor(fresh.id)).entries, 0);
  });
});
