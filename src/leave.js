// ═══════════════════════════════════════════════════════════
//  🌴 MODULE CONGÉS (v3.6)
//  Chaque joueur déclare ses congés (du … au …) depuis l'Accueil.
//  Pendant ces jours, Jeanpip est en pause POUR LUI seul, comme le
//  week-end (src/weekend.js → pauseFor) : ses réactions ne comptent
//  pas, réagir à ses messages ne rapporte rien, pas de raid fait ni
//  subi, pas d'Arène, de booster, de ticket, aucune notification.
//  Ce qui a commencé avant (raid, combat) se termine normalement.
//  Les compteurs (série, Raid gratuit, JP$ du vendredi) continuent :
//  choix de Paul le 2026-10-21.
//
//  Une seule période par joueur (en cours ou à venir) ; « Je suis
//  rentré » / « Annuler » la supprime.
//  Jours à l'heure de Paris, bornes incluses.
//  DB = data/leaves.json  { users: { U123: { start, end, declaredAt } } }
// ═══════════════════════════════════════════════════════════

const path = require('path');
const { readJson, writeJsonAtomic } = require('./storage');
const { parisDay } = require('./octobreRose');
const { periodProblem } = require('./closure');

const LEAVES_PATH = path.join(__dirname, '..', 'data', 'leaves.json');
const MAX_DAYS = 60;

function load() {
  const data = readJson(LEAVES_PATH, { users: {} });
  return data && data.users && typeof data.users === 'object' ? data : { users: {} };
}
const save = (data) => writeJsonAtomic(LEAVES_PATH, data);

/** Congés en cours ou à venir de ce joueur ({ start, end }), ou null (finis = oubliés). */
function getLeave(userId, now = Date.now()) {
  const leave = userId ? load().users[userId] : null;
  return leave && leave.end >= parisDay(now) ? leave : null;
}

/** Ce joueur est-il en congés aujourd'hui ? → ses congés, ou null. */
function activeLeave(userId, now = Date.now()) {
  const leave = getLeave(userId, now);
  return leave && leave.start <= parisDay(now) ? leave : null;
}

/** Déclare (ou remplace) ses congés. → { ok, leave } | { ok: false, error } */
function declareLeave(userId, start, end, now = Date.now()) {
  const problem = periodProblem(start, end, now, MAX_DAYS);
  if (problem) return { ok: false, error: problem };
  const data = load();
  // Un début dans le passé = aujourd'hui (on ne réécrit pas l'histoire)
  const today = parisDay(now);
  const leave = { start: start < today ? today : start, end, declaredAt: now };
  data.users[userId] = leave;
  save(data);
  return { ok: true, leave };
}

/** « Je suis rentré » / « Annuler » : supprime ses congés. → true si il y en avait. */
function endLeave(userId) {
  const data = load();
  if (!data.users[userId]) return false;
  delete data.users[userId];
  save(data);
  return true;
}

module.exports = { MAX_DAYS, getLeave, activeLeave, declareLeave, endLeave, LEAVES_PATH };
