// ═══════════════════════════════════════════════════════════
//  🗄️ MODULE STOCKAGE DE L'ARÈNE
//  Decks sauvegardés, stats V/D/N,
//  matchs déjà réglés (idempotence) et historique court (top semaine).
//  Persistant : survit aux redémarrages du bot.
//
//  DB = fichier JSON local (data/arena.json)
//    { decks: { U123: { active: 0, decks: [{ name, cards: [url ≤ 8, doublons permis] }] × 3 } },
//      (ancien format accepté : { U123: [url × 8] } → repris en « Deck 1 »)
//      stats: { U123: { wins, losses, draws, streak, bestStreak, bestLoot } },
//      rewards: { … },   // ancien compteur des plafonds de récompense (retirés en v2.1), plus lu
//      settled: { <matchId>: ISO },
//      history: [{ matchId, at, winnerId, loserId, draw, players?, towers?, reason?, durationMs?, arena? }],   // détail depuis v2.3
//      tutorial: { U123: ISO },    // 🎓 tuto vu (affiché à la 1re ouverture)
//      streaks: { U123: { day: 'AAAA-MM-JJ', step: 1…6 } } }   // 📅 série de combats (dailyStreak.js)
//      tvOptOut: { U123: true },   // 📺 « Ne pas me diffuser sur JP TV » (v2.3)
// ═══════════════════════════════════════════════════════════

const path = require('path');
const { readJson, writeJsonAtomic } = require('../storage');

const ARENA_PATH = path.join(__dirname, '..', '..', 'data', 'arena.json');

const HISTORY_MAX = 1000;
const WEEK_MS = 7 * 24 * 3600 * 1000;
const RARITY_RANK = { common: 0, rare: 1, epic: 2, rose: 2, legendary: 3 };

// ─────────────────────────────────────────────
// 📦 Chargement / Sauvegarde
// ─────────────────────────────────────────────

function load() {
  const empty = { decks: {}, stats: {}, rewards: {}, settled: {}, history: [], tutorial: {}, streaks: {}, tvOptOut: {} };
  try {
    const data = readJson(ARENA_PATH, null);
    if (!data) return empty;
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
    writeJsonAtomic(ARENA_PATH, data);
  } catch (e) {
    console.error('[arena] écriture:', e.message);
  }
}


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
    // 🎖 Capitaine : une 9e carte, hors du deck (possession vérifiée au combat)
    const captain = typeof d.captain === 'string' && d.captain && !d.captain.startsWith('shop:') ? d.captain : null;
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
// 📺 JP TV : refus de diffusion en direct
// ─────────────────────────────────────────────

function isTvOptOut(userId) {
  return Boolean(load().tvOptOut[userId]);
}

function setTvOptOut(userId, optOut) {
  const data = load();
  if (optOut) data.tvOptOut[userId] = true;
  else delete data.tvOptOut[userId];
  save(data);
  return Boolean(optOut);
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
function recordResult({ matchId, at, winnerId, loserId, draw, loot, players, towers, reason, durationMs, arena }) {
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

  data.history.push({
    matchId, at, winnerId: draw ? null : winnerId, loserId: draw ? null : loserId, draw: Boolean(draw),
    players: Array.isArray(players) && players.length === 2 ? players.slice() : null,
    towers: towers || null, reason: reason || null,
    durationMs: typeof durationMs === 'number' ? durationMs : null, arena: arena || null,
  });
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

/**
 * 📺 Derniers combats (JP TV), du plus récent au plus ancien.
 * Ancien format (avant v2.3) : une victoire est reprise avec [gagnant, perdant]
 * et sans tours ; un nul sans joueurs est ignoré.
 */
function recentResults(limit = 5) {
  const out = [];
  const history = load().history;
  for (let i = history.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const h = history[i];
    const players = Array.isArray(h.players) && h.players.length === 2 ? h.players
      : (!h.draw && h.winnerId && h.loserId ? [h.winnerId, h.loserId] : null);
    if (!players) continue;
    out.push({
      matchId: h.matchId, at: h.at, players, winnerId: h.draw ? null : h.winnerId || null, draw: Boolean(h.draw),
      towers: h.towers || null, reason: h.reason || null,
    });
  }
  return out;
}

/**
 * 🏆 Classement général (depuis toujours) : victoires, puis % de victoire,
 * puis combats joués (même ordre que le dashboard /stats).
 * → { top: [{ rank, userId, wins, losses, draws, played, winRate }] (≤ limit), me: ligne de `userId` | null }
 *   `me` est rempli même hors du top (null s'il n'a jamais combattu).
 */
function ranking({ limit = 10, userId = null } = {}) {
  const rows = Object.entries(load().stats)
    .map(([u, s]) => {
      const st = { ...emptyStats(), ...s };
      const played = st.wins + st.losses + st.draws;
      return { userId: u, wins: st.wins, losses: st.losses, draws: st.draws, played, winRate: played ? Math.round((st.wins / played) * 100) : 0 };
    })
    .filter((r) => r.played > 0)
    .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.played - a.played || a.userId.localeCompare(b.userId))
    .map((r, i) => ({ rank: i + 1, ...r }));
  return { top: rows.slice(0, limit), me: (userId && rows.find((r) => r.userId === userId)) || null };
}

// ─────────────────────────────────────────────
// 📅 Série de combats (règles : dailyStreak.js)
// ─────────────────────────────────────────────

function getStreak(userId) {
  return load().streaks[userId] || null;
}

function setStreak(userId, state) {
  const data = load();
  data.streaks[userId] = { day: state.day, step: state.step };
  save(data);
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
  getDeck,
  setDeck,
  getStats,
  recordResult,
  weeklyTop,
  recentResults,
  ranking,
  getStreak,
  setStreak,
  isSettled,
  markSettled,
  hasSeenTutorial,
  markTutorialSeen,
  isTvOptOut,
  setTvOptOut,
};
