// SignalForge service worker — makes the app installable and opens
// instantly on repeat visits. Price data is always fetched fresh from
// the network (never cached), so signals stay current.

const CACHE = "signalforge-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest"];

// Install: pre-cache the app shell.
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

// Activate: clear old caches on version bump.
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy:
//  - Live price APIs (Binance/CoinGecko): ALWAYS network, never cache.
//    Stale prices would mean stale signals — unacceptable for this app.
//  - Everything else (the app shell/assets): cache-first for instant loads,
//    falling back to network.
self.addEventListener("fetch", (e) => {
  const url = e.request.url;
  const isPriceApi =
    url.includes("api.binance.com") || url.includes("api.coingecko.com");

  if (isPriceApi) {
    e.respondWith(fetch(e.request)); // always fresh
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
