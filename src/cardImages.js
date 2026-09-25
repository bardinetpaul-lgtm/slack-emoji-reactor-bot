// ═══════════════════════════════════════════════════════════
//  🖼️  MODULE IMAGES DES CARTES (proxy + cache pour la page web)
//
//  Les médias sont des liens de partage Slack
//    https://slack-files.com/<TEAM>-<FILEID>-<SECRET>
//  = pages HTML, pas des images. Une page web ne peut pas les
//  afficher directement → le serveur récupère l'image et la sert.
//
//  Résolution d'un <FILEID> :
//    1. cache disque data/card-cache/<FILEID>.<ext>
//    2. API Slack files.info (scope files:read) → url_private + Bearer
//    3. repli : page publique slack-files.com → URL pub_secret
//
//  Liste blanche : seuls les FILEID présents dans la banque de
//  médias (ou parmi les photos anti-spam) sont servis (le proxy ne
//  peut pas lire d'autres fichiers).
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const { getAllMedia } = require('./media');
const { SPAM_CARDS } = require('./spamCards');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'card-cache');
const MAX_BYTES = 15 * 1024 * 1024;

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
const MIME_BY_EXT = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m]));

// ─────────────────────────────────────────────
// 🔎 URL de média → FILEID Slack (ou null)
// ─────────────────────────────────────────────

function slackFileId(url) {
  const match = /^https:\/\/slack-files\.com\/T[A-Z0-9]+-(F[A-Z0-9]+)-([a-z0-9]+)/i.exec(url || '');
  return match ? match[1] : null;
}

function findMediaByFileId(fileId) {
  return [...getAllMedia(), ...SPAM_CARDS].find((m) => slackFileId(m.url) === fileId) || null;
}

// ─────────────────────────────────────────────
// 🌐 Image à afficher pour une carte (URL relative ou publique)
// ─────────────────────────────────────────────

const PUBLIC_IMAGE_HOSTS = ['media.giphy.com', 'i.imgur.com', 'images.unsplash.com', 'cdn.pixabay.com', 'res.cloudinary.com'];

function youtubeId(url) {
  const match = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{6,})/.exec(url || '');
  return match ? match[1] : null;
}

function cardImageUrl(card) {
  const fileId = slackFileId(card.url);
  if (fileId) return `api/card-image/${fileId}`;

  const yt = youtubeId(card.url);
  if (yt) return `https://img.youtube.com/vi/${yt}/hqdefault.jpg`;

  try {
    const host = new URL(card.url).hostname;
    if (card.type === 'image' && PUBLIC_IMAGE_HOSTS.some((h) => host.includes(h))) return card.url;
  } catch {
    // URL invalide → pas d'image
  }
  return null;
}

// ─────────────────────────────────────────────
// 💾 Cache disque
// ─────────────────────────────────────────────

function readCache(fileId) {
  for (const ext of Object.values(EXT_BY_MIME)) {
    const file = path.join(CACHE_DIR, `${fileId}.${ext}`);
    if (fs.existsSync(file)) return { file, mime: MIME_BY_EXT[ext] };
  }
  return null;
}

function writeCache(fileId, mime, buffer) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${fileId}.${EXT_BY_MIME[mime]}`);
  fs.writeFileSync(file, buffer);
  return { file, mime };
}

// ─────────────────────────────────────────────
// ⬇️ Téléchargement d'une image (type + taille vérifiés)
// ─────────────────────────────────────────────

async function download(url, headers = {}) {
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!EXT_BY_MIME[mime]) throw new Error(`type non image : ${mime || 'inconnu'}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw new Error('image trop lourde');
  return { mime, buffer };
}

// 2. API Slack files.info → url_private (auth Bearer du bot)
async function viaFilesInfo(client, fileId) {
  const info = await client.files.info({ file: fileId });
  const url = info.file && (info.file.url_private_download || info.file.url_private);
  if (!url) throw new Error('url_private absente');
  return download(url, { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` });
}

// 3. Repli : page publique slack-files.com → lien direct pub_secret
async function viaPublicPage(shareUrl) {
  const res = await fetch(shareUrl, { redirect: 'follow' });
  if (!res.ok) throw new Error(`page publique HTTP ${res.status}`);
  const html = await res.text();
  const match = /https:\/\/files\.slack\.com\/files-pri\/[^"'\s<>]+?pub_secret=[a-z0-9]+/i.exec(html);
  if (!match) throw new Error('lien pub_secret introuvable');
  return download(match[0].replace(/&amp;/g, '&'));
}

// ─────────────────────────────────────────────
// 🎯 Point d'entrée : { file, mime } ou null
//    Une seule résolution en vol par FILEID (dédoublonnage).
// ─────────────────────────────────────────────

const inFlight = new Map();

async function getCardImage(client, fileId, logger = console) {
  if (!/^F[A-Z0-9]+$/.test(fileId)) return null;
  const media = findMediaByFileId(fileId);
  if (!media) return null; // hors liste blanche

  const cached = readCache(fileId);
  if (cached) return cached;

  if (inFlight.has(fileId)) return inFlight.get(fileId);

  const task = (async () => {
    try {
      const { mime, buffer } = await viaFilesInfo(client, fileId);
      return writeCache(fileId, mime, buffer);
    } catch (apiError) {
      logger.warn(`[cardImages] files.info ${fileId} : ${apiError.message} → repli page publique`);
    }
    try {
      const { mime, buffer } = await viaPublicPage(media.url);
      return writeCache(fileId, mime, buffer);
    } catch (pageError) {
      logger.error(`[cardImages] ${fileId} introuvable : ${pageError.message}`);
      return null;
    }
  })();

  inFlight.set(fileId, task);
  try {
    return await task;
  } finally {
    inFlight.delete(fileId);
  }
}

module.exports = { getCardImage, cardImageUrl, slackFileId, youtubeId };
