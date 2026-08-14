// FinStride service worker — lightweight, dependency-free offline caching.
//
// Strategies:
//   • Static assets (JS/CSS/fonts/icons): cache-first, falling back to network.
//   • Page navigations: network-first, falling back to the cached "/" shell
//     when the network is unreachable.
//   • Supabase (and any /rest, /auth API path): always network, never cached —
//     mutating writes and auth/data reads must never be served stale.
//
// Bump CACHE_VERSION whenever the caching logic itself changes so activate's
// cleanup drops the old caches; app code changes don't need a bump since
// assets are already content-hashed by the build.
const CACHE_VERSION = "v1";
const STATIC_CACHE = `finstride-static-${CACHE_VERSION}`;
const SHELL_CACHE = `finstride-shell-${CACHE_VERSION}`;
const SHELL_URL = "/";

const STATIC_EXTENSION_RE = /\.(?:js|css|woff2?|ttf|otf|eot|png|jpe?g|svg|gif|webp|ico)$/;

function isApiRequest(url) {
  return (
    url.pathname.startsWith("/rest/v1/") ||
    url.pathname.startsWith("/auth/v1/") ||
    url.hostname.endsWith(".supabase.co")
  );
}

function isStaticAsset(url) {
  return url.origin === self.location.origin && STATIC_EXTENSION_RE.test(url.pathname);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add(SHELL_URL))
      // Swallow failures (offline install, transient 5xx) so a bad network
      // moment never blocks the service worker from installing at all.
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== SHELL_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(SHELL_URL, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(SHELL_URL);
    if (cached) return cached;
    return new Response(
      "FinStride is offline and no cached page is available yet — reconnect and reload once.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Never intercept mutations — only GET is safe to serve from cache or retry.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (isApiRequest(url)) return; // pass straight through to the network

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirstAsset(request));
  }
  // Everything else (same-origin non-static GETs, other cross-origin calls):
  // untouched, default browser handling.
});
