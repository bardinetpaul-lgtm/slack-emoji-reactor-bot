// ═══════════════════════════════════════════════════════════
//  💰 STATS — Économie et Achats (grand livre credit_moves)
//  Masse en circulation = somme des soldes, rejouée mouvement par
//  mouvement depuis le début (le mouvement 'opening' de la migration
//  porte les soldes d'avant le suivi).
// ═══════════════════════════════════════════════════════════

const { bucketsBetween, bucketBounds, sum, round, median, indexer } = require('./time');

const itemKey = (m) => (m.item ? `${m.source}/${m.item}` : m.source);
const sorted = (obj) => Object.entries(obj).map(([key, credits]) => ({ key, credits: round(credits) })).sort((a, b) => b.credits - a.credits);

function firstMoveAt(db) {
  const r = db.prepare('SELECT MIN(at) AS at FROM credit_moves').get();
  return r ? r.at : null;
}

function ledgerGap(db) {
  const r = db.prepare('SELECT (SELECT COALESCE(SUM(balance), 0) FROM balances) - (SELECT COALESCE(SUM(amount), 0) FROM credit_moves) AS gap').get();
  return round(r.gap);
}

// ⚡ Agrégation faite par SQLite : une requête GROUP BY par bucket, sur l'index
//    credit_moves(at). Seuls quelques totaux par joueur remontent en JS, même
//    avec des centaines de milliers de mouvements (le bot partage ce thread
//    avec les acks Slack et la boucle de l'Arène).
function economy(f, { db, boosterPrice = 20 }) {
  const bounds = bucketBounds(f.from, f.to, f.grain);
  const keys = bounds.map((b) => b.key);
  const zero = () => keys.map(() => 0);
  const created = zero(); const consumed = zero(); const mass = zero(); const mean = zero(); const med = zero();
  const bySource = {}; const byUse = {};
  let adjust = 0; let unknown = 0;

  const userClause = f.user ? ' AND user_id = ?' : '';
  const userArgs = f.user ? [f.user] : [];
  const balances = new Map();
  const apply = (m) => balances.set(m.userId, (balances.get(m.userId) || 0) + m.amount);
  db.prepare(`SELECT user_id AS userId, SUM(amount) AS amount FROM credit_moves INDEXED BY credit_moves_stats WHERE at < ?${userClause} GROUP BY user_id`)
    .all(f.from, ...userArgs).forEach(apply);
  const bucketSql = (op) => db.prepare(`SELECT user_id AS userId, kind, source, item, SUM(amount) AS amount, COUNT(*) AS n
    FROM credit_moves WHERE at >= ? AND at ${op} ?${userClause} GROUP BY user_id, kind, source, item`);
  const inBucket = bucketSql('<');
  const inLastBucket = bucketSql('<=');

  const massStart = sum([...balances.values()]);
  const pass = (m) => !f.source || m.source === f.source;

  let positives = [];
  bounds.forEach((b, i) => {
    for (const m of (b.last ? inLastBucket : inBucket).all(b.start, b.end, ...userArgs)) {
      apply(m);
      if (m.source === 'unknown') unknown += m.n;
      if (m.kind === 'earn' && pass(m)) {
        created[i] += m.amount;
        bySource[m.source] = (bySource[m.source] || 0) + m.amount;
      } else if (m.kind === 'spend' && pass(m)) {
        consumed[i] -= m.amount;
        byUse[itemKey(m)] = (byUse[itemKey(m)] || 0) - m.amount;
      } else if (m.kind === 'adjust') {
        adjust += m.amount;
      }
    }
    positives = [...balances.values()].filter((v) => v > 0);
    mass[i] = round(sum(positives));
    mean[i] = positives.length ? round(mass[i] / positives.length) : 0;
    med[i] = round(median(positives));
  });

  const last = keys.length - 1;
  const createdTotal = round(sum(created));
  const consumedTotal = round(sum(consumed));
  const avgMass = keys.length ? sum(mass) / keys.length : 0;
  return {
    kpis: {
      mass: mass[last],
      mean: mean[last],
      median: med[last],
      players: positives.length,
      created: createdTotal,
      consumed: consumedTotal,
      net: round(createdTotal - consumedTotal),
      adjust: round(adjust),
      inflationPct: massStart > 0 ? round(((mass[last] - massStart) / massStart) * 100, 1) : null,
      spendRatePct: avgMass > 0 ? round((consumedTotal / avgMass) * 100, 1) : null,
      purchasingPower: boosterPrice ? round(mean[last] / boosterPrice, 1) : null,
      ledgerGap: ledgerGap(db),
      unknown,
    },
    series: {
      labels: keys,
      mass,
      created: created.map((v) => round(v)),
      consumed: consumed.map((v) => round(v)),
      net: created.map((v, i) => round(v - consumed[i])),
      mean,
      median: med,
    },
    tables: { bySource: sorted(bySource), byUse: sorted(byUse) },
    since: firstMoveAt(db),
  };
}

function purchases(f, { db }) {
  const keys = bucketsBetween(f.from, f.to, f.grain);
  const at = indexer(keys, f.grain);
  const rows = db.prepare(`SELECT at, user_id AS userId, -amount AS credits, source, item FROM credit_moves
    WHERE kind = 'spend' AND at >= ? AND at <= ?${f.user ? ' AND user_id = ?' : ''} ORDER BY at, id`)
    .all(...(f.user ? [f.from, f.to, f.user] : [f.from, f.to]));

  const items = {}; const families = {};
  for (const r of rows) {
    const key = itemKey(r);
    const it = items[key] || (items[key] = { key, family: r.source, item: r.item, count: 0, credits: 0, buyers: new Set(), series: keys.map(() => 0) });
    it.count += 1;
    it.credits += r.credits;
    it.buyers.add(r.userId);
    it.series[at(r.at)] += 1;
    const fam = families[r.source] || (families[r.source] = { family: r.source, count: 0, credits: 0 });
    fam.count += 1;
    fam.credits += r.credits;
  }
  const list = Object.values(items).sort((a, b) => b.credits - a.credits || b.count - a.count);
  return {
    kpis: { purchases: rows.length, credits: round(sum(rows.map((r) => r.credits))), buyers: new Set(rows.map((r) => r.userId)).size },
    series: { labels: keys, byItem: Object.fromEntries(list.map((it) => [it.key, it.series])) },
    tables: {
      items: list.map(({ key, family, item, count, credits, buyers }) => ({ key, family, item, count, credits: round(credits), buyers: buyers.size })),
      families: Object.values(families).map((x) => ({ ...x, credits: round(x.credits) })).sort((a, b) => b.credits - a.credits),
    },
    since: firstMoveAt(db),
  };
}

module.exports = { economy, purchases };
