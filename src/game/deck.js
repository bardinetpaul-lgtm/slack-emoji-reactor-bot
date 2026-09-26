// ═══════════════════════════════════════════════════════════
//  🃏 MODULE DECKS (Arène)
//  Un deck = 8 EMPLACEMENTS. Une carte peut en occuper autant qu'on
//  en possède d'exemplaires (×3 possédée → jusqu'à 3 emplacements) ;
//  chaque emplacement se joue une fois par cycle. Il faut donc au
//  moins 8 exemplaires au total pour combattre.
//
//  collection = [{ url, title, rarity, count, ... }]  (collections.getCollection)
// ═══════════════════════════════════════════════════════════

const { getCardStats } = require('./cards');
const shop = require('./shop');

const DECK_SIZE = 8;

// Composition visée pour le deck auto (dans l'ordre de priorité)
const AUTO_PLAN = ['guerrier', 'tireur', 'tank', 'essaim', 'sort', 'guerrier', 'tireur', 'pompe'];
const RARITY_RANK = { common: 0, rare: 1, epic: 2, legendary: 3 };

const owned = (collection) => collection.filter((c) => c.count > 0);

function distinctCount(collection) {
  return owned(collection).length;
}

/** Nombre total d'exemplaires possédés (minimum 8 pour combattre). */
function totalCopies(collection) {
  return owned(collection).reduce((sum, c) => sum + c.count, 0);
}

const tally = (urls) => urls.reduce((m, u) => m.set(u, (m.get(u) || 0) + 1), new Map());

function validateDeck(collection, urls) {
  if (!Array.isArray(urls) || urls.length !== DECK_SIZE) return { ok: false, reason: 'size' };
  // 🛒 cartes mystère achetées : 2 max, pas besoin de les posséder
  if (urls.filter(shop.isToken).length > shop.MAX_PER_DECK) return { ok: false, reason: 'shop_limit' };
  const have = new Map(owned(collection).map((c) => [c.url, c.count]));
  for (const [url, n] of tally(urls.filter((u) => !shop.isToken(u)))) {
    if (!have.has(url)) return { ok: false, reason: 'not_owned' };
    if (n > have.get(url)) return { ok: false, reason: 'copies' };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────
// 🤖 Deck auto équilibré
//    D'abord des cartes différentes « sans risque » (communes, ou rares+
//    en double), beaucoup d'exemplaires d'abord ; les rares+ uniques en
//    dernier recours ; puis des doublons si la collection est petite.
//    `exclude` = emplacements déjà pris (multi-ensemble d'URLs).
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
  const used = tally(exclude);
  const left = (c) => c.count - (used.get(c.url) || 0);
  const pool = owned(collection).sort(compare);
  if (pool.reduce((s, c) => s + Math.max(0, left(c)), 0) + exclude.length < DECK_SIZE) return null;

  const picked = [];
  const room = () => DECK_SIZE - exclude.length - picked.length;
  const take = (card) => { picked.push(card.url); used.set(card.url, (used.get(card.url) || 0) + 1); };
  const fresh = (c) => left(c) > 0 && !picked.includes(c.url) && !exclude.includes(c.url);

  for (const arch of AUTO_PLAN) {
    if (room() <= 0) break;
    const card = pool.find((c) => preference(c)[0] === 0 && fresh(c) && getCardStats(c).archetype === arch);
    if (card) take(card);
  }
  for (const card of pool) {
    if (room() <= 0) break;
    if (fresh(card)) take(card);
  }
  // Collection petite : on complète avec des doublons (plus d'exemplaires d'abord)
  while (room() > 0) {
    const card = pool.find((c) => left(c) > 0);
    if (!card) break;
    take(card);
  }
  return picked;
}

// ─────────────────────────────────────────────
// 🧩 Deck sauvegardé → deck jouable
//    Garde les emplacements encore couverts par la collection,
//    complète avec le deck auto.
//    → { urls, replaced } ou null si la collection est trop petite.
// ─────────────────────────────────────────────

function resolveDeck(saved, collection) {
  const tokens = (Array.isArray(saved) ? saved : []).filter(shop.isToken).slice(0, shop.MAX_PER_DECK);
  if (totalCopies(collection) + tokens.length < DECK_SIZE) return null;
  if (!Array.isArray(saved) || !saved.length) return { urls: buildAutoDeck(collection), replaced: [] };

  const have = new Map(owned(collection).map((c) => [c.url, c.count]));
  const kept = [...tokens];   // 🛒 achats gardés tels quels
  const replaced = [];
  for (const url of saved.slice(0, DECK_SIZE)) {
    if (shop.isToken(url)) continue;
    const n = kept.filter((u) => u === url).length;
    if (n < (have.get(url) || 0)) kept.push(url);
    else replaced.push(url);
  }
  const real = kept.filter((u) => !shop.isToken(u));
  const fill = kept.length < DECK_SIZE ? (buildAutoDeck(collection, real) || []).slice(0, DECK_SIZE - kept.length) : [];
  return { urls: [...kept, ...fill], replaced };
}

module.exports = {
  DECK_SIZE,
  distinctCount,
  totalCopies,
  validateDeck,
  buildAutoDeck,
  resolveDeck,
};
