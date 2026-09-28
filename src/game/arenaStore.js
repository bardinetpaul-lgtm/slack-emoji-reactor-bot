// ═══════════════════════════════════════════════════════════
//  🗄️ MODULE STOCKAGE DE L'ARÈNE
//  Decks sauvegardés, stats V/D/N, plafonds de récompense du jour,
//  matchs déjà réglés (idempotence) et historique court (top semaine).
//  Persistant : survit aux redémarrages du bot.
//
//  DB = fichier JSON local (data/arena.json)
//    { decks: { U123: { active: 0, decks: [{ name, cards: [url ≤ 8, doublons permis] }] × 3 } },
//      (ancien format accepté : { U123: [url × 8] } → repris en « Deck 1 »)
//      stats: { U123: { wins, losses, draws, streak, bestStreak, bestLoot } },
//      rewards: { U123: { day: 'YYYY-MM-DD', total, vs: { U456: n } } },
//      settled: { <matchId>: ISO },
//      history: [{ matchId, at, winnerId, loserId, draw }],
//      tutorial: { U123: ISO } }   // 🎓 tuto vu (affiché à la 1re ouverture)
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const ARENA_PATH = path.join(__dirname, '..', '..', 'data', 'arena.json');

const MAX_REWARDED_PER_DAY = 5;
const MAX_REWARDED_VS_SAME = 2;
const HISTORY_MAX = 1000;
const WEEK_MS = 7 * 24 * 3600 * 1000;
const RARITY_RANK = { common: 0, rare: 1, epic: 2, legendary: 3 };

// ─────────────────────────────────────────────
// 📦 Chargement / Sauvegarde
// ─────────────────────────────────────────────

function load() {
  const empty = { decks: {}, stats: {}, rewards: {}, settled: {}, history: [], tutorial: {} };
  try {
    if (!fs.existsSync(ARENA_PATH)) return empty;
    const data = JSON.parse(fs.readFileSync(ARENA_PATH, 'utf-8')) || {};
    for (const key of Object.keys(empty)) {
      if (!data[key] || typeof data[key] !== 'object') data[key] = empty[key];
    }
    return data;
  } catch {
    return empty;
  }
}

