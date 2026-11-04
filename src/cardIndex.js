// ═══════════════════════════════════════════════════════════
//  🔖 MODULE CARDINDEX — le code court de chaque carte (v3.9)
//
//  Les échanges désignent une carte par son code, celui du classeur :
//    • #N   : banque (numéro du titre, sinon premier numéro libre)
//             et photos anti-spam ;
//    • ORn  : 🎀 Octobre Rose ;
//    • HWn  : 🎃 Halloween.
//
//  Même ordre et même numérotation que album.buildAlbum :
//  banque par numéro, puis OR…, HW…, anti-spam.
//
//  Fonctions pures (lecture seule) : aucun appel Slack ici.
// ═══════════════════════════════════════════════════════════

const { getAllMedia, RARITIES } = require('./media');
const { numberBank, numberFromTitle } = require('./album');
const { SPAM_CARDS } = require('./spamCards');
const { ROSE_CARDS } = require('./octobreRose');
const { HALLOWEEN_CARDS } = require('./halloween');

/**
 * Toutes les cartes connues (hors cartes retirées de la banque).
 * @returns {Array<{ code, url, title, rarity, type }>}
 */
function listCards() {
  const bank = getAllMedia().filter((m) => m && m.url);
  const numbers = numberBank(bank);
  const seen = new Set();
  const list = [];
  const add = (code, c, rarity) => {
    if (seen.has(c.url)) return;
    seen.add(c.url);
    list.push({ code, url: c.url, title: c.title || code, rarity, type: c.type || 'image' });
  };

  const rarityOf = (m) => (RARITIES[m.rarity] ? m.rarity : 'common');
  const ordered = bank.map((m, i) => ({ m, n: numbers[i] })).sort((a, b) => a.n - b.n);
  ordered.forEach(({ m, n }) => add(`#${n}`, m, rarityOf(m)));
  ROSE_CARDS.filter((c) => c.url).forEach((c) => add(`OR${c.number}`, c, 'rose'));
  HALLOWEEN_CARDS.filter((c) => c.url).forEach((c) => add(`HW${c.number}`, c, 'halloween'));
  SPAM_CARDS.forEach((c) => add(`#${c.number}`, c, 'extra'));
  return list;
}

/**
 * Code d'une carte. Carte retirée de la banque : « #N » tiré du titre,
 * sinon le titre lui-même.
 */
function codeOf(url, title) {
  const known = listCards().find((c) => c.url === url);
  if (known) return known.code;
  const n = numberFromTitle(title);
  return n ? `#${n}` : (title || '');
}

/** Carte désignée par un code (insensible à la casse ; « 42 » = « #42 »). */
function byCode(code) {
  let wanted = String(code || '').trim().toUpperCase();
  if (!wanted) return null;
  if (/^\d+$/.test(wanted)) wanted = `#${wanted}`;
  return listCards().find((c) => c.code.toUpperCase() === wanted) || null;
}

module.exports = { listCards, codeOf, byCode };
