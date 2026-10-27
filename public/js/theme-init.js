// Runs before the page paints (loaded without defer in <head>) so a saved
// Light/Dark choice never flashes the other theme. No choice = follow the system.
(function () {
  try {
    var theme = localStorage.getItem('pricepulse.theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  } catch (e) {
    /* storage blocked: follow the system setting */
  }
})();
