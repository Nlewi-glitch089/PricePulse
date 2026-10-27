// Theme: System (follows the device), Light, or Dark.
//
// The choice is saved with the account, so every browser you sign in to matches.
// This browser also keeps a copy in localStorage, which js/theme-init.js applies
// before the first paint (including on the sign-in pages), so there's no flash.
const THEME_KEY = 'pricepulse.theme';

function currentThemeChoice() {
  const t = document.documentElement.dataset.theme;
  return t === 'light' || t === 'dark' ? t : 'system';
}

// Applies a choice to this page and this browser only.
function applyThemeChoice(choice) {
  if (choice === 'light' || choice === 'dark') document.documentElement.dataset.theme = choice;
  else delete document.documentElement.dataset.theme;
  try {
    if (choice === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Private browsing or blocked storage: the theme still applies for this visit.
  }
  // Charts read colors from CSS variables; let them redraw.
  document.dispatchEvent(new CustomEvent('themechange'));
}

// Applies a choice and saves it to the account.
function saveThemeChoice(choice) {
  applyThemeChoice(choice);
  return apiRequest('/api/account/preferences', { method: 'PATCH', body: { theme: choice }, operation: 'save theme' });
}

// On sign-in: the account's choice wins. An account without one yet adopts this
// browser's choice, so nobody's existing setting is reset.
function syncThemeWithAccount(preferences) {
  if (preferences.theme) {
    if (preferences.theme !== currentThemeChoice()) applyThemeChoice(preferences.theme);
  } else if (currentThemeChoice() !== 'system') {
    saveThemeChoice(currentThemeChoice()).catch(() => {});
  }
}

// Following the system: redraw charts when the device switches.
const systemDarkQuery = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
if (systemDarkQuery && systemDarkQuery.addEventListener) {
  systemDarkQuery.addEventListener('change', () => document.dispatchEvent(new CustomEvent('themechange')));
}
