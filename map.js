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
let nests = [];
let nestsVisible = false; // masqué par défaut, cohérent avec ChassNid Admin
let guessActive = false;
let guessMarker = null;
let ignRouteLayer = null;

// Pendant "Point supposé", les points/fuseaux ne doivent plus intercepter
// le clic (sinon impossible de cliquer pile à leur intersection, qui est
// justement l'endroit recherché) — même principe que ChassNid Admin.
(function() {
  const style = document.createElement('style');
  style.textContent =
    '.leaflet-container.tool-active .leaflet-interactive { pointer-events: none !important; }' +
    '.leaflet-container.tool-active .leaflet-marker-icon.guess-marker,' +
    '.leaflet-container.tool-active .leaflet-marker-icon.guess-marker * { pointer-events: auto !important; }';
  document.head.appendChild(style);
})();

// ==========================
// INITIALISATION CARTE
// ==========================
const map = L.map("map").setView([46.5, 2.5], 6);
const observationsLayer = L.layerGroup().addTo(map);
const nestsLayer = L.layerGroup(); // ajoutée/retirée selon nestsVisible

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
    div.innerHTML =
      `<button id="btn-toggle-nests-vn" style="
        width:100%;margin-bottom:6px;padding:6px 10px;
        background:#fff;color:#333;
        border:1px solid rgba(0,0,0,0.15);border-radius:8px;
        font-family:'DM Sans',sans-serif;font-size:13px;
        font-weight:600;cursor:pointer;text-align:left">
        🪺 Nids ${nestsVisible ? 'visibles' : 'masqués'}
      </button>` +
      `<button id="btn-toggle-guess-vn" style="
        width:100%;margin-bottom:6px;padding:6px 10px;
        background:#fff;color:#333;
        border:1px solid rgba(0,0,0,0.15);border-radius:8px;
        font-family:'DM Sans',sans-serif;font-size:13px;
        font-weight:600;cursor:pointer;text-align:left">
        📍 Point supposé
      </button>` +
      Object.entries(BASEMAPS).map(([key, bm]) =>
        `<button class="basemap-btn${key === (localStorage.getItem('chassnid_basemap') || 'osm') ? ' basemap-btn--active' : ''}" data-basemap="${key}">${bm.label}</button>`
      ).join('');
    L.DomEvent.disableClickPropagation(div);
    div.addEventListener('click', e => {
      const btn = e.target.closest('.basemap-btn');
      if (btn) applyBasemap(btn.dataset.basemap);
      if (e.target.closest('#btn-toggle-nests-vn')) toggleNestsVisibility();
      if (e.target.closest('#btn-toggle-guess-vn')) toggleGuess();
    });
    return div;
  };
  ctrl.addTo(map);
}

// ── POINT SUPPOSÉ (nid non confirmé) ───────────────────────────
// Outil ponctuel, rien n'est enregistré en base : place un repère,
// affiche ses coordonnées et un lien direct vers Google Maps pour s'y
// rendre sur le terrain — même principe que ChassNid Admin.
function toggleGuess() {
  guessActive = !guessActive;
  const btn = document.getElementById('btn-toggle-guess-vn');

  if (guessActive) {
    if (btn) { btn.style.background = '#e53935'; btn.style.color = '#fff'; }
    map.on('click', onGuessClick);
    map.getContainer().style.cursor = 'crosshair';
    map.getContainer().classList.add('tool-active');
  } else {
    if (btn) { btn.style.background = '#fff'; btn.style.color = '#333'; }
    map.off('click', onGuessClick);
    map.getContainer().style.cursor = '';
    map.getContainer().classList.remove('tool-active');
    if (guessMarker) { map.removeLayer(guessMarker); guessMarker = null; }
    if (ignRouteLayer) { map.removeLayer(ignRouteLayer); ignRouteLayer = null; }
  }
}

