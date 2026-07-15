const CACHE = 'wordflow-shell-v7';
const BASE_URL = new URL('./', self.location.href);
const API_PATH = new URL('api/', BASE_URL).pathname;
const SHELL = [
  './',
  'styles.css',
  'app.js',
  'speech.js',
  'ui-atmosphere.png',
  'card-wave.png',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'manifest.webmanifest'
].map((path) => new URL(path, BASE_URL).href);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).pathname.startsWith(API_PATH)) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match(BASE_URL.href)))
  );
});
