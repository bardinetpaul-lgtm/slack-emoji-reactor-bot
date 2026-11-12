// ═══════════════════════════════════════════════════════════
//  🏙️ MODULE WEB — Ville Jeanpip : état, direct, maisons (v4.0)
//  (branché dans src/web.js ; ctx fourni par configureVille)
//
//    GET /ville?t=                    → la page (public/ville.html)
//    GET /api/ville?t=                → état initial de la ville
//    GET /api/ville/stream?t=         → flux SSE : jp, arena, house, auctions, ping
//    GET /api/ville/card/<userId>?t=  → carte de visite d'un joueur
//    GET /api/ville/avatar/<userId>?t=→ photo Slack (proxy, 1 h en mémoire)
//
//  Jeton : src/villeToken.js (« ville|<userId> »). Sans jeton valide → 403.
//  Maisons = inscrits à la liste de diffusion (src/broadcast.js) ; leur
//  parcelle est stable (src/villePlots.js). Un promeneur part de sa
//  maison (fromHouse:true) ou, sans maison, de la place Dimsi.
//  Le solde d'un autre joueur n'est jamais renvoyé.
//
//  Flux : UNE seule boucle serveur pour toutes les villes ouvertes,
//  démarrée au premier client et arrêtée au dernier :
//    • 'jp'    à chaque gain de réaction (cityBus), à tout le monde ;
//    • 'arena' { live, tvUrl } quand l'antenne change (contrôle 2 s) ;
//    • 'house' { action, house } quand les inscrits changent (30 s) ;
//    • 'auctions' { open } : enchères en cours, à l'ouverture du flux
//      puis à chaque changement (contrôle 10 s, v4.2) ;
//    • ': ping' toutes les 15 s.
//  Au plus 3 flux par joueur : un 4e ferme son plus ancien, qui reçoit
//  d'abord 'replaced' {} (la page ne se reconnecte pas). Un client
//  qui n'absorbe plus (write → false) ne reçoit plus ni 'jp' ni ping
//  jusqu'au 'drain' ; bloqué plus de 30 s, il est fermé.
//
//  Carte et photo : seulement pour un joueur CONNU (inscrit, classé à
//  l'Arène, propriétaire d'un classeur, promeneur vu dans un 'jp', ou
//  soi-même), sinon 404 sans appeler Slack.
// ═══════════════════════════════════════════════════════════

const villeToken = require('./villeToken');
const villePlots = require('./villePlots');
const { bus } = require('./cityBus');
const broadcast = require('./broadcast');
const credits = require('./credits');
const collections = require('./collections');
const releases = require('./releases');
const weekend = require('./weekend');
const matches = require('./game/matches');
const arenaStore = require('./game/arenaStore');
const tvFeed = require('./game/tvFeed');
const dailyStreak = require('./game/dailyStreak');
const trades = require('./trades');

const PING_MS = 15 * 1000;
const ARENA_CHECK_MS = 2 * 1000;
const HOUSES_CHECK_MS = 30 * 1000;
const AUCTIONS_CHECK_MS = 10 * 1000;
const RANKING_SIZE = 10;
const MAX_CLIENTS = 300;
const MAX_STREAMS_PER_USER = 3;
const BLOCKED_MAX_MS = 30 * 1000;

const KNOWN_REFRESH_MS = 30 * 1000;
const WALKERS_MAX = 1000;
const OWNER_MEMO_MAX = 1000;

const AVATAR_TTL_MS = 60 * 60 * 1000;
const AVATAR_MISS_TTL_MS = 10 * 60 * 1000;
const AVATAR_CACHE_MAX = 300;
const AVATAR_MAX_BYTES = 512 * 1024;
const AVATAR_TIMEOUT_MS = 5000;

const USER_ID = /^[A-Z0-9_-]{1,40}$/i;

let ctx = null;

// Version des assets (cache Cloudflare) : TOUS les fichiers chargés par la page
const VILLE_ASSETS = ['ville.css', 'ville.js', 'ville-logic.js', 'ville-scene/kit.js', 'ville-scene/world.js', 'ville-scene/landmarks.js', 'ville-scene/houses.js', 'ville-scene/life.js'];

function configure(context) {
  ctx = context;
}

