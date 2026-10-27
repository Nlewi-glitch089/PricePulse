// Request validation. Collects every problem at once so the browser can show
// each message next to its field, then throws a single 400 HttpError:
//   { "error": "Some fields need attention.", "fields": { "name": "Name is required." } }
//
// Unknown fields are ignored unless the caller asks for a strict check.

const { HttpError } = require('./errors');
const { CURRENCIES } = require('./domain');
const { toCents } = require('./money');

const MAX_PRICE = 10_000_000;
const FUTURE_SKEW_MS = 5 * 60 * 1000; // allow small clock differences between browser and server

class Validator {
  constructor(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpError(400, 'Request body must be a JSON object.');
    }
    this.body = body;
    this.errors = {};
    this.out = {};
  }

  has(field) {
    return Object.prototype.hasOwnProperty.call(this.body, field);
  }

  fail(field, message) {
    if (!this.errors[field]) this.errors[field] = message;
  }

  // Text: trimmed; empty optional text becomes null.
  text(field, { label = field, required = false, max = 200 } = {}) {
    if (!this.has(field) && !required) return this;
    const value = this.body[field] ?? '';
    if (typeof value !== 'string') return (this.fail(field, `${label} must be text.`), this);
    const trimmed = value.trim();
    if (!trimmed) {
      if (required) this.fail(field, `${label} is required.`);
      else this.out[field] = null;
      return this;
    }
    if (trimmed.length > max) return (this.fail(field, `${label} must be ${max} characters or fewer.`), this);
    this.out[field] = trimmed;
    return this;
  }

  // Optional http(s) URL; empty becomes null.
  url(field, { label = field } = {}) {
    if (!this.has(field)) return this;
    const value = this.body[field] ?? '';
    if (typeof value !== 'string') return (this.fail(field, `${label} must be text.`), this);
    const trimmed = value.trim();
    if (!trimmed) return ((this.out[field] = null), this);
    if (trimmed.length > 2048) return (this.fail(field, `${label} is too long.`), this);
    let protocol = '';
    try {
      protocol = new URL(trimmed).protocol;
    } catch {
      /* handled below */
    }
    if (protocol !== 'http:' && protocol !== 'https:') {
      return (this.fail(field, `${label} must be a full web address starting with http:// or https://.`), this);
    }
    this.out[field] = trimmed;
    return this;
  }

  // A price in dollars (e.g. 19.99), stored as cents. `nullable` lets an
  // optional price be cleared with null or "".
  money(field, { label = field, required = false, nullable = false } = {}) {
    if (!this.has(field)) {
      if (required) this.fail(field, `${label} is required.`);
      return this;
    }
    const raw = this.body[field];
    if (raw === null || raw === '') {
      if (required) this.fail(field, `${label} is required.`);
      else if (nullable) this.out[field] = null;
      return this;
    }
    const n = typeof raw === 'string' ? Number(raw.trim()) : raw;
    if (typeof n !== 'number' || !Number.isFinite(n)) return (this.fail(field, `${label} must be a number.`), this);
    if (n < 0) return (this.fail(field, `${label} can't be negative.`), this);
    if (n > MAX_PRICE) return (this.fail(field, `${label} is unrealistically large.`), this);
    if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) return (this.fail(field, `${label} can have at most 2 decimal places.`), this);
    this.out[field] = toCents(n);
    return this;
  }

  currency(field, { required = false } = {}) {
    if (!this.has(field)) {
      if (required) this.fail(field, 'Currency is required.');
      return this;
    }
    const value = typeof this.body[field] === 'string' ? this.body[field].trim().toUpperCase() : '';
    if (!CURRENCIES.includes(value)) return (this.fail(field, `Currency must be one of ${CURRENCIES.join(', ')}.`), this);
    this.out[field] = value;
    return this;
  }

  // A past (or present) date/time.
  pastDate(field, { label = field, required = false } = {}) {
    if (!this.has(field) || this.body[field] === null || this.body[field] === '') {
      if (required) this.fail(field, `${label} is required.`);
      return this;
    }
    const date = new Date(this.body[field]);
    if (typeof this.body[field] !== 'string' || Number.isNaN(date.getTime())) {
      return (this.fail(field, `${label} must be a valid date.`), this);
    }
    if (date.getTime() > Date.now() + FUTURE_SKEW_MS) return (this.fail(field, `${label} can't be in the future.`), this);
    this.out[field] = date;
    return this;
  }

  oneOf(field, allowed, { label = field } = {}) {
    if (!this.has(field)) return this;
    if (!allowed.includes(this.body[field])) return (this.fail(field, `${label} must be one of: ${allowed.join(', ')}.`), this);
    this.out[field] = this.body[field];
    return this;
  }

  boolean(field, { label = field } = {}) {
    if (!this.has(field)) return this;
    if (typeof this.body[field] !== 'boolean') return (this.fail(field, `${label} must be true or false.`), this);
    this.out[field] = this.body[field];
    return this;
  }

  integer(field, { label = field, min, max } = {}) {
    if (!this.has(field)) return this;
    const n = this.body[field];
    if (!Number.isInteger(n) || n < min || n > max) return (this.fail(field, `${label} must be a whole number from ${min} to ${max}.`), this);
    this.out[field] = n;
    return this;
  }

  // Reject fields the endpoint doesn't accept (catches typos and attempts to set server-owned fields).
  only(allowed) {
    for (const key of Object.keys(this.body)) {
      if (!allowed.includes(key)) this.fail(key, `${key} can't be set here.`);
    }
    return this;
  }

  done() {
    if (Object.keys(this.errors).length) {
      throw new HttpError(400, 'Some fields need attention.', { fields: this.errors });
    }
    return this.out;
  }
}

const validate = (body) => new Validator(body);

// Query-string helpers (values are always strings or undefined).
function queryInt(value, { name, min, max, fallback }) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${name} must be a whole number from ${min} to ${max}.`);
  }
  return n;
}

function queryEnum(value, { name, allowed, fallback }) {
  if (value === undefined || value === '') return fallback;
  if (!allowed.includes(value)) throw new HttpError(400, `${name} must be one of: ${allowed.join(', ')}.`);
  return value;
}

function queryText(value, { max = 200 } = {}) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

module.exports = { validate, queryInt, queryEnum, queryText, MAX_PRICE };
