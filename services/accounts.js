// Removing an account and everything that belongs to it. Used when a user deletes
// their account and when a demo account ends.

// MongoDB has no cascades, so each collection is cleaned up here.
async function deleteUserData(db, userId) {
  const entries = await db.collection('entries').find({ userId }, { projection: { _id: 1, productId: 1 } }).toArray();
  const entryIds = entries.map((e) => e._id);
  await Promise.all([
    db.collection('prices').deleteMany({ entryId: { $in: entryIds } }),
    db.collection('entries').deleteMany({ userId }),
    db.collection('notifications').deleteMany({ userId }),
    db.collection('purchases').deleteMany({ userId }),
  ]);
  // Catalog products nobody tracks any more go too (with their shared prices).
  const productIds = [...new Map(entries.map((e) => [String(e.productId), e.productId])).values()];
  const stillUsed = new Set((await db.collection('entries').distinct('productId', { productId: { $in: productIds } })).map(String));
  const orphans = productIds.filter((id) => !stillUsed.has(String(id)));
  await Promise.all([
    db.collection('products').deleteMany({ _id: { $in: orphans } }),
    db.collection('prices').deleteMany({ productId: { $in: orphans } }),
  ]);
  await db.collection('users').deleteOne({ _id: userId });
}

module.exports = { deleteUserData };
