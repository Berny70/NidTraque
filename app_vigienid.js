// ============================================================
//  VigieNid – app_vigienid.js
//  Moteur basé sur Pot à Mèche v14, interface VigieNid
// ============================================================

// ==========================
// CONFIG
// ==========================
const DEFAULT_PILOT_ID = 'af095067-eb9b-4603-b850-0406e777b252';

// ==========================
// ÉTAT
// ==========================
let liveHeading    = null;   // boussole live
let lastHeading    = null;
let lockedHeading  = null;   // boussole verrouillée
let compassActive  = false;
let compassListenersAdded = false;

let livePos    = null;       // GPS live {lat, lon}
let lockedPos  = null;       // GPS verrouillé
let lastSignalId = null;

// ==========================
// COOKIES (persistance partagée Safari ↔ PWA installée sur iOS)
// localStorage est cloisonné entre Safari et une PWA installée sur
// iOS (limitation Apple), donc on duplique pilot_id dans un cookie,
// qui lui reste partagé entre les deux contextes.
// ==========================
function setCookie(name, value, days) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}
function getCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

// ==========================
// INIT PILOT ID (QR CODE)
// ==========================
(function initPilotId() {
  const params = new URLSearchParams(window.location.search);
  const pilotParam = params.get('pilot');
  if (pilotParam) {
    localStorage.setItem('pilot_id', pilotParam);
    setCookie('pilot_id', pilotParam, 365);
    localStorage.removeItem('pilot_attached');
  } else if (!localStorage.getItem('pilot_id')) {
    // Pas de paramètre dans l'URL et rien en localStorage : cas
    // typique d'une PWA installée sur iOS qui ne voit pas le
    // localStorage rempli depuis Safari. On retombe sur le cookie
    // (partagé) avant de retomber sur le pilote par défaut.
    const cookiePilot = getCookie('pilot_id');
    localStorage.setItem('pilot_id', cookiePilot || DEFAULT_PILOT_ID);
  } else {
    // localStorage déjà rempli : on s'assure que le cookie est
    // synchronisé pour les futures installations PWA.
    setCookie('pilot_id', localStorage.getItem('pilot_id'), 365);
  }
})();

// ==========================
// PHONE ID
// ==========================
function getPhoneId() {
  let id = localStorage.getItem('phone_id');
  if (!id) {
    // localStorage vide (typiquement : PWA fraîchement installée sur
    // iOS, isolée du localStorage Safari) — on tente le cookie avant
    // de générer un nouvel identifiant aléatoire, pour ne pas perdre
    // le rattachement existant (pseudo, historique, etc.)
    id = getCookie('phone_id');
    if (!id) {
      id = crypto.randomUUID();
    }
    localStorage.setItem('phone_id', id);
  }
  setCookie('phone_id', id, 365);
  return id;
}

// ==========================
// RATTACHEMENT SANS UPDATE
// ==========================
// Remplace l'ancien upsert() : la policy RLS UPDATE sur pilot_users a été
// retirée par sécurité (elle était trop permissive), donc un upsert qui
// tombe sur un conflit (ligne déjà existante) échouerait désormais.
// On vérifie d'abord l'existence, puis on insère seulement si absent —
// aucun droit UPDATE n'est nécessaire pour ce cas d'usage.
async function attachPilotIfNeeded(pilotId, phoneId) {
  if (!window.supabaseClient) return { error: null };
  const { data: existing } = await window.supabaseClient
    .from('pilot_users')
    .select('phone_id')
    .eq('pilot_id', pilotId)
    .eq('phone_id', phoneId)
    .maybeSingle();
  if (existing) return { error: null }; // déjà rattaché, rien à faire
  return window.supabaseClient
    .from('pilot_users')
    .insert({ pilot_id: pilotId, phone_id: phoneId });
}

// ==========================
// GPS
// ==========================
function startGPS() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(
    pos => {
      livePos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      if (!lockedPos) updatePosDisplay(livePos);
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
  );
}

function updatePosDisplay(pos) {
  const elLat = document.getElementById('disp-lat');
  const elLon = document.getElementById('disp-lon');
  if (elLat) elLat.textContent = 'Lat: ' + pos.lat.toFixed(5);
  if (elLon) elLon.textContent = 'Long: ' + pos.lon.toFixed(5);
}

window.lockGPS = function() {
  if (lockedPos) {
    lockedPos = null;
    const btn = document.getElementById('btn-gps');
    if (btn) { btn.textContent = 'Position'; btn.classList.remove('locked'); }
    checkReady();
    return;
  }
  if (!livePos) { showToast('⚠️ GPS non disponible'); return; }
  lockedPos = { ...livePos };
  updatePosDisplay(lockedPos);
  const btn = document.getElementById('btn-gps');
  if (btn) { btn.textContent = '✅ Position'; btn.classList.add('locked'); }
  checkReady();
};

