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
let _headingRejected = 0;
const compassDiag = { events: 0, ios: false, perm: 'n/a', absolute: false, webkit: false };
let lockedHeading  = null;   // boussole verrouillée
let compassActive  = false;
let compassListenersAdded = false;
let _visibilityListenerAdded = false;

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
    // localStorage déjà rempli, mais sur iOS la PWA (icône) et Safari
    // ont des localStorage SÉPARÉS alors que le cookie est partagé.
    // Si un rattachement plus récent a été fait côté Safari (scan QR,
    // saisie de code), le cookie le reflète déjà — on lui fait
    // confiance s'il diffère de notre propre valeur, potentiellement
    // périmée dans ce contexte isolé.
    const cookiePilot = getCookie('pilot_id');
    if (cookiePilot && cookiePilot !== localStorage.getItem('pilot_id')) {
      localStorage.setItem('pilot_id', cookiePilot);
      localStorage.removeItem('pilot_attached'); // forcer le re-rattachement
    } else {
      setCookie('pilot_id', localStorage.getItem('pilot_id'), 365);
    }
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
let lastAttachResult = 'pas encore tenté';
async function attachPilotIfNeeded(pilotId, phoneId) {
  if (!window.supabaseClient) { lastAttachResult = 'Supabase indisponible'; return { error: null }; }
  const { data, error } = await window.supabaseClient
    .rpc('vigienid_attach', { p_phone_id: phoneId, p_pilot_id: pilotId });
  lastAttachResult = error ? ('erreur: ' + (error.message || error)) : (data?.error ? ('refus: ' + data.error) : 'OK');
  if (error) return { error };
  if (data?.error === 'blocked') {
    return { error: { message: data.message || 'Contactez votre pilote.' }, blocked: true };
  }
  return { error: data?.error ? { message: data.error } : null };
}

// ==========================
// GPS
// ==========================
let gpsWatchId = null;
let gpsLowAccuracy = false;   // repli réseau si la haute précision n'obtient rien
const gpsDiag = { status: 'démarrage', error: null, fixes: 0 };

function gpsErrorMessage(err) {
  if (!err) return 'Position non reçue.';
  if (err.code === 1) return 'Localisation refusée : autorisez-la pour ce site/cette appli dans les réglages du téléphone.';
  if (err.code === 2) return 'Position indisponible : activez la localisation du téléphone.';
  return 'Délai dépassé : position non reçue.';
}

function startGPS() {
  if (!navigator.geolocation) {
    gpsDiag.status = 'non supporté';
    showGpsProblem('GPS non supporté par ce navigateur.');
    return;
  }
  if (gpsWatchId !== null) {
    try { navigator.geolocation.clearWatch(gpsWatchId); } catch (e) {}
    gpsWatchId = null;
  }
  gpsDiag.status = gpsLowAccuracy ? 'recherche (réseau)' : 'recherche (GPS)';
  gpsWatchId = navigator.geolocation.watchPosition(
    pos => {
      livePos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      gpsDiag.status = 'OK';
      gpsDiag.error = null;
      gpsDiag.fixes++;
      gpsDiag.accuracy = Math.round(pos.coords.accuracy || 0);
      showGpsProblem('');
      if (!lockedPos) updatePosDisplay(livePos);
    },
    err => {
      gpsDiag.status = 'erreur';
      gpsDiag.error = (err && err.code) + ' ' + (err && err.message || '');
      // Android : la haute précision peut ne jamais répondre (intérieur,
      // économie d'énergie). On retente une fois avec la localisation réseau.
      if (err && err.code !== 1 && !gpsLowAccuracy) {
        gpsLowAccuracy = true;
        startGPS();
        return;
      }
      showGpsProblem(gpsErrorMessage(err));
    },
    gpsLowAccuracy
      ? { enableHighAccuracy: false, maximumAge: 60000, timeout: 20000 }
      : { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 }
  );
}

