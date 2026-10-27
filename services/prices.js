// Recording prices, keeping each entry's price summary current, and creating alerts.
//
// Which prices an entry can see: its own manual prices (entryId) plus the
// shared provider prices of its product (productId). Never another user's
// manual prices.

const { ACTIVE_STATUSES, DEFAULT_PREFERENCES } = require('../lib/domain');
const { evaluateEntry } = require('../lib/alertRules');
const { summarizeSeries } = require('../lib/priceStats');
const { formatMoney } = require('../lib/money');
const { HttpError, notFound } = require('../lib/errors');
const { isDuplicateKeyError } = require('../database/db');
const { ProviderError } = require('../lib/providers');
const { createLogger } = require('../lib/logger');

const log = createLogger('Prices');

function visiblePricesFilter(entry) {
  return { $or: [{ entryId: entry._id }, { productId: entry.productId }] };
}

// Newest first; ties broken by insertion order (ObjectIds increase over time).
const NEWEST_FIRST = { observedAt: -1, _id: -1 };
const OLDEST_FIRST = { observedAt: 1, _id: 1 };

async function latestVisiblePoint(db, entry) {
  return db.collection('prices').findOne(visiblePricesFilter(entry), { sort: NEWEST_FIRST });
}

async function userPreferences(db, userId) {
  const user = await db.collection('users').findOne({ _id: userId }, { projection: { preferences: 1 } });
  return { ...DEFAULT_PREFERENCES, ...(user && user.preferences) };
}

// Rebuild the cached price summary on an entry from its visible history.
async function recomputeEntry(db, entryId) {
  const entry = await db.collection('entries').findOne({ _id: entryId });
  if (!entry) return null;
  const points = await db
    .collection('prices')
    .find(visiblePricesFilter(entry), { projection: { priceCents: 1, observedAt: 1 } })
    .sort(OLDEST_FIRST)
    .toArray();
  return db
    .collection('entries')
    .findOneAndUpdate({ _id: entryId }, { $set: summarizeSeries(points) }, { returnDocument: 'after' });
}

// Apply the target/drop rules to an entry whose summary is current, save the
// derived status, and create any new notifications. Duplicate notifications are
// impossible: the unique (userId, dedupeKey) index rejects them.
async function evaluateAndNotify(db, entry, reason) {
  const latest = await latestVisiblePoint(db, entry);
  const prefs = await userPreferences(db, entry.userId);
  const result = evaluateEntry({ entry, latestPoint: latest, prefs, reason });

  let updated = entry;
  const metChanged = (result.targetMetAt ? result.targetMetAt.getTime() : null) !== (entry.targetMetAt ? new Date(entry.targetMetAt).getTime() : null);
  if (result.status !== entry.status || metChanged) {
    // Only touch entries that are still active, so a purchase made at the same
    // moment is never overwritten.
    updated =
      (await db.collection('entries').findOneAndUpdate(
        { _id: entry._id, status: { $in: ACTIVE_STATUSES } },
        { $set: { status: result.status, targetMetAt: result.targetMetAt } },
        { returnDocument: 'after' },
      )) || entry;
  }

  let created = 0;
  if (result.alerts.length) {
    const product = await db.collection('products').findOne({ _id: entry.productId });
    const currency = product ? product.currency : 'USD';
    for (const alert of result.alerts) {
      const price = formatMoney(alert.priceCents, currency);
      const text =
        alert.type === 'TARGET_REACHED'
          ? {
              title: `Target price reached: ${entry.name}`,
              message: `${entry.name} was recorded at ${price}, at or below your target of ${formatMoney(alert.targetPriceCents, currency)}.`,
            }
          : {
              title: `Price drop: ${entry.name}`,
              message: `${entry.name} dropped ${alert.dropPercent}% from ${formatMoney(alert.previousPriceCents, currency)} to ${price}.`,
            };
      try {
        await db.collection('notifications').insertOne({
          userId: entry.userId,
          entryId: entry._id,
          type: alert.type,
          ...text,
          priceCents: alert.priceCents,
          targetPriceCents: alert.targetPriceCents,
          currency,
          pricePointId: alert.pricePointId,
          dedupeKey: alert.dedupeKey,
          readAt: null,
          createdAt: new Date(),
        });
        created++;
        log.info('Notification created', { userId: entry.userId, entryId: entry._id, type: alert.type });
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        log.debug('Alert already exists for this price event; skipped', { entryId: entry._id, dedupeKey: alert.dedupeKey });
      }
    }
  }
  return { entry: updated, createdNotifications: created };
}