// ==========================
// BOUSSOLE (identique Pot à Mèche)
// ==========================
// ==========================
// CALIBRATION BOUSSOLE
// ==========================
let _calibHintTimer = null;

function showCalibrationHint() {
  let el = document.getElementById('compass-calib-hint');
  if (!el) {
    el = document.createElement('div');
    el.id = 'compass-calib-hint';
    el.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);' +
      'background:#f39c12;color:#fff;padding:8px 14px;border-radius:8px;font-size:13px;' +
      'z-index:9999;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.3);cursor:pointer;';
    el.innerHTML = '🧭 Boussole imprécise — faire un "8" avec le téléphone';
    el.addEventListener('click', () => hideCalibrationHint());
    document.body.appendChild(el);
  }
  el.style.display = 'block';
  // Masquer automatiquement après 5 secondes
  if (_calibHintTimer) clearTimeout(_calibHintTimer);
  _calibHintTimer = setTimeout(() => hideCalibrationHint(), 5000);
}

function hideCalibrationHint() {
  const el = document.getElementById('compass-calib-hint');
  if (el) el.style.display = 'none';
  if (_calibHintTimer) { clearTimeout(_calibHintTimer); _calibHintTimer = null; }
}

function startCompass() {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    const overlay = document.getElementById('perm-overlay');
    if (overlay) overlay.classList.add('show');
    const btn = document.getElementById('btn-perm-compass');
    if (btn) btn.onclick = async () => {
      try {
        const r = await DeviceOrientationEvent.requestPermission();
        if (overlay) overlay.classList.remove('show');
        if (r === 'granted') bindCompass();
      } catch(e) {
        if (overlay) overlay.classList.remove('show');
      }
    };
  } else {
    bindCompass();
  }
}

function bindCompass() {
  if (compassListenersAdded) return;
  const isIOS = typeof DeviceOrientationEvent !== 'undefined' &&
                typeof DeviceOrientationEvent.requestPermission === 'function';
  if (isIOS) {
    window.addEventListener('deviceorientation', onOrientation, true);
  } else {
    window.addEventListener('deviceorientationabsolute', onOrientation, true);
    window.addEventListener('deviceorientation', onOrientation, true);
  }
  compassListenersAdded = true;
  compassActive = true;
}

function onOrientation(e) {
  if (!compassActive) return;

  let heading = null;
  if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) {
    heading = e.webkitCompassHeading;
    // Vérifier la précision de calibration iOS
    const accuracy = e.webkitCompassAccuracy;
    if (typeof accuracy === 'number' && accuracy > 25) {
      showCalibrationHint();
    } else {
      hideCalibrationHint();
    }
  } else if (e.absolute === true && typeof e.alpha === 'number') {
    heading = (360 - e.alpha) % 360;
  }
  if (heading === null || isNaN(heading)) return;

  if (lastHeading !== null) {
    let delta = Math.abs(heading - lastHeading);
    if (delta > 180) delta = 360 - delta;
    if (delta > 20) return;
  }

  lastHeading  = heading;
  liveHeading  = Math.round(heading);

  // Mettre à jour flèche si pas verrouillée
  if (lockedHeading === null) {
    updateArrow(liveHeading);
    const el = document.getElementById('disp-dir');
    if (el) el.textContent = 'Dir: ' + liveHeading + ' deg';
    const sub = document.getElementById('disp-dir-sub');
    if (sub) sub.textContent = 'live boussole';
  }
}

function updateArrow(deg) {
  const el = document.getElementById('arrow-deg');
  if (el) el.textContent = deg + '°';
}

window.lockCompass = function() {
  if (lockedHeading !== null) {
    lockedHeading = null;
    compassActive = true;
    const btn = document.getElementById('btn-compass');
    if (btn) { btn.textContent = 'Boussole'; btn.classList.remove('locked'); }
    const sub = document.getElementById('disp-dir-sub');
    if (sub) sub.textContent = 'live boussole';
    checkReady();
    return;
  }
  if (liveHeading === null) { showToast('⚠️ Boussole non disponible'); return; }
  lockedHeading = liveHeading;
  compassActive = false;
  updateArrow(lockedHeading);
  const el = document.getElementById('disp-dir');
  if (el) el.textContent = 'Dir: ' + lockedHeading + ' deg';
  const sub = document.getElementById('disp-dir-sub');
  if (sub) sub.textContent = '🔒 verrouillée';
  const btn = document.getElementById('btn-compass');
  if (btn) { btn.textContent = '✅ Boussole'; btn.classList.add('locked'); }
  checkReady();
};

