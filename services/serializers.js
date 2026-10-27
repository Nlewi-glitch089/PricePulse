// Turn database documents into the JSON the browser receives.
// MongoDB ids become plain `id` strings and cents become decimal prices.

const { fromCents } = require('../lib/money');
const { percentChange } = require('../lib/priceStats');

const iso = (d) => (d ? new Date(d).toISOString() : null);
const idOrNull = (id) => (id ? String(id) : null);

function serializePurchase(p) {
  return {
    id: String(p._id),
    entryId: idOrNull(p.entryId),
    productName: p.productName,
    price: fromCents(p.priceCents),
    currency: p.currency,
    retailer: p.retailer,
    purchasedAt: iso(p.purchasedAt),
    notes: p.notes ?? null,
    createdAt: iso(p.createdAt),
  };
}

// `entry.product` and (optionally) `entry.purchase` must be attached by the caller.
function serializeEntry(e) {
  const current = e.currentPriceCents ?? null;
  const target = e.targetPriceCents ?? null;
  const first = e.firstPriceCents ?? null;
  const changeFrom = e.changeFromPriceCents ?? null;
  const list = e.listPriceCents ?? null;
  return {
    id: String(e._id),
    name: e.name,
    description: e.description ?? null,
    imageUrl: e.imageUrl ?? null,
    category: e.category,
    retailer: e.product.retailer,
    url: e.product.canonicalUrl ?? null,
    currency: e.product.currency,
    notes: e.notes ?? null,
    status: e.status,
    targetPrice: fromCents(target),
    targetMet: target === null || current === null ? null : current <= target,
    targetMetAt: iso(e.targetMetAt),
    // The retailer's list ("was") price as the user entered it. It is not a recorded
    // price and never enters the history; the discount is worked out from it and the
    // latest recorded price, only when both are known.
    listPrice: fromCents(list),
    listDiscount:
      list !== null && current !== null && list > 0
        ? { amount: fromCents(list - current), percent: Math.round(((list - current) / list) * 1000) / 10 }
        : null,
    currentPrice: fromCents(current),
    previousPrice: fromCents(e.previousPriceCents),
    firstPrice: fromCents(first),
    lowestPrice: fromCents(e.lowestPriceCents),
    highestPrice: fromCents(e.highestPriceCents),
    totalChange: fromCents(e.totalChangeCents),
    totalChangePercent: e.totalChangeCents != null && first !== null && current !== null ? percentChange(first, current) : null,
    lastPriceAt: iso(e.lastPriceAt),
    lastPriceChangeAt: iso(e.lastPriceChangeAt),
    lastChange:
      changeFrom !== null && current !== null
        ? {
            from: fromCents(changeFrom),
            to: fromCents(current),
            amount: fromCents(current - changeFrom),
            percent: percentChange(changeFrom, current),
          }
        : null,
    purchase: e.purchase ? serializePurchase(e.purchase) : null,
    createdAt: iso(e.createdAt),
    updatedAt: iso(e.updatedAt),
  };
}

function serializePricePoint(p) {
  return {
    id: String(p._id),
    price: fromCents(p.priceCents),
    currency: p.currency,
    source: p.source,
    providerName: p.providerName ?? null,
    note: p.note ?? null,
    observedAt: iso(p.observedAt),
    createdAt: iso(p.createdAt),
    // Users may delete only their own manual records, never shared provider data.
    deletable: p.source === 'MANUAL',
  };
}

// `n.entry` (optional) is { _id, name, imageUrl } attached by the caller.
function serializeNotification(n) {
  return {
    id: String(n._id),
    type: n.type,
    title: n.title,
    message: n.message,
    price: fromCents(n.priceCents),
    targetPrice: fromCents(n.targetPriceCents),
    currency: n.currency ?? null,
    entryId: idOrNull(n.entryId),
    entry: n.entry ? { id: String(n.entry._id), name: n.entry.name, imageUrl: n.entry.imageUrl ?? null } : null,
    read: Boolean(n.readAt),
    readAt: iso(n.readAt),
    createdAt: iso(n.createdAt),
  };
}

function serializeUser(u) {
  return { id: String(u._id), email: u.email, name: u.name, createdAt: iso(u.createdAt), isDemo: Boolean(u.isDemo), demoExpiresAt: iso(u.demoExpiresAt) };
}

module.exports = { serializeEntry, serializePricePoint, serializeNotification, serializePurchase, serializeUser };
