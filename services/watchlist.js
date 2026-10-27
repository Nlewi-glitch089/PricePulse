// Watch-list entries (private, per user) and the shared catalog products they point to.
//
// A product with a URL is shared: two users who add the same page (after URL
// normalization) point at the same `products` document, so prices from an
// automatic source are fetched once and both see them. Everything personal,
// such as the name a user gives it, category, target, status, notes, and the
// prices they type in, lives on their own `entries` document.

const { ACTIVE_STATUSES } = require('../lib/domain');
const { HttpError, notFound } = require('../lib/errors');
const { canonicalizeUrl } = require('../lib/money');
const { isDuplicateKeyError } = require('../database/db');
const { evaluateAndNotify, refreshEntryState } = require('./prices');
const { createLogger } = require('../lib/logger');

const log = createLogger('Watchlist');

const EMPTY_SUMMARY = {
  currentPriceCents: null,
  previousPriceCents: null,
  firstPriceCents: null,
  lowestPriceCents: null,
  highestPriceCents: null,
  totalChangeCents: null,
  lastPriceAt: null,
  lastPriceChangeAt: null,
  changeFromPriceCents: null,
};

const duplicateError = (existingId) =>
  new HttpError(409, 'This product is already in your collection.', { code: 'DUPLICATE_PRODUCT', details: { existingId: String(existingId) } });

// The entry with its product and purchase attached, or a 404 if it isn't this user's.
async function getOwnedEntry(db, userId, entryId) {
  const entry = await db.collection('entries').findOne({ _id: entryId, userId });
  if (!entry) throw notFound('Product'); // 404, not 403, so other users' ids can't be probed
  const [product, purchase] = await Promise.all([
    db.collection('products').findOne({ _id: entry.productId }),
    db.collection('purchases').findOne({ entryId: entry._id }),
  ]);
  return { ...entry, product, purchase };
}

// Remove a catalog product (and its shared provider prices) once nobody tracks it.
async function deleteIfOrphaned(db, productId) {
  const remaining = await db.collection('entries').countDocuments({ productId }, { limit: 1 });
  if (remaining === 0) {
    await db.collection('products').deleteOne({ _id: productId });
    await db.collection('prices').deleteMany({ productId });
  }
}

// Find the shared product for a URL or create it. Without a URL, every product is private.
async function resolveProduct(db, { url, retailer, currency }) {
  const products = db.collection('products');
  if (!url) {
    const doc = { canonicalUrl: null, retailer, currency, createdAt: new Date() };
    const { insertedId } = await products.insertOne(doc);
    return { product: { ...doc, _id: insertedId }, created: true };
  }
  const canonicalUrl = canonicalizeUrl(url);
  let product = await products.findOne({ canonicalUrl });
  let created = false;
  if (!product) {
    const doc = { canonicalUrl, retailer, currency, createdAt: new Date() };
    try {
      const { insertedId } = await products.insertOne(doc);
      product = { ...doc, _id: insertedId };
      created = true;
    } catch (error) {
      // Someone else added the same page at the same moment; use theirs.
      if (!isDuplicateKeyError(error)) throw error;
      product = await products.findOne({ canonicalUrl });
    }
  }
  if (product.currency !== currency) {
    if (created) await products.deleteOne({ _id: product._id });
    throw new HttpError(409, `This product page is already tracked in ${product.currency}. Choose ${product.currency} to track it.`, {
      fields: { currency: `Use ${product.currency} for this product.` },
    });
  }
  return { product, created };
}

