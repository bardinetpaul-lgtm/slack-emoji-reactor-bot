#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test v4.1.1 : 2 demandes d'échange par joueur et par jour
//
//  Modules purs, dans une COPIE temporaire du projet (aucune donnée
//  réelle touchée), horloge simulée un mardi (Paris) :
//    • demande à une personne, demande générale et mise aux enchères
//      comptent toutes, qu'elles aboutissent ou non ;
//    • la 3e est refusée (daily_limit), sans débit de JP$ ;
//    • contre-offres, mises et réponses restent libres ;
//    • compteur remis à zéro à minuit (heure de Paris) ;
//    • l'Accueil cache les boutons une fois le plafond atteint.
//
//  Usage : npx -y -p node@20 node scripts/test-trades-limit.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-trades-limit-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));
delete process.env.TRADES_DAILY_LIMIT;   // la vraie limite de production

// ⏰ Horloge simulée : mardi 3/11 à 10h (Paris, UTC+1)
const RealDate = Date;
let NOW = RealDate.parse('2026-11-03T09:00:00Z');
global.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(NOW); }
  static now() { return NOW; }
};
const at = (iso) => { NOW = RealDate.parse(iso); return NOW; };

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
const origLog = console.log;
console.log = () => {};
const trades = req('trades.js');
const tradesSlack = req('tradesSlack.js');
const collections = req('collections.js');
const credits = req('credits.js');
const broadcast = req('broadcast.js');
const cardIndex = req('cardIndex.js');
console.log = origLog;

const HW1 = cardIndex.byCode('HW1');
const HW2 = cardIndex.byCode('HW2');
const HW3 = cardIndex.byCode('HW3');
for (const u of ['U_A', 'U_B', 'U_C']) broadcast.subscribe(u);
credits.addCredit('U_A', 500, { source: 'test' });
credits.addCredit('U_C', 500, { source: 'test' });
collections.addCards('U_B', [{ ...HW1 }, { ...HW2 }, { ...HW3 }]);
collections.addCards('U_A', [{ ...HW1 }, { ...HW2 }, { ...HW3 }]);
const flat = (x) => JSON.stringify(x);

origLog('\n🧪 Échanges : 2 demandes par joueur et par jour (v4.1.1)\n');

test('la limite de production vaut 2', () => {
  assert.strictEqual(trades.DAILY_LIMIT, 2);
  assert.strictEqual(trades.dailyLimit(), 2);
  assert.strictEqual(trades.requestsLeftToday('U_A'), 2);
});

let refused;
test('une demande refusée compte quand même', () => {
  const r = trades.createDirect({ buyer: 'U_A', seller: 'U_B', code: 'HW1', jp: 10, now: NOW });
  assert.ok(r.ok, r.error);
  refused = r.trade.id;
  assert.ok(trades.refuse(refused, 'U_B', NOW).ok);
  assert.strictEqual(trades.requestsToday('U_A', NOW), 1);
  assert.strictEqual(trades.requestsLeftToday('U_A', NOW), 1);
});

test('une demande générale est la 2e ; la 3e (à une personne) est refusée sans débit', () => {
  const g = trades.createGeneral({ buyer: 'U_A', code: 'HW2', jp: 10, now: NOW });
  assert.ok(g.ok, g.error);
  const before = credits.getBalance('U_A');
  const third = trades.createDirect({ buyer: 'U_A', seller: 'U_B', code: 'HW3', jp: 10, now: NOW });
  assert.deepStrictEqual(third, { ok: false, error: 'daily_limit' });
  assert.strictEqual(credits.getBalance('U_A'), before);
  assert.deepStrictEqual(trades.createGeneral({ buyer: 'U_A', code: 'HW3', jp: 10, now: NOW }), { ok: false, error: 'daily_limit' });
  assert.deepStrictEqual(trades.createAuction({ seller: 'U_A', code: 'HW3', now: NOW }), { ok: false, error: 'daily_limit' });
});

test('mises aux enchères comptées pour le vendeur ; mises et contre-offres libres', () => {
  const a1 = trades.createAuction({ seller: 'U_B', code: 'HW2', now: NOW });
  assert.ok(a1.ok, a1.error);
  const a2 = trades.createAuction({ seller: 'U_B', code: 'HW3', now: NOW });
  assert.ok(a2.ok, a2.error);
  assert.deepStrictEqual(trades.createDirect({ buyer: 'U_B', seller: 'U_A', code: 'HW1', jp: 10, now: NOW }), { ok: false, error: 'daily_limit' });
  // U_A est au plafond mais peut toujours enchérir
  assert.ok(trades.bid(a1.trade.id, 'U_A', 10, NOW).ok);
  // U_C enchérit plusieurs fois sans consommer son quota
  assert.ok(trades.bid(a1.trade.id, 'U_C', 11, NOW).ok);
  assert.ok(trades.bid(a2.trade.id, 'U_C', 10, NOW).ok);
  assert.strictEqual(trades.requestsLeftToday('U_C', NOW), 2);
});

test('une contre-offre ne compte pas pour le vendeur', () => {
  const d = trades.createDirect({ buyer: 'U_C', seller: 'U_A', code: 'HW1', jp: 10, now: NOW });
  assert.ok(d.ok, d.error);
  assert.ok(trades.counter(d.trade.id, 'U_A', { jp: 20, cards: [] }, NOW).ok);
  assert.strictEqual(trades.requestsToday('U_A', NOW), 2);
  assert.strictEqual(trades.requestsToday('U_C', NOW), 1);
});

test("l'Accueil cache les boutons au plafond et affiche le reste sinon", () => {
  const full = flat(tradesSlack.buildTradeBlocks('U_A', NOW));
  assert.ok(!full.includes('trade_direct_open') && !full.includes('trade_auction_open'), 'boutons encore visibles au plafond');
  assert.ok(full.includes('demandes d'), 'pas de message de plafond');
  const half = flat(tradesSlack.buildTradeBlocks('U_C', NOW));
  assert.ok(half.includes('trade_direct_open'), 'boutons absents alors qu\'il reste une demande');
  assert.ok(half.includes('Encore *1* demande possible'), half);
  assert.ok(tradesSlack.ERROR_TEXT.daily_limit.includes('2 demandes'));
});

test('compteur remis à zéro à minuit, heure de Paris', () => {
  at('2026-11-03T22:59:00Z');   // mardi 23h59 à Paris
  assert.strictEqual(trades.requestsLeftToday('U_A'), 0);
  at('2026-11-03T23:00:00Z');   // mercredi 0h00 à Paris
  assert.strictEqual(trades.requestsLeftToday('U_A'), 2);
  at('2026-11-04T09:00:00Z');
  const r = trades.createDirect({ buyer: 'U_A', seller: 'U_B', code: 'HW1', jp: 10, now: NOW });
  assert.ok(r.ok, r.error);
});

origLog(`\n${process.exitCode ? '❌ Échec' : `✅ Tout est bon (${passed})`}`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
