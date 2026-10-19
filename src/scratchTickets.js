// ═══════════════════════════════════════════════════════════
//  🎟️ MODULE TICKETS À GRATTER (achat + persistance)
//
//  buy() et markScratched() sont ENTIÈREMENT SYNCHRONES (aucun await) :
//  Node étant mono-thread, deux clics simultanés (double-clic, 2 onglets)
//  ne peuvent pas s'entremêler.
//  Le lot (et la carte légendaire) est TIRÉ et enregistré à l'achat — le
//  grattage ne peut rien changer — mais VERSÉ seulement quand le ticket est
//  entièrement gratté (v3.1.1) : le solde, l'Accueil et le classeur ne
//  dévoilent plus le résultat avant le grattage. Ticket pas fini (onglet
//  fermé, redémarrage) → il attend, et bloque l'achat du suivant.
//
//  DB = data/scratch.json
//    { tickets: { <id>: { owner, price, createdAt, grid: [9 symboles], score: { us, them },
//        outcome: { kind, symbol, amount }, card?, count?, scratchedAt? } } }
// ═══════════════════════════════════════════════════════════

const path = require('path');
const { readJson, writeJsonAtomic } = require('./storage');
const scratch = require('./scratch');
const settings = require('./settings');
const credits = require('./credits');
const collections = require('./collections');
const events = require('./events');
const farm = require('./farm');
const weekend = require('./weekend');
const { drawCardOfRarity } = require('./media');
const { parisDay } = require('./octobreRose');

const SCRATCH_PATH = path.join(__dirname, '..', 'data', 'scratch.json');

function loadStore() {
  try {
    const data = readJson(SCRATCH_PATH, { tickets: {} });
    return data && typeof data.tickets === 'object' ? data : { tickets: {} };
  } catch {
    return { tickets: {} };
  }
}

function saveStore(data) {
  writeJsonAtomic(SCRATCH_PATH, data);
}

function generateId() {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Tickets achetés aujourd'hui (jour de Paris) par ce joueur. */
function boughtToday(userId, now = Date.now(), data = loadStore()) {
  const today = parisDay(now);
  return Object.values(data.tickets).filter((t) => t.owner === userId && parisDay(t.createdAt) === today).length;
}

/** Ticket acheté mais pas encore gratté ({ id, ...ticket } ou null). */
function pendingTicket(userId, data = loadStore()) {
  const entry = Object.entries(data.tickets).find(([, t]) => t.owner === userId && !t.scratchedAt);
  return entry ? { id: entry[0], ...entry[1] } : null;
}

/**
 * Raison pour laquelle ce joueur ne peut pas acheter maintenant, ou null :
 * 'penalty' | 'pending' | 'weekend' | 'limit' | 'balance'.
 * (🏖️ v3.3 : un ticket acheté avant samedi 0h peut encore être gratté.)
 */
function purchaseBlock(userId, now = Date.now(), data = loadStore()) {
  if (farm.getPenaltyRemaining(userId, now) > 0) return 'penalty';
  if (pendingTicket(userId, data)) return 'pending';
  if (weekend.isWeekend(now)) return 'weekend';
  if (boughtToday(userId, now, data) >= settings.getTicketDailyLimit()) return 'limit';
  if (credits.getBalance(userId) < settings.getTicketPrice()) return 'balance';
  return null;
}

/**
 * Achète un ticket : débit, tirage, ticket enregistré (lot pas encore versé).
 * @returns {{ status: 'bought', ticket } | { status: 'blocked', reason, ticket? }}
 */
function buy(userId, now = Date.now(), rand = Math.random) {
  const data = loadStore();
  const reason = purchaseBlock(userId, now, data);
  if (reason) return { status: 'blocked', reason, ticket: reason === 'pending' ? pendingTicket(userId, data) : null };

  const price = settings.getTicketPrice();
  const id = generateId();
  if (!credits.spend(userId, price, { source: 'scratch', item: 'ticket', ref: id })) {
    return { status: 'blocked', reason: 'balance' };
  }

  const outcome = scratch.drawOutcome(price, rand);
  const ticket = {
    owner: userId,
    price,
    createdAt: new Date(now).toISOString(),
    grid: scratch.buildGrid(outcome, rand),
    score: scratch.buildScore(outcome, rand),
    outcome,
  };

  // 🏆 La carte légendaire est choisie dès l'achat (ajoutée au classeur au grattage)
  if (outcome.kind === 'legendary') {
    const card = drawCardOfRarity('legendary');
    ticket.card = { url: card.url, title: card.title, rarity: card.rarity, type: card.type };
  }

  data.tickets[id] = ticket;
  try {
    saveStore(data);
  } catch (e) {
    console.error('[scratch] écriture:', e.message);
    credits.addCredit(userId, price, { source: 'scratch', item: 'refund', ref: id });   // ticket pas enregistré → remboursé
    return { status: 'blocked', reason: 'error' };
  }
  return { status: 'bought', ticket: { id, ...ticket } };
}

/**
 * Ticket entièrement gratté → le lot est versé (une seule fois).
 * Le ticket est marqué gratté et sauvegardé AVANT le versement : un échec
 * d'écriture ne peut jamais payer deux fois.
 * @returns {{ status: 'not_found'|'forbidden'|'scratched'|'already', ticket? }}
 */
function markScratched(id, userId, now = Date.now()) {
  const data = loadStore();
  const ticket = data.tickets[id];
  if (!ticket) return { status: 'not_found' };
  if (ticket.owner !== userId) return { status: 'forbidden' };
  if (ticket.scratchedAt) return { status: 'already', ticket: { id, ...ticket } };
  ticket.scratchedAt = new Date(now).toISOString();
  saveStore(data);

  // 💰 Versement du lot
  const { outcome } = ticket;
  if (outcome.kind === 'jp') {
    credits.addCredit(userId, outcome.amount, { source: 'scratch', item: 'win', ref: id });
  } else if (outcome.kind === 'legendary' && ticket.card) {
    [ticket.count] = collections.addCards(userId, [ticket.card]);
    try { saveStore(data); } catch (e) { console.error('[scratch] écriture:', e.message); }   // nb d'exemplaires (affichage)
  }
  events.record('scratch_ticket', userId, {
    ticketId: id,
    price: ticket.price,
    outcome: outcome.kind,
    symbol: outcome.symbol,
    amount: outcome.amount,
    card: ticket.card ? { url: ticket.card.url, title: ticket.card.title, rarity: ticket.card.rarity } : null,
  }, { at: ticket.scratchedAt, dedup: `scratch_ticket:${id}` });

  return { status: 'scratched', ticket: { id, ...ticket } };
}

module.exports = { buy, markScratched, pendingTicket, boughtToday, purchaseBlock, SCRATCH_PATH };
