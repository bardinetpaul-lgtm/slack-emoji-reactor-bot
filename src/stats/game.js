// ═══════════════════════════════════════════════════════════
//  🎮 STATS — Boosters, Cartes, Arène, Activité (journal `events`)
// ═══════════════════════════════════════════════════════════

const { bucketsBetween, bucketBounds, sum, round, median, indexer } = require('./time');

function loadEvents(db, types, { from = null, to, user = null }) {
  const where = [`type IN (${types.map(() => '?').join(',')})`, 'at <= ?'];
  const params = [...types, to];
  if (from) { where.push('at >= ?'); params.push(from); }
  if (user) { where.push('user_id = ?'); params.push(user); }
  return db.prepare(`SELECT at, type, user_id AS userId, data FROM events WHERE ${where.join(' AND ')} ORDER BY at, id`)
    .all(...params)
    .map((e) => ({ ...e, data: e.data ? JSON.parse(e.data) : {} }));
}

function firstAt(db, type, extra = '') {
  const r = db.prepare(`SELECT MIN(at) AS at FROM events WHERE type = ?${extra}`).get(type);
  return r ? r.at : null;
}

const countBy = (list, keyOf) => list.reduce((acc, x) => { const k = keyOf(x); acc[k] = (acc[k] || 0) + 1; return acc; }, {});

// 🎁 Boosters
function boosters(f, { db }) {
  const keys = bucketsBetween(f.from, f.to, f.grain);
  const at = indexer(keys, f.grain);
  const ev = loadEvents(db, ['booster_bought', 'booster_granted', 'booster_opened'], f);
  const opened = ev.filter((e) => e.type === 'booster_opened');
  const openedByType = {};
  for (const e of opened) {
    const t = e.data.boosterType || '?';
    (openedByType[t] || (openedByType[t] = keys.map(() => 0)))[at(e.at)] += 1;
  }
  const all = loadEvents(db, ['booster_bought', 'booster_granted', 'booster_opened'], { to: f.to, user: f.user });
  const openedIds = new Set(all.filter((e) => e.type === 'booster_opened').map((e) => e.data.boosterId));
  const stock = all.filter((e) => e.type !== 'booster_opened' && !openedIds.has(e.data.boosterId)).length;
  const top = opened
    .map((e) => ({ userId: e.userId, at: e.at, boosterType: e.data.boosterType, score: e.data.score || 0, cards: e.data.cards || [] }))
    .sort((a, b) => b.score - a.score || a.at.localeCompare(b.at))
    .slice(0, 5);
  return {
    kpis: {
      bought: ev.filter((e) => e.type === 'booster_bought').length,
      granted: ev.filter((e) => e.type === 'booster_granted').length,
      opened: opened.length,
      stock,
    },
    series: { labels: keys, openedByType },
    tables: { top },
    since: firstAt(db, 'booster_bought'),
  };
}

// 🃏 Cartes
function cards(f, { db, catalogSize = 0, ownedCopies = 0 }) {
  const keys = bucketsBetween(f.from, f.to, f.grain);
  const at = indexer(keys, f.grain);
  const added = loadEvents(db, ['card_added'], { ...f, user: null });
  const addedSeries = keys.map(() => 0);
  for (const e of added) addedSeries[at(e.at)] += 1;

  const disc = loadEvents(db, ['card_discovered'], { to: f.to, user: f.user });
  const discSeries = keys.map(() => 0);
  const perUser = new Map();
  const meanS = keys.map(() => 0); const medS = keys.map(() => 0);
  const inPeriod = [];
  let i = 0;
  const snapshot = (b) => {
    const vals = [...perUser.values()];
    meanS[b] = vals.length ? round(sum(vals) / vals.length) : 0;
    medS[b] = round(median(vals));
  };
  let bucket = 0;
  for (; i < disc.length && disc[i].at < f.from; i += 1) perUser.set(disc[i].userId, (perUser.get(disc[i].userId) || 0) + 1);
  for (; i < disc.length; i += 1) {
    const e = disc[i];
    const b = at(e.at);
    while (bucket < b) { snapshot(bucket); bucket += 1; }
    perUser.set(e.userId, (perUser.get(e.userId) || 0) + 1);
    discSeries[b] += 1;
    inPeriod.push(e);
  }
  while (bucket < keys.length) { snapshot(bucket); bucket += 1; }

  const perPlayer = [...perUser.entries()]
    .map(([userId, n]) => ({ userId, cards: n, pct: catalogSize ? round((n / catalogSize) * 100, 1) : null }))
    .sort((a, b) => b.cards - a.cards);
  const byRarity = Object.entries(countBy(inPeriod, (e) => e.data.rarity || '?')).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  const last = keys.length - 1;
  return {
    kpis: { catalog: catalogSize, owned: ownedCopies, added: added.length, discovered: inPeriod.length, players: perUser.size, mean: meanS[last], median: medS[last] },
    series: { labels: keys, added: addedSeries, discovered: discSeries, mean: meanS, median: medS },
    tables: { perPlayer, byRarity },
    since: firstAt(db, 'card_discovered'),
  };
}

