// Watch-list routes: products, price history, manual prices, refresh, and purchases.
// Every query is scoped to the logged-in user; another user's ids answer 404.
const express = require('express');
const { STATUSES, USER_SETTABLE_STATUSES, PRICE_RANGES, rangeStart } = require('../lib/domain');
const { HttpError } = require('../lib/errors');
const { fromCents } = require('../lib/money');
const { computeRangeStats } = require('../lib/priceStats');
const { validate, queryInt, queryEnum, queryText } = require('../lib/validation');
const { toObjectId } = require('../database/db');
const { userIdOf, paged } = require('./helpers');
const watchlist = require('../services/watchlist');
const prices = require('../services/prices');
const { serializeEntry, serializePricePoint } = require('../services/serializers');
const { createLogger } = require('../lib/logger');

const log = createLogger('Watchlist');

const PRODUCT_FIELDS = ['name', 'description', 'imageUrl', 'category', 'retailer', 'url', 'notes', 'targetPrice', 'listPrice'];

// Adding a product checks every field. Editing checks only the fields sent,
// but name, category, and retailer can't be blanked out. Currency is chosen
// when the product is added and doesn't change after that.
function validateProduct(body, { creating }) {
  const required = (field) => creating || (body && typeof body === 'object' && field in body);
  const v = validate(body)
    .only(creating ? [...PRODUCT_FIELDS, 'currency', 'currentPrice', 'allowDuplicate'] : [...PRODUCT_FIELDS, 'status'])
    .text('name', { label: 'Name', required: required('name'), max: 200 })
    .text('description', { label: 'Description', max: 2000 })
    .url('imageUrl', { label: 'Image URL' })
    .text('category', { label: 'Category', required: required('category'), max: 60 })
    .text('retailer', { label: 'Retailer', required: required('retailer'), max: 100 })
    .url('url', { label: 'Product URL' })
    .text('notes', { label: 'Notes', max: 2000 })
    .money('targetPrice', { label: 'Target price', nullable: true })
    .money('listPrice', { label: 'List price', nullable: true });
  if (creating) v.currency('currency', { required: true }).money('currentPrice', { label: 'Current price' }).boolean('allowDuplicate');
  else v.oneOf('status', USER_SETTABLE_STATUSES, { label: 'Status' });
  const out = v.done();
  if ('targetPrice' in out) {
    out.targetPriceCents = out.targetPrice;
    delete out.targetPrice;
  }
  if ('listPrice' in out) {
    out.listPriceCents = out.listPrice;
    delete out.listPrice;
  }
  if ('currentPrice' in out) {
    out.currentPriceCents = out.currentPrice;
    delete out.currentPrice;
  }
  return out;
}

