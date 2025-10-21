/* Minimal PWA SW (no Workbox) */
const CACHE = "ghc-cache-v1";
self.addEventListener("install", (e)=> self.skipWaiting());
self.addEventListener("activate", (e)=> e.waitUntil(clients.claim()));
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (req.headers.get("accept")?.includes("text/html")) {
    event.respondWith(fetch(req).catch(()=> caches.match("/index.html")));
  } else {
    event.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        cache.put(req, res.clone());
        return res;
      })
    );
  }
});