// ==========================
// PRÊT À ENVOYER
// ==========================
function checkReady() {
  const btn = document.getElementById('btn-enregister');
  if (btn) btn.disabled = !(lockedPos && lockedHeading !== null);
}

// ==========================
// ENVOYER SIGNALEMENT
// ==========================
window.doSignal = async function() {
  if (!lockedPos || lockedHeading === null) return;

  const btn = document.getElementById('btn-enregister');
  if (btn) { btn.disabled = true; btn.textContent = 'Envoi en cours…'; }

  const phoneId = getPhoneId();
  const distance = parseInt(localStorage.getItem('vigienid_length') || '800');
  const destination   = window._destination   || null;
  const frequentation = window._frequentation || null;

  // Rattachement pilote
  const pilotId = localStorage.getItem('pilot_id') || DEFAULT_PILOT_ID;
  if (!localStorage.getItem('pilot_attached') && window.supabaseClient) {
    const { error: attachErr } = await attachPilotIfNeeded(pilotId, phoneId);
    if (!attachErr) localStorage.setItem('pilot_attached', '1');
  }

  const { data, error } = await window.supabaseClient
    .from('chrono_frelon_geo')
    .insert([{
      phone_id:      phoneId,
      lat:           lockedPos.lat,
      lon:           lockedPos.lon,
      direction:     lockedHeading,
      distance:      distance,
      destination:   destination,
      frequentation: frequentation,
    }])
    .select('id')
    .single();

  if (error) {
    showToast('❌ Erreur : ' + error.message);
  } else {
    lastSignalId = data?.id || null;
    showToast('✅ Signalement enregistré !');
    // Réinitialiser
    lockedPos     = null;
    lockedHeading = null;
    compassActive = true;
    window._destination   = null;
    window._frequentation = null;
    document.querySelectorAll('.btn-tag').forEach(b => b.classList.remove('selected'));
    const btnG = document.getElementById('btn-gps');
    if (btnG) { btnG.textContent = 'Position'; btnG.classList.remove('locked'); }
    const btnC = document.getElementById('btn-compass');
    if (btnC) { btnC.textContent = 'Boussole'; btnC.classList.remove('locked'); }
    const sub = document.getElementById('disp-dir-sub');
    if (sub) sub.textContent = 'en attente…';
  }

  if (btn) {
    btn.innerHTML = 'Enregistrer la direction carte partagée';
    checkReady();
  }
};

// ==========================
// ANNULER DERNIER
// ==========================
window.cancelLast = async function() {
  if (!lastSignalId) { showToast('Aucun signalement à annuler'); return; }
  const { data, error } = await window.supabaseClient
    .rpc('vigienid_cancel_signal', { p_signal_id: lastSignalId, p_phone_id: getPhoneId() });
  const result = !error && data ? data : null;
  if (!error && result?.ok) {
    showToast('↩️ Signalement annulé');
    lastSignalId = null;
  } else {
    showToast('❌ ' + (error?.message || 'Échec de l\'annulation'));
  }
};

// ==========================
// TOAST
// ==========================
let _toastTimer = null;
function showToast(msg, duration = 3000) {
  const t = document.getElementById('toast');
  if (!t) { alert(msg); return; }
  t.textContent = msg;
  t.className = 'toast show';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.className = 'toast'; }, duration);
}

// ==========================
// CARTE (délégué à map.js)
// ==========================
window.showMapMine = function() {
  localStorage.setItem('vigienid_map_mode', 'mine');
  location.href = 'map.html?mode=mine';
};

window.showMap = function() {
  localStorage.setItem('vigienid_map_mode', 'shared');
  location.href = 'map.html?mode=shared';
};

// ==========================
// QR CODE PARTAGE
// ==========================
let _qrGenerated = false;
window.showQR = function() {
  const overlay = document.getElementById('qr-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  if (!_qrGenerated && typeof QRCode !== 'undefined') {
    const pilotId = localStorage.getItem('pilot_id') || DEFAULT_PILOT_ID;
    const url = location.origin + location.pathname + '?pilot=' + pilotId;
    document.getElementById('qr-url').textContent = url;
    new QRCode(document.getElementById('qr-code'), {
      text: url, width: 200, height: 200,
      colorDark: '#1b2d3e', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });
    _qrGenerated = true;
  }
};

