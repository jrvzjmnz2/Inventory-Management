// Server-verified session for this app's own domain, separate from the
// short-lived SSO_SHARED_SECRET used only to hand a login off from the
// AI Hub. SESSION_SECRET never leaves this app, so a leak of one app's
// session signing key doesn't affect any other app's sessions.
const jwt = require('jsonwebtoken');
const { getDb } = require('../db');
const { COLLECTIONS } = require('../constants');

const SESSION_SECRET = process.env.SESSION_SECRET;
const SESSION_COOKIE = 'inv_session';
const SESSION_TTL = '12h';

if (!SESSION_SECRET) {
  console.warn('SESSION_SECRET is not set - sessions cannot be signed. Add it to .env.');
}

function signSession(employee) {
  return jwt.sign({ employeeId: employee.employeeId, name: employee.name }, SESSION_SECRET, {
    expiresIn: SESSION_TTL,
  });
}

function setSessionCookie(res, employee) {
  const token = signSession(employee);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000,
  });
}

function clearSessionCookie(res) {
  // Must match the options passed to res.cookie() above (minus
  // expires/maxAge) - Express only recognizes it as the same cookie,
  // and actually clears it in the browser, if these line up.
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

// Reads and verifies the cookie, returns the {employeeId, name} payload or
// null - never throws, so callers can just check truthiness.
function readSession(req) {
  const token = req.cookies && req.cookies[SESSION_COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, SESSION_SECRET);
    return { employeeId: payload.employeeId, name: payload.name };
  } catch {
    return null;
  }
}

// For JSON API routes - no session, no access, plain 401.
function requireSession(req, res, next) {
  const employee = readSession(req);
  if (!employee) {
    return res.status(401).json({ message: 'Not logged in.' });
  }
  req.employee = employee;
  next();
}

// For full-page navigations - no session, bounce to the Hub's login page
// instead of a JSON error, since there's a browser on the other end.
function requirePageSession(req, res, next) {
  const employee = readSession(req);
  if (!employee) {
    const hubUrl = process.env.HUB_URL || 'http://localhost:5173';
    return res.redirect(`${hubUrl}/login?tool=inventory`);
  }
  req.employee = employee;
  next();
}

// Re-confirms the employee referenced by the session still exists (covers
// an account deleted after the cookie was issued). Used only on the page
// routes, where an extra DB round trip once per navigation is cheap.
async function requireLiveEmployee(req, res, next) {
  try {
    const employees = getDb().collection(COLLECTIONS.EMPLOYEES);
    const exists = await employees.findOne({ employeeId: req.employee.employeeId }, { projection: { _id: 1 } });
    if (!exists) {
      clearSessionCookie(res);
      const hubUrl = process.env.HUB_URL || 'http://localhost:5173';
      return res.redirect(`${hubUrl}/login?tool=inventory`);
    }
    next();
  } catch (err) {
    res.status(500).send('Server error while checking session.');
  }
}

module.exports = {
  SESSION_COOKIE,
  setSessionCookie,
  clearSessionCookie,
  readSession,
  requireSession,
  requirePageSession,
  requireLiveEmployee,
};
