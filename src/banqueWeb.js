// ═══════════════════════════════════════════════════════════
//  🏦 MODULE WEB — Banque : revente des doublons (v4.0)
//
//  Même jeton que la ville (src/villeToken.js) : t = <userId>.<hmac>
//    GET  /banque?t=            → la page
//    GET  /api/banque?t=        → état (solde, pause, raid, doublons, prix, semaine)
//    POST /api/banque/sell?t=   → { wanted: { <rareté>: n } } → revente
//
//  La règle est celle de la fenêtre Slack (resale.trySell), les refus ont
//  le même texte (resale.errorText). La revente est synchrone : deux clics
//  ne revendent pas deux fois. Le DM et l'Accueil passent par hooks.onResold.
//  ctx = { publicUrl, getSecret, send, sendJson, servePage, readJson,
//          userProfile, client, logger, hooks, buildUrls }
// ═══════════════════════════════════════════════════════════

const villeToken = require('./villeToken');
const resale = require('./resale');
const credits = require('./credits');
const settings = require('./settings');
const weekend = require('./weekend');
const raid = require('./raid');

let ctx = null;

function configure(context) {
  ctx = context;
}

function state(userId, now = Date.now()) {
  const pause = weekend.pauseFor(userId, now);
  const cap = settings.getResaleWeeklyCap();
  return {
    ok: true,
    balance: credits.getBalance(userId),
    pause: pause ? { kind: pause.kind, icon: pause.icon, short: pause.short, back: pause.back, text: resale.errorText({ error: 'pause', pause }) } : null,
    raided: raid.raidsAgainst(userId).length > 0,
    order: resale.RARITY_ORDER,
    labels: resale.LABELS,
    prices: resale.PRICES,
    available: resale.sellableCounts(userId),   // même source que buildResaleModal
    week: { earned: resale.earnedThisWeek(userId, now), cap, remaining: resale.remainingThisWeek(userId, now) },
  };
}

function notify(userId, result) {
  const hook = ctx.hooks && ctx.hooks.onResold;
  if (!hook) return;
  Promise.resolve()
    .then(() => hook(userId, result))
    .catch((e) => ctx.logger.error('[banque] onResold:', e.message));
}

/** → true si la requête a été traitée ici. */
async function route(req, res, url) {
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/banque') {
    ctx.servePage(res, 'banque');
    return true;
  }
  if (pathname !== '/api/banque' && !pathname.startsWith('/api/banque/')) return false;

  const userId = villeToken.read(url.searchParams.get('t'));
  if (!userId) { ctx.sendJson(res, 403, { ok: false, reason: 'invalid' }); return true; }

  if (pathname === '/api/banque') {
    if (req.method !== 'GET') { ctx.send(res, 405, 'Method not allowed', { Allow: 'GET' }); return true; }
    ctx.sendJson(res, 200, state(userId));
    return true;
  }

  if (pathname === '/api/banque/sell') {
    if (req.method !== 'POST') { ctx.send(res, 405, 'Method not allowed', { Allow: 'POST' }); return true; }
    const body = await ctx.readJson(req);
    const result = resale.trySell(userId, body.wanted);   // synchrone à partir d'ici
    if (!result.ok) {
      const { error, rarity, available, remaining } = result;
      ctx.sendJson(res, 200, { ok: false, error, rarity, available, remaining, text: resale.errorText(result) });
      return true;
    }
    const { gained, sold, balance, remaining } = result;
    ctx.sendJson(res, 200, { ok: true, gained, sold, balance, remaining });
    notify(userId, result);
    return true;
  }

  ctx.sendJson(res, 404, { ok: false, reason: 'not_found' });
  return true;
}

module.exports = { configure, route, _ctx: () => ctx };
