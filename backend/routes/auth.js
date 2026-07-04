const express = require('express');
const router = express.Router();
const {
  isPasswordSet,
  setPassword,
  verifyPassword,
  createSession,
  destroySession,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  validateSession,
  SESSION_COOKIE,
} = require('../auth');

// GET /api/auth/status -> indique si un mot de passe est configuré et si la session est valide
router.get('/status', (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  res.json({
    passwordSet: isPasswordSet(),
    authenticated: validateSession(token),
  });
});

// POST /api/auth/setup  { password } -> configure le mot de passe initial
router.post('/setup', (req, res) => {
  try {
    if (isPasswordSet()) {
      return res.status(400).json({ error: 'Un mot de passe est déjà configuré.' });
    }
    const { password } = req.body;
    if (!password || password.length < 4) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 4 caractères.' });
    }
    setPassword(password);
    const token = createSession();
    setSessionCookie(res, token);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login  { password } -> ouvre une session
router.post('/login', (req, res) => {
  try {
    if (!isPasswordSet()) {
      return res.status(400).json({ error: 'Aucun mot de passe configuré.' });
    }
    const { password } = req.body;
    if (!verifyPassword(password || '')) {
      return res.status(401).json({ error: 'Mot de passe incorrect.' });
    }
    const token = createSession();
    setSessionCookie(res, token);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/logout -> ferme la session
router.post('/logout', (req, res) => {
  const cookies = parseCookies(req);
  destroySession(cookies[SESSION_COOKIE]);
  clearSessionCookie(res);
  res.json({ success: true });
});

module.exports = router;
