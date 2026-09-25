// ═══════════════════════════════════════════════════════════
//  🗂️  MODULE COLLECTIONS
//  Cartes possédées par chaque utilisateur (gagnées en ouvrant
//  des boosters). Permanent, jamais de reset.
//
//  Une carte est identifiée par l'URL du média (stable même si
//  le titre « Surprise #N » est renuméroté). Titre et rareté
//  sont gardés en copie pour l'affichage.
//
//  DB = fichier JSON local (data/collections.json)
//    { users: { U123: { cards: { <url>: {
//        title, rarity, type, count, firstAt, lastAt } } } } }
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const COLLECTIONS_PATH = path.join(__dirname, '..', 'data', 'collections.json');

// ─────────────────────────────────────────────
// 📦 Chargement / Sauvegarde
// ─────────────────────────────────────────────

function load() {
  try {
    if (!fs.existsSync(COLLECTIONS_PATH)) return { users: {} };
    const data = JSON.parse(fs.readFileSync(COLLECTIONS_PATH, 'utf-8'));
    return data && typeof data.users === 'object' ? data : { users: {} };
  } catch {
    return { users: {} };
  }
}

function save(data) {
  try {
    fs.writeFileSync(COLLECTIONS_PATH, JSON.stringify(data, null, 2), 'utf-8');
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
    return 1;
  });

  save(data);
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

function getCollection(userId) {
  const data = load();
  const user = data.users[userId];
  if (!user) return [];
  return Object.entries(user.cards).map(([url, card]) => ({ url, ...card }));
}

module.exports = {
  addCards,
  copyPhrase,
  getCollection,
};
