// ═══════════════════════════════════════════════════════════
//  🎟️ STATS — Tickets à gratter, plus grosses fortunes, et « En direct »
//  (v3.6, demandé par Paul le 2026-10-21)
//    • scratch : mises, gains, taux de retour, plus gros lots (events
//      'scratch_ticket' : un par ticket gratté) ;
//    • fortunes : les plus gros soldes du moment (table balances) ;
//    • live : les 10 derniers événements du jeu, toutes périodes
//      confondues (les réactions, trop nombreuses, sont résumées à part).
// ═══════════════════════════════════════════════════════════

const { bucketsBetween, indexer, sum, round } = require('./time');

function scratch(f, { db }) {
  const keys = bucketsBetween(f.from, f.to, f.grain);
  const at = indexer(keys, f.grain);
  const rows = db.prepare(`SELECT at, user_id AS userId, data FROM events
    WHERE type = 'scratch_ticket' AND at >= ? AND at <= ?${f.user ? ' AND user_id = ?' : ''} ORDER BY at, id`)
    .all(...(f.user ? [f.from, f.to, f.user] : [f.from, f.to]))
    .map((r) => ({ ...r, ...JSON.parse(r.data || '{}') }));

  const staked = keys.map(() => 0);
  const won = keys.map(() => 0);
  const byOutcome = {};
  const players = {};
  for (const r of rows) {
    const i = at(r.at);
    const score = r.scoreAmount || 0;   // 🏉 v3.6 : gain de la zone SCORE, en plus des ballons
    const amount = (r.amount || 0) + score;
    staked[i] += r.price || 0;
    won[i] += amount;
    const key = r.outcome === 'lose' ? (score ? 'score_only' : 'lose') : r.card ? `card/${r.card.rarity || ''}` : `credits/${r.symbol || ''}`;
    const o = byOutcome[key] || (byOutcome[key] = { key, symbol: r.symbol, count: 0, credits: 0 });
    o.count += 1;
    o.credits += (r.amount || 0);
    if (score) {
      const sc = byOutcome.score || (byOutcome.score = { key: 'score', symbol: null, count: 0, credits: 0 });
      sc.count += 1;
      sc.credits += score;
    }
    const p = players[r.userId] || (players[r.userId] = { userId: r.userId, tickets: 0, staked: 0, won: 0, cards: 0 });
    p.tickets += 1;
    p.staked += r.price || 0;
    p.won += amount;
    if (r.card) p.cards += 1;
  }
  const stakedTotal = sum(staked);
  const wonTotal = sum(won);
  const winners = rows.filter((r) => r.outcome !== 'lose' || r.scoreAmount);
  return {
    kpis: {
      tickets: rows.length,
      staked: round(stakedTotal),
      won: round(wonTotal),
      net: round(stakedTotal - wonTotal),
      rtpPct: stakedTotal > 0 ? round((wonTotal / stakedTotal) * 100, 1) : null,
      winRatePct: rows.length ? round((winners.length / rows.length) * 100, 1) : null,
      cards: rows.filter((r) => r.card).length,
      scoreWins: rows.filter((r) => r.scoreAmount).length,
      players: Object.keys(players).length,
    },
    series: { labels: keys, staked: staked.map((v) => round(v)), won: won.map((v) => round(v)) },
    tables: {
      outcomes: Object.values(byOutcome).map((o) => ({ ...o, credits: round(o.credits) })).sort((a, b) => b.count - a.count),
      biggest: winners
        .sort((a, b) => (b.card ? 1000 : 0) + (b.amount || 0) + (b.scoreAmount || 0) - ((a.card ? 1000 : 0) + (a.amount || 0) + (a.scoreAmount || 0)))
        .slice(0, 10)
        .map((r) => ({ at: r.at, userId: r.userId, amount: (r.amount || 0) + (r.scoreAmount || 0), score: r.scoreAmount || 0, symbol: r.symbol, card: r.card ? { title: r.card.title, rarity: r.card.rarity } : null })),
      players: Object.values(players)
        .map((p) => ({ ...p, staked: round(p.staked), won: round(p.won), net: round(p.won - p.staked) }))
        .sort((a, b) => b.tickets - a.tickets),
    },
  };
}

