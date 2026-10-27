// The Purchases page: what the user bought, compared with the prices they recorded.
const express = require('express');
const { fromCents } = require('../lib/money');
const { queryInt } = require('../lib/validation');
const { userIdOf, paged } = require('./helpers');
const { serializePurchase } = require('../services/serializers');

function purchasesRoutes({ db }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const userId = userIdOf(req);
    const page = queryInt(req.query.page, { name: 'page', min: 1, max: 100000, fallback: 1 });
    const pageSize = queryInt(req.query.pageSize, { name: 'pageSize', min: 1, max: 100, fallback: 20 });
    const purchases = db.collection('purchases');

    const [total, docs, totals] = await Promise.all([
      purchases.countDocuments({ userId }),
      purchases
        .aggregate([
          { $match: { userId } },
          { $sort: { purchasedAt: -1, _id: 1 } },
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
          // The entry is looked up with the same userId, so nothing from another account can attach.
          {
            $lookup: {
              from: 'entries',
              let: { entryId: '$entryId', userId: '$userId' },
              pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$_id', '$$entryId'] }, { $eq: ['$userId', '$$userId'] }] } } }],
              as: 'entry',
            },
          },
          { $addFields: { entry: { $first: '$entry' } } },
          { $lookup: { from: 'products', localField: 'entry.productId', foreignField: '_id', as: 'product' } },
          { $addFields: { product: { $first: '$product' } } },
        ])
        .toArray(),
      purchases.aggregate([{ $match: { userId } }, { $group: { _id: '$currency', count: { $sum: 1 }, spent: { $sum: '$priceCents' } } }, { $sort: { _id: 1 } }]).toArray(),
    ]);

    const items = docs.map((p) => ({
      ...serializePurchase(p),
      entry: p.entry
        ? {
            id: String(p.entry._id),
            imageUrl: p.entry.imageUrl ?? null,
            category: p.entry.category,
            url: p.product ? p.product.canonicalUrl ?? null : null,
            currentPrice: fromCents(p.entry.currentPriceCents),
            lowestRecordedPrice: fromCents(p.entry.lowestPriceCents),
            highestRecordedPrice: fromCents(p.entry.highestPriceCents),
          }
        : null,
    }));
    res.json({
      ...paged(items, { page, pageSize, total }),
      totals: totals.map((t) => ({ currency: t._id, count: t.count, spent: fromCents(t.spent) })),
    });
  });

  return router;
}

module.exports = { purchasesRoutes };
