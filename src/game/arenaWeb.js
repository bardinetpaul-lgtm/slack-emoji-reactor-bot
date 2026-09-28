// ═══════════════════════════════════════════════════════════
//  🌐 MODULE ROUTES WEB DE L'ARÈNE (branché dans src/web.js)
//
//    GET  /arena/<id>?t=               → page de combat (préparation + combat + fin)
//    GET  /api/arena/<id>/stream?t=    → flux SSE (setup + états)
//    POST /api/arena/<id>/action?t=    → deploy | decks | ready | forfeit | tutorial
//    GET  /deck?t=                     → « Mon deck » (éditeur hors combat)
//    GET  /api/deck?t=                 → catalogue + mes decks
//    POST /api/deck?t=                 → enregistre mes decks ({ tutorial: true } : tuto vu)
//
//  Jeton = « <userId>.<hmac> » (lien personnel, signé comme les autres
//  liens du bot). Arène : hmac(« arena|<match>|<user> ») ; deck :
//  hmac(« deck|<user> ») — le « | » empêche toute confusion de messages.
//
//  ⚡ Performance (Cloudflare + reverse proxy devant) :
//    • push SSE 10 Hz, une seule boucle pour tous les combats ;
//    • setup lourd (dessins, catalogue) envoyé UNE fois par phase et
//      construit une fois par combat ; états allégés (clés courtes à la
//      place des URLs, chiffres arrondis, main réduite à l'utile) ;
//    • envoi différentiel (public/arena-wire.js) : une unité est décrite
//      une fois puis seuls position et PV circulent → ~0,6 Ko par état,
//      ~6 Ko/s par joueur (au lieu de ~40 en brut) ;
//    • une pose est appliquée et diffusée dès le POST (pas d'attente) ;
//    • setNoDelay, « no-transform » + X-Accel-Buffering: no (pas de
//      tampon ni de compression), ping toutes les 15 s (délai d'inactivité
//      Cloudflare = 100 s) ; un seul flux par joueur et par combat.
// ═══════════════════════════════════════════════════════════

const crypto = require('crypto');

const matches = require('./matches');
const arenaStore = require('./arenaStore');
const characters = require('./characters');
const { getCardStats } = require('./cards');
const collections = require('../collections');
const { getAllMedia } = require('../media');
const { cardImageUrl } = require('../cardImages');
const wire = require('../../public/arena-wire');
const { CAPTAINS } = require('./captains');
const specialties = require('./specialties');

const PING_MS = 15 * 1000;
const MAX_BODY = 16 * 1024;

let ctx = null;              // { publicUrl, getSecret, send, sendJson, servePage, displayName, client, logger }
const streams = new Map();   // `${matchId}|${userId}` → fermeture du flux précédent

function configure(context) {
  ctx = context;
}

// ─────────────────────────────────────────────
// 🔐 Jetons « <userId>.<hmac> »
// ─────────────────────────────────────────────

const hmac = (msg) => crypto.createHmac('sha256', ctx.getSecret()).update(msg).digest('hex');

function makeToken(userId, msg) {
  return `${userId}.${hmac(msg)}`;
}

/** → userId si le jeton est valide pour ce message, sinon null. */
function readToken(token, msgOf) {
  const m = /^([A-Z0-9_-]+)\.([a-f0-9]{64})$/i.exec(token || '');
  if (!m) return null;
  const expected = Buffer.from(hmac(msgOf(m[1])), 'hex');
  const given = Buffer.from(m[2], 'hex');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? m[1] : null;
}

const arenaMsg = (matchId) => (userId) => `arena|${matchId}|${userId}`;
const deckMsg = (userId) => `deck|${userId}`;

/** Lien personnel vers un combat (null si la page web est désactivée). */
function buildArenaUrl(matchId, userId) {
  if (!ctx || !ctx.publicUrl) return null;
  return `${ctx.publicUrl}/arena/${encodeURIComponent(matchId)}?t=${encodeURIComponent(makeToken(userId, arenaMsg(matchId)(userId)))}`;
}

/** Lien personnel « Mon deck ». */
function buildDeckUrl(userId) {
  if (!ctx || !ctx.publicUrl) return null;
  return `${ctx.publicUrl}/deck?t=${encodeURIComponent(makeToken(userId, deckMsg(userId)))}`;
}

// ─────────────────────────────────────────────
// 🗂️ Catalogue (préparation, « Mon deck »)
// ─────────────────────────────────────────────

// Image relative à la page (…/arena/<id> ou …/deck) ; URL publique telle quelle
function imageFor(card, prefix) {
  const img = cardImageUrl(card);
  if (!img) return null;
  return /^https?:/.test(img) ? img : `${prefix}${img}`;
}

// Seulement les cartes POSSÉDÉES : une carte qu'on n'a pas n'apparaît nulle part (ni envoyée)
function catalogueFor(userId, prefix) {
  const owned = Object.fromEntries(collections.getCollection(userId).map((c) => [c.url, c.count]));
  return getAllMedia().filter((m) => owned[m.url] > 0).map((m) => {
    const s = getCardStats(m);
    return {
      url: m.url, title: m.title, rarity: s.rarity, archetype: s.archetype, cost: s.cost, specialty: s.specialty,
      copies: owned[m.url] || 0, image: imageFor(m, prefix),
    };
  });
}

