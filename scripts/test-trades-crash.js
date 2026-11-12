#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test échanges : plantage entre le grand livre et trades.json (v3.9)
//
//  Les JP$ bougent dans SQLite AVANT l'écriture de data/trades.json.
//  Un plantage (ou une écriture impossible) entre les deux ne doit
//  jamais rembourser ni payer deux fois, ni dupliquer une carte :
//    • écriture de trades.json en échec pendant la minuterie → elle
//      s'arrête, un tick suivant ne rembourse pas une 2ᵉ fois ;
//    • plantage après le paiement d'une acceptation (demande à une
//      personne, demande générale, contre-offre) ou du règlement d'une
//      enchère → la minuterie conclut l'échange, sans remboursement ;
//    • contre-offre acceptée alors que la carte du vendeur est partie
//      (demande à une personne) → échange annulé, JP$ rendus.
//
//  Modules purs, dans une COPIE temporaire du projet (aucune donnée
//  réelle touchée), horloge simulée.
//  Usage : npx -y -p node@20 node scripts/test-trades-crash.js
// ═══════════════════════════════════════════════════════════
process.env.TRADES_DAILY_LIMIT = '1000';   // v4.1.1 : la limite de 2 demandes/jour a son propre test (test-trades-limit.js)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-crash-'));
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
const storage = req('storage.js');
const collections = req('collections.js');
const credits = req('credits.js');
const broadcast = req('broadcast.js');
const cardIndex = req('cardIndex.js');
const db = req('db.js');

const EPIC = cardIndex.listCards().find((c) => c.rarity === 'epic');
const card = (url, rarity, n) => Array.from({ length: n }, () => ({ url, rarity, title: url, type: 'image' }));
const count = (u, url) => collections.getCount(u, url);
const bal = (u) => credits.getBalance(u);
/** Mouvements de ce joueur, de cette source, pour l'échange `id`. */
const nMoves = (u, source, id) => db.getDb().prepare('SELECT COUNT(*) AS n FROM credit_moves WHERE user_id = ? AND source = ? AND ref LIKE ?').get(u, source, `${id}%`).n;

// 💥 Écriture de trades.json en échec (les autres fichiers s'écrivent normalement)
const realWrite = storage.writeJsonAtomic;
function failTradesSave(times) {
  let left = times;
  storage.writeJsonAtomic = (file, data) => {
    if (file === trades.TRADES_PATH && left > 0) {
      left -= 1;
      throw new Error('disque plein (simulé)');
    }
    return realWrite(file, data);
  };
}
const restoreSave = () => { storage.writeJsonAtomic = realWrite; };

// 📸 « Plantage avant l'écriture » : on remet trades.json tel qu'il était avant l'action
const snapshot = () => fs.readFileSync(trades.TRADES_PATH);
const restore = (bytes) => fs.writeFileSync(trades.TRADES_PATH, bytes);

// La minuterie écrit ses erreurs : on les garde pour les vérifier, sans polluer la sortie
const realError = console.error;
const quietErrors = (fn) => {
  const logged = [];
  console.error = (...a) => logged.push(a.join(' '));
  try { return fn(); } finally { console.error = realError; }
};

for (const u of ['U_A', 'U_B', 'U_C', 'U_D']) {
  broadcast.subscribe(u);
  credits.addCredit(u, 100, { source: 'test' });
}

console.log('\n🧪 Échanges : plantage entre le grand livre et trades.json (v3.9)\n');

