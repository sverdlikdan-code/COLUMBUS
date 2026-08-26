// Minimal service worker — enables PWA installability in Chrome
// Does not cache API calls, only enables beforeinstallprompt
const CACHE = 'fr-v25';
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
  // Network-first for data files AND the HTML shell itself — this is a live
  // sales-routing tool, freshness matters far more than offline capability.
  // formula-road.html used to be cache-first-forever: since CACHE only bumps on
  // an explicit sw.js edit, an already-installed PWA could keep serving a page
  // from months ago indefinitely, silently missing every deploy in between
  // (caught 2026-08-26 — an agent's installed PWA had zero of that day's fixes).
  if (url.includes('formula-road-data.json') || url.includes('google-gps.json') || url.endsWith('formula-road.html') || url.endsWith('/')) {
    e.respondWith(fetch(e.request).then(res => {
      caches.open(CACHE).then(c => c.put(e.request, res.clone()));
      return res;
    }).catch(() => caches.match(e.request)));
    return;
  }
  // Cache-first only for the rest of the static shell (manifest.json, icons, etc.)
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
