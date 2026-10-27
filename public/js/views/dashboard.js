// Dashboard: counts and lists computed by the server from the user's own data.
// What needs attention comes first (products at target, then price movement);
// sections with nothing to show stay short instead of filling the page.

function dashboardSection(title, link, body, className = '') {
  const id = `dash-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return h(
    'section',
    { class: `card ${className}`, 'aria-labelledby': id },
    h('div', { class: 'card-header' }, h('h2', { id }, title), link && h('a', { href: link.href, class: 'small' }, link.label, h('span', { class: 'sr-only' }, `: ${title}`))),
    body,
  );
}

function statTile(label, value, sub, href) {
  return h('li', {}, h('a', { href, class: 'card stat' }, h('span', { class: 'stat-value num' }, String(value)), h('span', { class: 'stat-label' }, label), sub && h('span', { class: 'stat-sub' }, sub)));
}

async function renderDashboard(root, { ctx }) {
  const d = await apiRequest('/api/dashboard', { operation: 'load dashboard' });
  if (!ctx.isCurrent()) return;

  const firstName = currentUser.name.split(' ')[0];
  if (d.counts.total === 0) {
    root.append(
      h('div', { class: 'page-header' }, h('div', {}, h('h1', {}, `Welcome, ${firstName}`), h('p', {}, 'PricePulse works best with a few products you’re deciding on.'))),
      h(
        'section',
        { class: 'card card-pad onboarding', 'aria-labelledby': 'getting-started' },
        h('h2', { id: 'getting-started' }, 'Getting started'),
        h(
          'ol',
          { class: 'steps' },
          h('li', {}, h('strong', {}, 'Add a product'), h('span', {}, 'with today’s price and the price you’d be happy to pay.')),
          h('li', {}, h('strong', {}, 'Record new prices'), h('span', {}, 'when you see them. Each one is kept, so you can see the lows and highs.')),
          h('li', {}, h('strong', {}, 'Get an alert'), h('span', {}, 'here when a recorded price reaches your target.')),
        ),
        h('a', { href: '#add', class: 'btn btn-primary' }, icon('plus', 16), 'Add your first product'),
      ),
    );
    return;
  }

  const list = (items, right, empty) => (items.length ? h('ul', { class: 'list' }, items.map((i) => itemRow(i, right(i)))) : emptyState({ compact: true, ...empty }));
  const atTarget = d.targetReached.length > 0;

  root.append(
    h(
      'div',
      { class: 'stack' },
      h('div', { class: 'page-header' }, h('div', {}, h('h1', {}, `Hi, ${firstName}`), h('p', {}, atTarget ? `${d.targetReached.length} of your products ${d.targetReached.length === 1 ? 'is' : 'are'} at or below your target price.` : 'Nothing has reached your target yet. Here’s how prices are moving.'))),
      h(
        'ul',
        { class: 'stat-row', 'aria-label': 'Summary' },
        statTile('Watching', d.counts.watching, null, '#watchlist'),
        statTile('At or below target', d.counts.targetReached, null, '#watchlist?target=met'),
        statTile('Purchased', d.counts.purchased, null, '#purchases'),
        statTile('Unread alerts', d.counts.unreadNotifications, null, '#notifications'),
      ),
      atTarget &&
        dashboardSection(
          'At your target',
          d.counts.targetReached > d.targetReached.length && { href: '#watchlist?target=met', label: 'See all' },
          list(d.targetReached, (i) => [h('span', { class: 'row-price num' }, formatMoney(i.currentPrice, i.currency)), h('span', { class: 'tiny delta-down' }, `Target ${formatMoney(i.targetPrice, i.currency)}`)]),
          'section-good',
        ),
      h(
        'div',
        { class: 'grid-2' },
        dashboardSection(
          'Recent price changes',
          d.recentChanges.length > 0 && { href: '#watchlist?sort=recent_change', label: 'See all' },
          list(
            d.recentChanges,
            (i) => [h('span', { class: 'row-price num' }, formatMoney(i.currentPrice, i.currency)), i.lastChange && priceDelta(i.lastChange.amount, i.lastChange.percent, i.currency, { showAmount: false }), h('span', { class: 'tiny muted' }, formatRelative(i.lastPriceChangeAt))],
            { title: 'No price changes yet', text: 'Record a new price on a product’s page to see changes here.' },
          ),
        ),
        dashboardSection(
          'Largest drops',
          d.biggestDrops.length > 0 && { href: '#watchlist?sort=drop', label: 'See all' },
          list(
            d.biggestDrops,
            (i) => [priceDelta(i.totalChange, i.totalChangePercent, i.currency), h('span', { class: 'tiny muted num' }, `${formatMoney(i.firstPrice, i.currency)} → ${formatMoney(i.currentPrice, i.currency)}`)],
            { title: 'No drops yet', text: 'Measured from each product’s first recorded price.' },
          ),
        ),
      ),
      h(
        'div',
        { class: 'grid-2' },
        dashboardSection(
          'Recent alerts',
          d.recentAlerts.length > 0 && { href: '#notifications', label: 'All notifications' },
          d.recentAlerts.length
            ? h(
                'ul',
                { class: 'list' },
                d.recentAlerts.map((n) =>
                  h(
                    'li',
                    { class: `list-row${n.read ? '' : ' is-unread'}` },
                    h('span', { class: n.type === 'TARGET_REACHED' ? 'delta-down' : 'secondary', 'aria-hidden': 'true' }, icon(n.type === 'TARGET_REACHED' ? 'target' : 'arrowDown')),
                    h(
                      'div',
                      { class: 'grow' },
                      h('div', { class: 'row-title' }, !n.read && h('span', { class: 'sr-only' }, 'Unread: '), n.entryId ? h('a', { href: `#product/${n.entryId}` }, n.title) : n.title),
                      h('div', { class: 'small secondary' }, n.message),
                    ),
                    h('span', { class: 'tiny muted' }, formatRelative(n.createdAt)),
                  ),
                ),
              )
            : emptyState({ compact: true, title: 'No alerts yet', text: 'You’ll get one when a recorded price reaches one of your targets.' }),
        ),
        dashboardSection(
          'Recently added',
          { href: '#watchlist', label: 'Watch List' },
          list(d.recentlyAdded, (i) => [statusBadgeIfNotable(i.status), h('span', { class: 'tiny muted' }, formatRelative(i.createdAt))], { title: 'Nothing yet' }),
        ),
      ),
    ),
  );
}
