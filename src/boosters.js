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
//    • Exception : les boosters saisonniers 🎀 Octobre Rose (stock
//      quotidien partagé) et 🎃 Halloween (sans limite) ont leur propre
//      répartition et une pseudo-rareté 'rose' / 'halloween' = une carte
//      hors série (src/octobreRose.js, src/halloween.js).
//
//  Le catalogue est extensible : ajouter une entrée dans BOOSTERS
//  (avec price + slots) suffit à créer un nouveau type de booster.
//
//  DB des boosters en attente = data/boosters.json
//    { boosters: { <id>: { owner, type, opened, createdAt, granted?,
//        openedAt?, openedVia? ('slack'|'web'), cards?, counts?,
//        message?: { channel, ts } } } }
// ═══════════════════════════════════════════════════════════

const path = require('path');
const { readJson, writeJsonAtomic } = require('./storage');

const { drawCardOfRarity } = require('./media');
const octobreRose = require('./octobreRose');
const halloween = require('./halloween');
const boosterBans = require('./boosterBans');
const weekend = require('./weekend');

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
    season: octobreRose,
    // 📅 v3.0.4 (décision de Paul le 8/10) : plus rien le week-end dès aujourd'hui ;
    //    à partir du lundi 12/10, 3 par jour à 80 JP$. Jour de Paris, bornes incluses.
    schedule: [
      { from: '2026-10-08', weekdaysOnly: true },
      { from: '2026-10-12', weekdaysOnly: true, price: 80, dailyStock: 3 },
      // 🎉 v3.7 : dernier jour de vente (le 31/10 tombe un samedi) → 10 boosters
      //    pour tout le monde, 2 par personne. Le prix ne bouge pas.
      { from: '2026-10-30', weekdaysOnly: true, price: 80, dailyStock: 10, dailyPerUser: 2 },
    ],
    slots: [
      ...commonSlots(3),
      { rare: 40, common: 30, epic: 30 },
      { rare: 40, common: 30, epic: 30 },
      { legendary: 30, rare: 35, epic: 35 },
      { rose: 30, rare: 35, epic: 35 },
      { rose: 100 },
    ],
  },
  // 🎃 Halloween (v3.7) : du vendredi 30/10 14h au lundi 2/11 14h, sans
  //    limite par personne ni stock partagé. Mêmes probabilités qu'Octobre
  //    Rose. La moitié des cartes n'arrive que le lundi (src/halloween.js).
  halloween: {
    type: 'halloween',
    label: 'Halloween',
    emoji: '🎃',
    price: 80,
    seasonal: true,
    season: halloween,
    slots: [
      ...commonSlots(3),
      { rare: 40, common: 30, epic: 30 },
      { rare: 40, common: 30, epic: 30 },
      { legendary: 30, rare: 35, epic: 35 },
      { halloween: 30, rare: 35, epic: 35 },
      { halloween: 100 },
    ],
  },
};

// Ordre d'affichage des boutons d'achat.
const BOOSTER_ORDER = ['common', 'rare', 'epic', 'octobre_rose', 'halloween'];

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

/**
 * 📅 Règles du jour d'un booster : sa définition + la dernière étape de son
 * `schedule` déjà commencée (prix, stock du jour, fermeture le week-end).
 */
function effective(booster, now = Date.now()) {
  if (!booster || !booster.schedule) return booster;
  const day = octobreRose.parisDay(now);
  const step = booster.schedule.filter((s) => day >= s.from).pop();
  if (!step) return booster;
  const { from, ...rules } = step;
  return { ...booster, ...rules };
}

/** Samedi ou dimanche, à l'heure de Paris (src/weekend.js). */
const { isWeekend } = weekend;

function getBooster(type, now = Date.now()) {
  return BOOSTERS[type] ? effective(BOOSTERS[type], now) : null;
}

/** Boosters en vente maintenant (le saisonnier n'apparaît qu'en saison). */
function listBoosters(now = Date.now()) {
  return BOOSTER_ORDER.map((type) => getBooster(type, now)).filter((b) => b && isOnSale(b, now));
}

/** Règles du jour d'un booster déjà en main (un objet gardé d'un autre jour est remis à jour). */
const rulesOf = (booster, now) => (booster && BOOSTERS[booster.type] ? effective(BOOSTERS[booster.type], now) : booster);

