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
//    • Exception : le booster 🎀 Octobre Rose (saisonnier, stock
//      quotidien partagé) a sa propre répartition et la pseudo-rareté
//      'rose' = une carte Octobre Rose (src/octobreRose.js).
//
//  Le catalogue est extensible : ajouter une entrée dans BOOSTERS
//  (avec price + slots) suffit à créer un nouveau type de booster.
//
//  DB des boosters en attente = data/boosters.json
//    { boosters: { <id>: { owner, type, opened, createdAt,
//        openedAt?, openedVia? ('slack'|'web'), cards?, counts?,
//        message?: { channel, ts } } } }
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const { drawCardOfRarity } = require('./media');
const octobreRose = require('./octobreRose');

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
//    Prix : common 20 · rare 45 · epic 60
//    Chaque `slots` = 8 distributions (une par carte).
//    Les tables des 3 derniers slots totalisent 100% chacune.
// ─────────────────────────────────────────────

const BOOSTERS = {
  common: {
    type: 'common',
    label: 'Commun',
    emoji: '⚪',
    price: 20,
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
    price: 45,
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
    price: 60,
    slots: [
      ...commonSlots(5),
      { common: 40, rare: 30, epic: 28, legendary: 2 },
      { common: 20, rare: 50, epic: 28, legendary: 2 },
      { rare: 20, epic: 50, legendary: 30 },
    ],
  },
  // 🎀 Octobre Rose : du 1er au 31 octobre, 2 boosters par jour pour TOUT
  //    le monde, qui arrivent chaque jour à une minute aléatoire entre
//    9h et 10h (heure de Paris).
  //    Cartes 1-3 communes · 4-5 rare/commun/épique · 6 légendaire 30 %
  //    · 7 Octobre Rose 30 % (2e carte rose) · 8 Octobre Rose garantie.
  octobre_rose: {
    type: 'octobre_rose',
    label: 'Octobre Rose',
    emoji: '🎀',
    price: 65,
    dailyStock: 2,
    dailyPerUser: 1,   // v2.1.2 : personne ne peut prendre les 2 du jour à lui seul
    seasonal: true,
    slots: [
      ...commonSlots(3),
      { rare: 40, common: 30, epic: 30 },
      { rare: 40, common: 30, epic: 30 },
      { legendary: 30, rare: 35, epic: 35 },
      { rose: 30, rare: 35, epic: 35 },
      { rose: 100 },
    ],
  },
};

// Ordre d'affichage des boutons d'achat.
const BOOSTER_ORDER = ['common', 'rare', 'epic', 'octobre_rose'];

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

/** Boosters en vente maintenant (le saisonnier n'apparaît qu'en saison). */
function listBoosters(now = Date.now()) {
  return BOOSTER_ORDER.map((type) => BOOSTERS[type]).filter((b) => b && isOnSale(b, now));
}

/** En vente : toujours, sauf le saisonnier (période + cartes Octobre Rose renseignées). */
function isOnSale(booster, now = Date.now()) {
  if (!booster.seasonal) return true;
  return octobreRose.inSeason(now) && octobreRose.isReady();
}

/**
 * Boosters encore disponibles aujourd'hui (stock partagé par tous),
 * ou null si le booster n'a pas de stock quotidien.
 */
function stockLeft(booster, now = Date.now()) {
  if (!booster.dailyStock) return null;
  const today = octobreRose.parisDay(now);
  const sold = Object.values(loadStore().boosters)
    .filter((b) => b.type === booster.type && b.createdAt && octobreRose.parisDay(b.createdAt) === today).length;
  return Math.max(0, booster.dailyStock - sold);
}

/** Boosters de ce type déjà achetés aujourd'hui (jour de Paris) par ce joueur. */
function boughtToday(booster, userId, now = Date.now()) {
  const today = octobreRose.parisDay(now);
  return Object.values(loadStore().boosters)
    .filter((b) => b.type === booster.type && b.owner === userId && b.createdAt && octobreRose.parisDay(b.createdAt) === today).length;
}

/**
 * Raison pour laquelle on ne peut pas acheter ce booster maintenant
 * ('closed' | 'not_yet' | 'user_limit' | 'sold_out'), ou null. À appeler JUSTE avant
 * spend() + createPending(), sans await entre les deux (Node mono-thread).
 * userId : applique aussi la limite par personne (dailyPerUser).
 */
