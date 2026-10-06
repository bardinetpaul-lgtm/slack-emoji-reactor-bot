// ═══════════════════════════════════════════════════════════
//  📺 MODULE JP TV — l'Arène en direct sur la TV du hall (v2.3)
//  (branché dans src/web.js)
//
//    GET /tv/arena?k=        → page de diffusion plein écran (public/tv.html)
//    GET /api/tv/stream?k=   → flux SSE du combat à l'antenne (5 Hz)
//    GET /api/tv/arena?k=    → { onAir, live, ranking, recent } pour le
//                              dashboard MagicDIMSI (module arene.js)
//
//  Clé TV = hmac(« tv|jp-tv ») tronqué à 32 caractères : un seul lien,
//  non personnel (la TV n'a pas de compte Slack). `node scripts/tv-urls.js`
//  affiche les deux URL à mettre dans arene.config.json du dashboard.
//
//  Flux : une boucle par TV connectée, toutes les 200 ms (5 Hz) :
//    • choix du combat à l'antenne (tvFeed.pickFeatured) ;
//    • changement → « setup » (noms + dessins ; la page affiche l'alerte
//      « PRIORITÉ AU DIRECT ») ou « idle » ;
//    • combat en cours → « state » (vue spectateur allégée, différentielle,
//      avec les événements accumulés depuis le dernier envoi) ;
//    • fin → « ended » une fois (écran de fin 10 s) ;
//    • « also » quand la liste « Aussi en direct » change.
// ═══════════════════════════════════════════════════════════

const crypto = require('crypto');

const matches = require('./matches');
const arenaStore = require('./arenaStore');
const arenaWeb = require('./arenaWeb');
const tvFeed = require('./tvFeed');
const wire = require('../../public/arena-wire');
const { CAPTAINS } = require('./captains');
const specialties = require('./specialties');

const PING_MS = 15 * 1000;
const RANKING_SIZE = 7;
const RECENT_SIZE = 5;
const TV_ASSETS = ['tv.css', 'arena-wire.js', 'arena-board.js', 'tv.js'];

let ctx = null;   // { publicUrl, getSecret, send, sendJson, servePage, userProfile, client, logger }

function configure(context) {
  ctx = context;
}

// ─────────────────────────────────────────────
// 🔐 Clé TV
// ─────────────────────────────────────────────

function tvKey() {
  return crypto.createHmac('sha256', ctx.getSecret()).update('tv|jp-tv').digest('hex').slice(0, 32);
}

