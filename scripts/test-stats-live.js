#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test des stats Tickets à gratter, Fortunes et En direct
//  (src/stats/live.js, v3.6)
//  Usage : node scripts/test-stats-live.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-stats-live-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}
const req = (p) => require(path.join(TMP, 'src', p));
const stats = req('stats/index.js');
const db = req('db.js').getDb();

const ev = db.prepare('INSERT INTO events (at, type, user_id, data) VALUES (?, ?, ?, ?)');
const mv = db.prepare('INSERT INTO credit_moves (at, user_id, amount, kind, source, item) VALUES (?, ?, ?, ?, ?, ?)');
const bal = db.prepare('INSERT INTO balances (user_id, balance) VALUES (?, ?)');
const ticket = (at, u, outcome, symbol, amount, card = null) => ev.run(at, 'scratch_ticket', u, JSON.stringify({ price: 5, outcome, symbol, amount, card }));

ticket('2026-10-13T08:00:00.000Z', 'UA', 'lose', null, 0);
ticket('2026-10-13T09:00:00.000Z', 'UA', 'jp', 'boot', 10);
ticket('2026-10-14T09:00:00.000Z', 'UB', 'legendary', 'trophy', 0, { title: '🟡 Surprise #1', rarity: 'legendary' });
ticket('2026-10-14T10:00:00.000Z', 'UB', 'jp', 'posts', 200);
ev.run('2026-10-14T10:30:00.000Z', 'reaction', 'UA', '{}');
ev.run('2026-10-14T10:31:00.000Z', 'booster_bought', 'UA', JSON.stringify({ boosterType: 'epic', price: 60 }));
ev.run('2026-10-14T10:32:00.000Z', 'match_finished', null, JSON.stringify({ result: 'win', players: [{ userId: 'UA', outcome: 'win', deck: [{ url: 'x' }] }, { userId: 'UB', outcome: 'loss', deck: [] }] }));
mv.run('2026-10-14T10:33:00.000Z', 'UB', 20, 'earn', 'weekly_gift', null);
mv.run('2026-10-14T10:34:00.000Z', 'UA', 1, 'earn', 'reaction', null);
bal.run('UA', 300);
bal.run('UB', 100);
bal.run('UC', 0);

const f = { from: '2026-10-12T00:00:00.000Z', to: '2026-10-18T23:00:00.000Z', grain: 'day' };

// 🎟️ Tickets
const s = stats.run('scratch', f);
check('4 tickets, 20 JP$ misés, 210 gagnés', s.kpis.tickets === 4 && s.kpis.staked === 20 && s.kpis.won === 210);
check('taux de retour 1050 %, 3 gagnants sur 4', s.kpis.rtpPct === 1050 && s.kpis.winRatePct === 75);
check('1 légendaire, 2 joueurs', s.kpis.cards === 1 && s.kpis.players === 2);
check('plus gros lot : la légendaire, puis les Poteaux', s.tables.biggest[0].card && s.tables.biggest[1].amount === 200);
check('résultats par lot', s.tables.outcomes.find((o) => o.key === 'credits/posts').credits === 200);
check('bilan par joueur', s.tables.players.find((p) => p.userId === 'UB').net === 190);
check(`série par jour (${s.series.labels.join()} → ${s.series.staked.join()})`, s.series.staked.join() === '0,10,10,0,0,0,0,0');   // 23h UTC le 18 = le 19 à Paris : 8 jours
check('période précédente comparée', s.prevKpis.tickets === 0);
check('filtre joueur', stats.run('scratch', { ...f, user: 'UA' }).kpis.tickets === 2);

// 🏦 Fortunes
const fortunes = stats.run('economy', f).tables.fortunes;
check('fortunes triées, soldes à 0 exclus, part de la masse', fortunes.length === 2 && fortunes[0].userId === 'UA' && fortunes[0].sharePct === 75);

// 📡 En direct
const l = stats.run('live', { ...f }, { now: Date.parse('2026-10-14T11:00:00.000Z') });
const types = l.tables.feed.map((e) => e.type);
check('fil : plus récent d\'abord, sans les réactions', types[0] === 'credit_weekly_gift' && !types.includes('reaction') && !types.includes('credit_reaction'));
check('fil : 10 lignes maximum', l.tables.feed.length <= 10 && l.tables.feed.length === 7);
check('fil : combat résumé, sans les decks', JSON.stringify(l.tables.feed.find((e) => e.type === 'match_finished').data) === JSON.stringify({ result: 'win', players: [{ userId: 'UA', outcome: 'win' }, { userId: 'UB', outcome: 'loss' }] }));
check('réactions : dernière heure et 24 h', l.kpis.reactionsHour === 1 && l.kpis.reactionsDay === 1);
check('pas de période précédente pour le direct', l.prevKpis === undefined);

try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }
fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n🎉 Stats Tickets / Fortunes / Direct OK');
process.exit(failures ? 1 : 0);
