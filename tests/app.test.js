// Purchases, dashboard, pages and headers, error handling, and MongoDB persistence.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { MongoClient } = require('mongodb');
const { startTestServer, createClient, signUp, addProduct, recordPrice, daysAgo } = require('./helpers');
const { createApp } = require('../app');

let t;
before(async () => {
  t = await startTestServer();
});
after(() => t.stop());
beforeEach(() => t.reset());

describe('purchases', () => {
  test('marking purchased keeps the history and moves it off the active list', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client);
    await recordPrice(client, item.id, 125);
    const res = await client.post(`/api/watchlist/${item.id}/purchase`, { price: 124.5, purchasedAt: daysAgo(1), notes: 'Used a coupon' });
    assert.equal(res.status, 201);
    assert.equal(res.data.item.status, 'PURCHASED');
    assert.equal(res.data.item.purchase.price, 124.5);
    assert.equal(res.data.item.purchase.retailer, 'Acme Audio');
    assert.equal((await client.post(`/api/watchlist/${item.id}/purchase`, { price: 1, purchasedAt: daysAgo(1) })).status, 409);

    assert.equal((await client.get(`/api/watchlist/${item.id}/prices`)).data.points.length, 2);
    assert.equal((await client.get('/api/watchlist')).data.items.length, 0);
    assert.equal((await client.get('/api/watchlist?status=PURCHASED')).data.items.length, 1);

    const list = (await client.get('/api/purchases')).data;
    assert.equal(list.items[0].productName, 'Noise Cancelling Headphones');
    assert.equal(list.items[0].entry.lowestRecordedPrice, 125);
    assert.deepEqual(list.totals, [{ currency: 'USD', count: 1, spent: 124.5 }]);
    assert.equal((await client.patch(`/api/watchlist/${item.id}`, { status: 'WATCHING' })).status, 409);
  });

  test('validates purchases', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client);
    const res = await client.post(`/api/watchlist/${item.id}/purchase`, { price: -3 });
    assert.equal(res.status, 400);
    assert.deepEqual(Object.keys(res.data.fields).sort(), ['price', 'purchasedAt']);
  });

  test('undoing a purchase resumes watching (and re-checks the target)', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client, { currentPrice: 100, targetPrice: 120 });
    await client.post(`/api/watchlist/${item.id}/purchase`, { price: 100, purchasedAt: daysAgo(0) });
    const res = await client.del(`/api/watchlist/${item.id}/purchase`);
    assert.equal(res.status, 200);
    assert.equal(res.data.item.status, 'TARGET_REACHED');
    assert.equal(res.data.item.purchase, null);
  });

  test('the purchase record stays after the product is removed', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client);
    await client.post(`/api/watchlist/${item.id}/purchase`, { price: 140, purchasedAt: daysAgo(2) });
    await client.del(`/api/watchlist/${item.id}`);
    const list = (await client.get('/api/purchases')).data;
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].entry, null);
  });
});

describe('dashboard', () => {
  test('is empty for a new account', async () => {
    const { client } = await signUp(t.baseUrl);
    assert.deepEqual((await client.get('/api/dashboard')).data, {
      counts: { watching: 0, targetReached: 0, purchased: 0, total: 0, unreadNotifications: 0 },
      targetReached: [],
      recentChanges: [],
      biggestDrops: [],
      recentlyAdded: [],
      recentAlerts: [],
    });
  });

  test("summarizes the user's own data", async () => {
    const { client } = await signUp(t.baseUrl);
    const tv = await addProduct(client, { name: 'TV', url: 'https://d.example/tv', currentPrice: 1000, targetPrice: 800 });
    const mouse = await addProduct(client, { name: 'Mouse', url: 'https://d.example/mouse', currentPrice: 50, targetPrice: 45 });
    const desk = await addProduct(client, { name: 'Desk', url: 'https://d.example/desk', currentPrice: 300, targetPrice: null });
    await recordPrice(client, tv.id, 790);
    await new Promise((r) => setTimeout(r, 10));
    await recordPrice(client, mouse.id, 48);
    await client.post(`/api/watchlist/${desk.id}/purchase`, { price: 300, purchasedAt: daysAgo(0) });
    // Someone else's data never shows up.
    const other = await signUp(t.baseUrl);
    await addProduct(other.client, { name: 'Other', url: 'https://d.example/other' });

    const { data } = await client.get('/api/dashboard');
    assert.deepEqual(data.counts, { watching: 2, targetReached: 1, purchased: 1, total: 3, unreadNotifications: 1 });
    const names = (list) => list.map((i) => i.name);
    assert.deepEqual(names(data.targetReached), ['TV']);
    assert.deepEqual(names(data.biggestDrops), ['TV', 'Mouse']);
    assert.deepEqual(names(data.recentChanges), ['Mouse', 'TV']);
    assert.deepEqual(names(data.recentlyAdded), ['Desk', 'Mouse', 'TV']);
    assert.equal(data.recentAlerts.length, 1);
  });
});

