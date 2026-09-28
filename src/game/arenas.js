// ═══════════════════════════════════════════════════════════
//  🏟️ MODULE ARÈNES (progression)
//  Le premier combat se joue au jardin ; les victoires débloquent
//  les arènes suivantes. Le challenger choisit une arène QU'IL a
//  débloquée, quel que soit le niveau de son adversaire.
//  (Le dessin des arènes est dans public/arena-board.js.)
// ═══════════════════════════════════════════════════════════

const ARENAS = [
  { key: 'jardin',   level: 1, name: 'Le jardin',        minWins: 0 },
  { key: 'port',     level: 2, name: 'Le port',          minWins: 10 },
  { key: 'serveurs', level: 3, name: 'La salle serveur', minWins: 25 },
];

const byKey = (key) => ARENAS.find((a) => a.key === key) || null;

/** Meilleure arène débloquée pour `wins` victoires. */
function levelOf(wins = 0) {
  return [...ARENAS].reverse().find((a) => wins >= a.minWins);
}

function unlocked(wins = 0) {
  return ARENAS.filter((a) => wins >= a.minWins).map((a) => a.key);
}

function canPlay(wins, key) {
  const a = byKey(key);
  return Boolean(a) && wins >= a.minWins;
}

/** Prochain palier → { key, name, winsLeft } ou null s'il n'y en a plus. */
function nextUnlock(wins = 0) {
  const next = ARENAS.find((a) => a.minWins > wins);
  return next ? { key: next.key, name: next.name, winsLeft: next.minWins - wins } : null;
}

module.exports = { ARENAS, byKey, levelOf, unlocked, canPlay, nextUnlock };
