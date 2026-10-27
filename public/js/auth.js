// Login and registration pages.
const authLog = createClientLogger('Auth');
const valueOf = (id) => document.getElementById(id).value;

function setupAuthForm(form, { endpoint, operation, collect, check, busyLabel }) {
  const alertBox = document.getElementById('form-alert');
  const button = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clear(alertBox);
    const values = collect();
    const problems = check(values);
    showFieldErrors(form, problems);
    if (Object.values(problems).some(Boolean)) return;

    setBusy(button, true, busyLabel);
    try {
      await apiRequest(endpoint, { method: 'POST', body: values, operation });
      authLog.info(`${operation} succeeded`);
      location.href = '/app.html';
    } catch (error) {
      setBusy(button, false);
      alertBox.append(formAlert(error.message));
      if (error.fields) showFieldErrors(form, error.fields);
    }
  });
}

// "Explore a demo" buttons (landing and sign-in pages): a temporary account with sample products.
for (const button of document.querySelectorAll('[data-start-demo]')) {
  button.addEventListener('click', async () => {
    const alertBox = document.getElementById(button.dataset.alert);
    clear(alertBox);
    setBusy(button, true, 'Preparing sample data…');
    try {
      await apiRequest('/api/auth/demo', { method: 'POST', operation: 'start demo' });
      location.href = '/app.html';
    } catch (error) {
      setBusy(button, false);
      alertBox.append(formAlert(error.message));
    }
  });
}

const loginForm = document.getElementById('login-form');
if (loginForm) {
  setupAuthForm(loginForm, {
    endpoint: '/api/auth/login',
    operation: 'log in',
    busyLabel: 'Signing in…',
    collect: () => ({ email: valueOf('email').trim(), password: valueOf('password') }),
    check: (v) => ({
      email: validators.email(v.email),
      password: v.password ? undefined : 'Password is required.',
    }),
  });
}

const registerForm = document.getElementById('register-form');
if (registerForm) {
  setupAuthForm(registerForm, {
    endpoint: '/api/auth/register',
    operation: 'create account',
    busyLabel: 'Creating account…',
    collect: () => ({ name: valueOf('name').trim(), email: valueOf('email').trim(), password: valueOf('password') }),
    check: (v) => ({
      name: validators.required(v.name, 'Name'),
      email: validators.email(v.email),
      password: validators.password(v.password),
      confirm: valueOf('confirm') === v.password ? undefined : 'Passwords do not match.',
    }),
  });
}
