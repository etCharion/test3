/**
 * Service worker: statický caching bez předgenerovaného seznamu souborů.
 *
 * Navigace jde přes síť (nová verze se projeví hned), ostatní soubory z cache
 * s aktualizací na pozadí. Bez sítě se aplikace otevře z cache – seznam knih
 * je v localStorage, takže je k dispozici i offline.
 */

const CACHE = 'skener-knihovny-v1';
const CORE = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Katalog a CDN se necachují – odpovědi musí být čerstvé.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then((cached) => cached || caches.match('./index.html'))
            .then((fallback) => fallback || Response.error()),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Aktualizace na pozadí, aby se příště načetla novější verze.
        fetch(request)
          .then((response) => {
            if (response.ok) {
              caches.open(CACHE).then((cache) => cache.put(request, response)).catch(() => undefined);
            }
          })
          .catch(() => undefined);
        return cached;
      }
      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
          }
          return response;
        })
        .catch(() => Response.error());
    }),
  );
});
