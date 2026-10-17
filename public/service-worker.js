/* Replaced by the Vite build plugin with the production manifest and version. */
const SCOPE_KEY = encodeURIComponent(new URL(self.registration.scope).pathname);
const CACHE_PREFIX = `rontenseiri-shell-${SCOPE_KEY}-`;
const VERSION = __RONTENSEIRI_VERSION__;
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const ASSETS = __RONTENSEIRI_ASSETS__;
const ASSET_URLS = new Set(
  ASSETS.map((asset) => new URL(asset, self.location.href).href),
);
const APP_SCOPE = new URL(
  "./",
  self.registration ? self.registration.scope : self.location.href,
);
let installFailures = [];

function isAllowedAsset(request) {
  const url = new URL(request.url);
  return (
    request.method === "GET" &&
    url.origin === self.location.origin &&
    ASSET_URLS.has(request.url)
  );
}

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  installFailures = [];
  for (const asset of ASSETS) {
    try {
      const request = new Request(new URL(asset, self.location.href).href, {
        cache: "no-store",
      });
      const response = await fetch(request);
      if (!response.ok)
        throw new Error(`${response.status} ${response.statusText}`);
      await cache.put(request, response);
    } catch (error) {
      installFailures.push(`${asset}: ${String(error)}`);
    }
  }
  if (installFailures.length) throw new Error(installFailures.join("; "));
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "RONTENSEIRI_STATUS") return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const requests = await cache.keys();
      let bytes = 0;
      for (const request of requests) {
        const response = await cache.match(request);
        if (response) {
          try {
            bytes += (await response.clone().arrayBuffer()).byteLength;
          } catch {
            /* size is best effort */
          }
        }
      }
      event.ports[0]?.postMessage({
        type: "RONTENSEIRI_STATUS",
        version: VERSION,
        cacheName: CACHE_NAME,
        entries: requests.length,
        expectedEntries: ASSETS.length,
        bytes,
        failures: installFailures,
        scope: APP_SCOPE.pathname,
      });
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!isAllowedAsset(request)) return;
  event.respondWith(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.match(request, { ignoreVary: true }))
      .then((hit) => hit || fetch(request)),
  );
});
