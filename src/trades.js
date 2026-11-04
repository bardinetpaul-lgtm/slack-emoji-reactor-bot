// ═══════════════════════════════════════════════════════════
//  🤝 MODULE ÉCHANGES DE CARTES (v3.9)
//  Des cartes contre des JP$, ou des cartes contre des cartes :
//    • demande à une personne (cette section) ;
//    • demande générale + contre-offres, enchères, minuterie :
//      sections ajoutées plus bas.
//
//  Mise en réserve :
//    • JP$ de l'acheteur : retirés à l'envoi (source 'trade_hold'),
//      rendus au refus / à l'expiration / à l'annulation ('trade_refund'),
//      versés au vendeur à la vente ('trade_sale') ;
//    • cartes proposées par l'acheteur, et carte d'une enchère :
//      réservées tant que l'échange est ouvert (voir reservedCounts).
//  La carte du vendeur d'une demande n'est pas réservée : on revérifie
//  au moment où il accepte.
//
//  Cessible = exemplaires − ceux des decks d'Arène − ceux réservés.
//  Le dernier exemplaire EST cessible (décision de Paul).
//
//  Chaque fonction qui modifie l'état est SYNCHRONE (aucun await entre
//  la lecture et l'écriture) : deux clics ne concluent jamais deux fois.
//
//  DB = data/trades.json
//  { seq, trades: { [id]: { id, kind, buyer, seller, card: { url, title, rarity, code },
//    offer: { jp, cards: [url] }, held: { [userId]: jp }, status, createdAt, expiresAt,
//    counters: {}, bids: [], dms: {}, closedAt, reason } } }
//  status : 'open' | 'done' | 'refused' | 'expired' | 'cancelled'
// ═══════════════════════════════════════════════════════════

const path = require('path');
const { readJson, writeJsonAtomic } = require('./storage');
const cardIndex = require('./cardIndex');
const resale = require('./resale');
const credits = require('./credits');
const collections = require('./collections');
const broadcast = require('./broadcast');
const weekend = require('./weekend');
const raid = require('./raid');
const farm = require('./farm');

const TRADES_PATH = path.join(__dirname, '..', 'data', 'trades.json');
const REQUEST_MS = 3600000;     // 1 h : demande, contre-offre
const AUCTION_MS = 43200000;    // 12 h : enchère

// ─────────────────────────────────────────────
// 🧰 Outils communs (exportés avec « _ » pour les autres sections)
// ─────────────────────────────────────────────

function _load() {
  const data = readJson(TRADES_PATH, { seq: 0, trades: {} });
  if (!data || typeof data !== 'object' || !data.trades || typeof data.trades !== 'object') return { seq: 0, trades: {} };
  if (!Number.isInteger(data.seq)) data.seq = 0;
  return data;
}
const _save = (data) => writeJsonAtomic(TRADES_PATH, data);

/** Nouvel identifiant (incrémente data.seq). */
function _nextId(data, now = Date.now()) {
  data.seq = (data.seq || 0) + 1;
  return `T${data.seq}-${now.toString(36)}`;
}

/** Met des JP$ en réserve. false si le solde ne suffit pas. */
const _hold = (userId, amount, ref) => credits.spend(userId, amount, { source: 'trade_hold', ref });
const _refund = (userId, amount, ref) => credits.addCredit(userId, amount, { source: 'trade_refund', ref });
const _pay = (userId, amount, ref) => credits.addCredit(userId, amount, { source: 'trade_sale', ref });

/**
 * Déplace un exemplaire de `card` ({ url, title?, rarity?, type? }) de `from` à `to`.
 * Les champs manquants sont repris du classeur de `from`. false si `from` ne l'a pas.
 */
function _transferCard(from, to, card) {
  const owned = collections.getCollection(from).find((c) => c.url === card.url);
  if (!owned || owned.count < 1) return false;
  collections.removeCards(from, [card.url]);
  collections.addCards(to, [{
    url: card.url,
    title: card.title || owned.title,
    rarity: card.rarity || owned.rarity,
    type: card.type || owned.type || 'image',
  }]);
  return true;
}

