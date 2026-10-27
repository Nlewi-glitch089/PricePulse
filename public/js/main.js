// The signed-in app: header, hash-based views, and the unread-alerts badge.
//
// Views:  #dashboard  #watchlist?filters  #add  #product/<id>  #edit/<id>
//         #purchases  #notifications  #settings
//
// A view renders into a detached container that replaces the page only once its
// data has loaded, so navigating never shows a half-built or empty page. A view
// may return { update(params) } to handle a change of its own URL parameters in
// place (the Watch List does this for filters).
const appLog = createClientLogger('App');
const mainEl = document.getElementById('main');
let currentUser = null;
let renderCount = 0;
let current = null; // { name, id, hash, handle }
// The pages visited in this tab, mirroring the browser history closely enough to
// label "Back" links and to know whether going back stays inside the app.
const navStack = [];
const previousHash = () => navStack[navStack.length - 2] || null;
function trackNavigation(hash, replacing) {
  if (replacing && navStack.length) navStack[navStack.length - 1] = hash;
  else if (navStack.length >= 2 && navStack[navStack.length - 2] === hash) navStack.pop(); // browser Back
  else navStack.push(hash);
}

const VIEWS = {
  dashboard: renderDashboard,
  watchlist: renderWatchlist,
  add: renderAddProduct,
  product: renderProduct,
  edit: renderEditProduct,
  purchases: renderPurchases,
  notifications: renderNotifications,
  settings: renderSettings,
};
const VIEW_NAMES = { dashboard: 'Dashboard', watchlist: 'Watch List', product: 'product', purchases: 'Purchases', notifications: 'Notifications', settings: 'Settings' };

// "#product/abc?x=1" -> { name: 'product', id: 'abc', params: URLSearchParams }
function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#/, '') || 'dashboard';
  const [path, query = ''] = raw.split('?');
  const [name, id] = path.split('/');
  return { name: VIEWS[name] ? name : 'notfound', id: id ? decodeURIComponent(id) : null, params: new URLSearchParams(query) };
}

// Each render gets a token; async work checks it so a slow response from an
// old view never draws over the current one.
function viewContext() {
  const token = ++renderCount;
  return { isCurrent: () => token === renderCount };
}

// Reads a message out to screen-reader users (saves, deletions, result counts).
function announce(message) {
  const region = document.getElementById('announcer');
  region.textContent = '';
  // A fresh text node after a tick makes repeated messages announce again.
  setTimeout(() => (region.textContent = message), 50);
}

// A link back to where the user came from when that was one of the `from` pages
// (going back in history, so their filters and scroll position return), and
// otherwise to the parent page `fallbackHref`.
const LIST_VIEWS = ['dashboard', 'watchlist', 'purchases', 'notifications'];
function backLink(fallbackHref, fallbackLabel, { from = LIST_VIEWS, className = 'back-link', text } = {}) {
  const prevHash = previousHash();
  const prev = prevHash && parseHash(prevHash);
  const usePrevious = prev && from.includes(prev.name);
  const label = text || `Back to ${usePrevious && prev.name !== 'product' ? VIEW_NAMES[prev.name] : fallbackLabel}`;
  const link = h('a', { href: usePrevious ? prevHash : fallbackHref, class: className }, className === 'back-link' && icon('arrowLeft', 16), label);
  link.addEventListener('click', (e) => {
    if (usePrevious && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      history.back();
    }
  });
  return link;
}

// After a form is saved, "Back" shouldn't return to the form. If the form was opened
// from the page it leads to, step back to that page; otherwise replace the form's entry.
function leaveForm(hash) {
  if (previousHash() === `#${hash}`) history.back();
  else replaceRoute(hash);
}

// Goes to a page without leaving the current one in history.
let replacingRoute = false;
function replaceRoute(hash) {
  replacingRoute = true;
  location.replace(`#${hash}`);
}

