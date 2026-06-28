// ==========================
// MODE (LOCAL / PARTAGÉ)
// ==========================
const mapSearchParams = new URLSearchParams(window.location.search);
const MODE_SHARED = mapSearchParams.get("mode") === "shared";
const MODE_MINE   = mapSearchParams.get("mode") === "mine";

const _savedDecl = localStorage.getItem("declinaison");
let declinaison = _savedDecl !== null ? (parseFloat(_savedDecl) || 3) : 3;

// ==========================
// DONNÉES
// ==========================
let observations = [];

// ==========================
// INITIALISATION CARTE
// ==========================
const map = L.map("map").setView([46.5, 2.5], 6);
const observationsLayer = L.layerGroup().addTo(map);

// ── FONDS DE CARTE (alignés sur ChassNid Admin) ────────────
const BASEMAPS = {
  osm:       { label: '🗺 Standard',  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',                                                          opts: { attribution: '© OpenStreetMap', maxZoom: 19 } },
  topo:      { label: '🏔 Topo',      url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',                                                            opts: { attribution: '© OpenTopoMap',   maxZoom: 17 } },
  relief:    { label: '🌄 Relief',    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}',          opts: { attribution: '© Esri',          maxZoom: 13 } },
  satellite: { label: '🛰 Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',                opts: { attribution: '© Esri',          maxZoom: 19 } },
};

let currentBasemapLayer = null;

function applyBasemap(key) {
  const bm = BASEMAPS[key] || BASEMAPS.osm;
  if (currentBasemapLayer) map.removeLayer(currentBasemapLayer);
  currentBasemapLayer = L.tileLayer(bm.url, bm.opts).addTo(map);
  localStorage.setItem('chassnid_basemap', key);
  document.querySelectorAll('.basemap-btn').forEach(btn => {
    btn.classList.toggle('basemap-btn--active', btn.dataset.basemap === key);
  });
}

function addBasemapControl() {
  const ctrl = L.control({ position: 'bottomright' });
  ctrl.onAdd = () => {
    const div = L.DomUtil.create('div', 'basemap-control');
    div.innerHTML = Object.entries(BASEMAPS).map(([key, bm]) =>
      `<button class="basemap-btn${key === (localStorage.getItem('chassnid_basemap') || 'osm') ? ' basemap-btn--active' : ''}" data-basemap="${key}">${bm.label}</button>`
    ).join('');
    L.DomEvent.disableClickPropagation(div);
    div.addEventListener('click', e => {
      const btn = e.target.closest('.basemap-btn');
      if (btn) applyBasemap(btn.dataset.basemap);
    });
    return div;
  };
  ctrl.addTo(map);
}

applyBasemap(localStorage.getItem('chassnid_basemap') || 'osm');
addBasemapControl();

// ==========================
// MODE LOCAL / MES SIGNALEMENTS
// ==========================
if (!MODE_SHARED) {
  if (MODE_MINE) {
    // Charger mes signalements depuis Supabase
    chargerMesSignalements();
  } else {
  observations = JSON.parse(
    localStorage.getItem("chronoObservations") || "[]"
  );

  // 🔧 NORMALISATION (OPTION B compatible)
  observations = observations.map(o => {
    if (o.distance == null) {
      o.distance = 0; // distance inconnue → hypothèse
    }
    return o;
  });

  if (!observations.length) {
    alert(
      t("map_no_data_title") + "\n\n" +
      "• " + t("map_no_data_1") + "\n" +
      "• " + t("map_no_data_2")
    );
    map.setView([46.5, 2.5], 6);
  } else {
    centrerCarte(observations);
    afficherObservations();
  }
  } // fin else MODE_MINE
}

// ==========================
// MODE PARTAGÉ
// ==========================
if (MODE_SHARED) {
  chargerObservationsPartagees();
}

// ==========================
// SAUVEGARDE ZOOM LOCAL
// ==========================
map.on("moveend", () => {
  if (MODE_SHARED) return;

  const center = map.getCenter();
  const zoom = map.getZoom();

  localStorage.setItem(
    "mapView",
    JSON.stringify({
      center: [center.lat, center.lng],
      zoom
    })
  );
});

// ==========================
// AFFICHAGE OBSERVATIONS
// ==========================
function afficherObservations() {

  observations.forEach(obs => {

    if (
      obs.lat == null ||
      obs.lon == null ||
      obs.direction == null
    ) return;

    const start = [obs.lat, obs.lon];

    // couleur (manuel = noir)
    const color = obs.color === "manual"
      ? "black"
      : (obs.color || "red");

    // ==========================
    // DISTANCE (manuel OU calcul)
    // ==========================
    let distance = obs.distance || 0;

    if (
      distance === 0 &&
      obs.essais &&
      obs.essais.length &&
      obs.vitesse
    ) {
      const total = obs.essais.reduce((a, b) => a + b, 0);
      const moy = total / obs.essais.length;
      distance = moy * obs.vitesse / 2;
    }

    // ==========================
    // DIRECTION AVEC DECLINAISON
    // ==========================
    let direction = obs.direction + declinaison;

    if (direction < 0) direction += 360;
    if (direction >= 360) direction -= 360;

    // ==========================
    // POINT
    // ==========================
    const marker = L.circleMarker(start, {
      radius: 6,
      color,
      fillColor: color,
      fillOpacity: 1
    }).addTo(observationsLayer);

    marker.bindPopup(
      `<b>${t("map_station")}</b><br>
       ${t("map_distance")}: ${Math.round(distance)} m<br>
       ${t("map_direction")}: ${Math.round(direction)}°`
    );

    // ==========================
    // FUSEAU DIRECTIONNEL (±5°)
    // ==========================
    const fuseauLength = distance === 0 ? 1500 : distance;
    const halfAngle = parseInt(localStorage.getItem("vigienid_angle") || "5");
    const fuseauPoints = buildFuseau(obs.lat, obs.lon, direction, fuseauLength, halfAngle);

    const dateStr   = obs.created_at ? new Date(obs.created_at).toLocaleString('fr-FR') : '—';
    const destStr   = obs.destination   ? `<br>🌿 ${obs.destination}`   : '';
    const freqStr   = obs.frequentation ? `<br>🐝 ${obs.frequentation}` : '';
    const isMine    = obs.phone_id === localStorage.getItem('phone_id');
    const pseudoStr = isMine ? '👤 Moi' : `📱 ${(obs.phone_id||'').substring(0,8)}…`;

    const popup = `<div style="font-size:13px;line-height:1.8;min-width:160px">
      <b>${pseudoStr}</b><br>
      📅 ${dateStr}<br>
      📍 ${(obs.lat||0).toFixed(5)}, ${(obs.lon||0).toFixed(5)}<br>
      🧭 ${Math.round(direction)}° · ${Math.round(fuseauLength)}m
      ${destStr}${freqStr}
    </div>`;

    L.polygon(fuseauPoints, {
      color,
      weight:      1.5,
      opacity:     0.8,
      fillColor:   color,
      fillOpacity: 0.22,
      dashArray:   distance === 0 ? "6 6" : null,
    }).bindPopup(popup, { maxWidth: 220 }).addTo(observationsLayer);

  }); // ✅ FIN DU forEach
}     // ✅ FIN DE afficherObservations
// ==========================
// CENTRAGE CARTE
// ==========================
function centrerCarte(data) {
  const points = data
    .filter(o => o.lat && o.lon)
    .map(o => [o.lat, o.lon]);

  const savedView = localStorage.getItem("mapView");

  if (!MODE_SHARED && savedView) {
    const { center, zoom } = JSON.parse(savedView);
    map.setView(center, zoom);

  } else if (points.length === 1) {
    map.setView(points[0], 16);

  } else if (points.length > 1) {
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [30, 30] });

  } else {
    map.setView([46.5, 2.5], 6);
  }
}

