// ═══════════════════════════════════════════════════════════
//  🏟️ MODULE COMBATS (Arène) — cycle de vie
//  preparing → running → ended   (ou → cancelled)
//
//  • Préparation : chaque joueur voit son deck, peut le modifier,
//    clique « Prêt ». Démarre quand les deux sont prêts, ou à 60 s
//    avec le deck en cours ; un joueur jamais connecté → annulé.
//  • Combat : moteur pur (engine.js) avancé par step(now), 10 Hz.
//    Déconnexion > 20 s → défaite ; les deux déconnectés → annulé.
//  • Fin : settle.js applique pertes / butin / récompenses UNE fois,
//    puis les écouteurs onEnd sont prévenus (DM récap côté Slack).
//
//  En mémoire : un redémarrage du bot fait disparaître les combats
//  en cours SANS aucune perte (la collection n'est touchée qu'au règlement).
//  Horloge injectable : step(now) ; start() lance la boucle réelle.
// ═══════════════════════════════════════════════════════════

const crypto = require('crypto');

const engine = require('./engine');
const { getCardStats } = require('./cards');
const deckRules = require('./deck');
const arenaStore = require('./arenaStore');
const { settleMatch } = require('./settle');
const collections = require('../collections');
const arenas = require('./arenas');

const PREP_MS = 60 * 1000;
const DISCONNECT_MS = 20 * 1000;
const KEEP_ENDED_MS = 10 * 60 * 1000;
const LOOP_MS = engine.STEP_MS;

const matches = new Map();      // id → match
const subscribers = new Map();  // id → Set<{ userId, fn }>
const endListeners = [];
let seq = 0;
let timer = null;

const ACTIVE = ['preparing', 'running'];

// ─────────────────────────────────────────────
// 🔎 Accès
// ─────────────────────────────────────────────

function getMatch(id) {
  return matches.get(id) || null;
}

function getMatchOf(userId) {
  for (const m of matches.values()) {
    if (ACTIVE.includes(m.status) && (m.players.A.userId === userId || m.players.B.userId === userId)) return m;
  }
  return null;
}

function isBusy(userId) {
  return Boolean(getMatchOf(userId));
}

function sideOf(match, userId) {
  if (match.players.A.userId === userId) return 'A';
  if (match.players.B.userId === userId) return 'B';
  return null;
}

// ─────────────────────────────────────────────
// 🏗️ Création (après un défi accepté ou une association en file)
// ─────────────────────────────────────────────

function createMatchFor(userA, userB, now = Date.now(), { arena } = {}) {
  if (isBusy(userA) || isBusy(userB)) return { ok: false, reason: 'busy' };
  const deckA = deckRules.resolveDeck(arenaStore.getDeck(userA), collections.getCollection(userA));
  const deckB = deckRules.resolveDeck(arenaStore.getDeck(userB), collections.getCollection(userB));
  if (!deckA || !deckB) return { ok: false, reason: 'cards' };

  seq += 1;
  const id = `a_${now.toString(36)}_${seq}`;
  const player = (userId, deck) => ({
    userId, deckUrls: deck.urls, replaced: deck.replaced,
    ready: false, connections: 0, everConnected: false, disconnectedAt: null,
  });
  const match = {
    id,
    status: 'preparing',
    arena: arenas.byKey(arena) ? arena : 'jardin',
    createdAt: now,
    prepDeadline: now + PREP_MS,
    endedAt: null,
    players: { A: player(userA, deckA), B: player(userB, deckB) },
    engine: null,
    lastStepAt: null,
    summary: null,
  };
  matches.set(id, match);
  return { ok: true, id, match };
}

// ─────────────────────────────────────────────
// 🃏 Préparation
// ─────────────────────────────────────────────

function setDeck(id, userId, urls) {
  const match = getMatch(id);
  const side = match && sideOf(match, userId);
  if (!side) return { ok: false, reason: 'not_player' };
  if (match.status !== 'preparing') return { ok: false, reason: 'not_preparing' };
  const check = deckRules.validateDeck(collections.getCollection(userId), urls);
  if (!check.ok) return check;
  match.players[side].deckUrls = urls.slice();
  match.players[side].replaced = [];
  arenaStore.setDeck(userId, urls);   // devient le deck par défaut
  broadcast(match);
  return { ok: true };
}

