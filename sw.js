const CACHE = 'artwork-camera-v10';
const STATIC = ['/', '/manifest.json', '/icon.svg', '/sw.js'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const { pathname } = new URL(event.request.url);
  const isApi = ['/test-connection', '/fetch-albums', '/proxy-upload', '/proxy-add-to-album'].some(p => pathname.startsWith(p));
  if (isApi) return;

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(event.request, clone));
      return res;
    }))
  );
});
