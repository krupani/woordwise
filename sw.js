/* WoordWise — service worker
 * Cache-first for static assets. Network-only for AI API calls.
 * Version-stamped caches; bump CACHE_VERSION to force a fresh install.
 */

var CACHE_VERSION = 'woordwise-v1.0';

/* Static assets to precache. Keep this list small — everything else
 * is cached on first request. */
var PRECACHE = [
    './',
    './index.html',
    './styles/base.css',
    './scripts/base.js',
    './scripts/online.js',
    './scripts/effects.js',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

/* Domains whose requests must NEVER be cached (AI providers). */
var NETWORK_ONLY_HOSTS = [
    'generativelanguage.googleapis.com',
    'api.groq.com'
];

/* ---------------- Install ---------------- */

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_VERSION).then(function (cache) {
            /* addAll fails hard if any file is missing. Use individual
             * puts so a single missing file doesn't block install. */
            return Promise.all(
                PRECACHE.map(function (url) {
                    return cache.add(url).catch(function () { /* ignore */ });
                })
            );
        }).then(function () {
            return self.skipWaiting();
        })
    );
});

/* ---------------- Activate ---------------- */

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(
                keys.filter(function (k) { return k !== CACHE_VERSION; })
                    .map(function (k) { return caches.delete(k); })
            );
        }).then(function () {
            return self.clients.claim();
        })
    );
});

/* ---------------- Fetch ---------------- */

self.addEventListener('fetch', function (event) {
    var req = event.request;

    /* Only GET requests are cacheable. */
    if (req.method !== 'GET') return;

    var url;
    try { url = new URL(req.url); } catch (e) { return; }

    /* Never cache AI provider calls — always go to the network. */
    if (NETWORK_ONLY_HOSTS.indexOf(url.hostname) !== -1) {
        return;
    }

    /* Only handle same-origin requests. */
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        caches.match(req).then(function (cached) {
            if (cached) return cached;

            return fetch(req).then(function (response) {
                /* Cache successful same-origin GETs on first fetch. */
                if (response && response.status === 200) {
                    var clone = response.clone();
                    caches.open(CACHE_VERSION).then(function (cache) {
                        cache.put(req, clone).catch(function () {});
                    });
                }
                return response;
            }).catch(function () {
                /* Offline and not cached: fall back to index.html for
                 * navigation requests so the app shell still loads. */
                if (req.mode === 'navigate') {
                    return caches.match('./index.html');
                }
                return new Response('', { status: 503, statusText: 'Offline' });
            });
        })
    );
});