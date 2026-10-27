// Account settings (#settings): profile, alerts, display and defaults, security.
//
// Forms with several related fields have a Save button; single choices
// (theme, default currency) save as soon as they change and say so.

async function renderSettings(root, { ctx }) {
  const [{ preferences }, providers] = await Promise.all([
    apiRequest('/api/account/preferences', { operation: 'load preferences' }),
    apiRequest('/api/providers', { operation: 'load price sources' }),
  ]);
  if (!ctx.isCurrent()) return;

  root.append(
    h(
      'div',
      { class: 'stack narrow' },
      h('div', { class: 'page-header' }, h('div', {}, h('h1', {}, 'Settings'), h('p', {}, 'Your profile, alerts, display, and security.'))),
      profileSection(),
      alertsSection(preferences),
      displaySection(preferences, providers),
      currentUser.isDemo ? demoSection() : securitySection(),
    ),
  );
}

function settingsCard(title, description, ...children) {
  const id = `settings-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return h('section', { class: 'card card-pad stack settings-section', 'aria-labelledby': id }, h('div', {}, h('h2', { id }, title), description && h('p', { class: 'small secondary' }, description)), ...children);
}

// A short "Saved" note next to a control that saves on change (also read out by screen readers).
function savedNote() {
  const note = h('span', { class: 'saved-note small', hidden: true }, icon('check', 14), 'Saved');
  let timer;
  return {
    note,
    show(message = 'Saved') {
      clear(note).append(icon('check', 14), message);
      note.hidden = false;
      announce(message);
      clearTimeout(timer);
      timer = setTimeout(() => (note.hidden = true), 2500);
    },
  };
}

function profileSection() {
  const name = h('input', { class: 'input', maxlength: 80, value: currentUser.name, autocomplete: 'name' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save name');
  const form = h(
    'form',
    { class: 'stack', novalidate: true },
    h(
      'div',
      { class: 'form-grid' },
      field({ label: 'Name', name: 'name', control: name, required: true }),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Email'), h('p', { class: 'static-value' }, currentUser.email), h('span', { class: 'hint' }, 'Used to sign in. It can’t be changed.')),
    ),
    h('div', { class: 'form-actions' }, submit),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const problem = validators.required(name.value, 'Name');
    showFieldErrors(form, { name: problem });
    if (problem) return;
    setBusy(submit, true, 'Saving…');
    try {
      const { user } = await apiRequest('/api/account/profile', { method: 'PATCH', body: { name: name.value.trim() }, operation: 'update profile' });
      currentUser = user;
      document.getElementById('user-name').textContent = user.name;
      toast('Name updated');
    } catch (error) {
      showFieldErrors(form, error.fields || {});
      toast(error.message, 'error');
    } finally {
      setBusy(submit, false);
    }
  });
  return settingsCard('Profile', null, form);
}

function alertsSection(prefs) {
  const checkbox = (checked, id) => h('input', { type: 'checkbox', checked, id });
  const targetAlerts = checkbox(prefs.targetAlerts, 'pref-target');
  const dropAlerts = checkbox(prefs.priceDropAlerts, 'pref-drop');
  const minPercent = h('input', { class: 'input num', type: 'number', inputmode: 'numeric', min: 1, max: 90, step: 1, value: prefs.priceDropMinPercent });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save alerts');

  const checkRow = (input, title, text) => h('div', { class: 'checkbox' }, input, h('label', { for: input.id }, h('strong', {}, title), h('span', { class: 'small secondary' }, text)));
  // The percentage only matters for price-drop alerts, so it sits under that option.
  const percentField = h('div', { class: 'nested' }, field({ label: 'Only when the drop is at least (%)', name: 'priceDropMinPercent', control: minPercent, hint: 'A whole number from 1 to 90.' }));
  const syncPercent = () => (percentField.hidden = !dropAlerts.checked);
  dropAlerts.addEventListener('change', syncPercent);
  syncPercent();

  const form = h(
    'form',
    { class: 'stack', novalidate: true },
    h(
      'fieldset',
      { class: 'stack' },
      h('legend', { class: 'sr-only' }, 'Alert me when'),
      checkRow(targetAlerts, 'Target price reached', 'Once, when a recorded price is at or below your target.'),
      checkRow(dropAlerts, 'Price drops', 'When a newly recorded price is lower than the one before it.'),
      percentField,
    ),
    h('div', { class: 'form-actions' }, submit),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pct = Number(minPercent.value);
    const problem = dropAlerts.checked && (!Number.isInteger(pct) || pct < 1 || pct > 90) ? 'Enter a whole number from 1 to 90.' : undefined;
    showFieldErrors(form, { priceDropMinPercent: problem });
    if (problem) return;
    setBusy(submit, true, 'Saving…');
    try {
      const body = { targetAlerts: targetAlerts.checked, priceDropAlerts: dropAlerts.checked };
      if (dropAlerts.checked) body.priceDropMinPercent = pct;
      await apiRequest('/api/account/preferences', { method: 'PATCH', body, operation: 'save preferences' });
      toast('Alert settings saved');
    } catch (error) {
      showFieldErrors(form, error.fields || {});
      toast(error.message, 'error');
    } finally {
      setBusy(submit, false);
    }
  });
  return settingsCard('Alerts', 'Alerts appear in your notifications (the bell at the top). PricePulse doesn’t send email or push notifications.', form);
}

function displaySection(prefs, providers) {
  const theme = h('select', { class: 'select', id: 'settings-theme' }, [
    h('option', { value: 'system' }, 'Match my device'),
    h('option', { value: 'light' }, 'Light'),
    h('option', { value: 'dark' }, 'Dark'),
  ]);
  theme.value = currentThemeChoice();
  const themeSaved = savedNote();
  theme.addEventListener('change', async () => {
    try {
      await saveThemeChoice(theme.value);
      themeSaved.show();
    } catch (error) {
      toast(`The theme changed here but wasn’t saved to your account: ${error.message}`, 'error');
    }
  });

  const currency = h('select', { class: 'select' }, CURRENCIES.map((c) => h('option', { value: c }, c)));
  currency.value = prefs.defaultCurrency;
  const currencySaved = savedNote();
  currency.addEventListener('change', async () => {
    try {
      await apiRequest('/api/account/preferences', { method: 'PATCH', body: { defaultCurrency: currency.value }, operation: 'save default currency' });
      currencySaved.show();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  const withNote = (fieldEl, saved) => (fieldEl.querySelector('label').after(saved.note), fieldEl);
  return settingsCard(
    'Display and defaults',
    'These save as soon as you change them.',
    h(
      'div',
      { class: 'form-grid' },
      withNote(field({ label: 'Theme', name: 'theme', control: theme, hint: 'Saved to your account, so every browser you use matches.' }), themeSaved),
      withNote(field({ label: 'Currency for new products', name: 'defaultCurrency', control: currency }), currencySaved),
    ),
    h(
      'p',
      { class: 'small secondary' },
      providers.manualEntryOnly
        ? 'Prices are entered by hand: no automatic price source is set up on this server.'
        : `Automatic prices come from ${providers.providers.map((p) => p.displayName).join(', ')}, and are labelled separately from prices you enter.`,
    ),
  );
}

// A demo account has no password to change, and ends instead of being deleted.
function demoSection() {
  const end = h('button', { type: 'button', class: 'btn', onclick: signOut }, 'End demo');
  return settingsCard(
    'Demo account',
    null,
    h('div', { class: 'setting-row setting-row-first' }, h('p', { class: 'small secondary' }, 'This account and its sample data are deleted when you end the demo, or automatically after 24 hours.'), end),
  );
}

function securitySection() {
  const current = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const next = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const confirm = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Update password');
  const form = h(
    'form',
    { class: 'stack', novalidate: true },
    field({ label: 'Current password', name: 'currentPassword', control: current, required: true }),
    h(
      'div',
      { class: 'form-grid' },
      field({ label: 'New password', name: 'newPassword', control: next, required: true, hint: 'At least 8 characters, with a letter and a number.' }),
      field({ label: 'Confirm new password', name: 'confirm', control: confirm, required: true }),
    ),
    h('div', { class: 'form-actions' }, submit),
  );
  const passwordDetails = h('details', { class: 'disclosure' }, h('summary', {}, 'Change your password'), form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const problems = {
      currentPassword: current.value ? undefined : 'Enter your current password.',
      newPassword: validators.password(next.value),
      confirm: confirm.value === next.value ? undefined : 'The two new passwords don’t match.',
    };
    showFieldErrors(form, problems);
    if (Object.values(problems).some(Boolean)) return;
    setBusy(submit, true, 'Updating…');
    try {
      await apiRequest('/api/account/password', { method: 'POST', body: { currentPassword: current.value, newPassword: next.value }, operation: 'change password' });
      form.reset();
      passwordDetails.open = false;
      passwordDetails.querySelector('summary').focus();
      toast('Password changed. Other devices have been signed out.');
    } catch (error) {
      showFieldErrors(form, error.fields || {});
      toast(error.message, 'error');
    } finally {
      setBusy(submit, false);
    }
  });

  const signOutAll = h('button', { type: 'button', class: 'btn' }, 'Sign out everywhere');
  signOutAll.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Sign out on every device?',
      description: 'This ends every session, including this one. You’ll need to sign in again.',
      confirmLabel: 'Sign out everywhere',
    });
    if (!ok) return;
    try {
      await apiRequest('/api/account/logout-all', { method: 'POST', operation: 'sign out everywhere' });
    } finally {
      location.href = '/login.html';
    }
  });

  const deleteBtn = h('button', { type: 'button', class: 'btn btn-danger' }, 'Delete account…');
  deleteBtn.addEventListener('click', () => {
    const password = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
    const alertBox = h('div', {});
    const cancel = h('button', { type: 'button', class: 'btn' }, 'Cancel');
    const confirmBtn = h('button', { type: 'submit', class: 'btn btn-danger-solid' }, 'Delete my account');
    const form = h('form', { class: 'stack', novalidate: true }, alertBox, field({ label: 'Your password', name: 'password', control: password, required: true }), h('div', { class: 'form-actions' }, cancel, confirmBtn));
    const { close } = openDialog({ title: 'Delete your account?', description: 'This can’t be undone. Your products, price history, alerts, and purchases are deleted. Enter your password to confirm.', body: form });
    cancel.addEventListener('click', close);
    password.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clear(alertBox);
      if (!password.value) return showFieldErrors(form, { password: 'Enter your password to confirm.' });
      setBusy(confirmBtn, true, 'Deleting…');
      try {
        await apiRequest('/api/account', { method: 'DELETE', body: { password: password.value }, operation: 'delete account' });
        location.href = '/';
      } catch (error) {
        setBusy(confirmBtn, false);
        showFieldErrors(form, error.fields || {});
        alertBox.append(formAlert(error.message));
      }
    });
  });

  return settingsCard(
    'Security',
    null,
    passwordDetails,
    h('div', { class: 'setting-row' }, h('div', {}, h('h3', {}, 'Sign out everywhere'), h('p', { class: 'small secondary' }, 'Ends every session on every device, including this one.')), signOutAll),
    h('div', { class: 'setting-row' }, h('div', {}, h('h3', {}, 'Delete account'), h('p', { class: 'small secondary' }, 'Permanently deletes your products, price history, alerts, and purchases.')), deleteBtn),
  );
}