function onGuessClick(e) {
  const { lat, lng } = e.latlng;
  const latStr = lat.toFixed(5);
  const lngStr = lng.toFixed(5);
  const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${latStr},${lngStr}`;
  // Géoportail IGN : cartes officielles françaises, bien plus précises
  // que Google Maps en zone rurale/forestière (parcelles, relief, sentiers).
  const ignUrl = `https://www.geoportail.gouv.fr/carte?c=${lngStr},${latStr}&z=19&l0=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2::GEOPORTAIL:OGC:WMTS(1)&permalink=yes`;

  if (guessMarker) map.removeLayer(guessMarker);
  if (ignRouteLayer) { map.removeLayer(ignRouteLayer); ignRouteLayer = null; }

  guessMarker = L.marker(e.latlng, {
    icon: L.divIcon({
      className: 'guess-marker',
      html: '<div style="font-size:28px;line-height:1;transform:translate(-50%,-100%)">📍</div>',
      iconSize: [0, 0],
    })
  }).addTo(map);

  guessMarker.bindPopup(`
    <div style="font-size:13px;line-height:1.6">
      <b>📍 Point supposé</b><br>
      ${latStr}, ${lngStr}<br>
      <a href="${ignUrl}" target="_blank" rel="noopener"
         style="display:inline-block;margin-top:6px;padding:6px 10px;background:#2d6a2d;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">
        🗺️ Ouvrir sur Géoportail (IGN)
      </a><br>
      <a href="${gmapsUrl}" target="_blank" rel="noopener"
         style="display:inline-block;margin-top:6px;padding:6px 10px;background:#1e88e5;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">
        🧭 Ouvrir dans Google Maps
      </a><br>
      <button class="ign-route-btn" data-lat="${latStr}" data-lng="${lngStr}"
         style="display:block;width:100%;margin-top:6px;padding:6px 10px;background:#e65100;color:#fff;border:none;border-radius:6px;font-weight:600;font-family:inherit;font-size:13px;cursor:pointer">
        🚗 Itinéraire IGN depuis ma position
      </button>
      <div class="ign-route-result" style="font-size:12px;color:#555;margin-top:4px"></div>
    </div>
  `, { maxWidth: 240 }).openPopup();
}

// ── ITINÉRAIRE IGN (Géoplateforme) depuis la position actuelle ──
// Calcule un itinéraire routier via l'API publique data.geopf.fr et le
// dessine directement sur la carte (aucun lien externe à ouvrir).
function fetchIgnRoute(destLat, destLng, cb) {
  if (!navigator.geolocation) { cb(null, "Géolocalisation indisponible sur cet appareil"); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const startLat = pos.coords.latitude;
      const startLng = pos.coords.longitude;
      const url = `https://data.geopf.fr/navigation/itineraire?resource=bdtopo-pgr&start=${startLng},${startLat}&end=${destLng},${destLat}&profile=pedestrian&optimization=fastest&geometryFormat=geojson`;
      fetch(url)
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(data => cb(data, null))
        .catch(() => cb(null, "Service d'itinéraire IGN indisponible pour le moment"));
    },
    () => cb(null, "Position actuelle indisponible (GPS refusé ou hors de portée)"),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
}

document.addEventListener('click', function(e) {
  const btn = e.target.closest('.ign-route-btn');
  if (!btn) return;
  const destLat = parseFloat(btn.dataset.lat);
  const destLng = parseFloat(btn.dataset.lng);
  const resultEl = btn.parentElement ? btn.parentElement.querySelector('.ign-route-result') : null;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Calcul en cours…';
  fetchIgnRoute(destLat, destLng, (data, err) => {
    btn.disabled = false;
    btn.textContent = originalText;
    if (err || !data || !data.geometry || !data.geometry.coordinates) {
      if (resultEl) resultEl.textContent = '⚠️ ' + (err || "Itinéraire indisponible");
      return;
    }
    if (ignRouteLayer) map.removeLayer(ignRouteLayer);
    const latlngs = data.geometry.coordinates.map(c => [c[1], c[0]]);
    ignRouteLayer = L.polyline(latlngs, { color: '#e65100', weight: 5, opacity: 0.85 }).addTo(map);
    map.fitBounds(ignRouteLayer.getBounds(), { padding: [30, 30] });
    const distKm = (data.distance / 1000).toFixed(1);
    const durMin = Math.round(data.duration / 60);
    if (resultEl) resultEl.textContent = `✅ ${distKm} km · ~${durMin} min à pied`;
  });
});

