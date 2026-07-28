// Base URL of the deployed backend (the same Node/Express + MongoDB server
// as server.js, running on your cloud host).
//
// The desktop dashboard doesn't need this - it's served by that same Express
// app, so its fetch('/api/...') calls are already same-origin. This mobile
// app is different: once packaged as a standalone Capacitor app, its HTML/JS
// is bundled straight into the Android app and has no "origin" of its own to
// route relative /api/ calls to, so it needs a full, absolute URL to reach
// your backend over the network.
//
// Update this once you've deployed server.js (e.g. to Render, Railway,
// Fly.io, or your own server) - then run `npx cap sync android` and rebuild
// the app so the change takes effect.
const API_BASE_URL = 'https://inventory-management-atyc.onrender.com';

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}
