// ═══════════════════════════════════════════════════════════
//  🃏 MODULE DECKS (Arène)
//  Un deck = 8 cartes DIFFÉRENTES de la collection du joueur ;
//  chaque exemplaire possédé est une pose possible (doublons = munitions).
//
//  collection = [{ url, title, rarity, count, ... }]  (collections.getCollection)
// ═══════════════════════════════════════════════════════════

const { getCardStats } = require('./cards');

const DECK_SIZE = 8;

// Composition visée pour le deck auto (dans l'ordre de priorité)
const AUTO_PLAN = ['guerrier', 'tireur', 'tank', 'essaim', 'sort', 'guerrier', 'tireur', 'pompe'];
const RARITY_RANK = { common: 0, rare: 1, epic: 2, legendary: 3 };

const owned = (collection) => collection.filter((c) => c.count > 0);

function distinctCount(collection) {
  return owned(collection).length;
}

function validateDeck(collection, urls) {
  if (!Array.isArray(urls) || urls.length !== DECK_SIZE) return { ok: false, reason: 'size' };
  if (new Set(urls).size !== urls.length) return { ok: false, reason: 'duplicate' };
  const have = new Set(owned(collection).map((c) => c.url));
  if (!urls.every((u) => have.has(u))) return { ok: false, reason: 'not_owned' };
  return { ok: true };
}

// ─────────────────────────────────────────────
// 🤖 Deck auto équilibré
//    Priorité : cartes « sans risque » (communes, ou rares+ en double),
//    beaucoup d'exemplaires d'abord ; les rares+ uniques en dernier recours.
// ─────────────────────────────────────────────

function preference(card) {
  const rank = RARITY_RANK[card.rarity] || 0;
  const risky = rank > 0 && card.count < 2;
  return [risky ? 1 : 0, -card.count, rank, card.url];
}

function compare(a, b) {
  const pa = preference(a);
  const pb = preference(b);
  for (let i = 0; i < pa.length; i += 1) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

function buildAutoDeck(collection, exclude = []) {
  const pool = owned(collection).filter((c) => !exclude.includes(c.url)).sort(compare);
  if (pool.length + exclude.length < DECK_SIZE) return null;
  const safe = pool.filter((c) => preference(c)[0] === 0);
  const picked = [];
  const take = (card) => { picked.push(card.url); };

  for (const arch of AUTO_PLAN) {
    const card = safe.find((c) => !picked.includes(c.url) && getCardStats(c).archetype === arch);
    if (card) take(card);
  }
  for (const card of pool) {
    if (picked.length + exclude.length >= DECK_SIZE) break;
    if (!picked.includes(card.url)) take(card);
  }
  return picked.slice(0, DECK_SIZE - exclude.length);
}

// ─────────────────────────────────────────────
// 🧩 Deck sauvegardé → deck jouable
//    Garde les cartes encore possédées, complète avec le deck auto.
//    → { urls, replaced } ou null si la collection est trop petite.
// ─────────────────────────────────────────────

function resolveDeck(saved, collection) {
  if (distinctCount(collection) < DECK_SIZE) return null;
  if (!Array.isArray(saved) || !saved.length) return { urls: buildAutoDeck(collection), replaced: [] };

  const have = new Set(owned(collection).map((c) => c.url));
  const kept = [...new Set(saved)].filter((u) => have.has(u)).slice(0, DECK_SIZE);
  const replaced = saved.filter((u) => !have.has(u));
  const fill = kept.length < DECK_SIZE ? buildAutoDeck(collection, kept) : [];
  return { urls: [...kept, ...fill], replaced };
}

module.exports = {
  DECK_SIZE,
  distinctCount,
  validateDeck,
  buildAutoDeck,
  resolveDeck,
};