function setActiveNav(name) {
  const section = name === 'product' || name === 'edit' ? 'watchlist' : name;
  for (const link of document.querySelectorAll('[data-nav]')) {
    const active = link.dataset.nav === section;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

// Remembers what had focus so it can be restored after the page is rebuilt.
function focusKeyOf(el) {
  if (!el || el === mainEl || !mainEl.contains(el)) return null;
  if (el.name) return { selector: `[name="${CSS.escape(el.name)}"]` };
  if (el.id && !el.id.startsWith('f-')) return { selector: `#${CSS.escape(el.id)}` };
  return { tag: el.tagName, text: el.textContent.trim() };
}
function restoreFocus(key) {
  let el = null;
  if (key && key.selector) el = mainEl.querySelector(key.selector);
  else if (key) el = [...mainEl.querySelectorAll(key.tag)].find((x) => x.textContent.trim() === key.text);
  (el || mainEl.querySelector('h1'))?.focus({ preventScroll: true });
}

async function showView({ soft = false } = {}) {
  const hash = location.hash || '#dashboard';
  const { name, id, params } = parseHash(hash);
  const ctx = viewContext();
  const firstRender = !current;
  const progress = document.getElementById('route-progress');

  if (firstRender) mainEl.append(loadingState());
  else if (!soft) {
    progress.hidden = false;
    mainEl.setAttribute('aria-busy', 'true');
  }

  const next = h('div', { class: 'view-content' });
  let handle = null;
  if (name === 'notfound') {
    next.append(h('h1', { class: 'sr-only' }, 'Page not found'), h('div', { class: 'card' }, emptyState({ iconName: 'search', title: 'This page doesn’t exist', text: 'The link may be out of date.', action: h('a', { href: '#dashboard', class: 'btn' }, 'Go to the dashboard') })));
  } else {
    try {
      handle = (await VIEWS[name](next, { id, params, ctx })) || null;
    } catch (error) {
      appLog.error(`Rendering ${name} failed`, { error: error.message });
      clear(next).append(h('h1', { class: 'sr-only' }, 'Something went wrong'), h('div', { class: 'card' }, errorState(error, () => showView())));
    }
  }
  if (!ctx.isCurrent()) return;

  progress.hidden = true;
  mainEl.removeAttribute('aria-busy');
  const focusKey = soft ? focusKeyOf(document.activeElement) : null;
  const scrollY = window.scrollY;
  clear(mainEl).append(next);
  current = { name, id, hash, handle };
  const heading = mainEl.querySelector('h1');
  if (heading) heading.tabIndex = -1;
  document.title = `${heading?.textContent.trim() || 'PricePulse'} · PricePulse`;

  if (soft) {
    window.scrollTo(0, scrollY);
    restoreFocus(focusKey);
  } else if (!firstRender) {
    // A new page: start at the top, and move focus to its heading so screen
    // readers announce where the user is now.
    window.scrollTo(0, 0);
    heading?.focus({ preventScroll: true });
  }
}

async function route() {
  const hash = location.hash || '#dashboard';
  const replacing = replacingRoute;
  replacingRoute = false;
  if (current && hash === current.hash) return;
  trackNavigation(hash, replacing);
  const { name, id, params } = parseHash(hash);
  setActiveNav(name);
  closeMenu();

  // Same page, different filters: the view updates itself in place.
  if (current && current.name === name && current.id === id && current.handle && current.handle.update) {
    current.hash = hash;
    await current.handle.update(params);
    return;
  }
  await showView();
}

// Re-render the current page after a change made on it, keeping scroll position and focus.
function refreshView() {
  return showView({ soft: true });
}

async function refreshUnreadBadge() {
  const bell = document.getElementById('bell-link');
  try {
    const { unreadCount } = await apiRequest('/api/notifications/unread-count', { operation: 'load unread count' });
    clear(bell).append(icon('bell', 20));
    if (unreadCount > 0) bell.append(h('span', { class: 'badge-count', 'aria-hidden': 'true' }, unreadCount > 99 ? '99+' : String(unreadCount)));
    const label = unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications';
    bell.setAttribute('aria-label', label);
    bell.title = label;
  } catch {
    /* logged by apiRequest; the badge just stays as it was */
  }
}

// Signing out of a demo also deletes it (on the server), so it goes back to the start page.
async function signOut() {
  try {
    await apiRequest('/api/auth/logout', { method: 'POST', operation: 'log out' });
  } finally {
    location.href = currentUser && currentUser.isDemo ? '/' : '/login.html';
  }
}

function closeMenu() {
  const toggle = document.getElementById('nav-toggle');
  if (toggle.getAttribute('aria-expanded') !== 'true') return;
  document.getElementById('primary-nav').classList.remove('open');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Open menu');
  clear(toggle).append(icon('menu'));
}

function setupHeader() {
  const toggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('primary-nav');
  toggle.append(icon('menu'));
  toggle.setAttribute('aria-label', 'Open menu');
  toggle.addEventListener('click', () => {
    if (toggle.getAttribute('aria-expanded') === 'true') return closeMenu();
    nav.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Close menu');
    clear(toggle).append(icon('x'));
  });
  // Esc or a click elsewhere closes the mobile menu.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      toggle.focus();
    }
  });
  document.addEventListener('click', (e) => {
    if (!nav.contains(e.target) && !toggle.contains(e.target)) closeMenu();
  });

  // The skip link's "#main" would otherwise be taken as a page address by the router.
  document.querySelector('.skip-link').addEventListener('click', (e) => {
    e.preventDefault();
    mainEl.focus();
  });

  const navIcons = { dashboard: 'dashboard', watchlist: 'list', purchases: 'bag', settings: 'settings' };
  for (const link of nav.querySelectorAll('a')) link.prepend(icon(navIcons[link.dataset.nav], 16));
  document.getElementById('add-link').prepend(icon('plus', 16));
  document.getElementById('bell-link').append(icon('bell', 20));

  const logout = document.getElementById('logout-btn');
  logout.append(icon('logout', 19));
  logout.addEventListener('click', signOut);
  document.getElementById('end-demo').addEventListener('click', signOut);
}

async function start() {
  setupHeader();
  let preferences;
  try {
    [{ user: currentUser }, { preferences }] = await Promise.all([
      apiRequest('/api/auth/me', { operation: 'load current user' }),
      apiRequest('/api/account/preferences', { operation: 'load preferences' }),
    ]);
  } catch (error) {
    if (error.status === 401) return; // apiRequest already sends the browser to the login page
    clear(mainEl).append(h('h1', { class: 'sr-only' }, 'Can’t reach PricePulse'), h('div', { class: 'card' }, errorState(error, () => location.reload(), 'Can’t reach PricePulse')));
    return;
  }
  syncThemeWithAccount(preferences);
  document.getElementById('user-name').textContent = currentUser.name;
  if (currentUser.isDemo) {
    document.getElementById('demo-banner').hidden = false;
    const logout = document.getElementById('logout-btn');
    logout.setAttribute('aria-label', 'End demo');
    logout.title = 'End demo (deletes the sample account)';
  }
  window.addEventListener('hashchange', route);
  await route();
  refreshUnreadBadge();
  setInterval(refreshUnreadBadge, 60000);
}

start();