/** Ferme un échange (sans l'écrire) et rend tous les JP$ encore en réserve. */
function _close(trade, status, now = Date.now(), reason = null) {
  trade.status = status;
  trade.closedAt = now;
  trade.reason = reason;
  for (const [userId, amount] of Object.entries(trade.held || {})) {
    if (amount > 0) _refund(userId, amount, trade.id);
  }
  trade.held = {};
  return trade;
}

const isOpen = (t) => t && t.status === 'open';

/** Exemplaires de chaque carte réservés par les échanges ouverts de ce joueur. */
function reservedCounts(userId, data = _load()) {
  const reserved = new Map();
  const add = (url) => reserved.set(url, (reserved.get(url) || 0) + 1);
  for (const t of Object.values(data.trades)) {
    if (!isOpen(t)) continue;
    if (t.buyer === userId) for (const url of (t.offer && t.offer.cards) || []) add(url);
    if (t.kind === 'auction' && t.seller === userId && t.card) add(t.card.url);
  }
  return reserved;
}

/** Exemplaires cessibles : { url → n } (seulement n ≥ 1). Le dernier exemplaire compte. */
function cessible(userId, data = _load()) {
  const locked = resale.lockedByDecks(userId);
  const reserved = reservedCounts(userId, data);
  const out = new Map();
  for (const c of collections.getCollection(userId)) {
    const n = c.count - (locked.get(c.url) || 0) - (reserved.get(c.url) || 0);
    if (n > 0) out.set(c.url, n);
  }
  return out;
}

/** Exemplaires cessibles d'une carte. */
const _cessibleCount = (userId, url, data = _load()) => cessible(userId, data).get(url) || 0;

/** Prix plancher (offre en JP$ seulement) pour une carte de cette rareté. */
const floor = (rarity) => Math.max(1, resale.PRICES[rarity] ?? 1);

/** Pourquoi ce joueur ne peut pas échanger maintenant, ou null. */
function blockReason(userId, now = Date.now()) {
  if (!broadcast.isSubscribed(userId)) return 'not_subscribed';
  if (weekend.pauseFor(userId, now)) return 'pause';
  if (raid.raidsAgainst(userId).length) return 'raid';
  if (farm.getPenaltyRemaining(userId, now) > 0) return 'farm';
  return null;
}

/** Les cartes `urls` (répétitions = plusieurs exemplaires) sont-elles toutes cessibles ? */
function cardsAvailable(userId, urls, data) {
  const free = cessible(userId, data);
  const wanted = new Map();
  for (const url of urls) wanted.set(url, (wanted.get(url) || 0) + 1);
  return [...wanted].every(([url, n]) => (free.get(url) || 0) >= n);
}

function getTrade(id) {
  return _load().trades[id] || null;
}

/** Échanges ouverts où ce joueur est acheteur, vendeur ou enchérisseur. */
function openTradesOf(userId) {
  return Object.values(_load().trades).filter((t) => isOpen(t)
    && (t.buyer === userId || t.seller === userId || (t.bids || []).some((b) => b.userId === userId)));
}

// ═══════════════════════════════════════════════════════════
//  1. DEMANDE À UNE PERSONNE (kind 'direct')
// ═══════════════════════════════════════════════════════════

/**
 * L'acheteur demande un exemplaire de la carte `code` au vendeur.
 * → { ok: true, trade } | { ok: false, error: 'self' | 'blocked_buyer' | 'blocked_seller'
 *   | 'unavailable' | 'bad_amount' | 'empty' | 'cards_unavailable' | 'floor' | 'balance' }
 * `jp` : entier ≥ 0 (0 seulement si des cartes sont proposées).
 */
