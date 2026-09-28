// NABL Tools service worker — basic offline/app-shell support.
//
// Strategy (kept deliberately simple over clever):
//   - Same-origin static assets (/_astro/*, /icons/*, fonts, images, etc.):
//     cache-first, with a non-blocking background refresh (stale-while-
//     revalidate) so the cache stays reasonably fresh without slowing down
//     repeat visits.
//   - HTML navigations: network-first, falling back to the cache, then to
//     a minimal inline offline page if nothing cached matches.
//   - Cross-origin requests (CDN-hosted engines/models a tool may fetch,
//     analytics, etc.) are left completely untouched — see the "Not
//     implemented" note below.
//
// Bump CACHE_VERSION to force old caches to be dropped on the next visit.

const CACHE_VERSION = 'v1';
const CACHE_NAME = `nabl-${CACHE_VERSION}`;

// A small, hand-picked app shell precached on install. Individual tool
// pages are cached on first visit instead (via the fetch handler below)
// rather than precached here, to keep the install step fast and cheap.
const APP_SHELL = ['/', '/video', '/pdf', '/image', '/devices', '/manifest.webmanifest'];

const OFFLINE_FALLBACK_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Offline — NABL Tools</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f1ea; color: #141413; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; text-align: center; }
    main { max-width: 32rem; }
    h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
    p { color: #4a4842; }
  </style>
</head>
<body>
  <main>
    <h1>You're offline</h1>
    <p>This page hasn't been cached yet. Reconnect and reload to try again — pages you've already visited stay available offline.</p>
  </main>
</body>
</html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isStaticAssetPath(pathname) {
  return (
    pathname.startsWith('/_astro/') ||
    pathname.startsWith('/icons/') ||
    pathname.startsWith('/fonts/') ||
    pathname.startsWith('/og/') ||
    /\.(?:css|js|mjs|woff2?|ttf|otf|svg|png|jpe?g|webp|avif|ico)$/.test(pathname)
  );
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);

  if (cached) {
    // Stale-while-revalidate: return the cached asset immediately, let the
    // network fetch above update the cache in the background for next time.
    networkFetch.catch(() => {});
    return cached;
  }

  const fresh = await networkFetch;
  if (fresh) return fresh;
  return new Response('', { status: 504, statusText: 'Offline and not cached' });
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    const shell = await cache.match('/');
    if (shell) return shell;
    return new Response(OFFLINE_FALLBACK_HTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // cross-origin: pass through untouched

  const isNavigation = request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isStaticAssetPath(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

// Not implemented here (documented follow-up, not silently skipped):
// per-tool "engine" caching — e.g. ffmpeg.wasm, whisper/onnx model files,
// tesseract language data — fetched from cross-origin CDNs by tools like
// video-compressor, transcribe, and ocr. Those need explicit
// `cache.add()`/`cache.put()` calls made by the tool code itself (this
// service worker deliberately leaves cross-origin requests untouched
// above), scoped per engine/version, so a tool can opt in to offline reuse
// of a multi-hundred-MB model without this file having to guess which
// origins and paths are safe to cache indefinitely.
