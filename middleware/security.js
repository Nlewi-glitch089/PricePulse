// Security headers and a same-origin check for state-changing API requests.
const { createLogger } = require('../lib/logger');

const log = createLogger('Security');

function securityHeaders({ isProduction }) {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    // Product images are hotlinked from whatever retailer the user pasted.
    "img-src 'self' data: https: http:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  return (req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  };
}

// Defense in depth on top of SameSite=Lax cookies: browsers always send Origin on
// POST/PATCH/DELETE, so a mismatch means another site is trying to act as the user.
// Requests without Origin (curl, tests) carry no browser cookies by accident and are allowed.
function sameOriginOnly(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = null;
  }
  if (originHost === req.get('host')) return next();
  log.warn('Rejected cross-origin request', { origin: origin.slice(0, 100), route: `${req.method} ${req.originalUrl}`, requestId: req.id });
  return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
}

module.exports = { securityHeaders, sameOriginOnly };
