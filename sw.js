const CACHE_NAME = 'apex-timing-cache-v12';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './index.css',
  './manifest.json',
  './js/app.js',
  './js/database.js',
  './js/serial.js',
  './js/simulator.js',
  './js/speech.js',
  './js/race.js'
];

// Install Event - cache core static resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching static assets');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event - clear old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Network-first strategy (falls back to cache if offline)
self.addEventListener('fetch', (event) => {
  // Only handle GET requests and local scope assets
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // If successful, clone response and update the cache
        if (networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // If network request fails (offline), return cached version
        console.log('[Service Worker] Serving resource from cache:', event.request.url);
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Fallback if resource is not in cache (e.g. index.html)
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Network error and no cached resource available', {
            status: 503,
            statusText: 'Service Unavailable'
          });
        });
      })
  );
});
