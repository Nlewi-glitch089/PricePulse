// Small DOM toolkit shared by every page: element builder, icons, badges,
// loading/empty/error states, toasts, dialogs, and form-error display.
//
// User data is only ever placed with textContent / attributes, never as HTML.

const SVG_NS = 'http://www.w3.org/2000/svg';

// h('div', { class: 'card', onclick: fn }, 'text', childNode, [more, children])
function h(tag, attrs, ...children) {
  const isSvg = ['svg', 'path', 'circle', 'line', 'rect', 'text', 'g', 'polyline'].includes(tag);
  const el = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') el.setAttribute('class', value);
    // Through the CSSOM: the Content-Security-Policy blocks style="" attributes but allows this.
    else if (key === 'style') el.style.cssText = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key in el && !isSvg && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

const ICONS = {
  dashboard: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  list: 'M4 6h16M4 12h16M4 18h10',
  bag: 'M6 7h12l-1 13H7L6 7zm3 0a3 3 0 016 0',
  bell: 'M18 16v-5a6 6 0 10-12 0v5l-2 2h16l-2-2zm-8 4a2 2 0 004 0',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 00-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 000 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 002 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zm9 3l-4.35-4.35',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  checkCircle: 'M12 22a10 10 0 100-20 10 10 0 000 20zm-4-10l3 3 5-6',
  alert: 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  info: 'M12 22a10 10 0 100-20 10 10 0 000 20zm0-6v-4m0-4h.01',
  x: 'M6 6l12 12M18 6L6 18',
  menu: 'M4 6h16M4 12h16M4 18h16',
  logout: 'M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 17l5-5-5-5M15 12H3',
  arrowDown: 'M12 5v14m-6-6l6 6 6-6',
  arrowUp: 'M12 19V5m-6 6l6-6 6 6',
  arrowLeft: 'M19 12H5m6-6l-6 6 6 6',
  external: 'M14 4h6v6m0-6L10 14M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zm10-14l4 4',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',
  refresh: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
  image: 'M4 5h16v14H4V5zm0 11l5-5 4 4 3-3 4 4M15 9h.01',
  chart: 'M4 19h16M6 15l4-5 4 3 5-7',
  target: 'M12 22a10 10 0 100-20 10 10 0 000 20zm0-4a6 6 0 100-12 6 6 0 000 12zm0-4a2 2 0 100-4 2 2 0 000 4z',
  clock: 'M12 22a10 10 0 100-20 10 10 0 000 20zm0-15v5l3 2',
  pulse: 'M3 12h4l3-8 4 16 3-8h4',
  filter: 'M4 5h16l-6 8v6l-4-2v-4L4 5z',
};

function icon(name, size = 18) {
  return h(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' },
    h('path', { d: ICONS[name] }),
  );
}

// ---- states ------------------------------------------------------------

function loadingState(label = 'Loading…') {
  return h('div', { class: 'loading', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', {}, label));
}

// A full empty state sits right under the page's h1, so its title is an h2; a compact
// one sits inside a titled section, so its title is plain bold text.
function emptyState({ iconName = 'list', title, text, action, compact }) {
  return h(
    'div',
    { class: `empty${compact ? ' compact' : ''}` },
    !compact && h('div', { class: 'empty-icon', 'aria-hidden': 'true' }, icon(iconName, 24)),
    compact ? h('p', { class: 'empty-title' }, title) : h('h2', {}, title),
    text && h('p', { class: 'small' }, text),
    action,
  );
}

function errorState(error, onRetry, title = 'We couldn’t load this') {
  return h(
    'div',
    { class: 'empty', role: 'alert' },
    h('div', { class: 'empty-icon empty-icon-bad', 'aria-hidden': 'true' }, icon('alert', 24)),
    h('h2', {}, title),
    h('p', {}, error.message),
    error.status === 0 && h('p', { class: 'small' }, 'If you’re running PricePulse yourself, check that the server is still running.'),
    error.requestId && h('p', { class: 'tiny muted' }, `Reference: ${error.requestId}`),
    onRetry && h('button', { type: 'button', class: 'btn', onclick: onRetry }, icon('refresh', 16), ' Try again'),
  );
}

// ---- badges and price bits -------------------------------------------

const STATUS_LABELS = {
  WATCHING: 'Watching',
  TARGET_REACHED: 'Target reached',
  PURCHASED: 'Purchased',
  NOT_INTERESTED: 'No longer interested',
};
const STATUS_STYLE = {
  WATCHING: ['badge-watching', 'clock'],
  TARGET_REACHED: ['badge-target', 'checkCircle'],
  PURCHASED: ['badge-purchased', 'bag'],
  NOT_INTERESTED: ['badge-dropped', 'x'],
};

function statusBadge(status) {
  const [cls, iconName] = STATUS_STYLE[status] || STATUS_STYLE.WATCHING;
  return h('span', { class: `badge ${cls}` }, icon(iconName, 13), STATUS_LABELS[status] || status);
}

// Lists show a badge only when a product is out of the ordinary; "Watching" is the norm.
function statusBadgeIfNotable(status) {
  return status && status !== 'WATCHING' ? statusBadge(status) : null;
}

function sourceBadge(point) {
  return h(
    'span',
    { class: 'badge badge-source', title: point.source === 'MANUAL' ? 'Entered by you' : `Retrieved automatically from ${point.providerName}` },
    point.source === 'MANUAL' ? 'Manual' : `Auto · ${point.providerName || 'source'}`,
  );
}

// A price change with sign, arrow and color. A drop is good news for a shopper.
function priceDelta(amount, percent, currency, { showAmount = true } = {}) {
  if (amount === null || amount === undefined) return h('span', { class: 'delta-flat small' }, 'No change data');
  const cls = amount < 0 ? 'delta-down' : amount > 0 ? 'delta-up' : 'delta-flat';
  const word = amount < 0 ? 'down' : amount > 0 ? 'up' : 'unchanged';
  const pct = percent === null || percent === undefined ? null : formatPercent(percent);
  return h(
    'span',
    { class: `${cls} num small`, style: 'display:inline-flex;align-items:center;gap:2px;font-weight:600' },
    amount !== 0 && icon(amount < 0 ? 'arrowDown' : 'arrowUp', 14),
    h('span', { class: 'sr-only' }, `Price ${word} `),
    showAmount && formatSignedMoney(amount, currency),
    pct && (showAmount ? ` (${pct})` : pct),
  );
}

// "Target $189.00 · $10.00 to go" / "Target $189.00 · reached": how far the price is from the target.
function targetIndicator(item) {
  if (item.targetPrice === null) return h('span', { class: 'target-line muted' }, 'No target set');
  const gap = item.currentPrice === null ? null : Math.round((item.currentPrice - item.targetPrice) * 100) / 100;
  return h(
    'span',
    { class: `target-line${item.targetMet ? ' is-met' : ''}` },
    icon(item.targetMet ? 'checkCircle' : 'target', 14),
    h('span', {}, 'Target ', h('strong', { class: 'num' }, formatMoney(item.targetPrice, item.currency))),
    item.targetMet
      ? h('span', { class: 'target-gap' }, '· reached')
      : gap !== null && gap > 0 && h('span', { class: 'target-gap num' }, `· ${formatMoney(gap, item.currency)} to go`),
  );
}

// "$75.00 off (30%)" / "$12.00 above list": the latest recorded price against the
// store's list price. Comes from the API's listDiscount, which exists only when both are known.
function listDiscountText(item) {
  const d = item.listDiscount;
  if (!d) return null;
  const pct = `${Math.abs(d.percent)}%`;
  if (d.amount > 0) return h('span', { class: 'delta-down' }, `${formatMoney(d.amount, item.currency)} off (${pct})`);
  if (d.amount < 0) return h('span', { class: 'delta-up' }, `${formatMoney(-d.amount, item.currency)} above list (${pct})`);
  return h('span', { class: 'muted' }, 'at list price');
}

// "List $249.99 · $75.00 off (30%)" for cards; nothing when the list price is unknown.
function listPriceLine(item) {
  if (item.listPrice === null || item.listPrice === undefined) return null;
  const discount = listDiscountText(item);
  return h('span', { class: 'list-line' }, 'List ', h('span', { class: 'num' }, formatMoney(item.listPrice, item.currency)), discount && ' · ', discount);
}

// Product photo with a fallback icon if there's no URL or it fails to load.
// Pass alt '' where the product's name is already next to the image.
function productImage(src, alt) {
  const fallback = () => h('div', { class: 'thumb-fallback', 'aria-hidden': 'true' }, icon('image', 28));
  if (!src) return fallback();
  const img = h('img', { src, alt, loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(fallback()));
  return img;
}

// Small photo for list rows; nothing at all when there's no photo, rather than a
// column of identical placeholder icons.
function miniThumb(src) {
  return src ? h('div', { class: 'mini-thumb' }, productImage(src, '')) : null;
}

function pagination(page, totalPages, onChange) {
  if (totalPages <= 1) return null;
  return h(
    'nav',
    { class: 'pagination', 'aria-label': 'Pagination' },
    h('button', { type: 'button', class: 'btn btn-sm', disabled: page <= 1, onclick: () => onChange(page - 1) }, 'Previous'),
    h('span', { class: 'small secondary' }, `Page ${page} of ${totalPages}`),
    h('button', { type: 'button', class: 'btn btn-sm', disabled: page >= totalPages, onclick: () => onChange(page + 1) }, 'Next'),
  );
}

// ---- toasts ---------------------------------------------------------------

function toast(message, kind = 'success') {
  let region = document.getElementById('toasts');
  if (!region) {
    region = h('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' });
    document.body.append(region);
  }
  const node = h(
    'div',
    { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    icon(kind === 'error' ? 'alert' : kind === 'success' ? 'checkCircle' : 'info'),
    h('span', {}, message),
    h('button', { type: 'button', class: 'icon-btn', style: 'width:28px;height:28px', 'aria-label': 'Dismiss', onclick: () => node.remove() }, icon('x', 14)),
  );
  region.append(node);
  while (region.children.length > 4) region.firstChild.remove();
  setTimeout(() => node.remove(), kind === 'error' ? 8000 : 4500);
}

// ---- dialogs (native <dialog>: focus trapping and Esc come from the browser) ----

function openDialog({ title, description, body, footer, onClose }) {
  const titleId = `dlg-${Math.random().toString(36).slice(2)}`;
  const dialog = h(
    'dialog',
    { class: 'dialog', 'aria-labelledby': titleId },
    h('div', { class: 'dialog-header' }, h('h2', { id: titleId }, title), description && h('p', { class: 'small secondary', style: 'margin-top:6px' }, description)),
    body && h('div', { class: 'dialog-body' }, body),
    footer && h('div', { class: 'dialog-footer' }, footer),
  );
  const close = () => {
    if (dialog.open) dialog.close();
    dialog.remove();
    if (onClose) onClose();
  };
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close(); // backdrop click
  });
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, close };
}

// Resolves true when confirmed. `action` (optional async fn) runs while the button shows "Working…".
function confirmDialog({ title, description, confirmLabel = 'Confirm', destructive = false, action }) {
  return new Promise((resolve) => {
    let done = false;
    const cancelBtn = h('button', { type: 'button', class: 'btn' }, 'Cancel');
    const okBtn = h('button', { type: 'button', class: `btn ${destructive ? 'btn-danger-solid' : 'btn-primary'}` }, confirmLabel);
    const errorBox = h('div', {});
    const { close } = openDialog({
      title,
      description,
      body: errorBox,
      footer: [cancelBtn, okBtn],
      onClose: () => {
        if (!done) resolve(false);
      },
    });
    cancelBtn.addEventListener('click', close);
    okBtn.addEventListener('click', async () => {
      if (action) {
        okBtn.disabled = cancelBtn.disabled = true;
        okBtn.textContent = 'Working…';
        try {
          await action();
        } catch (error) {
          clear(errorBox).append(formAlert(error.message));
          okBtn.disabled = cancelBtn.disabled = false;
          okBtn.textContent = confirmLabel;
          return;
        }
      }
      done = true;
      resolve(true);
      close();
    });
  });
}

// ---- forms ------------------------------------------------------------------

function formAlert(message, kind = 'error') {
  return h('div', { class: `alert alert-${kind}`, role: 'alert' }, icon(kind === 'error' ? 'alert' : 'info'), h('span', {}, message));
}

// Labeled input with a hint and an error slot, wired for screen readers.
// `control` is an <input>/<select>/<textarea> (or a wrapper containing one with data-control).
let fieldCounter = 0;
function field({ label, name, control, hint, required, className = '' }) {
  const input = control.matches('input,select,textarea') ? control : control.querySelector('input,select,textarea');
  const id = input.id || `f-${name}-${++fieldCounter}`;
  input.id = id;
  input.name = input.name || name;
  if (required) input.setAttribute('aria-required', 'true');
  const hintEl = hint ? h('span', { class: 'hint', id: `${id}-hint` }, hint) : null;
  const errorEl = h('span', { class: 'error', id: `${id}-error`, hidden: true });
  input.setAttribute('aria-describedby', [hintEl && hintEl.id, errorEl.id].filter(Boolean).join(' '));
  return h(
    'div',
    { class: `field ${className}`, dataset: { field: name } },
    h('label', { for: id }, label, required && h('span', { 'aria-hidden': 'true', style: 'color: var(--bad-ink)' }, ' *')),
    control,
    hintEl,
    errorEl,
  );
}

// Show { fieldName: message } next to each field in `form`; clears the others.
function showFieldErrors(form, fields = {}) {
  for (const wrap of form.querySelectorAll('[data-field]')) {
    const name = wrap.dataset.field;
    const input = wrap.querySelector('input,select,textarea');
    const errorEl = wrap.querySelector('.error');
    const hintEl = wrap.querySelector('.hint');
    const message = fields[name];
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (errorEl) {
      clear(errorEl);
      errorEl.hidden = !message;
      if (message) errorEl.append(icon('alert', 14), ` ${message}`);
    }
    if (hintEl) hintEl.hidden = Boolean(message);
  }
  const first = Object.keys(fields).find((name) => fields[name] && form.querySelector(`[data-field="${name}"]`));
  if (first) {
    const input = form.querySelector(`[data-field="${first}"] input, [data-field="${first}"] select, [data-field="${first}"] textarea`);
    const folded = input.closest('details');
    if (folded) folded.open = true; // an error in a collapsed section must be visible
    input.focus();
  }
}

function setBusy(button, busy, busyLabel) {
  if (busy) {
    button.dataset.label = button.textContent;
    button.disabled = true;
    clear(button).append(h('span', { class: 'spinner', 'aria-hidden': 'true' }), ` ${busyLabel}`);
  } else {
    button.disabled = false;
    if (button.dataset.label) button.textContent = button.dataset.label;
  }
}

// ---- client-side validation (the server re-checks everything) ----

const validators = {
  required: (v, label) => (v.trim() ? undefined : `${label} is required.`),
  maxLength: (v, label, max) => (v.trim().length > max ? `${label} must be ${max} characters or fewer.` : undefined),
  email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? undefined : 'Enter a valid email address.'),
  password: (v) => {
    if (v.length < 8 || v.length > 72) return 'Password must be between 8 and 72 characters.';
    if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return 'Password must include at least one letter and one number.';
  },
  url: (v, label) => {
    if (!v.trim()) return undefined;
    try {
      const u = new URL(v.trim());
      if (u.protocol === 'http:' || u.protocol === 'https:') return undefined;
    } catch {
      /* fall through */
    }
    return `${label} must be a full web address starting with http:// or https://.`;
  },
  price: (v, label, required) => {
    const s = v.trim();
    if (!s) return required ? `${label} is required.` : undefined;
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return `Enter ${label.toLowerCase()} like 129.99 (up to 2 decimals).`;
    if (Number(s) > 10000000) return `${label} is unrealistically large.`;
  },
};

const parsePrice = (v) => (v.trim() ? Number(v.trim()) : null);
