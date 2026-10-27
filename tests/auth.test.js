// Accounts, sessions, and keeping each user's data private.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, createClient, signUp, addProduct, recordPrice } = require('./helpers');

let t;
before(async () => {
  t = await startTestServer();
});
after(() => t.stop());
beforeEach(() => t.reset());

describe('registration and login', () => {
  test('registers a user, stores a bcrypt hash in MongoDB, and sets an httpOnly session cookie', async () => {
    const client = createClient(t.baseUrl);
    const res = await client.post('/api/auth/register', { name: 'Ana', email: 'Ana@Example.com', password: 'password123' });
    assert.equal(res.status, 201);
    assert.equal(res.data.user.email, 'ana@example.com');
    assert.doesNotMatch(JSON.stringify(res.data), /password/i);
    const cookie = res.setCookie[0];
    assert.match(cookie, /^pricepulse\.sid=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);

    const stored = await t.db.collection('users').findOne({ email: 'ana@example.com' });
    assert.match(stored.passwordHash, /^\$2[aby]\$/);
    assert.equal(stored.preferences.targetAlerts, true);
    assert.equal(await t.db.collection('sessions').countDocuments({ 'session.userId': String(stored._id) }), 1);
  });

  test('rejects invalid registrations with a message per field', async () => {
    const res = await createClient(t.baseUrl).post('/api/auth/register', { name: '', email: 'nope', password: 'short' });
    assert.equal(res.status, 400);
    assert.deepEqual(Object.keys(res.data.fields).sort(), ['email', 'name', 'password']);
  });

  test('rejects a duplicate email, ignoring case', async () => {
    await createClient(t.baseUrl).post('/api/auth/register', { name: 'A', email: 'dup@example.com', password: 'password123' });
    const res = await createClient(t.baseUrl).post('/api/auth/register', { name: 'B', email: 'DUP@example.com', password: 'password123' });
    assert.equal(res.status, 409);
    assert.ok(res.data.fields.email);
  });

  test('logs in with the right password and gives the same answer for a wrong password or unknown email', async () => {
    const { email } = await signUp(t.baseUrl);
    assert.equal((await createClient(t.baseUrl).post('/api/auth/login', { email, password: 'password123' })).status, 200);
    const wrong = await createClient(t.baseUrl).post('/api/auth/login', { email, password: 'wrongpass1' });
    const unknown = await createClient(t.baseUrl).post('/api/auth/login', { email: 'ghost@example.com', password: 'whatever1' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.data.error, unknown.data.error);
  });

  test('protects every API area and the app page', async () => {
    const anon = createClient(t.baseUrl);
    for (const path of ['/api/auth/me', '/api/watchlist', '/api/dashboard', '/api/notifications', '/api/purchases', '/api/account/preferences']) {
      assert.equal((await anon.get(path)).status, 401, path);
    }
    const page = await anon.get('/app.html');
    assert.equal(page.status, 302);
    assert.equal(page.headers.get('location'), '/login.html');
  });

  test('rejects a forged session cookie', async () => {
    const client = createClient(t.baseUrl);
    client.cookie = 'pricepulse.sid=s%3Aforged.signature';
    assert.equal((await client.get('/api/auth/me')).status, 401);
  });

  test('logout ends the session in the database', async () => {
    const { client } = await signUp(t.baseUrl);
    assert.equal((await client.get('/api/auth/me')).status, 200);
    assert.equal((await client.post('/api/auth/logout')).status, 200);
    assert.equal((await client.get('/api/auth/me')).status, 401);
    assert.equal(await t.db.collection('sessions').countDocuments(), 0);
  });

  test('changing the password signs out other devices but keeps this one', async () => {
    const { client, email } = await signUp(t.baseUrl);
    const other = createClient(t.baseUrl);
    await other.post('/api/auth/login', { email, password: 'password123' });
    assert.equal((await other.get('/api/auth/me')).status, 200);

    const bad = await client.post('/api/account/password', { currentPassword: 'nope', newPassword: 'newpass123' });
    assert.equal(bad.status, 400);
    const ok = await client.post('/api/account/password', { currentPassword: 'password123', newPassword: 'newpass123' });
    assert.equal(ok.status, 200);
    assert.equal((await client.get('/api/auth/me')).status, 200);
    assert.equal((await other.get('/api/auth/me')).status, 401);
    assert.equal((await createClient(t.baseUrl).post('/api/auth/login', { email, password: 'newpass123' })).status, 200);
  });

  test('"sign out everywhere" ends every session', async () => {
    const { client, email } = await signUp(t.baseUrl);
    const other = createClient(t.baseUrl);
    await other.post('/api/auth/login', { email, password: 'password123' });
    assert.equal((await client.post('/api/account/logout-all')).status, 200);
    assert.equal((await client.get('/api/auth/me')).status, 401);
    assert.equal((await other.get('/api/auth/me')).status, 401);
  });

  test('rejects state-changing requests from another origin', async () => {
    const res = await createClient(t.baseUrl).request('POST', '/api/auth/login', { email: 'a@example.com', password: 'x' }, { Origin: 'https://evil.example' });
    assert.equal(res.status, 403);
  });

  test('deletes the account and everything in it after confirming the password', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client);
    await recordPrice(client, item.id, 100);
    assert.equal((await client.del('/api/account', { password: 'wrong' })).status, 400);
    assert.equal((await client.del('/api/account', { password: 'password123' })).status, 200);
    for (const c of ['users', 'entries', 'prices', 'products', 'notifications', 'sessions']) {
      assert.equal(await t.db.collection(c).countDocuments(), 0, c);
    }
    assert.equal((await client.get('/api/auth/me')).status, 401);
  });
});

