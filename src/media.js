// ═══════════════════════════════════════════════════════════
//  🎲 MODULE MEDIA
//  Gère la sélection aléatoire d'images/vidéos
//  Supporte : banque locale JSON + Giphy API (optionnel)
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
  // Fallback avec quelques GIFs par défaut
  localMediaBank = [
    { type: 'image', url: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExcDd2OHR0Y2RrMnV3NWx0N2xwMGRqbm1uNnJkY2lhYWdmMHhxbCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/xT5LMHxhOfscxPfIfm/giphy.gif', title: '🎉 Party Time!' },
    { type: 'image', url: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExaWdsMHF0eGd5NnI1MXdxcnFpN3N6YTBuemRqY2Q2bml1MnFkMmxkNSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/l0MYt5jPR6QX5pnqM/giphy.gif', title: '🔥 High Five!' },
    { type: 'image', url: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNm5qbHR3cWdxdW9lbTN1cjRsYWZ2MHBhcHRmZW0ycjRubjNlOSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/artj92V8o75VPL7AeQ/giphy.gif', title: '🥳 Celebrate!' },
    { type: 'image', url: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExY2FiOWgyMjQ1dTAzOTVydzQ4OGxuc3RxZGE3NTQxcXd6cXBqMmRyZiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/3oz8xAFtqoOUUrsh7W/giphy.gif', title: '👏 Bravo!' },
    { type: 'image', url: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExbGRzNnZnYmRld2l5NWtidjYxOWptMmJoOTZoZWlwNnhpeXl5a244ZyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/26u4cqiYI30juCOGY/giphy.gif', title: '🚀 Let\'s Go!' },
  ];
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
// 🎲 Sélection aléatoire
// ─────────────────────────────────────────────
function getRandomFromBank() {
  const index = Math.floor(Math.random() * localMediaBank.length);
  return localMediaBank[index];
}

/**
 * Retourne un média aléatoire.
 * Si GIPHY_API_KEY est configuré, tente d'abord Giphy.
 * Sinon, pioche dans la banque locale.
 */
async function getRandomMedia() {
  // Si Giphy est configuré, on l'utilise en priorité
  if (GIPHY_API_KEY) {
    const giphyMedia = await getGiphyRandom();
    if (giphyMedia) return giphyMedia;
  }

  // Fallback : banque locale
  return getRandomFromBank();
}

module.exports = { getRandomMedia };
