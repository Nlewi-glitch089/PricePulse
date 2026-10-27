// Small helpers shared by the route files.
const { ObjectId } = require('mongodb');

// The logged-in user's id as an ObjectId. Only call behind requireAuth.
function userIdOf(req) {
  return new ObjectId(req.session.userId);
}

function paged(items, { page, pageSize, total }) {
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

module.exports = { userIdOf, paged };