/** « Prêt » (ou « Prêt · annuler » avec ready = false). */
function setReady(id, userId, ready = true) {
  const match = getMatch(id);
  const side = match && sideOf(match, userId);
  if (!side) return { ok: false, reason: 'not_player' };
  if (match.status !== 'preparing') return { ok: false, reason: 'not_preparing' };
  match.players[side].ready = Boolean(ready);
  broadcast(match);
  return { ok: true };
}

// ─────────────────────────────────────────────
// 🔌 Connexions (flux SSE ouverts / fermés)
// ─────────────────────────────────────────────

function connect(id, userId, now = Date.now()) {
  const match = getMatch(id);
  const side = match && sideOf(match, userId);
  if (!side) return false;
  const p = match.players[side];
  p.connections += 1;
  p.everConnected = true;
  p.disconnectedAt = null;
  return true;
}

function disconnect(id, userId, now = Date.now()) {
  const match = getMatch(id);
  const side = match && sideOf(match, userId);
  if (!side) return false;
  const p = match.players[side];
  p.connections = Math.max(0, p.connections - 1);
  if (p.connections === 0) p.disconnectedAt = now;
  return true;
}

// ─────────────────────────────────────────────
// 🎮 Actions pendant le combat
// ─────────────────────────────────────────────

function action(id, userId, act) {
  const match = getMatch(id);
  const side = match && sideOf(match, userId);
  if (!side) return { ok: false, reason: 'not_player' };

  // Abandon pendant la préparation = annulation (rien d'engagé)
  if (match.status === 'preparing' && act && act.type === 'forfeit') {
    cancel(match, 'forfeit_prep');
    return { ok: true };
  }
  if (match.status !== 'running') return { ok: false, reason: 'not_running' };

  const res = engine.applyAction(match.engine, side, act);
  if (res.ok) broadcast(match, res.events);
  return { ok: res.ok, reason: res.reason };
}

// ─────────────────────────────────────────────
// ▶️ Démarrage du combat
// ─────────────────────────────────────────────

function startMatch(match, now) {
  const players = {};
  for (const side of ['A', 'B']) {
    const p = match.players[side];
    const collection = collections.getCollection(p.userId);
    // Re-vérifie le deck au dernier moment (une carte a pu disparaître)
    const resolved = deckRules.resolveDeck(p.deckUrls, collection);
    if (!resolved) return cancel(match, 'cards', now);
    p.deckUrls = resolved.urls;
    const byUrl = Object.fromEntries(collection.map((c) => [c.url, c]));
    const deck = resolved.urls.map((u) => ({ url: u, title: byUrl[u].title, rarity: byUrl[u].rarity }));
    const copies = Object.fromEntries(resolved.urls.map((u) => [u, byUrl[u].count]));
    players[side] = { userId: p.userId, deck, copies };
  }
  match.engine = engine.createMatch({ id: match.id, seed: crypto.randomInt(0, 2 ** 31), players });
  match.status = 'running';
  match.lastStepAt = now;
  broadcast(match);
  return undefined;
}

// ─────────────────────────────────────────────
// 🏁 Fin / annulation
// ─────────────────────────────────────────────

function finish(match, now) {
  match.status = 'ended';
  match.endedAt = now;
  match.summary = settleMatch({
    matchId: match.id,
    players: { A: match.players.A.userId, B: match.players.B.userId },
    result: match.engine.result,
  }, { now });
  broadcast(match);
  notifyEnd(match);
}

function cancel(match, reason, now = Date.now()) {
  match.status = 'cancelled';
  match.cancelReason = reason;
  match.endedAt = now;
  match.summary = settleMatch({
    matchId: match.id,
    players: { A: match.players.A.userId, B: match.players.B.userId },
    cancelled: true,
    result: null,
  }, { now });
  broadcast(match);
  notifyEnd(match);
}

function notifyEnd(match) {
  for (const fn of endListeners) {
    try {
      fn(match, match.summary);
    } catch (e) {
      console.error('[arena] onEnd:', e.message);
    }
  }
}

function onEnd(fn) {
  endListeners.push(fn);
}

// ─────────────────────────────────────────────
// ⏩ Avancer tous les combats jusqu'à `now`
// ─────────────────────────────────────────────

