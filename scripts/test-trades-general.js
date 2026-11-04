#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test échanges : demande générale et contre-offres (v3.9, src/trades.js)
//
//  Modules purs, dans une COPIE temporaire du projet (aucune donnée
//  réelle touchée), horloge simulée un mardi à 10h (Paris) :
//    • destinataires d'une demande générale (propriétaires inscrits) ;
//    • premier propriétaire qui accepte = seule vente ;
//    • contre-offre : une seule par vendeur, délai propre, complément
//      prélevé ou rendu à l'acceptation, cartes revérifiées ;
//    • actions refusées après l'expiration.
//
//  Usage : npx -y -p node@20 node scripts/test-trades-general.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-trades-gen-'));
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
const collections = req('collections.js');
const credits = req('credits.js');
const broadcast = req('broadcast.js');
const cardIndex = req('cardIndex.js');
const db = req('db.js');

const HW1 = cardIndex.byCode('HW1');
const HW2 = cardIndex.byCode('HW2');
const card = (url, rarity, n) => Array.from({ length: n }, () => ({ url, rarity, title: url, type: 'image' }));
const count = (u, url) => collections.getCount(u, url);
const bal = (u) => credits.getBalance(u);
const allMoves = () => db.getDb().prepare('SELECT COUNT(*) AS n FROM credit_moves').get().n;
const MIN = 60000;

for (const u of ['U_A', 'U_B', 'U_C', 'U_D']) broadcast.subscribe(u);
credits.addCredit('U_A', 100, { source: 'test' });
collections.addCards('U_B', [{ ...HW1 }]);
collections.addCards('U_C', [{ ...HW1 }]);
collections.addCards('U_D', card('cd', 'common', 1));
collections.addCards('U_A', card('ca', 'common', 3));

console.log('\n🧪 Échanges : demande générale et contre-offres (v3.9)\n');

const general = (extra = {}) => {
  const r = trades.createGeneral({ buyer: 'U_A', code: 'HW1', jp: 10, cards: [], now: NOW, ...extra });
  assert.ok(r.ok, JSON.stringify(r));
  return r;
};

test('demande générale : destinataires = propriétaires inscrits (B, C), pas D ni A', () => {
  const r = general();
  assert.deepStrictEqual(r.recipients, ['U_B', 'U_C']);
  assert.strictEqual(r.trade.kind, 'general');
  assert.strictEqual(r.trade.seller, null);
  assert.strictEqual(r.trade.expiresAt, NOW + trades.REQUEST_MS);
  assert.strictEqual(bal('U_A'), 90, '10 JP$ en réserve');
  // Fermée pour la suite
  trades._close(trades._load().trades[r.trade.id], 'cancelled', NOW);
});

test('demande générale : no_owner, plancher, offre vide, non inscrit exclu', () => {
  const before = bal('U_A');
  assert.strictEqual(HW2 && cardIndex.byCode('HW2').url !== HW1.url, true);
  assert.deepStrictEqual(trades.createGeneral({ buyer: 'U_A', code: 'HW2', jp: 10, cards: [], now: NOW }), { ok: false, error: 'no_owner' });
  assert.strictEqual(trades.createGeneral({ buyer: 'U_A', code: 'HW1', jp: 9, cards: [], now: NOW }).error, 'floor');
  assert.strictEqual(trades.createGeneral({ buyer: 'U_A', code: 'HW1', jp: 0, cards: [], now: NOW }).error, 'empty');
  assert.strictEqual(trades.createGeneral({ buyer: 'U_A', code: 'ZZ9', jp: 10, cards: [], now: NOW }).error, 'unavailable');
  broadcast.unsubscribe('U_C');
  const r = general();
  assert.deepStrictEqual(r.recipients, ['U_B']);
  broadcast.subscribe('U_C');
  trades._close(trades._load().trades[r.trade.id], 'cancelled', NOW);
  assert.strictEqual(bal('U_A'), before, 'rien de débité au bout du compte');
});

test('B accepte, puis C accepte → closed (une seule vente)', () => {
  const { trade } = general();
  const bB = bal('U_B');
  const r = trades.accept(trade.id, 'U_B', NOW);
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.trade.status, 'done');
  assert.strictEqual(r.trade.seller, 'U_B');
  assert.strictEqual(bal('U_B'), bB + 10);
  assert.strictEqual(count('U_A', HW1.url), 1);
  assert.strictEqual(count('U_B', HW1.url), 0);
  const c = trades.accept(trade.id, 'U_C', NOW);
  assert.deepStrictEqual([c.ok, c.error], [false, 'closed']);
  assert.strictEqual(count('U_C', HW1.url), 1);
  assert.strictEqual(trades.accept(trade.id, 'U_A', NOW).ok, false, "l'acheteur n'accepte pas sa propre demande");
});

