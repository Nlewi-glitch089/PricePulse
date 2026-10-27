// Product page (#product/<id>): summary, actions, price history, recording prices, purchase.

const PRICE_RANGE_LABELS = [
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['90d', '90 days'],
  ['all', 'All'],
];
let productRange = 'all';

async function renderProduct(root, { id, ctx }) {
  const base = `/api/watchlist/${encodeURIComponent(id)}`;
  root.append(loadingState());
  let item;
  let providers;
  try {
    [{ item }, providers] = await Promise.all([
      apiRequest(base, { operation: 'load product' }),
      apiRequest('/api/providers', { operation: 'load price sources' }),
    ]);
  } catch (error) {
    if (!ctx.isCurrent()) return;
    clear(root).append(
      h(
        'div',
        { class: 'card' },
        error.status === 404
          ? emptyState({ iconName: 'search', title: 'Product not found', text: 'It may have been removed.', action: h('a', { href: '#watchlist', class: 'btn' }, 'Back to watch list') })
          : errorState(error, refreshView),
      ),
    );
    return;
  }
  if (!ctx.isCurrent()) return;
  const p = item;

  // Any change made from this page: reload the page's data and the alert badge.
  const changed = async (message, kind) => {
    if (message) toast(message, kind);
    refreshUnreadBadge();
    await refreshView();
  };
  const run = async (button, label, fn) => {
    setBusy(button, true, label);
    try {
      await fn();
    } catch (error) {
      setBusy(button, false);
      toast(error.message, 'error');
    }
  };

  // ---- actions ----
  const actions = h('div', { class: 'row' });
  if (p.url) actions.append(h('a', { class: 'btn btn-sm', href: p.url, target: '_blank', rel: 'noopener noreferrer nofollow' }, icon('external', 15), ' View at retailer'));
  actions.append(h('a', { class: 'btn btn-sm', href: `#edit/${p.id}` }, icon('edit', 15), ' Edit'));
  if (!p.purchase) {
    actions.append(h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openPurchaseDialog(p, base, changed) }, icon('bag', 15), ' Mark purchased'));
  } else {
    const undo = h('button', { type: 'button', class: 'btn btn-sm' }, 'Undo purchase');
    undo.addEventListener('click', () => run(undo, 'Working…', async () => {
      await apiRequest(`${base}/purchase`, { method: 'DELETE', operation: 'undo purchase' });
      await changed('Purchase removed; watching again');
    }));
    actions.append(undo);
  }
  if (p.status === 'NOT_INTERESTED' || !p.purchase) {
    const next = p.status === 'NOT_INTERESTED' ? 'WATCHING' : 'NOT_INTERESTED';
    const statusBtn = h('button', { type: 'button', class: 'btn btn-sm' }, next === 'WATCHING' ? 'Watch again' : 'No longer interested');
    statusBtn.addEventListener('click', () => run(statusBtn, 'Working…', async () => {
      await apiRequest(base, { method: 'PATCH', body: { status: next }, operation: 'change status' });
      await changed(next === 'WATCHING' ? 'Watching again' : 'Marked as no longer interested');
    }));
    actions.append(statusBtn);
  }
  actions.append(
    h('button', {
      type: 'button',
      class: 'btn btn-sm btn-danger',
      onclick: async () => {
        const ok = await confirmDialog({
          title: 'Remove this product?',
          description: 'Its price history, target, and notes will be deleted. Any purchase record stays on your Purchases page.',
          confirmLabel: 'Remove product',
          destructive: true,
          action: () => apiRequest(base, { method: 'DELETE', operation: 'delete product' }),
        });
        if (ok) {
          toast('Product removed');
          replaceRoute('watchlist');
        }
      },
    }, icon('trash', 15), ' Remove'),
  );

  // ---- hero ----
  const hero = h(
    'section',
    { class: `card card-pad detail-hero${p.imageUrl ? '' : ' no-image'}` },
    p.imageUrl && h('div', { class: 'detail-image' }, productImage(p.imageUrl, `Photo of ${p.name}`)),
    h(
      'div',
      { class: 'stack', style: 'gap:12px' },
      h('h1', {}, p.name),
      h('div', { class: 'row' }, statusBadge(p.status), h('span', { class: 'small secondary' }, `${p.retailer} · ${p.category}`)),
      p.description && h('p', { class: 'secondary' }, p.description),
      priceSummary(p),
      p.purchase &&
        h(
          'div',
          { class: 'alert alert-info' },
          icon('bag'),
          h('span', {}, `Purchased ${formatDate(p.purchase.purchasedAt)} for `, h('strong', {}, formatMoney(p.purchase.price, p.purchase.currency)), ` at ${p.purchase.retailer}.`, p.purchase.notes ? ` “${p.purchase.notes}”` : ''),
        ),
      actions,
      (p.status === 'PURCHASED' || p.status === 'NOT_INTERESTED') &&
        h('p', { class: 'tiny muted' }, `Alerts are paused for this product because it’s ${p.status === 'PURCHASED' ? 'purchased' : 'marked as no longer interesting'}.`),
    ),
  );

  // ---- history ----
  const historyBody = h('div', { class: 'card-body stack' });
  const rangeButtons = PRICE_RANGE_LABELS.map(([value, label]) =>
    h('button', {
      type: 'button',
      'aria-pressed': String(productRange === value),
      onclick: (e) => {
        productRange = value;
        for (const b of rangeButtons) b.setAttribute('aria-pressed', String(b === e.currentTarget));
        loadHistory();
      },
    }, label),
  );
  const history = h(
    'section',
    { class: 'card', 'aria-labelledby': 'history-title' },
    h('div', { class: 'card-header' }, h('h2', { id: 'history-title' }, 'Price history'), h('div', { class: 'segmented', role: 'group', 'aria-label': 'Time range' }, rangeButtons)),
    historyBody,
  );

  // Switching the range keeps the current chart on screen (marked busy) until the new one is ready.
  let historyToken = 0;
  async function loadHistory() {
    const token = ++historyToken;
    historyBody.setAttribute('aria-busy', 'true');
    try {
      const data = await apiRequest(`${base}/prices`, { query: { range: productRange }, operation: 'load price history' });
      if (!ctx.isCurrent() || token !== historyToken) return;
      renderHistory(historyBody, data, p, base, changed);
    } catch (error) {
      if (ctx.isCurrent() && token === historyToken) clear(historyBody).append(errorState(error, loadHistory));
    } finally {
      if (token === historyToken) historyBody.removeAttribute('aria-busy');
    }
  }

  // ---- side column ----
  // Only when the server has an automatic price source; otherwise prices are
  // entered by hand, which the Record a price card already explains.
  let refreshCard = null;
  if (!providers.manualEntryOnly) {
    refreshCard = h('section', { class: 'card card-pad stack', style: 'gap:10px' }, h('h2', {}, 'Automatic updates'));
    if (p.url) {
      refreshCard.append(h('p', { class: 'small secondary' }, `Fetch the latest price from ${providers.providers.map((x) => x.displayName).join(', ')}.`));
      const btn = h('button', { type: 'button', class: 'btn' }, icon('refresh', 16), ' Check price now');
      btn.addEventListener('click', () => run(btn, 'Checking…', async () => {
        const r = await apiRequest(`${base}/refresh`, { method: 'POST', operation: 'check price from provider' });
        await changed(r.recorded ? `New price retrieved from ${r.provider}` : 'Price is already up to date');
      }));
      refreshCard.append(btn);
    } else {
      refreshCard.append(h('p', { class: 'small secondary' }, 'Add the product’s web address (Edit) to let PricePulse look up its price automatically. Until then, record prices by hand.'));
    }
  }

  const details = h(
    'section',
    { class: 'card card-pad' },
    h('h2', { style: 'margin-bottom:10px' }, 'Details'),
    h(
      'dl',
      { class: 'kv' },
      ...[
        ['Added', formatDate(p.createdAt)],
        ['Currency', p.currency],
        ['First recorded', formatMoney(p.firstPrice, p.currency)],
        ['List price (store)', formatMoney(p.listPrice, p.currency)],
        ['Lowest ever', formatMoney(p.lowestPrice, p.currency)],
        ['Highest ever', formatMoney(p.highestPrice, p.currency)],
      ].flatMap(([k, v]) => [h('dt', {}, k), h('dd', { class: 'num' }, v)]),
    ),
    p.notes && [h('h3', { style: 'margin-top:14px' }, 'Your notes'), h('p', { class: 'small secondary', style: 'white-space:pre-wrap;margin-top:4px' }, p.notes)],
  );

  clear(root).append(
    h(
      'div',
      { class: 'stack' },
      backLink('#watchlist', 'Watch List'),
      hero,
      h('div', { class: 'layout-2col' }, history, h('aside', { class: 'stack' }, recordPriceCard(p, base, changed), refreshCard, details)),
    ),
  );
  // Wait for the history so the page appears complete rather than with a spinner inside it.
  await loadHistory();
}