async function createEntry(db, userId, input) {
  const { product, created } = await resolveProduct(db, input);
  const entries = db.collection('entries');

  const cleanupNewProduct = () => (created ? db.collection('products').deleteOne({ _id: product._id }) : null);

  const sameProduct = await entries.findOne({ userId, productId: product._id }, { projection: { _id: 1 } });
  if (sameProduct) {
    throw duplicateError(sameProduct._id);
  }

  // Without a URL we can't be sure two entries are the same item, so warn and let the user override.
  if (!input.url && !input.allowDuplicate) {
    const productIds = await db
      .collection('products')
      .find({ retailer: input.retailer, _id: { $ne: product._id } }, { projection: { _id: 1 } })
      .map((p) => p._id)
      .toArray();
    const lower = input.name.toLowerCase();
    const candidates = await entries.find({ userId, productId: { $in: productIds } }, { projection: { name: 1 } }).toArray();
    const match = candidates.find((c) => c.name.toLowerCase() === lower);
    if (match) {
      await cleanupNewProduct();
      throw duplicateError(match._id);
    }
  }

  const now = new Date();
  const doc = {
    userId,
    productId: product._id,
    name: input.name,
    description: input.description ?? null,
    imageUrl: input.imageUrl ?? null,
    category: input.category,
    notes: input.notes ?? null,
    status: 'WATCHING',
    targetPriceCents: input.targetPriceCents ?? null,
    listPriceCents: input.listPriceCents ?? null,
    targetMetAt: null,
    ...EMPTY_SUMMARY,
    createdAt: now,
    updatedAt: now,
  };
  let entryId;
  try {
    ({ insertedId: entryId } = await entries.insertOne(doc));
  } catch (error) {
    await cleanupNewProduct();
    if (isDuplicateKeyError(error)) {
      const existing = await entries.findOne({ userId, productId: product._id }, { projection: { _id: 1 } });
      throw duplicateError(existing ? existing._id : '');
    }
    throw error;
  }

  let pointId;
  if (input.currentPriceCents != null) {
    ({ insertedId: pointId } = await db.collection('prices').insertOne({
      entryId,
      productId: null,
      priceCents: input.currentPriceCents,
      currency: product.currency,
      source: 'MANUAL',
      providerName: null,
      note: 'Price when added',
      observedAt: now,
      createdAt: now,
    }));
  }
  // Also picks up any provider history the shared product already has.
  await refreshEntryState(db, entryId, 'new-price', pointId);
  log.info('Watch-list entry created', { userId, entryId, sharedProduct: !created });
  return getOwnedEntry(db, userId, entryId);
}

async function updateEntry(db, userId, entryId, input) {
  const entries = db.collection('entries');
  const entry = await entries.findOne({ _id: entryId, userId });
  if (!entry) throw notFound('Product');
  const product = await db.collection('products').findOne({ _id: entry.productId });

  let productId = entry.productId;
  let relinked = false;

  const newCanonical = input.url === undefined ? undefined : input.url ? canonicalizeUrl(input.url) : null;
  const urlChanged = newCanonical !== undefined && newCanonical !== (product.canonicalUrl ?? null);
  const retailerChanged = input.retailer !== undefined && input.retailer !== product.retailer;

  if (input.status !== undefined && input.status !== entry.status && entry.status === 'PURCHASED') {
    throw new HttpError(409, 'This product is marked as purchased. Undo the purchase to watch it again.');
  }

  if (urlChanged) {
    const { product: target, created } = await resolveProduct(db, {
      url: input.url,
      retailer: input.retailer ?? product.retailer,
      currency: product.currency,
    });
    const clash = await entries.findOne({ userId, productId: target._id, _id: { $ne: entry._id } }, { projection: { _id: 1 } });
    if (clash) {
      if (created) await db.collection('products').deleteOne({ _id: target._id });
      throw duplicateError(clash._id);
    }
    productId = target._id;
    relinked = true;
  } else if (retailerChanged) {
    // Editing a shared catalog record would change it for other users.
    const watchers = await entries.countDocuments({ productId: entry.productId }, { limit: 2 });
    if (watchers > 1) {
      throw new HttpError(409, 'Other people also track this product page, so its retailer can’t be changed. Change the product URL instead.', {
        fields: { retailer: 'Shared with other users; change the URL instead.' },
      });
    }
    await db.collection('products').updateOne({ _id: entry.productId }, { $set: { retailer: input.retailer } });
  }

  const targetChanged = input.targetPriceCents !== undefined && input.targetPriceCents !== (entry.targetPriceCents ?? null);
  // Asking to "watch" an item that's already at target is not a change.
  const statusChanged =
    input.status !== undefined && input.status !== entry.status && !(input.status === 'WATCHING' && entry.status === 'TARGET_REACHED');

  const set = { productId, updatedAt: new Date() };
  for (const field of ['name', 'description', 'imageUrl', 'category', 'notes', 'targetPriceCents', 'listPriceCents']) {
    if (input[field] !== undefined) set[field] = input[field];
  }
  if (statusChanged) set.status = input.status;
  // A new target (or re-activating) starts a fresh alert episode.
  if (targetChanged || statusChanged) set.targetMetAt = null;

  const updated = await entries.findOneAndUpdate({ _id: entry._id, userId }, { $set: set }, { returnDocument: 'after' });
  if (relinked) await deleteIfOrphaned(db, entry.productId);

  if (relinked) await refreshEntryState(db, entry._id, 'settings');
  else if (targetChanged || statusChanged) await evaluateAndNotify(db, updated, 'settings');

  log.info('Watch-list entry updated', { userId, entryId, fields: Object.keys(input) });
  return getOwnedEntry(db, userId, entryId);
}

