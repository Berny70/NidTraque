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
// INIT PILOT ID (QR CODE)
// ==========================
(function initPilotId() {
  const params = new URLSearchParams(window.location.search);
  const pilotParam = params.get('pilot');
  if (pilotParam) {
    localStorage.setItem('pilot_id', pilotParam);
    localStorage.removeItem('pilot_attached');
  } else if (!localStorage.getItem('pilot_id')) {
    localStorage.setItem('pilot_id', DEFAULT_PILOT_ID);
  }
})();

// ==========================
// PHONE ID
// ==========================
function getPhoneId() {
  let id = localStorage.getItem('phone_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('phone_id', id);
  }
  return id;
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
    const { error: attachErr } = await window.supabaseClient
      .from('pilot_users')
      .upsert({ pilot_id: pilotId, phone_id: phoneId }, { onConflict: 'pilot_id,phone_id' });
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
  const { error } = await window.supabaseClient
    .from('chrono_frelon_geo')
    .delete()
    .eq('id', lastSignalId);
  if (!error) {
    showToast('↩️ Signalement annulé');
    lastSignalId = null;
  } else {
    showToast('❌ ' + error.message);
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

// ==========================
// BOUTON ADMIN
// ==========================
async function initAdminButton() {
  const pilotId = localStorage.getItem('pilot_id');
  if (!pilotId || !window.supabaseClient) return;
  const { data } = await window.supabaseClient
    .rpc('chassnid_is_admin', { p_pilot_id: pilotId });
  if (data === true) {
    const btn = document.getElementById('btn-share');
    if (btn) btn.style.display = 'block';
  }
}

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
    await window.supabaseClient
      .from('pilot_users')
      .upsert({ pilot_id: selfPilotId, phone_id: phoneId }, { onConflict: 'pilot_id,phone_id' });
    localStorage.setItem('pilot_attached', '1');
    console.log('[VigieNid] Pilote auto-rattaché :', selfPilotId);
    return;
  }

  // Sentinelle normale — rattacher au pilote du QR code si pas encore fait
  if (!localStorage.getItem('pilot_attached')) {
    const { error } = await window.supabaseClient
      .from('pilot_users')
      .upsert({ pilot_id: pilotId, phone_id: phoneId }, { onConflict: 'pilot_id,phone_id' });
    if (!error) localStorage.setItem('pilot_attached', '1');
  }
}

// ==========================
// DÉMARRAGE
// ==========================
window.addEventListener('DOMContentLoaded', () => {
  startGPS();
  startCompass();
  checkReady();
  initAdminButton();
  autoAttachPilot();
});
