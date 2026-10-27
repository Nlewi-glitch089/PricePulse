// Watch List: search, filters, sorting, and pages. The filters live in the
// URL (#watchlist?status=all&sort=price&order=asc), so reloads, links, and the
// browser's Back button keep them.
//
// The page is built once; changing a filter only replaces the results (the old
// results stay on screen, marked busy, until the new ones arrive), so the
// toolbar keeps its place and the search box keeps focus while typing.

const WATCHLIST_DEFAULTS = { status: 'active', target: 'any', sort: 'added', order: 'desc', page: '1' };
const WATCHLIST_SORTS = [
  ['added:desc', 'Recently added'],
  ['recent_change:desc', 'Latest price change'],
  ['drop:desc', 'Biggest price drop'],
  ['price:asc', 'Price: low to high'],
  ['price:desc', 'Price: high to low'],
  ['target:asc', 'Target: low to high'],
  ['target:desc', 'Target: high to low'],
  ['name:asc', 'Name: A–Z'],
  ['name:desc', 'Name: Z–A'],
];

function watchlistQuery(params) {
  const get = (k) => params.get(k) || WATCHLIST_DEFAULTS[k] || '';
  return {
    q: get('q'),
    category: get('category'),
    retailer: get('retailer'),
    status: get('status'),
    target: get('target'),
    sort: get('sort'),
    order: get('order'),
    page: Number(get('page')) || 1,
    pageSize: 12,
  };
}

// Filters that narrow the list (sorting and paging don't count).
function activeFilterCount(query) {
  return [query.q, query.category, query.retailer, query.status !== 'active', query.target !== 'any'].filter(Boolean).length;
}

