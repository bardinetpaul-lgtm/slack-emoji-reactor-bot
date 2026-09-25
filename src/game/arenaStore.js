// ═══════════════════════════════════════════════════════════
//  🗄️ MODULE STOCKAGE DE L'ARÈNE
//  Decks sauvegardés, stats V/D/N, plafonds de récompense du jour,
//  matchs déjà réglés (idempotence) et historique court (top semaine).
//  Persistant : survit aux redémarrages du bot.
//
//  DB = fichier JSON local (data/arena.json)
//    { decks: { U123: [url × 8] },
//      stats: { U123: { wins, losses, draws, streak, bestStreak, bestLoot } },
//      rewards: { U123: { day: 'YYYY-MM-DD', total, vs: { U456: n } } },
//      settled: { <matchId>: ISO },
//      history: [{ matchId, at, winnerId, loserId, draw }] }
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
  const empty = { decks: {}, stats: {}, rewards: {}, settled: {}, history: [] };
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

function getDeck(userId) {
  const deck = load().decks[userId];
  return Array.isArray(deck) && deck.length ? deck : null;
}

function setDeck(userId, urls) {
  const data = load();
  data.decks[userId] = urls.slice();
  save(data);
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
};