async function deleteEntry(db, userId, entryId) {
  const entry = await db.collection('entries').findOneAndDelete({ _id: entryId, userId });
  if (!entry) throw notFound('Product');
  // MongoDB has no cascades: clean up what belonged to this entry.
  await Promise.all([
    db.collection('prices').deleteMany({ entryId: entry._id }),
    db.collection('notifications').updateMany({ entryId: entry._id }, { $set: { entryId: null } }),
    // The purchase record stays on the Purchases page.
    db.collection('purchases').updateMany({ entryId: entry._id }, { $set: { entryId: null } }),
  ]);
  await deleteIfOrphaned(db, entry.productId);
  log.info('Watch-list entry deleted', { userId, entryId });
}

// Records what the user paid; alerts stop for the entry.
async function recordPurchase(db, userId, entryId, { priceCents, purchasedAt, retailer, notes }) {
  const entry = await getOwnedEntry(db, userId, entryId);
  if (entry.purchase) throw new HttpError(409, 'This product is already marked as purchased.');
  await db.collection('purchases').insertOne({
    userId,
    entryId: entry._id,
    productName: entry.name, // kept so the record still reads well if the entry is removed
    priceCents,
    currency: entry.product.currency,
    retailer: retailer || entry.product.retailer,
    purchasedAt,
    notes: notes ?? null,
    createdAt: new Date(),
  });
  await db.collection('entries').updateOne({ _id: entry._id, userId }, { $set: { status: 'PURCHASED', targetMetAt: null, updatedAt: new Date() } });
  log.info('Product marked as purchased', { userId, entryId });
  return getOwnedEntry(db, userId, entryId);
}

// ---------------------------------------------------------------------------
// Listing: search, filters, sorting, pagination in one aggregation.
// ---------------------------------------------------------------------------

const SORT_FIELDS = ['name', 'price', 'target', 'recent_change', 'added', 'drop'];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function buildMatch(userId, { q, category, status, target }) {
  const match = { userId };
  if (q) match.name = { $regex: escapeRegex(q), $options: 'i' };
  if (category) match.category = category;
  if (status === 'active') match.status = { $in: ACTIVE_STATUSES };
  else if (status && status !== 'all') match.status = status;

  const hasTarget = { $ne: [{ $ifNull: ['$targetPriceCents', null] }, null] };
  const hasPrice = { $ne: [{ $ifNull: ['$currentPriceCents', null] }, null] };
  if (target === 'met') {
    match.$expr = { $and: [hasTarget, hasPrice, { $lte: ['$currentPriceCents', '$targetPriceCents'] }] };
  } else if (target === 'unmet') {
    match.$expr = { $and: [hasTarget, { $or: [{ $not: [hasPrice] }, { $gt: ['$currentPriceCents', '$targetPriceCents'] }] }] };
  } else if (target === 'none') {
    match.$expr = { $not: [hasTarget] };
  }
  return match;
}