describe('account isolation', () => {
  test("another user can't read, change, or delete your products, prices, purchases, or alerts", async () => {
    const alice = await signUp(t.baseUrl, 'Alice');
    const mallory = await signUp(t.baseUrl, 'Mallory');
    const item = await addProduct(alice.client);
    const { point } = await recordPrice(alice.client, item.id, 100); // reaches the 120 target -> alert
    const [note] = (await alice.client.get('/api/notifications')).data.items;
    const m = mallory.client;

    const attempts = [
      m.get(`/api/watchlist/${item.id}`),
      m.patch(`/api/watchlist/${item.id}`, { targetPrice: 1 }),
      m.del(`/api/watchlist/${item.id}`),
      m.get(`/api/watchlist/${item.id}/prices`),
      m.post(`/api/watchlist/${item.id}/prices`, { price: 1 }),
      m.del(`/api/watchlist/${item.id}/prices/${point.id}`),
      m.post(`/api/watchlist/${item.id}/purchase`, { price: 1, purchasedAt: new Date().toISOString() }),
      m.post(`/api/watchlist/${item.id}/refresh`),
      m.patch(`/api/notifications/${note.id}`, { read: true }),
      m.del(`/api/notifications/${note.id}`),
    ];
    for (const res of await Promise.all(attempts)) {
      // 404, not 403: other users' ids look exactly like ids that don't exist.
      assert.equal(res.status, 404);
    }
    assert.equal((await m.get('/api/watchlist?status=all')).data.items.length, 0);
    assert.equal((await m.get('/api/notifications')).data.items.length, 0);

    const entry = await t.db.collection('entries').findOne({});
    assert.equal(entry.targetPriceCents, 12000);
    assert.equal(entry.currentPriceCents, 10000);
    assert.equal((await alice.client.get('/api/notifications')).data.unreadCount, 1);
  });

  test('a shared product keeps names, targets, notes and typed-in prices private', async () => {
    const alice = await signUp(t.baseUrl);
    const bob = await signUp(t.baseUrl);
    const a = await addProduct(alice.client, { url: 'https://shop.example/tv-55', name: 'Den TV', currentPrice: 500, targetPrice: 450, notes: 'for the den' });
    const b = await addProduct(bob.client, { url: 'https://www.shop.example/tv-55?utm_source=mail', name: 'TV', currentPrice: 520, targetPrice: 300 });

    // One shared catalog document, two private entries.
    assert.equal(await t.db.collection('products').countDocuments(), 1);
    const product = await t.db.collection('products').findOne({});
    assert.deepEqual(Object.keys(product).sort(), ['_id', 'canonicalUrl', 'createdAt', 'currency', 'retailer']);

    const bobView = (await bob.client.get(`/api/watchlist/${b.id}`)).data.item;
    assert.equal(bobView.name, 'TV');
    assert.equal(bobView.targetPrice, 300);
    assert.equal(bobView.notes, null);
    assert.equal(bobView.currentPrice, 520);
    const bobHistory = (await bob.client.get(`/api/watchlist/${b.id}/prices`)).data.points.map((p) => p.price);
    assert.deepEqual(bobHistory, [520]);

    // Removing Alice's entry keeps the shared product for Bob; the last one out removes it.
    await alice.client.del(`/api/watchlist/${a.id}`);
    assert.equal(await t.db.collection('products').countDocuments(), 1);
    await bob.client.del(`/api/watchlist/${b.id}`);
    assert.equal(await t.db.collection('products').countDocuments(), 0);
  });

  test("you can't change the retailer of a product someone else also tracks", async () => {
    const alice = await signUp(t.baseUrl);
    const bob = await signUp(t.baseUrl);
    const a = await addProduct(alice.client, { url: 'https://shop.example/blender', retailer: 'Shop' });
    await addProduct(bob.client, { url: 'https://shop.example/blender', retailer: 'Shop' });
    const res = await alice.client.patch(`/api/watchlist/${a.id}`, { retailer: 'Hacked' });
    assert.equal(res.status, 409);
    assert.equal((await bob.client.get('/api/watchlist')).data.items[0].retailer, 'Shop');
  });
});
