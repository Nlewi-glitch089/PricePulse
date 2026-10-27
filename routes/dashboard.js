// The dashboard. Everything here is computed from the user's stored data.
const express = require('express');
const { ACTIVE_STATUSES } = require('../lib/domain');
const { userIdOf } = require('./helpers');
const { withProducts } = require('../services/watchlist');
const { withEntries } = require('./notifications');
const { serializeEntry, serializeNotification } = require('../services/serializers');

function dashboardRoutes({ db }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const userId = userIdOf(req);
    const entries = db.collection('entries');
    const active = { userId, status: { $in: ACTIVE_STATUSES } };

    const [watching, targetReachedCount, purchased, total, unreadNotifications, targetReached, recentChanges, biggestDrops, recentlyAdded, alerts] =
      await Promise.all([
        entries.countDocuments(active),
        entries.countDocuments({ userId, status: 'TARGET_REACHED' }),
        entries.countDocuments({ userId, status: 'PURCHASED' }),
        entries.countDocuments({ userId }),
        db.collection('notifications').countDocuments({ userId, readAt: null }),
        entries.find({ userId, status: 'TARGET_REACHED' }).sort({ targetMetAt: -1, _id: 1 }).limit(6).toArray(),
        entries.find({ ...active, lastPriceChangeAt: { $ne: null } }).sort({ lastPriceChangeAt: -1, _id: 1 }).limit(6).toArray(),
        entries.find({ ...active, totalChangeCents: { $lt: 0 } }).sort({ totalChangeCents: 1, _id: 1 }).limit(5).toArray(),
        entries.find({ userId }).sort({ createdAt: -1, _id: -1 }).limit(5).toArray(),
        db.collection('notifications').find({ userId }).sort({ createdAt: -1, _id: -1 }).limit(5).toArray(),
      ]);

    const [tr, rc, bd, ra] = await Promise.all([targetReached, recentChanges, biggestDrops, recentlyAdded].map((list) => withProducts(db, list)));
    res.json({
      counts: { watching, targetReached: targetReachedCount, purchased, total, unreadNotifications },
      targetReached: tr.map(serializeEntry),
      recentChanges: rc.map(serializeEntry),
      biggestDrops: bd.map(serializeEntry),
      recentlyAdded: ra.map(serializeEntry),
      recentAlerts: (await withEntries(db, userId, alerts)).map(serializeNotification),
    });
  });

  return router;
}

module.exports = { dashboardRoutes };
