// ═══════════════════════════════════════════════════════════
//  🎬 MODULE WEB — page d'ouverture de booster « à la FIFA »
//
//  Petit serveur HTTP (module natif, aucune dépendance) lancé dans
//  le même process que le bot. Écoute sur 127.0.0.1:${WEB_PORT} :
//  accessible uniquement via le reverse proxy du dashboard
//  (https://dashboard-lorient.dimsi.cloud/jeanpip/ → whitelist IP).
//
//  Routes (toutes relatives, fonctionnent derrière un préfixe) :
//    GET  /open/<id>?t=<token>        → page d'animation
//    POST /api/open/<id>?t=<token>    → ouvre (ou rejoue) le booster
//    GET  /api/card-image/<fileId>    → image d'une carte (proxy + cache)
//    GET  /<fichier>                  → statiques de public/
//
//  Désactivé si WEB_PUBLIC_URL est vide (ouverture Slack uniquement).
// ═══════════════════════════════════════════════════════════

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const boosters = require('./boosters');
const { openOnce } = require('./openBooster');
const { getCardImage, cardImageUrl } = require('./cardImages');
const { buildWebOpenedBlocks } = require('./blocks');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SECRET_PATH = path.join(__dirname, '..', 'data', 'web-secret');

const WEB_PUBLIC_URL = (process.env.WEB_PUBLIC_URL || '').trim().replace(/\/+$/, '');
const WEB_PORT = parseInt(process.env.WEB_PORT, 10) || 3100;

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function isEnabled() {
  return Boolean(WEB_PUBLIC_URL);
}

// ─────────────────────────────────────────────
// 🔐 Signature des liens (HMAC-SHA256)
//    WEB_SECRET du .env, sinon généré une fois dans data/web-secret
// ─────────────────────────────────────────────

let secret = null;

function getSecret() {
  if (secret) return secret;
  if (process.env.WEB_SECRET) {
    secret = process.env.WEB_SECRET;
    return secret;
  }
  try {
    if (fs.existsSync(SECRET_PATH)) {
      secret = fs.readFileSync(SECRET_PATH, 'utf-8').trim();
      if (secret) return secret;
    }
  } catch {
    // illisible → on régénère
  }
  secret = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
    fs.writeFileSync(SECRET_PATH, secret, 'utf-8');
  } catch (e) {
    console.error('[web] écriture du secret:', e.message);
  }
  return secret;
}

function signToken(boosterId, ownerId) {
  return crypto.createHmac('sha256', getSecret()).update(`${boosterId}:${ownerId}`).digest('hex');
}

function verifyToken(boosterId, ownerId, token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return false;
  const expected = Buffer.from(signToken(boosterId, ownerId), 'hex');
  return crypto.timingSafeEqual(expected, Buffer.from(token, 'hex'));
}

/** Lien d'ouverture FIFA d'un booster (null si la page web est désactivée). */
function buildOpenUrl(boosterId, ownerId) {
  if (!isEnabled()) return null;
  return `${WEB_PUBLIC_URL}/open/${encodeURIComponent(boosterId)}?t=${signToken(boosterId, ownerId)}`;
}

// ─────────────────────────────────────────────
// 📤 Réponses
// ─────────────────────────────────────────────

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
}

function serveFile(res, file, cacheControl) {
  const type = STATIC_TYPES[path.extname(file).toLowerCase()];
  if (!type) return send(res, 404, 'Not found');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, data, { 'Content-Type': type, 'Cache-Control': cacheControl });
  });
}

function serveStatic(res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  const file = path.normalize(path.join(PUBLIC_DIR, decoded));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'Not found');
  const cache = decoded.startsWith('/assets/') ? 'public, max-age=604800' : 'no-cache';
  return serveFile(res, file, cache);
}

// ─────────────────────────────────────────────
// 🏷️ Page d'ouverture avec version des assets
//    Cloudflare impose un cache navigateur de 4 h sur .css/.js (il écrase
//    notre no-cache) : open.css?v=<hash> change dès que le contenu change,
//    donc une mise à jour est vue tout de suite, sans purge ni Ctrl+F5.
//    Calculé une fois (les fichiers ne changent qu'au déploiement = restart).
// ─────────────────────────────────────────────

let assetVersion = null;

function getAssetVersion() {
  if (assetVersion) return assetVersion;
  const hash = crypto.createHash('sha1');
  for (const name of ['open.css', 'open.js']) {
    try {
      hash.update(fs.readFileSync(path.join(PUBLIC_DIR, name)));
    } catch {
      hash.update(name); // fichier absent : version stable quand même
    }
  }
  assetVersion = hash.digest('hex').slice(0, 10);
  return assetVersion;
}

