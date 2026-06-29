/* ==========================
   SERVICE WORKER – VigieNid
========================== */

const APP_VERSION = "1.5";
const CACHE_NAME  = "vigienid-v1.5";

const FILES_TO_CACHE = [
  "./index.html",
  "./app_vigienid.js",
  "./map.html",
  "./map.js",
  "./manifest.json",
  "./version.js",
  "./icon_vigienid_192.png",
  "./icon_vigienid_512.png",
  "./favicon.ico",
  "./js/supabase.js",
  "./i18n/fr.json"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) return;

  const isNavigation = req.destination === "document" ||
                       req.url.includes("service-worker.js") ||
                       req.url.includes("version.js");

  if (isNavigation) {
    event.respondWith(
      fetch(req).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, clone));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req))
  );
});
