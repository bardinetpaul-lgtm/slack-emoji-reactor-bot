// ═══════════════════════════════════════════════════════════
//  🛒 MODULE BOUTIQUE DE L'ARÈNE (cartes mystère)
//  En préparation, on peut compléter son deck en achetant jusqu'à
//  2 cartes mystère : épique (25 crédits) ou légendaire (40 crédits).
//  La carte est tirée au hasard dans le catalogue et reste cachée
//  jusqu'au combat. Elle ne vaut que pour CE combat : jamais ajoutée
//  à la collection, jamais perdue ni volée. Débit au lancement.
//
//  Dans un deck, un achat est un jeton « shop:epic » / « shop:legendary ».
// ═══════════════════════════════════════════════════════════

const crypto = require('crypto');

const { getAllMedia } = require('../media');

const PRICES = { epic: 25, legendary: 40 };
const MAX_PER_DECK = 2;
const PREFIX = 'shop:';

const token = (rarity) => `${PREFIX}${rarity}`;
const isToken = (u) => typeof u === 'string' && u.startsWith(PREFIX) && Boolean(PRICES[u.slice(PREFIX.length)]);
const tokenRarity = (u) => (isToken(u) ? u.slice(PREFIX.length) : null);

/** Crédits à payer pour les achats d'un deck. */
function deckCost(urls) {
  return urls.filter(isToken).reduce((sum, u) => sum + PRICES[tokenRarity(u)], 0);
}

/** Carte au hasard de cette rareté, absente de `exclude` (null si aucune). */
function drawCard(rarity, exclude = []) {
  const pool = getAllMedia().filter((m) => m.rarity === rarity && !exclude.includes(m.url));
  if (!pool.length) return null;
  return pool[crypto.randomInt(0, pool.length)];
}

module.exports = { PRICES, MAX_PER_DECK, token, isToken, tokenRarity, deckCost, drawCard };