async function namesFor(match, userId) {
  const foe = match.players.A.userId === userId ? match.players.B.userId : match.players.A.userId;
  const [you, opponent] = await Promise.all([ctx.displayName(ctx.client, userId, ctx.logger), ctx.displayName(ctx.client, foe, ctx.logger)]);
  return { you: you || 'Vous', opponent: opponent || 'Adversaire' };
}

// ─────────────────────────────────────────────
// 🎨 Setup du combat : construit UNE fois par combat
//    clés courtes « c0…c15 » à la place des URLs (dessins + états)
// ─────────────────────────────────────────────

function combatAssets(match) {
  if (match.webAssets) return match.webAssets;
  const cards = [];
  for (const side of ['A', 'B']) {
    const p = match.engine.players[side];
    for (const url of Object.keys(p.cards)) cards.push(p.cards[url]);
  }
  const typeOf = Object.fromEntries(getAllMedia().map((m) => [m.url, m.type]));
  const keyOf = {};
  const sprites = {};
  const images = {};
  const symbols = cards.map((card, i) => {
    const key = `c${i}`;
    keyOf[card.url] = key;
    const set = characters.renderSpriteSet(card, key);
    sprites[key] = set.sprite;          // terrain (clés courtes)
    sprites[card.url] = set.sprite;     // faces des cartes en main (URL)
    const img = imageFor({ url: card.url, type: typeOf[card.url] || 'image' }, '../');
    if (img) images[card.url] = img;
    return set.svg;
  }).join('');
  match.webAssets = { keyOf, symbols, sprites, images };
  return match.webAssets;
}

// ─────────────────────────────────────────────
// ✂️ États allégés
// ─────────────────────────────────────────────

const r2 = (n) => Math.round(n * 100) / 100;

function compact(view, { keyOf = {}, images = {} } = {}) {
  if (view.phase !== 'running') return view;
  const key = (url) => (url && keyOf[url]) || url;
  const players = {};
  for (const side of ['A', 'B']) {
    const p = view.players[side];
    const out = {
      userId: p.userId, elixir: r2(p.elixir), handCount: p.handCount, towersDestroyed: p.towersDestroyed,
      elixirMax: p.elixirMax, captain: p.captain, rage: p.rage, overheat: p.overheat,
    };
    if (p.hand) {
      const slim = (c) => ({
        url: c.url, title: c.title, rarity: c.rarity, archetype: c.archetype, cost: c.cost, copies: c.copies,
        specialty: c.specialty || null, echo: Boolean(c.echo), rented: Boolean(c.rented),
      });
      out.hand = p.hand.map(slim);
      out.next = p.next ? slim(p.next) : null;
    }
    players[side] = out;
  }
  return {
    ...view,
    players,
    buildings: view.buildings.map((b) => ({ ...b, hp: Math.round(b.hp), url: b.url ? key(b.url) : undefined })),
    units: view.units.map((u) => ({ ...u, y: r2(u.y), hp: Math.round(u.hp), maxHp: Math.round(u.maxHp), url: key(u.url) })),
    pending: view.pending.map((p) => ({ ...p, url: key(p.url) })),
    // 👁 une pose porte l'image de sa carte (l'adversaire voit ce qui arrive)
    events: (view.events || []).map((e) => {
      if (!e.url) return e;
      const out = { ...e, url: key(e.url) };
      if (e.type === 'deploy' && images[e.url]) out.image = images[e.url];
      return out;
    }),
  };
}

// ─────────────────────────────────────────────
// 📡 Flux SSE
// ─────────────────────────────────────────────

async function handleStream(req, res, matchId, userId) {
  const match = matches.getMatch(matchId);
  if (!match) return ctx.sendJson(res, 404, { status: 'not_found' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
  });
  if (res.socket) res.socket.setNoDelay(true);
  res.write('retry: 2000\n\n');

  // Un seul flux par joueur et par combat : l'ancien onglet est fermé
  const slot = `${matchId}|${userId}`;
  if (streams.has(slot)) streams.get(slot)();

  const write = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const names = await namesFor(match, userId);
  const encoder = wire.createEncoder();
  let phase = null;

  const onView = (view) => {
    if (view.phase !== phase) {
      phase = view.phase;
      encoder.reset();
      // textes des Capitaines / Spécialités pour l'interface
      const texts = { captains: CAPTAINS, specialties: specialties.INFO };
      if (phase === 'preparing') write('setup', { arena: match.arena, names, ...texts, catalogue: catalogueFor(userId, '../'), tutorialSeen: arenaStore.hasSeenTutorial(userId) });
      if (phase === 'running') {
        const a = combatAssets(match);
        write('setup', { arena: match.arena, names, ...texts, symbols: a.symbols, sprites: a.sprites, images: a.images });
      }
    }
    write('state', phase === 'running' ? encoder.encode(compact(view, combatAssets(match))) : view);
  };

  matches.connect(matchId, userId, Date.now());
  const unsubscribe = matches.subscribe(matchId, userId, onView);
  const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(ping);
    if (unsubscribe) unsubscribe();
    matches.disconnect(matchId, userId, Date.now());
    if (streams.get(slot) === close) streams.delete(slot);
    res.end();
  };
  streams.set(slot, close);
  req.on('close', close);
  return undefined;
}

