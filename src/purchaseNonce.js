// ═══════════════════════════════════════════════════════════
//  🎫 JETON D'ACHAT À USAGE UNIQUE — Boutique web (v4.0)
//  Le lien de la Boutique est permanent : plus facile à automatiser
//  qu'un clic Slack. La page reçoit donc un jeton à chaque affichage :
//    • lié au joueur, valable 2 minutes, utilisable une seule fois ;
//    • utilisé moins d'1 s après sa remise = « trop rapide » (main humaine
//      improbable) → l'appelant le compte comme un clic en rafale ;
//    • il retient les boosters achetables au moment de sa remise : un
//      booster à stock du jour acheté avec un jeton remis AVANT qu'il soit
//      achetable (stock pas encore arrivé…) est refusé « périmé » (`stale`).
//      Un script qui interroge la page chaque seconde ne peut donc pas
//      acheter dès l'arrivée du stock : il lui faut un jeton remis après,
//      donc au moins 1 s de plus. Pas compté comme spam (rien n'a été vu).
//  En mémoire : un redémarrage du bot invalide les jetons (la page en redemande un).
//  Logique pure : l'horloge `now` est passée par l'appelant.
// ═══════════════════════════════════════════════════════════

const crypto = require('crypto');

const TTL_MS = 120000;
const MIN_DELAY_MS = 1000;
const MAX_PER_USER = 10;   // plusieurs onglets ouverts : les plus anciens jetons sautent

const nonces = new Map();   // userId → Map(value → { issuedAt, purchasable: Set<type> })

function purge(list, now) {
  for (const [value, n] of list) if (now - n.issuedAt > TTL_MS) list.delete(value);
}

/**
 * Nouveau jeton pour ce joueur → { value, issuedAt }.
 * @param {object} [opts]
 * @param {string[]} [opts.purchasable] - types de booster achetables à cet instant
 */
function issue(userId, now = Date.now(), { purchasable = [] } = {}) {
  let list = nonces.get(userId);
  if (!list) { list = new Map(); nonces.set(userId, list); }
  purge(list, now);
  while (list.size >= MAX_PER_USER) list.delete(list.keys().next().value);
  const value = crypto.randomBytes(16).toString('hex');
  list.set(value, { issuedAt: now, purchasable: new Set(purchasable) });
  return { value, issuedAt: now };
}

/**
 * Utilise le jeton (une seule fois, même refusé).
 * @param {object} [opts]
 * @param {string} [opts.requirePurchasable] - type qui devait être achetable à la remise
 *   du jeton (booster à stock du jour), sinon 'stale'
 * → 'ok' | 'invalid' (absent, inconnu, déjà utilisé ou d'un autre joueur) | 'expired'
 *   | 'stale' | 'too_fast'
 */
function consume(userId, value, now = Date.now(), { requirePurchasable = null } = {}) {
  const list = nonces.get(userId);
  if (typeof value !== 'string' || !list || !list.has(value)) return 'invalid';
  const { issuedAt, purchasable } = list.get(value);
  list.delete(value);
  if (now - issuedAt > TTL_MS) return 'expired';
  if (requirePurchasable && !purchasable.has(requirePurchasable)) return 'stale';
  if (now - issuedAt < MIN_DELAY_MS) return 'too_fast';
  return 'ok';
}

module.exports = { TTL_MS, MIN_DELAY_MS, issue, consume };
