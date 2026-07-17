// ═══════════════════════════════════════════════════════════
//  🎁 MODULE BOOSTERS
//  Catalogue data-driven + logique de tirage + persistance des
//  boosters achetés mais pas encore ouverts (survit à un restart).
//
//  Règles :
//    • Un booster = TOUJOURS 8 cartes.
//    • Les 5 premières cartes sont toujours communes.
//    • Les 3 dernières suivent une distribution PAR SLOT (tables ci-dessous).
//    • Chaque table de slot totalise exactement 100%.
//
//  Le catalogue est extensible : ajouter une entrée dans BOOSTERS
//  (avec price + slots) suffit à créer un nouveau type de booster.
//
//  DB des boosters en attente = data/boosters.json
//    { boosters: { <id>: { owner, type, opened, createdAt } } }
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const { drawCardOfRarity } = require('./media');

// ─────────────────────────────────────────────
// 🎨 Helpers de construction du catalogue
// ─────────────────────────────────────────────

// Un slot 100% commun (les 5 premières cartes de chaque booster).
const COMMON_SLOT = { common: 100 };

function commonSlots(n) {
  return Array.from({ length: n }, () => COMMON_SLOT);
}

// ─────────────────────────────────────────────
// 📦 Catalogue des boosters (data-driven, extensible)
//    Prix : common 10 · rare 20 · epic 30
//    Chaque `slots` = 8 distributions (une par carte).
//    Les tables des 3 derniers slots totalisent 100% chacune.
// ─────────────────────────────────────────────

const BOOSTERS = {
  common: {
    type: 'common',
    label: 'Commun',
    emoji: '⚪',
    price: 10,
    slots: [
      ...commonSlots(5),
      { common: 80, rare: 10, epic: 10 },
      { common: 60, rare: 20, epic: 20 },
      { common: 40, rare: 30, epic: 28, legendary: 2 },
    ],
  },
  rare: {
    type: 'rare',
    label: 'Rare',
    emoji: '🔵',
    price: 20,
    slots: [
      ...commonSlots(5),
      { common: 60, rare: 20, epic: 20 },
      { common: 40, rare: 30, epic: 28, legendary: 2 },
      { common: 20, rare: 50, epic: 28, legendary: 2 },
    ],
  },
  epic: {
    type: 'epic',
    label: 'Épique',
    emoji: '🟣',
    price: 30,
    slots: [
      ...commonSlots(5),
      { common: 40, rare: 30, epic: 28, legendary: 2 },
      { common: 20, rare: 50, epic: 28, legendary: 2 },
      { rare: 20, epic: 50, legendary: 30 },
    ],
  },
};

// Ordre d'affichage des boutons d'achat.
const BOOSTER_ORDER = ['common', 'rare', 'epic'];

// ─────────────────────────────────────────────
// 🎯 Tirage d'une rareté selon une table {rarity: poids%}
// ─────────────────────────────────────────────

function rollRarity(distribution) {
  const entries = Object.entries(distribution);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [rarity, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return rarity;
  }
  return entries[0][0]; // fallback (ne devrait pas arriver)
}

// ─────────────────────────────────────────────
// 🃏 Accès au catalogue
// ─────────────────────────────────────────────

function getBooster(type) {
  return BOOSTERS[type] || null;
}

function listBoosters() {
  return BOOSTER_ORDER.map((type) => BOOSTERS[type]).filter(Boolean);
}

// ─────────────────────────────────────────────
// 🎉 Ouvrir un booster → 8 cartes (tirées à l'ouverture)
//    Chaque carte est un média (avec sa rareté réelle) dont le
//    titre est remplacé par « Surprise #NN ».
// ─────────────────────────────────────────────

function openBooster(type) {
  const booster = getBooster(type);
  if (!booster) return [];

  return booster.slots.map((distribution, i) => {
    const rarity = rollRarity(distribution);
    const media = drawCardOfRarity(rarity);
    return {
      ...media,
      title: `Surprise #${String(i + 1).padStart(2, '0')}`,
    };
  });
}

// ═══════════════════════════════════════════════════════════
//  💾 Persistance des boosters achetés (en attente d'ouverture)
// ═══════════════════════════════════════════════════════════

const BOOSTERS_PATH = path.join(__dirname, '..', 'data', 'boosters.json');

function loadStore() {
  try {
    if (!fs.existsSync(BOOSTERS_PATH)) return { boosters: {} };
    const data = JSON.parse(fs.readFileSync(BOOSTERS_PATH, 'utf-8'));
    return data && typeof data.boosters === 'object' ? data : { boosters: {} };
  } catch {
    return { boosters: {} };
  }
}

function saveStore(data) {
  try {
    fs.writeFileSync(BOOSTERS_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('[boosters] écriture:', e.message);
  }
}

function generateId() {
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Enregistre un booster acheté (pas encore ouvert).
 * Retourne l'id du booster (à mettre dans le bouton « Ouvrir »).
 */
function createPending(userId, type) {
  const data = loadStore();
  const id = generateId();
  data.boosters[id] = {
    owner: userId,
    type,
    opened: false,
    createdAt: new Date().toISOString(),
  };
  saveStore(data);
  return id;
}

/**
 * Récupère un booster en attente par son id (ou null).
 */
function getPending(id) {
  const data = loadStore();
  return data.boosters[id] || null;
}

/**
 * Marque un booster comme ouvert.
 * Retourne true si l'opération a réellement changé l'état
 * (i.e. il existait et n'était pas déjà ouvert) → garde anti-double-clic.
 */
function markOpened(id) {
  const data = loadStore();
  const booster = data.boosters[id];
  if (!booster || booster.opened) return false;
  booster.opened = true;
  booster.openedAt = new Date().toISOString();
  saveStore(data);
  return true;
}

module.exports = {
  BOOSTERS,
  getBooster,
  listBoosters,
  openBooster,
  createPending,
  getPending,
  markOpened,
};