function save(data) {
  try {
    fs.writeFileSync(ARENA_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('[arena] écriture:', e.message);
  }
}

// Jour calendaire à Paris (les plafonds repartent à minuit, heure française)
const parisDay = (now) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(new Date(now));

// ─────────────────────────────────────────────
// 🃏 Decks
// ─────────────────────────────────────────────

//    3 decks enregistrés par joueur (éditeur de deck), un actif.

const DECK_SLOTS = 3;
const DECK_MAX_CARDS = 8;
const DECK_NAME_MAX = 24;

function normalizeDecks(raw) {
  const legacy = Array.isArray(raw);
  const list = legacy ? [{ cards: raw }] : (raw && Array.isArray(raw.decks) ? raw.decks : []);
  const decks = Array.from({ length: DECK_SLOTS }, (_, i) => {
    const d = list[i] || {};
    const name = typeof d.name === 'string' && d.name.trim() ? d.name.trim().slice(0, DECK_NAME_MAX) : `Deck ${i + 1}`;
    // une même carte peut occuper plusieurs emplacements (vérifié contre la collection au combat)
    // 🛒 les cartes mystère (« shop:… ») valent pour un combat : jamais enregistrées
    const cards = (Array.isArray(d.cards) ? d.cards : []).filter((u) => typeof u === 'string' && u && !u.startsWith('shop:')).slice(0, DECK_MAX_CARDS);
    // 🎖 Capitaine : une des cartes du deck (sinon aucun)
    const captain = typeof d.captain === 'string' && cards.includes(d.captain) ? d.captain : null;
    return { name, cards, captain };
  });
  const active = !legacy && raw && Number.isInteger(raw.active) && raw.active >= 0 && raw.active < DECK_SLOTS ? raw.active : 0;
  return { active, decks };
}

/** → { active, decks: [{ name, cards }] × 3 } */
function getDecks(userId) {
  return normalizeDecks(load().decks[userId]);
}

function setDecks(userId, value) {
  const data = load();
  data.decks[userId] = normalizeDecks(value);
  save(data);
  return data.decks[userId];
}

/** Capitaine du deck actif (URL) ou null. */
function getCaptain(userId) {
  const { active, decks } = getDecks(userId);
  return decks[active].captain;
}

/** Cartes du deck actif (null s'il est vide). */
function getDeck(userId) {
  const { active, decks } = getDecks(userId);
  return decks[active].cards.length ? decks[active].cards : null;
}

/** Remplace les cartes du deck actif. */
function setDeck(userId, urls, captain) {
  const value = getDecks(userId);
  value.decks[value.active].cards = urls.slice();
  if (captain !== undefined) value.decks[value.active].captain = captain;
  setDecks(userId, value);
}

// ─────────────────────────────────────────────
// 🎓 Tuto (montré une fois, à la première ouverture)
// ─────────────────────────────────────────────

function hasSeenTutorial(userId) {
  return Boolean(load().tutorial[userId]);
}

function markTutorialSeen(userId, now = Date.now()) {
  const data = load();
  if (!data.tutorial[userId]) {
    data.tutorial[userId] = new Date(now).toISOString();
    save(data);
  }
}

// ─────────────────────────────────────────────
// 📊 Stats
// ─────────────────────────────────────────────

const emptyStats = () => ({ wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0, bestLoot: null });

function getStats(userId) {
  return { ...emptyStats(), ...(load().stats[userId] || {}) };
}

/**
 * Enregistre l'issue d'un combat.
 * Nul : `draw: true` + `players: [U1, U2]`.
 */
function recordResult({ matchId, at, winnerId, loserId, draw, loot, players }) {
  const data = load();
  const stats = (u) => {
    data.stats[u] = { ...emptyStats(), ...(data.stats[u] || {}) };
    return data.stats[u];
  };

  if (draw) {
    for (const u of players || []) {
      const s = stats(u);
      s.draws += 1;
      s.streak = 0;
    }
  } else {
    const w = stats(winnerId);
    w.wins += 1;
    w.streak += 1;
    w.bestStreak = Math.max(w.bestStreak, w.streak);
    if (loot) {
      const best = w.bestLoot;
      if (!best || (RARITY_RANK[loot.rarity] || 0) >= (RARITY_RANK[best.rarity] || 0)) {
        w.bestLoot = { url: loot.url, title: loot.title, rarity: loot.rarity };
      }
    }
    const l = stats(loserId);
    l.losses += 1;
    l.streak = 0;
  }

  data.history.push({ matchId, at, winnerId: draw ? null : winnerId, loserId: draw ? null : loserId, draw: Boolean(draw) });
  if (data.history.length > HISTORY_MAX) data.history = data.history.slice(-HISTORY_MAX);
  save(data);
}

/** Plus gros vainqueurs des 7 derniers jours → [{ userId, wins }] */
function weeklyTop(now = Date.now(), limit = 5) {
  const wins = {};
  for (const h of load().history) {
    if (h.draw || !h.winnerId || now - h.at > WEEK_MS) continue;
    wins[h.winnerId] = (wins[h.winnerId] || 0) + 1;
  }
  return Object.entries(wins)
    .map(([userId, n]) => ({ userId, wins: n }))
    .sort((a, b) => b.wins - a.wins || a.userId.localeCompare(b.userId))
    .slice(0, limit);
}

// ─────────────────────────────────────────────
// 💰 Plafonds de récompense (pack + crédits)
//    5 victoires récompensées / jour, dont 2 max contre le même adversaire.
//    Retourne true (et compte la victoire) si elle est récompensée.
// ─────────────────────────────────────────────

function consumeReward(winnerId, loserId, now = Date.now()) {
  const data = load();
  const day = parisDay(now);
  let r = data.rewards[winnerId];
  if (!r || r.day !== day) r = { day, total: 0, vs: {} };
  if (r.total >= MAX_REWARDED_PER_DAY || (r.vs[loserId] || 0) >= MAX_REWARDED_VS_SAME) return false;
  r.total += 1;
  r.vs[loserId] = (r.vs[loserId] || 0) + 1;
  data.rewards[winnerId] = r;
  save(data);
  return true;
}

// ─────────────────────────────────────────────
// 🔒 Idempotence du règlement de fin de combat
// ─────────────────────────────────────────────

function isSettled(matchId) {
  return Boolean(load().settled[matchId]);
}

function markSettled(matchId) {
  const data = load();
  data.settled[matchId] = new Date().toISOString();
  save(data);
}

module.exports = {
  DECK_SLOTS,
  getDecks,
  setDecks,
  getCaptain,
  MAX_REWARDED_PER_DAY,
  MAX_REWARDED_VS_SAME,
  getDeck,
  setDeck,
  getStats,
  recordResult,
  weeklyTop,
  consumeReward,
  isSettled,
  markSettled,
  hasSeenTutorial,
  markTutorialSeen,
};
