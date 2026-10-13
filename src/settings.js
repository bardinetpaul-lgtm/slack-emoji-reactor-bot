// ═══════════════════════════════════════════════════════════
//  ⚙️ MODULE SETTINGS
//  Réglages du jeu modifiables en live par un admin (onglet Accueil),
//  persistés dans data/settings.json (runtime, gitignored).
//    { creditsPerJeanpip: 0.5, farmMaxPerHour: 10, ticketPrice: 5, ticketDailyLimit: 10 }
// ═══════════════════════════════════════════════════════════

const path = require('path');
const { readJson, writeJsonAtomic } = require('./storage');

const SETTINGS_PATH = path.join(__dirname, '..', 'data', 'settings.json');

// 💰 Crédits gagnés par Jeanpip envoyé : multiple de 0,5 entre MIN et MAX
const DEFAULT_CREDITS_PER_JEANPIP = 0.5;
const CREDITS_PER_JEANPIP_MIN = 0.5;
const CREDITS_PER_JEANPIP_MAX = 10;

// 🚜 Anti-farm : nombre max de Jeanpips par heure glissante (entier), au-delà → pénalité
const DEFAULT_FARM_MAX_PER_HOUR = 10;
const FARM_MAX_PER_HOUR_MIN = 1;
const FARM_MAX_PER_HOUR_MAX = 100;

// 🎟️ Tickets à gratter : prix (JP$) et nombre max par jour et par joueur (entiers)
const DEFAULT_TICKET_PRICE = 5;
const TICKET_PRICE_MIN = 1;
const TICKET_PRICE_MAX = 100;
const DEFAULT_TICKET_DAILY_LIMIT = 10;
const TICKET_DAILY_LIMIT_MIN = 1;
const TICKET_DAILY_LIMIT_MAX = 100;

function load() {
  try {
    const data = readJson(SETTINGS_PATH, {});
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function save(data) {
  writeJsonAtomic(SETTINGS_PATH, data);
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

/** Valeur valide = entier dans [MIN, MAX]. */
function isValidFarmMaxPerHour(value) {
  return Number.isInteger(value) && value >= FARM_MAX_PER_HOUR_MIN && value <= FARM_MAX_PER_HOUR_MAX;
}

function getFarmMaxPerHour() {
  const value = load().farmMaxPerHour;
  return isValidFarmMaxPerHour(value) ? value : DEFAULT_FARM_MAX_PER_HOUR;
}

/**
 * Change la limite anti-farm (Jeanpips max par heure). Effet immédiat,
 * les pénalités déjà en cours ne sont pas modifiées.
 * Retourne { ok, value?, previous?, error? } (error = 'invalide' | 'ecriture').
 */
function setFarmMaxPerHour(value) {
  if (!isValidFarmMaxPerHour(value)) return { ok: false, error: 'invalide' };
  const data = load();
  const previous = getFarmMaxPerHour();
  data.farmMaxPerHour = value;
  try {
    save(data);
  } catch (e) {
    return { ok: false, error: 'ecriture', detail: e.message };
  }
  return { ok: true, value, previous };
}

const isIntIn = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const isValidTicketPrice = (v) => isIntIn(v, TICKET_PRICE_MIN, TICKET_PRICE_MAX);
const isValidTicketDailyLimit = (v) => isIntIn(v, TICKET_DAILY_LIMIT_MIN, TICKET_DAILY_LIMIT_MAX);

function getTicketPrice() {
  const value = load().ticketPrice;
  return isValidTicketPrice(value) ? value : DEFAULT_TICKET_PRICE;
}

function getTicketDailyLimit() {
  const value = load().ticketDailyLimit;
  return isValidTicketDailyLimit(value) ? value : DEFAULT_TICKET_DAILY_LIMIT;
}

/**
 * Change le prix et la limite quotidienne des tickets à gratter (effet immédiat,
 * les tickets déjà achetés gardent leur prix et leur lot).
 * Retourne { ok, price?, limit?, previous?: { price, limit }, error?, field? }
 * (error = 'invalide' | 'ecriture', field = 'price' | 'limit').
 */
function setTicketSettings({ price, limit }) {
  if (!isValidTicketPrice(price)) return { ok: false, error: 'invalide', field: 'price' };
  if (!isValidTicketDailyLimit(limit)) return { ok: false, error: 'invalide', field: 'limit' };
  const data = load();
  const previous = { price: getTicketPrice(), limit: getTicketDailyLimit() };
  data.ticketPrice = price;
  data.ticketDailyLimit = limit;
  try {
    save(data);
  } catch (e) {
    return { ok: false, error: 'ecriture', detail: e.message };
  }
  return { ok: true, price, limit, previous };
}

module.exports = {
  getTicketPrice,
  getTicketDailyLimit,
  setTicketSettings,
  TICKET_PRICE_MIN,
  TICKET_PRICE_MAX,
  TICKET_DAILY_LIMIT_MIN,
  TICKET_DAILY_LIMIT_MAX,
  getFarmMaxPerHour,
  setFarmMaxPerHour,
  isValidFarmMaxPerHour,
  DEFAULT_FARM_MAX_PER_HOUR,
  FARM_MAX_PER_HOUR_MIN,
  FARM_MAX_PER_HOUR_MAX,
  getCreditsPerJeanpip,
  setCreditsPerJeanpip,
  isValidCreditsPerJeanpip,
  DEFAULT_CREDITS_PER_JEANPIP,
  CREDITS_PER_JEANPIP_MIN,
  CREDITS_PER_JEANPIP_MAX,
};
