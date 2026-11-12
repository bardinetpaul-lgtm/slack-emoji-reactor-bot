// ═══════════════════════════════════════════════════════════
//  🔨 MODULE WEB — Salle des ventes : enchères de cartes (v4.2)
//
//  Même jeton que la ville (src/villeToken.js) : t = <userId>.<hmac>
//    GET  /salle?t=             → la page (public/salle.html|css|js)
//    GET  /api/salle?t=         → état (1 interrogation par seconde et par joueur, sinon 429)
//    POST /api/salle/bid?t=     → { tradeId, jp } → { ok:true, …état } | { ok:false, error, text }
//    POST /api/salle/sell?t=    → { code, startPrice|null } → { ok:true, tradeId, endsAt, …état }
//                                 | { ok:false, error, text }
//
//  Règles : celles de Slack (src/trades.js), refus avec le texte exact des
//  modales (tradesSlack.auctionErrorText / bidErrorText). Les effets Slack
//  (DM d'annonce, DM « dépassé », Accueils) passent par hooks.onAuctionCreated
//  et hooks.onBid (app.js → tradesSlack.afterAuctionCreated / afterBid),
//  appelés une fois, après la réponse, sans jamais bloquer ni lever.
//  ctx = { publicUrl, getSecret, send, sendJson, servePage, readJson,
//          userProfile, client, logger, hooks, buildUrls }
// ═══════════════════════════════════════════════════════════

const villeToken = require('./villeToken');
const trades = require('./trades');
// Chargé à la demande : tradesSlack lit trades au chargement, et web.js (donc ce module)
// peut être requis pendant que trades.js se charge encore (dépendance circulaire).
const tradesSlack = new Proxy({}, { get: (_, key) => require('./tradesSlack')[key] });
const cardIndex = require('./cardIndex');
const credits = require('./credits');
const broadcast = require('./broadcast');
const weekend = require('./weekend');
const { cardImageUrl, cardThumbUrl } = require('./cardImages');

let ctx = null;

function configure(context) {
  ctx = context;
}

const POLL_MIN_MS = 1000;      // comme la Boutique : 1 interrogation par seconde
const lastPoll = new Map();    // userId → ms de la dernière interrogation servie
const lastPost = new Map();    // userId → ms de la dernière mise en vente RÉUSSIE
const SELL_MIN_MS = 5000;
const RECENT_MAX = 10;

// ─────────────────────────────────────────────
// 🧩 Petites aides
// ─────────────────────────────────────────────

const plain = (text) => String(text || '').replace(/\*/g, '');
const avatarPath = (userId, query) => `api/ville/avatar/${encodeURIComponent(userId)}?${query}`;
const bestOf = (trade) => (trade.bids && trade.bids.length ? trade.bids[trade.bids.length - 1] : null);

/** Profils Slack (nom, photo ?) des joueurs `ids`, sans jamais échouer. → Map userId → { name, hasAvatar } */
async function profiles(ids) {
  const out = new Map();
  await Promise.all([...new Set(ids)].filter(Boolean).map(async (userId) => {
    try {
      const p = await ctx.userProfile(ctx.client, userId, ctx.logger);
      out.set(userId, { name: (p && p.name) || 'Joueur', hasAvatar: Boolean(p && p.avatar) });
    } catch {
      out.set(userId, { name: 'Joueur', hasAvatar: false });
    }
  }));
  return out;
}

/**
 * Type de la carte (image, vidéo…) : stocké dans l'échange, sinon repris de l'index.
 * `types` = table url → type construite UNE fois par état (cardIndex.listCards) :
 * pas de relecture de collections.json pour chaque carte affichée.
 */
function typeOf(card, types) {
  if (card.type) return card.type;
  return types.get(card.url) || 'image';
}

const publicCard = (card, types, image) => ({
  code: card.code,
  title: card.title,
  rarity: card.rarity,
  image: image({ url: card.url, type: typeOf(card, types) }) || null,
});

/** Texte prêt à afficher si ce joueur ne peut rien faire, sinon null (mêmes textes que Slack). */
function blockedText(userId, now) {
  if (!trades.blockReason(userId, now)) return null;
  return tradesSlack.errorFor('blocked_buyer', userId, { asBuyer: true, now });
}

