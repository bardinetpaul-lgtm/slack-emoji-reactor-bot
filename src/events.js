// ═══════════════════════════════════════════════════════════
//  📒 MODULE JOURNAL D'ÉVÉNEMENTS (stats)
//  Une ligne datée par action du jeu : réaction, booster acheté /
//  gagné / ouvert, carte découverte / ajoutée, combat terminé.
//  Lu par le dashboard /stats (src/stats/).
//
//  N'interrompt JAMAIS le jeu : une erreur d'écriture est loggée et
//  record() renvoie false. `dedup` (clé unique) rend l'écriture
//  idempotente : le live et le rattrapage (src/stats/backfill.js)
//  utilisent les mêmes clés, donc jamais de doublon.
// ═══════════════════════════════════════════════════════════

const { getDb } = require('./db');

const RARITY_WEIGHTS = { common: 1, rare: 3, epic: 8, rose: 8, legendary: 20 };

function record(type, userId, data = {}, { at = new Date().toISOString(), dedup = null } = {}) {
  try {
    const r = getDb()
      .prepare('INSERT OR IGNORE INTO events (at, type, user_id, data, dedup) VALUES (?, ?, ?, ?, ?)')
      .run(at, type, userId || null, JSON.stringify(data), dedup);
    return r.changes === 1;
  } catch (e) {
    console.error(`[events] écriture ${type}:`, e.message);
    return false;
  }
}

/** Score d'un booster ouvert (meilleur booster = score le plus haut). */
function boosterScore(cards) {
  return (cards || []).reduce((sum, c) => sum + (RARITY_WEIGHTS[c && c.rarity] || 0), 0);
}

module.exports = { record, boosterScore, RARITY_WEIGHTS };
