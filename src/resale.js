// ═══════════════════════════════════════════════════════════
//  ♻️ MODULE REVENTE DE DOUBLONS (v3.6)
//  Un joueur revend ses cartes en double contre des JP$, depuis
//  l'onglet Accueil. Prix fixes par rareté (calés sur l'audit de
//  l'économie du 2026-10-21) ; les cartes troll de l'anti-spam ne se
//  revendent pas.
//
//  Garde-fous :
//    • jamais le dernier exemplaire d'une carte, ni les exemplaires
//      placés dans un de ses 3 decks d'Arène (Capitaine compris) ;
//    • plafond de JP$ de revente par personne et par semaine (lundi 0h,
//      heure de Paris), réglable par un admin (src/settings.js) : c'est
//      LE bouton qui règle la croissance de la monnaie (objectif 1-2 %/mois) ;
//    • rien pendant une pause (week-end, fermeture, congés) ni quand on
//      subit un raid (on ne vend pas ses doublons pour les soustraire au pillage).
//  On revend d'abord les cartes dont on a le plus d'exemplaires en trop.
//
//  DB = data/resale.json  { users: { U123: { week: 'AAAA-MM-JJ', earned } } }
//  (le détail de chaque revente est dans le grand livre des crédits, source 'resale')
// ═══════════════════════════════════════════════════════════

const path = require('path');
const { readJson, writeJsonAtomic } = require('./storage');
const { parisDay } = require('./octobreRose');
const collections = require('./collections');
const credits = require('./credits');
const settings = require('./settings');
const arenaStore = require('./game/arenaStore');

const RESALE_PATH = path.join(__dirname, '..', 'data', 'resale.json');

/** JP$ par exemplaire revendu. Une rareté absente (spam) ne se revend pas. */
const PRICES = { common: 0.5, rare: 2, epic: 5, legendary: 20, rose: 10, halloween: 10 };
const RARITY_ORDER = ['common', 'rare', 'epic', 'rose', 'halloween', 'legendary'];
const LABELS = {
  common: '⚪ Communes', rare: '🔵 Rares', epic: '🟣 Épiques', rose: '🎀 Octobre Rose', halloween: '🎃 Halloween', legendary: '🟡 Légendaires',
};

const DAY_MS = 24 * 3600 * 1000;
const noon = (day) => Date.parse(`${day}T12:00:00Z`);

/** Lundi de la semaine en cours (« AAAA-MM-JJ », heure de Paris). */
function weekOf(now = Date.now()) {
  const day = parisDay(now);
  const wd = (new Date(noon(day)).getUTCDay() + 6) % 7;   // lundi = 0
  return new Date(noon(day) - wd * DAY_MS).toISOString().slice(0, 10);
}

function load() {
  const data = readJson(RESALE_PATH, { users: {} });
  return data && data.users && typeof data.users === 'object' ? data : { users: {} };
}
const save = (data) => writeJsonAtomic(RESALE_PATH, data);

/** JP$ déjà touchés par revente cette semaine. */
function earnedThisWeek(userId, now = Date.now(), data = load()) {
  const u = data.users[userId];
  return u && u.week === weekOf(now) ? u.earned : 0;
}

/** Ce qu'il peut encore toucher cette semaine (0 au plafond). */
function remainingThisWeek(userId, now = Date.now()) {
  return Math.max(0, settings.getResaleWeeklyCap() - earnedThisWeek(userId, now));
}

/** Exemplaires de chaque carte bloqués par ses decks (max sur les 3 decks, Capitaine compris). */
function lockedByDecks(userId) {
  const locked = new Map();
  for (const deck of arenaStore.getDecks(userId).decks) {
    const uses = new Map();
    for (const url of [...deck.cards, ...(deck.captain ? [deck.captain] : [])]) uses.set(url, (uses.get(url) || 0) + 1);
    for (const [url, n] of uses) locked.set(url, Math.max(locked.get(url) || 0, n));
  }
  return locked;
}

/**
 * Doublons revendables, par rareté :
 * { common: [{ url, title, spare }], … } triés du plus d'exemplaires en trop au moins.
 */
function sellable(userId) {
  const locked = lockedByDecks(userId);
  const out = Object.fromEntries(RARITY_ORDER.map((r) => [r, []]));
  for (const card of collections.getCollection(userId)) {
    if (!PRICES[card.rarity]) continue;
    const spare = card.count - Math.max(1, locked.get(card.url) || 0);
    if (spare > 0) out[card.rarity].push({ url: card.url, title: card.title, spare });
  }
  for (const r of RARITY_ORDER) out[r].sort((a, b) => b.spare - a.spare);
  return out;
}

/** { common: 1619, rare: 178, … } : nombre d'exemplaires revendables par rareté. */
function sellableCounts(userId) {
  const s = sellable(userId);
  return Object.fromEntries(RARITY_ORDER.map((r) => [r, s[r].reduce((n, c) => n + c.spare, 0)]));
}

/**
 * Revend `wanted` = { common: 10, epic: 1, … } exemplaires.
 * → { ok, gained, sold: { rarity: n }, balance, remaining }
 *   | { ok: false, error: 'empty' | 'too_many' | 'cap', rarity?, available?, remaining? }
 * Tout est synchrone (aucun await) : pas de double revente sur deux clics.
 */
function sell(userId, wanted, now = Date.now()) {
  const qty = Object.fromEntries(RARITY_ORDER.map((r) => [r, Math.max(0, Math.floor(Number(wanted[r]) || 0))]));
  const gained = RARITY_ORDER.reduce((s, r) => s + qty[r] * PRICES[r], 0);
  if (gained <= 0) return { ok: false, error: 'empty' };

  const stock = sellable(userId);
  for (const r of RARITY_ORDER) {
    const available = stock[r].reduce((n, c) => n + c.spare, 0);
    if (qty[r] > available) return { ok: false, error: 'too_many', rarity: r, available };
  }
  const remaining = remainingThisWeek(userId, now);
  if (gained > remaining) return { ok: false, error: 'cap', remaining };

  // Exemplaires à retirer : d'abord les cartes qu'on a le plus en trop
  const urls = [];
  for (const r of RARITY_ORDER) {
    let left = qty[r];
    // tour par tour : un exemplaire de la carte la plus fournie, puis on re-trie
    const pool = stock[r].map((c) => ({ ...c }));
    while (left > 0) {
      pool.sort((a, b) => b.spare - a.spare);
      pool[0].spare -= 1;
      urls.push(pool[0].url);
      left -= 1;
    }
  }
  collections.removeCards(userId, urls);
  const sold = Object.fromEntries(RARITY_ORDER.filter((r) => qty[r]).map((r) => [r, qty[r]]));
  const item = Object.entries(sold).map(([r, n]) => `${n} ${r}`).join(', ');
  const balance = credits.addCredit(userId, gained, { source: 'resale', item });

  const data = load();
  const week = weekOf(now);
  const u = data.users[userId] && data.users[userId].week === week ? data.users[userId] : { week, earned: 0 };
  u.earned += gained;
  data.users[userId] = u;
  save(data);
  return { ok: true, gained, sold, balance, remaining: Math.max(0, settings.getResaleWeeklyCap() - u.earned) };
}

module.exports = {
  PRICES, RARITY_ORDER, LABELS, weekOf, earnedThisWeek, remainingThisWeek, lockedByDecks, sellable, sellableCounts, sell, RESALE_PATH,
};
