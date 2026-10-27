// Unit tests for the pure logic: price math, alert rules, money/URL helpers,
// validation, and the HTTP price-source adapter. No database needed.
process.env.NODE_ENV = 'test';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeSeries, computeRangeStats, percentChange } = require('../lib/priceStats');
const { evaluateEntry } = require('../lib/alertRules');
const { DEFAULT_PREFERENCES } = require('../lib/domain');
const { toCents, canonicalizeUrl } = require('../lib/money');
const { validate } = require('../lib/validation');
const { createHttpJsonProvider, ProviderError } = require('../lib/providers');

const at = (iso) => new Date(iso);

describe('summarizeSeries', () => {
  test('returns nulls for an empty history', () => {
    const s = summarizeSeries([]);
    assert.equal(s.currentPriceCents, null);
    assert.equal(s.totalChangeCents, null);
  });

  test('a single record has no change', () => {
    const s = summarizeSeries([{ priceCents: 1000, observedAt: at('2026-01-01') }]);
    assert.equal(s.currentPriceCents, 1000);
    assert.equal(s.previousPriceCents, null);
    assert.equal(s.totalChangeCents, null);
    assert.equal(s.lastPriceChangeAt, null);
  });

  test('orders by observation time, regardless of input order', () => {
    const s = summarizeSeries([
      { priceCents: 900, observedAt: at('2026-01-03') },
      { priceCents: 1200, observedAt: at('2026-01-01') },
      { priceCents: 1000, observedAt: at('2026-01-02') },
    ]);
    assert.deepEqual(
      [s.firstPriceCents, s.currentPriceCents, s.previousPriceCents, s.lowestPriceCents, s.highestPriceCents, s.totalChangeCents],
      [1200, 900, 1000, 900, 1200, -300],
    );
  });

  test('finds the most recent actual change, skipping repeated prices', () => {
    const s = summarizeSeries([
      { priceCents: 1500, observedAt: at('2026-01-01') },
      { priceCents: 1200, observedAt: at('2026-01-05') },
      { priceCents: 1200, observedAt: at('2026-01-09') },
    ]);
    assert.deepEqual(s.lastPriceChangeAt, at('2026-01-05'));
    assert.equal(s.changeFromPriceCents, 1500);
  });
});

describe('computeRangeStats', () => {
  test('current, low, high, average and change', () => {
    const s = computeRangeStats([
      { priceCents: 15000, observedAt: at('2026-01-01') },
      { priceCents: 12000, observedAt: at('2026-01-02') },
      { priceCents: 13500, observedAt: at('2026-01-03') },
    ]);
    assert.equal(s.count, 3);
    assert.equal(s.currentCents, 13500);
    assert.equal(s.lowestCents, 12000);
    assert.equal(s.highestCents, 15000);
    assert.equal(s.averageCents, 13500);
    assert.equal(s.changeCents, -1500);
    assert.equal(s.changePercent, -10);
  });

  test('no change figures with fewer than two records', () => {
    const s = computeRangeStats([{ priceCents: 999, observedAt: at('2026-01-01') }]);
    assert.equal(s.changeCents, null);
    assert.equal(s.changePercent, null);
    assert.equal(computeRangeStats([]).currentCents, null);
  });

  test('percentChange rounds to two decimals and is undefined from zero', () => {
    assert.equal(percentChange(15000, 11950), -20.33);
    assert.equal(percentChange(0, 100), null);
  });
});