test('D (sans la carte) ne peut pas accepter : unavailable, la demande reste ouverte', () => {
  collections.addCards('U_B', [{ ...HW1 }]);
  const { trade } = general();
  const r = trades.accept(trade.id, 'U_D', NOW);
  assert.deepStrictEqual([r.ok, r.error], [false, 'unavailable']);
  assert.strictEqual(trades.getTrade(trade.id).status, 'open');
  trades._close(trades._load().trades[trade.id], 'cancelled', NOW);
});

test('contre-offre de B (30 JP$) pendant que C accepte l\'offre d\'origine : vente à C, contre-offre annulée', () => {
  const { trade } = general();
  const r = trades.counter(trade.id, 'U_B', { jp: 30, cards: [] }, NOW + 10 * MIN);
  assert.ok(r.ok, JSON.stringify(r));
  const co = trades.getTrade(trade.id).counters.U_B;
  assert.deepStrictEqual(co, { jp: 30, cards: [], at: NOW + 10 * MIN, expiresAt: NOW + 10 * MIN + trades.REQUEST_MS, status: 'open' });
  assert.strictEqual(trades.getTrade(trade.id).expiresAt, NOW + trades.REQUEST_MS, 'délai de la demande inchangé');
  assert.strictEqual(trades.getTrade(trade.id).status, 'open', 'la contre-offre ne ferme pas la demande');

  const bA = bal('U_A');
  const bC = bal('U_C');
  const a = trades.accept(trade.id, 'U_C', NOW + 11 * MIN);
  assert.ok(a.ok, JSON.stringify(a));
  const t = trades.getTrade(trade.id);
  assert.strictEqual(t.status, 'done');
  assert.strictEqual(t.seller, 'U_C');
  assert.strictEqual(t.counters.U_B.status, 'cancelled');
  assert.strictEqual(bal('U_C'), bC + 10);
  assert.strictEqual(bal('U_A'), bA);
  const ac = trades.acceptCounter(trade.id, 'U_A', 'U_B', NOW + 12 * MIN);
  assert.deepStrictEqual([ac.ok, ac.error], [false, 'closed']);
  assert.strictEqual(bal('U_A'), bA, 'aucun complément prélevé');
});

test('deuxième contre-offre du même vendeur → already_countered', () => {
  collections.addCards('U_C', [{ ...HW1 }]);
  const { trade } = general();
  assert.ok(trades.counter(trade.id, 'U_B', { jp: 30, cards: [] }, NOW).ok);
  const r = trades.counter(trade.id, 'U_B', { jp: 20, cards: [] }, NOW);
  assert.deepStrictEqual([r.ok, r.error], [false, 'already_countered']);
  assert.strictEqual(trades.getTrade(trade.id).counters.U_B.jp, 30);
  // Autres refus
  assert.strictEqual(trades.counter(trade.id, 'U_A', { jp: 30, cards: [] }, NOW).ok, false, 'pas sur sa propre demande');
  assert.strictEqual(trades.counter(trade.id, 'U_D', { jp: 30, cards: [] }, NOW).error, 'unavailable', 'D n\'a pas la carte');
  assert.strictEqual(trades.counter(trade.id, 'U_C', { jp: 0, cards: [] }, NOW).error, 'empty');
  assert.strictEqual(trades.counter(trade.id, 'U_C', { jp: 5, cards: [] }, NOW).error, 'floor');
  assert.strictEqual(trades.counter(trade.id, 'U_C', { jp: 0, cards: ['cd'] }, NOW).error, 'cards_unavailable', 'carte que A n\'a pas');
  trades._close(trades._load().trades[trade.id], 'cancelled', NOW);
});

