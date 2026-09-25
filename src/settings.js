// ═══════════════════════════════════════════════════════════
//  ⚙️ MODULE SETTINGS
//  Réglages du jeu modifiables en live par un admin (onglet Accueil),
//  persistés dans data/settings.json (runtime, gitignored).
//    { creditsPerJeanpip: 0.5 }
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, '..', 'data', 'settings.json');

// 💰 Crédits gagnés par Jeanpip envoyé : multiple de 0,5 entre MIN et MAX
const DEFAULT_CREDITS_PER_JEANPIP = 0.5;
const CREDITS_PER_JEANPIP_MIN = 0.5;
const CREDITS_PER_JEANPIP_MAX = 10;

function load() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return {};
    const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function save(data) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

/** Valeur valide = multiple de 0,5 dans [MIN, MAX]. */
function isValidCreditsPerJeanpip(value) {
  return Number.isFinite(value)
    && value >= CREDITS_PER_JEANPIP_MIN
    && value <= CREDITS_PER_JEANPIP_MAX
    && Number.isInteger(value * 2);
}

function getCreditsPerJeanpip() {
  const value = load().creditsPerJeanpip;
  return isValidCreditsPerJeanpip(value) ? value : DEFAULT_CREDITS_PER_JEANPIP;
}

/**
 * Change la valeur d'un Jeanpip en crédits (pas de rétroactivité).
 * Retourne { ok, value?, previous?, error? } (error = 'invalide' | 'ecriture').
 */
function setCreditsPerJeanpip(value) {
  if (!isValidCreditsPerJeanpip(value)) return { ok: false, error: 'invalide' };
  const data = load();
  const previous = getCreditsPerJeanpip();
  data.creditsPerJeanpip = value;
  try {
    save(data);
  } catch (e) {
    return { ok: false, error: 'ecriture', detail: e.message };
  }
  return { ok: true, value, previous };
}

module.exports = {
  getCreditsPerJeanpip,
  setCreditsPerJeanpip,
  isValidCreditsPerJeanpip,
  DEFAULT_CREDITS_PER_JEANPIP,
  CREDITS_PER_JEANPIP_MIN,
  CREDITS_PER_JEANPIP_MAX,
};