/** Les plus gros soldes du moment, avec leur part de la masse. */
function fortunes(db, limit = 10) {
  const total = db.prepare('SELECT COALESCE(SUM(balance), 0) AS t FROM balances WHERE balance > 0').get().t;
  return db.prepare('SELECT user_id AS userId, balance FROM balances WHERE balance > 0 ORDER BY balance DESC LIMIT ?').all(limit)
    .map((r) => ({ userId: r.userId, balance: round(r.balance), sharePct: total > 0 ? round((r.balance / total) * 100, 1) : 0 }));
}

// Événements trop fréquents ou techniques : hors du fil « En direct »
const QUIET = ['reaction', 'booster_click', 'card_discovered'];
// Gains sans événement dédié : pris dans le grand livre des crédits
const MOVE_SOURCES = ['weekly_gift', 'media_author', 'admin_gift', 'bug_bounty'];

function live(f, { db, now = Date.now(), limit = 10 }) {
  const userClause = f.user ? ' AND user_id = ?' : '';
  const userArgs = f.user ? [f.user] : [];
  const evts = db.prepare(`SELECT id, at, type, user_id AS userId, data FROM events
    WHERE type NOT IN (${QUIET.map(() => '?').join(',')})${userClause} ORDER BY at DESC, id DESC LIMIT ?`)
    .all(...QUIET, ...userArgs, limit)
    .map((e) => ({ at: e.at, type: e.type, userId: e.userId, data: brief(e.type, JSON.parse(e.data || '{}')) }));
  const moves = db.prepare(`SELECT at, user_id AS userId, source, amount, item FROM credit_moves
    WHERE kind = 'earn' AND source IN (${MOVE_SOURCES.map(() => '?').join(',')})${userClause} ORDER BY at DESC, id DESC LIMIT ?`)
    .all(...MOVE_SOURCES, ...userArgs, limit)
    .map((m) => ({ at: m.at, type: `credit_${m.source}`, userId: m.userId, data: { amount: round(m.amount), item: m.item || null } }));
  const hourAgo = new Date(now - 3600 * 1000).toISOString();
  const dayStart = new Date(now - 24 * 3600 * 1000).toISOString();
  const count = (since) => db.prepare(`SELECT COUNT(*) AS n FROM events WHERE type = 'reaction' AND at >= ?${userClause}`).get(since, ...userArgs).n;
  return {
    kpis: { reactionsHour: count(hourAgo), reactionsDay: count(dayStart) },
    tables: { feed: [...evts, ...moves].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit) },
  };
}
live.noPrev = true;

/** Garde de chaque événement ce qu'il faut pour une ligne lisible (pas les decks entiers). */
function brief(type, d) {
  switch (type) {
    case 'scratch_ticket': return { price: d.price, outcome: d.outcome, symbol: d.symbol, amount: d.amount, score: d.scoreAmount || 0, card: d.card && { title: d.card.title, rarity: d.card.rarity } };
    case 'booster_bought': return { boosterType: d.boosterType, price: d.price };
    case 'booster_opened': {
      const rank = { common: 0, rare: 1, epic: 2, rose: 2, halloween: 2, legendary: 3 };
      const best = (d.cards || []).reduce((b, c) => (!b || (rank[c.rarity] || 0) > (rank[b.rarity] || 0) ? c : b), null);
      return { boosterType: d.boosterType, best: best && { title: best.title, rarity: best.rarity } };
    }
    case 'booster_granted': return { boosterType: d.boosterType, reason: d.reason };
    case 'match_finished': return { result: d.result, players: (d.players || []).map((p) => ({ userId: p.userId, outcome: p.outcome })) };
    case 'raid_launched': return { targets: (d.targets || []).length, style: d.style, price: d.price, free: d.free };
    case 'raid_resolved': {
      const t = d.targets || [];
      return { targets: t.length, tombe: t.filter((x) => x.outcome === 'tombe').length, riposte: t.filter((x) => x.outcome === 'riposte').length };
    }
    case 'card_added': return { title: d.title, rarity: d.rarity };
    case 'cards_sold': return { sold: d.sold, gained: d.gained };
    default: return {};
  }
}

module.exports = { scratch, fortunes, live, QUIET };
