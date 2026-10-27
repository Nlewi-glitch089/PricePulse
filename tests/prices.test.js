// Price history, statistics, target-price alerts, duplicate-alert prevention,
// and prices from an automatic source.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, signUp, addProduct, recordPrice, daysAgo, createFakeProvider } = require('./helpers');
const { recordProviderQuote } = require('../services/prices');
const { ProviderError } = require('../lib/providers');

let t;
before(async () => {
  t = await startTestServer();
});
after(() => t.stop());
beforeEach(() => t.reset());

const notifications = async (client) => (await client.get('/api/notifications')).data;

describe('price history and statistics', () => {
  test('records a manual price with source and time, and updates the summary', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client, { targetPrice: null });
    const body = await recordPrice(client, item.id, 139.99, { note: 'Saw it in store' });
    assert.equal(body.point.source, 'MANUAL');
    assert.equal(body.point.note, 'Saw it in store');
    assert.equal(body.point.deletable, true);
    assert.equal(body.item.currentPrice, 139.99);
    assert.equal(body.item.previousPrice, 150);
    assert.equal(body.item.lowestPrice, 139.99);
    assert.deepEqual(body.item.lastChange, { from: 150, to: 139.99, amount: -10.01, percent: -6.67 });
  });

  test('history and statistics for 7, 30, 90 days and all time', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client, { currentPrice: undefined, targetPrice: null });
    for (const [d, p] of [[100, 200], [45, 180], [20, 160], [5, 170], [1, 150]]) await recordPrice(client, item.id, p, { observedAt: daysAgo(d) });
    const get = async (range) => (await client.get(`/api/watchlist/${item.id}/prices?range=${range}`)).data;

    const all = await get('all');
    assert.deepEqual(all.points.map((p) => p.price), [200, 180, 160, 170, 150]);
    assert.deepEqual(
      [all.stats.count, all.stats.current, all.stats.lowest, all.stats.highest, all.stats.average, all.stats.change, all.stats.changePercent],
      [5, 150, 150, 200, 172, -50, -25],
    );
    const d90 = await get('90d');
    assert.deepEqual([d90.stats.count, d90.stats.first, d90.stats.change, d90.stats.changePercent], [4, 180, -30, -16.67]);
    const d30 = await get('30d');
    assert.deepEqual([d30.stats.count, d30.stats.lowest, d30.stats.highest, d30.stats.change, d30.stats.changePercent], [3, 150, 170, -10, -6.25]);
    const d7 = await get('7d');
    assert.deepEqual([d7.stats.count, d7.stats.change], [2, -20]);
    assert.equal((await client.get(`/api/watchlist/${item.id}/prices?range=1y`)).status, 400);
  });

  test('shows empty statistics, not estimates, when a period has no records', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client, { currentPrice: undefined });
    await recordPrice(client, item.id, 99, { observedAt: daysAgo(60) });
    const { data } = await client.get(`/api/watchlist/${item.id}/prices?range=7d`);
    assert.deepEqual(data.points, []);
    assert.deepEqual([data.stats.count, data.stats.current, data.stats.average, data.stats.change], [0, null, null, null]);
  });

  test('a back-dated record does not replace the current price or alert', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client, { currentPrice: 150, targetPrice: 120 });
    const body = await recordPrice(client, item.id, 100, { observedAt: daysAgo(10) });
    assert.equal(body.item.currentPrice, 150);
    assert.equal(body.item.lowestPrice, 100);
    assert.equal(body.notificationsCreated, 0);
  });

  test('rejects bad prices, future dates, and other currencies', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client);
    const post = (body) => client.post(`/api/watchlist/${item.id}/prices`, body);
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ price: 'abc' })).status, 400);
    assert.equal((await post({ price: -1 })).status, 400);
    assert.equal((await post({ price: 10, observedAt: new Date(Date.now() + 86400000).toISOString() })).status, 400);
    assert.equal((await post({ price: 10, observedAt: 'yesterday-ish' })).status, 400);
    assert.equal((await post({ price: 10, currency: 'EUR' })).status, 422);
    assert.equal(await t.db.collection('prices').countDocuments(), 1);
  });

  test('deleting a manual record recalculates the summary', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client, { targetPrice: null });
    const { point } = await recordPrice(client, item.id, 130);
    assert.equal((await client.del(`/api/watchlist/${item.id}/prices/${point.id}`)).status, 204);
    const after = (await client.get(`/api/watchlist/${item.id}`)).data.item;
    assert.deepEqual([after.currentPrice, after.lowestPrice, after.previousPrice], [150, 150, null]);
  });
});