test('trades.json non écrit pendant la minuterie : elle s\'arrête, le tick suivant ne rembourse pas deux fois', () => {
  collections.addCards('U_A', card(EPIC.url, 'epic', 1));
  const r = trades.createDirect({ buyer: 'U_B', seller: 'U_A', code: EPIC.code, jp: 5, now: NOW });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(bal('U_B'), 95);

  failTradesSave(3);
  for (let i = 0; i < 3; i += 1) {
    assert.throws(() => quietErrors(() => trades.tick(NOW + HOUR + (i + 1) * 10000)), /disque plein/, `tick ${i + 1} arrêté`);
  }
  restoreSave();
  assert.strictEqual(trades.getTrade(r.trade.id).status, 'open', 'rien d\'écrit');
  assert.strictEqual(bal('U_B'), 100, 'remboursé une seule fois malgré 3 ticks');

  const ev = trades.tick(NOW + HOUR + 40000);
  assert.deepStrictEqual(ev.map((e) => [e.trade.id, e.event]), [[r.trade.id, 'expired']]);
  assert.strictEqual(trades.getTrade(r.trade.id).status, 'expired');
  assert.strictEqual(bal('U_B'), 100, 'toujours une seule fois');
  assert.strictEqual(nMoves('U_B', 'trade_refund', r.trade.id), 1);
  assert.deepStrictEqual(trades.tick(NOW + HOUR + 50000), []);
  collections.removeCards('U_A', [EPIC.url]);
});

test('écriture en échec une fois au milieu de la minuterie : la 1ʳᵉ clôture est gardée, la suite se fait au tick suivant', () => {
  const t0 = NOW + 2 * HOUR;
  collections.addCards('U_A', card(EPIC.url, 'epic', 1));
  const r1 = trades.createDirect({ buyer: 'U_B', seller: 'U_A', code: EPIC.code, jp: 5, now: t0 });
  const r2 = trades.createDirect({ buyer: 'U_C', seller: 'U_A', code: EPIC.code, jp: 6, now: t0 + 1000 });
  assert.ok(r1.ok && r2.ok, JSON.stringify([r1, r2]));
  const b = bal('U_B'); const c = bal('U_C');

  // 1ʳᵉ clôture écrite, la 2ᵉ échoue
  let writes = 0;
  storage.writeJsonAtomic = (file, data) => {
    if (file === trades.TRADES_PATH && ++writes === 2) throw new Error('disque plein (simulé)');
    return realWrite(file, data);
  };
  assert.throws(() => quietErrors(() => trades.tick(t0 + HOUR + 2000)), /disque plein/);
  restoreSave();
  assert.strictEqual(trades.getTrade(r1.trade.id).status, 'expired', '1ʳᵉ clôture écrite tout de suite');
  assert.strictEqual(trades.getTrade(r2.trade.id).status, 'open');
  assert.strictEqual(bal('U_B'), b + 5);
  assert.strictEqual(bal('U_C'), c + 6, 'C remboursé (avant l\'échec d\'écriture)');

  const ev = trades.tick(t0 + HOUR + 3000);
  assert.deepStrictEqual(ev.map((e) => [e.trade.id, e.event]), [[r2.trade.id, 'expired']]);
  assert.strictEqual(bal('U_C'), c + 6, 'pas de 2ᵉ remboursement');
  assert.strictEqual(nMoves('U_C', 'trade_refund', r2.trade.id), 1);
  collections.removeCards('U_A', [EPIC.url]);
});

