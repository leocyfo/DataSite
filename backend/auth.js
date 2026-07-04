const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AUTH_PATH = path.join(__dirname, 'db', 'auth.json');
const SESSION_COOKIE = 'ds_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

const sessions = new Map(); // token -> expiration

function loadAuthConfig() {
  if (!fs.existsSync(AUTH_PATH)) return null;
  return JSON.parse(fs.readFileSync(AUTH_PATH, 'utf-8'));
}

function saveAuthConfig(config) {
  fs.writeFileSync(AUTH_PATH, JSON.stringify(config, null, 2));
}

function isPasswordSet() {
  return loadAuthConfig() !== null;
}

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, useSalt, 64).toString('hex');
  return { hash, salt: useSalt };
}

function setPassword(password) {
  const { hash, salt } = hashPassword(password);
  saveAuthConfig({ hash, salt });
}

function verifyPassword(password) {
  const config = loadAuthConfig();
  if (!config) return false;
  const { hash } = hashPassword(password, config.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(config.hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function validateSession(token) {
  if (!token) return false;
  const expiry = sessions.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function destroySession(token) {
  sessions.delete(token);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(header.split(';').map(c => {
    const idx = c.indexOf('=');
    if (idx === -1) return [c.trim(), ''];
    return [c.slice(0, idx).trim(), decodeURIComponent(c.slice(idx + 1))];
  }));
}

function setSessionCookie(res, token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

function requireAuth(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (validateSession(token)) return next();
  res.status(401).json({ error: 'Authentification requise.' });
}

module.exports = {
  isPasswordSet,
  setPassword,
  verifyPassword,
  createSession,
  validateSession,
  destroySession,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  SESSION_COOKIE,
};
