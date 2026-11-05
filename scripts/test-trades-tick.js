#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test échanges : minuterie et désinscription (v3.9, src/trades.js)
//
//  Modules purs, dans une COPIE temporaire du projet (aucune donnée
//  réelle touchée), horloge simulée (Paris, UTC+1 en novembre) :
//    • demande sans réponse → expirée, remboursée ;
//    • contre-offre plus tardive : la demande attend sa fin ;
//    • carte proposée ou mise aux enchères disparue → card_lost ;
//    • pause (week-end, congés) → demandes annulées, enchères non ;
//    • enchère réglée une seule fois au rattrapage ; tick idempotent ;
//    • désinscription : demandes et contre-offres annulées, mises gardées.
//
//  Usage : npx -y -p node@20 node scripts/test-trades-tick.js
// ═══════════════════════════════════════════════════════════
process.env.TRADES_DAILY_LIMIT = '1000';   // v4.1.1 : la limite de 2 demandes/jour a son propre test (test-trades-limit.js)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-tick-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

// ⏰ Horloge simulée : mardi 3/11 à 10h (Paris, UTC+1)
const RealDate = Date;
let NOW = RealDate.parse('2026-11-03T09:00:00Z');
global.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(NOW); }
  static now() { return NOW; }
};
const paris = (iso) => RealDate.parse(`${iso}+01:00`);   // heure de Paris en novembre
const MIN = 60000;
const HOUR = 3600000;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    console.log(`  ❌ ${name}\n     ${e.message}`);
    process.exitCode = 1;
  }
}
const req = (m) => require(path.join(TMP, 'src', m));

const trades = req('trades.js');
const collections = req('collections.js');
const credits = req('credits.js');
const broadcast = req('broadcast.js');
const leave = req('leave.js');
const cardIndex = req('cardIndex.js');
const { parisDay } = req('octobreRose.js');
const db = req('db.js');

const EPIC = cardIndex.listCards().find((c) => c.rarity === 'epic');
const COMMON = cardIndex.listCards().find((c) => c.rarity === 'common');
const card = (url, rarity, n) => Array.from({ length: n }, () => ({ url, rarity, title: url, type: 'image' }));
const count = (u, url) => collections.getCount(u, url);
const bal = (u) => credits.getBalance(u);
const moves = (u, source) => db.getDb().prepare('SELECT amount, ref FROM credit_moves WHERE user_id = ? AND source = ?').all(u, source);
const of = (events, id) => events.filter((e) => e.trade.id === id).map((e) => e.event);

for (const u of ['U_A', 'U_B', 'U_C', 'U_D', 'U_E']) {
  broadcast.subscribe(u);
  credits.addCredit(u, 100, { source: 'test' });
}
collections.addCards('U_A', card(EPIC.url, 'epic', 2));

console.log('\n🧪 Échanges : minuterie et désinscription (v3.9)\n');

test('demande sans réponse pendant 1 h 00 min 01 s → expired, remboursée', () => {
  assert.ok(EPIC && COMMON, 'cartes épique et commune dans la banque');
  const r = trades.createDirect({ buyer: 'U_B', seller: 'U_A', code: EPIC.code, jp: 5, now: NOW });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(bal('U_B'), 95);
  assert.deepStrictEqual(trades.tick(NOW + 59 * MIN), [], 'rien avant l\'heure');
  assert.strictEqual(trades.getTrade(r.trade.id).status, 'open');
  const ev = trades.tick(NOW + HOUR + 1000);
  assert.deepStrictEqual(of(ev, r.trade.id), ['expired']);
  const t = trades.getTrade(r.trade.id);
  assert.strictEqual(t.status, 'expired');
  assert.strictEqual(t.reason, 'expired');
  assert.strictEqual(bal('U_B'), 100, 'remboursé');
  assert.deepStrictEqual(moves('U_B', 'trade_refund'), [{ amount: 5, ref: `${r.trade.id}:refund` }]);
});

