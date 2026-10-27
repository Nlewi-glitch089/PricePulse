// Automatic price sources.
//
// A provider is an object with:
//   name                 stored on every price record it creates
//   displayName          shown in the app
//   supports(product)    true if it can look this product up
//   fetchPrice(product)  resolves to { priceCents, currency, observedAt }
//
// Providers must only return prices the source actually reported; if the
// source can't give one, throw a ProviderError. PricePulse never estimates.
//
// The app ships with one: a generic adapter for a JSON price API you're
// authorized to use, turned on by the PRICE_PROVIDER_HTTP_* variables.
// Without it, prices are entered by hand.

const { toCents } = require('./money');
const { createLogger } = require('./logger');

const log = createLogger('Providers');
const TIMEOUT_MS = 8000;

class ProviderError extends Error {
  constructor(provider, message) {
    super(message);
    this.provider = provider;
  }
}

// Calls `endpoint` (with {url} replaced by the encoded product URL) and expects:
//   { "price": 129.99, "currency": "USD", "observedAt": "2026-01-01T00:00:00Z" (optional) }
function createHttpJsonProvider({ name, endpoint, apiKey, fetchImpl = fetch }) {
  if (!endpoint.includes('{url}')) {
    throw new Error('PRICE_PROVIDER_HTTP_ENDPOINT must contain a {url} placeholder.');
  }
  return {
    name,
    displayName: name,

    supports(product) {
      return Boolean(product.canonicalUrl);
    },

    async fetchPrice(product) {
      const target = endpoint.replace('{url}', encodeURIComponent(product.canonicalUrl));
      let res;
      try {
        res = await fetchImpl(target, {
          headers: { Accept: 'application/json', ...(apiKey && { Authorization: `Bearer ${apiKey}` }) },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new ProviderError(name, 'The price source could not be reached');
      }
      if (res.status === 404) throw new ProviderError(name, 'The price source has no price for this product');
      if (!res.ok) throw new ProviderError(name, `The price source responded with HTTP ${res.status}`);

      let body;
      try {
        body = await res.json();
      } catch {
        throw new ProviderError(name, 'The price source returned invalid JSON');
      }
      const price = body && body.price;
      const currency = body && typeof body.currency === 'string' ? body.currency.toUpperCase() : '';
      if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || !/^[A-Z]{3}$/.test(currency)) {
        throw new ProviderError(name, 'The price source did not return a valid price');
      }
      let observedAt = new Date();
      if (body.observedAt !== undefined) {
        observedAt = new Date(body.observedAt);
        if (typeof body.observedAt !== 'string' || Number.isNaN(observedAt.getTime())) {
          throw new ProviderError(name, 'The price source returned an invalid date');
        }
      }
      return { priceCents: toCents(price), currency, observedAt };
    },
  };
}

// Returns the list of providers turned on by environment variables (often empty).
function loadConfiguredProviders(env = process.env) {
  const providers = [];
  const endpoint = (env.PRICE_PROVIDER_HTTP_ENDPOINT || '').trim();
  if (endpoint) {
    providers.push(
      createHttpJsonProvider({
        name: (env.PRICE_PROVIDER_HTTP_NAME || '').trim() || 'price-api',
        endpoint,
        apiKey: (env.PRICE_PROVIDER_HTTP_API_KEY || '').trim(),
      }),
    );
    log.info('Automatic price source enabled', { provider: providers[0].name });
  } else {
    log.info('No automatic price source configured; prices are entered manually');
  }
  return providers;
}

module.exports = { ProviderError, createHttpJsonProvider, loadConfiguredProviders };