applyBasemap(localStorage.getItem('chassnid_basemap') || 'osm');
addBasemapControl();

// ==========================
// NIDS (affichage sur la carte partagée)
// ==========================

// ==========================
// CODE COULEUR ANNUEL (marquage des reines)
// ==========================
// 1/6 blanc · 2/7 jaune · 3/8 rouge · 4/9 vert · 5/0 bleu
function queenColorForYear(year) {
  const mod = ((year % 10) + 10) % 10;
  if (mod === 1 || mod === 6) return { bg: '#ffffff', border: '#555555', label: 'Blanc' };
  if (mod === 2 || mod === 7) return { bg: '#ffe600', border: '#a68b00', label: 'Jaune' };
  if (mod === 3 || mod === 8) return { bg: '#e74c3c', border: '#7b241c', label: 'Rouge' };
  if (mod === 4 || mod === 9) return { bg: '#2ecc71', border: '#1e8449', label: 'Vert' };
  return                             { bg: '#3498db', border: '#1a5276', label: 'Bleu' };
}

function nestYear(n) {
  if (n.found_at) return new Date(n.found_at).getFullYear();
  if (n.annee) return parseInt(n.annee, 10);
  return new Date().getFullYear();
}

function nestIcon(type, year) {
  const isPrimaire = type === 'primaire';
  const qc = queenColorForYear(year);
  return L.divIcon({
    html: `<div style="
      width:22px;height:22px;display:flex;align-items:center;justify-content:center;
      font-size:13px;border-radius:50%;
      border:3px ${isPrimaire ? 'solid' : 'dashed'} ${qc.border};
      background:${qc.bg};
      box-shadow:0 2px 5px rgba(0,0,0,0.35);
    ">🪺</div>`,
    className: '',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

async function chargerNidsAutour(lat, lon) {
  const { data, error } = await window.supabaseClient.rpc(
    "get_nearby_nests",
    { lat, lon, radius_m: 25000 }
  );
  if (error) {
    console.error("Erreur RPC get_nearby_nests :", error);
    return [];
  }
  return data || [];
}

function afficherNids() {
  nestsLayer.clearLayers();
  nests.forEach(n => {
    if (!n.lat || !n.lon) return;
    const year = nestYear(n);
    const qc = queenColorForYear(year);
    L.marker([n.lat, n.lon], { icon: nestIcon(n.type, year) })
      .bindPopup(`
        <div style="font-size:13px;line-height:1.6">
          🪺 Nid ${n.type === 'primaire' ? '⬤ primaire' : '⭘ secondaire'}<br>
          📅 ${n.found_at ? new Date(n.found_at).toLocaleDateString('fr-FR') : year}<br>
          🎨 Couleur de l'année : <b>${qc.label}</b> (${year})
        </div>
      `, { maxWidth: 220 })
      .addTo(nestsLayer);
  });
}

function toggleNestsVisibility() {
  nestsVisible = !nestsVisible;
  const btn = document.getElementById('btn-toggle-nests-vn');
  if (btn) btn.textContent = `🪺 Nids ${nestsVisible ? 'visibles' : 'masqués'}`;
  if (nestsVisible) nestsLayer.addTo(map);
  else map.removeLayer(nestsLayer);
}

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
    const pseudoStr = isMine
      ? '👤 Moi'
      : (obs.pseudo ? `🏷️ ${obs.pseudo}` : `📱 ${(obs.phone_id||'').substring(0,8)}…`);

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
      radius_m: 25000,
      p_phone_id: localStorage.getItem('phone_id'),
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
      nests = await chargerNidsAutour(lat, lon);
      afficherNids();

      // normalisation distance
      observations = observations.map(o => {
        if (o.distance == null) o.distance = 0;
        return o;
      });

      if (!observations.length) {
        alert(
          t("map_no_shared_data") ||
          "Aucune donnée partagée dans un rayon de 25 km"
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
