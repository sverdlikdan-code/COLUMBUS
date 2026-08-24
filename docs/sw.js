// Minimal service worker — enables PWA installability in Chrome
// Does not cache API calls, only enables beforeinstallprompt
const CACHE = 'fr-v12';
const STATIC = ['./formula-road.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  // Pass through API calls and external requests
  if (url.includes('api.sverdlik-apps.site') || url.includes('maps') || !url.startsWith(self.location.origin)) {
    return;
  }
  // Network-first for data files so they're always fresh
  if (url.includes('formula-road-data.json') || url.includes('google-gps.json')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  // Cache-first for static shell
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
