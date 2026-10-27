// Display formatting for prices, percentages, and dates.

const moneyFormatters = new Map();

function formatMoney(amount, currency = 'USD') {
  if (amount === null || amount === undefined) return '—';
  let f = moneyFormatters.get(currency);
  if (!f) {
    try {
      f = new Intl.NumberFormat(undefined, { style: 'currency', currency });
    } catch {
      f = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    moneyFormatters.set(currency, f);
  }
  return f.format(amount);
}

// "+$12.00" / "−$12.00" with a real minus sign.
function formatSignedMoney(amount, currency = 'USD') {
  const abs = formatMoney(Math.abs(amount), currency);
  if (amount > 0) return `+${abs}`;
  if (amount < 0) return `−${abs}`;
  return abs;
}

function formatPercent(p) {
  if (p === null || p === undefined) return '—';
  const abs = Math.abs(p)
    .toFixed(Math.abs(p) >= 10 ? 1 : 2)
    .replace(/\.?0+$/, '');
  if (p === 0) return `${abs}%`;
  return `${p > 0 ? '+' : '−'}${abs}%`;
}

function formatDate(iso, opts = { dateStyle: 'medium' }) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(undefined, opts).format(new Date(iso));
}

function formatDateTime(iso) {
  return formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatRelative(iso, now = Date.now()) {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const units = [
    ['year', 365 * 864e5],
    ['month', 30 * 864e5],
    ['week', 7 * 864e5],
    ['day', 864e5],
    ['hour', 36e5],
    ['minute', 6e4],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return 'just now';
}

// Value for <input type="datetime-local"> / <input type="date"> in local time.
function toLocalInputValue(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toLocalDateValue(d = new Date()) {
  return toLocalInputValue(d).slice(0, 10);
}