// Sort with missing values last in either direction (MongoDB puts nulls first by default).
function sortStages(sort, order) {
  const dir = order === 'asc' ? 1 : -1;
  const field = {
    name: 'nameLower',
    price: 'currentPriceCents',
    target: 'targetPriceCents',
    recent_change: 'lastPriceChangeAt',
    drop: 'totalChangeCents',
    added: 'createdAt',
  }[sort];
  // "Biggest drop" first means the most negative change first.
  const fieldDir = sort === 'drop' ? -dir : dir;
  return [
    {
      $addFields: {
        nameLower: { $toLower: '$name' },
        missing: { $cond: [{ $eq: [{ $ifNull: [`$${field}`, null] }, null] }, 1, 0] },
      },
    },
    { $sort: { missing: 1, [field]: fieldDir, createdAt: -1, _id: 1 } },
  ];
}

async function listEntries(db, userId, query) {
  const pipeline = [
    { $match: buildMatch(userId, query) },
    { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product' } },
    { $unwind: '$product' },
  ];
  if (query.retailer) pipeline.push({ $match: { 'product.retailer': query.retailer } });
  pipeline.push({
    $facet: {
      total: [{ $count: 'n' }],
      items: [
        ...sortStages(query.sort, query.order),
        { $skip: (query.page - 1) * query.pageSize },
        { $limit: query.pageSize },
        { $lookup: { from: 'purchases', localField: '_id', foreignField: 'entryId', as: 'purchase' } },
        { $addFields: { purchase: { $first: '$purchase' } } },
      ],
    },
  });
  const [result] = await db.collection('entries').aggregate(pipeline).toArray();
  return { items: result.items, total: result.total[0] ? result.total[0].n : 0 };
}

async function getFacets(db, userId) {
  const entries = db.collection('entries');
  const [categories, retailers, statuses] = await Promise.all([
    entries.aggregate([{ $match: { userId } }, { $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray(),
    entries
      .aggregate([
        { $match: { userId } },
        { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product' } },
        { $unwind: '$product' },
        { $group: { _id: '$product.retailer' } },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
    entries.aggregate([{ $match: { userId } }, { $group: { _id: '$status', count: { $sum: 1 } } }]).toArray(),
  ]);
  return {
    categories: categories.map((c) => ({ value: c._id, count: c.count })),
    retailers: retailers.map((r) => r._id),
    statusCounts: Object.fromEntries(statuses.map((s) => [s._id, s.count])),
  };
}

// Attach products (and purchases) to a list of entries in two queries.
async function withProducts(db, entries, { purchases = true } = {}) {
  if (!entries.length) return [];
  const [products, purchaseDocs] = await Promise.all([
    db.collection('products').find({ _id: { $in: entries.map((e) => e.productId) } }).toArray(),
    purchases ? db.collection('purchases').find({ entryId: { $in: entries.map((e) => e._id) } }).toArray() : [],
  ]);
  const productById = new Map(products.map((p) => [String(p._id), p]));
  const purchaseByEntry = new Map(purchaseDocs.map((p) => [String(p.entryId), p]));
  return entries.map((e) => ({ ...e, product: productById.get(String(e.productId)), purchase: purchaseByEntry.get(String(e._id)) || null }));
}

module.exports = {
  SORT_FIELDS,
  getOwnedEntry,
  createEntry,
  updateEntry,
  deleteEntry,
  recordPurchase,
  deleteIfOrphaned,
  listEntries,
  getFacets,
  withProducts,
};
