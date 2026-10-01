// ═══════════════════════════════════════════════════════════
//  📊 MODULE WEB DU DASHBOARD /stats (admins seulement)
//
//  Routes (relatives, fonctionnent derrière le préfixe /jeanpip/) :
//    GET /stats?t=<jeton>                    → page
//    GET /api/stats/<bloc>?t=&from=&to=&grain=&user=&source=
//    GET /api/stats/players?t=               → joueurs du filtre (+ noms)
//
//  Jeton « <userId>.<expMs>.<hmac> », valable 24 h, recréé à chaque
//  ouverture de l'onglet Accueil. Chaque requête revérifie : signature,
//  expiration ET que userId est toujours dans JEANPIP_ADMINS.
// ═══════════════════════════════════════════════════════════

const crypto = require('crypto');
const stats = require('./index');

const TTL_MS = 24 * 3600 * 1000;
const PAGE_ASSETS = ['stats.css', 'stats.js', 'vendor/chart.umd.js'];

let ctx = null;   // { publicUrl, getSecret, send, sendJson, servePage, displayName, client, logger, catalogSize, ownedCopies, albumStats, boosterPrice }

function configure(context) {
  ctx = context;
}

const adminIds = () => (process.env.JEANPIP_ADMINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const hmac = (msg) => crypto.createHmac('sha256', ctx.getSecret()).update(msg).digest('hex');

function makeToken(userId, now = Date.now()) {
  const exp = now + TTL_MS;
  return `${userId}.${exp}.${hmac(`stats|${userId}|${exp}`)}`;
}

/** → userId admin si le jeton est valide et non expiré, sinon null. */
function readToken(token, now = Date.now()) {
  const m = /^([A-Z0-9_-]+)\.(\d{10,16})\.([a-f0-9]{64})$/i.exec(token || '');
  if (!m) return null;
  const exp = Number(m[2]);
  if (exp < now) return null;
  const expected = Buffer.from(hmac(`stats|${m[1]}|${exp}`), 'hex');
  const given = Buffer.from(m[3], 'hex');
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return adminIds().includes(m[1]) ? m[1] : null;
}

function buildStatsUrl(userId, now = Date.now()) {
  if (!ctx || !ctx.publicUrl || !adminIds().includes(userId)) return null;
  return `${ctx.publicUrl}/stats?t=${encodeURIComponent(makeToken(userId, now))}`;
}

async function handlePlayers(res) {
  const { players, firstAt } = stats.players();
  const named = await Promise.all(players.map(async (id) => ({
    id,
    name: ctx.client ? await ctx.displayName(ctx.client, id, ctx.logger) : null,
  })));
  ctx.sendJson(res, 200, { ok: true, players: named, firstAt });
}

function handleBlock(res, block, q) {
  const filters = {
    from: q.get('from') || undefined,
    to: q.get('to') || undefined,
    grain: q.get('grain') || 'day',
    user: q.get('user') || null,
    source: q.get('source') || null,
  };
  try {
    const data = stats.run(block, filters, {
      catalogSize: ctx.catalogSize(),
      ownedCopies: ctx.ownedCopies(filters.user),
      albumStats: ctx.albumStats,
      boosterPrice: ctx.boosterPrice,
    });
    ctx.sendJson(res, 200, { ok: true, ...data });
  } catch (e) {
    if (e.code !== 'BAD_FILTER') throw e;
    ctx.sendJson(res, 400, { ok: false, reason: e.message });
  }
}

async function route(req, res, url) {
  const { pathname } = url;
  if (req.method === 'GET' && pathname === '/stats') {
    ctx.servePage(res, 'stats', PAGE_ASSETS);
    return true;
  }
  const m = /^\/api\/stats\/([a-z]+)$/.exec(pathname);
  if (!m) return false;
  if (req.method !== 'GET') { ctx.send(res, 405, 'Method not allowed', { Allow: 'GET' }); return true; }
  if (!readToken(url.searchParams.get('t'))) { ctx.sendJson(res, 403, { ok: false, reason: 'invalid' }); return true; }
  if (m[1] === 'players') { await handlePlayers(res); return true; }
  if (!stats.BLOCKS.includes(m[1])) { ctx.sendJson(res, 404, { ok: false, reason: 'unknown' }); return true; }
  handleBlock(res, m[1], url.searchParams);
  return true;
}

module.exports = { configure, route, buildStatsUrl, makeToken, readToken, TTL_MS };
