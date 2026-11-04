#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test échanges : enchères (v3.9, src/trades.js)
//
//  Modules purs, dans une COPIE temporaire du projet (aucune donnée
//  réelle touchée), horloge simulée (Paris, UTC+1 en novembre) :
//    • fin d'enchère (12 h, repoussée au 10 h suivant la nuit) ;
//    • lancement : plancher, vendeur bloqué, fin pendant une pause ;
//    • enchères : surenchère, remboursement, déjà le meilleur, trop bas,
//      sur sa propre carte, solde, enchérisseur en congés, enchère finie ;
//    • carte réservée pendant l'enchère (échanges + revente) ;
//    • règlement : vendue (une seule fois), sans enchère, carte disparue.
//
//  Usage : npx -y -p node@20 node scripts/test-trades-auction.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-auction-'));
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
const resale = req('resale.js');
const collections = req('collections.js');
const credits = req('credits.js');
const broadcast = req('broadcast.js');
const leave = req('leave.js');
const cardIndex = req('cardIndex.js');
const { parisDay } = req('octobreRose.js');
const db = req('db.js');

const EPIC = cardIndex.listCards().find((c) => c.rarity === 'epic');
const COMMON = cardIndex.listCards().find((c) => c.rarity === 'common');
const count = (u, url) => collections.getCount(u, url);
const moves = (u, source) => db.getDb().prepare('SELECT amount, ref FROM credit_moves WHERE user_id = ? AND source = ?').all(u, source);
const inSellable = (u, url) => Object.values(resale.sellable(u)).some((list) => list.some((c) => c.url === url));

for (const u of ['U_A', 'U_B', 'U_C', 'U_D']) broadcast.subscribe(u);
credits.addCredit('U_B', 50, { source: 'test' });
credits.addCredit('U_C', 50, { source: 'test' });
credits.addCredit('U_D', 50, { source: 'test' });
const EPIC_CARD = { url: EPIC.url, title: EPIC.title, rarity: 'epic', type: 'image' };
collections.addCards('U_A', [EPIC_CARD, EPIC_CARD]);

console.log('\n🧪 Échanges : enchères (v3.9)\n');

test('fin d\'enchère : 12 h, la nuit repoussée au 10 h suivant', () => {
  assert.ok(EPIC && COMMON, 'cartes épique et commune dans la banque');
  // mardi 9h → mardi 21h → mercredi 10h
  assert.strictEqual(trades.auctionEnd(paris('2026-11-03T09:00:00')), paris('2026-11-04T10:00:00'));
  // mardi 7h30 → mardi 19h30, inchangé
  assert.strictEqual(trades.auctionEnd(paris('2026-11-03T07:30:00')), paris('2026-11-03T19:30:00'));
  // mardi 8h → 20h pile : repoussée
  assert.strictEqual(trades.auctionEnd(paris('2026-11-03T08:00:00')), paris('2026-11-04T10:00:00'));
  // mardi 20h30 → mercredi 8h30 : repoussée au même matin 10h
  assert.strictEqual(trades.auctionEnd(paris('2026-11-03T20:30:00')), paris('2026-11-04T10:00:00'));
  // mardi 21h → mercredi 9h pile : inchangé
  assert.strictEqual(trades.auctionEnd(paris('2026-11-03T21:00:00')), paris('2026-11-04T09:00:00'));
  // vendredi 11h → samedi 10h
  assert.strictEqual(trades.auctionEnd(paris('2026-11-06T11:00:00')), paris('2026-11-07T10:00:00'));
  // passage à l'heure d'hiver (25/10) : samedi 24/10 13h (UTC+2) → dimanche 25/10 10h (UTC+1)
  assert.strictEqual(trades.auctionEnd(RealDate.parse('2026-10-24T13:00:00+02:00')), RealDate.parse('2026-10-25T10:00:00+01:00'));
});

test('lancement refusé : fin pendant le week-end, plancher, vendeur bloqué, carte absente', () => {
  const fri = paris('2026-11-06T11:00:00');
  assert.deepStrictEqual(trades.createAuction({ seller: 'U_A', code: EPIC.code, startPrice: 10, now: fri }), { ok: false, error: 'ends_in_pause' });
  assert.deepStrictEqual(trades.createAuction({ seller: 'U_A', code: EPIC.code, startPrice: 4, now: NOW }), { ok: false, error: 'floor' });
  assert.deepStrictEqual(trades.createAuction({ seller: 'U_A', code: COMMON.code, startPrice: 5, now: NOW }), { ok: false, error: 'unavailable' });
  assert.deepStrictEqual(trades.createAuction({ seller: 'U_A', code: 'ZZ9', startPrice: 5, now: NOW }), { ok: false, error: 'unavailable' });
  broadcast.unsubscribe('U_A');
  assert.deepStrictEqual(trades.createAuction({ seller: 'U_A', code: EPIC.code, startPrice: 10, now: NOW }), { ok: false, error: 'blocked_seller' });
  broadcast.subscribe('U_A');
  assert.strictEqual(Object.keys(trades._load().trades).length, 0, 'aucune enchère créée');
});

