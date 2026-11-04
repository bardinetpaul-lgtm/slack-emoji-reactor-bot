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

/** Ferme un échange (sans l'écrire), rend tous les JP$ encore en réserve et annule les contre-offres ouvertes. */
function _close(trade, status, now = Date.now(), reason = null) {
  trade.status = status;
  trade.closedAt = now;
  trade.reason = reason;
  for (const [userId, amount] of Object.entries(trade.held || {})) {
    if (amount > 0) _refund(userId, amount, trade.id);
  }
  trade.held = {};
  for (const c of Object.values(trade.counters || {})) if (c.status === 'open') c.status = 'cancelled';
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

/** Montant en JP$ d'une offre : entier ≥ 0 (absent = 0), sinon null (→ 'bad_amount'). */
function _amount(jp) {
  const amount = jp == null ? 0 : jp;
  return Number.isInteger(amount) && amount >= 0 ? amount : null;
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

  const amount = _amount(jp);
  if (amount === null) return { ok: false, error: 'bad_amount' };
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
  const general = _load().trades[tradeId];
  if (general && general.kind === 'general') return acceptGeneral(tradeId, sellerId, now);
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

// ═══════════════════════════════════════════════════════════
//  2. DEMANDE GÉNÉRALE ET CONTRE-OFFRES (kind 'general')
//  Demande générale : l'offre part à tous les propriétaires inscrits
//  qui peuvent céder la carte ; le premier qui accepte conclut.
//  Contre-offre (demande générale ou à une personne) : une seule par
//  vendeur, elle REMPLACE ce que l'acheteur donne (JP$ et cartes).
//  Ses cartes ne sont pas réservées : revérifiées à l'acceptation.
//  Elle a son propre délai d'1 h ; celui de la demande ne bouge pas.
//  Toute clôture de l'échange annule les contre-offres encore ouvertes.
//  trade.counters[sellerId] = { jp, cards, at, expiresAt, status }
//  status : 'open' | 'accepted' | 'refused' | 'cancelled'
// ═══════════════════════════════════════════════════════════

/** Montant (null si invalide, voir _amount) et cartes d'une offre. → { amount, offered } */
function cleanOffer(jp, cards) {
  return { amount: _amount(jp), offered: (Array.isArray(cards) ? cards : []).filter(Boolean) };
}

/** Copie de l'état sans cet échange (ses cartes réservées redeviennent libres). */
function withoutTrade(data, tradeId) {
  const others = { ...data, trades: { ...data.trades } };
  delete others.trades[tradeId];
  return others;
}

/**
 * L'acheteur demande la carte `code` à tous ceux qui peuvent la céder.
 * → { ok: true, trade, recipients: [userId] } | { ok: false, error: 'blocked_buyer'
 *   | 'unavailable' | 'bad_amount' | 'empty' | 'cards_unavailable' | 'floor' | 'no_owner' | 'balance' }
 */
function createGeneral({ buyer, code, jp = 0, cards = [], now = Date.now() }) {
  if (!buyer || blockReason(buyer, now)) return { ok: false, error: 'blocked_buyer' };
  const data = _load();
  const card = cardIndex.byCode(code);
  if (!card) return { ok: false, error: 'unavailable' };

  const { amount, offered } = cleanOffer(jp, cards);
  if (amount === null) return { ok: false, error: 'bad_amount' };
  if (!amount && !offered.length) return { ok: false, error: 'empty' };
  if (offered.length && !cardsAvailable(buyer, offered, data)) return { ok: false, error: 'cards_unavailable' };
  if (!offered.length && amount < floor(card.rarity)) return { ok: false, error: 'floor' };

  const recipients = broadcast.getSubscribers().filter((u) => u !== buyer
    && !blockReason(u, now) && _cessibleCount(u, card.url, data) >= 1);
  if (!recipients.length) return { ok: false, error: 'no_owner' };

  const id = _nextId(data, now);
  if (amount && !_hold(buyer, amount, id)) return { ok: false, error: 'balance' };

  const trade = {
    id,
    kind: 'general',
    buyer,
    seller: null, // fixé à la conclusion
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
  return { ok: true, trade, recipients };
}

/**
 * Un propriétaire accepte l'offre d'origine d'une demande générale (appelé par accept).
 * Sa carte manque : refus pour lui seul, la demande reste ouverte pour les autres.
 * → { ok: true, trade } | { ok: false, error: 'not_found' | 'closed' | 'expired' | 'not_seller'
 *   | 'blocked_seller' | 'blocked_buyer' | 'unavailable' | 'cards_unavailable', trade? }
 */
function acceptGeneral(tradeId, sellerId, now = Date.now()) {
  const data = _load();
  const trade = data.trades[tradeId];
  if (!trade) return { ok: false, error: 'not_found' };
  if (trade.status !== 'open') return { ok: false, error: 'closed', trade };
  if (now >= trade.expiresAt) return { ok: false, error: 'expired', trade };
  if (!sellerId || sellerId === trade.buyer) return { ok: false, error: 'not_seller', trade };
  if (blockReason(sellerId, now)) return { ok: false, error: 'blocked_seller', trade };
  if (blockReason(trade.buyer, now)) return { ok: false, error: 'blocked_buyer', trade };
  if (_cessibleCount(sellerId, trade.card.url, data) < 1) return { ok: false, error: 'unavailable', trade };
  if (!cardsAvailable(trade.buyer, trade.offer.cards, withoutTrade(data, trade.id))) {
    _close(trade, 'cancelled', now, 'cards_unavailable');
    _save(data);
    return { ok: false, error: 'cards_unavailable', trade };
  }

  trade.seller = sellerId;
  _transferCard(sellerId, trade.buyer, trade.card);
  for (const url of trade.offer.cards) _transferCard(trade.buyer, sellerId, { url });
  const paid = (trade.held && trade.held[trade.buyer]) || 0;
  if (paid > 0) _pay(sellerId, paid, trade.id);
  trade.held = {};
  _close(trade, 'done', now, 'accepted');
  _save(data);
  return { ok: true, trade };
}

/**
 * Le vendeur (demande à une personne) ou un propriétaire (demande générale)
 * propose ses conditions : `jp` et `cards` remplacent ce que l'acheteur donne.
 * → { ok: true, trade } | { ok: false, error: 'not_found' | 'closed' | 'expired' | 'not_seller'
 *   | 'already_countered' | 'blocked_seller' | 'unavailable' | 'bad_amount' | 'empty' | 'floor'
 *   | 'cards_unavailable', trade? }
 */
function counter(tradeId, sellerId, { jp, cards = [] } = {}, now = Date.now()) {
  const data = _load();
  const trade = data.trades[tradeId];
  if (!trade || (trade.kind !== 'direct' && trade.kind !== 'general')) return { ok: false, error: 'not_found' };
  if (trade.status !== 'open') return { ok: false, error: 'closed', trade };
  if (now >= trade.expiresAt) return { ok: false, error: 'expired', trade };
  const allowed = trade.kind === 'general' ? (sellerId && sellerId !== trade.buyer) : trade.seller === sellerId;
  if (!allowed) return { ok: false, error: 'not_seller', trade };
  trade.counters = trade.counters || {};
  if (trade.counters[sellerId]) return { ok: false, error: 'already_countered', trade };
  if (blockReason(sellerId, now)) return { ok: false, error: 'blocked_seller', trade };
  if (_cessibleCount(sellerId, trade.card.url, data) < 1) return { ok: false, error: 'unavailable', trade };

  const { amount, offered } = cleanOffer(jp, cards);
  if (amount === null) return { ok: false, error: 'bad_amount', trade };
  if (!amount && !offered.length) return { ok: false, error: 'empty', trade };
  if (!offered.length && amount < floor(trade.card.rarity)) return { ok: false, error: 'floor', trade };
  if (offered.length && !cardsAvailable(trade.buyer, offered, withoutTrade(data, trade.id))) {
    return { ok: false, error: 'cards_unavailable', trade };
  }

  trade.counters[sellerId] = { jp: amount, cards: offered, at: now, expiresAt: now + REQUEST_MS, status: 'open' };
  _save(data);
  return { ok: true, trade };
}

/** Contrôles communs à acceptCounter / refuseCounter. → { data, trade, co } | { error, trade? } */
function buyerCounterAction(tradeId, buyerId, sellerId) {
  const data = _load();
  const trade = data.trades[tradeId];
  if (!trade) return { error: 'not_found' };
  if (trade.status !== 'open') return { error: 'closed', trade };
  if (trade.buyer !== buyerId) return { error: 'not_buyer', trade };
  const co = trade.counters && trade.counters[sellerId];
  if (!co) return { error: 'no_counter', trade };
  if (co.status !== 'open') return { error: 'counter_closed', trade };
  return { data, trade, co };
}

/**
 * L'acheteur accepte la contre-offre de `sellerId` : le complément est prélevé
 * (ou l'excédent rendu), les cartes d'origine absentes de la contre-offre sont libérées.
 * Échec propre (aucun mouvement de JP$ ni de carte) si une condition manque.
 * → { ok: true, trade } | { ok: false, error: 'not_found' | 'closed' | 'not_buyer' | 'no_counter'
 *   | 'counter_closed' | 'expired' | 'blocked_buyer' | 'blocked_seller' | 'unavailable'
 *   | 'cards_unavailable' | 'balance', trade? }
 */
function acceptCounter(tradeId, buyerId, sellerId, now = Date.now()) {
  const { data, trade, co, error } = buyerCounterAction(tradeId, buyerId, sellerId);
  if (error) return { ok: false, error, trade };
  if (now >= co.expiresAt) return { ok: false, error: 'expired', trade };
  if (blockReason(buyerId, now)) return { ok: false, error: 'blocked_buyer', trade };
  if (blockReason(sellerId, now)) return { ok: false, error: 'blocked_seller', trade };
  if (_cessibleCount(sellerId, trade.card.url, data) < 1) return { ok: false, error: 'unavailable', trade };
  if (!cardsAvailable(buyerId, co.cards, withoutTrade(data, trade.id))) return { ok: false, error: 'cards_unavailable', trade };

  // Complément prélevé (ou excédent rendu) : held[acheteur] = prix de la contre-offre
  trade.held = trade.held || {};
  const diff = co.jp - (trade.held[buyerId] || 0);
  if (diff > 0 && !_hold(buyerId, diff, trade.id)) return { ok: false, error: 'balance', trade };
  if (diff < 0) _refund(buyerId, -diff, trade.id);
  trade.held[buyerId] = co.jp;

  trade.seller = sellerId;
  _transferCard(sellerId, buyerId, trade.card);
  for (const url of co.cards) _transferCard(buyerId, sellerId, { url });
  if (co.jp > 0) _pay(sellerId, co.jp, trade.id);
  trade.held = {};
  co.status = 'accepted';
  _close(trade, 'done', now, 'counter_accepted');
  _save(data);
  return { ok: true, trade };
}

/**
 * L'acheteur refuse la contre-offre de `sellerId`.
 *   • demande à une personne : la demande est refusée et l'acheteur remboursé ;
 *   • demande générale : seule cette contre-offre se ferme, l'offre d'origine
 *     reste valable pour les autres propriétaires.
 * → { ok, trade } | { ok: false, error }
 */
function refuseCounter(tradeId, buyerId, sellerId, now = Date.now()) {
  const { data, trade, co, error } = buyerCounterAction(tradeId, buyerId, sellerId);
  if (error) return { ok: false, error, trade };
  co.status = 'refused';
  co.closedAt = now;
  if (trade.kind === 'direct') _close(trade, 'refused', now, 'counter_refused');
  _save(data);
  return { ok: true, trade };
}

module.exports.createGeneral = createGeneral;
module.exports.counter = counter;
module.exports.acceptCounter = acceptCounter;
module.exports.refuseCounter = refuseCounter;
