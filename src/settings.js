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
const DEFAULT_CREDITS_PER_JEANPIP = 1;   // v3.6 : 1 JP$ (avec 20 Jeanpips max par jour)
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

// ♻️ v3.6 : plafond de JP$ de revente de doublons, par personne et par semaine (entier)
//    C'est le réglage de la croissance de la monnaie (objectif : +1 à +2 % par mois).
const DEFAULT_RESALE_WEEKLY_CAP = 30;
const RESALE_WEEKLY_CAP_MIN = 0;
const RESALE_WEEKLY_CAP_MAX = 500;
const isValidResaleWeeklyCap = (v) => isIntIn(v, RESALE_WEEKLY_CAP_MIN, RESALE_WEEKLY_CAP_MAX);

function getResaleWeeklyCap() {
  const value = load().resaleWeeklyCap;
  return isValidResaleWeeklyCap(value) ? value : DEFAULT_RESALE_WEEKLY_CAP;
}

/** Change le plafond hebdomadaire de revente (effet immédiat). → { ok, value?, previous?, error? } */
function setResaleWeeklyCap(value) {
  if (!isValidResaleWeeklyCap(value)) return { ok: false, error: 'invalide' };
  const data = load();
  const previous = getResaleWeeklyCap();
  data.resaleWeeklyCap = value;
  try {
    save(data);
  } catch (e) {
    return { ok: false, error: 'ecriture', detail: e.message };
  }
  return { ok: true, value, previous };
}

// 🎯 v3.6 : Jeanpips qui comptent par personne et par jour (entier), contre le spam
const DEFAULT_DAILY_JEANPIP_LIMIT = 20;
const DAILY_JEANPIP_LIMIT_MIN = 1;
const DAILY_JEANPIP_LIMIT_MAX = 200;
const isValidDailyJeanpipLimit = (v) => isIntIn(v, DAILY_JEANPIP_LIMIT_MIN, DAILY_JEANPIP_LIMIT_MAX);

function getDailyJeanpipLimit() {
  const value = load().dailyJeanpipLimit;
  return isValidDailyJeanpipLimit(value) ? value : DEFAULT_DAILY_JEANPIP_LIMIT;
}

/** Change la limite de Jeanpips par jour (effet immédiat). → { ok, value?, previous?, error? } */
function setDailyJeanpipLimit(value) {
  if (!isValidDailyJeanpipLimit(value)) return { ok: false, error: 'invalide' };
  const data = load();
  const previous = getDailyJeanpipLimit();
  data.dailyJeanpipLimit = value;
  try {
    save(data);
  } catch (e) {
    return { ok: false, error: 'ecriture', detail: e.message };
  }
  return { ok: true, value, previous };
}

/**
 * 🎯 v3.6, une seule fois (au premier démarrage de la v3.6) : 20 Jeanpips par jour
 * et 1 JP$ par Jeanpip (décision de Paul le 2026-10-21). Repérée par l'absence de
 * dailyJeanpipLimit dans data/settings.json ; ensuite les réglages admin priment.
 * → true si appliquée.
 */
function applyV36Defaults() {
  const data = load();
  if (data.dailyJeanpipLimit !== undefined) return false;
  data.dailyJeanpipLimit = DEFAULT_DAILY_JEANPIP_LIMIT;
  data.creditsPerJeanpip = 1;
  save(data);
  return true;
}

module.exports = {
  applyV36Defaults,
  getDailyJeanpipLimit,
  setDailyJeanpipLimit,
  DAILY_JEANPIP_LIMIT_MIN,
  DAILY_JEANPIP_LIMIT_MAX,
  getResaleWeeklyCap,
  setResaleWeeklyCap,
  RESALE_WEEKLY_CAP_MIN,
  RESALE_WEEKLY_CAP_MAX,
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
