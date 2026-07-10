// ═══════════════════════════════════════════════════════════
//  🎲 MODULE MEDIA
//  Gère la sélection aléatoire d'images/vidéos
//  Système de deck shufflé : chaque média sort une fois
//  avant qu'un nouveau cycle commence → plus de répétitions !
// ═══════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');

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
    { type: 'image', url: 'https://media.giphy.com/media/xT5LMHxhOfscxPfIfm/giphy.gif', title: '🎉 Party Time!' },
    { type: 'image', url: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif', title: '🔥 High Five!' },
    { type: 'image', url: 'https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif', title: '🥳 Celebrate!' },
    { type: 'image', url: 'https://media.giphy.com/media/3oz8xAFtqoOUUrsh7W/giphy.gif', title: '👏 Bravo!' },
    { type: 'image', url: 'https://media.giphy.com/media/26u4cqiYI30juCOGY/giphy.gif', title: '🚀 Let\'s Go!' },
  ];
}

// ─────────────────────────────────────────────
// 🎴 Système de deck shufflé
//
// Principe : on mélange toute la banque en un ordre aléatoire,
// puis on distribue les cartes une par une.
// Quand le deck est vide → on le reshufle et on recommence.
// Résultat : chaque image sort exactement une fois par cycle,
// et on ne revoit jamais la même 2 fois de suite !
// ─────────────────────────────────────────────

let deck = [];
let deckIndex = 0;

/**
 * Algorithme de Fisher-Yates : mélange un tableau en place
 */
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Initialise ou reshufle le deck
 */
function reshuffleDeck() {
  deck = shuffle(localMediaBank);
  deckIndex = 0;
  console.log(`🎴 Deck reshufflé : ${deck.length} médias dans un nouvel ordre aléatoire`);
}

/**
 * Pioche le prochain média dans le deck
 * Reshufle automatiquement quand le deck est épuisé
 */
function drawFromDeck() {
  // Initialiser le deck au premier appel
  if (deck.length === 0) {
    reshuffleDeck();
  }

  // Reshufler si on a tout distribué
  if (deckIndex >= deck.length) {
    reshuffleDeck();
  }

  const media = deck[deckIndex];
  deckIndex++;
  return media;
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
 * Retourne un média aléatoire.
 * Si GIPHY_API_KEY est configuré, tente d'abord Giphy.
 * Sinon, pioche dans le deck shufflé.
 */
async function getRandomMedia() {
  if (GIPHY_API_KEY) {
    const giphyMedia = await getGiphyRandom();
    if (giphyMedia) return giphyMedia;
  }
  return drawFromDeck();
}

module.exports = { getRandomMedia };