async function renderWatchlist(root, { params, ctx }) {
  let query = watchlistQuery(params);
  let loadToken = 0;

  // Changing a filter rewrites the URL; the router then calls update() below.
  function setFilters(changes) {
    const next = new URLSearchParams(location.hash.split('?')[1] || '');
    for (const [k, v] of Object.entries(changes)) {
      if (!v || v === WATCHLIST_DEFAULTS[k]) next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in changes)) next.delete('page');
    const qs = next.toString();
    location.hash = `watchlist${qs ? `?${qs}` : ''}`;
  }

  const filterField = (label, control) => {
    const id = `wl-${label.toLowerCase().replace(/\W+/g, '-')}`;
    control.id = id;
    return h('div', { class: 'field filter-field' }, h('label', { for: id }, label), control);
  };
  const select = (options, onChange) => {
    const el = h('select', { class: 'select' }, options.map(([v, text]) => h('option', { value: v }, text)));
    el.addEventListener('change', () => onChange(el.value));
    return el;
  };

  const search = h('input', { id: 'wl-search', class: 'input', type: 'search', placeholder: 'Product name', autocomplete: 'off' });
  let debounce;
  search.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => setFilters({ q: search.value.trim() }), 300);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(debounce);
      setFilters({ q: search.value.trim() });
    }
  });

  const controls = {
    status: select([['active', 'Active'], ['WATCHING', 'Watching'], ['TARGET_REACHED', 'Target reached'], ['PURCHASED', 'Purchased'], ['NOT_INTERESTED', 'No longer interested'], ['all', 'All']], (v) => setFilters({ status: v })),
    target: select([['any', 'Any'], ['met', 'At or below target'], ['unmet', 'Above target'], ['none', 'No target set']], (v) => setFilters({ target: v })),
    category: select([['', 'All']], (v) => setFilters({ category: v })),
    retailer: select([['', 'All']], (v) => setFilters({ retailer: v })),
    sort: select(WATCHLIST_SORTS, (v) => {
      const [sort, order] = v.split(':');
      setFilters({ sort, order });
    }),
  };

  const clearButton = h('button', { type: 'button', class: 'btn btn-sm', onclick: () => (location.hash = 'watchlist') }, icon('x', 15), 'Clear filters');
  const filtersToggle = h('button', { type: 'button', class: 'btn btn-sm filters-toggle', 'aria-expanded': 'false', 'aria-controls': 'wl-filters' });
  const filtersPanel = h(
    'div',
    { class: 'filters-panel', id: 'wl-filters' },
    filterField('Status', controls.status),
    filterField('Target price', controls.target),
    filterField('Category', controls.category),
    filterField('Retailer', controls.retailer),
  );
  filtersToggle.addEventListener('click', () => {
    const open = filtersPanel.classList.toggle('open');
    filtersToggle.setAttribute('aria-expanded', String(open));
  });

  const toolbar = h(
    'section',
    { class: 'card toolbar', role: 'search', 'aria-label': 'Search and filter products' },
    h(
      'div',
      { class: 'toolbar-main' },
      h('div', { class: 'field search' }, h('label', { for: 'wl-search' }, 'Search'), h('div', { class: 'input-group' }, h('span', { class: 'addon', 'aria-hidden': 'true' }, icon('search', 16)), search)),
      filterField('Sort by', controls.sort),
      filtersToggle,
    ),
    filtersPanel,
    h('div', { class: 'toolbar-foot' }, clearButton),
  );

  const summary = h('p', {}, '');
  const results = h('div', { class: 'results' });

  // Puts the URL's values into the controls (needed after Back/Forward too).
  function syncControls() {
    if (document.activeElement !== search) search.value = query.q;
    controls.status.value = query.status;
    controls.target.value = query.target;
    controls.category.value = query.category;
    controls.retailer.value = query.retailer;
    controls.sort.value = `${query.sort}:${query.order}`;
    const count = activeFilterCount(query);
    const panelCount = [query.category, query.retailer, query.status !== 'active', query.target !== 'any'].filter(Boolean).length;
    clear(filtersToggle).append(icon('filter', 15), panelCount ? `Filters (${panelCount})` : 'Filters');
    clearButton.parentElement.hidden = count === 0;
  }

  async function load({ initial = false } = {}) {
    const token = ++loadToken;
    results.setAttribute('aria-busy', 'true');
    let list;
    let facets;
    try {
      [list, facets] = await Promise.all([
        apiRequest('/api/watchlist', { query, operation: 'load watch list' }),
        apiRequest('/api/watchlist/facets', { operation: 'load filters' }),
      ]);
    } catch (error) {
      if (token !== loadToken || !ctx.isCurrent()) return;
      results.removeAttribute('aria-busy');
      clear(results).append(h('div', { class: 'card' }, errorState(error, () => load())));
      return;
    }
    if (token !== loadToken || !ctx.isCurrent()) return;

    // Category / retailer choices come from the user's own products.
    // appendChildren, not Element.append: append() would turn the arrays into text.
    appendChildren(clear(controls.category), [h('option', { value: '' }, 'All'), facets.categories.map((c) => h('option', { value: c.value }, `${c.value} (${c.count})`))]);
    appendChildren(clear(controls.retailer), [h('option', { value: '' }, 'All'), facets.retailers.map((r) => h('option', { value: r }, r))]);
    syncControls();

    const everAdded = Object.values(facets.statusCounts).reduce((a, b) => a + b, 0);
    const filtersActive = activeFilterCount(query) > 0;
    toolbar.hidden = everAdded === 0;
    summary.textContent =
      everAdded === 0 ? 'Products you’re keeping an eye on.' : `${list.total} product${list.total === 1 ? '' : 's'}${filtersActive ? ' match' : query.status === 'active' ? ' being watched' : ''}`;
    if (!initial) announce(list.total === 0 ? 'No products match.' : `${list.total} product${list.total === 1 ? '' : 's'} found.`);

    results.removeAttribute('aria-busy');
    clear(results);
    if (list.items.length === 0) {
      results.append(
        h(
          'div',
          { class: 'card' },
          everAdded === 0
            ? emptyState({
                title: 'Nothing on your watch list yet',
                text: 'Add a product you’re thinking about buying, with the price you’d be happy to pay. PricePulse keeps its price history and tells you when it gets there.',
                action: h('a', { href: '#add', class: 'btn btn-primary' }, icon('plus', 16), 'Add your first product'),
              })
            : emptyState({
                iconName: 'search',
                title: filtersActive ? 'No products match these filters' : 'No products here',
                text: filtersActive ? 'Try a different search, or clear the filters to see everything.' : undefined,
                action: filtersActive && h('a', { href: '#watchlist', class: 'btn' }, 'Clear filters'),
              }),
        ),
      );
      return;
    }
    appendChildren(results, [
      h('ul', { class: 'product-grid', 'aria-label': 'Products' }, list.items.map(productCard)),
      pagination(list.page, list.totalPages, (p) => setFilters({ page: String(p) })),
    ]);
  }

  root.append(h('div', { class: 'page-header' }, h('div', {}, h('h1', {}, 'Watch List'), summary)), toolbar, results);
  syncControls();
  await load({ initial: true });

  return {
    update(nextParams) {
      const pageChanged = (nextParams.get('page') || '1') !== String(query.page);
      query = watchlistQuery(nextParams);
      syncControls();
      if (pageChanged) results.scrollIntoView({ block: 'start' });
      return load();
    },
  };
}
