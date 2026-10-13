// ═══════════════════════════════════════════════════════════
//  🎟️ MODULE WEB — Kiosque des tickets à gratter « ESSAI ! »
//
//  Lien personnel signé (comme « Mon deck ») : t = <userId>.<hmac>
//    GET  /tickets?t=                    → la page
//    GET  /api/tickets?t=                → état (solde, prix, compteur, ticket en cours)
//    POST /api/tickets/buy?t=            → achète un ticket (lot tiré et versé)
//    POST /api/tickets/<id>/scratched?t= → grattage fini → le lot à montrer
//
//  Le lot n'est envoyé à la page qu'une fois le ticket gratté.
// ═══════════════════════════════════════════════════════════

const crypto = require('crypto');
const scratch = require('./scratch');
const scratchTickets = require('./scratchTickets');
const settings = require('./settings');
const credits = require('./credits');
const farm = require('./farm');
const { cardImageUrl } = require('./cardImages');

let ctx = null;   // { publicUrl, getSecret, send, sendJson, servePage, logger, onChange }

function configure(context) {
  ctx = context;
}

const hmac = (msg) => crypto.createHmac('sha256', ctx.getSecret()).update(msg).digest('hex');
const ticketsMsg = (userId) => `tickets|${userId}`;

/** → userId si le jeton est valide, sinon null. */
function readToken(token) {
  const m = /^([A-Z0-9_-]+)\.([a-f0-9]{64})$/i.exec(token || '');
  if (!m) return null;
  const expected = Buffer.from(hmac(ticketsMsg(m[1])), 'hex');
  const given = Buffer.from(m[2], 'hex');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? m[1] : null;
}

/** Lien personnel du Kiosque (null si la page web est désactivée). */
function buildTicketsUrl(userId) {
  if (!ctx || !ctx.publicUrl) return null;
  return `${ctx.publicUrl}/tickets?t=${encodeURIComponent(`${userId}.${hmac(ticketsMsg(userId))}`)}`;
}

// ─────────────────────────────────────────────
// 📦 Réponses
// ─────────────────────────────────────────────

/** Ticket vu par la page : grille + prix ; le lot seulement une fois gratté. */
function publicTicket(ticket) {
  if (!ticket) return null;
  const out = { id: ticket.id, price: ticket.price, grid: ticket.grid, score: ticket.score || null, scratched: Boolean(ticket.scratchedAt) };
  if (ticket.scratchedAt) out.result = publicResult(ticket);
  return out;
}

function publicResult(ticket) {
  const { kind, symbol, amount } = ticket.outcome;
  const result = { kind, symbol, amount };
  if (ticket.card) {
    result.card = { title: ticket.card.title, rarity: ticket.card.rarity, image: cardImageUrl(ticket.card), count: ticket.count || 1 };
  }
  return result;
}

function state(userId, now = Date.now()) {
  const price = settings.getTicketPrice();
  return {
    ok: true,
    balance: credits.getBalance(userId),
    price,
    limit: settings.getTicketDailyLimit(),
    boughtToday: scratchTickets.boughtToday(userId, now),
    block: scratchTickets.purchaseBlock(userId, now),
    penaltyMs: farm.getPenaltyRemaining(userId, now),
    symbols: scratch.SYMBOLS,
    prizes: scratch.prizeTable(price).map(({ symbol, kind, amount }) => ({ symbol, kind, amount: amount || 0 })),
    ticket: publicTicket(scratchTickets.pendingTicket(userId)),
  };
}

function notify(userId) {
  if (!ctx.onChange) return;
  Promise.resolve()
    .then(() => ctx.onChange(userId))
    .catch((e) => ctx.logger.error('[tickets] onChange:', e.message));
}

// ─────────────────────────────────────────────
// 🚦 Routage
// ─────────────────────────────────────────────

async function route(req, res, url) {
  const { pathname } = url;
  let m;

  if (req.method === 'GET' && pathname === '/tickets') {
    ctx.servePage(res, 'tickets');
    return true;
  }
  if (pathname !== '/api/tickets' && !pathname.startsWith('/api/tickets/')) return false;

  const userId = readToken(url.searchParams.get('t'));
  if (!userId) { ctx.sendJson(res, 403, { ok: false, reason: 'invalid' }); return true; }

  if (pathname === '/api/tickets') {
    if (req.method !== 'GET') { ctx.send(res, 405, 'Method not allowed', { Allow: 'GET' }); return true; }
    ctx.sendJson(res, 200, state(userId));
    return true;
  }

  if (req.method !== 'POST') { ctx.send(res, 405, 'Method not allowed', { Allow: 'POST' }); return true; }

  if (pathname === '/api/tickets/buy') {
    const result = scratchTickets.buy(userId);
    if (result.status === 'bought') {
      const t = result.ticket;
      ctx.logger.info(`🎟️ <@${userId}> achète un ticket (${t.price} JP$) → ${t.outcome.kind}${t.outcome.amount ? ` ${t.outcome.amount} JP$` : ''}${t.card ? ` ${t.card.title}` : ''}`);
      notify(userId);
    }
    ctx.sendJson(res, 200, { ...state(userId), bought: result.status === 'bought', reason: result.reason || null });
    return true;
  }

  if ((m = /^\/api\/tickets\/([\w-]+)\/scratched$/.exec(pathname))) {
    const result = scratchTickets.markScratched(m[1], userId);
    if (result.status === 'not_found' || result.status === 'forbidden') {
      ctx.sendJson(res, 404, { ok: false, reason: result.status });
      return true;
    }
    ctx.sendJson(res, 200, { ...state(userId), result: publicResult(result.ticket) });
    return true;
  }

  ctx.sendJson(res, 404, { ok: false, reason: 'not_found' });
  return true;
}

module.exports = { configure, route, buildTicketsUrl, readToken };