// ==========================
// SUPABASE – RPC
// ==========================
async function chargerDonneesAutour(lat, lon) {
  const { data, error } = await window.supabaseClient.rpc(
    "get_nearby_frelons",
    {
      lat,
      lon,
      radius_m: 10000
    }
  );

  if (error) {
    console.error("Erreur RPC Supabase :", error);
    return [];
  }

  return data || [];
}

// ==========================
// MES SIGNALEMENTS
// ==========================
async function chargerMesSignalements() {
  const phoneId = localStorage.getItem('phone_id');
  if (!phoneId || !window.supabaseClient) {
    map.setView([46.5, 2.5], 6);
    return;
  }

  const { data, error } = await window.supabaseClient
    .from('chrono_frelon_geo')
    .select('*')
    .eq('phone_id', phoneId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error || !data?.length) {
    alert('Aucun signalement trouvé pour votre appareil.');
    map.setView([46.5, 2.5], 6);
    return;
  }

  observations = data.map(o => ({ ...o, distance: o.distance || 0 }));
  afficherObservations();

  // Zoom niveau commune (~14) centré sur les signalements
  const points = observations.filter(o => o.lat && o.lon).map(o => [o.lat, o.lon]);
  if (points.length === 1) {
    map.setView(points[0], 14);
  } else if (points.length > 1) {
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 14 });
  }
}

