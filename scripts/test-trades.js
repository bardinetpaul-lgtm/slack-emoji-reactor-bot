#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test échanges : demande à une personne (v3.9, src/trades.js)
//
//  Modules purs, dans une COPIE temporaire du projet (aucune donnée
//  réelle touchée), horloge simulée un mardi à 10h (Paris) :
//    • cartes cessibles (dernier exemplaire oui, deck non) ;
//    • plancher en JP$, échange carte contre carte sans plancher ;
//    • joueurs bloqués (non inscrit, congés), demande à soi-même ;
//    • réservation des cartes proposées (échanges + revente) ;
//    • accepter (une seule fois), refuser, carte disparue.
//
//  Usage : npx -y -p node@20 node scripts/test-trades.js
// ═══════════════════════════════════════════════════════════
process.env.TRADES_DAILY_LIMIT = '1000';   // v4.1.1 : la limite de 2 demandes/jour a son propre test (test-trades-limit.js)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-trades-'));
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
const arenaStore = req(path.join('game', 'arenaStore.js'));
const { parisDay } = req('octobreRose.js');
const db = req('db.js');

const HW1 = cardIndex.byCode('HW1');
const card = (url, rarity, n) => Array.from({ length: n }, () => ({ url, rarity, title: url, type: 'image' }));
const count = (u, url) => collections.getCount(u, url);
const moves = (u, source) => db.getDb().prepare('SELECT amount, ref FROM credit_moves WHERE user_id = ? AND source = ?').all(u, source);

broadcast.subscribe('U_A');
broadcast.subscribe('U_B');
credits.addCredit('U_A', 120, { source: 'test' });
collections.addCards('U_B', [{ ...HW1 }, ...card('cb', 'common', 3)]);
collections.addCards('U_A', card('ca', 'common', 2));
arenaStore.setDecks('U_B', { active: 0, decks: [{ cards: ['cb'] }, {}, {}] });

console.log('\n🧪 Échanges : demande à une personne (v3.9)\n');

test('constantes et plancher', () => {
  assert.strictEqual(trades.REQUEST_MS, 3600000);
  assert.strictEqual(trades.AUCTION_MS, 43200000);
  assert.strictEqual(trades.floor('common'), 1);
  assert.strictEqual(trades.floor('rare'), 2);
  assert.strictEqual(trades.floor('halloween'), 30);
  assert.strictEqual(trades.floor('legendary'), 20);
  assert.strictEqual(trades.floor('extra'), 1);
  assert.strictEqual(trades.floor(undefined), 1);
});

test('cessible : dernier exemplaire oui, exemplaire du deck non', () => {
  const c = trades.cessible('U_B');
  assert.strictEqual(c.get(HW1.url), 1);
  assert.strictEqual(c.get('cb'), 2);
});

let tradeHW;
test('plancher : 29 JP$ refusé, 30 JP$ accepté et mis en réserve', () => {
  const r9 = trades.createDirect({ buyer: 'U_A', seller: 'U_B', code: 'HW1', jp: 29, cards: [], now: NOW });
  assert.deepStrictEqual(r9, { ok: false, error: 'floor' });
  assert.strictEqual(credits.getBalance('U_A'), 120);
  const r = trades.createDirect({ buyer: 'U_A', seller: 'U_B', code: 'HW1', jp: 30, cards: [], now: NOW });
  assert.ok(r.ok, JSON.stringify(r));
  tradeHW = r.trade;
  assert.strictEqual(credits.getBalance('U_A'), 90);
  assert.deepStrictEqual(moves('U_A', 'trade_hold'), [{ amount: -30, ref: `${tradeHW.id}:hold` }]);
  assert.strictEqual(tradeHW.status, 'open');
  assert.strictEqual(tradeHW.kind, 'direct');
  assert.strictEqual(tradeHW.card.code, 'HW1');
  assert.strictEqual(tradeHW.expiresAt, NOW + trades.REQUEST_MS);
  assert.deepStrictEqual(trades.getTrade(tradeHW.id).offer, { jp: 30, cards: [] });
});

let tradeSwap;
test('carte contre carte sans JP$ : pas de plancher', () => {
  const r = trades.createDirect({ buyer: 'U_A', seller: 'U_B', code: 'HW1', jp: 0, cards: ['ca'], now: NOW });
  assert.ok(r.ok, JSON.stringify(r));
  tradeSwap = r.trade;
  assert.strictEqual(credits.getBalance('U_A'), 90, 'aucun JP$ réservé');
});

