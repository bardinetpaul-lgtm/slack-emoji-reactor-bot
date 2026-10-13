// ═══════════════════════════════════════════════════════════
//  🎟️ MODULE TICKETS À GRATTER (achat + persistance)
//
//  buy() et markScratched() sont ENTIÈREMENT SYNCHRONES (aucun await) :
//  Node étant mono-thread, deux clics simultanés (double-clic, 2 onglets)
//  ne peuvent pas s'entremêler. Le lot est tiré ET VERSÉ à l'achat :
//  fermer l'onglet ou redémarrer le bot avant la fin du grattage ne
//  fait rien perdre. Le grattage n'est qu'une révélation.
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
 * 'penalty' | 'pending' | 'limit' | 'balance'.
 */
function purchaseBlock(userId, now = Date.now(), data = loadStore()) {
  if (farm.getPenaltyRemaining(userId, now) > 0) return 'penalty';
  if (pendingTicket(userId, data)) return 'pending';
  if (boughtToday(userId, now, data) >= settings.getTicketDailyLimit()) return 'limit';
  if (credits.getBalance(userId) < settings.getTicketPrice()) return 'balance';
  return null;
}

/**
 * Achète un ticket : débit, tirage, lot versé, ticket enregistré.
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

  // 💰 Lot versé tout de suite (avant toute animation)
  if (outcome.kind === 'jp') {
    credits.addCredit(userId, outcome.amount, { source: 'scratch', item: 'win', ref: id });
  } else if (outcome.kind === 'legendary') {
    const card = drawCardOfRarity('legendary');
    ticket.card = { url: card.url, title: card.title, rarity: card.rarity, type: card.type };
    [ticket.count] = collections.addCards(userId, [card]);
  }

  data.tickets[id] = ticket;
  try {
    saveStore(data);
  } catch (e) {
    console.error('[scratch] écriture:', e.message);   // lot déjà versé : le ticket manquera juste à l'historique
  }
  events.record('scratch_ticket', userId, {
    ticketId: id,
    price,
    outcome: outcome.kind,
    symbol: outcome.symbol,
    amount: outcome.amount,
    card: ticket.card ? { url: ticket.card.url, title: ticket.card.title, rarity: ticket.card.rarity } : null,
  }, { dedup: `scratch_ticket:${id}` });

  return { status: 'bought', ticket: { id, ...ticket } };
}

/**
 * Marque un ticket comme gratté (une seule fois).
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
  return { status: 'scratched', ticket: { id, ...ticket } };
}

module.exports = { buy, markScratched, pendingTicket, boughtToday, purchaseBlock, SCRATCH_PATH };
