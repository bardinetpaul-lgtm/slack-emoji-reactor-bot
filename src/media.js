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
 * Retourne les infos d'affichage d'une rareté (emoji + label)
 */
function getRarityInfo(rarity) {
  return RARITIES[rarity] || RARITIES[DEFAULT_RARITY];
}

module.exports = { getRandomMedia, getRarityInfo, RARITIES };