// ─────────────────────────────────────────────
// 🎮 Actions
// ─────────────────────────────────────────────

function readJson(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { req.destroy(); resolve(null); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

async function handleAction(req, res, matchId, userId) {
  const match = matches.getMatch(matchId);
  if (!match) return ctx.sendJson(res, 404, { ok: false, reason: 'not_found' });
  const action = await readJson(req);
  if (!action || typeof action.type !== 'string') return ctx.sendJson(res, 400, { ok: false, reason: 'invalid' });

  let result;
  if (action.type === 'tutorial') {
    arenaStore.markTutorialSeen(userId);
    result = { ok: true };
  } else if (action.type === 'decks') {
    arenaStore.setDecks(userId, { decks: action.decks, active: action.active });
    result = { ok: true };
  } else if (action.type === 'ready') {
    if (action.ready) {
      result = matches.setDeck(matchId, userId, Array.isArray(action.urls) ? action.urls : [], typeof action.captain === 'string' ? action.captain : null);
      if (result.ok) result = matches.setReady(matchId, userId, true);
    } else {
      result = matches.setReady(matchId, userId, false);
    }
  } else {
    // deploy / forfeit : appliqué ET diffusé tout de suite par matches.action
    result = matches.action(matchId, userId, action);
  }
  return ctx.sendJson(res, 200, { ok: Boolean(result.ok), reason: result.reason });
}

// ─────────────────────────────────────────────
// 🃏 « Mon deck »
// ─────────────────────────────────────────────

async function handleDeckApi(req, res, userId) {
  if (req.method === 'GET') {
    const { decks, active } = arenaStore.getDecks(userId);
    const name = await ctx.displayName(ctx.client, userId, ctx.logger);
    return ctx.sendJson(res, 200, {
      status: 'ok', name, catalogue: catalogueFor(userId, ''), decks, active, captains: CAPTAINS, specialties: specialties.INFO,
      tutorialSeen: arenaStore.hasSeenTutorial(userId),
    });
  }
  if (req.method === 'POST') {
    const body = await readJson(req);
    if (!body) return ctx.sendJson(res, 400, { ok: false, reason: 'invalid' });
    if (body.tutorial === true) {
      arenaStore.markTutorialSeen(userId);
      return ctx.sendJson(res, 200, { ok: true });
    }
    arenaStore.setDecks(userId, body);
    return ctx.sendJson(res, 200, { ok: true });
  }
  return ctx.send(res, 405, 'Method not allowed', { Allow: 'GET, POST' });
}

// ─────────────────────────────────────────────
// 🚦 Routage : true si la requête était pour l'Arène
// ─────────────────────────────────────────────

const ARENA_ASSETS = ['arena.css', 'arena.js', 'arena-board.js', 'arena-wire.js', 'deck-editor.js', 'arena-tutorial.js'];
const DECK_ASSETS = ['arena.css', 'deck.js', 'deck-editor.js', 'arena-tutorial.js'];

async function route(req, res, url) {
  const { pathname } = url;
  const token = url.searchParams.get('t');
  let m;

  if (req.method === 'GET' && /^\/arena\/[\w-]+$/.test(pathname)) {
    ctx.servePage(res, 'arena', ARENA_ASSETS);
    return true;
  }
  if ((m = /^\/api\/arena\/([\w-]+)\/(stream|action)$/.exec(pathname))) {
    const userId = readToken(token, arenaMsg(m[1]));
    if (!userId) { ctx.sendJson(res, 403, { ok: false, reason: 'invalid' }); return true; }
    if (m[2] === 'stream') {
      if (req.method !== 'GET') { ctx.send(res, 405, 'Method not allowed', { Allow: 'GET' }); return true; }
      await handleStream(req, res, m[1], userId);
      return true;
    }
    if (req.method !== 'POST') { ctx.send(res, 405, 'Method not allowed', { Allow: 'POST' }); return true; }
    await handleAction(req, res, m[1], userId);
    return true;
  }
  if (req.method === 'GET' && pathname === '/deck') {
    ctx.servePage(res, 'deck', DECK_ASSETS);
    return true;
  }
  if (pathname === '/api/deck') {
    const userId = readToken(token, deckMsg);
    if (!userId) { ctx.sendJson(res, 403, { ok: false, reason: 'invalid' }); return true; }
    await handleDeckApi(req, res, userId);
    return true;
  }
  return false;
}

module.exports = { configure, route, buildArenaUrl, buildDeckUrl, compact };