// ==========================
// MODE PARTAGÉ : CHARGEMENT
// ==========================
async function chargerObservationsPartagees() {
  navigator.geolocation.getCurrentPosition(
    async pos => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      observations = await chargerDonneesAutour(lat, lon);

      // normalisation distance
      observations = observations.map(o => {
        if (o.distance == null) o.distance = 0;
        return o;
      });

      if (!observations.length) {
        alert(
          t("map_no_shared_data") ||
          "Aucune donnée partagée dans un rayon de 10 km"
        );
        map.setView([lat, lon], 11);
        return;
      }

      centrerCarte(observations);
      afficherObservations();
    },
    () => {
      alert(t("gps_error") || "GPS indisponible");
      map.setView([46.5, 2.5], 6);
    }
  );
}

// ==========================
// CONSTRUCTION DU FUSEAU (secteur angulaire ±5°)
// ==========================
function buildFuseau(lat, lon, bearing, lengthM, halfAngleDeg) {
  const steps  = 8;
  const points = [[lat, lon]];

  for (let i = 0; i <= steps; i++) {
    const a   = bearing - halfAngleDeg + (2 * halfAngleDeg * i / steps);
    const dst = destinationPoint(lat, lon, a, lengthM);
    points.push([dst.lat, dst.lon]);
  }

  points.push([lat, lon]);
  return points;
}

// ==========================
// GÉOMÉTRIE : POINT DESTINATION
// ==========================
function destinationPoint(lat, lon, bearing, distance) {
  const R = 6371000;
  const δ = distance / R;
  const θ = bearing * Math.PI / 180;

  const φ1 = lat * Math.PI / 180;
  const λ1 = lon * Math.PI / 180;

  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) +
    Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );

  const λ2 = λ1 + Math.atan2(
    Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
  );

  return {
    lat: φ2 * 180 / Math.PI,
    lon: λ2 * 180 / Math.PI
  };
}

// ==========================
// BOUTON RETOUR
// ==========================
document.getElementById("btnBackMap")?.addEventListener("click", () => {
  location.href = "index.html";
});
// ==========================
// DECLINAISON SIMPLE
// ==========================
function initDeclinaison() {
  const input = document.getElementById("declinaisonInput");
  if (!input) return;

  const saved = localStorage.getItem("declinaison");

  if (saved !== null) {
    declinaison = parseFloat(saved);
  } else {
    declinaison = 3; // valeur par défaut
  }

  input.value = declinaison.toFixed(1);
}

// modification
function setupDeclinaison() {
  const input = document.getElementById("declinaisonInput");
  if (!input) return;

  input.addEventListener("input", () => {
    let val = parseFloat(input.value.replace(",", "."));

    if (isNaN(val)) return;

    if (val > 30) val = 30;
    if (val < -30) val = -30;

    declinaison = val;

    localStorage.setItem("declinaison", declinaison);

    observationsLayer.clearLayers();
    afficherObservations();
  });
}

// init
document.addEventListener("DOMContentLoaded", () => {
  initDeclinaison();
  setupDeclinaison();
});
