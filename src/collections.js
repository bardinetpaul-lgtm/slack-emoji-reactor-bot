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
//    Retourne, pour chaque carte (même ordre), true si c'est
//    la PREMIÈRE fois que le user l'obtient.
// ─────────────────────────────────────────────

function addCards(userId, cards) {
  const data = load();
  if (!data.users[userId]) data.users[userId] = { cards: {} };
  const owned = data.users[userId].cards;
  const now = new Date().toISOString();

  const isNew = cards.map((card) => {
    if (!card || !card.url) return false;
    const entry = owned[card.url];
    if (entry) {
      entry.count += 1;
      entry.lastAt = now;
      entry.title = card.title;
      entry.rarity = card.rarity;
      return false;
    }
    owned[card.url] = {
      title: card.title,
      rarity: card.rarity,
      type: card.type,
      count: 1,
      firstAt: now,
      lastAt: now,
    };
    return true;
  });

  save(data);
  return isNew;
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
  getCollection,
};