// ⚔️ Arène
function arena(f, { db }) {
  const keys = bucketsBetween(f.from, f.to, f.grain);
  const at = indexer(keys, f.grain);
  const matches = loadEvents(db, ['match_finished'], { ...f, user: null })
    .filter((m) => !f.user || (m.data.players || []).some((p) => p.userId === f.user));
  const series = { decisive: keys.map(() => 0), draws: keys.map(() => 0), cancelled: keys.map(() => 0) };
  const cardsMap = new Map(); const playersMap = new Map();
  let withDecks = 0;
  for (const m of matches) {
    const k = m.data.result === 'win' ? 'decisive' : m.data.result === 'draw' ? 'draws' : 'cancelled';
    series[k][at(m.at)] += 1;
    const players = m.data.players || [];
    for (const p of players) {
      if (!p.userId) continue;
      const s = playersMap.get(p.userId) || { userId: p.userId, matches: 0, wins: 0 };
      s.matches += 1;
      if (p.outcome === 'win') s.wins += 1;
      playersMap.set(p.userId, s);
    }
    if (m.data.result === 'cancelled') continue;
    if (players.some((p) => Array.isArray(p.deck) && p.deck.length)) withDecks += 1;
    for (const p of players) {
      if (!Array.isArray(p.deck) || (f.user && p.userId !== f.user)) continue;
      const seen = new Set();
      for (const c of p.deck) {
        if (!c || !c.url || seen.has(c.url)) continue;
        seen.add(c.url);
        const s = cardsMap.get(c.url) || { url: c.url, title: c.title, rarity: c.rarity, plays: 0, wins: 0 };
        s.plays += 1;
        if (p.outcome === 'win') s.wins += 1;
        cardsMap.set(c.url, s);
      }
    }
  }
  const credit = (source, kind) => {
    const r = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS t FROM credit_moves WHERE source = ? AND kind = ? AND at >= ? AND at <= ?${f.user ? ' AND user_id = ?' : ''}`)
      .get(...[source, kind, f.from, f.to, ...(f.user ? [f.user] : [])]);
    return round(Math.abs(r.t));
  };
  return {
    kpis: {
      matches: matches.length,
      decisive: sum(series.decisive),
      draws: sum(series.draws),
      cancelled: sum(series.cancelled),
      withDecks,
      rewards: credit('arena_reward', 'earn'),
      shop: credit('arena_shop', 'spend'),
    },
    series: { labels: keys, ...series },
    tables: {
      topCards: [...cardsMap.values()]
        .map((c) => ({ ...c, winRate: c.plays ? round((c.wins / c.plays) * 100, 0) : 0 }))
        .sort((a, b) => b.plays - a.plays || b.winRate - a.winRate)
        .slice(0, 10),
      players: [...playersMap.values()].sort((a, b) => b.matches - a.matches).slice(0, 10),
    },
    since: firstAt(db, 'match_finished', " AND json_extract(data, '$.players[0].deck') IS NOT NULL"),
  };
}

// 😀 Activité
// ⚡ Réactions / achats / ouvertures comptés par SQLite (GROUP BY par bucket,
//    index events(type, at)) : seuls les totaux par joueur remontent en JS.
function activity(f, { db }) {
  const bounds = bucketBounds(f.from, f.to, f.grain);
  const keys = bounds.map((b) => b.key);
  const at = indexer(keys, f.grain);
  const reactions = keys.map(() => 0);
  const active = keys.map(() => new Set());
  const all = new Set();
  const reactors = {};
  const userClause = f.user ? ' AND user_id = ?' : '';
  const userArgs = f.user ? [f.user] : [];
  const bucketSql = (op) => db.prepare(`SELECT user_id AS userId, type, COUNT(*) AS n FROM events
    WHERE type IN ('reaction', 'booster_bought', 'booster_opened') AND at >= ? AND at ${op} ? AND user_id IS NOT NULL${userClause}
    GROUP BY user_id, type`);
  const inBucket = bucketSql('<');
  const inLastBucket = bucketSql('<=');
  bounds.forEach((b, i) => {
    for (const r of (b.last ? inLastBucket : inBucket).all(b.start, b.end, ...userArgs)) {
      active[i].add(r.userId);
      all.add(r.userId);
      if (r.type === 'reaction') {
        reactions[i] += r.n;
        reactors[r.userId] = (reactors[r.userId] || 0) + r.n;
      }
    }
  });
  // Combats : peu nombreux, joueurs dans le JSON de l'événement
  for (const e of loadEvents(db, ['match_finished'], { ...f, user: null })) {
    const kept = (e.data.players || []).map((p) => p.userId).filter((u) => u && (!f.user || u === f.user));
    const b = at(e.at);
    for (const u of kept) { active[b].add(u); all.add(u); }
  }
  const total = sum(reactions);
  return {
    kpis: { reactions: total, activeUsers: all.size, reactionsPerActive: all.size ? round(total / all.size, 1) : 0 },
    series: { labels: keys, reactions, activeUsers: active.map((s) => s.size) },
    tables: { topReactors: Object.entries(reactors).map(([userId, n]) => ({ userId, reactions: n })).sort((a, b) => b.reactions - a.reactions).slice(0, 10) },
    since: firstAt(db, 'reaction'),
  };
}

module.exports = { boosters, cards, arena, activity };
