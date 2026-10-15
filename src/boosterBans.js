// ═══════════════════════════════════════════════════════════
//  🚫 MODULE SANCTIONS BOOSTERS (v3.2)
//  Un admin interdit à un joueur d'acheter un type de booster pendant
//  N jours (ex. clics automatiques sur Octobre Rose). Le bouton
//  disparaît de son Accueil et tout clic est refusé sans débit.
//  Les boosters déjà en main et ceux gagnés en Arène ne sont pas touchés.
//
//  DB = data/booster-bans.json
//    { bans: { "<userId>:<type>": { userId, type, until, at, by, reason } } }
//  Une sanction expirée reste dans le fichier (historique) mais ne
//  bloque plus rien.
// ═══════════════════════════════════════════════════════════

const path = require('path');
const { readJson, writeJsonAtomic } = require('./storage');

const BANS_PATH = path.join(__dirname, '..', 'data', 'booster-bans.json');
const DAY_MS = 24 * 3600 * 1000;
const MAX_DAYS = 60;

const keyOf = (userId, type) => `${userId}:${type}`;

function load() {
  const data = readJson(BANS_PATH, { bans: {} });
  return data && typeof data.bans === 'object' ? data : { bans: {} };
}

/**
 * Interdit `type` à `userId` pendant `days` jours à partir de `now`
 * (remplace une sanction en cours). → { userId, type, until, … }
 */
function ban(userId, type, days, { by = null, reason = '', now = Date.now() } = {}) {
  const data = load();
  const entry = { userId, type, until: now + days * DAY_MS, at: new Date(now).toISOString(), by, reason: reason || '' };
  data.bans[keyOf(userId, type)] = entry;
  writeJsonAtomic(BANS_PATH, data);
  return entry;
}

/** Lève la sanction en cours. → true si une sanction était active. */
function lift(userId, type, now = Date.now()) {
  const data = load();
  const entry = data.bans[keyOf(userId, type)];
  if (!entry || entry.until <= now) return false;
  entry.until = now;
  writeJsonAtomic(BANS_PATH, data);
  return true;
}

/** Sanction active pour ce joueur et ce booster, ou null. */
function activeBan(userId, type, now = Date.now()) {
  if (!userId || !type) return null;
  const entry = load().bans[keyOf(userId, type)];
  return entry && entry.until > now ? entry : null;
}

/** Sanctions en cours (panneau admin), la plus longue en dernier. */
function listActive(now = Date.now()) {
  return Object.values(load().bans).filter((b) => b.until > now).sort((a, b) => a.until - b.until);
}

module.exports = { MAX_DAYS, ban, lift, activeBan, listActive };
