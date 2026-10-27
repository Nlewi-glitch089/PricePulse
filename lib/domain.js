// Fixed values used across the app.

const STATUSES = ['WATCHING', 'TARGET_REACHED', 'PURCHASED', 'NOT_INTERESTED'];

// Statuses whose prices are still checked against the target.
const ACTIVE_STATUSES = ['WATCHING', 'TARGET_REACHED'];

// Statuses a user may set directly. TARGET_REACHED comes from the prices;
// PURCHASED comes from recording a purchase.
const USER_SETTABLE_STATUSES = ['WATCHING', 'NOT_INTERESTED'];

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR', 'MXN'];

const PRICE_RANGES = { '7d': 7, '30d': 30, '90d': 90, all: null };

// Saved with the account so every browser shows the same theme. There's no default:
// until a user picks one, each browser keeps whatever it had (or follows the device).
const THEMES = ['system', 'light', 'dark'];

const DEFAULT_PREFERENCES = {
  targetAlerts: true,
  priceDropAlerts: false,
  priceDropMinPercent: 5,
  defaultCurrency: 'USD',
};

function rangeStart(range, now = new Date()) {
  const days = PRICE_RANGES[range];
  return days == null ? null : new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

module.exports = {
  STATUSES,
  ACTIVE_STATUSES,
  USER_SETTABLE_STATUSES,
  CURRENCIES,
  PRICE_RANGES,
  THEMES,
  DEFAULT_PREFERENCES,
  rangeStart,
};
