// Minimal service worker — enables PWA installability in Chrome
// Does not cache API calls, only enables beforeinstallprompt
const CACHE = 'fr-v1';
const STATIC = ['./formula-road.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  // Pass through API calls and external requests
  if (url.includes('api.sverdlik-apps.site') || url.includes('maps') || !url.startsWith(self.location.origin)) {
    return;
  }
  // Cache-first for static files
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