test('contre-offre acceptée avec complément : A paie 30 au total, B reçoit 30, C refusée → closed', () => {
  const { trade } = general();
  assert.ok(trades.counter(trade.id, 'U_B', { jp: 30, cards: [] }, NOW).ok);
  const bA = bal('U_A');
  const bB = bal('U_B');
  const r = trades.acceptCounter(trade.id, 'U_A', 'U_B', NOW + MIN);
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(bal('U_A'), bA - 20, 'complément de 20 prélevé');
  assert.strictEqual(bal('U_B'), bB + 30);
  const t = trades.getTrade(trade.id);
  assert.strictEqual(t.status, 'done');
  assert.strictEqual(t.seller, 'U_B');
  assert.strictEqual(t.counters.U_B.status, 'accepted');
  assert.deepStrictEqual(t.held, {});
  const holds = db.getDb().prepare("SELECT amount FROM credit_moves WHERE user_id = 'U_A' AND source = 'trade_hold' AND ref LIKE ?").all(`${trade.id}:hold%`);
  assert.deepStrictEqual(holds.map((m) => m.amount), [-10, -20]);
  assert.strictEqual(trades.accept(trade.id, 'U_C', NOW + MIN).error, 'closed');
});

test('contre-offre moins chère, sans les cartes d\'origine : excédent rendu, carte libérée', () => {
  collections.addCards('U_B', [{ ...HW1 }]);
  const { trade } = general({ jp: 10, cards: ['ca'] });
  assert.strictEqual(trades.reservedCounts('U_A').get('ca'), 1);
  assert.ok(trades.counter(trade.id, 'U_B', { jp: 4, cards: ['ca', 'ca'] }, NOW).ok, 'carte contre carte : pas de plancher');
  const bA = bal('U_A');
  const bB = bal('U_B');
  const caA = count('U_A', 'ca');
  const r = trades.acceptCounter(trade.id, 'U_A', 'U_B', NOW);
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(bal('U_A'), bA + 6, '6 JP$ rendus');
  assert.strictEqual(bal('U_B'), bB + 4);
  assert.strictEqual(count('U_A', 'ca'), caA - 2);
  assert.strictEqual(count('U_B', 'ca'), 2);
  assert.strictEqual(trades.reservedCounts('U_A').get('ca') || 0, 0);
});

test('contre-offre réclamant une carte que A a perdue → cards_unavailable, aucun mouvement de crédits', () => {
  collections.addCards('U_B', [{ ...HW1 }]);
  const { trade } = general();
  assert.ok(trades.counter(trade.id, 'U_B', { jp: 20, cards: ['ca'] }, NOW).ok);
  collections.removeCards('U_A', ['ca']);
  assert.strictEqual(count('U_A', 'ca'), 0);
  const n = allMoves();
  const bA = bal('U_A');
  const r = trades.acceptCounter(trade.id, 'U_A', 'U_B', NOW);
  assert.deepStrictEqual([r.ok, r.error], [false, 'cards_unavailable']);
  assert.strictEqual(allMoves(), n, 'aucun mouvement');
  assert.strictEqual(bal('U_A'), bA);
  assert.strictEqual(trades.getTrade(trade.id).status, 'open');
  assert.strictEqual(trades.getTrade(trade.id).held.U_A, 10);
  trades._close(trades._load().trades[trade.id], 'cancelled', NOW);
});

test('solde de A insuffisant pour le complément → balance, aucun débit partiel', () => {
  const { trade } = general();
  assert.ok(trades.counter(trade.id, 'U_B', { jp: 500, cards: [] }, NOW).ok);
  const n = allMoves();
  const bA = bal('U_A');
  const r = trades.acceptCounter(trade.id, 'U_A', 'U_B', NOW);
  assert.deepStrictEqual([r.ok, r.error], [false, 'balance']);
  assert.strictEqual(allMoves(), n);
  assert.strictEqual(bal('U_A'), bA);
  assert.strictEqual(count('U_B', HW1.url), 1, 'la carte n\'a pas bougé');
  assert.strictEqual(trades.getTrade(trade.id).status, 'open');
  // Refuser la contre-offre : la demande reste ouverte pour les autres
  assert.strictEqual(trades.refuseCounter(trade.id, 'U_B', 'U_B', NOW).error, 'not_buyer');
  const rf = trades.refuseCounter(trade.id, 'U_A', 'U_B', NOW);
  assert.ok(rf.ok, JSON.stringify(rf));
  assert.strictEqual(trades.getTrade(trade.id).counters.U_B.status, 'refused');
  assert.strictEqual(trades.getTrade(trade.id).status, 'open');
  assert.strictEqual(trades.acceptCounter(trade.id, 'U_A', 'U_B', NOW).error, 'counter_closed');
  assert.strictEqual(trades.refuseCounter(trade.id, 'U_A', 'U_C', NOW).error, 'no_counter');
  trades._close(trades._load().trades[trade.id], 'cancelled', NOW);
});

