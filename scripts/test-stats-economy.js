#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test des stats Économie + Achats (src/stats/economy.js)
//  Usage : node scripts/test-stats-economy.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-stats-eco-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}
const req = (p) => require(path.join(TMP, 'src', p));
const time = req('stats/time.js');
const { economy, purchases } = req('stats/economy.js');
const db = req('db.js').getDb();

// ⏱️ Temps (Paris)
check('23h30 UTC le 31/03 = 1er avril à Paris', time.parisDay('2026-03-31T23:30:00Z') === '2026-04-01');
check('semaine = lundi', time.bucketKey('2026-09-27T10:00:00Z', 'week') === '2026-09-21');
check('mois', time.bucketKey('2026-09-27T10:00:00Z', 'month') === '2026-09');
check('buckets jour', time.bucketsBetween('2026-09-01T10:00:00Z', '2026-09-03T10:00:00Z', 'day').join() === '2026-09-01,2026-09-02,2026-09-03');
check('buckets semaine', time.bucketsBetween('2026-09-01T10:00:00Z', '2026-09-15T10:00:00Z', 'week').join() === '2026-08-31,2026-09-07,2026-09-14');
check('médiane paire', time.median([1, 9, 3, 5]) === 4);
check('médiane vide', time.median([]) === 0);
const bad = (raw) => { try { time.normalizeFilters(raw); return false; } catch (e) { return e.code === 'BAD_FILTER'; } };
check('from invalide → BAD_FILTER', bad({ from: 'abc' }));
check('grain invalide → BAD_FILTER', bad({ grain: 'year' }));
check('to < from → BAD_FILTER', bad({ from: '2026-09-10T00:00:00Z', to: '2026-09-01T00:00:00Z' }));
check('user invalide → BAD_FILTER', bad({ user: '<script>' }));
check('plage > 3 ans → BAD_FILTER', bad({ from: '2020-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }));
const def = time.normalizeFilters({}, Date.parse('2026-09-29T12:00:00Z'));
check('défaut : 30 j, jour', def.grain === 'day' && def.to === '2026-09-29T12:00:00.000Z' && def.from === '2026-08-30T12:00:00.000Z');

// 💰 Jeu de données connu
const ins = db.prepare('INSERT INTO credit_moves (at, user_id, amount, kind, source, item, ref) VALUES (?, ?, ?, ?, ?, ?, ?)');
const bal = db.prepare('INSERT INTO balances (user_id, balance) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET balance = excluded.balance');
const rows = [
  ['2026-09-01T08:00:00.000Z', 'UA', 100, 'opening', 'migration', null],
  ['2026-09-01T08:00:00.000Z', 'UB', 20, 'opening', 'migration', null],
  ['2026-09-10T08:00:00.000Z', 'UA', 10, 'earn', 'reaction', null],
  ['2026-09-10T09:00:00.000Z', 'UB', 30, 'earn', 'weekly_gift', null],
  ['2026-09-10T10:00:00.000Z', 'UA', -45, 'spend', 'booster', 'rare'],
  ['2026-09-11T10:00:00.000Z', 'UB', -20, 'spend', 'booster', 'common'],
  ['2026-09-11T11:00:00.000Z', 'UA', -20, 'spend', 'booster', 'common'],
  ['2026-09-11T12:00:00.000Z', 'UB', -25, 'spend', 'arena_shop', 'epic'],
  ['2026-09-11T13:00:00.000Z', 'UC', 2, 'earn', 'unknown', null],
];
for (const r of rows) ins.run(r[0], r[1], r[2], r[3], r[4], r[5], null);
bal.run('UA', 45); bal.run('UB', 5); bal.run('UC', 2);

const f = time.normalizeFilters({ from: '2026-09-10T00:00:00+02:00', to: '2026-09-11T23:59:59+02:00', grain: 'day' });
const eco = economy(f, { db, boosterPrice: 20 });
check('labels = 2 jours', eco.series.labels.join() === '2026-09-10,2026-09-11');
check('créés = 42', eco.kpis.created === 42);
check('consommés = 110', eco.kpis.consumed === 110);
check('flux net = -68', eco.kpis.net === -68);
check('masse fin = 52', eco.kpis.mass === 52);
check('masse / jour', eco.series.mass.join() === '115,52');
check('inflation = (52-120)/120', eco.kpis.inflationPct === -56.7);
check('moyenne / médiane (soldes > 0)', eco.kpis.players === 3 && eco.kpis.mean === 17.33 && eco.kpis.median === 5);
check('pouvoir d’achat = moyenne / 20', eco.kpis.purchasingPower === 0.9);
check('écart ledger = 0', eco.kpis.ledgerGap === 0);
check('1 mouvement unknown', eco.kpis.unknown === 1);
check('créés par source', eco.tables.bySource[0].key === 'weekly_gift' && eco.tables.bySource[0].credits === 30);
check('consommés par usage', eco.tables.byUse.find((x) => x.key === 'booster/rare').credits === 45);
check('since = 1er mouvement', eco.since === '2026-09-01T08:00:00.000Z');

const ecoUser = economy({ ...f, user: 'UA' }, { db, boosterPrice: 20 });
check('filtre joueur : masse UA = 45', ecoUser.kpis.mass === 45 && ecoUser.kpis.created === 10);
const ecoSrc = economy({ ...f, source: 'booster' }, { db, boosterPrice: 20 });
check('filtre source : consommés booster = 85', ecoSrc.kpis.consumed === 85 && ecoSrc.kpis.created === 0);

bal.run('UA', 46);
check('écart ledger détecté', economy(f, { db, boosterPrice: 20 }).kpis.ledgerGap === 1);
bal.run('UA', 45);

// 🛒 Achats
const pu = purchases(f, { db });
check('4 achats, 110 crédits, 2 acheteurs', pu.kpis.purchases === 4 && pu.kpis.credits === 110 && pu.kpis.buyers === 2);
const common = pu.tables.items.find((x) => x.key === 'booster/common');
check('booster/common : 2 achats, 2 acheteurs', common.count === 2 && common.buyers === 2 && common.credits === 40);
check('classement par crédits', pu.tables.items[0].key === 'booster/rare');
check('familles', pu.tables.families.find((x) => x.family === 'booster').count === 3);
check('série par article', pu.series.byItem['booster/common'].join() === '0,2');

try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }   // Windows : fichier ouvert = non supprimable
fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n🎉 Stats Économie OK');
process.exit(failures ? 1 : 0);