function watchlistRoutes({ db, providers }) {
  const router = express.Router();
  const entryIdOf = (req) => toObjectId(req.params.id, 'Product');

  router.get('/', async (req, res) => {
    const q = req.query;
    const query = {
      q: queryText(q.q),
      category: queryText(q.category, { max: 60 }),
      retailer: queryText(q.retailer, { max: 100 }),
      status: queryEnum(q.status, { name: 'status', allowed: ['active', 'all', ...STATUSES], fallback: 'active' }),
      target: queryEnum(q.target, { name: 'target', allowed: ['any', 'met', 'unmet', 'none'], fallback: 'any' }),
      sort: queryEnum(q.sort, { name: 'sort', allowed: watchlist.SORT_FIELDS, fallback: 'added' }),
      order: queryEnum(q.order, { name: 'order', allowed: ['asc', 'desc'], fallback: 'desc' }),
      page: queryInt(q.page, { name: 'page', min: 1, max: 100000, fallback: 1 }),
      pageSize: queryInt(q.pageSize, { name: 'pageSize', min: 1, max: 100, fallback: 12 }),
    };
    const { items, total } = await watchlist.listEntries(db, userIdOf(req), query);
    res.json(paged(items.map(serializeEntry), { ...query, total }));
  });

  router.get('/facets', async (req, res) => {
    res.json(await watchlist.getFacets(db, userIdOf(req)));
  });

  router.post('/', async (req, res) => {
    res.locals.operation = 'add product';
    const input = validateProduct(req.body, { creating: true });
    const entry = await watchlist.createEntry(db, userIdOf(req), input);
    res.status(201).json({ item: serializeEntry(entry) });
  });

  router.get('/:id', async (req, res) => {
    res.json({ item: serializeEntry(await watchlist.getOwnedEntry(db, userIdOf(req), entryIdOf(req))) });
  });

  router.patch('/:id', async (req, res) => {
    res.locals.operation = 'update product';
    const entryId = entryIdOf(req);
    const input = validateProduct(req.body, { creating: false });
    res.json({ item: serializeEntry(await watchlist.updateEntry(db, userIdOf(req), entryId, input)) });
  });

  router.delete('/:id', async (req, res) => {
    res.locals.operation = 'delete product';
    await watchlist.deleteEntry(db, userIdOf(req), entryIdOf(req));
    res.status(204).end();
  });

  // ---- price history -------------------------------------------------------

  router.get('/:id/prices', async (req, res) => {
    const range = queryEnum(req.query.range, { name: 'range', allowed: Object.keys(PRICE_RANGES), fallback: 'all' });
    const entry = await watchlist.getOwnedEntry(db, userIdOf(req), entryIdOf(req));
    const from = rangeStart(range);
    const filter = { $and: [prices.visiblePricesFilter(entry), ...(from ? [{ observedAt: { $gte: from } }] : [])] };
    const points = await db.collection('prices').find(filter).sort({ observedAt: 1, _id: 1 }).toArray();
    const s = computeRangeStats(points);
    res.json({
      range,
      from: from ? from.toISOString() : null,
      currency: entry.product.currency,
      points: points.map(serializePricePoint),
      stats: {
        count: s.count,
        current: fromCents(s.currentCents),
        lowest: fromCents(s.lowestCents),
        highest: fromCents(s.highestCents),
        average: fromCents(s.averageCents),
        first: fromCents(s.firstCents),
        change: fromCents(s.changeCents),
        changePercent: s.changePercent,
        firstObservedAt: s.firstObservedAt ? s.firstObservedAt.toISOString() : null,
        lastObservedAt: s.lastObservedAt ? s.lastObservedAt.toISOString() : null,
      },
    });
  });

  router.post('/:id/prices', async (req, res) => {
    res.locals.operation = 'record price';
    const entryId = entryIdOf(req);
    const input = validate(req.body)
      .only(['price', 'currency', 'observedAt', 'note'])
      .money('price', { label: 'Price', required: true })
      .currency('currency')
      .pastDate('observedAt', { label: 'Date' })
      .text('note', { label: 'Note', max: 500 })
      .done();
    const userId = userIdOf(req);
    const result = await prices.recordManualPrice(db, userId, entryId, {
      priceCents: input.price,
      currency: input.currency,
      observedAt: input.observedAt,
      note: input.note,
    });
    const entry = await watchlist.getOwnedEntry(db, userId, entryId);
    res.status(201).json({
      point: serializePricePoint(result.point),
      item: serializeEntry(entry),
      notificationsCreated: result.createdNotifications,
    });
  });

  router.delete('/:id/prices/:pointId', async (req, res) => {
    res.locals.operation = 'delete price record';
    await prices.deleteManualPrice(db, userIdOf(req), entryIdOf(req), toObjectId(req.params.pointId, 'Price record'));
    res.status(204).end();
  });

  router.post('/:id/refresh', async (req, res) => {
    res.locals.operation = 'check price from provider';
    const userId = userIdOf(req);
    const entryId = entryIdOf(req);
    const entry = await watchlist.getOwnedEntry(db, userId, entryId);
    const result = await prices.refreshProductPrice(db, providers, entry.product);
    res.json({
      provider: result.provider,
      recorded: result.created,
      point: serializePricePoint(result.point),
      item: serializeEntry(await watchlist.getOwnedEntry(db, userId, entryId)),
    });
  });

  // ---- purchase ----------------------------------------------------------

  router.post('/:id/purchase', async (req, res) => {
    res.locals.operation = 'record purchase';
    const userId = userIdOf(req);
    const entryId = entryIdOf(req);
    const input = validate(req.body)
      .only(['price', 'purchasedAt', 'retailer', 'notes'])
      .money('price', { label: 'Price paid', required: true })
      .pastDate('purchasedAt', { label: 'Purchase date', required: true })
      .text('retailer', { label: 'Retailer', max: 100 })
      .text('notes', { label: 'Notes', max: 2000 })
      .done();
    const item = await watchlist.recordPurchase(db, userId, entryId, { priceCents: input.price, purchasedAt: input.purchasedAt, retailer: input.retailer, notes: input.notes });
    res.status(201).json({ item: serializeEntry(item) });
  });

  router.delete('/:id/purchase', async (req, res) => {
    res.locals.operation = 'undo purchase';
    const userId = userIdOf(req);
    const entryId = entryIdOf(req);
    const entry = await watchlist.getOwnedEntry(db, userId, entryId);
    if (!entry.purchase) throw new HttpError(404, 'This product has no recorded purchase.');
    await db.collection('purchases').deleteOne({ _id: entry.purchase._id, userId });
    const updated = await db
      .collection('entries')
      .findOneAndUpdate({ _id: entry._id, userId }, { $set: { status: 'WATCHING', targetMetAt: null, updatedAt: new Date() } }, { returnDocument: 'after' });
    await prices.evaluateAndNotify(db, updated, 'settings');
    log.info('Purchase undone', { userId, entryId });
    res.json({ item: serializeEntry(await watchlist.getOwnedEntry(db, userId, entryId)) });
  });

  return router;
}

module.exports = { watchlistRoutes };
