'use strict';

/* ============================================================
   Untangle — service worker.

   Stale-while-revalidate for everything the app ships: a cached hit
   is returned immediately (so it opens and plays fully offline once
   visited once), but every fetch — cache hit or not — also goes to
   the network in the background and refreshes the cache for next
   time. That self-heals a device stuck on an old version within one
   extra reload, even if CACHE_VERSION below isn't bumped. Cross-origin
   requests (the Google Fonts files) are left to the network as-is —
   if they fail offline the page still works, it just falls back to
   its system-font stack, already accounted for in the CSS.

   Still bump CACHE_VERSION on any shipped-file change: it's what
   forces an immediate switch to the new cache on activate, rather
   than waiting on the background revalidation above.
   ============================================================ */

const CACHE_VERSION = 'untangle-v2';

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
    caches.open(CACHE_VERSION).then((cache) =>
      cache.match(req).then((cached) => {
        const networkFetch = fetch(req)
          .then((response) => {
            if (response && response.ok) cache.put(req, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    )
  );
});