// Current, list, and target prices side by side, each saying where it comes from.
function priceSummary(p) {
  const gap = p.targetPrice !== null && p.currentPrice !== null ? Math.round((p.currentPrice - p.targetPrice) * 100) / 100 : null;
  const cell = (label, value, ...notes) => h('div', { class: 'price-cell' }, h('dt', {}, label), h('dd', {}, value, ...notes.filter(Boolean).map((n) => h('span', { class: 'price-note' }, n))));
  return h(
    'dl',
    { class: 'price-summary' },
    cell(
      'Current price',
      p.currentPrice === null ? h('span', { class: 'price-none' }, 'Not recorded yet') : h('span', { class: 'price-big num' }, formatMoney(p.currentPrice, p.currency)),
      p.lastPriceAt && `Latest price you recorded, ${formatRelative(p.lastPriceAt)}`,
      p.lastChange && ['Last change ', priceDelta(p.lastChange.amount, p.lastChange.percent, p.currency)],
    ),
    cell(
      'List price',
      p.listPrice === null ? h('span', { class: 'price-none' }, 'Not known') : h('span', { class: 'price-mid num' }, formatMoney(p.listPrice, p.currency)),
      p.listPrice === null ? 'Add the store’s regular price (Edit) to see the discount.' : 'The store’s regular price, as you entered it',
      listDiscountText(p),
    ),
    cell(
      'Your target',
      p.targetPrice === null ? h('span', { class: 'price-none' }, 'None set') : h('span', { class: 'price-mid num' }, formatMoney(p.targetPrice, p.currency)),
      p.targetMet ? h('span', { class: 'delta-down' }, 'Reached') : gap !== null && gap > 0 ? `${formatMoney(gap, p.currency)} to go` : null,
    ),
  );
}

