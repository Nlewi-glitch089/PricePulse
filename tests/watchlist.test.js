// Products on the watch list: create, edit, delete, duplicates, search, filters, sorting, pages.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, signUp, productInput, addProduct, recordPrice } = require('./helpers');

let t;
before(async () => {
  t = await startTestServer();
});
after(() => t.stop());
beforeEach(() => t.reset());

describe('creating, editing, and deleting products', () => {
  test('creates a product with every field and records the starting price as a manual price', async () => {
    const { client } = await signUp(t.baseUrl);
    const res = await client.post('/api/watchlist', productInput({ description: 'Over-ear, 30h battery', imageUrl: 'https://img.example/nc700.jpg', notes: 'Wait for a sale' }));
    assert.equal(res.status, 201);
    const item = res.data.item;
    assert.equal(item.name, 'Noise Cancelling Headphones');
    assert.equal(item.url, 'https://acme-audio.example/products/nc-700'); // canonical form
    assert.equal(item.currentPrice, 150);
    assert.equal(item.targetPrice, 120);
    assert.equal(item.targetMet, false);
    assert.equal(item.status, 'WATCHING');
    assert.equal(item.notes, 'Wait for a sale');
    assert.match(item.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    const prices = await t.db.collection('prices').find().toArray();
    assert.equal(prices.length, 1);
    assert.equal(prices[0].source, 'MANUAL');
    assert.equal(prices[0].priceCents, 15000);
  });

  test('a product can start without a price (no price is made up)', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client, { currentPrice: undefined });
    assert.equal(item.currentPrice, null);
    assert.equal(await t.db.collection('prices').countDocuments(), 0);
  });

  test('validates input on the server', async () => {
    const { client } = await signUp(t.baseUrl);
    const res = await client.post('/api/watchlist', {
      name: '',
      category: 'x'.repeat(61),
      retailer: 'R',
      url: 'javascript:alert(1)',
      imageUrl: 'not a url',
      currency: 'DOGE',
      currentPrice: -5,
      targetPrice: 1.234,
    });
    assert.equal(res.status, 400);
    assert.deepEqual(Object.keys(res.data.fields).sort(), ['category', 'currency', 'currentPrice', 'imageUrl', 'name', 'targetPrice', 'url']);
  });

  test('catches duplicates by URL, and warns about same name + retailer without a URL', async () => {
    const { client } = await signUp(t.baseUrl);
    const first = await addProduct(client);
    const dup = await client.post('/api/watchlist', productInput({ url: 'https://acme-audio.example/products/nc-700/#top' }));
    assert.equal(dup.status, 409);
    assert.equal(dup.data.code, 'DUPLICATE_PRODUCT');
    assert.equal(dup.data.details.existingId, first.id);

    const noUrl = { url: '', name: 'Desk Lamp', retailer: 'Lamps Inc' };
    await addProduct(client, noUrl);
    const warn = await client.post('/api/watchlist', productInput({ ...noUrl, name: 'desk lamp' }));
    assert.equal(warn.status, 409);
    const allowed = await client.post('/api/watchlist', productInput({ ...noUrl, allowDuplicate: true }));
    assert.equal(allowed.status, 201);
    // The rejected attempt didn't leave an orphan catalog product behind.
    assert.equal(await t.db.collection('products').countDocuments(), 3);
  });

  test('updates fields and the target price, and can clear the target', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client);
    const res = await client.patch(`/api/watchlist/${item.id}`, { name: 'NC 700', category: 'Electronics', targetPrice: 140, notes: '' });
    assert.equal(res.status, 200);
    assert.equal(res.data.item.name, 'NC 700');
    assert.equal(res.data.item.category, 'Electronics');
    assert.equal(res.data.item.targetPrice, 140);
    assert.equal(res.data.item.notes, null);
    assert.equal((await client.patch(`/api/watchlist/${item.id}`, { targetPrice: null })).data.item.targetPrice, null);
  });

  test('a list price is kept apart from recorded prices, and the discount is calculated from both', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client, { listPrice: 200 }); // current price 150
    assert.equal(item.listPrice, 200);
    assert.deepEqual(item.listDiscount, { amount: 50, percent: 25 });
    assert.equal(item.firstPrice, 150); // the list price never enters the history
    assert.equal(await t.db.collection('prices').countDocuments(), 1);

    // Above the list price: a negative "discount".
    const higher = (await client.patch(`/api/watchlist/${item.id}`, { listPrice: 120 })).data.item;
    assert.deepEqual(higher.listDiscount, { amount: -30, percent: -25 });
    // Unknown list price, or no recorded price: no discount at all.
    assert.equal((await client.patch(`/api/watchlist/${item.id}`, { listPrice: null })).data.item.listDiscount, null);
    const noPrice = await addProduct(client, { name: 'Other', currentPrice: undefined, listPrice: 99, url: undefined });
    assert.equal(noPrice.listDiscount, null);
    assert.equal((await client.patch(`/api/watchlist/${item.id}`, { listPrice: -5 })).status, 400);
  });

  test('rejects unknown fields, blank required fields, and statuses users may not set', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client);
    assert.equal((await client.patch(`/api/watchlist/${item.id}`, { userId: 'someone-else' })).status, 400);
    assert.equal((await client.patch(`/api/watchlist/${item.id}`, { name: '   ' })).status, 400);
    assert.equal((await client.patch(`/api/watchlist/${item.id}`, { status: 'TARGET_REACHED' })).status, 400);
    assert.equal((await client.patch(`/api/watchlist/${item.id}`, { status: 'NOT_INTERESTED' })).status, 200);
  });

  test('changing the URL moves the entry to that catalog product and keeps your prices', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client, { url: 'https://a.example/1' });
    const res = await client.patch(`/api/watchlist/${item.id}`, { url: 'https://a.example/2' });
    assert.equal(res.status, 200);
    assert.equal(res.data.item.url, 'https://a.example/2');
    assert.equal(res.data.item.currentPrice, 150);
    assert.equal(await t.db.collection('products').countDocuments(), 1); // old one cleaned up
  });

  test('currency is set when a product is added and cannot be edited', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client);
    const res = await client.patch(`/api/watchlist/${item.id}`, { currency: 'EUR' });
    assert.equal(res.status, 400);
    assert.ok(res.data.fields.currency);
    assert.equal((await client.get(`/api/watchlist/${item.id}`)).data.item.currency, 'USD');
  });

  test('deleting removes the entry and its private prices', async () => {
    const { client } = await signUp(t.baseUrl);
    const item = await addProduct(client);
    await recordPrice(client, item.id, 99);
    assert.equal((await client.del(`/api/watchlist/${item.id}`)).status, 204);
    assert.equal((await client.get(`/api/watchlist/${item.id}`)).status, 404);
    assert.equal(await t.db.collection('prices').countDocuments(), 0);
    assert.equal(await t.db.collection('products').countDocuments(), 0);
    // The alert it produced stays, detached from the removed product.
    const [n] = await t.db.collection('notifications').find().toArray();
    assert.equal(n.entryId, null);
  });

  test('malformed and unknown ids are 404, not server errors', async () => {
    const { client } = await signUp(t.baseUrl);
    assert.equal((await client.get('/api/watchlist/not-an-id')).status, 404);
    assert.equal((await client.get('/api/watchlist/0123456789abcdef01234567')).status, 404);
    assert.equal((await client.del('/api/watchlist/0123456789abcdef01234567')).status, 404);
  });
});