test('refus : non inscrit, congés, soi-même, offre vide, carte inconnue, solde', () => {
  broadcast.unsubscribe('U_A');
  assert.strictEqual(trades.createDirect({ buyer: 'U_A', seller: 'U_B', code: 'HW1', jp: 10, cards: [], now: NOW }).error, 'blocked_buyer');
  assert.strictEqual(trades.blockReason('U_A', NOW), 'not_subscribed');
  broadcast.subscribe('U_A');
  assert.strictEqual(trades.createDirect({ buyer: 'U_A', seller: 'U_A', code: 'HW1', jp: 10, cards: [], now: NOW }).error, 'self');
  assert.strictEqual(trades.createDirect({ buyer: 'U_A', seller: 'U_B', code: 'HW1', jp: 0, cards: [], now: NOW }).error, 'empty');
  assert.strictEqual(trades.createDirect({ buyer: 'U_A', seller: 'U_B', code: 'ZZ9', jp: 10, cards: [], now: NOW }).error, 'unavailable');
  assert.strictEqual(trades.createDirect({ buyer: 'U_A', seller: 'U_B', code: 'HW1', jp: 1000, cards: [], now: NOW }).error, 'balance');
  assert.strictEqual(trades.createDirect({ buyer: 'U_A', seller: 'U_B', code: 'HW1', jp: 0, cards: ['ca', 'ca'], now: NOW }).error, 'cards_unavailable',
    'un seul « ca » encore libre');
  const day = parisDay(NOW);
  assert.ok(leave.declareLeave('U_B', day, day, NOW).ok);
  assert.strictEqual(trades.blockReason('U_B', NOW), 'pause');
  assert.strictEqual(trades.createDirect({ buyer: 'U_A', seller: 'U_B', code: 'HW1', jp: 10, cards: [], now: NOW }).error, 'blocked_seller');
  leave.endLeave('U_B', NOW);
  assert.strictEqual(trades.blockReason('U_B', NOW), null);
  assert.strictEqual(credits.getBalance('U_A'), 90, 'aucun débit sur un refus');
});

test('pendant l\'offre : la carte proposée est réservée (échanges et revente)', () => {
  assert.strictEqual(trades.reservedCounts('U_A').get('ca'), 1);
  assert.strictEqual(trades.cessible('U_A').get('ca'), 1, '2 − 1 réservée');
  assert.strictEqual(resale.sellableCounts('U_A').common, 0, '2 − 1 réservée − 1 gardée');
  assert.strictEqual(trades.openTradesOf('U_A').length, 2);
  assert.strictEqual(trades.openTradesOf('U_B').length, 2);
});

test('accepter : HW1 passe chez A, B touche 30 JP$, une seule fois', () => {
  const before = credits.getBalance('U_B');
  const r = trades.accept(tradeHW.id, 'U_B', NOW);
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.trade.status, 'done');
  assert.strictEqual(count('U_A', HW1.url), 1);
  assert.strictEqual(count('U_B', HW1.url), 0);
  assert.strictEqual(credits.getBalance('U_B'), before + 30);
  assert.deepStrictEqual(moves('U_B', 'trade_sale'), [{ amount: 30, ref: `${tradeHW.id}:sale` }]);
  assert.deepStrictEqual(trades.accept(tradeHW.id, 'U_B', NOW), { ok: false, error: 'closed' });
  assert.strictEqual(credits.getBalance('U_B'), before + 30, 'pas de double paiement');
  assert.strictEqual(trades.accept('nope', 'U_B', NOW).error, 'not_found');
});

test('carte disparue avant l\'acceptation : annulé, rien ne bouge', () => {
  // B n'a plus HW1 (vendue à A) : l'échange carte contre carte tombe
  const r = trades.accept(tradeSwap.id, 'U_B', NOW);
  assert.deepStrictEqual([r.ok, r.error], [false, 'unavailable']);
  assert.strictEqual(trades.getTrade(tradeSwap.id).status, 'cancelled');
  assert.strictEqual(count('U_A', 'ca'), 2, 'carte de A rendue disponible');
  assert.strictEqual(trades.reservedCounts('U_A').get('ca') || 0, 0);
});

test('refuser : A remboursé', () => {
  collections.addCards('U_B', [{ ...HW1 }]);
  const r = trades.createDirect({ buyer: 'U_A', seller: 'U_B', code: 'HW1', jp: 32, cards: [], now: NOW });
  assert.ok(r.ok);
  assert.strictEqual(credits.getBalance('U_A'), 58);
  assert.strictEqual(trades.refuse(r.trade.id, 'U_A', NOW).error, 'not_seller');
  const rr = trades.refuse(r.trade.id, 'U_B', NOW);
  assert.ok(rr.ok);
  assert.strictEqual(trades.getTrade(r.trade.id).status, 'refused');
  assert.strictEqual(credits.getBalance('U_A'), 90);
  assert.deepStrictEqual(moves('U_A', 'trade_refund'), [{ amount: 32, ref: `${r.trade.id}:refund` }]);
  assert.strictEqual(trades.refuse(r.trade.id, 'U_B', NOW).error, 'closed');
});

