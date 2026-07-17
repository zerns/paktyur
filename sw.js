const CACHE_NAME = 'paktyur-cache-fa7e0d2';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/styles.css',
  '/js/app.js',
  '/site.webmanifest',
  '/favicon.ico',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const cacheAndReturn = (response) => {
    if (response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
    }
    return response;
  };

  // Navigations/HTML: network-first so a freshly-stamped index.html (with new
  // ?v= hashes) is seen immediately online; fall back to cache when offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(cacheAndReturn)
        .catch(() => caches.match(event.request).then((c) => c || caches.match('/index.html')))
    );
    return;
  }

  // Hashed assets (js/css) + everything else: stale-while-revalidate. Safe —
  // a content change means a new ?v=, i.e. a new cache key, so no staleness.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then(cacheAndReturn).catch(() => cached);
      return cached || network;
    })
  );
});
