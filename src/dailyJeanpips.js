// ═══════════════════════════════════════════════════════════
//  🎯 MODULE JEANPIPS DU JOUR (v3.6)
//  Limite de Jeanpips qui comptent par personne et par jour (réglable :
//  src/settings.js, 20 par défaut), contre le spam de réactions. Au-delà,
//  une réaction ne donne plus rien (ni image, ni JP$, ni point) jusqu'au
//  lendemain 0h (heure de Paris). En échange, chaque Jeanpip rapporte plus
//  (1 JP$ au lieu de 0,5 : même total qu'avant, d'après les données de prod).
//  Ne compte que les Jeanpips réellement crédités.
//
//  DB = data/daily-jeanpips.json  { day: 'AAAA-MM-JJ', users: { U123: n } }
// ═══════════════════════════════════════════════════════════

const path = require('path');
const { readJson, writeJsonAtomic } = require('./storage');
const { parisDay } = require('./octobreRose');

const DAILY_PATH = path.join(__dirname, '..', 'data', 'daily-jeanpips.json');

/** État du jour (un nouveau jour repart de zéro). */
function load(now = Date.now()) {
  const day = parisDay(now);
  const data = readJson(DAILY_PATH, null);
  return data && data.day === day && data.users && typeof data.users === 'object' ? data : { day, users: {} };
}

/** Jeanpips crédités aujourd'hui. */
function countToday(userId, now = Date.now()) {
  return load(now).users[userId] || 0;
}

/** Compte un Jeanpip crédité. → nouveau total du jour. */
function recordToday(userId, now = Date.now()) {
  const data = load(now);
  data.users[userId] = (data.users[userId] || 0) + 1;
  writeJsonAtomic(DAILY_PATH, data);
  return data.users[userId];
}

module.exports = { countToday, recordToday, DAILY_PATH };