let auc;
test('lancement : enchère ouverte, destinataires = inscrits sauf le vendeur', () => {
  assert.strictEqual(trades.cessible('U_A').get(EPIC.url), 2);
  assert.ok(inSellable('U_A', EPIC.url));
  const r = trades.createAuction({ seller: 'U_A', code: EPIC.code, startPrice: 10, now: NOW });
  assert.ok(r.ok, JSON.stringify(r));
  auc = r.trade;
  assert.strictEqual(auc.kind, 'auction');
  assert.strictEqual(auc.seller, 'U_A');
  assert.strictEqual(auc.startPrice, 10);
  assert.strictEqual(auc.status, 'open');
  assert.strictEqual(auc.card.code, EPIC.code);
  // mardi 10h + 12 h = 22h → mercredi 10h
  assert.strictEqual(auc.endsAt, paris('2026-11-04T10:00:00'));
  assert.deepStrictEqual([...r.recipients].sort(), ['U_B', 'U_C', 'U_D']);
});

test('pendant l\'enchère : la carte est réservée (échanges et revente)', () => {
  assert.strictEqual(trades.cessible('U_A').get(EPIC.url), 1, '2 − 1 réservée');
  assert.ok(!inSellable('U_A', EPIC.url), '2 − 1 réservée − 1 gardée');
  assert.strictEqual(trades.openTradesOf('U_A').length, 1);
});

test('enchères : B 10, C 11 → B remboursé ; déjà le meilleur ; trop bas ; soi-même', () => {
  assert.deepStrictEqual(trades.bid(auc.id, 'U_B', 9, NOW).error, 'too_low', 'sous le prix de départ');
  const b = trades.bid(auc.id, 'U_B', 10, NOW);
  assert.ok(b.ok, JSON.stringify(b));
  assert.strictEqual(b.outbid, null);
  assert.strictEqual(credits.getBalance('U_B'), 40);
  assert.deepStrictEqual(trades.getTrade(auc.id).held, { U_B: 10 });

  assert.strictEqual(trades.bid(auc.id, 'U_C', 10, NOW).error, 'too_low', 'il faut au moins 11');
  const c = trades.bid(auc.id, 'U_C', 11, NOW);
  assert.ok(c.ok, JSON.stringify(c));
  assert.strictEqual(c.outbid, 'U_B');
  assert.strictEqual(credits.getBalance('U_B'), 50, 'B remboursé');
  assert.strictEqual(credits.getBalance('U_C'), 39);
  assert.deepStrictEqual(moves('U_B', 'trade_hold'), [{ amount: -10, ref: `${auc.id}#0` }]);
  assert.deepStrictEqual(moves('U_B', 'trade_refund'), [{ amount: 10, ref: `${auc.id}#0:refund` }]);
  assert.deepStrictEqual(trades.getTrade(auc.id).held, { U_C: 11 });

  assert.strictEqual(trades.bid(auc.id, 'U_C', 15, NOW).error, 'already_best');
  assert.strictEqual(trades.bid(auc.id, 'U_D', 11, NOW).error, 'too_low');
  assert.strictEqual(trades.bid(auc.id, 'U_A', 20, NOW).error, 'self');
  assert.strictEqual(trades.bid(auc.id, 'U_D', 1000, NOW).error, 'balance');
  assert.strictEqual(trades.bid('nope', 'U_D', 20, NOW).error, 'not_found');
  assert.strictEqual(credits.getBalance('U_C'), 39, 'aucun débit sur un refus');
  assert.strictEqual(credits.getBalance('U_D'), 50, 'aucun débit sur un refus');
  assert.strictEqual(trades.getTrade(auc.id).bids.length, 2);
  assert.strictEqual(trades.openTradesOf('U_B').length, 1, 'B a enchéri');
});

