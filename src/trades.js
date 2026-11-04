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
const storage = require('./storage');
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
  const data = storage.readJson(TRADES_PATH, { seq: 0, trades: {} });
  if (!data || typeof data !== 'object' || !data.trades || typeof data.trades !== 'object') return { seq: 0, trades: {} };
  if (!Number.isInteger(data.seq)) data.seq = 0;
  return data;
}
const _save = (data) => storage.writeJsonAtomic(TRADES_PATH, data);

/** Nouvel identifiant (incrémente data.seq). */
function _nextId(data, now = Date.now()) {
  data.seq = (data.seq || 0) + 1;
  return `T${data.seq}-${now.toString(36)}`;
}

/**
 * Références des mouvements de JP$ d'un échange : chaque mouvement logique a la
 * sienne, et un remboursement ou un paiement n'est jamais écrit deux fois pour
 * (joueur, source, ref). Si le bot plante entre le grand livre (SQLite) et
 * data/trades.json, rejouer la clôture ne rend ni ne paie rien de plus.
 */
const refs = {
  hold: (id) => `${id}:hold`,                // offre de l'acheteur, à l'envoi
  counterHold: (id) => `${id}:hold:counter`, // complément d'une contre-offre acceptée
  refund: (id) => `${id}:refund`,            // offre de l'acheteur rendue (une seule fois par demande)
  bid: (id, i) => `${id}#${i}`,              // mise n° i d'une enchère
  bidRefund: (id, i) => `${id}#${i}:refund`, // mise n° i rendue (dépassée ou enchère annulée)
  sale: (id) => `${id}:sale`,                // paiement du vendeur
};

/** Met des JP$ en réserve. false si le solde ne suffit pas. */
const _hold = (userId, amount, ref) => credits.spend(userId, amount, { source: 'trade_hold', ref });
/** Rend des JP$ (rien si ce remboursement est déjà écrit). */
const _refund = (userId, amount, ref) => credits.addCreditOnce(userId, amount, { source: 'trade_refund', ref });
/** Paie le vendeur (rien si ce paiement est déjà écrit). */
const _pay = (userId, amount, ref) => credits.addCreditOnce(userId, amount, { source: 'trade_sale', ref });

/** Paiement du vendeur déjà écrit pour cet échange : { userId, amount } ou null. */
const _saleOf = (trade) => credits.findMove('trade_sale', refs.sale(trade.id));

