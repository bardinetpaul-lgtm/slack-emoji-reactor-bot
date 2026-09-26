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
//    • vainqueur : booster Commun + 10 crédits, dans les plafonds
//      du jour (arenaStore.consumeReward) ; le butin n'est pas plafonné ;
//    • pose rappelée (🏳 Rappel, sortie du terrain) → toujours sauvée,
//      jamais prise en butin ;
//    • combat annulé → rien.
// ═══════════════════════════════════════════════════════════

const collections = require('../collections');
const credits = require('../credits');
const boosters = require('../boosters');
const arenaStore = require('./arenaStore');

const REWARD_BOOSTER = 'common';
const REWARD_CREDITS = 10;

const brief = (p) => ({ url: p.url, title: p.title, rarity: p.rarity, archetype: p.archetype });
const emptySide = (userId) => ({ userId, lost: [], kept: [], loot: null, stolen: null, rewarded: false, boosterId: null, credits: 0 });

/**
 * @param {{ matchId, players: { A: userId, B: userId }, result, cancelled }} match
 * @param {{ random?: () => number, now?: number }} opts
 */
function settleMatch({ matchId, players, result, cancelled }, { random = Math.random, now = Date.now() } = {}) {
  if (arenaStore.isSettled(matchId)) return { settled: false, reason: 'already' };
  arenaStore.markSettled(matchId);   // d'abord : jamais appliqué deux fois

  const summary = { settled: true, cancelled: Boolean(cancelled), A: emptySide(players.A), B: emptySide(players.B) };
  if (cancelled || !result) return summary;

  const winner = result.winner;
  const loser = winner === 'A' ? 'B' : winner === 'B' ? 'A' : null;

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

  if (!loser) {
    arenaStore.recordResult({ matchId, at: now, draw: true, players: [players.A, players.B] });
    return summary;
  }

  const w = summary[winner];
  const l = summary[loser];

  if (loot) {
    collections.addCards(w.userId, [{ url: loot.url, title: loot.title, rarity: loot.rarity, type: lootType }]);
    w.loot = brief(loot);
    l.stolen = brief(loot);
  }

  // 🎁 Pack + crédits (plafonnés)
  if (arenaStore.consumeReward(w.userId, l.userId, now)) {
    w.rewarded = true;
    w.boosterId = boosters.createPending(w.userId, REWARD_BOOSTER);
    credits.addCredit(w.userId, REWARD_CREDITS);
    w.credits = REWARD_CREDITS;
  }

  arenaStore.recordResult({ matchId, at: now, winnerId: w.userId, loserId: l.userId, draw: false, loot: w.loot });
  return summary;
}

module.exports = { settleMatch, REWARD_BOOSTER, REWARD_CREDITS };
