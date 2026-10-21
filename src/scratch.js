// ═══════════════════════════════════════════════════════════
//  🎟️ MODULE TICKET À GRATTER « ESSAI ! » (logique pure)
//  Façon Goal / Maxi Goal (FDJ), en version rugby : 9 ballons ovales
//  à gratter (grille 3×3), 3 symboles identiques = le lot du symbole.
//  Les ballons gagnent AU PLUS un lot : on tire d'abord le lot, puis on
//  construit une grille qui le montre.
//  v3.6 : la zone SCORE est un 2e jeu, tiré À PART : « Votre score » plus
//  grand que le « Score adverse » = mise remboursée (1 ticket sur 4), que
//  les ballons gagnent ou non (avant, elle ne faisait que raconter les ballons).
//
//  Équilibre (validé par Paul le 13/10, rééquilibré le 21/10 pour le score) :
//    • lots JP$ = multiples de la mise → le prix (réglable par un admin)
//      ne change pas la rentabilité ;
//    • légendaire = prix ÷ 500 (1/100 à 5 JP$, décision de Paul le 21/10 ; avant
//      ÷ 300 = 1/60) → ~500 JP$ dépensés par légendaire, ~3 par mois pour qui
//      joue ses 10 tickets chaque jour ;
//    • retour JP$ ≈ 64 % de la mise au total (ballons ~39 % + score 25 %),
//      ~1 ticket sur 2,7 gagnant (ballons ou score).
//  Aucun accès disque ici : testable seul (scripts/test-scratch.js).
// ═══════════════════════════════════════════════════════════

const GRID_SIZE = 9;

// Les 7 symboles (ordre = légende du ticket, du plus beau au perdant)
const SYMBOLS = {
  trophy: { emoji: '🏆', label: 'Coupe' },
  posts: { emoji: '🥅', label: 'Poteaux' },
  ball: { emoji: '🏉', label: 'Ballon ovale' },
  jersey: { emoji: '👕', label: 'Maillot' },
  boot: { emoji: '👟', label: 'Crampon' },
  whistle: { emoji: '📣', label: 'Sifflet' },
  card: { emoji: '🟨', label: 'Carton jaune' },
};
const SYMBOL_KEYS = Object.keys(SYMBOLS);

// Lots JP$ des ballons : multiple de la mise + chance (probabilité par ticket)
// v3.6 : chances baissées pour faire de la place au score (le Sifflet, imprimé
// dans la légende du ticket, reste un lot)
const JP_PRIZES = [
  { symbol: 'posts', multiplier: 40, chance: 0.002 },
  { symbol: 'ball', multiplier: 10, chance: 0.006 },
  { symbol: 'jersey', multiplier: 4, chance: 0.02 },
  { symbol: 'boot', multiplier: 2, chance: 0.04 },
  { symbol: 'whistle', multiplier: 1, chance: 0.09 },
];
// 🏉 Zone SCORE (v3.6) : tirée à part des ballons
const SCORE_PRIZE = { multiplier: 1, chance: 0.25 };
const LEGENDARY_SYMBOL = 'trophy';
const LEGENDARY_JP_PER_CARD = 500;   // JP$ dépensés en moyenne par légendaire (v3.6 : 300 → 500)
const LEGENDARY_MAX_CHANCE = 0.5;

/** Chance de légendaire pour un ticket à ce prix. */
function legendaryChance(price) {
  return Math.min(LEGENDARY_MAX_CHANCE, price / LEGENDARY_JP_PER_CARD);
}

/** Lot JP$ (arrondi au demi-JP$) d'un multiple de la mise. */
function prizeAmount(price, multiplier) {
  return Math.round(price * multiplier * 2) / 2;
}

/** Table des lots pour un prix donné (légende du ticket). */
function prizeTable(price) {
  return [
    { symbol: LEGENDARY_SYMBOL, kind: 'legendary', chance: legendaryChance(price) },
    ...JP_PRIZES.map((p) => ({ symbol: p.symbol, kind: 'jp', multiplier: p.multiplier, amount: prizeAmount(price, p.multiplier), chance: p.chance })),
  ];
}

/**
 * Tire le lot d'un ticket.
 * @returns {{ kind: 'legendary'|'jp'|'lose', symbol: string|null, amount: number }}
 */
function drawOutcome(price, rand = Math.random) {
  let roll = rand();
  for (const prize of prizeTable(price)) {
    if (roll < prize.chance) return { kind: prize.kind, symbol: prize.symbol, amount: prize.amount || 0 };
    roll -= prize.chance;
  }
  return { kind: 'lose', symbol: null, amount: 0 };
}

const pick = (list, rand) => list[Math.floor(rand() * list.length)];

function shuffle(list, rand) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * Grille de 9 symboles qui montre ce lot : le symbole gagnant 3 fois,
 * tous les autres 2 fois au plus (la 🏆 une seule fois hors « presque ! »). Perdant : jamais 3 identiques, et une
 * fois sur 3 deux 🏆 (« presque ! ») pour donner envie de rejouer.
 */
function buildGrid(outcome, rand = Math.random) {
  const cells = [];
  const used = {};
  const put = (symbol) => { cells.push(symbol); used[symbol] = (used[symbol] || 0) + 1; };

  if (outcome.symbol) for (let i = 0; i < 3; i++) put(outcome.symbol);
  else if (rand() < 1 / 3) { put(LEGENDARY_SYMBOL); put(LEGENDARY_SYMBOL); }

  // 🏆 Au hasard, une seule Coupe au plus : la paire reste réservée au « presque ! »
  const max = (s) => (s === LEGENDARY_SYMBOL ? Math.max(1, used[s] || 0) : 2);
  while (cells.length < GRID_SIZE) {
    const free = SYMBOL_KEYS.filter((s) => s !== outcome.symbol && (used[s] || 0) < max(s));
    put(pick(free, rand));
  }
  return shuffle(cells, rand);
}

/** Le score gagne-t-il ce ticket ? → { win, amount } (amount = la mise si gagné). */
function drawScore(price, rand = Math.random) {
  const win = rand() < SCORE_PRIZE.chance;
  return { win, amount: win ? prizeAmount(price, SCORE_PRIZE.multiplier) : 0 };
}

/**
 * Zone « SCORE » du ticket (comme le 2e jeu du Maxi Goal), v3.6 : un vrai jeu.
 * Gagné → « Votre score » plus grand ; perdu → défaite ou match nul (1 fois sur 5).
 */
function buildScore(win, rand = Math.random) {
  const points = () => 3 * Math.floor(rand() * 6) + 7 * Math.floor(rand() * 3);   // pénalités + essais transformés
  if (!win) {
    const us = points();
    return { us, them: us + (rand() < 0.2 ? 0 : 1 + Math.floor(rand() * 12)) };
  }
  const them = points();
  return { us: them + 1 + Math.floor(rand() * 15), them };
}

/** Symbole présent 3 fois dans la grille (null si perdante). */
function winningSymbol(grid) {
  const counts = {};
  for (const s of grid) counts[s] = (counts[s] || 0) + 1;
  return Object.keys(counts).find((s) => counts[s] >= 3) || null;
}

module.exports = {
  GRID_SIZE,
  SYMBOLS,
  SYMBOL_KEYS,
  JP_PRIZES,
  SCORE_PRIZE,
  LEGENDARY_SYMBOL,
  legendaryChance,
  prizeAmount,
  prizeTable,
  drawOutcome,
  buildGrid,
  drawScore,
  buildScore,
  winningSymbol,
};
