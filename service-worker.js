/* ==========================
   SERVICE WORKER – VigieNid
   Network-first sur tout — mise à jour fiable
   (aligné sur le modèle Pot à Mèche / Chrono_Frelon)
   ========================== */

const APP_VERSION = "1.6";
const CACHE_NAME  = "vigienid-v1.6";

/* ==========================
   INSTALL — on ne précache rien,
   le cache se remplit au fur et à mesure
   ========================== */
self.addEventListener("install", event => {
  self.skipWaiting();
});

/* ==========================
   ACTIVATE — purger les anciens caches
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
   FETCH — Network-first sur tout
   Fallback cache si hors ligne
   ========================== */
self.addEventListener("fetch", event => {
  const req = event.request;

  // Ignorer les requêtes non-GET et cross-origin (Supabase, tuiles…)
  if (
    req.method !== "GET" ||
    !req.url.startsWith(self.location.origin)
  ) {
    return;
  }

  event.respondWith(
    fetch(req)
      .then(res => {
        // Mettre en cache la réponse fraîche
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone));
        }
        return res;
      })
      .catch(() => {
        // Hors ligne : servir depuis le cache
        return caches.match(req).then(cached => {
          if (cached) return cached;
          // Fallback ultime : page d'accueil
          if (req.destination === "document") {
            return caches.match("./index.html");
          }
        });
      })
  );
});

/* ==========================
   MESSAGE (DEBUG / VERSION)
   ========================== */
self.addEventListener("message", event => {
  if (event.data === "GET_VERSION") {
    event.source.postMessage({ version: APP_VERSION });
  }
});