// ─────────────────────────────────────────────
// 🧩 Petites aides
// ─────────────────────────────────────────────

const plain = (text) => String(text || '').replace(/\*/g, '');
const avatarPath = (userId, query) => `api/ville/avatar/${encodeURIComponent(userId)}?${query}`;

async function profileOf(userId) {
  try {
    const p = await ctx.userProfile(ctx.client, userId, ctx.logger);
    return { name: (p && p.name) || 'Joueur', hasAvatar: Boolean(p && p.avatar), avatarUrl: (p && p.avatar) || null };
  } catch {
    return { name: 'Joueur', hasAvatar: false, avatarUrl: null };
  }
}

/** { userId, name, avatar } vu par le joueur dont le jeton est `query`. */
async function person(userId, query) {
  const p = await profileOf(userId);
  return { userId, name: p.name, avatar: p.hasAvatar ? avatarPath(userId, query) : null };
}

/** Antenne : { live, tvUrl } (tvUrl = page JP TV, null si rien à l'antenne). */
function arenaOnAir(userId, now = Date.now()) {
  const pick = tvFeed.pickFeatured(null, matches.listForTv(), now);
  const live = Boolean(pick.featuredId);
  const tv = live ? ctx.buildUrls(userId).tv : null;
  return { live: live && Boolean(tv), tvUrl: live ? tv || null : null };
}

function myMatchUrl(userId) {
  const m = matches.getMatchOf(userId);
  return m ? ctx.arenaUrl(m.id, userId) || null : null;
}

/** Nombre d'enchères en cours (ouvertes et pas encore terminées). */
function openAuctions(now = Date.now()) {
  try {
    return Object.values(trades._load().trades)
      .filter((t) => t && t.kind === 'auction' && t.status === 'open' && Number(t.endsAt) > now).length;
  } catch (e) {
    ctx.logger.warn(`[ville] enchères : ${e.message}`);
    return 0;
  }
}

async function housesFor(query) {
  const list = villePlots.list(broadcast.getSubscribers());
  return Promise.all(list.map(async ({ userId, plot }) => ({ ...(await person(userId, query)), plot })));
}

// ─────────────────────────────────────────────
// 🏙️ État initial
// ─────────────────────────────────────────────

async function state(userId, query, now = Date.now()) {
  const pause = weekend.pauseFor(userId, now);
  const links = ctx.buildUrls(userId);
  const rel = releases.current();
  const [me, houses, ranking] = await Promise.all([
    person(userId, query),
    housesFor(query),
    Promise.all(arenaStore.ranking({ limit: RANKING_SIZE }).top.map(async (r) => ({
      ...(await person(r.userId, query)), rank: r.rank, wins: r.wins, losses: r.losses,
    }))),
  ]);
  return {
    ok: true,
    serverTime: now,
    me: { ...me, balance: credits.getBalance(userId) },
    pause: pause ? { title: plain(pause.title), kind: pause.kind, icon: pause.icon } : null,
    houses,
    arena: { ...arenaOnAir(userId, now), myMatchUrl: myMatchUrl(userId) },
    auctions: { open: openAuctions(now) },
    links: { museum: links.museum, kiosk: links.kiosk, deck: links.deck, boutique: links.boutique, banque: links.banque, salle: links.salle },
    mairie: {
      release: { version: rel.version, title: rel.title, date: rel.date, changes: (rel.changes || []).map(plain) },
      ranking,
    },
  };
}

// ─────────────────────────────────────────────
// 🪪 Carte de visite
// ─────────────────────────────────────────────

async function card(viewerId, userId, query, now = Date.now()) {
  const cards = collections.getCollection(userId).filter((c) => (c.count || 0) > 0);
  const me = arenaStore.ranking({ limit: 0, userId }).me;
  const out = {
    ok: true,
    ...(await person(userId, query)),
    rank: me ? me.rank : null,
    distinctCards: cards.length,
    legendaries: cards.filter((c) => c.rarity === 'legendary').length,
    streak: dailyStreak.preview(arenaStore.getStreak(userId), now).step || 0,
  };
  if (viewerId === userId) out.balance = credits.getBalance(userId);
  return out;
}

// ─────────────────────────────────────────────
// 👥 Joueurs connus (seuls servis par carte / photo)
// ─────────────────────────────────────────────

