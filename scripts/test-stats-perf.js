#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Performance des stats : un an d'historique ne doit pas bloquer
//  le bot (même thread que les acks Slack et la boucle de l'Arène).
//  300 000 mouvements de crédits + 300 000 réactions sur 365 jours.
//  Usage : node scripts/test-stats-perf.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-stats-perf-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}
const req = (p) => require(path.join(TMP, 'src', p));
const db = req('db.js').getDb();
const stats = req('stats/index.js');

const N = 300000;
const END = Date.parse('2026-09-29T12:00:00Z');
const START = END - 365 * 864e5;
const users = Array.from({ length: 60 }, (_, i) => `U${String(i).padStart(3, '0')}`);
const insMove = db.prepare('INSERT INTO credit_moves (at, user_id, amount, kind, source, item) VALUES (?, ?, ?, ?, ?, ?)');
const insEvent = db.prepare("INSERT INTO events (at, type, user_id, data) VALUES (?, 'reaction', ?, '{}')");
db.transaction(() => {
  for (const u of users) insMove.run(new Date(START).toISOString(), u, 50, 'opening', 'migration', null);
  for (let i = 0; i < N; i += 1) {
    const at = new Date(START + Math.floor((i / N) * 365 * 864e5)).toISOString();
    const u = users[i % users.length];
    if (Math.floor(i / users.length) % 10 === 0) insMove.run(at, u, -0.5, 'spend', 'booster', 'common');
    else insMove.run(at, u, 0.5, 'earn', 'reaction', null);
    insEvent.run(at, u);
  }
  const bal = db.prepare('INSERT INTO balances (user_id, balance) SELECT user_id, SUM(amount) FROM credit_moves GROUP BY user_id');
  bal.run();
})();

const time = (fn) => { const t = process.hrtime.bigint(); const r = fn(); return { r, ms: Number(process.hrtime.bigint() - t) / 1e6 }; };
const LIMIT_MS = 800;
for (const [label, from] of [['30 j', END - 30 * 864e5], ['365 j', START]]) {
  for (const block of ['economy', 'purchases', 'activity']) {
    const { r, ms } = time(() => stats.run(block, { from: new Date(from).toISOString(), to: new Date(END).toISOString(), grain: 'day' }, { db, boosterPrice: 20, now: END }));
    check(`${block} sur ${label} : ${ms.toFixed(0)} ms < ${LIMIT_MS} ms`, ms < LIMIT_MS && r.kpis);
  }
}

// Les résultats restent exacts : masse finale = somme des soldes
const eco = stats.run('economy', { from: new Date(START).toISOString(), to: new Date(END).toISOString(), grain: 'week' }, { db, boosterPrice: 20, now: END });
const sumBal = db.prepare('SELECT SUM(balance) s FROM balances').get().s;
check(`masse finale = somme des soldes (${eco.kpis.mass} / ${sumBal})`, Math.abs(eco.kpis.mass - sumBal) < 0.01);
check('écart ledger = 0', eco.kpis.ledgerGap === 0);
const act = stats.run('activity', { from: new Date(START).toISOString(), to: new Date(END).toISOString(), grain: 'month' }, { db, now: END });
check(`toutes les réactions comptées (${act.kpis.reactions})`, act.kpis.reactions === N);

try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }   // Windows : fichier ouvert = non supprimable
fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n🎉 Stats rapides OK');
process.exit(failures ? 1 : 0);