function createDirect({ buyer, seller, code, jp = 0, cards = [], now = Date.now() }) {
  if (!buyer || buyer === seller) return { ok: false, error: 'self' };
  if (blockReason(buyer, now)) return { ok: false, error: 'blocked_buyer' };
  if (!seller || blockReason(seller, now)) return { ok: false, error: 'blocked_seller' };

  const data = _load();
  const card = cardIndex.byCode(code);
  if (!card || _cessibleCount(seller, card.url, data) < 1) return { ok: false, error: 'unavailable' };

  const amount = jp == null ? 0 : jp;
  if (!Number.isInteger(amount) || amount < 0) return { ok: false, error: 'bad_amount' };
  const offered = (Array.isArray(cards) ? cards : []).filter(Boolean);
  if (!amount && !offered.length) return { ok: false, error: 'empty' };
  if (offered.length && !cardsAvailable(buyer, offered, data)) return { ok: false, error: 'cards_unavailable' };
  if (!offered.length && amount < floor(card.rarity)) return { ok: false, error: 'floor' };

  const id = _nextId(data, now);
  if (amount && !_hold(buyer, amount, id)) return { ok: false, error: 'balance' };

  const trade = {
    id,
    kind: 'direct',
    buyer,
    seller,
    card: { url: card.url, title: card.title, rarity: card.rarity, code: card.code },
    offer: { jp: amount, cards: offered },
    held: amount ? { [buyer]: amount } : {},
    status: 'open',
    createdAt: now,
    expiresAt: now + REQUEST_MS,
    counters: {},
    bids: [],
    dms: {},
    closedAt: null,
    reason: null,
  };
  data.trades[id] = trade;
  _save(data);
  return { ok: true, trade };
}

/**
 * Contrôles communs à accepter / refuser. → { data, trade } | { error }
 * Délai dépassé : 'expired', sans rien bouger (la minuterie fermera l'échange).
 */
function sellerAction(tradeId, sellerId, now) {
  const data = _load();
  const trade = data.trades[tradeId];
  if (!trade) return { error: 'not_found' };
  if (trade.status !== 'open') return { error: 'closed' };
  if (now >= trade.expiresAt) return { error: 'expired' };
  if (trade.seller !== sellerId) return { error: 'not_seller' };
  return { data, trade };
}

/**
 * Le vendeur accepte : sa carte part chez l'acheteur, les cartes et JP$ proposés chez lui.
 * Si sa carte ou celles de l'acheteur ne sont plus là : échange annulé, JP$ rendus.
 * → { ok: true, trade } | { ok: false, error: 'not_found' | 'closed' | 'expired' | 'not_seller'
 *   | 'blocked_seller' | 'blocked_buyer' | 'unavailable' | 'cards_unavailable', trade? }
 */
function accept(tradeId, sellerId, now = Date.now()) {
  const { data, trade, error } = sellerAction(tradeId, sellerId, now);
  if (error) return { ok: false, error };
  if (blockReason(sellerId, now)) return { ok: false, error: 'blocked_seller', trade };
  if (blockReason(trade.buyer, now)) return { ok: false, error: 'blocked_buyer', trade };

  const fail = (err) => {
    _close(trade, 'cancelled', now, err);
    _save(data);
    return { ok: false, error: err, trade };
  };
  if (_cessibleCount(sellerId, trade.card.url, data) < 1) return fail('unavailable');
  // Cartes de l'acheteur : réservées par CET échange, donc on l'écarte du calcul
  const others = { ...data, trades: { ...data.trades } };
  delete others.trades[trade.id];
  if (!cardsAvailable(trade.buyer, trade.offer.cards, others)) return fail('cards_unavailable');

  _transferCard(sellerId, trade.buyer, trade.card);
  for (const url of trade.offer.cards) _transferCard(trade.buyer, sellerId, { url });
  const paid = (trade.held && trade.held[trade.buyer]) || 0;
  if (paid > 0) _pay(sellerId, paid, trade.id);
  trade.held = {};
  _close(trade, 'done', now, 'accepted');
  _save(data);
  return { ok: true, trade };
}

/** Le vendeur refuse : l'acheteur est remboursé. → { ok, trade } | { ok: false, error } */
function refuse(tradeId, sellerId, now = Date.now()) {
  const { data, trade, error } = sellerAction(tradeId, sellerId, now);
  if (error) return { ok: false, error };
  _close(trade, 'refused', now, 'refused');
  _save(data);
  return { ok: true, trade };
}

