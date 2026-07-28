const CACHE_NAME = 'inventory-mobile-v1';
const APP_SHELL = [
  'index.html',
  'dashboard.html',
  'css/mobile-style.css',
  'css/style.css',
  'js/config.js',
  'js/mobile-login.js',
  'js/mobile-dashboard.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {}) // don't fail install if e.g. offline on first load
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls - borrow/return/inventory data must always be live.
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // App shell: network-first (so edits show up immediately), falling back
  // to the cached copy when offline.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
