// ═══════════════════════════════════════════════════════════
//  🎲 MODULE MEDIA
//  Gère la sélection aléatoire d'images/vidéos avec RARETÉ
//
//  4 tiers de rareté avec probabilités :
//    ⚪ common     85%
//    🔵 rare       11%
//    🟣 epic       3.5%
//    🟡 legendary  0.5%
//
//  Chaque tier a son propre deck shufflé (Fisher-Yates)
//  pour éviter les répétitions au sein d'une même rareté.
// ═══════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');

// ─────────────────────────────────────────────
// 🎨 Définition des raretés
//    weight = poids relatif (les % sont calculés dessus)
//    85 + 11 + 3.5 + 0.5 = 100
// ─────────────────────────────────────────────
const RARITIES = {
  common:    { weight: 85,  emoji: '⚪', label: 'Commun' },
  rare:      { weight: 11,  emoji: '🔵', label: 'Rare' },
  epic:      { weight: 3.5, emoji: '🟣', label: 'Épique' },
  legendary: { weight: 0.5, emoji: '🟡', label: 'Légendaire' },
};

const DEFAULT_RARITY = 'common';

// ─────────────────────────────────────────────
// 📦 Chargement de la banque locale
// ─────────────────────────────────────────────
const MEDIA_BANK_PATH = path.join(__dirname, '..', 'data', 'media-bank.json');
let localMediaBank = [];

