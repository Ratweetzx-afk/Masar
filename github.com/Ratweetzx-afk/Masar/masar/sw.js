'use strict';

const CACHE_NAME = 'masar-shell-v1';
const APP_SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls — flight data must always be fresh from
  // the network (or explicitly fail), never served stale from the
  // service worker cache.
  if (url.pathname.startsWith('/.netlify/functions/')) {
    return; // let the browser handle it normally
  }

  // App shell: cache-first, falling back to network.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request)),
  );
});
