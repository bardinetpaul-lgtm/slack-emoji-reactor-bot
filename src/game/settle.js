// ═══════════════════════════════════════════════════════════
//  🏁 MODULE RÈGLEMENT DE FIN DE COMBAT (Arène)
//  Seul endroit où un combat touche aux collections / crédits.
//  Appelé UNE fois par combat (idempotent par matchId).
//
//  Règles :
//    • pose détruite → perdue, quel que soit le vainqueur ;
//    • perdant → TOUTES ses poses perdues (même survivantes) ;
//    • vainqueur / nul → survivantes et Pompes expirées gardées ;
//    • butin : 1 pose du perdant tirée au hasard → au vainqueur ;
//    • vainqueur : booster Commun + 10 crédits à CHAQUE victoire (plus aucun
//      plafond depuis la v2.1), en plus du butin ;
//    • pose rappelée (🏳 Rappel, sortie du terrain) → toujours sauvée,
//      jamais prise en butin ;
//    • 📅 série (v2.2) : chaque joueur d'un combat allé au bout (victoire,
//      défaite ou nul) avance d'un jour de série, une fois par jour
//      (règles et récompenses : dailyStreak.js) ;
//    • combat annulé → rien.
// ═══════════════════════════════════════════════════════════

const collections = require('../collections');
const credits = require('../credits');
const boosters = require('../boosters');
const arenaStore = require('./arenaStore');
const dailyStreak = require('./dailyStreak');
const events = require('../events');

const REWARD_BOOSTER = 'common';
const REWARD_CREDITS = 10;

const brief = (p) => ({ url: p.url, title: p.title, rarity: p.rarity, archetype: p.archetype });
const emptySide = (userId) => ({ userId, lost: [], kept: [], loot: null, stolen: null, rewarded: false, boosterId: null, credits: 0, streak: null });

/** 📅 Fait avancer la série de `userId` → { step, credits, boosterId } | null (journée déjà comptée). */
function rewardStreak(userId, matchId, now) {
  const { state, step, reward } = dailyStreak.advance(arenaStore.getStreak(userId), now);
  if (!reward) return null;
  arenaStore.setStreak(userId, state);
  const out = { step, credits: 0, boosterId: null };
  if (reward.credits) {
    credits.addCredit(userId, reward.credits, { source: 'arena_streak', ref: matchId });
    out.credits = reward.credits;
  }
  if (reward.booster) {
    out.boosterId = boosters.createPending(userId, reward.booster);
    events.record('booster_granted', userId, { boosterId: out.boosterId, boosterType: reward.booster, reason: 'arena_streak' },
      { at: new Date(now).toISOString(), dedup: `booster_created:${out.boosterId}` });
  }
  return out;
}

/**
 * @param {{ matchId, players: { A: userId, B: userId }, result, cancelled, arena? }} match
 * @param {{ random?: () => number, now?: number }} opts
 */
function settleMatch({ matchId, players, result, cancelled, arena }, { random = Math.random, now = Date.now() } = {}) {
  if (arenaStore.isSettled(matchId)) return { settled: false, reason: 'already' };
  arenaStore.markSettled(matchId);   // d'abord : jamais appliqué deux fois

  const summary = { settled: true, cancelled: Boolean(cancelled), A: emptySide(players.A), B: emptySide(players.B) };
  if (cancelled || !result) return summary;

  const winner = result.winner;
  const loser = winner === 'A' ? 'B' : winner === 'B' ? 'A' : null;

  // 📺 Détail du combat pour l'historique (derniers combats sur JP TV)
  const detail = {
    players: [players.A, players.B],
    towers: result.towers ? { [players.A]: result.towers.A, [players.B]: result.towers.B } : null,
    reason: result.reason || null,
    durationMs: typeof result.durationMs === 'number' ? result.durationMs : null,
    arena: arena || null,
  };

  // 🃏 Butin (choisi avant les retraits, pour connaître la carte)
  let loot = null;
  let lootType = 'image';
  if (loser) {
    const loserPoses = result.poses.filter((p) => p.side === loser && p.status !== 'recalled');   // 🏳 rappelée = hors butin
    if (loserPoses.length) loot = loserPoses[Math.floor(random() * loserPoses.length)];
    const owned = loot && collections.getCollection(players[loser]).find((c) => c.url === loot.url);
    if (owned && owned.type) lootType = owned.type;   // image ou vidéo, comme l'original
  }

  // ➖ Pertes
  for (const side of ['A', 'B']) {
    const s = summary[side];
    for (const p of result.poses.filter((x) => x.side === side)) {
      const lost = p.status !== 'recalled' && (side === loser || p.status === 'destroyed');   // 🏳 rappelée = sauvée
      (lost ? s.lost : s.kept).push(brief(p));
    }
    if (s.lost.length) collections.removeCards(s.userId, s.lost.map((p) => p.url));
  }

  // 📅 Série : les deux joueurs, quel que soit le résultat
  for (const side of ['A', 'B']) summary[side].streak = rewardStreak(summary[side].userId, matchId, now);

  if (!loser) {
    arenaStore.recordResult({ matchId, at: now, draw: true, ...detail });
    return summary;
  }

  const w = summary[winner];
  const l = summary[loser];

  if (loot) {
    collections.addCards(w.userId, [{ url: loot.url, title: loot.title, rarity: loot.rarity, type: lootType }]);
    w.loot = brief(loot);
    l.stolen = brief(loot);
  }

  // 🎁 Pack + crédits, à chaque victoire
  w.rewarded = true;
  w.boosterId = boosters.createPending(w.userId, REWARD_BOOSTER);
  events.record('booster_granted', w.userId, { boosterId: w.boosterId, boosterType: REWARD_BOOSTER, reason: 'arena' },
    { at: new Date(now).toISOString(), dedup: `booster_created:${w.boosterId}` });
  credits.addCredit(w.userId, REWARD_CREDITS, { source: 'arena_reward', ref: matchId });
  w.credits = REWARD_CREDITS;

  arenaStore.recordResult({ matchId, at: now, winnerId: w.userId, loserId: l.userId, draw: false, loot: w.loot, ...detail });
  return summary;
}

module.exports = { settleMatch, REWARD_BOOSTER, REWARD_CREDITS };
