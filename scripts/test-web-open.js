#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test de la page d'ouverture animée (sans Slack)
//
//  Copie src/, public/ et la banque de médias dans un dossier
//  temporaire → aucun fichier runtime réel (boosters, collections…)
//  n'est touché, même lancé sur la VM de prod.
//
//  Usage : node scripts/test-web-open.js
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-web-'));

fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

process.env.WEB_PUBLIC_URL = 'https://example.test/jeanpip';
process.env.WEB_SECRET = 'secret-de-test';

const quiet = { info() {}, warn() {}, error() {} };
const origLog = console.log;
console.log = () => {}; // logs de chargement de media.js
const web = require(path.join(TMP, 'src', 'web.js'));
const boosters = require(path.join(TMP, 'src', 'boosters.js'));
const collections = require(path.join(TMP, 'src', 'collections.js'));
const { openOnce } = require(path.join(TMP, 'src', 'openBooster.js'));
console.log = origLog;

// Client Slack factice
const updates = [];
const fakeClient = {
  chat: { update: async (args) => { updates.push(args); } },
  files: { info: async () => { throw new Error('pas de Slack en test'); } },
};

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

(async () => {
  const openedFor = []; // appels du hook onOpened (rafraîchissement de l'Accueil)
  const server = web.startWebServer({ client: fakeClient, logger: quiet, port: 0, onOpened: (u) => openedFor.push(u) });
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const tokenOf = (id, owner) => new URL(web.buildOpenUrl(id, owner)).searchParams.get('t');
  const post = (id, t) => fetch(`${base}/api/open/${id}?t=${t}`, { method: 'POST' });
  const totalCards = (u) => collections.getCollection(u).reduce((s, c) => s + c.count, 0);

  console.log('\n🧪 Page d\'ouverture animée\n');

  await test('buildOpenUrl pointe vers WEB_PUBLIC_URL/open/<id>?t=<hex64>', () => {
    const url = web.buildOpenUrl('b_x', 'U1');
    assert.match(url, /^https:\/\/example\.test\/jeanpip\/open\/b_x\?t=[a-f0-9]{64}$/);
  });

  await test('la page open.html est servie sur /open/<id>', async () => {
    const res = await fetch(`${base}/open/b_x`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
  });

  await test('open.css / open.js sont versionnés (?v=<hash>) contre le cache Cloudflare', async () => {
    const html = await (await fetch(`${base}/open/b_x`)).text();
    assert.ok(!html.includes('__ASSET_VERSION__'), 'placeholder remplacé');
    const css = /href="\.\.\/open\.css\?v=([a-f0-9]{10})"/.exec(html);
    const js = /src="\.\.\/open\.js\?v=([a-f0-9]{10})"/.exec(html);
    assert.ok(css && js && css[1] === js[1], 'même version sur le CSS et le JS');
    assert.strictEqual((await fetch(`${base}/open.css?v=${css[1]}`)).status, 200);
  });

  await test('les statiques sont servis (open.js, fond)', async () => {
    assert.strictEqual((await fetch(`${base}/open.js`)).status, 200);
    assert.strictEqual((await fetch(`${base}/assets/bg-lorient.jpg`)).status, 200);
  });

  const idA = boosters.createPending('U_A', 'epic');
  boosters.setMessageRef(idA, 'D_A', '123.456');

  await test('token invalide → 403, booster pas ouvert', async () => {
    const res = await post(idA, 'f'.repeat(64));
    assert.strictEqual(res.status, 403);
    assert.strictEqual(boosters.getPending(idA).opened, false);
  });

  await test('token d\'un autre user → 403', async () => {
    assert.strictEqual((await post(idA, tokenOf(idA, 'U_B'))).status, 403);
  });

  await test('booster inconnu → 404', async () => {
    assert.strictEqual((await post('b_inconnu', 'a'.repeat(64))).status, 404);
  });

  let firstCards;
  await test('ouverture valide → 8 cartes, en collection, DM mis à jour', async () => {
    const res = await post(idA, tokenOf(idA, 'U_A'));
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.status, 'opened');
    assert.strictEqual(data.cards.length, 8);
    assert.strictEqual(data.booster.type, 'epic');
    assert.ok(data.cards.every((c) => c.count >= 1 && c.title && c.rarity));
    assert.strictEqual(totalCards('U_A'), 8);
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(updates.length, 1);
    assert.strictEqual(updates[0].channel, 'D_A');
    assert.deepStrictEqual(openedFor, ['U_A'], 'onOpened appelé une fois pour le propriétaire');
    firstCards = data.cards;
  });

  await test('rejeu → mêmes cartes, collection non doublée, pas de 2e mise à jour DM', async () => {
    const data = await (await post(idA, tokenOf(idA, 'U_A'))).json();
    assert.strictEqual(data.status, 'replay');
    assert.deepStrictEqual(data.cards, firstCards);
    assert.strictEqual(totalCards('U_A'), 8);
    assert.strictEqual(updates.length, 1);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepStrictEqual(openedFor, ['U_A'], 'onOpened rappelé sur un rejeu');
  });

  await test('ouvert en web → le bouton Slack répond « déjà ouvert (web) »', () => {
    const r = openOnce(idA, 'U_A', 'slack');
    assert.strictEqual(r.status, 'already');
    assert.strictEqual(r.via, 'web');
  });

  await test('ouvert dans Slack → la page répond already_slack', async () => {
    const idS = boosters.createPending('U_S', 'common');
    assert.strictEqual(openOnce(idS, 'U_S', 'slack').status, 'opened');
    const data = await (await post(idS, tokenOf(idS, 'U_S'))).json();
    assert.strictEqual(data.status, 'already_slack');
    assert.strictEqual(totalCards('U_S'), 8);
  });

  await test('4 ouvertures web simultanées → une seule tire, les autres rejouent', async () => {
    const idC = boosters.createPending('U_C', 'rare');
    const t = tokenOf(idC, 'U_C');
    const responses = await Promise.all([post(idC, t), post(idC, t), post(idC, t), post(idC, t)]);
    const statuses = (await Promise.all(responses.map((r) => r.json()))).map((d) => d.status).sort();
    assert.deepStrictEqual(statuses, ['opened', 'replay', 'replay', 'replay']);
    assert.strictEqual(totalCards('U_C'), 8);
  });

  await test('onOpened : seulement les vraies ouvertures web (pas token invalide, rejeu, déjà ouvert Slack)', async () => {
    await new Promise((r) => setTimeout(r, 20));
    assert.deepStrictEqual(openedFor, ['U_A', 'U_C']);
  });

  await test('onOpened qui plante → la page répond quand même', async () => {
    const idE = boosters.createPending('U_E', 'common');
    const s2 = web.startWebServer({ client: fakeClient, logger: quiet, port: 0, onOpened: () => { throw new Error('boum'); } });
    await new Promise((r) => s2.once('listening', r));
    const res = await fetch(`http://127.0.0.1:${s2.address().port}/api/open/${idE}?t=${tokenOf(idE, 'U_E')}`, { method: 'POST' });
    assert.strictEqual((await res.json()).status, 'opened');
    s2.close();
  });

  await test('mauvais propriétaire côté Slack → forbidden', () => {
    const idF = boosters.createPending('U_F', 'common');
    assert.strictEqual(openOnce(idF, 'U_INTRUS', 'slack').status, 'forbidden');
    assert.strictEqual(boosters.getPending(idF).opened, false);
  });

  await test('sortie de public/ via .. → 404', async () => {
    for (const p of ['/../src/web.js', '/%2e%2e/src/web.js', '/..%2fsrc%2fweb.js', '/assets/..%2f..%2fdata%2fweb-secret']) {
      const res = await fetch(`${base}${p}`);
      assert.notStrictEqual(res.status, 200, p);
    }
  });

  await test('image hors banque → 404 (liste blanche)', async () => {
    assert.strictEqual((await fetch(`${base}/api/card-image/FNOTINBANK1`)).status, 404);
  });

  // Droits Unix : vérifiés sur la VM (Linux), sautés sous Windows
  if (process.platform === 'win32') console.log('  ⏭️  secret en 600 : sauté sous Windows (à lancer sur la VM)');
  else await test('secret généré → fichier data/web-secret en 600 (resserré si déjà là)', () => {
    const { execFileSync } = require('child_process');
    const secretFile = path.join(TMP, 'data', 'web-secret');
    const run = () => execFileSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(TMP, 'src', 'web.js'))}).signToken('b', 'U')`], {
      env: { ...process.env, WEB_SECRET: '' }, stdio: 'ignore',
    });
    run();
    assert.strictEqual(fs.statSync(secretFile).mode & 0o777, 0o600, 'création');
    fs.chmodSync(secretFile, 0o644);
    run();
    assert.strictEqual(fs.statSync(secretFile).mode & 0o777, 0o600, 'fichier existant');
  });

  await test('GET sur /api/open → 405', async () => {
    assert.strictEqual((await fetch(`${base}/api/open/${idA}`)).status, 405);
  });

  server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} test(s) OK${process.exitCode ? ' — ❌ ÉCHECS ci-dessus' : ' 🎉'}\n`);
})();
