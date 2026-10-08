// ═══════════════════════════════════════════════════════════
//  🗂️  MODULE COLLECTIONS
//  Cartes possédées par chaque utilisateur : cartes de boosters ET
//  Jeanpips reçus en DM (réaction, attaque, auto-react).
//  Permanent, jamais de reset.
//
//  Une carte est identifiée par l'URL du média (stable même si
//  le titre « Surprise #N » est renuméroté). Titre et rareté
//  sont gardés en copie pour l'affichage.
//
//  DB = fichier JSON local (data/collections.json)
//    { users: { U123: { cards: { <url>: {
//        title, rarity, type, count, firstAt, lastAt } } } } }
// ═══════════════════════════════════════════════════════════

const path = require('path');
const events = require('./events');
const { readJson, writeJsonAtomic } = require('./storage');

const COLLECTIONS_PATH = path.join(__dirname, '..', 'data', 'collections.json');

// ─────────────────────────────────────────────
// 📦 Chargement / Sauvegarde
// ─────────────────────────────────────────────

function load() {
  try {
    const data = readJson(COLLECTIONS_PATH, { users: {} });
    return data && typeof data.users === 'object' ? data : { users: {} };
  } catch {
    return { users: {} };
  }
}

function save(data) {
  try {
    writeJsonAtomic(COLLECTIONS_PATH, data);
  } catch (e) {
    console.error('[collections] écriture:', e.message);
  }
}

// ─────────────────────────────────────────────
// ➕ Ajouter des cartes à la collection d'un user
//    `at` (ISO) = date d'obtention, maintenant par défaut
//    (utile pour le rattrapage de l'historique).
//    Retourne, pour chaque carte (même ordre), le nombre
//    d'exemplaires possédés APRÈS l'ajout (1 = nouvelle,
//    2 = doublon, 3 = triplon…). 0 si la carte est invalide.
// ─────────────────────────────────────────────

function addCards(userId, cards, at = new Date().toISOString()) {
  const data = load();
  if (!data.users[userId]) data.users[userId] = { cards: {} };
  const owned = data.users[userId].cards;
  const now = at;
  const discovered = [];

  const counts = cards.map((card) => {
    if (!card || !card.url) return 0;
    const entry = owned[card.url];
    if (entry) {
      entry.count += 1;
      if (now < entry.firstAt) entry.firstAt = now;
      if (now > entry.lastAt) entry.lastAt = now;
      entry.title = card.title;
      entry.rarity = card.rarity;
      return entry.count;
    }
    owned[card.url] = {
      title: card.title,
      rarity: card.rarity,
      type: card.type,
      count: 1,
      firstAt: now,
      lastAt: now,
    };
    discovered.push(card);
    return 1;
  });

  save(data);
  // 📒 Stats : 1re obtention d'une carte (jamais re-comptée : clé dedup)
  for (const card of discovered) {
    events.record('card_discovered', userId, { url: card.url, title: card.title, rarity: card.rarity },
      { at: now, dedup: `disc:${userId}:${card.url}` });
  }
  return counts;
}

// ─────────────────────────────────────────────
// 🔁 Phrase à afficher selon le nombre d'exemplaires possédés
// ─────────────────────────────────────────────

const COPY_PHRASES = {
  1: '✨ *Nouvelle carte !* Bienvenue dans ta collection.',
  2: "🔁 *Doublon !* Tu l'as déjà… elle a dû te manquer.",
  3: '🎲 *Triplon !* Jamais deux sans trois.',
  4: "🍀 *Quadruplon !* Elle t'a clairement adopté.",
  5: '🖐️ *Quintuplon !* Une main pleine de la même carte.',
  6: '🎰 *Sextuplon !* Le booster se moque de toi.',
  7: '🌈 *Septuplon !* Sept, comme les merveilles du monde.',
  8: '🐙 *Octuplon !* Un exemplaire par tentacule.',
  9: "🧘 *Nonuplon !* À ce stade, c'est une relation.",
  10: '🔟 *Décuplon !* Dix fois la même. Respect.',
};

function copyPhrase(count) {
  if (count < 1) return '';
  return COPY_PHRASES[count] || `🤯 *×${count} !* Tu es officiellement son plus grand fan.`;
}

// ─────────────────────────────────────────────
// 🗂️  Collection d'un user → [{ url, title, rarity, type, count, ... }]
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// 🔢 Nombre d'exemplaires d'une carte (0 si pas possédée)
// ─────────────────────────────────────────────

function getCount(userId, url) {
  const data = load();
  const user = data.users[userId];
  return (user && user.cards[url] && user.cards[url].count) || 0;
}

function getCollection(userId) {
  const data = load();
  const user = data.users[userId];
  if (!user) return [];
  return Object.entries(user.cards).map(([url, card]) => ({ url, ...card }));
}

// ─────────────────────────────────────────────
// ➖ Retirer des cartes (Arène : cartes perdues au combat)
//    Un exemplaire par URL de la liste (une URL répétée = plusieurs).
//    Jamais sous 0 ; la carte quitte le classeur à 0.
//    Retourne, pour chaque URL (même ordre), le nombre restant.
// ─────────────────────────────────────────────

function removeCards(userId, urls) {
  const data = load();
  const owned = data.users[userId] && data.users[userId].cards;
  if (!owned) return urls.map(() => 0);

  const counts = urls.map((url) => {
    const entry = owned[url];
    if (!entry) return 0;
    entry.count -= 1;
    if (entry.count <= 0) {
      delete owned[url];
      return 0;
    }
    return entry.count;
  });

  save(data);
  return counts;
}

// ─────────────────────────────────────────────
// 🔢 Exemplaires possédés (un joueur, ou tous) — dashboard /stats
// ─────────────────────────────────────────────

function countCopies(userId = null) {
  const data = load();
  const users = userId ? [data.users[userId]].filter(Boolean) : Object.values(data.users);
  return users.reduce((sum, u) => sum + Object.values(u.cards).reduce((s, c) => s + (c.count || 0), 0), 0);
}

module.exports = {
  addCards,
  countCopies,
  removeCards,
  copyPhrase,
  getCount,
  getCollection,
};