describe('evaluateEntry (alert rules)', () => {
  const point = (priceCents, id = 'p1') => ({ _id: id, priceCents, observedAt: at('2026-02-01') });
  const input = (over = {}) => ({
    entry: { _id: 'e1', status: 'WATCHING', targetPriceCents: 12000, targetMetAt: null, previousPriceCents: 15000, ...over.entry },
    latestPoint: over.latestPoint === undefined ? point(11900) : over.latestPoint,
    prefs: over.prefs || DEFAULT_PREFERENCES,
    reason: over.reason || 'new-price',
  });

  test('alerts once when the price first reaches the target', () => {
    const r = evaluateEntry(input());
    assert.equal(r.status, 'TARGET_REACHED');
    assert.equal(r.alerts.length, 1);
    assert.equal(r.alerts[0].dedupeKey, 'target:e1:p1:12000');
  });

  test('a price exactly at the target counts', () => {
    assert.equal(evaluateEntry(input({ latestPoint: point(12000) })).alerts.length, 1);
  });

  test('no repeat alert while the price stays at or below target', () => {
    const r = evaluateEntry(input({ entry: { status: 'TARGET_REACHED', targetMetAt: at('2026-01-15') }, latestPoint: point(11000, 'p2') }));
    assert.equal(r.alerts.length, 0);
    assert.deepEqual(r.targetMetAt, at('2026-01-15'));
  });

  test('the episode ends when the price rises above target', () => {
    const r = evaluateEntry(input({ entry: { status: 'TARGET_REACHED', targetMetAt: at('2026-01-15') }, latestPoint: point(13000) }));
    assert.equal(r.status, 'WATCHING');
    assert.equal(r.targetMetAt, null);
  });

  test('respects the targetAlerts preference but still marks the status', () => {
    const r = evaluateEntry(input({ prefs: { ...DEFAULT_PREFERENCES, targetAlerts: false } }));
    assert.equal(r.status, 'TARGET_REACHED');
    assert.equal(r.alerts.length, 0);
  });

  test('never alerts for purchased or not-interested items, or for corrections', () => {
    for (const status of ['PURCHASED', 'NOT_INTERESTED']) {
      const r = evaluateEntry(input({ entry: { status } }));
      assert.equal(r.status, status);
      assert.equal(r.alerts.length, 0);
    }
    assert.equal(evaluateEntry(input({ reason: 'correction' })).alerts.length, 0);
  });

  test('price-drop alerts respect the threshold and only fire for new prices', () => {
    const prefs = { ...DEFAULT_PREFERENCES, targetAlerts: false, priceDropAlerts: true, priceDropMinPercent: 10 };
    const base = { prefs, entry: { targetPriceCents: null, previousPriceCents: 10000 } };
    assert.equal(evaluateEntry(input({ ...base, latestPoint: point(9000) })).alerts[0].type, 'PRICE_DROP');
    assert.equal(evaluateEntry(input({ ...base, latestPoint: point(9500) })).alerts.length, 0);
    assert.equal(evaluateEntry(input({ ...base, latestPoint: point(5000), reason: 'settings' })).alerts.length, 0);
  });
});

describe('money and URLs', () => {
  test('converts to cents without float drift', () => {
    assert.equal(toCents(19.99), 1999);
    assert.equal(toCents(0.1 + 0.2), 30);
  });

  test('canonicalizes URLs so the same page matches across users', () => {
    assert.equal(canonicalizeUrl('https://WWW.Shop.example/item/1/?utm_source=x&b=2&a=1#reviews'), 'https://shop.example/item/1?a=1&b=2');
  });
});

describe('validation', () => {
  test('collects every field problem at once', () => {
    try {
      validate({ name: '', url: 'javascript:alert(1)', currency: 'DOGE', price: 1.234, when: 'later' })
        .text('name', { label: 'Name', required: true })
        .url('url', { label: 'URL' })
        .currency('currency')
        .money('price', { label: 'Price' })
        .pastDate('when', { label: 'Date' })
        .done();
      assert.fail('should have thrown');
    } catch (err) {
      assert.equal(err.status, 400);
      assert.deepEqual(Object.keys(err.fields).sort(), ['currency', 'name', 'price', 'url', 'when']);
    }
  });

  test('rejects future dates and unknown fields', () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    assert.throws(() => validate({ d: future }).pastDate('d').done(), /need attention/);
    assert.throws(() => validate({ userId: 'x' }).only(['name']).done(), /need attention/);
  });
});

describe('HTTP JSON price source', () => {
  const product = { canonicalUrl: 'https://shop.example/item/1' };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const make = (fetchImpl) => createHttpJsonProvider({ name: 'test-api', endpoint: 'https://prices.example/lookup?u={url}', apiKey: 'k', fetchImpl });

  test('requests the encoded product URL with the API key and parses the quote', async () => {
    let seen;
    const p = make(async (url, init) => {
      seen = { url, auth: init.headers.Authorization };
      return json({ price: 129.99, currency: 'usd', observedAt: '2026-03-01T10:00:00Z' });
    });
    const quote = await p.fetchPrice(product);
    assert.deepEqual(quote, { priceCents: 12999, currency: 'USD', observedAt: new Date('2026-03-01T10:00:00Z') });
    assert.equal(seen.url, 'https://prices.example/lookup?u=https%3A%2F%2Fshop.example%2Fitem%2F1');
    assert.equal(seen.auth, 'Bearer k');
  });

  test('fails clearly, and never invents a price, on bad responses', async () => {
    const cases = [
      async () => json({}, 404),
      async () => json({ error: 'boom' }, 500),
      async () => new Response('not json', { status: 200 }),
      async () => json({ price: 'cheap', currency: 'USD' }),
      async () => {
        throw new TypeError('fetch failed');
      },
    ];
    for (const impl of cases) {
      await assert.rejects(make(impl).fetchPrice(product), ProviderError);
    }
  });

  test('only supports products that have a URL', () => {
    const p = make(fetch);
    assert.equal(p.supports(product), true);
    assert.equal(p.supports({ canonicalUrl: null }), false);
  });
});
