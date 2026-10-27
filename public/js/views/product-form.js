// Add product (#add) and edit product (#edit/<id>), sharing one form.

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR', 'MXN'];

function moneyInput(currency, value) {
  return h('div', { class: 'input-group' }, h('span', { class: 'addon', 'data-currency-addon': '' }, currency), h('input', { class: 'input num', inputmode: 'decimal', placeholder: '0.00', value: value ?? '' }));
}

function buildProductForm({ mode, item, facets, defaultCurrency }) {
  const currency = item ? item.currency : defaultCurrency;
  const input = (attrs) => h('input', { class: 'input', ...attrs });
  const datalist = (id, values) => h('datalist', { id }, values.map((v) => h('option', { value: v })));

  const controls = {
    name: input({ value: item?.name ?? '', maxlength: 200, autocomplete: 'off' }),
    url: input({ type: 'url', inputmode: 'url', placeholder: 'https://', value: item?.url ?? '' }),
    retailer: input({ value: item?.retailer ?? '', maxlength: 100, list: 'retailer-options' }),
    category: input({ value: item?.category ?? '', maxlength: 60, list: 'category-options', placeholder: 'e.g. Electronics' }),
    currency: h('select', { class: 'select' }, CURRENCIES.map((c) => h('option', { value: c }, c))),
    currentPrice: moneyInput(currency, ''),
    targetPrice: moneyInput(currency, item?.targetPrice ?? ''),
    listPrice: moneyInput(currency, item?.listPrice ?? ''),
    imageUrl: input({ type: 'url', inputmode: 'url', placeholder: 'https://', value: item?.imageUrl ?? '' }),
    description: h('textarea', { class: 'textarea', maxlength: 2000 }, item?.description ?? ''),
    notes: h('textarea', { class: 'textarea', maxlength: 2000 }, item?.notes ?? ''),
  };
  controls.currency.value = currency;
  controls.currency.disabled = mode === 'edit'; // currency is chosen once, when the product is added
  // Keep the currency shown next to price boxes in sync.
  controls.currency.addEventListener('change', () => {
    for (const addon of form.querySelectorAll('[data-currency-addon]')) addon.textContent = controls.currency.value;
  });
  // A pasted web address suggests the retailer (its domain) when that's still empty.
  // Nothing is fetched from the page: name and prices are still entered by hand.
  controls.url.addEventListener('change', () => {
    if (controls.retailer.value.trim()) return;
    try {
      const host = new URL(controls.url.value.trim()).hostname.replace(/^www./, '');
      if (host) controls.retailer.value = host;
    } catch {
      /* not a full address yet; validation explains on submit */
    }
  });

  const valueOf = (name) => {
    const c = controls[name];
    return (c.matches('input,select,textarea') ? c : c.querySelector('input')).value;
  };

  const alertBox = h('div', {});
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, mode === 'create' ? 'Add to watch list' : 'Save changes');
  const cancel =
    mode === 'create'
      ? backLink('#watchlist', 'Watch List', { className: 'btn', text: 'Cancel' })
      : backLink(`#product/${item.id}`, 'product', { from: ['product'], className: 'btn', text: 'Cancel' });

  // Optional extras stay folded away unless the product already has some.
  const more = h(
    'details',
    { class: 'form-more', open: Boolean(item && (item.imageUrl || item.description || item.notes)) },
    h('summary', {}, 'More details', h('span', { class: 'muted' }, ' (optional): photo, description, notes')),
    h(
      'div',
      { class: 'form-grid' },
      field({ label: 'Image URL', name: 'imageUrl', control: controls.imageUrl, className: 'full', hint: 'A link to a photo of the product, starting with https://.' }),
      field({ label: 'Description', name: 'description', control: controls.description, className: 'full' }),
      field({ label: 'Private notes', name: 'notes', control: controls.notes, className: 'full', hint: 'Only you can see these.' }),
    ),
  );

  const form = h(
    'form',
    { class: 'card card-pad stack product-form', novalidate: true },
    h('p', { class: 'small secondary' }, 'Fields marked ', h('span', { class: 'req', 'aria-hidden': 'true' }, '*'), h('span', { class: 'sr-only' }, 'with an asterisk'), ' are required.'),
    alertBox,
    h(
      'fieldset',
      {},
      h('legend', {}, 'Product'),
      h(
        'div',
        { class: 'form-grid' },
        field({ label: 'Product name', name: 'name', control: controls.name, required: true, className: 'full' }),
        field({
          label: 'Product web address',
          name: 'url',
          control: controls.url,
          className: 'full',
          hint: 'Optional. Fills in the retailer for you and helps catch duplicates. PricePulse doesn’t read prices from the page.',
        }),
        field({ label: 'Retailer', name: 'retailer', control: controls.retailer, required: true }),
        field({ label: 'Category', name: 'category', control: controls.category, required: true }),
        datalist('retailer-options', facets ? facets.retailers : []),
        datalist('category-options', facets ? facets.categories.map((c) => c.value) : []),
      ),
    ),
    h(
      'fieldset',
      {},
      h('legend', {}, 'Price'),
      h(
        'div',
        { class: 'form-grid' },
        mode === 'create' && field({ label: 'Price today', name: 'currentPrice', control: controls.currentPrice, hint: 'Optional. The price you see now; starts the price history.' }),
        field({ label: 'List price', name: 'listPrice', control: controls.listPrice, hint: 'Optional. The store’s regular or “was” price, if it shows one. Used to work out the discount; it isn’t added to the history.' }),
        field({ label: 'Target price', name: 'targetPrice', control: controls.targetPrice, hint: 'You’ll get an alert when a recorded price is at or below this.' }),
        field({ label: 'Currency', name: 'currency', control: controls.currency, hint: mode === 'edit' ? 'Can’t be changed after adding.' : undefined }),
      ),
      mode === 'edit' && h('p', { class: 'small secondary form-note' }, 'To add a new price, use “Record a price” on the product’s page, so the history stays accurate.'),
    ),
    more,
    h('div', { class: 'form-actions' }, cancel, submit),
  );

  function check() {
    return {
      name: validators.required(valueOf('name'), 'Name') || validators.maxLength(valueOf('name'), 'Name', 200),
      retailer: validators.required(valueOf('retailer'), 'Retailer'),
      category: validators.required(valueOf('category'), 'Category') || validators.maxLength(valueOf('category'), 'Category', 60),
      url: validators.url(valueOf('url'), 'Product URL'),
      imageUrl: validators.url(valueOf('imageUrl'), 'Image URL'),
      currentPrice: mode === 'create' ? validators.price(valueOf('currentPrice'), 'Current price') : undefined,
      targetPrice: validators.price(valueOf('targetPrice'), 'Target price'),
      listPrice: validators.price(valueOf('listPrice'), 'List price'),
    };
  }

  function payload() {
    const body = {
      name: valueOf('name').trim(),
      url: valueOf('url').trim(),
      retailer: valueOf('retailer').trim(),
      category: valueOf('category').trim(),
      targetPrice: parsePrice(valueOf('targetPrice')),
      listPrice: parsePrice(valueOf('listPrice')),
      imageUrl: valueOf('imageUrl').trim(),
      description: valueOf('description').trim(),
      notes: valueOf('notes').trim(),
    };
    if (mode === 'create') {
      body.currency = valueOf('currency');
      if (valueOf('currentPrice').trim()) body.currentPrice = parsePrice(valueOf('currentPrice'));
    }
    return body;
  }

  return { form, alertBox, submit, check, payload, hasUrl: () => Boolean(valueOf('url').trim()) };
}

