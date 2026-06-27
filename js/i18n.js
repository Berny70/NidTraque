// ==========================
// I18N GLOBAL
// ==========================
let LANG = "fr";
let STRINGS = {};
const SUPPORTED_LANGS = ["fr", "en", "de", "it", "es", "nl", "als", "bz", "oc", "ik"];

// ==========================
// CHARGEMENT LANGUE
// ==========================
async function loadLang(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) lang = "fr";

  // 🔒 éviter les rechargements inutiles
  if (LANG === lang && Object.keys(STRINGS).length) {
    console.log("[i18n] lang unchanged:", lang);
    return;
  }

  LANG = lang;
  localStorage.setItem("lang", lang);

  console.log("[i18n] loading:", lang);

  const url = `./i18n/${lang}.json`;
  console.log("[i18n] fetch:", url);

  const res = await fetch(url);
  STRINGS = await res.json();

  applyTranslations();
  updateLangButtons();
}

// ==========================
// TRADUCTION
// ==========================
function t(key) {
  // fallback sûr : langue → français → clé
  return (
    STRINGS[key] ??
    window.__I18N_FR__?.[key] ??
    `[${key}]`
  );
}

function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
}

function updateLangButtons() {
  document.querySelectorAll(".lang-bar button[data-lang]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.lang === LANG);
  });
}

// ==========================
// INIT AUTOMATIQUE
// ==========================
document.addEventListener("DOMContentLoaded", async () => {
  console.log("[i18n] init");

  // 🔐 charger le français comme référence
  const frRes = await fetch("./i18n/fr.json");
  window.__I18N_FR__ = await frRes.json();

  const saved = localStorage.getItem("lang");
  const browser = navigator.language.slice(0, 2);

  const lang =
    saved ||
    (SUPPORTED_LANGS.includes(browser) ? browser : "fr");

  loadLang(lang);
});

// ==========================
// CLIC BOUTONS LANGUE
// ==========================
document.addEventListener("click", e => {
  const btn = e.target.closest("button[data-lang]");
  if (!btn) return;

  loadLang(btn.dataset.lang);
});

// ==========================
// DEBUG (optionnel mais utile)
// ==========================
window.i18nDebug = {
  get lang() {
    return LANG;
  },
  get strings() {
    return STRINGS;
  },
  missingKeys(langStrings = STRINGS) {
    return Object.keys(window.__I18N_FR__ || {}).filter(
      k => !(k in langStrings)
    );
  }
};