// NOTE : l'affichage de btn-share / btn-settings est géré par le
// script inline dans index.html, qui compare correctement
// pilot.phone_id === phoneId (l'identité du visiteur, pas le rôle
// du pilote affiché dans l'URL). initAdminButton() faisait la même
// vérification de façon incorrecte (chassnid_is_admin sur le pilote
// de l'URL, sans rapport avec qui regarde la page) — supprimée.

// ==========================
// RATTACHEMENT AUTOMATIQUE PILOTE
// ==========================
async function autoAttachPilot() {
  if (!window.supabaseClient) return;

  const phoneId = getPhoneId();
  const pilotId = localStorage.getItem('pilot_id') || DEFAULT_PILOT_ID;

  // Vérifier si ce phone_id correspond à un pilote dans admin_profiles
  const { data: pilotProfile } = await window.supabaseClient
    .from('admin_profiles')
    .select('id, role, phone_id')
    .eq('phone_id', phoneId)
    .in('role', ['pilot', 'admin_dept', 'superadmin'])
    .maybeSingle();

  if (pilotProfile) {
    // C'est un pilote — rattacher automatiquement à son propre secteur
    const selfPilotId = pilotProfile.id;
    await attachPilotIfNeeded(selfPilotId, phoneId);
    localStorage.setItem('pilot_attached', '1');
    return;
  }

  // NOTE : l'association phone_id ↔ pilote se fait désormais UNIQUEMENT
  // via une connexion réelle (email + PIN) dans ChassNid Admin, qui appelle
  // chassnid_register_phone_id de façon sécurisée (session vérifiée).
  // On ne devine plus "premier scan = c'est le pilote" ici : un scan du
  // propre QR code d'un pilote par un tiers (test, curiosité...) ne doit
  // jamais donner accès aux outils pilote (Paramètres/Partager) à ce tiers.

  // Sentinelle normale — rattacher au pilote du QR code si pas encore fait
  if (!localStorage.getItem('pilot_attached')) {
    const { error } = await attachPilotIfNeeded(pilotId, phoneId);
    if (!error) localStorage.setItem('pilot_attached', '1');
  }
}

// NOTE : l'en-tête (Admin/Territoire/Pilote/Sentinelle) et l'édition
// du pseudo (editPseudo, bouton ✏️) sont gérés par le script inline
// dans index.html — pas dupliqués ici pour éviter tout conflit.

// ==========================
// DÉMARRAGE
// ==========================

// ==========================
// RATTACHEMENT PAR CODE 4 CHIFFRES
// ==========================

// Afficher la section code si pas encore rattaché
function checkShowCodeSection() {
  // Toujours visible — permet de changer de pilote en cas d'erreur
  const el = document.getElementById('code-rattachement-section');
  if (el) el.style.display = 'block';
}

window.rattacherParCode = async function() {
  const input = document.getElementById('input-code-rattach');
  const msg = document.getElementById('code-rattach-msg');
  const code = input.value.trim();

  if (code.length !== 4) {
    msg.textContent = 'Entrez exactement 4 chiffres.';
    msg.style.color = '#c00';
    return;
  }

  msg.textContent = 'Vérification…';
  msg.style.color = '#666';

  // Chercher le pilote par son code permanent
  const { data: pilot, error } = await window.supabaseClient
    .from('admin_profiles')
    .select('id')
    .eq('code_sentinelle', code)
    .maybeSingle();

  if (error || !pilot) {
    msg.textContent = 'Code invalide. (' + (error?.message || 'non trouvé') + ')';
    msg.style.color = '#c00';
    return;
  }

  const phoneId = getPhoneId();

  // Supprimer l'ancien rattachement si existant
  await window.supabaseClient
    .rpc('vigienid_delete_attachment', { p_phone_id: phoneId });

  // Insérer le nouveau rattachement
  const { error: err2 } = await window.supabaseClient
    .from('pilot_users')
    .insert({ pilot_id: pilot.id, phone_id: phoneId });

  if (err2) {
    msg.textContent = 'Erreur de rattachement (' + err2.message + ').';
    msg.style.color = '#c00';
    return;
  }

  localStorage.setItem('pilot_id', pilot.id);
  setCookie('pilot_id', pilot.id, 365);
  localStorage.setItem('pilot_attached', 'true');
  setCookie('pilot_attached', 'true', 365);

  // bandeau toujours visible
  msg.textContent = '';
  alert('Rattachement reussi ! Rechargez la page.');
};

window.addEventListener('DOMContentLoaded', () => {
  startGPS();
  startCompass();
  checkReady();
  autoAttachPilot();
  checkShowCodeSection();
});