test('plantage après le paiement d\'une demande acceptée : conclue au tick, ni remboursement ni carte en double', () => {
  const t0 = NOW + 5 * HOUR;
  collections.addCards('U_A', card(EPIC.url, 'epic', 1));
  collections.addCards('U_B', card('xb', 'common', 1));
  const r = trades.createDirect({ buyer: 'U_B', seller: 'U_A', code: EPIC.code, jp: 7, cards: ['xb'], now: t0 });
  assert.ok(r.ok, JSON.stringify(r));
  const before = snapshot();
  const a = bal('U_A'); const b = bal('U_B');

  assert.ok(trades.accept(r.trade.id, 'U_A', t0 + MIN).ok);
  restore(before);   // le bot s'arrête avant d'écrire trades.json
  assert.strictEqual(trades.getTrade(r.trade.id).status, 'open');
  assert.strictEqual(trades.accept(r.trade.id, 'U_A', t0 + 2 * MIN).error, 'closed', 'pas de 2ᵉ acceptation');

  const ev = trades.tick(t0 + 3 * MIN);
  assert.deepStrictEqual(ev.map((e) => [e.trade.id, e.event]), [[r.trade.id, 'recovered']]);
  const t = trades.getTrade(r.trade.id);
  assert.strictEqual(t.status, 'done');
  assert.strictEqual(t.reason, 'accepted');
  assert.deepStrictEqual(t.held, {});
  assert.strictEqual(bal('U_B'), b, 'acheteur pas remboursé');
  assert.strictEqual(bal('U_A'), a + 7, 'vendeur payé une fois');
  assert.strictEqual(nMoves('U_B', 'trade_refund', r.trade.id), 0);
  assert.deepStrictEqual([count('U_B', EPIC.url), count('U_A', EPIC.url), count('U_A', 'xb'), count('U_B', 'xb')], [1, 0, 1, 0], 'cartes échangées une fois');
  assert.deepStrictEqual(trades.tick(t0 + 2 * HOUR), [], 'rien de plus ensuite');
  assert.strictEqual(bal('U_B'), b);
  collections.removeCards('U_B', [EPIC.url]);
});

test('plantage après le paiement d\'une demande générale : le vendeur est retrouvé, pas de remboursement', () => {
  const t0 = NOW + 8 * HOUR;
  collections.addCards('U_A', card(EPIC.url, 'epic', 1));
  const r = trades.createGeneral({ buyer: 'U_C', code: EPIC.code, jp: 9, now: t0 });
  assert.ok(r.ok, JSON.stringify(r));
  const before = snapshot();
  const c = bal('U_C');

  assert.ok(trades.accept(r.trade.id, 'U_A', t0 + MIN).ok);
  restore(before);
  assert.strictEqual(trades.accept(r.trade.id, 'U_D', t0 + 2 * MIN).error, 'closed');

  const ev = trades.tick(t0 + HOUR + MIN);   // même après l'heure : conclue, pas expirée
  assert.deepStrictEqual(ev.map((e) => [e.trade.id, e.event]), [[r.trade.id, 'recovered']]);
  const t = trades.getTrade(r.trade.id);
  assert.strictEqual(t.status, 'done');
  assert.strictEqual(t.seller, 'U_A', 'vendeur retrouvé dans le grand livre');
  assert.strictEqual(bal('U_C'), c, 'pas remboursé');
  assert.strictEqual(count('U_C', EPIC.url), 1);
  collections.removeCards('U_C', [EPIC.url]);
});

test('plantage après une contre-offre acceptée : conclue au tick (counter_accepted), pas de remboursement', () => {
  const t0 = NOW + 11 * HOUR;
  collections.addCards('U_A', card(EPIC.url, 'epic', 1));
  const r = trades.createDirect({ buyer: 'U_B', seller: 'U_A', code: EPIC.code, jp: 5, now: t0 });
  assert.ok(trades.counter(r.trade.id, 'U_A', { jp: 12 }, t0 + MIN).ok);
  const before = snapshot();
  const a = bal('U_A'); const b = bal('U_B');

  assert.ok(trades.acceptCounter(r.trade.id, 'U_B', 'U_A', t0 + 2 * MIN).ok);
  assert.strictEqual(bal('U_B'), b - 7, 'complément de 7');
  restore(before);
  assert.strictEqual(trades.acceptCounter(r.trade.id, 'U_B', 'U_A', t0 + 3 * MIN).error, 'closed');

  const ev = trades.tick(t0 + 2 * HOUR);
  assert.deepStrictEqual(ev.map((e) => [e.trade.id, e.event]), [[r.trade.id, 'recovered']]);
  const t = trades.getTrade(r.trade.id);
  assert.strictEqual(t.status, 'done');
  assert.strictEqual(t.reason, 'counter_accepted');
  assert.strictEqual(t.counters.U_A.status, 'accepted');
  assert.strictEqual(bal('U_B'), b - 7, 'ni le complément ni l\'offre rendus');
  assert.strictEqual(bal('U_A'), a + 12);
  assert.strictEqual(count('U_B', EPIC.url), 1);
  collections.removeCards('U_B', [EPIC.url]);
});

