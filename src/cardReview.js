// ═══════════════════════════════════════════════════════════
//  👀 MODULE VALIDATION DES NOUVELLES CARTES (v4.4.2)
//  Une carte ajoutée par un admin n'entre plus tout de suite dans le jeu :
//  le valideur (CARD_REVIEWER dans le .env, Jean Lamiré) reçoit un DM avec la
//  carte, son titre, son auteur et la rareté conseillée par l'admin.
//    • ✅ Valider        → publiée à la rareté choisie ;
//    • ✖️ Invalider      → jamais publiée (pas au catalogue) ;
//    • 🎚️ Changer la rareté → retenue, il valide ensuite (ou le délai la publie) ;
//    • sans réponse en 12 h → publiée telle quelle ;
//    • après publication, « Retirer du jeu » la retire du catalogue (elle ne
//      sort plus au tirage ; ceux qui l'ont la gardent en « Hors série »).
//  C'est le valideur qui décide : les admins sont prévenus, pas consultés.
//  Sans CARD_REVIEWER, rien ne change : la carte est publiée tout de suite.
//
//  DB = data/card-reviews.json
//    { nextId, reviews: [{ id, url, rarity (conseillée), chosen (choix du
//      valideur ou null), title, authorId, adminId, arch, createdAt, deadline,
//      status: 'pending'|'published'|'refused'|'removed', how: 'validated'|
//      'timeout'|null, decidedAt, number, mediaTitle, dm: { channel, ts } }] }
//  Pur : aucun appel Slack ici (voir cardReviewSlack.js).
// ═══════════════════════════════════════════════════════════

const path = require('path');
const { readJson, writeJsonAtomic } = require('./storage');

const REVIEWS_PATH = path.join(__dirname, '..', 'data', 'card-reviews.json');
const DELAY_MS = 12 * 3600 * 1000;   // 12 h pour répondre

/** ID Slack du valideur, ou null (validation désactivée). Lu à chaque appel (tests, .env). */
const reviewer = () => (process.env.CARD_REVIEWER || '').trim() || null;

function load() {
  try {
    const data = readJson(REVIEWS_PATH, {}) || {};
    return { nextId: Number(data.nextId) || 1, reviews: Array.isArray(data.reviews) ? data.reviews : [] };
  } catch {
    return { nextId: 1, reviews: [] };
  }
}

function save(data) {
  writeJsonAtomic(REVIEWS_PATH, data);
}

/** Rareté retenue : celle du valideur s'il en a choisi une, sinon la conseillée. */
const finalRarity = (r) => r.chosen || r.rarity;

/** Nouvelle carte à valider → la demande créée. */
function create({ url, rarity, title, authorId, adminId, arch }, now = Date.now()) {
  const data = load();
  const review = {
    id: data.nextId,
    url: String(url).trim(),
    rarity,
    chosen: null,
    title: title || '',
    authorId: authorId || null,
    adminId,
    arch: arch || null,
    createdAt: now,
    deadline: now + DELAY_MS,
    status: 'pending',
    how: null,
    decidedAt: null,
    number: null,
    mediaTitle: null,
    dm: null,
  };
  data.nextId += 1;
  data.reviews.push(review);
  save(data);
  return review;
}

function get(id) {
  return load().reviews.find((r) => r.id === Number(id)) || null;
}

/** Modifie une demande (fonction `fn(review)` ; retourne false pour ne rien écrire) → la demande à jour. */
function update(id, fn) {
  const data = load();
  const review = data.reviews.find((r) => r.id === Number(id));
  if (!review) return null;
  if (fn(review) === false) return review;
  save(data);
  return review;
}

/** Une carte en attente porte-t-elle déjà ce lien ? (pas deux fois la même) */
const pendingUrl = (url) => load().reviews.some((r) => r.status === 'pending' && r.url === String(url).trim());

/** Demandes en attente dont le délai est passé. */
const due = (now = Date.now()) => load().reviews.filter((r) => r.status === 'pending' && r.deadline <= now);

/** Demandes d'un statut (toutes sans statut). */
const list = (status) => load().reviews.filter((r) => !status || r.status === status);

module.exports = { DELAY_MS, REVIEWS_PATH, reviewer, finalRarity, create, get, update, pendingUrl, due, list };