test('expiration : accept, counter et acceptCounter refusés avec expired', () => {
  const { trade } = general();
  assert.ok(trades.counter(trade.id, 'U_B', { jp: 20, cards: [] }, NOW + 50 * MIN).ok);
  const end = NOW + trades.REQUEST_MS;
  assert.strictEqual(trades.accept(trade.id, 'U_C', end).error, 'expired');
  assert.strictEqual(trades.counter(trade.id, 'U_C', { jp: 20, cards: [] }, end).error, 'expired');
  // La contre-offre de B court encore (jusqu'à NOW + 50 min + 1 h)
  assert.strictEqual(trades.acceptCounter(trade.id, 'U_A', 'U_B', NOW + 50 * MIN + trades.REQUEST_MS).error, 'expired');
  const r = trades.acceptCounter(trade.id, 'U_A', 'U_B', end + MIN);
  assert.ok(r.ok, JSON.stringify(r));
});

test('demande à une personne : seul le vendeur peut faire une contre-offre', () => {
  const r = trades.createDirect({ buyer: 'U_A', seller: 'U_C', code: 'HW1', jp: 10, cards: [], now: NOW });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(trades.counter(r.trade.id, 'U_B', { jp: 20, cards: [] }, NOW).error, 'not_seller');
  assert.ok(trades.counter(r.trade.id, 'U_C', { jp: 20, cards: [] }, NOW).ok);
  const bC = bal('U_C');
  assert.ok(trades.acceptCounter(r.trade.id, 'U_A', 'U_C', NOW).ok);
  assert.strictEqual(bal('U_C'), bC + 20);
  assert.strictEqual(count('U_C', HW1.url), 0);
});

test('demande à une personne : contre-offre refusée → demande refusée, A remboursé', () => {
  collections.addCards('U_C', [{ ...HW1 }]);
  credits.addCredit('U_A', 100, { source: 'test' });
  const bA = bal('U_A');
  const r = trades.createDirect({ buyer: 'U_A', seller: 'U_C', code: 'HW1', jp: 10, cards: [], now: NOW });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(bal('U_A'), bA - 10);
  assert.ok(trades.counter(r.trade.id, 'U_C', { jp: 20, cards: [] }, NOW).ok);
  const rf = trades.refuseCounter(r.trade.id, 'U_A', 'U_C', NOW);
  assert.ok(rf.ok, JSON.stringify(rf));
  const t = trades.getTrade(r.trade.id);
  assert.strictEqual(t.status, 'refused');
  assert.strictEqual(t.reason, 'counter_refused');
  assert.strictEqual(t.counters.U_C.status, 'refused');
  assert.strictEqual(bal('U_A'), bA, '10 JP$ rendus');
  assert.strictEqual(trades.accept(r.trade.id, 'U_C', NOW).error, 'closed');
  assert.strictEqual(count('U_C', HW1.url), 1);
});

test('montants invalides → bad_amount (demande générale et contre-offre)', () => {
  collections.addCards('U_A', card('ca', 'common', 1));
  const bA = bal('U_A');
  for (const jp of [-5, 2.5, '10', NaN]) {
    assert.strictEqual(trades.createGeneral({ buyer: 'U_A', code: 'HW1', jp, cards: [], now: NOW }).error, 'bad_amount', `createGeneral ${jp}`);
  }
  assert.strictEqual(bal('U_A'), bA);
  const ok = trades.createGeneral({ buyer: 'U_A', code: 'HW1', jp: null, cards: ['ca'], now: NOW });
  assert.ok(ok.ok, 'jp null = 0 : ' + JSON.stringify(ok));
  for (const jp of [-5, 2.5]) {
    assert.strictEqual(trades.counter(ok.trade.id, 'U_C', { jp, cards: [] }, NOW).error, 'bad_amount', `counter ${jp}`);
  }
  assert.strictEqual(trades.getTrade(ok.trade.id).counters.U_C, undefined, 'aucune contre-offre enregistrée');
  assert.ok(trades.counter(ok.trade.id, 'U_C', { cards: ['ca'] }, NOW).ok, 'jp absent = 0');
  trades._close(trades._load().trades[ok.trade.id], 'cancelled', NOW);
});

try { db.close(); } catch { /* base jamais ouverte */ }
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows */ }
console.log(process.exitCode ? '\n❌ Échec' : `\n✅ Tout est bon (${passed})`);
