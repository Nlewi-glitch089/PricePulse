// Prices are stored as whole cents (19.99 -> 1999) so totals and comparisons
// never suffer floating-point rounding. The API sends and receives decimals.

function toCents(amount) {
  return Math.round(amount * 100);
}

function fromCents(cents) {
  return cents === null || cents === undefined ? null : cents / 100;
}

function formatMoney(cents, currency) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

const TRACKING_PARAM = /^(utm_.*|fbclid|gclid|mc_eid|mc_cid|ref|ref_)$/i;

// Normalize a product URL so the same page is recognized across users:
// lowercase host without "www.", no #fragment, no tracking parameters, sorted query.
function canonicalizeUrl(raw) {
  const url = new URL(raw.trim());
  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1);
  return url.toString();
}

module.exports = { toCents, fromCents, formatMoney, canonicalizeUrl };