/** En vente : toujours, sauf un saisonnier (sa période + ses cartes hors série renseignées). */
function isOnSale(booster, now = Date.now()) {
  if (!booster.seasonal) return true;
  const season = booster.season || (BOOSTERS[booster.type] && BOOSTERS[booster.type].season);
  return !!season && season.inSeason(now) && season.isReady();
}

/** Acheté aujourd'hui (Paris) : les boosters offerts (`granted`, v3.2) ne prennent pas de place. */
const boughtOn = (b, type, today) => b.type === type && !b.granted && b.createdAt && octobreRose.parisDay(b.createdAt) === today;

/**
 * Boosters encore disponibles aujourd'hui (stock partagé par tous),
 * ou null si le booster n'a pas de stock quotidien.
 */
function stockLeft(booster, now = Date.now()) {
  booster = rulesOf(booster, now);
  if (!booster.dailyStock) return null;
  const today = octobreRose.parisDay(now);
  const sold = Object.values(loadStore().boosters).filter((b) => boughtOn(b, booster.type, today)).length;
  return Math.max(0, booster.dailyStock - sold);
}

/** Boosters de ce type déjà achetés aujourd'hui (jour de Paris) par ce joueur. */
function boughtToday(booster, userId, now = Date.now()) {
  const today = octobreRose.parisDay(now);
  return Object.values(loadStore().boosters).filter((b) => b.owner === userId && boughtOn(b, booster.type, today)).length;
}

/**
 * Raison pour laquelle on ne peut pas acheter ce booster maintenant
 * ('closed' | 'banned' | 'weekend' | 'not_yet' | 'user_limit' | 'sold_out'), ou null. À appeler JUSTE avant
 * spend() + createPending(), sans await entre les deux (Node mono-thread).
 * userId : applique aussi la sanction admin (src/boosterBans.js) et la limite par personne (dailyPerUser).
 */
function purchaseBlock(booster, now = Date.now(), userId = null) {
  booster = rulesOf(booster, now);
  if (!isOnSale(booster, now)) return 'closed';
  if (userId && boosterBans.activeBan(userId, booster.type, now)) return 'banned';
  if (weekend.pauseFor(userId, now)) return 'weekend';   // 🏖️ v3.3 : aucun booster le week-end (ni pendant une fermeture ou ses congés : v3.6)
  if (booster.dailyStock && !octobreRose.hasDropped(now)) return 'not_yet';
  if (userId && booster.dailyPerUser && boughtToday(booster, userId, now) >= booster.dailyPerUser) return 'user_limit';
  if (stockLeft(booster, now) === 0) return 'sold_out';
  return null;
}

/** Phrases affichées avant l'arrivée du stock / quand il est épuisé. */
const DROP_TEXT = `Les boosters du jour arrivent ${octobreRose.DROP_WINDOW.text} (heure de Paris).`;
const RESTOCK_TEXT = `Ils reviennent demain ${octobreRose.DROP_WINDOW.text} (heure de Paris).`;

const DAY_MS = 24 * 3600 * 1000;

/** Prochain jour de vente (ms) : demain, ou le lundi suivant si le booster ferme le week-end. */
function nextSaleTs(booster, now = Date.now()) {
  let ts = now + DAY_MS;
  if (booster && booster.weekdaysOnly) while (isWeekend(ts)) ts += DAY_MS;
  return ts;
}

/**
 * Quand ce booster revient : « demain », « lundi », ou null si sa saison est
 * finie d'ici là (v3.7 : le dernier jour, on ne promet pas un retour).
 */
function comeBackDay(booster, now = Date.now()) {
  const b = rulesOf(booster || BOOSTERS.octobre_rose, now);
  if (b && b.seasonal && !isOnSale(b, nextSaleTs(b, now))) return null;
  return b && b.weekdaysOnly && isWeekend(now + DAY_MS) ? 'lundi' : 'demain';
}

/** « demain » / « lundi » (saison finie : « demain », pour les textes qui l'exigent). */
const nextSaleDay = (booster, now = Date.now()) => comeBackDay(booster, now) || 'demain';

