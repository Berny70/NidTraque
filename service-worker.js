/* ==========================
   SERVICE WORKER – Chrono Frelon
   ========================== */

const APP_VERSION = "14.1";
const CACHE_NAME = "chrono-frelon-v14.1";

/* ⚠️ Liste STRICTE des fichiers à mettre en cache
   (éviter "./" qui peut matcher trop large) */
const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./version.js",
  "./manifest.json",
  "./icon_4_chrono_2.png",

  // JS
  "./js/i18n.js",
  "./js/help.js",

  // I18N
  "./i18n/fr.json",
  "./i18n/en.json",
  "./i18n/de.json",
  "./i18n/it.json"
];

/* ==========================
   INSTALL
   ========================== */
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
});

/* ==========================
   ACTIVATE
   ========================== */
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

/* ==========================
   FETCH (SÉCURISÉ)
   ========================== */
self.addEventListener("fetch", event => {
  const req = event.request;

  if (
    req.method !== "GET" ||
    !req.url.startsWith(self.location.origin)
  ) {
    return;
  }

  // Network-first pour index.html et service-worker.js
  // pour détecter les mises à jour
  const isNavigation = req.destination === "document" ||
                       req.url.includes("service-worker.js") ||
                       req.url.includes("version.js");

  if (isNavigation) {
    event.respondWith(
      fetch(req)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cacheRes => {
      return (
        cacheRes ||
        fetch(req).catch(() => {
          if (req.destination === "document") {
            return caches.match("/Chrono_Frelon/distrib/index.html");
          }
        })
      );
    })
  );
});

/* ==========================
   MESSAGE (DEBUG / VERSION)
   ========================== */
self.addEventListener("message", event => {
  if (event.data === "GET_VERSION") {
    event.source.postMessage({
      version: APP_VERSION
    });
  }
});










