describe('target-price alerts', () => {
  test('one alert when a recorded price reaches the target ($150 now, $120 target)', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client, { currentPrice: 150, targetPrice: 120 });
    await recordPrice(client, item.id, 125);
    assert.equal((await notifications(client)).items.length, 0);

    const body = await recordPrice(client, item.id, 119);
    assert.equal(body.notificationsCreated, 1);
    assert.equal(body.item.status, 'TARGET_REACHED');
    assert.equal(body.item.targetMet, true);

    const list = await notifications(client);
    assert.equal(list.unreadCount, 1);
    assert.equal(list.items[0].type, 'TARGET_REACHED');
    assert.equal(list.items[0].price, 119);
    assert.equal(list.items[0].targetPrice, 120);
    assert.equal(list.items[0].entryId, item.id);
    assert.match(list.items[0].message, /\$119\.00/);
  });

  test('no duplicate alerts while the price stays below target', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client);
    await recordPrice(client, item.id, 115);
    await recordPrice(client, item.id, 110);
    await recordPrice(client, item.id, 110);
    assert.equal((await notifications(client)).items.length, 1);
  });

  test('alerts again after the price goes back above target and drops again', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client);
    await recordPrice(client, item.id, 115);
    assert.equal((await recordPrice(client, item.id, 130)).item.status, 'WATCHING');
    await recordPrice(client, item.id, 118);
    assert.equal((await notifications(client)).items.length, 2);
  });

  test('setting a target the price already meets alerts once, and re-saving does not repeat it', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client, { currentPrice: 100, targetPrice: null });
    assert.equal((await client.patch(`/api/watchlist/${item.id}`, { targetPrice: 110 })).data.item.status, 'TARGET_REACHED');
    await client.patch(`/api/watchlist/${item.id}`, { targetPrice: 110 });
    await client.patch(`/api/watchlist/${item.id}`, { name: 'Renamed' });
    assert.equal((await notifications(client)).items.length, 1);
  });

  test('the database itself refuses a second alert for the same price event', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client);
    await recordPrice(client, item.id, 100);
    const n = await t.db.collection('notifications').findOne({});
    await assert.rejects(t.db.collection('notifications').insertOne({ userId: n.userId, dedupeKey: n.dedupeKey, type: 'TARGET_REACHED' }), (err) => err.code === 11000);
  });

  test('respects notification preferences', async () => {
    const { client } = await signUp(t.baseUrl);
    assert.equal((await client.patch('/api/account/preferences', { targetAlerts: false })).data.preferences.targetAlerts, false);
    const item = await addProduct(client);
    const body = await recordPrice(client, item.id, 100);
    assert.equal(body.item.status, 'TARGET_REACHED'); // the status still reflects the price
    assert.equal((await notifications(client)).items.length, 0);
    assert.equal((await client.patch('/api/account/preferences', { priceDropMinPercent: 0 })).status, 400);
  });

  test('saves the theme with the account, and only known themes', async () => {
    const { client } = await signUp(t.baseUrl);
    assert.equal((await client.get('/api/account/preferences')).data.preferences.theme, undefined);
    assert.equal((await client.patch('/api/account/preferences', { theme: 'dark' })).data.preferences.theme, 'dark');
    assert.equal((await client.get('/api/account/preferences')).data.preferences.theme, 'dark');
    assert.equal((await client.patch('/api/account/preferences', { theme: 'purple' })).status, 400);
  });

  test('price-drop alerts above the chosen percentage when turned on', async () => {
    const { client } = await signUp(t.baseUrl);
    await client.patch('/api/account/preferences', { priceDropAlerts: true, priceDropMinPercent: 10 });
    const item = await addProduct(client, { currentPrice: 100, targetPrice: null });
    await recordPrice(client, item.id, 95); // 5%: below the threshold
    await recordPrice(client, item.id, 80); // 15.79%
    const list = await notifications(client);
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].type, 'PRICE_DROP');
  });

  test('no alerts for products marked not interested', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client);
    await client.patch(`/api/watchlist/${item.id}`, { status: 'NOT_INTERESTED' });
    assert.equal((await recordPrice(client, item.id, 100)).item.status, 'NOT_INTERESTED');
    assert.equal((await notifications(client)).items.length, 0);
  });

  test('mark read and unread, mark all read, and delete', async () => {
    const { client } = await signUp(t.baseUrl);
    const a = await addProduct(client, { url: 'https://n.example/a', currentPrice: 10, targetPrice: 5 });
    const b = await addProduct(client, { url: 'https://n.example/b', currentPrice: 10, targetPrice: 5 });
    await recordPrice(client, a.id, 4);
    await recordPrice(client, b.id, 4);
    const [first] = (await notifications(client)).items;
    assert.equal((await client.patch(`/api/notifications/${first.id}`, { read: true })).data.notification.read, true);
    assert.equal((await client.get('/api/notifications/unread-count')).data.unreadCount, 1);
    assert.equal((await client.get('/api/notifications?filter=unread')).data.items.length, 1);
    await client.patch(`/api/notifications/${first.id}`, { read: false });
    assert.equal((await client.post('/api/notifications/read-all')).data.updated, 2);
    assert.equal((await client.del(`/api/notifications/${first.id}`)).status, 204);
    assert.equal((await notifications(client)).items.length, 1);
    assert.equal((await client.patch(`/api/notifications/${first.id}`, { read: 'yes' })).status, 400);
  });
});

