// Notification center (#notifications): read/unread, mark all read, delete.

async function renderNotifications(root, { params, ctx }) {
  const filter = params.get('filter') === 'unread' ? 'unread' : 'all';
  const page = Number(params.get('page')) || 1;
  const summary = h('p', {}, 'Alerts about your watched products');
  const readAll = h('button', { type: 'button', class: 'btn btn-sm', disabled: true }, icon('check', 15), ' Mark all read');
  const filterButtons = [
    ['all', 'All'],
    ['unread', 'Unread'],
  ].map(([value, label]) => h('button', { type: 'button', 'aria-pressed': String(filter === value), onclick: () => (location.hash = value === 'all' ? 'notifications' : 'notifications?filter=unread') }, label));

  root.append(
    h(
      'div',
      { class: 'page-header' },
      h('div', {}, h('h1', {}, 'Notifications'), summary),
      h('div', { class: 'row' }, h('div', { class: 'segmented', role: 'group', 'aria-label': 'Filter' }, filterButtons), readAll),
    ),
  );
  const body = h('div', {}, loadingState());
  root.append(body);

  let data;
  try {
    data = await apiRequest('/api/notifications', { query: { filter, page }, operation: 'load notifications' });
  } catch (error) {
    if (ctx.isCurrent()) clear(body).append(h('div', { class: 'card' }, errorState(error, refreshView)));
    return;
  }
  if (!ctx.isCurrent()) return;
  summary.textContent = `${data.unreadCount} unread`;
  readAll.disabled = data.unreadCount === 0;
  readAll.addEventListener('click', async () => {
    setBusy(readAll, true, 'Working…');
    try {
      await apiRequest('/api/notifications/read-all', { method: 'POST', operation: 'mark all read' });
      announce('All notifications marked as read');
      refreshUnreadBadge();
      await refreshView();
    } catch (error) {
      setBusy(readAll, false);
      toast(error.message, 'error');
    }
  });
  clear(body);

  if (data.items.length === 0) {
    body.append(
      h(
        'div',
        { class: 'card' },
        emptyState({
          iconName: 'bell',
          title: filter === 'unread' ? 'You’re all caught up' : 'No notifications yet',
          text: filter === 'unread' ? 'There are no unread alerts.' : 'When a recorded price reaches one of your targets, an alert appears here. Price-drop alerts can be turned on in Settings.',
        }),
      ),
    );
    return;
  }

  const act = async (fn, message) => {
    try {
      await fn();
      announce(message);
      refreshUnreadBadge();
      await refreshView();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  appendChildren(body, [
    h(
      'ul',
      { class: 'card list notification-list', 'aria-label': 'Notifications' },
      data.items.map((n) =>
        h(
          'li',
          { class: `list-row${n.read ? '' : ' is-unread'}` },
          h('span', { class: n.type === 'TARGET_REACHED' ? 'delta-down' : 'secondary', 'aria-hidden': 'true' }, icon(n.type === 'TARGET_REACHED' ? 'target' : 'arrowDown', 20)),
          h(
            'div',
            { class: 'grow' },
            h('div', { class: 'row-title' }, !n.read && h('span', { class: 'sr-only' }, 'Unread: '), n.entryId ? h('a', { href: `#product/${n.entryId}` }, n.title) : n.title),
            h('div', { class: 'small secondary' }, n.message),
            h('div', { class: 'tiny muted', title: formatDateTime(n.createdAt) }, formatRelative(n.createdAt), !n.entryId && ' · product removed'),
          ),
          h(
            'div',
            { class: 'row', style: 'flex-wrap:nowrap' },
            h('button', { type: 'button', class: 'btn btn-sm', onclick: () => act(() => apiRequest(`/api/notifications/${n.id}`, { method: 'PATCH', body: { read: !n.read }, operation: 'toggle read' }), n.read ? 'Marked as unread' : 'Marked as read'), 'aria-label': `${n.read ? 'Mark unread' : 'Mark read'}: ${n.title}` }, n.read ? 'Mark unread' : 'Mark read'),
            h('button', { type: 'button', class: 'btn btn-sm btn-icon', title: 'Delete', 'aria-label': `Delete notification: ${n.title}`, onclick: () => act(() => apiRequest(`/api/notifications/${n.id}`, { method: 'DELETE', operation: 'delete notification' }), 'Notification deleted') }, icon('trash', 15)),
          ),
        ),
      ),
    ),
    pagination(data.page, data.totalPages, (p) => (location.hash = `notifications?${new URLSearchParams({ ...(filter === 'unread' && { filter }), page: p })}`)),
  ]);
}