describe('pages and headers', () => {
  test('serves the landing, login, and register pages, and redirects signed-in users to the app', async () => {
    const anon = createClient(t.baseUrl);
    const home = await anon.get('/');
    assert.equal(home.status, 200);
    assert.match(home.data, /PricePulse/);
    assert.equal((await anon.get('/login.html')).status, 200);
    assert.equal((await anon.get('/css/style.css')).status, 200);
    assert.equal((await anon.get('/js/api.js')).status, 200);

    const { client } = await signUp(t.baseUrl);
    assert.equal((await client.get('/app.html')).status, 200);
    const redirected = await client.get('/login.html');
    assert.equal(redirected.status, 302);
    assert.equal(redirected.headers.get('location'), '/app.html');
  });

  test('sends security headers and hides server internals', async () => {
    const res = await createClient(t.baseUrl).get('/');
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('x-powered-by'), null);
    assert.match(res.headers.get('x-request-id'), /^[0-9a-f]{8}$/);
  });

  test('does not serve server files', async () => {
    const anon = createClient(t.baseUrl);
    for (const path of ['/server.js', '/app.js', '/.env', '/package.json', '/database/db.js']) {
      assert.equal((await anon.get(path)).status, 404, path);
    }
  });
});

describe('errors', () => {
  test('malformed JSON, oversized bodies, and unknown API routes get clear JSON errors', async () => {
    const { client } = await signUp(t.baseUrl);
    assert.equal((await client.request('POST', '/api/watchlist', '{"name":')).status, 400);
    assert.equal((await client.post('/api/watchlist', { name: 'x'.repeat(30000) })).status, 413);
    const missing = await client.get('/api/nope');
    assert.equal(missing.status, 404);
    assert.match(missing.data.error, /No API route/);
  });

  test('when MongoDB goes away: 503 for requests and the health check, without leaking details', async () => {
    // A separate app on its own connection, which we then close.
    const client = new MongoClient(t.mongo.getUri(), { serverSelectionTimeoutMS: 500 });
    await client.connect();
    const app = createApp(client.db('pricepulse_test'));
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      assert.equal((await fetch(`${base}/healthz`)).status, 200);
      await client.close();
      const health = await fetch(`${base}/healthz`);
      assert.equal(health.status, 503);
      const reg = await fetch(`${base}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'A', email: 'down@example.com', password: 'password123' }),
      });
      const body = await reg.json();
      assert.equal(reg.status, 503);
      assert.match(body.error, /database is unavailable/);
      assert.doesNotMatch(JSON.stringify(body), /mongo|topology|127\.0\.0\.1/i);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe('MongoDB persistence', () => {
  test('data and logins survive a server restart', async () => {
    const { client, user } = await signUp(t.baseUrl);
    const item = await addProduct(client);
    await recordPrice(client, item.id, 110);

    // A brand-new app instance on a brand-new connection to the same database.
    const conn = new MongoClient(t.mongo.getUri());
    await conn.connect();
    const app = createApp(conn.db('pricepulse_test'));
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    try {
      const restarted = createClient(`http://127.0.0.1:${server.address().port}`);
      restarted.cookie = client.cookie; // same browser cookie
      const me = await restarted.get('/api/auth/me');
      assert.equal(me.status, 200);
      assert.equal(me.data.user.id, user.id);
      const got = await restarted.get(`/api/watchlist/${item.id}`);
      assert.equal(got.data.item.currentPrice, 110);
      assert.equal(got.data.item.status, 'TARGET_REACHED');
      assert.equal((await restarted.get('/api/notifications')).data.items.length, 1);
    } finally {
      await new Promise((r) => server.close(r));
      await conn.close();
    }
  });

  test('creates the indexes that enforce the data rules', async () => {
    const names = async (c) => (await t.db.collection(c).indexes()).filter((i) => i.unique || i.expireAfterSeconds !== undefined).map((i) => Object.keys(i.key).join('+'));
    assert.deepEqual(await names('users'), ['email']);
    assert.deepEqual(await names('products'), ['canonicalUrl']);
    assert.deepEqual(await names('entries'), ['userId+productId']);
    assert.deepEqual(await names('notifications'), ['userId+dedupeKey']);
    assert.deepEqual(await names('prices'), ['productId+providerName+observedAt']);
    assert.deepEqual(await names('sessions'), ['expires']);
  });
});