test('contre-offre ouverte plus tardive : la demande attend, puis expire après elle', () => {
  const t0 = NOW + 2 * HOUR;
  const r = trades.createDirect({ buyer: 'U_B', seller: 'U_A', code: EPIC.code, jp: 5, now: t0 });
  assert.ok(r.ok, JSON.stringify(r));
  const c = trades.counter(r.trade.id, 'U_A', { jp: 8 }, t0 + 30 * MIN);
  assert.ok(c.ok, JSON.stringify(c));

  assert.deepStrictEqual(trades.tick(t0 + HOUR + 1000), [], 'la contre-offre court encore');
  assert.strictEqual(trades.getTrade(r.trade.id).status, 'open');
  assert.strictEqual(trades.accept(r.trade.id, 'U_A', t0 + HOUR + 1000).error, 'expired', 'offre d\'origine expirée');

  const ev = trades.tick(t0 + 90 * MIN + 1000);
  assert.deepStrictEqual(of(ev, r.trade.id), ['counter_expired', 'expired']);
  const t = trades.getTrade(r.trade.id);
  assert.strictEqual(t.status, 'expired');
  assert.strictEqual(t.counters.U_A.status, 'expired');
  assert.strictEqual(bal('U_B'), 100, 'remboursé');
});

test('demande générale : contre-offre acceptable jusqu\'à sa fin, puis tout expire', () => {
  const t0 = NOW + 4 * HOUR;
  const r = trades.createGeneral({ buyer: 'U_C', code: EPIC.code, jp: 6, now: t0 });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(trades.counter(r.trade.id, 'U_A', { jp: 9 }, t0 + 10 * MIN).ok);
  assert.deepStrictEqual(trades.tick(t0 + HOUR), [], 'la contre-offre court encore');
  assert.strictEqual(trades.getTrade(r.trade.id).status, 'open');
  const ev = trades.tick(t0 + 70 * MIN);
  assert.deepStrictEqual(of(ev, r.trade.id), ['counter_expired', 'expired']);
  assert.strictEqual(ev[0].counter, 'U_A', 'auteur de la contre-offre');
  assert.strictEqual(trades.getTrade(r.trade.id).counters.U_A.status, 'expired');
  assert.strictEqual(trades.acceptCounter(r.trade.id, 'U_C', 'U_A', t0 + 70 * MIN).error, 'closed');
  assert.strictEqual(bal('U_C'), 100);
});

test('carte proposée volée → cancelled/card_lost, la plus ancienne demande garde sa carte', () => {
  const t0 = NOW + 6 * HOUR;
  collections.addCards('U_B', card('xb', 'common', 2));
  const r1 = trades.createDirect({ buyer: 'U_B', seller: 'U_A', code: EPIC.code, jp: 2, cards: ['xb'], now: t0 });
  const r2 = trades.createDirect({ buyer: 'U_B', seller: 'U_A', code: EPIC.code, jp: 3, cards: ['xb'], now: t0 + 1000 });
  assert.ok(r1.ok && r2.ok, JSON.stringify([r1, r2]));
  assert.strictEqual(bal('U_B'), 95);
  collections.removeCards('U_B', ['xb']);   // raid simulé

  const ev = trades.tick(t0 + 2000);
  assert.deepStrictEqual(ev.map((e) => [e.trade.id, e.event, e.reason]), [[r2.trade.id, 'cancelled', 'card_lost']]);
  assert.strictEqual(trades.getTrade(r1.trade.id).status, 'open', 'la plus ancienne reste');
  assert.strictEqual(trades.getTrade(r2.trade.id).status, 'cancelled');
  assert.strictEqual(trades.getTrade(r2.trade.id).reason, 'card_lost');
  assert.strictEqual(bal('U_B'), 98, 'les 3 JP$ rendus');

  collections.removeCards('U_B', ['xb']);
  const ev2 = trades.tick(t0 + 3000);
  assert.deepStrictEqual(ev2.map((e) => [e.trade.id, e.event, e.reason]), [[r1.trade.id, 'cancelled', 'card_lost']]);
  assert.strictEqual(bal('U_B'), 100);
});