/** Ref du remboursement de ce que `userId` a en réserve dans `trade`. */
function heldRefundRef(trade, userId) {
  if (trade.kind !== 'auction') return refs.refund(trade.id);
  const bids = trade.bids || [];
  for (let i = bids.length - 1; i >= 0; i -= 1) if (bids[i].userId === userId) return refs.bidRefund(trade.id, i);
  return refs.refund(trade.id);
}

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
    if (amount > 0) _refund(userId, amount, heldRefundRef(trade, userId));
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
  const card = cardIndex.byCode(code, seller);
  if (!card || _cessibleCount(seller, card.url, data) < 1) return { ok: false, error: 'unavailable' };

  const amount = _amount(jp);
  if (amount === null) return { ok: false, error: 'bad_amount' };
  const offered = (Array.isArray(cards) ? cards : []).filter(Boolean);
  if (!amount && !offered.length) return { ok: false, error: 'empty' };
  if (offered.length && !cardsAvailable(buyer, offered, data)) return { ok: false, error: 'cards_unavailable' };
  if (!offered.length && amount < floor(card.rarity)) return { ok: false, error: 'floor' };

  const id = _nextId(data, now);
  if (amount && !_hold(buyer, amount, refs.hold(id))) return { ok: false, error: 'balance' };

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
  if (_saleOf(trade)) return { ok: false, error: 'closed', trade };   // déjà conclu (avant un plantage) : la minuterie le clôt
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
  if (paid > 0) _pay(sellerId, paid, refs.sale(trade.id));
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
  const card = cardIndex.byCode(code, seller);
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
  if (!_hold(userId, amount, refs.bid(trade.id, trade.bids.length))) return { ok: false, error: 'balance', trade };

  let outbid = null;
  if (best) {
    outbid = best.userId;
    const back = (trade.held && trade.held[outbid]) || 0;
    if (back > 0) _refund(outbid, back, refs.bidRefund(trade.id, trade.bids.length - 1));
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
  if (_saleOf(trade)) return { ok: false, error: 'closed' };   // déjà réglée (avant un plantage) : la minuterie la clôt

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
    if (paid > 0) _pay(trade.seller, paid, refs.sale(trade.id));
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
  if (amount && !_hold(buyer, amount, refs.hold(id))) return { ok: false, error: 'balance' };

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
  if (_saleOf(trade)) return { ok: false, error: 'closed', trade };   // déjà conclu (avant un plantage) : la minuterie le clôt
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
  if (paid > 0) _pay(sellerId, paid, refs.sale(trade.id));
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
  if (_saleOf(trade)) return { ok: false, error: 'closed', trade };   // déjà conclu (avant un plantage) : la minuterie le clôt
  if (blockReason(buyerId, now)) return { ok: false, error: 'blocked_buyer', trade };
  if (blockReason(sellerId, now)) return { ok: false, error: 'blocked_seller', trade };
  if (_cessibleCount(sellerId, trade.card.url, data) < 1) {
    // Demande à une personne : sa carte n'y est plus, l'échange ne peut plus aboutir → annulé, JP$ rendus
    if (trade.kind === 'direct') {
      _close(trade, 'cancelled', now, 'unavailable');
      _save(data);
    }
    return { ok: false, error: 'unavailable', trade };
  }
  if (!cardsAvailable(buyerId, co.cards, withoutTrade(data, trade.id))) return { ok: false, error: 'cards_unavailable', trade };

  // Complément prélevé : held[acheteur] = prix de la contre-offre
  trade.held = trade.held || {};
  const diff = co.jp - (trade.held[buyerId] || 0);
  if (diff > 0 && !_hold(buyerId, diff, refs.counterHold(trade.id))) return { ok: false, error: 'balance', trade };

  trade.seller = sellerId;
  _transferCard(sellerId, buyerId, trade.card);
  for (const url of co.cards) _transferCard(buyerId, sellerId, { url });
  // Excédent rendu : même ref que le remboursement à la clôture, l'acheteur n'est jamais remboursé deux fois
  if (diff < 0) _refund(buyerId, -diff, refs.refund(trade.id));
  if (co.jp > 0) _pay(sellerId, co.jp, refs.sale(trade.id));
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

// ═══════════════════════════════════════════════════════════
//  💬 RÉFÉRENCES DES DM (tâche 7, src/tradesSlack.js)
//  trade.dms[userId] = { channel, ts } : pour mettre le DM à jour (chat.update).
// ═══════════════════════════════════════════════════════════

/** Garde la référence du DM envoyé à `userId` pour cet échange. false si l'échange n'existe pas. */
function setDm(id, userId, ref) {
  if (!ref || !ref.channel || !ref.ts) return false;
  const data = _load();
  const trade = data.trades[id];
  if (!trade) return false;
  trade.dms = { ...(trade.dms || {}), [userId]: { channel: ref.channel, ts: ref.ts } };
  _save(data);
  return true;
}

module.exports.setDm = setDm;

// ═══════════════════════════════════════════════════════════
//  4. MINUTERIE ET DÉSINSCRIPTION
//  tick(now) : appelée régulièrement (et au démarrage, pour rattraper
//  ce qui a expiré pendant un arrêt du bot). Sans Slack : elle renvoie
//  des événements, l'appelant prévient les joueurs.
//    0. échange encore ouvert dont le vendeur est déjà payé (le bot s'est
//       arrêté entre le paiement et l'écriture de trades.json) → conclu
//       ('done'), rien n'est rendu (événement 'recovered', ou 'settled'
//       pour une enchère) ;
//    1. carte réservée qui n'est plus possédée → échange annulé
//       ('card_lost'), JP$ rendus. Le plus ancien échange garde ses
//       exemplaires, les suivants sont annulés ;
//    2. pause générale, ou pause (congés…) de l'acheteur ou du vendeur
//       visé → demandes annulées ('pause'). Les enchères continuent ;
//    3. contre-offres dépassées → 'expired' (événement 'counter_expired') ;
//       demande dépassée sans contre-offre encore ouverte → 'expired' ;
//    4. enchères arrivées à échéance → settleAuction (événement 'settled').
//  Événement : { trade, event, reason?, counter?, outcome? }
//  Rien ne bouge deux fois : un 2ᵉ tick au même instant renvoie [].
//  Chaque clôture est écrite tout de suite ; si l'écriture échoue, la
//  minuterie s'arrête (erreur relancée) et les remboursements déjà faits
//  ne sont pas refaits au tick suivant (refs uniques, voir `refs`).
// ═══════════════════════════════════════════════════════════

const isRequest = (t) => t.kind === 'direct' || t.kind === 'general';

/** Exemplaires réservés par cet échange : [[userId, url, n]]. */
function reservationsOf(trade) {
  const out = new Map();
  const add = (userId, url) => {
    const key = `${userId}\u0000${url}`;
    const r = out.get(key) || [userId, url, 0];
    r[2] += 1;
    out.set(key, r);
  };
  if (isRequest(trade)) for (const url of (trade.offer && trade.offer.cards) || []) add(trade.buyer, url);
  if (trade.kind === 'auction' && trade.card) add(trade.seller, trade.card.url);
  return [...out.values()];
}

/** Échanges ouverts, du plus ancien au plus récent. */
const openByAge = (data) => Object.values(data.trades).filter(isOpen)
  .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

/**
 * Termine un échange que le vendeur `sale.userId` a déjà conclu (paiement écrit)
 * mais dont l'état n'a pas été enregistré : rien n'est rendu, les cartes ont déjà bougé.
 */
function recoverDone(trade, sale, now) {
  trade.held = {};
  if (trade.kind === 'auction') {
    const best = bestBid(trade);
    trade.buyer = best ? best.userId : trade.buyer;
    _close(trade, 'done', now, 'sold');
    return;
  }
  trade.seller = sale.userId;
  const co = trade.counters && trade.counters[sale.userId];
  if (co && co.status === 'open' && co.jp === sale.amount && trade.offer.jp !== sale.amount) {
    co.status = 'accepted';
    _close(trade, 'done', now, 'counter_accepted');
  } else {
    _close(trade, 'done', now, 'accepted');
  }
}

/**
 * Fait avancer tous les échanges à l'instant `now`.
 * → [{ trade, event: 'expired' | 'counter_expired' | 'settled' | 'cancelled' | 'recovered', reason?, counter?, outcome? }]
 * Lève si data/trades.json ne peut pas être écrit (la minuterie s'arrête là).
 */
function tick(now = Date.now()) {
  const events = [];
  const data = _load();
  const save = () => {
    try {
      _save(data);
    } catch (e) {
      console.error('❌ Échanges : écriture de trades.json impossible, minuterie arrêtée :', e.message);
      throw e;
    }
  };
  const cancel = (trade, reason) => {
    _close(trade, 'cancelled', now, reason);
    save();
    events.push({ trade, event: 'cancelled', reason });
  };

  // 0. Déjà conclus avant un arrêt du bot (vendeur payé) : on enregistre la fin
  for (const trade of openByAge(data)) {
    const sale = _saleOf(trade);
    if (!sale) continue;
    recoverDone(trade, sale, now);
    save();
    events.push(trade.kind === 'auction'
      ? { trade, event: 'settled', outcome: 'sold' }
      : { trade, event: 'recovered' });
  }

  // 1. Cartes réservées encore possédées ?
  const used = new Map();
  for (const trade of openByAge(data)) {
    const needs = reservationsOf(trade);
    const backed = needs.every(([userId, url, n]) => (used.get(`${userId}\u0000${url}`) || 0) + n
      <= collections.getCount(userId, url));
    if (!backed) { cancel(trade, 'card_lost'); continue; }
    for (const [userId, url, n] of needs) {
      const key = `${userId}\u0000${url}`;
      used.set(key, (used.get(key) || 0) + n);
    }
  }

  // 2. Pause : les demandes s'arrêtent (pas les enchères)
  const paused = weekend.isPaused(now);
  for (const trade of openByAge(data)) {
    if (!isRequest(trade)) continue;
    if (paused || weekend.pauseFor(trade.buyer, now)
      || (trade.kind === 'direct' && weekend.pauseFor(trade.seller, now))) cancel(trade, 'pause');
  }

  // 3. Contre-offres puis demandes dépassées
  for (const trade of openByAge(data)) {
    if (!isRequest(trade)) continue;
    let stillOpen = false;
    for (const [sellerId, co] of Object.entries(trade.counters || {})) {
      if (co.status !== 'open') continue;
      if (now >= co.expiresAt) {
        co.status = 'expired';
        co.closedAt = now;
        save();
        events.push({ trade, event: 'counter_expired', counter: sellerId });
      } else {
        stillOpen = true;
      }
    }
    if (!stillOpen && now >= trade.expiresAt) {
      _close(trade, 'expired', now, 'expired');
      save();
      events.push({ trade, event: 'expired', reason: 'expired' });
    }
  }

  // 4. Enchères terminées (settleAuction relit et écrit l'état lui-même)
  for (const trade of openByAge(data)) {
    if (trade.kind !== 'auction' || now < trade.endsAt) continue;
    const r = settleAuction(trade.id, now);
    if (r.ok) events.push({ trade: r.trade, event: 'settled', outcome: r.outcome });
  }
  return events;
}

/**
 * Le joueur se désinscrit de /jeanpip : ses demandes (acheteur) et celles
 * qui le visent (vendeur d'une demande à une personne) sont annulées
 * ('unsubscribed', JP$ rendus) ; ses contre-offres ouvertes sont annulées
 * (la demande continue). Ses enchères et ses mises restent valables.
 * → [{ trade, event: 'cancelled' | 'counter_cancelled', reason: 'unsubscribed', counter? }]
 */
function onUnsubscribe(userId, now = Date.now()) {
  const events = [];
  const data = _load();
  for (const trade of openByAge(data)) {
    if (!isRequest(trade)) continue;
    if (trade.buyer === userId || (trade.kind === 'direct' && trade.seller === userId)) {
      _close(trade, 'cancelled', now, 'unsubscribed');
      events.push({ trade, event: 'cancelled', reason: 'unsubscribed' });
      continue;
    }
    const co = trade.counters && trade.counters[userId];
    if (co && co.status === 'open') {
      co.status = 'cancelled';
      co.closedAt = now;
      events.push({ trade, event: 'counter_cancelled', reason: 'unsubscribed', counter: userId });
    }
  }
  if (events.length) _save(data);
  return events;
}

module.exports.tick = tick;
module.exports.onUnsubscribe = onUnsubscribe;

// ═══════════════════════════════════════════════════════════
//  📣 REFUS D'UNE DEMANDE GÉNÉRALE (tâche 7b)
//  Un propriétaire qui refuse une demande générale la décline pour lui
//  seul : la demande reste ouverte pour les autres. On le garde dans
//  trade.declined[userId] = instant, pour que son DM reste sans boutons.
// ═══════════════════════════════════════════════════════════

/**
 * `userId` décline la demande générale `tradeId`.
 * → { ok: true, trade } | { ok: false, error: 'not_found' | 'closed', trade? }
 */
function decline(tradeId, userId, now = Date.now()) {
  const data = _load();
  const trade = data.trades[tradeId];
  if (!trade || trade.kind !== 'general') return { ok: false, error: 'not_found' };
  if (trade.status !== 'open') return { ok: false, error: 'closed', trade };
  trade.declined = { ...(trade.declined || {}), [userId]: now };
  _save(data);
  return { ok: true, trade };
}

module.exports.decline = decline;