function validKey(k) {
  const expected = Buffer.from(tvKey());
  const given = Buffer.from(String(k || ''));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** → { page, api } (URL publiques avec la clé) ou null si la page web est désactivée. */
function buildTvUrls() {
  if (!ctx || !ctx.publicUrl) return null;
  const k = tvKey();
  return { page: `${ctx.publicUrl}/tv/arena?k=${k}`, api: `${ctx.publicUrl}/api/tv/arena?k=${k}` };
}

async function nameOf(userId) {
  const p = await ctx.userProfile(ctx.client, userId, ctx.logger);
  return (p && p.name) || 'Joueur';
}

// ─────────────────────────────────────────────
// 📊 Synthèse pour le dashboard
// ─────────────────────────────────────────────

async function summary(now = Date.now()) {
  const list = matches.listForTv();
  const running = list.filter((m) => m.broadcast && m.status === 'running')
    .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  const live = await Promise.all(running.map(async (m) => ({
    matchId: m.id, a: await nameOf(m.players.A), b: await nameOf(m.players.B), startedAt: m.startedAt, arena: m.arena,
  })));
  const ranking = await Promise.all(arenaStore.ranking({ limit: RANKING_SIZE }).top.map(async (r) => ({
    rank: r.rank, name: await nameOf(r.userId), wins: r.wins, losses: r.losses, draws: r.draws, winRate: r.winRate,
  })));
  const recent = await Promise.all(arenaStore.recentResults(RECENT_SIZE).map(async (h) => ({
    at: h.at,
    a: await nameOf(h.players[0]),
    b: await nameOf(h.players[1]),
    winner: h.draw || !h.winnerId ? null : await nameOf(h.winnerId),
    draw: h.draw,
    towers: h.towers ? [h.towers[h.players[0]] || 0, h.towers[h.players[1]] || 0] : null,
    reason: h.reason,
  })));
  return { status: 'ok', onAir: tvFeed.isOnAir(list, now), live, ranking, recent, updated: new Date(now).toISOString() };
}

// ─────────────────────────────────────────────
// 📡 Flux SSE de la TV
// ─────────────────────────────────────────────

function handleStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
  });
  if (res.socket) res.socket.setNoDelay(true);
  res.write('retry: 2000\n\n');

  let closed = false;
  const write = (event, data) => { if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  const encoder = wire.createEncoder();
  let featuredId = null;
  let phase = null;
  let names = null;
  let alsoKey = '';
  let pending = [];
  let busy = false;

  const unsubscribe = matches.subscribeSpectator((match, events) => {
    if (match.id === featuredId && events.length) pending.push(...events);
  });

  async function tick() {
    if (busy || closed) return;
    busy = true;
    try {
      const now = Date.now();
      const list = matches.listForTv();
      const pick = tvFeed.pickFeatured(featuredId, list, now);

      const key = pick.also.join('|');
      if (key !== alsoKey) {
        alsoKey = key;
        write('also', await Promise.all(pick.also.map(async (id) => {
          const m = list.find((x) => x.id === id);
          return { a: await nameOf(m.players.A), b: await nameOf(m.players.B) };
        })));
      }

      if (pick.featuredId !== featuredId) {
        featuredId = pick.featuredId;
        phase = null;
        pending = [];
        if (!featuredId) write('idle', {});
      }
      const match = featuredId ? matches.getMatch(featuredId) : null;
      if (!match) return;
      const view = matches.spectatorView(match);

      if (view.phase !== phase) {
        if (view.phase === 'running') {
          encoder.reset();
          const [A, B] = await Promise.all([nameOf(match.players.A.userId), nameOf(match.players.B.userId)]);
          names = { A, B };
          const a = arenaWeb.combatAssets(match);
          write('setup', {
            matchId: match.id, arena: match.arena, names, captains: CAPTAINS, specialties: specialties.INFO,
            symbols: a.symbols, sprites: a.sprites, images: a.images,
          });
        } else {
          write('ended', { matchId: match.id, phase: view.phase, names, result: view.result, cancelReason: view.cancelReason });
        }
        phase = view.phase;
      }
      if (view.phase === 'running') {
        const events = pending;
        pending = [];
        write('state', encoder.encode(arenaWeb.compact({ ...view, events }, arenaWeb.combatAssets(match))));
      }
    } catch (e) {
      ctx.logger.error('[jp-tv] flux:', e.message);
    } finally {
      busy = false;
    }
  }

  write('idle', {});
  const timer = setInterval(tick, tvFeed.SEND_EVERY_MS);
  const ping = setInterval(() => { if (!closed) res.write(': ping\n\n'); }, PING_MS);
  tick();

  req.on('close', () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    clearInterval(ping);
    unsubscribe();
    res.end();
  });
}

// ─────────────────────────────────────────────
// 🚦 Routage : true si la requête était pour JP TV
// ─────────────────────────────────────────────

async function route(req, res, url) {
  const { pathname } = url;
  if (pathname !== '/tv/arena' && pathname !== '/api/tv/arena' && pathname !== '/api/tv/stream') return false;
  if (req.method !== 'GET') { ctx.send(res, 405, 'Method not allowed', { Allow: 'GET' }); return true; }
  if (pathname === '/tv/arena') { ctx.servePage(res, 'tv', TV_ASSETS); return true; }
  if (!validKey(url.searchParams.get('k'))) { ctx.sendJson(res, 403, { status: 'invalid' }); return true; }
  if (pathname === '/api/tv/arena') { ctx.sendJson(res, 200, await summary()); return true; }
  handleStream(req, res);
  return true;
}

module.exports = { configure, route, buildTvUrls, summary };