function purchaseBlock(booster, now = Date.now(), userId = null) {
  if (!isOnSale(booster, now)) return 'closed';
  if (booster.dailyStock && !octobreRose.hasDropped(now)) return 'not_yet';
  if (userId && booster.dailyPerUser && boughtToday(booster, userId, now) >= booster.dailyPerUser) return 'user_limit';
  if (stockLeft(booster, now) === 0) return 'sold_out';
  return null;
}

/** Phrases affichées avant l'arrivée du stock / quand il est épuisé. */
const DROP_TEXT = `Les boosters du jour arrivent ${octobreRose.DROP_WINDOW.text} (heure de Paris).`;
const RESTOCK_TEXT = `Ils reviennent demain ${octobreRose.DROP_WINDOW.text} (heure de Paris).`;

/** Texte du bouton d'achat : « 🎀 Octobre Rose (65) · 1/2 aujourd'hui ». */
function buttonLabel(booster, now = Date.now()) {
  const left = stockLeft(booster, now);
  let stock = '';
  if (left === 0) stock = ' · épuisé, retour demain';
  else if (left !== null && !octobreRose.hasDropped(now)) stock = ` · arrive ${octobreRose.DROP_WINDOW.text}`;
  else if (left !== null) stock = ` · ${left}/${booster.dailyStock} aujourd'hui`;
  return `${booster.emoji} ${booster.label} (${booster.price})${stock}`;
}

// ─────────────────────────────────────────────
// 🎉 Ouvrir un booster → 8 cartes (tirées à l'ouverture)
//    Chaque carte est un média avec sa rareté réelle ET SON TITRE D'ORIGINE
//    (ex. « 🎉 Surprise #1 ») : c'est ce numéro qui permet d'identifier la photo.
// ─────────────────────────────────────────────

function openBooster(type) {
  const booster = getBooster(type);
  if (!booster) return [];

  let roseDrawn = null;          // url → nb de sorties (calculé au 1er besoin)
  const inThisBooster = new Set();

  return booster.slots.map((distribution) => {
    const rarity = rollRarity(distribution);
    if (rarity !== 'rose') return drawCardOfRarity(rarity);

    // 🎀 Carte Octobre Rose : la moins sortie jusqu'ici, pas 2 fois la même par booster
    if (!roseDrawn) roseDrawn = countRoseDrawn();
    const card = octobreRose.drawRoseCard(roseDrawn, inThisBooster)
      || drawCardOfRarity('epic'); // repli (cartes non renseignées) : ne devrait pas arriver
    inThisBooster.add(card.url);
    return card;
  });
}

/** Combien de fois chaque carte Octobre Rose est déjà sortie d'un booster. */
function countRoseDrawn() {
  const drawn = new Map();
  for (const b of Object.values(loadStore().boosters)) {
    for (const c of b.cards || []) {
      if (c && c.rarity === 'rose') drawn.set(c.url, (drawn.get(c.url) || 0) + 1);
    }
  }
  return drawn;
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

/**
 * Mémorise les cartes tirées à l'ouverture (rejeu de l'animation web
 * sans nouveau tirage) + par quel canal le booster a été ouvert.
 */
function saveOpening(id, { via, cards, counts }) {
  const data = loadStore();
  const booster = data.boosters[id];
  if (!booster) return;
  booster.openedVia = via;
  booster.cards = cards;
  booster.counts = counts;
  saveStore(data);
}

/**
 * Mémorise le message DM « Booster acheté » (pour le mettre à jour
 * quand le booster est ouvert depuis la page web).
 */
function setMessageRef(id, channel, ts) {
  const data = loadStore();
  const booster = data.boosters[id];
  if (!booster) return;
  booster.message = { channel, ts };
  saveStore(data);
}

/**
 * Nombre de boosters achetés mais pas encore ouverts par un user
 * (affiché dans l'onglet Accueil).
 */
function countPending(userId) {
  const data = loadStore();
  return Object.values(data.boosters).filter((b) => b.owner === userId && !b.opened).length;
}

module.exports = {
  BOOSTERS,
  getBooster,
  listBoosters,
  isOnSale,
  stockLeft,
  purchaseBlock,
  buttonLabel,
  boughtToday,
  RESTOCK_TEXT,
  DROP_TEXT,
  openBooster,
  createPending,
  getPending,
  markOpened,
  saveOpening,
  setMessageRef,
  countPending,
};