/** « Ils reviennent demain (ou lundi) entre 9h et 10h (heure de Paris). » */
function restockText(now = Date.now(), booster = null) {
  const back = comeBackDay(booster, now);
  if (!back) return "C'était le dernier jour de la saison : il n'y en aura plus.";
  return `Ils reviennent ${back} ${octobreRose.DROP_WINDOW.text} (heure de Paris).`;
}

/** Texte du bouton d'achat : « 🎀 Octobre Rose (65) · 1/2 aujourd'hui ». */
function buttonLabel(booster, now = Date.now()) {
  booster = rulesOf(booster, now);
  if (booster.weekdaysOnly && isWeekend(now)) return `${booster.emoji} ${booster.label} (${booster.price}) · retour lundi`;
  const left = stockLeft(booster, now);
  let stock = '';
  if (left === 0) stock = comeBackDay(booster, now) ? ` · épuisé, retour ${nextSaleDay(booster, now)}` : ' · épuisé, c\'est fini';
  else if (left !== null && !octobreRose.hasDropped(now)) stock = ` · arrive ${octobreRose.DROP_WINDOW.text}`;
  else if (left !== null) stock = ` · ${left}/${booster.dailyStock} aujourd'hui`;
  return `${booster.emoji} ${booster.label} (${booster.price})${stock}`;
}

// ─────────────────────────────────────────────
// 🎉 Ouvrir un booster → 8 cartes (tirées à l'ouverture)
//    Chaque carte est un média avec sa rareté réelle ET SON TITRE D'ORIGINE
//    (ex. « 🎉 Surprise #1 ») : c'est ce numéro qui permet d'identifier la photo.
// ─────────────────────────────────────────────

// Raretés hors série tirées dans un booster saisonnier → comment tirer la carte.
const SEASONAL_DRAW = {
  rose:      (drawn, exclude) => octobreRose.drawRoseCard(drawn, exclude),
  halloween: (drawn, exclude, now) => halloween.drawHalloweenCard(drawn, exclude, now),
};

function openBooster(type, now = Date.now()) {
  const booster = getBooster(type, now);
  if (!booster) return [];

  const drawnByRarity = {};      // rareté → Map(url → nb de sorties), calculée au 1er besoin
  const inThisBooster = new Set();

  return booster.slots.map((distribution) => {
    const rarity = rollRarity(distribution);
    const draw = SEASONAL_DRAW[rarity];
    if (!draw) return drawCardOfRarity(rarity);

    // 🎀🎃 Carte hors série : la moins sortie jusqu'ici, pas 2 fois la même par booster
    if (!drawnByRarity[rarity]) drawnByRarity[rarity] = countDrawn(rarity);
    const card = draw(drawnByRarity[rarity], inThisBooster, now)
      || drawCardOfRarity('epic'); // repli (cartes non renseignées, vague pas encore sortie)
    inThisBooster.add(card.url);
    return card;
  });
}

/** Combien de fois chaque carte de cette rareté hors série est déjà sortie d'un booster. */
function countDrawn(rarity) {
  const drawn = new Map();
  for (const b of Object.values(loadStore().boosters)) {
    for (const c of b.cards || []) {
      if (c && c.rarity === rarity) drawn.set(c.url, (drawn.get(c.url) || 0) + 1);
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
    const data = readJson(BOOSTERS_PATH, { boosters: {} });
    return data && typeof data.boosters === 'object' ? data : { boosters: {} };
  } catch {
    return { boosters: {} };
  }
}

function saveStore(data) {
  try {
    writeJsonAtomic(BOOSTERS_PATH, data);
  } catch (e) {
    console.error('[boosters] écriture:', e.message);
  }
}

function generateId() {
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Enregistre un booster acheté (pas encore ouvert).
 * `granted` : offert par un admin (v3.2) → hors stock du jour et hors limite par personne.
 * Retourne l'id du booster (à mettre dans le bouton « Ouvrir »).
 */
function createPending(userId, type, { granted = false } = {}) {
  const data = loadStore();
  const id = generateId();
  data.boosters[id] = {
    owner: userId,
    type,
    opened: false,
    createdAt: new Date().toISOString(),
    ...(granted ? { granted: true } : {}),
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
  comeBackDay,
  boughtToday,
  isWeekend,
  restockText,
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