function step(now = Date.now()) {
  for (const match of [...matches.values()]) {
    if (match.status === 'preparing') {
      const bothReady = match.players.A.ready && match.players.B.ready;
      if (bothReady || now >= match.prepDeadline) {
        if (!match.players.A.everConnected || !match.players.B.everConnected) cancel(match, 'absent', now);
        else startMatch(match, now);
      }
      continue;
    }

    if (match.status === 'running') {
      const elapsed = Math.floor((now - match.lastStepAt) / LOOP_MS) * LOOP_MS;
      let events = [];
      if (elapsed > 0) {
        events = engine.tick(match.engine, elapsed);
        match.lastStepAt += elapsed;
      }

      // 🔌 Déconnexions prolongées
      const gone = ['A', 'B'].filter((s) => {
        const p = match.players[s];
        return p.connections === 0 && p.disconnectedAt !== null && now - p.disconnectedAt >= DISCONNECT_MS;
      });
      if (match.engine.status === 'running' && gone.length === 2) {
        cancel(match, 'disconnect', now);
        continue;
      }
      if (match.engine.status === 'running' && gone.length === 1) {
        engine.endMatch(match.engine, gone[0] === 'A' ? 'B' : 'A', 'disconnect', events);
      }

      if (match.engine.status === 'ended') finish(match, now);
      else if (elapsed > 0) broadcast(match, events);
      continue;
    }

    // 🧹 Combats terminés gardés 10 min (écran de résultat), puis purgés
    if (match.endedAt !== null && now - match.endedAt >= KEEP_ENDED_MS) {
      matches.delete(match.id);
      subscribers.delete(match.id);
    }
  }
}

// ─────────────────────────────────────────────
// 👁 Vue d'un joueur + diffusion aux abonnés
// ─────────────────────────────────────────────

function view(match, userId) {
  const side = sideOf(match, userId);
  const foe = side === 'A' ? 'B' : 'A';
  const base = {
    matchId: match.id,
    you: side,
    opponent: match.players[foe].userId,
    arena: match.arena,
  };

  if (match.status === 'preparing') {
    const collection = collections.getCollection(userId);
    const byUrl = Object.fromEntries(collection.map((c) => [c.url, c]));
    const me = match.players[side];
    return {
      ...base,
      phase: 'preparing',
      deadline: match.prepDeadline,
      deck: me.deckUrls.filter((u) => byUrl[u]).map((u) => ({ ...getCardStats(byUrl[u]), copies: byUrl[u].count })),
      replaced: me.replaced,
      ready: { you: me.ready, opponent: match.players[foe].ready },
      decks: arenaStore.getDecks(userId).decks,
      activeDeck: arenaStore.getDecks(userId).active,
      opponentConnected: match.players[foe].connections > 0,
    };
  }
  if (match.status === 'running') {
    return { ...base, phase: 'running', ...engine.publicState(match.engine, side) };
  }
  return {
    ...base,
    phase: match.status,   // 'ended' | 'cancelled'
    cancelReason: match.cancelReason || null,
    result: match.engine ? match.engine.result : null,
    summary: match.summary ? { you: match.summary[side], opponent: match.summary[foe] } : null,
  };
}

function broadcast(match, events = []) {
  const subs = subscribers.get(match.id);
  if (!subs) return;
  for (const sub of subs) {
    try {
      sub.fn({ ...view(match, sub.userId), events });
    } catch (e) {
      console.error('[arena] diffusion:', e.message);
    }
  }
}

/** S'abonner aux états d'un combat. Reçoit tout de suite l'état courant. → désabonnement */
function subscribe(id, userId, fn) {
  const match = getMatch(id);
  if (!match || !sideOf(match, userId)) return null;
  if (!subscribers.has(id)) subscribers.set(id, new Set());
  const sub = { userId, fn };
  subscribers.get(id).add(sub);
  fn({ ...view(match, userId), events: [] });
  return () => {
    const subs = subscribers.get(id);
    if (subs) subs.delete(sub);
  };
}

// ─────────────────────────────────────────────
// 🔁 Boucle réelle (10 Hz)
// ─────────────────────────────────────────────

function start() {
  if (timer) return;
  timer = setInterval(() => {
    try {
      step(Date.now());
    } catch (e) {
      console.error('[arena] boucle:', e);
    }
  }, LOOP_MS);
  // Ne maintient pas le process en vie à lui seul (le bot s'en charge en prod)
  if (typeof timer.unref === 'function') timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  PREP_MS,
  DISCONNECT_MS,
  createMatchFor,
  getMatch,
  getMatchOf,
  isBusy,
  setDeck,
  setReady,
  connect,
  disconnect,
  action,
  step,
  subscribe,
  onEnd,
  view,
  start,
  stop,
};
