// Shared helpers for talking to the Express API, plus browser-side logging.

// Console logger with the same "[LEVEL] [Area] message" shape as the server logs.
// Debug lines only show on localhost, or anywhere after running:
//   localStorage.setItem('pricepulse.debug', '1')
const CLIENT_DEBUG = (() => {
  try {
    return location.hostname === 'localhost' || location.hostname === '127.0.0.1' || localStorage.getItem('pricepulse.debug') === '1';
  } catch {
    return false;
  }
})();

function createClientLogger(area) {
  const write = (level, method, message, details) => {
    if (level === 'DEBUG' && !CLIENT_DEBUG) return;
    const line = `[${level}] [${area}] ${message}`;
    if (details === undefined) console[method](line);
    else console[method](line, details);
  };
  return {
    debug: (message, details) => write('DEBUG', 'debug', message, details),
    info: (message, details) => write('INFO', 'info', message, details),
    warn: (message, details) => write('WARN', 'warn', message, details),
    error: (message, details) => write('ERROR', 'error', message, details),
  };
}

const apiLog = createClientLogger('API');

// Sends a JSON request and returns the parsed body. Throws an Error with the
// server's message (plus .status, .fields, .code, .details, and .requestId)
// when the request fails. `operation` is a short description used in logs.
async function apiRequest(url, { method = 'GET', body, operation, query } = {}) {
  const what = operation || `${method} ${url}`;
  let fullUrl = url;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    const qs = params.toString();
    if (qs) fullUrl += `?${qs}`;
  }
  const options = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(fullUrl, options);
  } catch (networkError) {
    apiLog.error(`${what} failed: network error`, { endpoint: `${method} ${fullUrl}`, error: networkError.message });
    const error = new Error('Could not reach PricePulse. Check your connection and try again.');
    error.status = 0;
    throw error;
  }

  const requestId = response.headers.get('X-Request-Id') || undefined;
  if (response.status === 204) return null;
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const error = new Error((data && data.error) || `Request failed (${response.status}). Please try again.`);
    error.status = response.status;
    error.fields = (data && data.fields) || {};
    error.code = data && data.code;
    error.details = data && data.details;
    error.requestId = requestId;
    const level = response.status >= 500 ? 'error' : 'warn';
    apiLog[level](`${what} failed`, { endpoint: `${method} ${fullUrl}`, status: response.status, message: error.message, requestId });
    // The session ended (expired, or signed out elsewhere): go to the login page.
    if (response.status === 401 && !url.startsWith('/api/auth/login')) {
      if (location.pathname === '/app.html') location.href = '/login.html';
    }
    throw error;
  }
  apiLog.debug(`${what} ok`, { status: response.status, requestId });
  return data;
}
