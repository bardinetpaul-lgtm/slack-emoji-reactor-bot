// ═══════════════════════════════════════════════════════════
//  ⏪ RATTRAPAGE DE L'HISTORIQUE (stats)
//  Recrée dans le journal les événements passés récupérables depuis
//  les fichiers JSON du jeu. Idempotent : mêmes clés `dedup` que le
//  live (src/events.js) → relançable sans doublon, même après que le
//  bot a commencé à journaliser.
//
//  • boosters.json   → booster_bought / booster_granted / booster_opened
//    (gagné en arène = booster commun créé ≤ 5 s après une victoire
//     du même joueur dans l'historique de l'arène)
//  • collections.json → card_discovered (firstAt) et card_added
//    (approximation : plus ancien firstAt de la carte)
//  • arena.json       → match_finished (1000 derniers, sans decks)
//  Réactions et crédits passés : non récupérables.
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const events = require('../events');
const { getBooster } = require('../boosters');

const GRANT_WINDOW_MS = 5000;

function readJson(dataDir, name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf-8')) || fallback;
  } catch {
    return fallback;
  }
}

const iso = (t) => new Date(t).toISOString();

function backfill({ dataDir = path.join(__dirname, '..', '..', 'data') } = {}) {
  const out = { bought: 0, granted: 0, opened: 0, discovered: 0, added: 0, matches: 0 };
  const history = (readJson(dataDir, 'arena.json', {}).history || []);
  const wins = history.filter((h) => h && h.winnerId && !h.draw);

  // 🎁 Boosters
  const store = readJson(dataDir, 'boosters.json', {}).boosters || {};
  for (const [id, b] of Object.entries(store)) {
    if (!b || !b.owner || !b.createdAt) continue;
    const created = Date.parse(b.createdAt);
    const isGrant = b.type === 'common' && wins.some((h) => h.winnerId === b.owner && Math.abs(created - Number(h.at)) <= GRANT_WINDOW_MS);
    if (isGrant) {
      if (events.record('booster_granted', b.owner, { boosterId: id, boosterType: b.type, reason: 'arena' }, { at: b.createdAt, dedup: `booster_created:${id}` })) out.granted += 1;
    } else {
      const info = getBooster(b.type);
      if (events.record('booster_bought', b.owner, { boosterId: id, boosterType: b.type, price: info ? info.price : null }, { at: b.createdAt, dedup: `booster_created:${id}` })) out.bought += 1;
    }
    if (b.opened && b.openedAt) {
      const cards = (b.cards || []).map((c) => ({ url: c.url, title: c.title, rarity: c.rarity }));
      if (events.record('booster_opened', b.owner, { boosterId: id, boosterType: b.type, via: b.openedVia || 'slack', cards, score: events.boosterScore(cards) },
        { at: b.openedAt, dedup: `booster_opened:${id}` })) out.opened += 1;
    }
  }

  // 🃏 Cartes
  const users = readJson(dataDir, 'collections.json', {}).users || {};
  const firstSeen = new Map();
  for (const [userId, u] of Object.entries(users)) {
    for (const [url, c] of Object.entries((u && u.cards) || {})) {
      if (!c || !c.firstAt) continue;
      if (events.record('card_discovered', userId, { url, title: c.title, rarity: c.rarity }, { at: c.firstAt, dedup: `disc:${userId}:${url}` })) out.discovered += 1;
      const prev = firstSeen.get(url);
      if (!prev || c.firstAt < prev.at) firstSeen.set(url, { at: c.firstAt, title: c.title, rarity: c.rarity });
    }
  }
  for (const [url, c] of firstSeen) {
    if (events.record('card_added', null, { url, title: c.title, rarity: c.rarity, approx: true }, { at: c.at, dedup: `added:${url}` })) out.added += 1;
  }

  // ⚔️ Combats
  for (const h of history) {
    if (!h || !h.matchId || !h.at) continue;
    const players = h.draw
      ? (h.players || []).map((userId) => ({ userId, outcome: 'draw', deck: null }))
      : [{ userId: h.winnerId, outcome: 'win', deck: null }, { userId: h.loserId, outcome: 'loss', deck: null }];
    if (events.record('match_finished', null, { matchId: h.matchId, result: h.draw ? 'draw' : 'win', players, loot: null },
      { at: iso(Number(h.at)), dedup: `match:${h.matchId}` })) out.matches += 1;
  }

  return out;
}

module.exports = { backfill };