test('carte mise aux enchères volée → enchère cancelled/card_lost, meilleur enchérisseur remboursé', () => {
  const t0 = NOW + 7 * HOUR;
  const r = trades.createAuction({ seller: 'U_A', code: EPIC.code, startPrice: 5, now: t0 });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(trades.bid(r.trade.id, 'U_C', 10, t0).ok);
  assert.strictEqual(bal('U_C'), 90);
  collections.removeCards('U_A', [EPIC.url]);
  assert.deepStrictEqual(trades.tick(t0 + 1000), [], 'il reste un exemplaire pour l\'enchère');
  collections.removeCards('U_A', [EPIC.url]);
  assert.strictEqual(count('U_A', EPIC.url), 0);

  const ev = trades.tick(t0 + 2000);
  assert.deepStrictEqual(ev.map((e) => [e.trade.id, e.event, e.reason]), [[r.trade.id, 'cancelled', 'card_lost']]);
  assert.strictEqual(trades.getTrade(r.trade.id).status, 'cancelled');
  assert.strictEqual(bal('U_C'), 100, 'remboursé');
  assert.strictEqual(count('U_C', EPIC.url), 0, 'aucune carte fantôme');
  collections.addCards('U_A', card(EPIC.url, 'epic', 2));
});

test('enchère arrivée à échéance : réglée une seule fois au rattrapage', () => {
  const t0 = paris('2026-11-04T10:00:00');   // mercredi
  const r = trades.createAuction({ seller: 'U_A', code: EPIC.code, startPrice: 5, now: t0 });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(trades.bid(r.trade.id, 'U_D', 7, t0).ok);
  assert.deepStrictEqual(trades.tick(r.trade.endsAt - 1), []);
  // Bot redémarré bien après la fin
  const late = r.trade.endsAt + 5 * HOUR;
  const ev = trades.tick(late);
  assert.deepStrictEqual(ev.map((e) => [e.trade.id, e.event, e.outcome]), [[r.trade.id, 'settled', 'sold']]);
  assert.strictEqual(trades.getTrade(r.trade.id).status, 'done');
  assert.strictEqual(count('U_D', EPIC.url), 1);
  assert.strictEqual(bal('U_D'), 93);
  assert.deepStrictEqual(trades.tick(late), [], 'deuxième tick au même instant : rien');
  assert.strictEqual(moves('U_A', 'trade_sale').length, 1, 'payé une seule fois');
});

test('deux tick successifs au même instant : le 2ᵉ ne renvoie rien', () => {
  const t0 = paris('2026-11-05T10:00:00');   // jeudi
  const r = trades.createDirect({ buyer: 'U_B', seller: 'U_A', code: EPIC.code, jp: 5, now: t0 });
  assert.ok(r.ok, JSON.stringify(r));
  const at = t0 + HOUR;
  assert.deepStrictEqual(of(trades.tick(at), r.trade.id), ['expired']);
  assert.deepStrictEqual(trades.tick(at), []);
  assert.strictEqual(bal('U_B'), 100, 'remboursé une seule fois');
});

test('demande du vendredi 23 h 30, tick le samedi à 0 h 01 → cancelled/pause', () => {
  const fri = paris('2026-11-06T23:30:00');
  const r = trades.createDirect({ buyer: 'U_B', seller: 'U_A', code: EPIC.code, jp: 5, now: fri });
  assert.ok(r.ok, JSON.stringify(r));
  const g = trades.createGeneral({ buyer: 'U_E', code: EPIC.code, jp: 5, now: fri });
  assert.ok(g.ok, JSON.stringify(g));
  assert.deepStrictEqual(trades.tick(fri + 10 * MIN), []);
  const ev = trades.tick(paris('2026-11-07T00:01:00'));
  assert.deepStrictEqual(ev.map((e) => [e.trade.id, e.event, e.reason]),
    [[r.trade.id, 'cancelled', 'pause'], [g.trade.id, 'cancelled', 'pause']]);
  assert.strictEqual(bal('U_B'), 100);
  assert.strictEqual(bal('U_E'), 100);
});