function renderHistory(container, data, item, base, changed) {
  clear(container);
  const s = data.stats;
  if (s.count === 0) {
    container.append(
      emptyState({
        compact: true,
        title: data.range === 'all' ? 'No prices recorded yet' : 'No prices recorded in this period',
        text: data.range === 'all' ? 'Record the current price to start building this product’s history.' : 'Try a longer time range.',
      }),
    );
    return;
  }
  const stat = (label, value, note) => h('div', {}, h('div', { class: 'tiny muted' }, label), h('div', { class: 'num', style: 'font-weight:650' }, value), note && h('div', { class: 'tiny muted' }, note));
  // appendChildren (not Element.append) so the `false` from a skipped condition isn't printed.
  appendChildren(container, [
    h(
      'div',
      { class: 'grid-4', style: 'gap:16px' },
      stat('Latest in period', formatMoney(s.current, data.currency)),
      stat('Lowest', formatMoney(s.lowest, data.currency)),
      stat('Highest', formatMoney(s.highest, data.currency)),
      stat('Average', formatMoney(s.average, data.currency), `of ${s.count} record${s.count === 1 ? '' : 's'}`),
    ),
    h(
      'div',
      { class: 'spread' },
      h('span', { class: 'small secondary' }, 'Change over period'),
      s.change === null ? h('span', { class: 'small muted' }, 'Needs at least 2 records in this period') : priceDelta(s.change, s.changePercent, data.currency),
    ),
    s.count === 1 && h('p', { class: 'tiny muted' }, 'Only one price has been recorded in this period, so there’s no trend to show yet.'),
  ]);
  renderPriceChart(container, { points: data.points, currency: data.currency, targetPrice: item.targetPrice });

  const rows = [...data.points].reverse().map((pt) =>
    h(
      'tr',
      {},
      h('td', {}, formatDateTime(pt.observedAt)),
      h('td', { class: 'right num' }, formatMoney(pt.price, pt.currency)),
      h('td', {}, sourceBadge(pt)),
      h('td', { class: 'hide-sm small secondary' }, pt.note || ''),
      h(
        'td',
        { class: 'right' },
        pt.deletable &&
          h('button', {
            type: 'button',
            class: 'btn btn-sm btn-icon btn-danger',
            title: 'Delete record',
            'aria-label': `Delete record of ${formatMoney(pt.price, pt.currency)} on ${formatDateTime(pt.observedAt)}`,
            onclick: async () => {
              const ok = await confirmDialog({
                title: 'Delete this price record?',
                description: `${formatMoney(pt.price, pt.currency)} recorded ${formatDateTime(pt.observedAt)}. Statistics will be recalculated.`,
                confirmLabel: 'Delete record',
                destructive: true,
                action: () => apiRequest(`${base}/prices/${pt.id}`, { method: 'DELETE', operation: 'delete price record' }),
              });
              if (ok) await changed('Price record deleted');
            },
          }, icon('trash', 15)),
      ),
    ),
  );
  container.append(
    h(
      'details',
      {},
      h('summary', { class: 'small', style: 'cursor:pointer;font-weight:600' }, `Price records (${data.points.length})`),
      h(
        'div',
        { class: 'table-wrap', style: 'margin-top:8px' },
        h(
          'table',
          { class: 'table' },
          h('caption', { class: 'sr-only' }, 'All price records in the selected period'),
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Recorded'), h('th', { scope: 'col', class: 'right' }, 'Price'), h('th', { scope: 'col' }, 'Source'), h('th', { scope: 'col', class: 'hide-sm' }, 'Note'), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Actions')))),
          h('tbody', {}, rows),
        ),
      ),
    ),
  );
}

