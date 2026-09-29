// ═══════════════════════════════════════════════════════════
//  📊 STATS — point d'entrée
//  run(bloc, filtres) : calcule le bloc sur la période ET sur la
//  période précédente de même durée (flèches ▲/▼ du dashboard).
// ═══════════════════════════════════════════════════════════

const { getDb } = require('../db');
const { normalizeFilters } = require('./time');
const { economy, purchases } = require('./economy');
const game = require('./game');

const IMPL = { economy, purchases, boosters: game.boosters, cards: game.cards, arena: game.arena, activity: game.activity };
const BLOCKS = Object.keys(IMPL);

function run(block, rawFilters, opts = {}) {
  const impl = IMPL[block];
  if (!impl) {
    const e = new Error('bloc inconnu');
    e.code = 'BAD_FILTER';
    throw e;
  }
  const ctx = { ...opts, db: opts.db || getDb() };
  const f = normalizeFilters(rawFilters, opts.now);
  const current = impl(f, ctx);
  const span = Date.parse(f.to) - Date.parse(f.from);
  const prev = impl({ ...f, from: new Date(Date.parse(f.from) - span).toISOString(), to: f.from }, ctx);
  return { ...current, prevKpis: prev.kpis, filters: f };
}

/** Joueurs connus (filtre) + première date de données (période « tout »). */
function players({ db = getDb() } = {}) {
  const ids = db.prepare(`SELECT user_id FROM credit_moves UNION SELECT user_id FROM events WHERE user_id IS NOT NULL
    UNION SELECT json_extract(p.value, '$.userId') FROM events, json_each(events.data, '$.players') p WHERE events.type = 'match_finished'`)
    .all().map((r) => r.user_id).filter(Boolean);
  const first = db.prepare('SELECT MIN(at) AS at FROM (SELECT at FROM credit_moves UNION ALL SELECT at FROM events)').get();
  return { players: [...new Set(ids)].sort(), firstAt: first ? first.at : null };
}

module.exports = { BLOCKS, run, players };
