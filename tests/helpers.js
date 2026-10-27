// Shared test setup: a real MongoDB server from mongodb-memory-server (started
// and thrown away per test file), the Express app on a random port, and a tiny
// HTTP client that keeps its session cookie like a browser.
//
// The first run downloads a MongoDB binary (several hundred MB). To reuse a
// mongod you already have, set MONGOMS_SYSTEM_BINARY to its path.
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-for-pricepulse';

const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApp } = require('../app');
const { connectToDatabase } = require('../database/db');

const COLLECTIONS = ['users', 'products', 'entries', 'prices', 'notifications', 'purchases', 'sessions'];

async function startTestServer() {
  const mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
  const connection = await connectToDatabase(mongo.getUri(), 'pricepulse_test');
  const providers = [];
  const app = createApp(connection.db, { providers });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    mongo,
    connection,
    db: connection.db,
    providers,
    server,
    baseUrl,
    async reset() {
      providers.length = 0;
      await Promise.all(COLLECTIONS.map((c) => connection.db.collection(c).deleteMany({})));
    },
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await connection.client.close();
      await mongo.stop();
    },
  };
}

// A tiny HTTP client that remembers its session cookie, like a browser would.
function createClient(baseUrl) {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
    set cookie(value) {
      cookie = value;
    },
    async request(method, path, body, headers = {}) {
      const h = { ...headers };
      if (cookie) h.Cookie = cookie;
      if (body !== undefined) h['Content-Type'] = 'application/json';
      const res = await fetch(baseUrl + path, {
        method,
        headers: h,
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
        redirect: 'manual',
      });
      const setCookie = res.headers.getSetCookie();
      if (setCookie.length) cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { status: res.status, data, headers: res.headers, setCookie };
    },
    get(path) {
      return this.request('GET', path);
    },
    post(path, body = {}) {
      return this.request('POST', path, body);
    },
    patch(path, body) {
      return this.request('PATCH', path, body);
    },
    del(path, body) {
      return this.request('DELETE', path, body);
    },
  };
}

let counter = 0;

// Registers a new account and returns a logged-in client.
async function signUp(baseUrl, name = 'Test User') {
  const client = createClient(baseUrl);
  const email = `user${++counter}-${Date.now()}@example.com`;
  const res = await client.post('/api/auth/register', { name, email, password: 'password123' });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.data)}`);
  return { client, user: res.data.user, email };
}

const productInput = (overrides = {}) => ({
  name: 'Noise Cancelling Headphones',
  category: 'Audio',
  retailer: 'Acme Audio',
  url: 'https://www.acme-audio.example/products/nc-700',
  currency: 'USD',
  currentPrice: 150,
  targetPrice: 120,
  ...overrides,
});

async function addProduct(client, overrides = {}) {
  const body = productInput(overrides);
  for (const [k, v] of Object.entries(body)) if (v === undefined) delete body[k];
  const res = await client.post('/api/watchlist', body);
  if (res.status !== 201) throw new Error(`add product failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data.item;
}

async function recordPrice(client, id, price, extra = {}) {
  const res = await client.post(`/api/watchlist/${id}/prices`, { price, ...extra });
  if (res.status !== 201) throw new Error(`record price failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data;
}

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

// An in-memory price source for tests; queued quotes (or Errors) are returned in order.
function createFakeProvider(name = 'fake') {
  const queue = [];
  return {
    name,
    displayName: 'Fake provider',
    queue,
    supports: (product) => Boolean(product.canonicalUrl),
    async fetchPrice() {
      const next = queue.shift();
      if (!next) throw new Error('fake provider: nothing queued');
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

module.exports = { startTestServer, createClient, signUp, productInput, addProduct, recordPrice, daysAgo, createFakeProvider };
