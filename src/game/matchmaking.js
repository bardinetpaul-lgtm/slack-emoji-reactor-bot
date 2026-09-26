// ═══════════════════════════════════════════════════════════
//  🎯 MODULE MATCHMAKING (Arène)
//  Défis directs (60 s pour répondre) et file « Combat rapide »
//  (60 s d'attente max). En mémoire : un redémarrage vide tout,
//  sans conséquence (aucune carte engagée à ce stade).
//
//  Horloge passée par l'appelant (`now`) → testable ; l'app appelle
//  sweep(now) régulièrement et prévient les joueurs des expirations.
//
//  configure({ isBusy(userId), cardCount(userId), winsOf(userId) }) :
//    isBusy     → déjà dans un combat (src/game/matches.js)
//    cardCount  → nombre de cartes DIFFÉRENTES possédées
//    winsOf     → victoires (arènes débloquées, src/game/arenas.js)
//
//  Arène : choisie par le challenger parmi SES arènes débloquées
//  (sa meilleure par défaut) ; en file rapide, la meilleure arène
//  du joueur arrivé le premier.
// ═══════════════════════════════════════════════════════════

const { DECK_SIZE } = require('./deck');
const arenas = require('./arenas');

const CHALLENGE_TTL_MS = 60 * 1000;
const QUEUE_TTL_MS = 60 * 1000;

let deps = { isBusy: () => false, cardCount: () => 0, winsOf: () => 0 };
let challenges = new Map();   // id → { id, from, to, createdAt, expiresAt }
let queue = [];               // [{ userId, joinedAt }]
let seq = 0;

function configure(options) {
  deps = { ...deps, ...options };
}

function reset() {
  challenges = new Map();
  queue = [];
}

const inQueue = (userId) => queue.some((q) => q.userId === userId);
const outgoing = (userId) => [...challenges.values()].find((c) => c.from === userId);

/** En attente = dans la file ou avec un défi sortant. */
function isWaiting(userId) {
  return inQueue(userId) || Boolean(outgoing(userId));
}

// ─────────────────────────────────────────────
// 🎯 Défis
// ─────────────────────────────────────────────

function createChallenge(from, to, now = Date.now(), { arena } = {}) {
  if (from === to) return { ok: false, reason: 'self' };
  if (deps.isBusy(from) || isWaiting(from)) return { ok: false, reason: 'busy_from' };
  if (deps.isBusy(to) || inQueue(to)) return { ok: false, reason: 'busy_to' };
  if (deps.cardCount(from) < DECK_SIZE) return { ok: false, reason: 'cards_from' };
  if (deps.cardCount(to) < DECK_SIZE) return { ok: false, reason: 'cards_to' };
  const wins = deps.winsOf(from);
  if (arena && !arenas.canPlay(wins, arena)) return { ok: false, reason: 'arena_locked' };

  seq += 1;
  const challenge = {
    id: `c_${now.toString(36)}_${seq}`, from, to, createdAt: now, expiresAt: now + CHALLENGE_TTL_MS,
    arena: arena || arenas.levelOf(wins).key,
  };
  challenges.set(challenge.id, challenge);
  return { ok: true, ...challenge };
}

/**
 * Acceptation par la cible. Annule les autres défis impliquant l'un
 * des deux joueurs (renvoyés dans `cancelled` pour les prévenir).
 */
function acceptChallenge(id, userId, now = Date.now()) {
  const c = challenges.get(id);
  if (!c || now >= c.expiresAt) return { ok: false, reason: 'not_found' };
  if (c.to !== userId) return { ok: false, reason: 'not_target' };
  if (deps.isBusy(c.from)) return { ok: false, reason: 'busy_from' };
  if (deps.isBusy(c.to)) return { ok: false, reason: 'busy_to' };

  challenges.delete(id);
  const involved = new Set([c.from, c.to]);
  const cancelled = [...challenges.values()].filter((x) => involved.has(x.from) || involved.has(x.to));
  for (const x of cancelled) challenges.delete(x.id);
  queue = queue.filter((q) => !involved.has(q.userId));
  return { ok: true, from: c.from, to: c.to, arena: c.arena, cancelled };
}

/** Refus par la cible, ou annulation par le challenger. */
function refuseChallenge(id, userId) {
  const c = challenges.get(id);
  if (!c) return { ok: false, reason: 'not_found' };
  if (c.to !== userId && c.from !== userId) return { ok: false, reason: 'not_involved' };
  challenges.delete(id);
  return { ok: true, from: c.from, to: c.to, by: userId };
}

// ─────────────────────────────────────────────
// ⚡ File rapide
// ─────────────────────────────────────────────

function joinQueue(userId, now = Date.now()) {
  if (deps.isBusy(userId) || outgoing(userId)) return { ok: false, reason: 'busy' };
  if (deps.cardCount(userId) < DECK_SIZE) return { ok: false, reason: 'cards' };
  if (inQueue(userId)) return { ok: true, matched: null };

  const opponent = queue.find((q) => q.userId !== userId && !deps.isBusy(q.userId));
  if (opponent) {
    queue = queue.filter((q) => q !== opponent);
    return { ok: true, matched: opponent.userId, arena: arenas.levelOf(deps.winsOf(opponent.userId)).key };
  }
  queue.push({ userId, joinedAt: now });
  return { ok: true, matched: null };
}

function leaveQueue(userId) {
  const before = queue.length;
  queue = queue.filter((q) => q.userId !== userId);
  return queue.length < before;
}

// ─────────────────────────────────────────────
// 🧹 Expirations
// ─────────────────────────────────────────────

function sweep(now = Date.now()) {
  const expiredChallenges = [...challenges.values()].filter((c) => now >= c.expiresAt);
  for (const c of expiredChallenges) challenges.delete(c.id);
  const expiredQueue = queue.filter((q) => now - q.joinedAt >= QUEUE_TTL_MS).map((q) => q.userId);
  queue = queue.filter((q) => now - q.joinedAt < QUEUE_TTL_MS);
  return { expiredChallenges, expiredQueue };
}

module.exports = {
  CHALLENGE_TTL_MS,
  QUEUE_TTL_MS,
  configure,
  reset,
  isWaiting,
  createChallenge,
  acceptChallenge,
  refuseChallenge,
  joinQueue,
  leaveQueue,
  sweep,
};