describe('prices from an automatic source', () => {
  test('stored once on the shared product and evaluated for every user watching it', async () => {
    const fake = createFakeProvider('acme-api');
    t.providers.push(fake);
    const alice = await signUp(t.baseUrl);
    const bob = await signUp(t.baseUrl);
    const url = 'https://shop.example/console';
    const a = await addProduct(alice.client, { url, currentPrice: 500, targetPrice: 450 });
    const b = await addProduct(bob.client, { url, currentPrice: undefined, targetPrice: 400 });

    const observedAt = new Date();
    fake.queue.push({ priceCents: 44900, currency: 'USD', observedAt });
    const res = await alice.client.post(`/api/watchlist/${a.id}/refresh`);
    assert.equal(res.status, 200);
    assert.equal(res.data.recorded, true);
    assert.equal(res.data.point.source, 'PROVIDER');
    assert.equal(res.data.point.providerName, 'acme-api');
    assert.equal(res.data.point.deletable, false);

    assert.equal((await notifications(alice.client)).items.length, 1); // 449 <= 450
    assert.equal((await notifications(bob.client)).items.length, 0); // 449 > 400
    assert.equal((await bob.client.get(`/api/watchlist/${b.id}`)).data.item.currentPrice, 449);

    // The same quote again is ignored.
    const product = await t.db.collection('products').findOne({});
    const again = await recordProviderQuote(t.db, product._id, 'acme-api', { priceCents: 44900, currency: 'USD', observedAt });
    assert.equal(again.created, false);
    assert.equal(await t.db.collection('prices').countDocuments({ source: 'PROVIDER' }), 1);
    assert.equal((await notifications(alice.client)).items.length, 1);

    // Shared records can't be deleted by a user.
    assert.equal((await alice.client.del(`/api/watchlist/${a.id}/prices/${res.data.point.id}`)).status, 403);
  });

  test('503 with no source configured, 502 when the source fails, and nothing recorded either way', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client);
    const none = await client.post(`/api/watchlist/${item.id}/refresh`);
    assert.equal(none.status, 503);
    assert.equal(none.data.code, 'PROVIDER_UNAVAILABLE');

    const fake = createFakeProvider();
    fake.queue.push(new ProviderError('fake', 'The price source could not be reached'));
    t.providers.push(fake);
    const failed = await client.post(`/api/watchlist/${item.id}/refresh`);
    assert.equal(failed.status, 502);
    assert.match(failed.data.error, /No price was recorded/);
    assert.equal(await t.db.collection('prices').countDocuments({ source: 'PROVIDER' }), 0);
  });

  test('reports whether any source is configured', async () => {
    const { client } = await signUp(t.baseUrl);
    assert.deepEqual((await client.get('/api/providers')).data, { providers: [], manualEntryOnly: true });
    t.providers.push(createFakeProvider('acme-api'));
    assert.equal((await client.get('/api/providers')).data.manualEntryOnly, false);
  });
});
