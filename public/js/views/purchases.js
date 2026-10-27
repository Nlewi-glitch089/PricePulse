// Purchases (#purchases): what was bought and how it compares with recorded prices.

async function renderPurchases(root, { params, ctx }) {
  const page = Number(params.get('page')) || 1;
  root.append(
    h('div', { class: 'page-header' }, h('div', {}, h('h1', {}, 'Purchases'), h('p', {}, 'What you bought, what you paid, and how it compares with the prices you recorded.'))),
  );
  const body = h('div', {}, loadingState());
  root.append(body);

  let data;
  try {
    data = await apiRequest('/api/purchases', { query: { page }, operation: 'load purchases' });
  } catch (error) {
    if (ctx.isCurrent()) clear(body).append(h('div', { class: 'card' }, errorState(error, refreshView)));
    return;
  }
  if (!ctx.isCurrent()) return;
  clear(body);

  if (data.items.length === 0) {
    body.append(
      h(
        'div',
        { class: 'card' },
        emptyState({
          iconName: 'bag',
          title: 'No purchases yet',
          text: 'When you buy something you’re watching, open it and choose “Mark purchased” to keep a record here.',
          action: h('a', { href: '#watchlist', class: 'btn' }, 'Go to watch list'),
        }),
      ),
    );
    return;
  }

  const rows = data.items.map((p) => {
    const lowest = p.entry ? p.entry.lowestRecordedPrice : null;
    const vsLowest = lowest !== null ? Math.round((p.price - lowest) * 100) / 100 : null;
    return h(
      'tr',
      {},
      h(
        'td',
        {},
        h(
          'div',
          { class: 'row', style: 'flex-wrap:nowrap' },
          miniThumb(p.entry ? p.entry.imageUrl : null, p.productName),
          h(
            'div',
            { style: 'min-width:0' },
            p.entry ? h('a', { href: `#product/${p.entry.id}`, style: 'font-weight:600' }, p.productName) : h('span', { style: 'font-weight:600' }, p.productName),
            p.notes && h('div', { class: 'tiny muted truncate' }, p.notes),
            !p.entry && h('div', { class: 'tiny muted' }, 'Product removed from your list'),
          ),
        ),
      ),
      h('td', {}, formatDate(p.purchasedAt)),
      h('td', { class: 'hide-sm' }, p.retailer),
      h('td', { class: 'right num', style: 'font-weight:650' }, formatMoney(p.price, p.currency)),
      h(
        'td',
        { class: 'right num hide-sm' },
        lowest === null
          ? h('span', { class: 'muted' }, '—')
          : [
              formatMoney(lowest, p.currency),
              vsLowest <= 0 ? h('div', { class: 'tiny delta-down' }, 'You paid the lowest recorded price') : h('div', { class: 'tiny muted' }, `${formatMoney(vsLowest, p.currency)} above lowest`),
            ],
      ),
    );
  });

  body.append(
    h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'row' },
        data.totals.map((t) =>
          h('div', { class: 'card stat', style: 'min-width:200px' }, h('div', { class: 'stat-label' }, `Total spent (${t.currency})`), h('div', { class: 'stat-value' }, formatMoney(t.spent, t.currency)), h('div', { class: 'stat-sub' }, `${t.count} purchase${t.count === 1 ? '' : 's'}`)),
        ),
      ),
      h(
        'div',
        { class: 'card table-wrap' },
        h(
          'table',
          { class: 'table' },
          h('caption', { class: 'sr-only' }, 'Your purchases'),
          h(
            'thead',
            {},
            h('tr', {}, h('th', { scope: 'col' }, 'Product'), h('th', { scope: 'col' }, 'Date'), h('th', { scope: 'col', class: 'hide-sm' }, 'Retailer'), h('th', { scope: 'col', class: 'right' }, 'Paid'), h('th', { scope: 'col', class: 'right hide-sm' }, 'Lowest recorded')),
          ),
          h('tbody', {}, rows),
        ),
      ),
      pagination(data.page, data.totalPages, (n) => (location.hash = `purchases?page=${n}`)),
    ),
  );
}