function showGpsProblem(msg) {
  const elLat = document.getElementById('disp-lat');
  const elLon = document.getElementById('disp-lon');
  if (!msg) return;
  if (elLat) elLat.textContent = '⚠️ GPS';
  if (elLon) elLon.textContent = '';
  showToast('📍 ' + msg + ' Touchez "Position" pour réessayer.', 6000);
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
  if (!livePos) {
    gpsLowAccuracy = false;
    startGPS();
    showToast('📍 Recherche de la position… patientez quelques secondes puis touchez à nouveau.', 5000);
    return;
  }
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
    compassDiag.ios = true; compassDiag.perm = 'demandée';
    const overlay = document.getElementById('perm-overlay');
    if (overlay) overlay.classList.add('show');
    const btn = document.getElementById('btn-perm-compass');
    if (btn) btn.onclick = async () => {
      try {
        const r = await DeviceOrientationEvent.requestPermission();
        if (overlay) overlay.classList.remove('show');
        compassDiag.perm = r;
        if (r === 'granted') {
          bindCompass();
        } else {
          // Refusé : sans ce message, l'utilisateur ne voit jamais
          // pourquoi la direction ne fonctionne jamais (position OK,
          // mais boussole muette en silence).
          showToast('🧭 Boussole refusée. Réglages → Safari → Position/Mouvement → réactivez, puis rechargez la page.');
        }
      } catch(e) {
        if (overlay) overlay.classList.remove('show');
        showToast('🧭 Erreur boussole : ' + (e.message || 'réessayez ou rechargez la page.'));
      }
    };
  } else {
    bindCompass();
  }
}

function bindCompass() {
  if (compassListenersAdded) return;
  _attachOrientationListeners();
  compassListenersAdded = true;
  compassActive = true;

  // Sécurité : permission accordée mais aucune donnée valide reçue après
  // quelques secondes -> souvent le réglage global iOS "Accès Mouvement
  // et orientation" (Réglages > Safari > Avancé), distinct du message
  // d'autorisation par site qu'on vient d'accepter.
  setTimeout(() => {
    if (liveHeading === null) {
      showToast('🧭 Boussole muette. Vérifiez Réglages → Safari → Avancé → "Accès mouvement et orientation".');
    }
  }, 6000);

  // Réabonnement au retour au premier plan : sur Android notamment,
  // le verrouillage de l'écran ou le passage en arrière-plan (courant
  // en marchant vers un point d'observation) peut couper silencieusement
  // les écouteurs de capteurs, sans que rien ne prévienne l'appli - la
  // boussole restait alors figée/muette une fois revenu au premier plan,
  // sans lien avec une permission.
  if (!_visibilityListenerAdded) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && compassActive) {
        _detachOrientationListeners();
        _attachOrientationListeners();
      }
    });
    _visibilityListenerAdded = true;
  }
}

function _attachOrientationListeners() {
  // Attache toujours les deux écouteurs, sans se fier à la détection
  // iOS (typeof requestPermission === "function"), qui n'est pas fiable
  // à 100% - certaines versions de Chrome Android la supportent aussi
  // partiellement, ce qui pouvait faire sauter à tort l'écouteur
  // deviceorientationabsolute dont certains appareils Android ont
  // besoin (bug confirmé et corrigé dans Pot à Mèche - même code ici).
  // Sans risque sur iOS : onOrientation() donne de toute façon la
  // priorité à webkitCompassHeading dès qu'il est présent, peu importe
  // quel évènement l'a déclenché.
  window.addEventListener('deviceorientationabsolute', onOrientation, true);
  window.addEventListener('deviceorientation', onOrientation, true);
}

function _detachOrientationListeners() {
  window.removeEventListener('deviceorientation', onOrientation, true);
  window.removeEventListener('deviceorientationabsolute', onOrientation, true);
}

