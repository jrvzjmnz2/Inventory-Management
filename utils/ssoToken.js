// Verifies the short-lived handoff token minted by the AI Hub after it
// checks a login there. SSO_SHARED_SECRET is the one secret that must be
// identical on both apps - everything else (session cookies, etc.) is
// local to whichever app issued it.
const jwt = require('jsonwebtoken');

const SSO_SHARED_SECRET = process.env.SSO_SHARED_SECRET;

if (!SSO_SHARED_SECRET) {
  console.warn('SSO_SHARED_SECRET is not set - Hub sign-in hand-off will not work.');
}

// Returns {employeeId, name} on a valid, unexpired token, or null.
function verifySsoToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, SSO_SHARED_SECRET, { audience: 'inventory' });
    return { employeeId: payload.employeeId ?? null, name: payload.name, email: payload.email };
  } catch {
    return null;
  }
}

module.exports = { verifySsoToken };