function serveOpenPage(res) {
  fs.readFile(path.join(PUBLIC_DIR, 'open.html'), 'utf-8', (err, html) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, html.replace(/__ASSET_VERSION__/g, getAssetVersion()), {
      'Content-Type': STATIC_TYPES['.html'],
      'Cache-Control': 'no-cache',
    });
  });
}

// ─────────────────────────────────────────────
// 🎴 Ouverture via la page
// ─────────────────────────────────────────────

function toPublicCard(card, count) {
  return {
    title: card.title,
    rarity: card.rarity || 'common',
    type: card.type,
    count: count || 0,
    image: cardImageUrl(card),
    link: card.url,
  };
}

async function updatePurchaseMessage(client, pending, cards, counts, logger) {
  if (!pending.message) return;
  try {
    const booster = boosters.getBooster(pending.type);
    await client.chat.update({
      channel: pending.message.channel,
      ts: pending.message.ts,
      text: `${booster ? booster.emoji : '🎁'} Booster ouvert en mode FIFA !`,
      blocks: buildWebOpenedBlocks(booster, cards, counts),
    });
  } catch (e) {
    logger.error('[web] mise à jour du DM d\'achat:', e.message);
  }
}

function handleOpen(res, id, token, { client, logger }) {
  const pending = boosters.getPending(id);
  if (!pending) return sendJson(res, 404, { status: 'not_found' });
  if (!verifyToken(id, pending.owner, token)) return sendJson(res, 403, { status: 'invalid' });

  const result = openOnce(id, pending.owner, 'web');
  const booster = boosters.getBooster(pending.type);
  const boosterInfo = {
    type: pending.type,
    label: booster ? booster.label : pending.type,
    emoji: booster ? booster.emoji : '🎁',
  };

  if (result.status === 'already' && (result.via !== 'web' || !result.cards)) {
    return sendJson(res, 200, { status: 'already_slack', booster: boosterInfo });
  }
  if (result.status !== 'opened' && result.status !== 'already') {
    return sendJson(res, 404, { status: result.status });
  }

  if (result.status === 'opened') {
    logger.info(`🎬 <@${pending.owner}> ouvre le booster ${pending.type} en mode FIFA (id ${id})`);
    updatePurchaseMessage(client, pending, result.cards, result.counts, logger);
  }

  return sendJson(res, 200, {
    status: result.status === 'opened' ? 'opened' : 'replay',
    booster: boosterInfo,
    cards: result.cards.map((card, i) => toPublicCard(card, result.counts && result.counts[i])),
  });
}

async function handleCardImage(res, fileId, { client, logger }) {
  const image = await getCardImage(client, fileId, logger);
  if (!image) return send(res, 404, 'Not found');
  fs.readFile(image.file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, data, { 'Content-Type': image.mime, 'Cache-Control': 'public, max-age=604800' });
  });
}

// ─────────────────────────────────────────────
// 🚦 Routage
// ─────────────────────────────────────────────

function createHandler(deps) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const { pathname } = url;
      let m;

      if (req.method === 'GET' && /^\/open\/[\w-]+$/.test(pathname)) {
        return serveOpenPage(res);
      }
      if ((m = /^\/api\/open\/([\w-]+)$/.exec(pathname))) {
        if (req.method !== 'POST') return send(res, 405, 'Method not allowed', { Allow: 'POST' });
        return handleOpen(res, m[1], url.searchParams.get('t'), deps);
      }
      if (req.method === 'GET' && (m = /^\/api\/card-image\/([A-Z0-9]+)$/.exec(pathname))) {
        return await handleCardImage(res, m[1], deps);
      }
      if (req.method === 'GET' && pathname !== '/') {
        return serveStatic(res, pathname);
      }
      return send(res, 404, 'Not found');
    } catch (error) {
      deps.logger.error('[web] erreur:', error);
      if (!res.headersSent) sendJson(res, 500, { status: 'error' });
      else res.end();
    }
  };
}

/**
 * Démarre le serveur web (si WEB_PUBLIC_URL est défini).
 * Une erreur ici ne fait jamais tomber le bot.
 * @returns {http.Server|null}
 */
function startWebServer({ client, logger = console, port = WEB_PORT, host = '127.0.0.1', force = false }) {
  if (!isEnabled() && !force) {
    logger.info('🎬 Page d\'ouverture FIFA désactivée (WEB_PUBLIC_URL vide)');
    return null;
  }
  getSecret();
  const server = http.createServer(createHandler({ client, logger }));
  server.on('error', (err) => logger.error('[web] serveur:', err.message));
  server.listen(port, host, () => {
    logger.info(`🎬 Page d'ouverture FIFA : http://${host}:${port} → ${WEB_PUBLIC_URL || '(test)'}`);
  });
  return server;
}

module.exports = { startWebServer, buildOpenUrl, isEnabled, signToken, verifyToken };
