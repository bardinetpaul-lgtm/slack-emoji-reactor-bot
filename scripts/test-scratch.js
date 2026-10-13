#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test des tickets à gratter « ESSAI ! » (sans Slack)
//
//  Copie src/, public/ et la banque de médias dans un dossier
//  temporaire → aucun fichier runtime réel (crédits, collections…)
//  n'est touché, même lancé sur la VM de prod.
//
//  Usage : node scripts/test-scratch.js
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-scratch-'));

fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

process.env.WEB_PUBLIC_URL = 'https://example.test/jeanpip';
process.env.WEB_SECRET = 'secret-de-test';

const quiet = { info() {}, warn() {}, error() {} };
const origLog = console.log;
console.log = () => {}; // logs de chargement de media.js
const mod = (name) => require(path.join(TMP, 'src', name));
const scratch = mod('scratch.js');
const tickets = mod('scratchTickets.js');
const settings = mod('settings.js');
const credits = mod('credits.js');
const collections = mod('collections.js');
const web = mod('web.js');
console.log = origLog;

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    console.log(`  ❌ ${name}\n     ${e.message}`);
    process.exitCode = 1;
  }
}

// Générateur pseudo-aléatoire reproductible (mulberry32)
function seeded(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const count = (grid, s) => grid.filter((x) => x === s).length;

(async () => {
  console.log('\n🧪 Tickets à gratter — logique\n');

  await test('lots = multiples du prix, légendaire = prix ÷ 300', () => {
    const t5 = scratch.prizeTable(5);
    assert.deepStrictEqual(t5.map((p) => p.amount || 0), [0, 200, 50, 20, 10, 5]);
    assert.strictEqual(t5[0].kind, 'legendary');
    assert.ok(Math.abs(t5[0].chance - 1 / 60) < 1e-12);
    assert.deepStrictEqual(scratch.prizeTable(10).map((p) => p.amount || 0), [0, 400, 100, 40, 20, 10]);
    assert.strictEqual(scratch.legendaryChance(150), 0.5);
    assert.strictEqual(scratch.legendaryChance(300), 0.5, 'plafond 50 %');
  });

  await test('chaque grille montre son lot, et jamais 3 identiques quand on perd', () => {
    const rand = seeded(42);
    for (let i = 0; i < 20000; i++) {
      const outcome = scratch.drawOutcome(5, rand);
      const grid = scratch.buildGrid(outcome, rand);
      assert.strictEqual(grid.length, 9);
      assert.ok(grid.every((s) => scratch.SYMBOL_KEYS.includes(s)));
      assert.strictEqual(scratch.winningSymbol(grid), outcome.symbol);
      if (outcome.symbol) assert.strictEqual(count(grid, outcome.symbol), 3);
      for (const s of scratch.SYMBOL_KEYS) if (s !== outcome.symbol) assert.ok(count(grid, s) <= 2);
    }
  });

  await test('simulation 1 million de tickets : retour JP$ ≈ 64 %, légendaire ≈ 1/60, gagnant ≈ 1/2,8', () => {
    const rand = seeded(7);
    const N = 1e6;
    let paid = 0; let legendary = 0; let wins = 0; let refunds = 0;
    for (let i = 0; i < N; i++) {
      const o = scratch.drawOutcome(5, rand);
      paid += o.amount;
      if (o.kind === 'legendary') legendary++;
      if (o.kind !== 'lose') wins++;
      if (o.amount === 5) refunds++;
    }
    const rtp = paid / (5 * N);
    assert.ok(Math.abs(rtp - 0.64) < 0.01, `retour JP$ ${(rtp * 100).toFixed(1)} %`);
    assert.ok(Math.abs(legendary / N - 1 / 60) < 0.001, `légendaire ${(legendary / N * 100).toFixed(2)} %`);
    assert.ok(Math.abs(N / wins - 2.84) < 0.1, `1 gagnant sur ${(N / wins).toFixed(2)}`);
    assert.ok(Math.abs(refunds / N - 0.22) < 0.005, `mise remboursée ${(refunds / N * 100).toFixed(1)} %`);
    console.log(`     → retour JP$ ${(rtp * 100).toFixed(1)} %, légendaire 1/${(N / legendary).toFixed(1)}, 1 gagnant sur ${(N / wins).toFixed(2)}`);
  });

  await test('score : victoire si gagnant, jamais si perdant', () => {
    const rand = seeded(11);
    for (let i = 0; i < 20000; i++) {
      const o = scratch.drawOutcome(5, rand);
      const { us, them } = scratch.buildScore(o, rand);
      assert.ok(us >= 0 && them >= 0);
      assert.strictEqual(us > them, o.kind !== 'lose');
    }
  });

  await test('perdant : environ 1 grille sur 3 a deux 🏆 (« presque ! »)', () => {
    const rand = seeded(3);
    let teased = 0;
    for (let i = 0; i < 30000; i++) {
      if (count(scratch.buildGrid({ kind: 'lose', symbol: null, amount: 0 }, rand), 'trophy') === 2) teased++;
    }
    assert.ok(teased / 30000 > 0.3 && teased / 30000 < 0.37, `${(teased / 300).toFixed(1)} %`);
  });

  console.log('\n🧪 Tickets à gratter — achat\n');

  const T0 = Date.UTC(2026, 9, 13, 10, 0);   // mardi 13/10, 12h à Paris
  const alwaysWin = (kind) => {
    // rand qui tombe dans la tranche du lot voulu, puis aléatoire pour la grille
    const table = scratch.prizeTable(5);
    let start = 0;
    for (const p of table) { if (p.kind === kind && (kind === 'legendary' || p.amount === 5)) break; start += p.chance; }
    if (kind === 'lose') start = 0.99;
    const rest = seeded(1);
    let first = true;
    return () => { if (first) { first = false; return start + 1e-9; } return rest(); };
  };

  await test('solde insuffisant → refus, rien débité', () => {
    const r = tickets.buy('U_POOR', T0);
    assert.strictEqual(r.status, 'blocked');
    assert.strictEqual(r.reason, 'balance');
    assert.strictEqual(credits.getBalance('U_POOR'), 0);
  });

  await test('achat gagnant (mise remboursée) : débit puis lot versé tout de suite', () => {
    credits.addCredit('U_A', 100, { source: 'test' });
    const r = tickets.buy('U_A', T0, alwaysWin('jp'));
    assert.strictEqual(r.status, 'bought');
    assert.strictEqual(r.ticket.outcome.amount, 5);
    assert.strictEqual(credits.getBalance('U_A'), 100);
    assert.strictEqual(tickets.boughtToday('U_A', T0), 1);
  });

  await test('ticket pas gratté → pas de 2e achat', () => {
    const r = tickets.buy('U_A', T0);
    assert.strictEqual(r.reason, 'pending');
    assert.ok(r.ticket && r.ticket.id);
  });

  await test('grattage : une seule fois, et seulement par le propriétaire', () => {
    const id = tickets.pendingTicket('U_A').id;
    assert.strictEqual(tickets.markScratched(id, 'U_B').status, 'forbidden');
    assert.strictEqual(tickets.markScratched(id, 'U_A', T0).status, 'scratched');
    assert.strictEqual(tickets.markScratched(id, 'U_A', T0).status, 'already');
    assert.strictEqual(tickets.markScratched('t_inconnu', 'U_A').status, 'not_found');
    assert.strictEqual(tickets.pendingTicket('U_A'), null);
  });

  await test('légendaire : la carte arrive dans la collection à l\'achat', () => {
    const before = collections.getCollection('U_A').reduce((s, c) => s + c.count, 0);
    const r = tickets.buy('U_A', T0, alwaysWin('legendary'));
    assert.strictEqual(r.ticket.outcome.kind, 'legendary');
    assert.strictEqual(r.ticket.card.rarity, 'legendary');
    assert.strictEqual(collections.getCollection('U_A').reduce((s, c) => s + c.count, 0), before + 1);
    assert.strictEqual(credits.getBalance('U_A'), 95);
    tickets.markScratched(r.ticket.id, 'U_A', T0);
  });

  await test('limite du jour (10 par défaut), puis ça repart le lendemain', () => {
    for (let i = tickets.boughtToday('U_A', T0); i < 10; i++) {
      const r = tickets.buy('U_A', T0, alwaysWin('lose'));
      assert.strictEqual(r.status, 'bought');
      tickets.markScratched(r.ticket.id, 'U_A', T0);
    }
    assert.strictEqual(tickets.buy('U_A', T0).reason, 'limit');
    assert.strictEqual(tickets.purchaseBlock('U_A', T0 + 24 * 3600 * 1000), null);
  });

  await test('prix et limite réglables par l\'admin (lots suivant le prix)', () => {
    assert.strictEqual(settings.setTicketSettings({ price: 0, limit: 10 }).field, 'price');
    assert.strictEqual(settings.setTicketSettings({ price: 5, limit: 101 }).field, 'limit');
    const ok = settings.setTicketSettings({ price: 10, limit: 11 });
    assert.ok(ok.ok);
    assert.deepStrictEqual(ok.previous, { price: 5, limit: 10 });
    assert.strictEqual(tickets.purchaseBlock('U_A', T0), null, '11e ticket autorisé');
    const r = tickets.buy('U_A', T0, alwaysWin('lose'));
    assert.strictEqual(r.ticket.price, 10);
    tickets.markScratched(r.ticket.id, 'U_A', T0);
    settings.setTicketSettings({ price: 5, limit: 10 });
  });

  await test('pénalité anti-farm → achat refusé', () => {
    credits.addCredit('U_FARM', 50, { source: 'test' });
    fs.writeFileSync(path.join(TMP, 'data', 'farm.json'), JSON.stringify({ history: {}, penalties: { U_FARM: T0 + 3600 * 1000 } }));
    assert.strictEqual(tickets.buy('U_FARM', T0).reason, 'penalty');
    assert.strictEqual(credits.getBalance('U_FARM'), 50);
  });

  console.log('\n🧪 Tickets à gratter — page web\n');

  const changed = [];
  const server = web.startWebServer({ client: {}, logger: quiet, port: 0, onOpened: (u) => changed.push(u) });
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const tokenOf = (u) => new URL(web.buildTicketsUrl(u)).searchParams.get('t');
  const api = (p, t, method = 'GET') => fetch(`${base}/api/tickets${p}?t=${encodeURIComponent(t)}`, { method });

  await test('buildTicketsUrl → WEB_PUBLIC_URL/tickets?t=<user>.<hex64>', () => {
    assert.match(web.buildTicketsUrl('U_W'), /^https:\/\/example\.test\/jeanpip\/tickets\?t=U_W\.[a-f0-9]{64}$/);
  });

  await test('la page est servie avec ses assets versionnés', async () => {
    const res = await fetch(`${base}/tickets`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(!html.includes('__ASSET_VERSION__'));
    assert.strictEqual((await fetch(`${base}/tickets.js`)).status, 200);
    assert.strictEqual((await fetch(`${base}/tickets.css`)).status, 200);
  });

  await test('jeton invalide ou d\'un autre joueur → 403', async () => {
    assert.strictEqual((await api('', 'U_W.' + 'f'.repeat(64))).status, 403);
    assert.strictEqual((await api('', tokenOf('U_X').replace(/^U_X/, 'U_W'))).status, 403);
  });

  await test('parcours : état → achat (lot caché) → grattage (lot révélé)', async () => {
    credits.addCredit('U_W', 20, { source: 'test' });
    const t = tokenOf('U_W');
    const s0 = await (await api('', t)).json();
    assert.strictEqual(s0.price, 5);
    assert.strictEqual(s0.limit, 10);
    assert.strictEqual(s0.ticket, null);
    assert.strictEqual(s0.prizes.length, 6);

    const s1 = await (await api('/buy', t, 'POST')).json();
    assert.strictEqual(s1.bought, true);
    assert.strictEqual(s1.ticket.grid.length, 9);
    assert.strictEqual(s1.ticket.result, undefined, 'lot pas envoyé avant le grattage');
    assert.strictEqual(s1.block, 'pending');
    await new Promise((r) => setTimeout(r, 20));
    assert.deepStrictEqual(changed, ['U_W'], 'Accueil rafraîchi');

    const again = await (await api('/buy', t, 'POST')).json();
    assert.strictEqual(again.bought, false);
    assert.strictEqual(again.reason, 'pending');
    assert.strictEqual(again.ticket.id, s1.ticket.id, 'la page reprend le même ticket');

    const s2 = await (await api(`/${s1.ticket.id}/scratched`, t, 'POST')).json();
    assert.ok(s2.result && ['legendary', 'jp', 'lose'].includes(s2.result.kind));
    assert.strictEqual(s2.ticket, null);
    assert.strictEqual(s2.boughtToday, 1);
  });

  await test('gratter le ticket d\'un autre → 404', async () => {
    credits.addCredit('U_V', 20, { source: 'test' });
    const bought = await (await api('/buy', tokenOf('U_V'), 'POST')).json();
    assert.strictEqual((await api(`/${bought.ticket.id}/scratched`, tokenOf('U_W'), 'POST')).status, 404);
  });

  server.close();
  console.log(`\n${passed} test(s) OK${process.exitCode ? ' — ❌ ÉCHECS ci-dessus' : ''}\n`);
  mod('db.js').close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows : fichier encore verrouillé */ }
  process.exit(process.exitCode || 0);
})();