try {
  const raw = fs.readFileSync(MEDIA_BANK_PATH, 'utf-8');
  localMediaBank = JSON.parse(raw);
  console.log(`📦 Banque locale chargée : ${localMediaBank.length} médias`);
} catch (err) {
  console.warn('⚠️  Banque locale introuvable ou invalide, utilisation du fallback intégré');
  localMediaBank = [
    { type: 'image', url: 'https://media.giphy.com/media/xT5LMHxhOfscxPfIfm/giphy.gif', title: '🎉 Party Time!', rarity: 'common' },
    { type: 'image', url: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif', title: '🔥 High Five!', rarity: 'common' },
    { type: 'image', url: 'https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif', title: '🥳 Celebrate!', rarity: 'rare' },
    { type: 'image', url: 'https://media.giphy.com/media/3oz8xAFtqoOUUrsh7W/giphy.gif', title: '👏 Bravo!', rarity: 'epic' },
    { type: 'image', url: 'https://media.giphy.com/media/26u4cqiYI30juCOGY/giphy.gif', title: '🚀 Let\'s Go!', rarity: 'legendary' },
  ];
}

// ─────────────────────────────────────────────
// ➕ Banque CUSTOM (médias ajoutés en live via /jeanpip-addmedia)
//    Fichier runtime séparé (gitignored) pour ne pas toucher
//    media-bank.json versionné.
// ─────────────────────────────────────────────
const CUSTOM_BANK_PATH = path.join(__dirname, '..', 'data', 'media-bank-custom.json');
let customMedia = [];

try {
  if (fs.existsSync(CUSTOM_BANK_PATH)) {
    const parsed = JSON.parse(fs.readFileSync(CUSTOM_BANK_PATH, 'utf-8'));
    if (Array.isArray(parsed)) {
      customMedia = parsed;
      localMediaBank = localMediaBank.concat(customMedia);
      console.log(`➕ Banque custom chargée : ${customMedia.length} média(s) ajouté(s)`);
    }
  }
} catch (err) {
  console.warn('⚠️  Banque custom illisible, ignorée');
}

// ─────────────────────────────────────────────
// 🗂️  Regroupement des médias par rareté
// ─────────────────────────────────────────────
const mediaByRarity = {};
for (const rarity of Object.keys(RARITIES)) {
  mediaByRarity[rarity] = [];
}

for (const media of localMediaBank) {
  const rarity = RARITIES[media.rarity] ? media.rarity : DEFAULT_RARITY;
  mediaByRarity[rarity].push(media);
}

// Log de répartition
for (const [rarity, list] of Object.entries(mediaByRarity)) {
  console.log(`   ${RARITIES[rarity].emoji} ${RARITIES[rarity].label} : ${list.length} médias`);
}

// ─────────────────────────────────────────────
// 🎴 Un deck shufflé par rareté (Fisher-Yates)
// ─────────────────────────────────────────────
const decks = {};
const deckIndexes = {};

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function drawFromRarityDeck(rarity) {
  const pool = mediaByRarity[rarity];
  if (!pool || pool.length === 0) return null;

  if (!decks[rarity] || deckIndexes[rarity] >= decks[rarity].length) {
    decks[rarity] = shuffle(pool);
    deckIndexes[rarity] = 0;
  }

  const media = decks[rarity][deckIndexes[rarity]];
  deckIndexes[rarity]++;
  return media;
}

// ─────────────────────────────────────────────
// 🎯 Tirage pondéré d'une rareté
// ─────────────────────────────────────────────
function pickRarity() {
  // On ne considère que les raretés qui ont au moins 1 média
  const available = Object.entries(RARITIES).filter(
    ([rarity]) => mediaByRarity[rarity] && mediaByRarity[rarity].length > 0
  );

  const totalWeight = available.reduce((sum, [, cfg]) => sum + cfg.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const [rarity, cfg] of available) {
    roll -= cfg.weight;
    if (roll <= 0) return rarity;
  }

  // Fallback (ne devrait jamais arriver)
  return available[0][0];
}

// ─────────────────────────────────────────────
// 🌐 Giphy API (optionnel)
// ─────────────────────────────────────────────
const GIPHY_API_KEY = process.env.GIPHY_API_KEY || '';
const GIPHY_TAG = process.env.GIPHY_TAG || 'celebration';

async function getGiphyRandom() {
  try {
    const response = await fetch(
      `https://api.giphy.com/v1/gifs/random?api_key=${GIPHY_API_KEY}&tag=${encodeURIComponent(GIPHY_TAG)}&rating=pg`
    );
    const data = await response.json();
    if (data.data && data.data.images) {
      return {
        type: 'image',
        url: data.data.images.original.url,
        title: data.data.title || '🎲 Random GIF',
        rarity: 'common',
      };
    }
  } catch (err) {
    console.warn('⚠️  Giphy API indisponible, fallback sur banque locale');
  }
  return null;
}

// ─────────────────────────────────────────────
// 🎲 Export principal
// ─────────────────────────────────────────────

/**
 * Retourne un média aléatoire pondéré par rareté.
 * Le média retourné contient toujours un champ `rarity`.
 */
async function getRandomMedia() {
  if (GIPHY_API_KEY) {
    const giphyMedia = await getGiphyRandom();
    if (giphyMedia) return giphyMedia;
  }

  // 1. Tirer une rareté selon les probabilités
  const rarity = pickRarity();

  // 2. Piocher un média dans le deck de cette rareté
  const media = drawFromRarityDeck(rarity);

  // Sécurité : si jamais le deck est vide, on prend n'importe quoi
  if (!media) {
    return localMediaBank[Math.floor(Math.random() * localMediaBank.length)];
  }

  return media;
}

/**
 * Tire une carte d'une rareté DONNÉE (pas de pondération globale).
 * Utilisé par les boosters : la rareté est déjà décidée par le slot.
 *
 * Repli : si le deck de la rareté demandée est vide, on descend vers
 * les raretés INFÉRIEURES (epic → rare → common). En dernier recours,
 * n'importe quel média de la banque.
 */
const RARITY_FALLBACK_ORDER = ['legendary', 'epic', 'rare', 'common'];

function drawCardOfRarity(rarity) {
  const startIdx = RARITY_FALLBACK_ORDER.indexOf(rarity);
  const order = startIdx === -1
    ? RARITY_FALLBACK_ORDER
    : RARITY_FALLBACK_ORDER.slice(startIdx);

  for (const r of order) {
    const media = drawFromRarityDeck(r);
    if (media) return media;
  }

  // Repli ultime : n'importe quoi dans la banque
  return localMediaBank[Math.floor(Math.random() * localMediaBank.length)];
}

/**
 * Retourne les infos d'affichage d'une rareté (emoji + label)
 */
function getRarityInfo(rarity) {
  return RARITIES[rarity] || RARITIES[DEFAULT_RARITY];
}

// ─────────────────────────────────────────────
// 🏷️  Normalisation d'une rareté saisie par un admin
//     Accepte le français, l'anglais, quelques abréviations.
//     Retourne la clé interne (common/rare/epic/legendary) ou null.
// ─────────────────────────────────────────────
const RARITY_ALIASES = {
  common: 'common', commun: 'common', c: 'common',
  rare: 'rare', r: 'rare',
  epic: 'epic', epique: 'epic', 'épique': 'epic', e: 'epic',
  legendary: 'legendary', legendaire: 'legendary', 'légendaire': 'legendary',
  legend: 'legendary', leg: 'legendary', l: 'legendary',
};

function normalizeRarity(input) {
  if (!input) return null;
  const key = String(input).toLowerCase().trim().replace(/[:_]/g, '');
  if (RARITY_ALIASES[key]) return RARITY_ALIASES[key];
  return RARITIES[key] ? key : null;
}

// ─────────────────────────────────────────────
// 🎬 Devine le type (image/video) d'après l'URL
// ─────────────────────────────────────────────
function inferType(url) {
  const u = url.toLowerCase();
  if (/(?:youtube\.com|youtu\.be|vimeo\.com)/.test(u) || /\.(?:mp4|mov|webm|m4v)(?:$|\?)/.test(u)) {
    return 'video';
  }
  return 'image';
}

// ─────────────────────────────────────────────
// 🔢 Numérotation automatique « Surprise #N »
//    Le numéro est l'IDENTIFIANT d'une photo : il ne doit JAMAIS être
//    réattribué ni modifié.
//    ⚠️ Les numéros #62 → #71 sont utilisés par les photos anti-spam
//    (SPAM_PHOTO_START dans src/app.js). Elles ne sont pas dans la banque,
//    donc on plancher le calcul à 71 pour ne jamais les réutiliser.
// ─────────────────────────────────────────────
const RESERVED_NUMBER_MAX = 71;

/**
 * Retourne le prochain numéro « Surprise #N » libre.
 * = max(plus grand numéro de la banque, plage réservée anti-spam) + 1
 */
function getNextMediaNumber() {
  let max = RESERVED_NUMBER_MAX;
  for (const media of localMediaBank) {
    const match = (media.title || '').match(/Surprise #(\d+)/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

/**
 * Ajoute un média à la banque (en mémoire + persistance custom).
 * @param {Object} opts
 * @param {string} opts.url    - Lien du média (http/https)
 * @param {string} opts.rarity - Clé de rareté déjà normalisée (common/rare/epic/legendary)
 * @param {string} [opts.title]- Complément de titre optionnel (le numéro est TOUJOURS attribué)
 * @returns {{ ok, media?, number?, count?, error? }}
 */
function addMedia({ url, rarity, title }) {
  if (!url || !/^https?:\/\//i.test(url)) return { ok: false, error: 'url_invalide' };
  if (!RARITIES[rarity]) return { ok: false, error: 'rarete_invalide' };

  const info = RARITIES[rarity];

  // 🔢 Numéro auto : identifiant de la photo, dans le même style que la banque.
  //    Toujours présent, même si un titre libre est fourni.
  const number = getNextMediaNumber();
  const extra = title && title.trim() ? ` — ${title.trim()}` : '';

  const media = {
    type: inferType(url),
    url: url.trim(),
    title: `${info.emoji} Surprise #${number}${extra}`,
    rarity,
  };

  // 1. En mémoire (banque + regroupement par rareté)
  localMediaBank.push(media);
  mediaByRarity[rarity].push(media);
  customMedia.push(media);

  // 2. Invalider le deck de cette rareté → il sera reshufflé (avec le nouveau média) au prochain tirage
  delete decks[rarity];
  delete deckIndexes[rarity];

  // 3. Persistance dans la banque custom (gitignored)
  try {
    fs.writeFileSync(CUSTOM_BANK_PATH, JSON.stringify(customMedia, null, 2), 'utf-8');
  } catch (e) {
    return { ok: false, error: 'ecriture', detail: e.message };
  }

  return { ok: true, media, number, count: mediaByRarity[rarity].length };
}

module.exports = {
  getRandomMedia,
  drawCardOfRarity,
  getRarityInfo,
  normalizeRarity,
  addMedia,
  RARITIES,
};