const walkers = new Map();   // userId → true (promeneurs vus dans un 'jp', borné)
let known = null;            // { at, set } inscrits + classés à l'Arène
const ownerMemo = new Map(); // userId → bool (a un classeur), vidé à chaque rafraîchissement

function rememberWalker(userId) {
  walkers.delete(userId);
  walkers.set(userId, true);
  while (walkers.size > WALKERS_MAX) walkers.delete(walkers.keys().next().value);
}

function knownSet(now = Date.now()) {
  if (known && now - known.at < KNOWN_REFRESH_MS) return known.set;
  const set = new Set(broadcast.getSubscribers());
  for (const r of arenaStore.ranking({ limit: Infinity }).top) set.add(r.userId);
  known = { at: now, set };
  ownerMemo.clear();
  return set;
}

/** Joueur connu ? (aucun appel Slack ; fichiers relus au plus toutes les 30 s) */
function isKnown(userId, viewerId) {
  if (userId === viewerId || walkers.has(userId) || knownSet().has(userId)) return true;
  if (!ownerMemo.has(userId)) {
    if (ownerMemo.size >= OWNER_MEMO_MAX) ownerMemo.clear();
    ownerMemo.set(userId, collections.getCollection(userId).length > 0);
  }
  return ownerMemo.get(userId);
}

// ─────────────────────────────────────────────
// 🖼️ Photos Slack (proxy + cache mémoire borné)
// ─────────────────────────────────────────────

const avatars = new Map();   // userId → { at, ttl, data, type } (data null = pas de photo)
const inflight = new Map();  // userId → Promise

function rememberAvatar(userId, entry) {
  avatars.delete(userId);
  avatars.set(userId, entry);
  while (avatars.size > AVATAR_CACHE_MAX) avatars.delete(avatars.keys().next().value);
}

