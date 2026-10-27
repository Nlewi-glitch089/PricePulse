// The in-app notification center.
const express = require('express');
const { HttpError, notFound } = require('../lib/errors');
const { queryInt, queryEnum } = require('../lib/validation');
const { toObjectId } = require('../database/db');
const { userIdOf, paged } = require('./helpers');
const { serializeNotification } = require('../services/serializers');

// Attach { _id, name, imageUrl } of each notification's entry (same user only).
async function withEntries(db, userId, notifications) {
  const ids = notifications.map((n) => n.entryId).filter(Boolean);
  if (!ids.length) return notifications;
  const entries = await db.collection('entries').find({ _id: { $in: ids }, userId }, { projection: { name: 1, imageUrl: 1 } }).toArray();
  const byId = new Map(entries.map((e) => [String(e._id), e]));
  return notifications.map((n) => ({ ...n, entry: n.entryId ? byId.get(String(n.entryId)) || null : null }));
}

function notificationsRoutes({ db }) {
  const router = express.Router();
  const notifications = db.collection('notifications');

  router.get('/', async (req, res) => {
    const userId = userIdOf(req);
    const filter = queryEnum(req.query.filter, { name: 'filter', allowed: ['all', 'unread'], fallback: 'all' });
    const page = queryInt(req.query.page, { name: 'page', min: 1, max: 100000, fallback: 1 });
    const pageSize = queryInt(req.query.pageSize, { name: 'pageSize', min: 1, max: 100, fallback: 20 });
    const where = filter === 'unread' ? { userId, readAt: null } : { userId };
    const [total, unreadCount, docs] = await Promise.all([
      notifications.countDocuments(where),
      notifications.countDocuments({ userId, readAt: null }),
      notifications.find(where).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
    ]);
    const items = (await withEntries(db, userId, docs)).map(serializeNotification);
    res.json({ ...paged(items, { page, pageSize, total }), unreadCount });
  });

  router.get('/unread-count', async (req, res) => {
    res.json({ unreadCount: await notifications.countDocuments({ userId: userIdOf(req), readAt: null }) });
  });

  router.post('/read-all', async (req, res) => {
    const { modifiedCount } = await notifications.updateMany({ userId: userIdOf(req), readAt: null }, { $set: { readAt: new Date() } });
    res.json({ updated: modifiedCount });
  });

  router.patch('/:id', async (req, res) => {
    const userId = userIdOf(req);
    const { read } = req.body || {};
    if (typeof read !== 'boolean') throw new HttpError(400, 'read must be true or false.', { fields: { read: 'Must be true or false.' } });
    // Scoping the update by userId means another user's notification can't be touched.
    const doc = await notifications.findOneAndUpdate(
      { _id: toObjectId(req.params.id, 'Notification'), userId },
      { $set: { readAt: read ? new Date() : null } },
      { returnDocument: 'after' },
    );
    if (!doc) throw notFound('Notification');
    const [withEntry] = await withEntries(db, userId, [doc]);
    res.json({ notification: serializeNotification(withEntry) });
  });

  router.delete('/:id', async (req, res) => {
    const { deletedCount } = await notifications.deleteOne({ _id: toObjectId(req.params.id, 'Notification'), userId: userIdOf(req) });
    if (!deletedCount) throw notFound('Notification');
    res.status(204).end();
  });

  return router;
}

module.exports = { notificationsRoutes, withEntries };
