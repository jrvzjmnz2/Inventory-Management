require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const { connectToDatabase, DB_NAME } = require('./db');
const { verifySsoToken } = require('./utils/ssoToken');
const {
  SESSION_COOKIE,
  setSessionCookie,
  clearSessionCookie,
  readSession,
  requireSession,
  requirePageSession,
  requireLiveEmployee,
} = require('./middleware/auth');

const equipmentRoutes = require('./routes/equipment');
const borrowRoutes = require('./routes/borrow');
const reserveRoutes = require('./routes/reserve');
const returnRoutes = require('./routes/return');
const exportRoutes = require('./routes/export');

const app = express();
const PORT = process.env.PORT || 3000;
const HUB_URL = process.env.HUB_URL || 'http://localhost:5173';

app.use(cors());
// Default 100kb JSON body limit is too small once CSV imports (sent as a
// JSON string field) are in play - bumped so a few thousand equipment rows
// comfortably fit.
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

// ---------------------------------------------------------------------
// Sign-in only happens at the AI Hub now. This app's own job is to:
//  - accept a one-time hand-off token from the Hub at /sso and turn it
//    into a real session cookie for this domain,
//  - refuse to render its pages to a browser without that cookie, sending
//    it to the Hub's login screen instead,
//  - go straight to the dashboard for a browser that already has a valid
//    cookie (whether that's a moment ago via /sso, or from earlier today).
// These are declared before express.static so they take priority over the
// plain files of the same name in public/.
// ---------------------------------------------------------------------

app.get(['/', '/index.html'], (req, res) => {
  const employee = readSession(req);
  if (employee) return res.redirect('/dashboard.html');
  res.redirect(`${HUB_URL}/login?tool=inventory`);
});

app.get('/dashboard.html', requirePageSession, requireLiveEmployee, (req, res) => {
  const filePath = path.join(__dirname, 'public', 'dashboard.html');
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) return res.status(500).send('Could not load the dashboard.');
    const sessionScript = `<script>window.__SESSION__ = ${JSON.stringify(req.employee)}; window.__HUB_URL__ = ${JSON.stringify(HUB_URL)};</script>`;
    res.type('html').send(html.replace('<!--__SESSION_JSON__-->', sessionScript));
  });
});

// Landed on from the AI Hub after it verifies a login there. ?token= is a
// short-lived, single-purpose JWT signed with SSO_SHARED_SECRET - it proves
// "the Hub just confirmed this employee", nothing more. On success this
// mints this app's own, separate session cookie and the token is never
// looked at again.
app.get('/sso', (req, res) => {
  const employee = verifySsoToken(req.query.token);
  if (!employee) {
    return res.redirect(`${HUB_URL}/login?tool=inventory&error=sso`);
  }
  setSessionCookie(res, employee);
  res.redirect('/dashboard.html');
});

// Every other API route needs a real, verified session from here on -
// previously these trusted whatever employeeId the request body claimed.
app.use('/api/equipment', requireSession, equipmentRoutes);
app.use('/api/borrow', requireSession, borrowRoutes);
app.use('/api/reserve', requireSession, reserveRoutes);
app.use('/api/return', requireSession, returnRoutes);
app.use('/api/export', requireSession, exportRoutes);

// Confirms the current cookie to any caller that wants to check - used by
// the dashboard's own client code if it ever needs to re-verify mid-session.
app.get('/api/auth/me', requireSession, (req, res) => {
  res.json(req.employee);
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Part of the Hub's "log out everywhere" chain (see its own
// /api/auth/logout-chain) - a plain GET so it can be reached by a real
// top-level browser navigation rather than a background request, which is
// what actually lets this clear its own cookie reliably (a cross-site
// fetch from the Hub's origin would run into third-party-cookie blocking
// and this cookie's own SameSite=Lax, regardless of CORS). Unauthenticated
// on purpose - clearing a cookie that may not even be there is harmless -
// but that also makes `returnTo` a route anyone could call, so it's only
// ever honored when it points back at the Hub we're configured to trust,
// never at whatever address a link happened to supply.
app.get('/logout', (req, res) => {
  clearSessionCookie(res);
  const returnTo = req.query.returnTo;
  if (typeof returnTo === 'string' && returnTo.startsWith(HUB_URL)) {
    return res.redirect(returnTo);
  }
  res.redirect(HUB_URL);
});

app.use(express.static(path.join(__dirname, 'public')));

connectToDatabase()
  .then(() => {
    console.log(`Connected to MongoDB database "${DB_NAME}"`);
    app.listen(PORT, () => {
      console.log(`Inventory Management System running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err.message);
    console.error('Make sure MONGO_URI (and MONGO_DB_NAME) in .env are correct and reachable.');
    process.exit(1);
  });