describe('search, filters, sorting, and pages', () => {
  async function seed() {
    const { client } = await signUp(t.baseUrl);
    const a = await addProduct(client, { name: 'Alpha Camera', category: 'Cameras', retailer: 'PhotoHub', url: 'https://p.example/a', currentPrice: 900, targetPrice: 800 });
    const b = await addProduct(client, { name: 'Beta Lens', category: 'Cameras', retailer: 'LensCo', url: 'https://p.example/b', currentPrice: 300, targetPrice: 350 });
    const c = await addProduct(client, { name: 'Gamma Speaker', category: 'Audio', retailer: 'PhotoHub', url: 'https://p.example/c', currentPrice: 120, targetPrice: null });
    const d = await addProduct(client, { name: 'Delta Mic', category: 'Audio', retailer: 'LensCo', url: 'https://p.example/d', currentPrice: undefined, targetPrice: 50 });
    return { client, a, b, c, d };
  }
  const names = (res) => res.data.items.map((i) => i.name);

  test('searches names without caring about case (and treats regex characters literally)', async () => {
    const { client } = await seed();
    assert.deepEqual(names(await client.get('/api/watchlist?q=CAMERA')), ['Alpha Camera']);
    assert.deepEqual(names(await client.get('/api/watchlist?q=.*')), []);
  });

  test('filters by category, retailer, status, and target status', async () => {
    const { client, c } = await seed();
    assert.deepEqual(names(await client.get('/api/watchlist?category=Audio&sort=name&order=asc')), ['Delta Mic', 'Gamma Speaker']);
    assert.deepEqual(names(await client.get('/api/watchlist?retailer=LensCo&sort=name&order=asc')), ['Beta Lens', 'Delta Mic']);
    assert.deepEqual(names(await client.get('/api/watchlist?target=met')), ['Beta Lens']);
    assert.deepEqual(names(await client.get('/api/watchlist?target=unmet&sort=name&order=asc')), ['Alpha Camera', 'Delta Mic']);
    assert.deepEqual(names(await client.get('/api/watchlist?target=none')), ['Gamma Speaker']);
    assert.deepEqual(names(await client.get('/api/watchlist?status=TARGET_REACHED')), ['Beta Lens']);

    await client.patch(`/api/watchlist/${c.id}`, { status: 'NOT_INTERESTED' });
    assert.ok(!names(await client.get('/api/watchlist')).includes('Gamma Speaker')); // default: active only
    assert.deepEqual(names(await client.get('/api/watchlist?status=NOT_INTERESTED')), ['Gamma Speaker']);
    assert.equal(names(await client.get('/api/watchlist?status=all')).length, 4);
  });

  test('sorts by name, price (no price last), and target', async () => {
    const { client } = await seed();
    assert.deepEqual(names(await client.get('/api/watchlist?sort=name&order=desc')), ['Gamma Speaker', 'Delta Mic', 'Beta Lens', 'Alpha Camera']);
    assert.deepEqual(names(await client.get('/api/watchlist?sort=price&order=asc')), ['Gamma Speaker', 'Beta Lens', 'Alpha Camera', 'Delta Mic']);
    assert.deepEqual(names(await client.get('/api/watchlist?sort=price&order=desc')), ['Alpha Camera', 'Beta Lens', 'Gamma Speaker', 'Delta Mic']);
    assert.deepEqual(names(await client.get('/api/watchlist?sort=target&order=asc')), ['Delta Mic', 'Beta Lens', 'Alpha Camera', 'Gamma Speaker']);
  });

  test('sorts by most recent price change and by biggest drop', async () => {
    const { client, a, c } = await seed();
    await recordPrice(client, c.id, 110);
    await new Promise((r) => setTimeout(r, 10));
    await recordPrice(client, a.id, 700);
    assert.deepEqual(names(await client.get('/api/watchlist?sort=recent_change&order=desc')).slice(0, 2), ['Alpha Camera', 'Gamma Speaker']);
    assert.deepEqual(names(await client.get('/api/watchlist?sort=drop&order=desc')).slice(0, 2), ['Alpha Camera', 'Gamma Speaker']);
  });

  test('pages through results and rejects bad paging or sort values', async () => {
    const { client } = await seed();
    const p1 = await client.get('/api/watchlist?sort=name&order=asc&pageSize=3&page=1');
    const p2 = await client.get('/api/watchlist?sort=name&order=asc&pageSize=3&page=2');
    assert.equal(p1.data.total, 4);
    assert.equal(p1.data.totalPages, 2);
    assert.deepEqual(names(p1), ['Alpha Camera', 'Beta Lens', 'Delta Mic']);
    assert.deepEqual(names(p2), ['Gamma Speaker']);
    assert.equal((await client.get('/api/watchlist?pageSize=1000')).status, 400);
    assert.equal((await client.get('/api/watchlist?sort=evil')).status, 400);
  });

  test('facets list your categories, retailers, and status counts', async () => {
    const { client } = await seed();
    const { data } = await client.get('/api/watchlist/facets');
    assert.deepEqual(data.categories, [
      { value: 'Audio', count: 2 },
      { value: 'Cameras', count: 2 },
    ]);
    assert.deepEqual(data.retailers, ['LensCo', 'PhotoHub']);
    assert.deepEqual(data.statusCounts, { WATCHING: 3, TARGET_REACHED: 1 });
  });
});