test('enchérisseur en congés : bloqué ; vendeur en congés : l\'enchère continue', () => {
  const day = parisDay(NOW);
  assert.ok(leave.declareLeave('U_D', day, day, NOW).ok);
  assert.strictEqual(trades.bid(auc.id, 'U_D', 20, NOW).error, 'blocked');
  leave.endLeave('U_D', NOW);
  broadcast.unsubscribe('U_D');
  assert.strictEqual(trades.bid(auc.id, 'U_D', 20, NOW).error, 'blocked');
  broadcast.subscribe('U_D');
  assert.ok(leave.declareLeave('U_A', day, day, NOW).ok);
  const d = trades.bid(auc.id, 'U_D', 12, NOW);
  assert.ok(d.ok, JSON.stringify(d));
  assert.strictEqual(d.outbid, 'U_C');
  assert.strictEqual(credits.getBalance('U_C'), 50, 'C remboursé');
  leave.endLeave('U_A', NOW);
  // C reprend la tête à 13
  const c = trades.bid(auc.id, 'U_C', 13, NOW);
  assert.ok(c.ok && c.outbid === 'U_D', JSON.stringify(c));
  assert.strictEqual(credits.getBalance('U_D'), 50);
});

test('règlement : rien avant la fin ; enchère finie → ended', () => {
  const before = trades.settleAuction(auc.id, auc.endsAt - 1);
  assert.strictEqual(before.ok, false);
  assert.strictEqual(trades.getTrade(auc.id).status, 'open');
  assert.strictEqual(trades.bid(auc.id, 'U_B', 30, auc.endsAt).error, 'ended');
  assert.strictEqual(credits.getBalance('U_B'), 50);
});

test('règlement après la fin : vendue à C, A touche 13, une seule fois', () => {
  const sellerBefore = credits.getBalance('U_A');
  const r = trades.settleAuction(auc.id, auc.endsAt);
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.outcome, 'sold');
  assert.strictEqual(r.trade.status, 'done');
  assert.strictEqual(r.trade.buyer, 'U_C');
  assert.strictEqual(count('U_C', EPIC.url), 1);
  assert.strictEqual(count('U_A', EPIC.url), 1);
  assert.strictEqual(credits.getBalance('U_A'), sellerBefore + 13);
  assert.deepStrictEqual(moves('U_A', 'trade_sale'), [{ amount: 13, ref: `${auc.id}:sale` }]);
  assert.strictEqual(credits.getBalance('U_C'), 37);
  assert.deepStrictEqual(trades.getTrade(auc.id).held, {});
  assert.deepStrictEqual(trades.settleAuction(auc.id, auc.endsAt), { ok: false, error: 'closed' });
  assert.strictEqual(credits.getBalance('U_A'), sellerBefore + 13, 'pas de double paiement');
  assert.strictEqual(trades.bid(auc.id, 'U_D', 50, auc.endsAt - 1).error, 'closed');
});

test('sans enchère : no_bid, la carte reste au vendeur', () => {
  const r = trades.createAuction({ seller: 'U_A', code: EPIC.code, startPrice: 5, now: NOW });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(trades.cessible('U_A').get(EPIC.url) || 0, 0, 'dernier exemplaire réservé');
  const s = trades.settleAuction(r.trade.id, r.trade.endsAt);
  assert.ok(s.ok, JSON.stringify(s));
  assert.strictEqual(s.outcome, 'no_bid');
  assert.strictEqual(trades.getTrade(r.trade.id).status, 'expired');
  assert.strictEqual(count('U_A', EPIC.url), 1);
  assert.strictEqual(trades.cessible('U_A').get(EPIC.url), 1, 'carte de nouveau libre');
});

test('pendant une pause : le règlement attend', () => {
  const r = trades.createAuction({ seller: 'U_A', code: EPIC.code, startPrice: 5, now: NOW });
  assert.ok(r.ok);
  const sat = paris('2026-11-07T12:00:00');
  assert.strictEqual(trades.settleAuction(r.trade.id, sat).ok, false);
  assert.strictEqual(trades.getTrade(r.trade.id).status, 'open');
  const s = trades.settleAuction(r.trade.id, paris('2026-11-09T10:00:00'));
  assert.strictEqual(s.outcome, 'no_bid');
});

test('carte disparue avant la fin : cancelled, le gagnant est remboursé', () => {
  const r = trades.createAuction({ seller: 'U_A', code: EPIC.code, startPrice: 5, now: NOW });
  assert.ok(r.ok);
  assert.ok(trades.bid(r.trade.id, 'U_B', 6, NOW).ok);
  assert.strictEqual(credits.getBalance('U_B'), 44);
  collections.removeCards('U_A', [EPIC.url]);
  const s = trades.settleAuction(r.trade.id, r.trade.endsAt);
  assert.ok(s.ok, JSON.stringify(s));
  assert.strictEqual(s.outcome, 'cancelled');
  assert.strictEqual(trades.getTrade(r.trade.id).status, 'cancelled');
  assert.strictEqual(credits.getBalance('U_B'), 50);
  assert.strictEqual(count('U_B', EPIC.url), 0);
});

try { db.close(); } catch { /* base jamais ouverte */ }
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows */ }
console.log(process.exitCode ? '\n❌ Échec' : `\n✅ Tout est bon (${passed})`);