function onOrientation(e) {
  compassDiag.events++;
  compassDiag.absolute = compassDiag.absolute || e.absolute === true;
  compassDiag.webkit = compassDiag.webkit || typeof e.webkitCompassHeading === 'number';
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
    if (delta > 20) {
      // Écarte les sauts isolés, mais si l'écart persiste (5 lectures de
      // suite) c'est que la dernière valeur retenue était fausse ou que
      // le téléphone a vraiment tourné : on repart de la valeur actuelle
      // au lieu de rester figé indéfiniment.
      _headingRejected++;
      if (_headingRejected < 5) return;
    }
    _headingRejected = 0;
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
    const { error: attachErr, blocked } = await attachPilotIfNeeded(pilotId, phoneId);
    if (blocked) {
      showToast('🚫 ' + (attachErr?.message || 'Contactez votre pilote.'));
      if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; }
      return;
    }
    if (!attachErr) localStorage.setItem('pilot_attached', '1');
  }

  const { data, error } = await window.supabaseClient
    .from('chrono_frelon_geo')
    .insert([{
      phone_id:      phoneId,
      source:        'vn',
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
    if (error.message?.includes('sentinelle_supprimee')) {
      showToast('🚫 Contactez votre pilote pour être réintégré(e).');
    } else {
      showToast('❌ Erreur : ' + error.message);
    }
  } else {
    lastSignalId = data?.id || null;
    if (lastSignalId) localStorage.setItem('vigienid_last_signal_id', String(lastSignalId));
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
  // La variable mémoire ne survit pas à une fermeture/réouverture de
  // l'appli - on retombe sur la valeur sauvegardée le cas échéant
  // (sinon "Aucun signalement à annuler" s'affichait à tort, même
  // quand un vrai signalement récent existait bien en base).
  if (!lastSignalId) {
    const saved = localStorage.getItem('vigienid_last_signal_id');
    if (saved) lastSignalId = saved;
  }
  if (!lastSignalId) { showToast('Aucun signalement à annuler'); return; }
  const { data, error } = await window.supabaseClient
    .rpc('vigienid_cancel_signal', { p_signal_id: lastSignalId, p_phone_id: getPhoneId() });
  const result = !error && data ? data : null;
  if (!error && result?.ok) {
    showToast('↩️ Signalement annulé');
    lastSignalId = null;
    localStorage.removeItem('vigienid_last_signal_id');
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
    const { error, blocked } = await attachPilotIfNeeded(pilotId, phoneId);
    if (blocked) {
      showToast('🚫 ' + (error?.message || 'Contactez votre pilote.'));
    } else if (!error) {
      localStorage.setItem('pilot_attached', '1');
    }
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

  // Supprimer l'ancien rattachement si existant (autre pilote)
  await window.supabaseClient
    .rpc('vigienid_delete_attachment', { p_phone_id: phoneId });

  // Rattacher au nouveau pilote (bloqué si sentinelle supprimée par ce pilote)
  const { data: attachData, error: err2 } = await window.supabaseClient
    .rpc('vigienid_attach', { p_phone_id: phoneId, p_pilot_id: pilot.id });

  if (err2) {
    msg.textContent = 'Erreur de rattachement (' + err2.message + ').';
    msg.style.color = '#c00';
    return;
  }
  if (attachData?.error === 'blocked') {
    msg.textContent = '🚫 ' + (attachData.message || 'Contactez votre pilote.');
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

// ==========================
// PREMIER LANCEMENT : DEMANDER LE CODE DU PILOTE
// ==========================
// Une application installée sur l'écran d'accueil perd souvent le lien
// "?pilot=…" reçu dans le navigateur et se retrouve rattachée au pilote par
// défaut (compte "6307-N" sans signalement). On demande alors le code à
// 4 chiffres du pilote, en plein écran, plutôt que de compter sur la petite
// barre du bas que personne ne voit.
function maybeAskPilotCode() {
  if (localStorage.getItem('pilot_id') !== DEFAULT_PILOT_ID) return;
  if (localStorage.getItem('pilot_code_skip') === '1') return;
  if (document.getElementById('pilot-code-overlay')) return;
  const ov = document.createElement('div');
  ov.id = 'pilot-code-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(27,45,62,.97);color:#fff;' +
    'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:28px;text-align:center;';
  ov.innerHTML =
    '<div style="font-size:42px">🔢</div>' +
    '<div style="font-size:18px;font-weight:700;color:#7ec8f7">Code de votre pilote</div>' +
    '<div style="font-size:13px;color:#8fafc8;max-width:280px;line-height:1.6">Votre pilote vous a donné un code à 4 chiffres. ' +
    'Saisissez-le pour être rattaché à lui : vos signalements apparaîtront dans son suivi.</div>' +
    '<input id="pc-input" type="tel" inputmode="numeric" maxlength="4" placeholder="0000" ' +
    'style="font:700 28px monospace;letter-spacing:8px;width:150px;text-align:center;padding:8px;border-radius:10px;border:0">' +
    '<div id="pc-msg" style="font-size:13px;color:#ffb4a8;min-height:18px"></div>' +
    '<button id="pc-ok" style="padding:14px 36px;background:#2a7fc1;color:#fff;border:0;border-radius:99px;font-size:15px;font-weight:600">Valider</button>' +
    '<button id="pc-skip" style="background:none;border:0;color:#8fafc8;font-size:13px;text-decoration:underline">Je n\'ai pas de pilote</button>';
  document.body.appendChild(ov);
  document.getElementById('pc-skip').onclick = () => {
    localStorage.setItem('pilot_code_skip', '1');
    ov.remove();
  };
  document.getElementById('pc-ok').onclick = async () => {
    const val = document.getElementById('pc-input').value.trim();
    const msg = document.getElementById('pc-msg');
    if (val.length !== 4) { msg.textContent = 'Entrez les 4 chiffres.'; return; }
    msg.textContent = 'Vérification…';
    const bar = document.getElementById('input-code-rattach');
    if (bar) bar.value = val;
    await window.rattacherParCode();
    if (localStorage.getItem('pilot_id') !== DEFAULT_PILOT_ID) {
      location.reload();
    } else {
      const barMsg = document.getElementById('code-rattach-msg');
      msg.textContent = (barMsg && barMsg.textContent) || 'Code non reconnu.';
    }
  };
}

window.addEventListener('DOMContentLoaded', () => {
  startGPS();
  startCompass();
  checkReady();
  autoAttachPilot();
  checkShowCodeSection();
  setTimeout(maybeAskPilotCode, 600);
});


// ==========================
// DIAGNOSTIC (à envoyer en capture d'écran au pilote)
// ==========================
window.showDiagnostic = async function() {
  let ov = document.getElementById('diag-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'diag-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(10,20,35,.97);color:#cfe3f5;z-index:10000;' +
      'padding:16px;overflow:auto;font:13px/1.5 monospace;';
    document.body.appendChild(ov);
  }
  const render = () => {
    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    const pid = localStorage.getItem('pilot_id') || '—';
    const lines = [
      'VigieNid v' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '?'),
      'Téléphone : ' + (getPhoneId() || '—'),
      'Pilote : ' + pid,
      'Rattaché (mémoire) : ' + (localStorage.getItem('pilot_attached') ? 'oui' : 'non'),
      'Dernier rattachement : ' + lastAttachResult,
      'Installée sur l\'écran d\'accueil : ' + (standalone ? 'oui' : 'non (navigateur)'),
      '',
      'GPS : ' + gpsDiag.status + (gpsDiag.accuracy ? ' (±' + gpsDiag.accuracy + ' m)' : '') + ' · positions reçues : ' + gpsDiag.fixes,
      'Erreur GPS : ' + (gpsDiag.error || 'aucune'),
      '',
      'Boussole : ' + (compassActive ? 'activée' : 'non activée'),
      'iPhone (autorisation requise) : ' + (compassDiag.ios ? 'oui, ' + compassDiag.perm : 'non'),
      'Mesures reçues : ' + compassDiag.events + (compassDiag.webkit ? ' (iOS)' : '') + (compassDiag.absolute ? ' (absolue)' : ''),
      'Direction actuelle : ' + (liveHeading === null ? 'aucune' : liveHeading + '°'),
      '',
      navigator.userAgent,
    ];
    ov.innerHTML = '<div style="font:700 16px sans-serif;color:#7ec8f7;margin-bottom:10px">🛠 Diagnostic VigieNid</div>' +
      '<pre style="white-space:pre-wrap;word-break:break-all;margin:0 0 14px">' + lines.join('\n').replace(/</g, '&lt;') + '</pre>' +
      '<button id="diag-test" style="padding:10px 16px;margin:0 8px 8px 0;border:0;border-radius:8px;background:#2a7fc1;color:#fff;font-size:14px">Tester le rattachement</button>' +
      '<button id="diag-gps" style="padding:10px 16px;margin:0 8px 8px 0;border:0;border-radius:8px;background:#2a7fc1;color:#fff;font-size:14px">Relancer le GPS</button>' +
      '<button id="diag-close" style="padding:10px 16px;margin:0 0 8px;border:0;border-radius:8px;background:#555;color:#fff;font-size:14px">Fermer</button>' +
      '<div style="font:12px sans-serif;color:#8fafc8;margin-top:6px">Faites une capture d\'écran de cette page et envoyez-la à votre pilote.</div>';
    ov.style.display = 'block';
    document.getElementById('diag-close').onclick = () => { ov.style.display = 'none'; };
    document.getElementById('diag-gps').onclick = () => { gpsLowAccuracy = false; startGPS(); setTimeout(render, 4000); };
    document.getElementById('diag-test').onclick = async () => {
      await attachPilotIfNeeded(localStorage.getItem('pilot_id') || DEFAULT_PILOT_ID, getPhoneId());
      render();
    };
  };
  render();
};