// Recompute, then evaluate. `newPointId` marks which record was just added:
// it only counts as a new price if it became the latest one.
async function refreshEntryState(db, entryId, reason, newPointId) {
  const recomputed = await recomputeEntry(db, entryId);
  if (!recomputed) return { entry: null, createdNotifications: 0 };
  let finalReason = reason;
  if (reason === 'new-price' && newPointId) {
    const latest = await latestVisiblePoint(db, recomputed);
    finalReason = latest && String(latest._id) === String(newPointId) ? 'new-price' : 'correction';
  }
  return evaluateAndNotify(db, recomputed, finalReason);
}

async function findOwnedEntry(db, userId, entryId) {
  const entry = await db.collection('entries').findOne({ _id: entryId, userId });
  if (!entry) throw notFound('Product');
  return entry;
}

// A price the user observed themselves. Visible only to that user.
async function recordManualPrice(db, userId, entryId, { priceCents, currency, observedAt, note }) {
  const entry = await findOwnedEntry(db, userId, entryId);
  const product = await db.collection('products').findOne({ _id: entry.productId });
  const useCurrency = currency || product.currency;
  if (useCurrency !== product.currency) {
    throw new HttpError(422, `This product is tracked in ${product.currency}. Record prices in the same currency.`, {
      fields: { currency: `Use ${product.currency}.` },
    });
  }
  const point = {
    entryId: entry._id,
    productId: null,
    priceCents,
    currency: useCurrency,
    source: 'MANUAL',
    providerName: null,
    note: note ?? null,
    observedAt: observedAt || new Date(),
    createdAt: new Date(),
  };
  const { insertedId } = await db.collection('prices').insertOne(point);
  point._id = insertedId;
  const { entry: updated, createdNotifications } = await refreshEntryState(db, entry._id, 'new-price', insertedId);
  log.info('Manual price recorded', { userId, entryId: entry._id, pointId: insertedId });
  return { point, entry: updated, product, createdNotifications };
}

// Users can delete their own manual records; shared provider records can't be deleted.
async function deleteManualPrice(db, userId, entryId, pointId) {
  const entry = await findOwnedEntry(db, userId, entryId);
  const point = await db.collection('prices').findOne({ _id: pointId, ...visiblePricesFilter(entry) });
  if (!point) throw notFound('Price record');
  if (point.source !== 'MANUAL') {
    throw new HttpError(403, 'Prices from an automatic source are shared and can’t be deleted.');
  }
  await db.collection('prices').deleteOne({ _id: point._id, entryId: entry._id });
  await refreshEntryState(db, entry._id, 'correction');
  log.info('Manual price deleted', { userId, entryId: entry._id, pointId });
}

// A price from a configured provider, stored on the shared product. Every user
// watching the product is re-evaluated. The same quote twice is stored once.
async function recordProviderQuote(db, productId, providerName, { priceCents, currency, observedAt }) {
  const product = await db.collection('products').findOne({ _id: productId });
  if (!product) throw notFound('Product');
  if (currency !== product.currency) {
    throw new HttpError(502, `The price source returned ${currency}, but this product is tracked in ${product.currency}. No price was recorded.`);
  }
  const point = {
    productId,
    entryId: null,
    priceCents,
    currency,
    source: 'PROVIDER',
    providerName,
    note: null,
    observedAt,
    createdAt: new Date(),
  };
  let created = true;
  try {
    const { insertedId } = await db.collection('prices').insertOne(point);
    point._id = insertedId;
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    created = false;
    Object.assign(point, await db.collection('prices').findOne({ productId, providerName, observedAt, source: 'PROVIDER' }));
  }

  let createdNotifications = 0;
  const entries = await db.collection('entries').find({ productId }, { projection: { _id: 1 } }).toArray();
  if (created) {
    for (const { _id } of entries) {
      const res = await refreshEntryState(db, _id, 'new-price', point._id);
      createdNotifications += res.createdNotifications;
    }
  }
  log.info('Provider price recorded', { productId, providerName, created, entries: entries.length, createdNotifications });
  return { point, created, createdNotifications };
}

// "Check price now": ask the first provider that supports this product.
async function refreshProductPrice(db, providers, product) {
  const provider = providers.find((p) => p.supports(product));
  if (!provider) {
    throw new HttpError(503, 'No automatic price source is set up for this product. Record the price yourself instead.', {
      code: 'PROVIDER_UNAVAILABLE',
    });
  }
  let quote;
  try {
    quote = await provider.fetchPrice(product);
  } catch (error) {
    if (error instanceof ProviderError) {
      log.warn('Price source failed', { productId: product._id, provider: provider.name, reason: error.message });
      throw new HttpError(502, `${error.message}. No price was recorded.`, { code: 'PROVIDER_ERROR' });
    }
    throw error;
  }
  const result = await recordProviderQuote(db, product._id, provider.name, quote);
  return { provider: provider.name, ...result };
}

module.exports = {
  visiblePricesFilter,
  recomputeEntry,
  evaluateAndNotify,
  refreshEntryState,
  recordManualPrice,
  deleteManualPrice,
  recordProviderQuote,
  refreshProductPrice,
};
