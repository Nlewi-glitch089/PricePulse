// Product card (watch-list grid) and compact list row (dashboard).
//
// The card's link is the product name (a heading), stretched over the whole card
// with CSS, so the card is one click target but screen readers hear a short link
// name and can still read the price, change, and target as text.

function productCard(item) {
  const price = item.currentPrice === null ? null : formatMoney(item.currentPrice, item.currency);
  return h(
    'li',
    { class: `card product-card${item.imageUrl ? '' : ' no-image'}${item.status === 'TARGET_REACHED' ? ' is-target' : ''}` },
    item.imageUrl && h('div', { class: 'product-thumb' }, productImage(item.imageUrl, '')),
    h(
      'div',
      { class: 'product-card-body' },
      statusBadgeIfNotable(item.status) && h('div', {}, statusBadge(item.status)),
      h('h2', { class: 'product-name' }, h('a', { href: `#product/${item.id}`, class: 'stretched-link' }, item.name)),
      h('div', { class: 'product-meta' }, `${item.retailer} · ${item.category}`),
      h(
        'div',
        { class: 'price-row' },
        h(
          'div',
          {},
          h('div', { class: 'price-big num' }, price === null ? h('span', { class: 'muted small' }, 'No price yet') : price),
          item.lastPriceAt && h('div', { class: 'tiny muted' }, `Recorded ${formatRelative(item.lastPriceAt)}`),
        ),
        item.lastChange && priceDelta(item.lastChange.amount, item.lastChange.percent, item.currency, { showAmount: false }),
      ),
      listPriceLine(item),
      targetIndicator(item),
    ),
  );
}

function productCardSkeleton() {
  return h(
    'li',
    { class: 'card product-card no-image', 'aria-hidden': 'true' },
    h(
      'div',
      { class: 'product-card-body' },
      h('div', { class: 'skeleton', style: 'height:18px;width:85%' }),
      h('div', { class: 'skeleton', style: 'height:14px;width:50%' }),
      h('div', { class: 'skeleton', style: 'height:26px;width:40%;margin-top:12px' }),
    ),
  );
}

// A row linking to a product, with something on the right (price, badge…).
function itemRow(item, right) {
  return h(
    'li',
    {},
    h(
      'a',
      { href: `#product/${item.id}`, class: 'list-row list-link' },
      miniThumb(item.imageUrl),
      h('span', { class: 'grow' }, h('span', { class: 'row-title truncate' }, item.name), h('span', { class: 'tiny muted truncate' }, `${item.retailer} · ${item.category}`)),
      h('span', { class: 'row-end' }, right),
    ),
  );
}
