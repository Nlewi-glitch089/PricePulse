// Authentication middleware for API routes and protected pages.

// For JSON API routes: reject with 401 when there is no logged-in user.
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.status(401).json({ error: 'Please log in to continue.' });
}

// For HTML pages: send visitors without a session to the login page.
function requireAuthPage(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.redirect('/login.html');
}

// For the landing, login, and register pages: logged-in users go straight to the app.
function redirectIfLoggedIn(req, res, next) {
  if (req.session && req.session.userId) {
    return res.redirect('/app.html');
  }
  return next();
}

module.exports = { requireAuth, requireAuthPage, redirectIfLoggedIn };