async function downloadAvatar(userId) {
  const { avatarUrl } = await profileOf(userId);
  if (!avatarUrl || !/^https?:\/\//i.test(avatarUrl)) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), AVATAR_TIMEOUT_MS);
  try {
    const r = await fetch(avatarUrl, { signal: ac.signal, redirect: 'follow' });
    const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const declared = Number(r.headers.get('content-length'));
    if (!r.ok || !/^image\/(png|jpeg|gif|webp)$/.test(type) || declared > AVATAR_MAX_BYTES || !r.body) {
      ac.abort();
      return null;
    }
    // Lecture en flux, coupée dès qu'on dépasse la limite (content-length absent ou faux)
    const chunks = [];
    let size = 0;
    for await (const chunk of r.body) {
      size += chunk.length;
      if (size > AVATAR_MAX_BYTES) { ac.abort(); return null; }
      chunks.push(Buffer.from(chunk));
    }
    const data = Buffer.concat(chunks);
    if (!data.length) return null;
    return { data, type };
  } catch (e) {
    ctx.logger.warn(`[ville] photo de ${userId} : ${e.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** → { data, type } ou null (pas de photo). */
async function getAvatar(userId, now = Date.now()) {
  const hit = avatars.get(userId);
  if (hit && now - hit.at < hit.ttl) return hit.data ? hit : null;
  if (!inflight.has(userId)) {
    inflight.set(userId, downloadAvatar(userId).then((img) => {
      rememberAvatar(userId, img
        ? { at: Date.now(), ttl: AVATAR_TTL_MS, data: img.data, type: img.type }
        : { at: Date.now(), ttl: AVATAR_MISS_TTL_MS, data: null, type: null });
      return img;
    }).finally(() => inflight.delete(userId)));
  }
  return inflight.get(userId);
}

// ─────────────────────────────────────────────
// 📡 Flux SSE : une seule boucle pour toutes les villes
// ─────────────────────────────────────────────

const clients = new Set();   // { res, userId, query }
let loop = null;             // { arenaTimer, housesTimer, auctionsTimer, pingTimer }
let lastArena = null;        // clé « live|tvUrl » du dernier envoi
let lastHouses = null;       // Map userId → plot
let lastAuctions = null;     // dernier nombre d'enchères en cours envoyé

/**
 * Écrit sur le flux. Si le client n'absorbe plus (write → false), il est
 * « bloqué » jusqu'au 'drain' : seuls les envois `essential` passent ;
 * bloqué depuis plus de 30 s → fermé.
 */
function rawWrite(c, chunk, essential) {
  if (c.closed) return;
  if (c.blockedAt) {
    if (Date.now() - c.blockedAt > BLOCKED_MAX_MS) { dropClient(c); return; }
    if (!essential) return;
  }
  try {
    if (!c.res.write(chunk) && !c.blockedAt) {
      c.blockedAt = Date.now();
      c.res.once('drain', () => { c.blockedAt = null; });
    }
  } catch {
    dropClient(c);
  }
}

// 'jp' = décor (peut être sauté) ; 'arena', 'house' et 'auctions' = état de la ville
const ESSENTIAL = new Set(['arena', 'house', 'auctions']);

function writeTo(c, event, data) {
  rawWrite(c, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`, ESSENTIAL.has(event));
}

/** Envoie à chaque ville ; `build(c)` fabrique la charge pour ce client (photo avec son jeton). */
function sendAll(event, build) {
  for (const c of clients) writeTo(c, event, build(c));
}

async function onJp(payload) {
  try {
    if (!payload || typeof payload.userId !== 'string' || !USER_ID.test(payload.userId)) return;
    const amount = Number(payload.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const { userId } = payload;
    rememberWalker(userId);
    const fromHouse = broadcast.isSubscribed(userId);
    const p = await profileOf(userId);
    sendAll('jp', (c) => ({
      userId, name: p.name, avatar: p.hasAvatar ? avatarPath(userId, c.query) : null, amount, fromHouse,
    }));
  } catch (e) {
    ctx.logger.error('[ville] promeneur :', e.message);
  }
}
// Le bus appelle les écouteurs sans attendre : une promesse rejetée ne doit rien casser
const jpListener = (payload) => { onJp(payload); };

function checkArena() {
  try {
    if (!clients.size) return;
    const a = arenaOnAir(clients.values().next().value.userId);
    const key = `${a.live}|${a.tvUrl}`;
    if (key === lastArena) return;
    lastArena = key;
    sendAll('arena', () => a);
  } catch (e) {
    ctx.logger.error('[ville] antenne :', e.message);
  }
}

function checkAuctions() {
  try {
    if (!clients.size) return;
    const open = openAuctions();
    if (open === lastAuctions) return;
    lastAuctions = open;
    sendAll('auctions', () => ({ open }));
  } catch (e) {
    ctx.logger.error('[ville] enchères :', e.message);
  }
}

async function checkHouses() {
  try {
    const now = new Map(villePlots.list(broadcast.getSubscribers()).map((h) => [h.userId, h.plot]));
    const before = lastHouses;
    lastHouses = now;
    if (!before) return;
    const added = [...now.keys()].filter((u) => !before.has(u));
    const removed = [...before.keys()].filter((u) => !now.has(u));
    for (const userId of removed) {
      const p = await profileOf(userId);
      sendAll('house', (c) => ({ action: 'remove', house: { userId, name: p.name, avatar: p.hasAvatar ? avatarPath(userId, c.query) : null, plot: before.get(userId) } }));
    }
    for (const userId of added) {
      const p = await profileOf(userId);
      sendAll('house', (c) => ({ action: 'add', house: { userId, name: p.name, avatar: p.hasAvatar ? avatarPath(userId, c.query) : null, plot: now.get(userId) } }));
    }
  } catch (e) {
    ctx.logger.error('[ville] maisons :', e.message);
  }
}

function startLoop() {
  if (loop) return;
  lastArena = null;
  lastAuctions = null;
  lastHouses = new Map(villePlots.list(broadcast.getSubscribers()).map((h) => [h.userId, h.plot]));
  bus.on('jp', jpListener);
  loop = {
    arenaTimer: setInterval(checkArena, ARENA_CHECK_MS),
    housesTimer: setInterval(checkHouses, HOUSES_CHECK_MS),
    auctionsTimer: setInterval(checkAuctions, AUCTIONS_CHECK_MS),
    pingTimer: setInterval(() => { for (const c of [...clients]) rawWrite(c, ': ping\n\n', false); }, PING_MS),
  };
}

function stopLoop() {
  if (!loop) return;
  clearInterval(loop.arenaTimer);
  clearInterval(loop.housesTimer);
  clearInterval(loop.auctionsTimer);
  clearInterval(loop.pingTimer);
  bus.removeListener('jp', jpListener);
  loop = null;
  lastHouses = null;
  lastArena = null;
  lastAuctions = null;
}

function dropClient(c) {
  if (c.closed) return;
  c.closed = true;
  clients.delete(c);
  try { c.res.end(); } catch { /* déjà fermé */ }
  if (!clients.size) stopLoop();
}

function handleStream(req, res, userId, query) {
  // Au plus 3 flux par joueur : les plus anciens (premiers insérés) laissent leur place
  const mine = [...clients].filter((x) => x.userId === userId);
  // 'replaced' d'abord : la page arrête de se reconnecter (sinon 4 onglets se chassent en boucle)
  for (let i = 0; i <= mine.length - MAX_STREAMS_PER_USER; i += 1) {
    try { if (!mine[i].closed) mine[i].res.write('event: replaced\ndata: {}\n\n'); } catch { /* déjà fermé */ }
    dropClient(mine[i]);
  }
  if (clients.size >= MAX_CLIENTS) { ctx.sendJson(res, 503, { ok: false, reason: 'busy' }); return; }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
  });
  if (res.socket) res.socket.setNoDelay(true);
  res.write('retry: 2000\n\n');
  const c = { res, userId, query, closed: false, blockedAt: null };
  clients.add(c);
  startLoop();
  // État de l'antenne tout de suite (la page peut avoir lu /api/ville juste avant un changement)
  try {
    const a = arenaOnAir(userId);
    if (lastArena === null) lastArena = `${a.live}|${a.tvUrl}`;
    writeTo(c, 'arena', a);
  } catch { /* le contrôle suivant s'en charge */ }
  // Enchères en cours tout de suite (même raison)
  try {
    const open = openAuctions();
    if (lastAuctions === null) lastAuctions = open;
    writeTo(c, 'auctions', { open });
  } catch { /* le contrôle suivant s'en charge */ }
  req.on('close', () => dropClient(c));
  res.on('error', () => dropClient(c));
}

// ─────────────────────────────────────────────
// 🚦 Routage : true si la requête était pour la ville
// ─────────────────────────────────────────────

async function route(req, res, url) {
  const { pathname } = url;
  if (pathname !== '/ville' && pathname !== '/api/ville' && !pathname.startsWith('/api/ville/')) return false;
  if (req.method !== 'GET') { ctx.send(res, 405, 'Method not allowed', { Allow: 'GET' }); return true; }
  if (pathname === '/ville') { ctx.servePage(res, 'ville', VILLE_ASSETS); return true; }

  const userId = villeToken.read(url.searchParams.get('t'));
  if (!userId) { ctx.sendJson(res, 403, { ok: false, reason: 'invalid' }); return true; }
  const query = villeToken.query(userId);

  if (pathname === '/api/ville') { ctx.sendJson(res, 200, await state(userId, query)); return true; }
  if (pathname === '/api/ville/stream') { handleStream(req, res, userId, query); return true; }

  // Carte / photo : joueur connu seulement (sinon 404, sans appel Slack)
  const allowed = (match) => match && USER_ID.test(match[1]) && isKnown(match[1], userId);
  let m = /^\/api\/ville\/card\/([^/]+)$/.exec(pathname);
  if (allowed(m)) { ctx.sendJson(res, 200, await card(userId, m[1], query)); return true; }
  m = /^\/api\/ville\/avatar\/([^/]+)$/.exec(pathname);
  if (allowed(m)) {
    const img = await getAvatar(m[1]);
    if (!img) { ctx.send(res, 404, 'Not found'); return true; }
    ctx.send(res, 200, img.data, { 'Content-Type': img.type, 'Cache-Control': 'private, max-age=3600' });
    return true;
  }
  ctx.sendJson(res, 404, { ok: false, reason: 'not_found' });
  return true;
}

module.exports = {
  configure, route,
  _ctx: () => ctx,
  _clientCount: () => clients.size,
  _checkHouses: checkHouses,
  _checkArena: checkArena,
  _checkAuctions: checkAuctions,
};