module.exports = {
  TRADES_PATH,
  REQUEST_MS,
  AUCTION_MS,
  floor,
  blockReason,
  reservedCounts,
  cessible,
  createDirect,
  accept,
  refuse,
  getTrade,
  openTradesOf,
  _load,
  _save,
  _nextId,
  _hold,
  _refund,
  _pay,
  _transferCard,
  _close,
  _cessibleCount,
};

// ═══════════════════════════════════════════════════════════
//  3. ENCHÈRES (kind 'auction')
//  Le vendeur met un exemplaire aux enchères pour 12 h (JP$ seulement).
//  Sa carte est réservée pendant toute l'enchère (reservedCounts).
//  Seul le meilleur enchérisseur a des JP$ en réserve (held) : dépassé,
//  il est remboursé tout de suite. À la fin, le vendeur est payé avec
//  la réserve du gagnant. Sans enchère, la carte reste au vendeur.
//  Fin entre 20 h et 9 h (Paris) → repoussée au 10 h suivant.
//  Pas de lancement si la fin tombe pendant une pause ; un vendeur en
//  congés n'arrête pas son enchère, un enchérisseur en congés ne peut
//  pas enchérir (blockReason).
// ═══════════════════════════════════════════════════════════

const { parisDay, parisMinutes } = require('./octobreRose');

const NIGHT_FROM = 20 * 60;   // 20h00
const NIGHT_TO = 9 * 60;      // 9h00
const MORNING = 10 * 60;      // 10h00

/** Instant (ms) du jour `day` (« AAAA-MM-JJ ») à `minutes` après minuit, heure de Paris. */
function parisTime(day, minutes) {
  let t = Date.parse(`${day}T00:00:00Z`) + minutes * 60000;
  // Corrige le décalage horaire de Paris (UTC+1 / UTC+2), sur ±12 h
  let diff = (parisMinutes(t) - minutes + 1440) % 1440;
  if (diff > 720) diff -= 1440;
  t -= diff * 60000;
  return t;
}

/** Fin d'une enchère lancée à `start` : +12 h, ou le 10 h suivant si elle tombe la nuit. */
function auctionEnd(start) {
  const end = start + AUCTION_MS;
  const m = parisMinutes(end);
  if (m >= NIGHT_TO && m < NIGHT_FROM) return end;
  let day = parisDay(end);
  if (m >= NIGHT_FROM) day = parisDay(Date.parse(`${day}T12:00:00Z`) + 24 * 3600000);
  return parisTime(day, MORNING);
}

/**
 * Le vendeur met aux enchères un exemplaire de la carte `code`.
 * startPrice : entier ≥ plancher de la rareté (par défaut : le plancher).
 * → { ok: true, trade, recipients: [userId] } (inscrits sauf le vendeur)
 *   | { ok: false, error: 'blocked_seller' | 'ends_in_pause' | 'unavailable' | 'floor' }
 */
function createAuction({ seller, code, startPrice, now = Date.now() }) {
  if (!seller || blockReason(seller, now)) return { ok: false, error: 'blocked_seller' };
  const endsAt = auctionEnd(now);
  if (weekend.isPausedDay(parisDay(endsAt))) return { ok: false, error: 'ends_in_pause' };

  const data = _load();
  const card = cardIndex.byCode(code);
  if (!card || _cessibleCount(seller, card.url, data) < 1) return { ok: false, error: 'unavailable' };
  const price = startPrice == null ? floor(card.rarity) : Number(startPrice);
  if (!Number.isInteger(price) || price < floor(card.rarity)) return { ok: false, error: 'floor' };

  const id = _nextId(data, now);
  const trade = {
    id,
    kind: 'auction',
    buyer: null,
    seller,
    card: { url: card.url, title: card.title, rarity: card.rarity, code: card.code },
    offer: { jp: 0, cards: [] },
    startPrice: price,
    held: {},
    status: 'open',
    createdAt: now,
    expiresAt: null,
    endsAt,
    counters: {},
    bids: [],
    dms: {},
    closedAt: null,
    reason: null,
  };
  data.trades[id] = trade;
  _save(data);
  const recipients = broadcast.getSubscribers().filter((u) => u !== seller);
  return { ok: true, trade, recipients };
}