// ─────────────────────────────────────────────
// 📦 État vu par la page
// ─────────────────────────────────────────────

async function state(userId, now = Date.now()) {
  const all = Object.values(trades._load().trades).filter((t) => t && t.kind === 'auction');
  const open = all.filter((t) => t.status === 'open').sort((a, b) => (a.endsAt || 0) - (b.endsAt || 0));
  const recent = all.filter((t) => t.status === 'done' && t.reason === 'sold')
    .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0))
    .slice(0, RECENT_MAX);

  const ids = [];
  for (const t of open) { ids.push(t.seller); const b = bestOf(t); if (b) ids.push(b.userId); }
  for (const t of recent) { ids.push(t.seller); ids.push(t.buyer || (bestOf(t) || {}).userId); }
  const who = await profiles(ids);
  const types = new Map(cardIndex.listCards().map((c) => [c.url, c.type]));
  const query = villeToken.query(userId);
  const nameOf = (id) => (who.get(id) || { name: 'Joueur' }).name;

  const auctions = open.map((t) => {
    const best = bestOf(t);
    const seller = who.get(t.seller) || { name: 'Joueur', hasAvatar: false };
    return {
      id: t.id,
      card: publicCard(t.card, types, cardImageUrl),
      seller: { userId: t.seller, name: seller.name, avatar: seller.hasAvatar ? avatarPath(t.seller, query) : null },
      startPrice: t.startPrice,
      best: best ? { userId: best.userId, name: nameOf(best.userId), jp: best.jp } : null,
      minBid: trades.minBid(t),
      endsAt: t.endsAt,
      mine: t.seller === userId,
      leading: Boolean(best && best.userId === userId),
    };
  });

  // Mes cartes cessibles : même source que la modale Slack (tradesSlack.buildAuctionModal)
  const free = trades.cessible(userId);
  const sellable = cardIndex.listCardsFor(userId).filter((c) => free.has(c.url)).map((c) => ({
    ...publicCard(c, types, cardThumbUrl),
    floor: trades.floor(c.rarity),
    count: free.get(c.url),
  }));

  const pause = weekend.pauseFor(userId, now);
  return {
    ok: true,
    serverTime: now,
    me: { userId, balance: credits.getBalance(userId), subscribed: broadcast.isSubscribed(userId) },
    pause: pause ? { title: plain(pause.title) } : null,
    blocked: blockedText(userId, now),
    auctions,
    sellable,
    recent: recent.map((t) => {
      const best = bestOf(t);
      return {
        card: publicCard(t.card, types, cardThumbUrl),
        seller: { name: nameOf(t.seller) },
        winner: { name: nameOf(t.buyer || (best && best.userId)) },
        jp: best ? best.jp : 0,
        at: t.closedAt,
      };
    }),
  };
}

// ─────────────────────────────────────────────
// 🔨 Enchérir, mettre en vente (même ordre de contrôles que les modales Slack)
// ─────────────────────────────────────────────

/** Appelle un hook une fois, sans attendre ni lever. */
function notify(name, ...args) {
  const hook = ctx.hooks && ctx.hooks[name];
  if (!hook) return;
  Promise.resolve()
    .then(() => hook(...args))
    .catch((e) => ctx.logger.error(`[salle] ${name}:`, e && e.message));
}

/** État renvoyé après une action réussie ; s'il ne peut pas être construit, { ok:true } seul (la page recharge). */
async function stateAfterAction(userId, now) {
  try {
    return await state(userId, now);
  } catch (e) {
    ctx.logger.error('[salle] état après action :', e && e.message);
    return { ok: true };
  }
}

const refuse = (res, error, text) => ctx.sendJson(res, 200, { ok: false, error, text });

