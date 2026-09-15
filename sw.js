'use strict';

/* ============================================================
   Untangle — service worker.

   Cache-first for everything the app ships (so it opens and plays
   fully offline once visited once); cross-origin requests (the
   Google Fonts stylesheet/files) are left to the network as-is —
   if they fail offline the page still works, it just falls back to
   its system-font stack, which is already accounted for in the CSS.

   Bump CACHE_VERSION whenever any shipped file changes so clients
   pick up the new set instead of serving a stale cache forever.
   ============================================================ */

const CACHE_VERSION = 'untangle-v1';

const PRECACHE_URLS = [
  './',
  'index.html',
  'play.html',
  'manifest.json',
  'css/shared.css',
  'css/landing.css',
  'css/game.css',
  'js/i18n.js',
  'js/storage.js',
  'js/theme.js',
  'js/sound.js',
  'js/game.js',
  'js/landing.js',
  'js/sw-register.js',
  'assets/favicon.svg',
  'assets/og-image.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle same-origin GET requests — let everything else
  // (cross-origin fonts, non-GET) pass straight through to the network.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