/** Meilleure enchère { userId, jp, at } ou null. */
const bestBid = (trade) => (trade.bids && trade.bids.length ? trade.bids[trade.bids.length - 1] : null);

/** Montant minimum de la prochaine enchère. */
const minBid = (trade) => {
  const best = bestBid(trade);
  return best ? best.jp + 1 : trade.startPrice;
};

/**
 * `userId` enchérit `jp` JP$ (mis en réserve) ; le précédent meilleur est remboursé.
 * → { ok: true, trade, outbid: userId | null }
 *   | { ok: false, error: 'not_found' | 'closed' | 'ended' | 'self' | 'blocked'
 *     | 'already_best' | 'too_low' | 'balance', trade? }
 */
function bid(tradeId, userId, jp, now = Date.now()) {
  const data = _load();
  const trade = data.trades[tradeId];
  if (!trade || trade.kind !== 'auction') return { ok: false, error: 'not_found' };
  if (trade.status !== 'open') return { ok: false, error: 'closed', trade };
  if (now >= trade.endsAt) return { ok: false, error: 'ended', trade };
  if (userId === trade.seller) return { ok: false, error: 'self', trade };
  if (blockReason(userId, now)) return { ok: false, error: 'blocked', trade };
  const best = bestBid(trade);
  if (best && best.userId === userId) return { ok: false, error: 'already_best', trade };
  const amount = Number(jp);
  if (!Number.isInteger(amount) || amount < minBid(trade)) return { ok: false, error: 'too_low', trade };
  if (!_hold(userId, amount, trade.id)) return { ok: false, error: 'balance', trade };

  let outbid = null;
  if (best) {
    outbid = best.userId;
    const back = (trade.held && trade.held[outbid]) || 0;
    if (back > 0) _refund(outbid, back, trade.id);
  }
  trade.held = { [userId]: amount };
  trade.bids.push({ userId, jp: amount, at: now });
  _save(data);
  return { ok: true, trade, outbid };
}

/**
 * Règle une enchère terminée. Ne fait rien avant `endsAt` ni pendant une pause générale.
 * → { ok: true, trade, outcome: 'sold' | 'no_bid' | 'cancelled' }
 *   | { ok: false, error: 'not_found' | 'closed' | 'not_ended' | 'paused' }
 * 'cancelled' : la carte n'est plus chez le vendeur, le gagnant est remboursé.
 */
function settleAuction(tradeId, now = Date.now()) {
  const data = _load();
  const trade = data.trades[tradeId];
  if (!trade || trade.kind !== 'auction') return { ok: false, error: 'not_found' };
  if (trade.status !== 'open') return { ok: false, error: 'closed' };
  if (now < trade.endsAt) return { ok: false, error: 'not_ended' };
  if (weekend.isPaused(now)) return { ok: false, error: 'paused' };

  // Carte du vendeur : réservée par CETTE enchère, donc on l'écarte du calcul
  const others = { ...data, trades: { ...data.trades } };
  delete others.trades[trade.id];
  const best = bestBid(trade);
  let outcome;
  if (_cessibleCount(trade.seller, trade.card.url, others) < 1) {
    _close(trade, 'cancelled', now, 'unavailable');
    outcome = 'cancelled';
  } else if (!best) {
    _close(trade, 'expired', now, 'no_bid');
    outcome = 'no_bid';
  } else {
    _transferCard(trade.seller, best.userId, trade.card);
    const paid = (trade.held && trade.held[best.userId]) || 0;
    if (paid > 0) _pay(trade.seller, paid, trade.id);
    trade.held = {};
    trade.buyer = best.userId;
    _close(trade, 'done', now, 'sold');
    outcome = 'sold';
  }
  _save(data);
  return { ok: true, trade, outcome };
}

module.exports.auctionEnd = auctionEnd;
module.exports.createAuction = createAuction;
module.exports.bid = bid;
module.exports.settleAuction = settleAuction;
module.exports.minBid = minBid;