async function handleBid(req, res, userId) {
  const body = await ctx.readJson(req);
  const now = Date.now();
  if (weekend.pauseFor(userId, now)) return refuse(res, 'pause', tradesSlack.bidErrorText({ error: 'pause' }, userId, now));
  const raw = body.jp;
  if (raw == null || String(raw).trim() === '') return refuse(res, 'no_amount', tradesSlack.bidErrorText({ error: 'no_amount' }, userId, now));

  const result = trades.bid(String(body.tradeId || ''), userId, Number(raw), now);   // synchrone
  if (!result.ok) {
    ctx.logger.info(`🔨 Salle web : enchère refusée (${result.error}) : <@${userId}> ${body.tradeId}`);
    return refuse(res, result.error, tradesSlack.bidErrorText(result, userId, now));
  }
  ctx.logger.info(`🔨 Salle web : <@${userId}> enchérit ${bestOf(result.trade).jp} JP$ sur ${result.trade.id}`);
  notify('onBid', result, userId);   // l'enchère est faite : DM et Accueils quoi qu'il arrive ensuite
  ctx.sendJson(res, 200, await stateAfterAction(userId, now));
  return undefined;
}

async function handleSell(req, res, userId) {
  const body = await ctx.readJson(req);
  const now = Date.now();
  const fail = (r, card = null) => refuse(res, r.error, tradesSlack.auctionErrorText(r, card, userId, now));
  if (weekend.pauseFor(userId, now)) return fail({ error: 'pause' });
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!code) return fail({ error: 'no_card' });
  const card = cardIndex.byCode(code, userId);
  if (!card) return fail({ error: 'bad_code', code });
  const raw = body.startPrice;
  const price = raw == null || String(raw).trim() === '' ? null : Number(raw);
  if (price != null && !Number.isInteger(price)) return fail({ error: 'bad_amount' });

  const result = trades.createAuction({ seller: userId, code: card.code, startPrice: price, now });   // synchrone
  if (!result.ok) {
    ctx.logger.info(`🔨 Salle web : mise en vente refusée (${result.error}) : <@${userId}> ${card.code}`);
    return fail(result, card);
  }
  ctx.logger.info(`🔨 Salle web : <@${userId}> met ${card.code} aux enchères à ${result.trade.startPrice} JP$ → ${result.trade.id}`);
  lastPost.set(userId, Date.now());
  notify('onAuctionCreated', result);   // la vente est créée : annonces quoi qu'il arrive ensuite
  ctx.sendJson(res, 200, { ...(await stateAfterAction(userId, now)), tradeId: result.trade.id, endsAt: result.trade.endsAt });
  return undefined;
}

// ─────────────────────────────────────────────
// 🚦 Routage
// ─────────────────────────────────────────────

/** → true si la requête a été traitée ici. */
async function route(req, res, url) {
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/salle') {
    ctx.servePage(res, 'salle', ['salle.css', 'salle.js']);
    return true;
  }
  if (pathname !== '/api/salle' && !pathname.startsWith('/api/salle/')) return false;

  const userId = villeToken.read(url.searchParams.get('t'));
  if (!userId) { ctx.sendJson(res, 403, { ok: false, reason: 'invalid' }); return true; }

  if (pathname === '/api/salle') {
    if (req.method !== 'GET') { ctx.send(res, 405, 'Method not allowed', { Allow: 'GET' }); return true; }
    const now = Date.now();
    if (now - (lastPoll.get(userId) || -Infinity) < POLL_MIN_MS) {
      ctx.sendJson(res, 429, { ok: false, reason: 'slow_down' });
      return true;
    }
    lastPoll.set(userId, now);
    ctx.sendJson(res, 200, await state(userId, now));
    return true;
  }

  if (pathname === '/api/salle/bid' || pathname === '/api/salle/sell') {
    if (req.method !== 'POST') { ctx.send(res, 405, 'Method not allowed', { Allow: 'POST' }); return true; }
    // Mise en vente : une toutes les 5 s au plus par joueur (chacune envoie un DM à tous les inscrits)
    if (pathname === '/api/salle/sell' && Date.now() - (lastPost.get(userId) || -Infinity) < SELL_MIN_MS) {
      ctx.sendJson(res, 429, { ok: false, reason: 'slow_down', text: 'Doucement ! Attends quelques secondes avant de remettre une carte en vente.' });
      return true;
    }
    await (pathname === '/api/salle/bid' ? handleBid : handleSell)(req, res, userId);
    return true;
  }

  ctx.sendJson(res, 404, { ok: false, reason: 'not_found' });
  return true;
}

module.exports = { configure, route, state, _ctx: () => ctx };