function recordPriceCard(item, base, changed) {
  const price = moneyInput(item.currency, '');
  const when = h('input', { class: 'input', type: 'datetime-local', max: toLocalInputValue() });
  const note = h('input', { class: 'input', maxlength: 500, placeholder: 'Optional, e.g. "in-store price"' });
  const alertBox = h('div', {});
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Record price');
  const form = h(
    'form',
    { class: 'stack', style: 'gap:12px', novalidate: true },
    alertBox,
    field({ label: 'Price', name: 'price', control: price, required: true }),
    field({ label: 'Date and time seen', name: 'observedAt', control: when, hint: 'Leave empty to use right now.' }),
    field({ label: 'Note', name: 'note', control: note }),
    h('div', { class: 'form-actions' }, submit),
  );
  const priceInput = price.querySelector('input');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clear(alertBox);
    const problems = {
      price: validators.price(priceInput.value, 'Price', true),
      observedAt: when.value && new Date(when.value).getTime() > Date.now() + 60000 ? 'Date can’t be in the future.' : undefined,
    };
    showFieldErrors(form, problems);
    if (Object.values(problems).some(Boolean)) return;
    setBusy(submit, true, 'Saving…');
    try {
      const res = await apiRequest(`${base}/prices`, {
        method: 'POST',
        body: { price: parsePrice(priceInput.value), observedAt: when.value ? new Date(when.value).toISOString() : undefined, note: note.value.trim() || undefined },
        operation: 'record price',
      });
      if (res.notificationsCreated > 0) {
        toast(res.item.status === 'TARGET_REACHED' ? 'Target price reached! An alert was added.' : 'Price drop alert added', 'info');
      }
      await changed('Price recorded');
    } catch (error) {
      setBusy(submit, false);
      alertBox.append(formAlert(error.message));
      if (error.fields) showFieldErrors(form, error.fields);
    }
  });

  return h(
    'section',
    { class: 'card card-pad' },
    h('h2', {}, 'Record a price'),
    h('p', { class: 'small secondary', style: 'margin:4px 0 14px' }, 'Saw a new price? Record it here to add it to the history. Only you can see the prices you enter.'),
    form,
  );
}

function openPurchaseDialog(item, base, changed) {
  const price = moneyInput(item.currency, item.currentPrice ?? '');
  const date = h('input', { class: 'input', type: 'date', max: toLocalDateValue(), value: toLocalDateValue() });
  const retailer = h('input', { class: 'input', maxlength: 100, value: item.retailer });
  const notes = h('textarea', { class: 'textarea', maxlength: 2000 });
  const alertBox = h('div', {});
  const cancel = h('button', { type: 'button', class: 'btn' }, 'Cancel');
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save purchase');
  const form = h(
    'form',
    { class: 'stack', style: 'gap:12px', novalidate: true },
    alertBox,
    h(
      'div',
      { class: 'form-grid' },
      field({ label: 'Price paid', name: 'price', control: price, required: true }),
      field({ label: 'Purchase date', name: 'purchasedAt', control: date, required: true }),
      field({ label: 'Retailer', name: 'retailer', control: retailer, className: 'full' }),
      field({ label: 'Notes', name: 'notes', control: notes, className: 'full' }),
    ),
    h('div', { class: 'form-actions' }, cancel, submit),
  );
  const { close } = openDialog({ title: 'Mark as purchased', description: 'Its price history is kept, and alerts stop for this product.', body: form });
  cancel.addEventListener('click', close);
  const priceInput = price.querySelector('input');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clear(alertBox);
    const problems = {
      price: validators.price(priceInput.value, 'Price paid', true),
      purchasedAt: !date.value ? 'Purchase date is required.' : date.value > toLocalDateValue() ? 'Date can’t be in the future.' : undefined,
    };
    showFieldErrors(form, problems);
    if (Object.values(problems).some(Boolean)) return;
    setBusy(submit, true, 'Saving…');
    try {
      await apiRequest(`${base}/purchase`, {
        method: 'POST',
        // Past days use noon local time so the date can't shift across time zones;
        // today uses "now", since noon may still be in the future.
        body: {
          price: parsePrice(priceInput.value),
          purchasedAt: (date.value === toLocalDateValue() ? new Date() : new Date(`${date.value}T12:00:00`)).toISOString(),
          retailer: retailer.value.trim(),
          notes: notes.value.trim(),
        },
        operation: 'record purchase',
      });
      close();
      await changed('Marked as purchased');
    } catch (error) {
      setBusy(submit, false);
      alertBox.append(formAlert(error.message));
      if (error.fields) showFieldErrors(form, error.fields);
    }
  });
}