// Wires submit: client checks, the API call, field errors, and duplicate guidance.
function handleProductSubmit(built, { mode, send, busyLabel }) {
  const { form, alertBox, submit, check, payload } = built;

  async function go(extra = {}) {
    clear(alertBox);
    const problems = check();
    showFieldErrors(form, problems);
    if (Object.values(problems).some(Boolean)) {
      alertBox.append(formAlert('Please fix the highlighted fields.'));
      return;
    }
    setBusy(submit, true, busyLabel);
    try {
      await send({ ...payload(), ...extra });
    } catch (error) {
      setBusy(submit, false);
      if (error.fields) showFieldErrors(form, error.fields);
      if (error.code === 'DUPLICATE_PRODUCT') {
        const existingId = error.details && error.details.existingId;
        alertBox.append(
          h(
            'div',
            { class: 'alert alert-warning', role: 'alert' },
            icon('info'),
            h(
              'div',
              { class: 'stack', style: 'gap:8px' },
              h('span', {}, error.message),
              h(
                'div',
                { class: 'row' },
                existingId && h('a', { class: 'btn btn-sm', href: `#product/${existingId}` }, 'View existing product'),
                mode === 'create' && !built.hasUrl() && h('button', { type: 'button', class: 'btn btn-sm', onclick: () => go({ allowDuplicate: true }) }, 'It’s a different item. Add anyway'),
              ),
            ),
          ),
        );
      } else {
        alertBox.append(formAlert(error.message));
      }
      alertBox.scrollIntoView({ block: 'nearest' });
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    go();
  });
}

async function renderAddProduct(root, { ctx }) {
  const [facets, { preferences }] = await Promise.all([
    apiRequest('/api/watchlist/facets', { operation: 'load filters' }),
    apiRequest('/api/account/preferences', { operation: 'load preferences' }),
  ]);
  if (!ctx.isCurrent()) return;

  const built = buildProductForm({ mode: 'create', facets, defaultCurrency: preferences.defaultCurrency });
  handleProductSubmit(built, {
    mode: 'create',
    busyLabel: 'Saving…',
    send: async (body) => {
      const { item } = await apiRequest('/api/watchlist', { method: 'POST', body, operation: 'add product' });
      toast(`Added “${item.name}” to your watch list`);
      if (item.status === 'TARGET_REACHED') toast('This product is already at or below your target price', 'info');
      refreshUnreadBadge();
      replaceRoute(`product/${item.id}`);
    },
  });
  root.append(
    h(
      'div',
      { class: 'narrow' },
      h('div', { class: 'page-header' }, h('div', {}, h('h1', {}, 'Add a product'), h('p', {}, 'Enter what you know now. You can record new prices from the product’s page any time.'))),
      built.form,
    ),
  );
}

async function renderEditProduct(root, { id, ctx }) {
  const [{ item }, facets] = await Promise.all([
    apiRequest(`/api/watchlist/${encodeURIComponent(id)}`, { operation: 'load product' }),
    apiRequest('/api/watchlist/facets', { operation: 'load filters' }),
  ]);
  if (!ctx.isCurrent()) return;

  const built = buildProductForm({ mode: 'edit', item, facets });
  handleProductSubmit(built, {
    mode: 'edit',
    busyLabel: 'Saving…',
    send: async (body) => {
      await apiRequest(`/api/watchlist/${encodeURIComponent(id)}`, { method: 'PATCH', body, operation: 'update product' });
      toast('Changes saved');
      refreshUnreadBadge();
      leaveForm(`product/${id}`);
    },
  });
  root.append(
    h(
      'div',
      { class: 'narrow' },
      h('div', { class: 'page-header' }, h('div', {}, h('h1', {}, 'Edit product'), h('p', {}, item.name))),
      built.form,
    ),
  );
}