test('B perd HW1 pendant une demande en JP$ : unavailable, A remboursé, cancelled', () => {
  const r = trades.createDirect({ buyer: 'U_A', seller: 'U_B', code: 'HW1', jp: 35, cards: [], now: NOW });
  assert.ok(r.ok);
  collections.removeCards('U_B', [HW1.url]);
  const a = trades.accept(r.trade.id, 'U_B', NOW);
  assert.deepStrictEqual([a.ok, a.error], [false, 'unavailable']);
  assert.strictEqual(trades.getTrade(r.trade.id).status, 'cancelled');
  assert.strictEqual(credits.getBalance('U_A'), 90);
});

test('échange carte contre carte accepté : les cartes se croisent', () => {
  collections.addCards('U_B', [{ ...HW1 }]);
  const r = trades.createDirect({ buyer: 'U_A', seller: 'U_B', code: 'HW1', jp: 0, cards: ['ca'], now: NOW });
  assert.ok(r.ok);
  assert.ok(trades.accept(r.trade.id, 'U_B', NOW).ok);
  assert.strictEqual(count('U_A', 'ca'), 1);
  assert.strictEqual(count('U_B', 'ca'), 1);
  assert.strictEqual(count('U_A', HW1.url), 2);
  assert.strictEqual(collections.getCollection('U_B').find((c) => c.url === 'ca').rarity, 'common');
});

test('montant en JP$ : entier ≥ 0 seulement (0 réservé au carte contre carte)', () => {
  collections.addCards('U_B', [{ ...HW1 }]);   // B en a de nouveau un (cédé à A juste avant)
  const bal = credits.getBalance('U_A');
  for (const jp of [-5, 10.5, NaN, '12']) {
    assert.strictEqual(trades.createDirect({ buyer: 'U_A', seller: 'U_B', code: 'HW1', jp, cards: [], now: NOW }).error, 'bad_amount', String(jp));
  }
  assert.strictEqual(trades.createDirect({ buyer: 'U_A', seller: 'U_B', code: 'HW1', jp: -1, cards: ['ca'], now: NOW }).error, 'bad_amount');
  assert.strictEqual(credits.getBalance('U_A'), bal, 'aucun débit');
});

test('délai dépassé : accepter et refuser répondent « expired », rien ne bouge', () => {
  const r = trades.createDirect({ buyer: 'U_A', seller: 'U_B', code: 'HW1', jp: 20, cards: ['ca'], now: NOW });
  assert.ok(r.ok, JSON.stringify(r));
  const late = NOW + trades.REQUEST_MS;
  const snap = () => [credits.getBalance('U_A'), credits.getBalance('U_B'), count('U_A', HW1.url), count('U_B', HW1.url), count('U_A', 'ca'), count('U_B', 'ca')];
  const before = snap();
  assert.strictEqual(trades.accept(r.trade.id, 'U_B', late).error, 'expired');
  assert.strictEqual(trades.refuse(r.trade.id, 'U_B', late).error, 'expired');
  assert.deepStrictEqual(snap(), before);
  assert.strictEqual(trades.getTrade(r.trade.id).status, 'open', 'la minuterie fermera l\'échange');
  assert.deepStrictEqual(trades.getTrade(r.trade.id).held, { U_A: 20 });
  assert.ok(trades.accept(r.trade.id, 'U_B', late - 1).ok, 'juste avant la fin : accepté');
});

test('enchère ouverte du vendeur : sa carte est réservée', () => {
  const data = trades._load();
  data.trades.TEST_AUC = { id: 'TEST_AUC', kind: 'auction', seller: 'U_B', buyer: null, card: { url: 'cb', code: '#0' }, offer: { jp: 0, cards: [] }, status: 'open', counters: {}, bids: [], dms: {} };
  trades._save(data);
  assert.strictEqual(trades.reservedCounts('U_B').get('cb'), 1);
  assert.strictEqual(trades.cessible('U_B').get('cb'), 1);
});

try { db.close(); } catch { /* base jamais ouverte */ }
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows */ }
console.log(process.exitCode ? '\n❌ Échec' : `\n✅ Tout est bon (${passed})`);
