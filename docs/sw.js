// Minimal service worker — enables PWA installability in Chrome
// Does not cache API calls, only enables beforeinstallprompt
const CACHE = 'fr-v28';
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
  // Zikuy offline (live request 2026-09-03): agents lose signal inside
  // storage rooms and need the product list + photos for a client they've
  // already opened today, even with zero connectivity. Carved out of the
  // API pass-through below, even though both live on a different origin
  // (api.sverdlik-apps.site) than this SW's own page.
  // /api/client-returns/ — network-first (still fresh whenever there IS
  // signal, same philosophy as the data files further down), cache as
  // fallback when offline. Prewarmed proactively for the whole day's route
  // by formula-road.html's prewarmZikuyOffline() while the agent still has
  // signal, not just opportunistically when zikuy happens to be opened.
  if (url.includes('/api/client-returns/')) {
    e.respondWith(fetch(e.request).then(res => {
      const resClone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, resClone));
      return res;
    }).catch(() => caches.match(e.request)));
    return;
  }
  // /api/img-proxy — cache-first: a product's photo essentially never
  // changes once uploaded to Priority (same assumption server/index.js's
  // disk cache already makes for this same endpoint), so serving instantly
  // from cache and refreshing in the background beats re-fetching every
  // time, and it's what actually makes offline browsing possible at all.
  if (url.includes('/api/img-proxy')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const network = fetch(e.request).then(res => {
          const resClone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, resClone));
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }
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
  // 2026-08-26 (same day, second bug): the fix above only matched
  // '...formula-road.html' and never matched manifest.json's actual start_url
  // '/formula-road' (no extension) — so a home-screen-installed shortcut, which
  // launches at start_url, fell straight through to the cache-first branch
  // below and kept showing a stale app shell even after this exact fix shipped.
  if (url.includes('formula-road-data.json') || url.includes('google-gps.json') || url.endsWith('formula-road.html') || url.endsWith('/formula-road') || url.endsWith('/')
    || url.includes('dagim-base.json') || url.includes('dagim-yavesh-base.json') || url.includes('kapua-base.json') || url.includes('halavi-base.json')
    || url.includes('product-data.json') || url.endsWith('planogram-editor.html')) {
    e.respondWith(fetch(e.request).then(res => {
      const resClone = res.clone(); // clone synchronously — caches.open() is async and by
      caches.open(CACHE).then(c => c.put(e.request, resClone)); // then res.body may already be read
      return res;
    }).catch(() => caches.match(e.request)));
    return;
  }
  // Cache-first only for the rest of the static shell (manifest.json, icons, etc.)
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