test('plantage après le règlement d\'une enchère : vendue au tick suivant, gagnant pas remboursé', () => {
  const t0 = NOW + 24 * HOUR;   // mercredi 10h
  collections.addCards('U_A', card(EPIC.url, 'epic', 1));
  const auc = trades.createAuction({ seller: 'U_A', code: EPIC.code, startPrice: 5, now: t0 });
  assert.ok(auc.ok, JSON.stringify(auc));
  assert.ok(trades.bid(auc.trade.id, 'U_B', 6, t0 + MIN).ok);
  assert.ok(trades.bid(auc.trade.id, 'U_C', 8, t0 + 2 * MIN).ok);
  assert.ok(trades.bid(auc.trade.id, 'U_B', 10, t0 + 3 * MIN).ok);
  const before = snapshot();
  const a = bal('U_A'); const b = bal('U_B'); const c = bal('U_C');

  const ev1 = trades.tick(auc.trade.endsAt);
  assert.deepStrictEqual(ev1.map((e) => [e.event, e.outcome]), [['settled', 'sold']]);
  restore(before);   // le règlement est fait, trades.json pas écrit
  assert.strictEqual(trades.settleAuction(auc.trade.id, auc.trade.endsAt + 1000).error, 'closed', 'pas de 2ᵉ règlement');

  const ev2 = trades.tick(auc.trade.endsAt + 10000);
  assert.deepStrictEqual(ev2.map((e) => [e.trade.id, e.event, e.outcome]), [[auc.trade.id, 'settled', 'sold']]);
  const t = trades.getTrade(auc.trade.id);
  assert.strictEqual(t.status, 'done');
  assert.strictEqual(t.buyer, 'U_B');
  assert.strictEqual(bal('U_B'), b, 'gagnant pas remboursé');
  assert.strictEqual(bal('U_C'), c, 'C déjà remboursé une fois, pas deux');
  assert.strictEqual(bal('U_A'), a + 10);
  assert.strictEqual(nMoves('U_C', 'trade_refund', auc.trade.id), 1);
  assert.strictEqual(nMoves('U_B', 'trade_refund', auc.trade.id), 1, 'seule la 1ʳᵉ mise de B (dépassée) rendue');
  assert.deepStrictEqual([count('U_B', EPIC.url), count('U_A', EPIC.url)], [1, 0]);
  collections.removeCards('U_B', [EPIC.url]);
});

test('contre-offre acceptée, carte du vendeur partie (demande à une personne) → annulée, JP$ rendus', () => {
  const t0 = NOW + 50 * HOUR;
  collections.addCards('U_A', card(EPIC.url, 'epic', 1));
  const b = bal('U_B');
  const r = trades.createDirect({ buyer: 'U_B', seller: 'U_A', code: EPIC.code, jp: 5, now: t0 });
  assert.ok(trades.counter(r.trade.id, 'U_A', { jp: 8 }, t0 + MIN).ok);
  collections.removeCards('U_A', [EPIC.url]);

  const res = trades.acceptCounter(r.trade.id, 'U_B', 'U_A', t0 + 2 * MIN);
  assert.strictEqual(res.error, 'unavailable');
  const t = trades.getTrade(r.trade.id);
  assert.strictEqual(t.status, 'cancelled', 'fermée tout de suite');
  assert.strictEqual(t.reason, 'unavailable');
  assert.strictEqual(t.counters.U_A.status, 'cancelled');
  assert.strictEqual(bal('U_B'), b, 'JP$ rendus');
});

try { db.close(); } catch { /* base jamais ouverte */ }
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows */ }
console.log(process.exitCode ? '\n❌ Échec' : `\n✅ Tout est bon (${passed})`);