test('congés d\'une partie : demande annulée (pause), l\'enchère du vendeur continue', () => {
  const t0 = paris('2026-11-10T10:00:00');   // mardi
  const r = trades.createDirect({ buyer: 'U_B', seller: 'U_A', code: EPIC.code, jp: 5, now: t0 });
  const a = trades.createAuction({ seller: 'U_A', code: EPIC.code, startPrice: 5, now: t0 });
  assert.ok(r.ok && a.ok, JSON.stringify([r, a]));
  assert.ok(leave.declareLeave('U_A', parisDay(t0), parisDay(t0), t0).ok);
  const ev = trades.tick(t0 + MIN);
  assert.deepStrictEqual(ev.map((e) => [e.trade.id, e.event, e.reason]), [[r.trade.id, 'cancelled', 'pause']]);
  assert.strictEqual(trades.getTrade(a.trade.id).status, 'open', 'enchère non annulée');
  leave.endLeave('U_A', t0 + MIN);
  // Fin de l'enchère : sans mise, la carte reste au vendeur
  const ev2 = trades.tick(a.trade.endsAt);
  assert.deepStrictEqual(ev2.map((e) => [e.trade.id, e.event, e.outcome]), [[a.trade.id, 'settled', 'no_bid']]);
});

test('onUnsubscribe(A) : ses demandes et contre-offres annulées, son enchère sur la carte de C reste', () => {
  const t0 = paris('2026-11-12T10:00:00');   // jeudi
  collections.addCards('U_D', card(COMMON.url, 'common', 1));
  collections.addCards('U_A', card(COMMON.url, 'common', 1));
  collections.addCards('U_C', card(EPIC.url, 'epic', 1));
  const mine = trades.createDirect({ buyer: 'U_A', seller: 'U_D', code: COMMON.code, jp: 3, now: t0 });
  const toMe = trades.createDirect({ buyer: 'U_E', seller: 'U_A', code: EPIC.code, jp: 6, now: t0 });
  const gen = trades.createGeneral({ buyer: 'U_E', code: COMMON.code, jp: 2, now: t0 });
  const auc = trades.createAuction({ seller: 'U_C', code: EPIC.code, startPrice: 5, now: t0 });
  assert.ok(mine.ok && toMe.ok && gen.ok && auc.ok, JSON.stringify([mine, toMe, gen, auc]));
  assert.ok(trades.counter(gen.trade.id, 'U_A', { jp: 4 }, t0).ok);
  assert.ok(trades.bid(auc.trade.id, 'U_A', 8, t0).ok);
  const aBefore = bal('U_A');
  const eBefore = bal('U_E');

  const ev = trades.onUnsubscribe('U_A', t0 + MIN);
  assert.deepStrictEqual(ev.map((e) => [e.trade.id, e.event, e.reason]), [
    [mine.trade.id, 'cancelled', 'unsubscribed'],
    [toMe.trade.id, 'cancelled', 'unsubscribed'],
    [gen.trade.id, 'counter_cancelled', 'unsubscribed'],
  ]);
  assert.strictEqual(trades.getTrade(mine.trade.id).status, 'cancelled');
  assert.strictEqual(trades.getTrade(toMe.trade.id).status, 'cancelled');
  assert.strictEqual(bal('U_A'), aBefore + 3, 'A remboursé de sa demande');
  assert.strictEqual(bal('U_E'), eBefore + 6, 'E remboursé de sa demande à A');
  const g = trades.getTrade(gen.trade.id);
  assert.strictEqual(g.status, 'open', 'la demande générale continue');
  assert.strictEqual(g.counters.U_A.status, 'cancelled');
  const a = trades.getTrade(auc.trade.id);
  assert.strictEqual(a.status, 'open', 'enchère maintenue');
  assert.deepStrictEqual(a.held, { U_A: 8 }, 'mise de A toujours en réserve');
  assert.deepStrictEqual(trades.onUnsubscribe('U_A', t0 + MIN), [], 'idempotent');
});

try { db.close(); } catch { /* base jamais ouverte */ }
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows */ }
console.log(process.exitCode ? '\n❌ Échec' : `\n✅ Tout est bon (${passed})`);
