#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test du classeur Panini (page web + API, sans Slack)
//
//  Copie src/, public/ et la banque de médias dans un dossier
//  temporaire → aucun fichier runtime réel n'est touché.
//
//  Usage : node scripts/test-collection.js
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-album-test-'));

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
const media = require(path.join(TMP, 'src', 'media.js'));
const home = require(path.join(TMP, 'src', 'home.js'));
const { buildAlbum } = require(path.join(TMP, 'src', 'album.js'));
console.log = origLog;

let nameCalls = 0;
const fakeClient = {
  chat: { update: async () => {} },
  users: { info: async ({ user }) => { nameCalls++; return { user: { profile: { display_name: `Nom-${user}` } } }; } },
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
  const server = web.startWebServer({ client: fakeClient, logger: quiet, port: 0 });
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const tokenOf = (u) => new URL(web.buildCollectionUrl(u)).searchParams.get('t');
  const api = (u, t) => fetch(`${base}/api/collection/${u}?t=${t}`);

  const bank = media.getAllMedia();
  const pick = (rarity, n) => bank.filter((m) => m.rarity === rarity).slice(0, n);

  console.log('\n🧪 Classeur Panini\n');

  await test('buildCollectionUrl pointe vers WEB_PUBLIC_URL/collection/<user>?t=<hex64>', () => {
    assert.match(web.buildCollectionUrl('U1'), /^https:\/\/example\.test\/jeanpip\/collection\/U1\?t=[a-f0-9]{64}$/);
  });

  await test('le token du classeur ≠ token de booster (pas réutilisable)', () => {
    assert.notStrictEqual(tokenOf('U1'), web.signToken('collection', 'U1'));
    assert.notStrictEqual(tokenOf('U1'), web.signToken('U1', 'U1'));
  });

  await test('la page collection.html est servie, assets versionnés', async () => {
    const res = await fetch(`${base}/collection/U1`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    const css = /href="\.\.\/collection\.css\?v=([a-f0-9]{10})"/.exec(html);
    const js = /src="\.\.\/collection\.js\?v=([a-f0-9]{10})"/.exec(html);
    assert.ok(css && js && css[1] === js[1], 'même version sur le CSS et le JS');
    assert.strictEqual((await fetch(`${base}/collection.js`)).status, 200);
  });

  await test('la page d\'ouverture garde sa propre version d\'assets', async () => {
    const html = await (await fetch(`${base}/open/b_x`)).text();
    assert.match(html, /open\.css\?v=[a-f0-9]{10}/);
  });

  await test('token invalide / d\'un autre joueur → 403', async () => {
    assert.strictEqual((await api('U_A', 'f'.repeat(64))).status, 403);
    assert.strictEqual((await api('U_A', tokenOf('U_B'))).status, 403);
    assert.strictEqual((await api('U_A', 'pas-hex')).status, 403);
  });

  await test('classeur vide : tous les emplacements, rien de possédé', async () => {
    const data = await (await api('U_A', tokenOf('U_A'))).json();
    assert.strictEqual(data.status, 'ok');
    assert.strictEqual(data.owner.name, 'Nom-U_A');
    assert.strictEqual(data.stats.total, bank.length);
    assert.strictEqual(data.stats.owned, 0);
    assert.deepStrictEqual(data.sections.map((s) => s.key), ['common', 'rare', 'epic', 'legendary']);
  });

  const cards = [...pick('common', 3), ...pick('rare', 1), ...pick('legendary', 1)];
  collections.addCards('U_A', cards);
  collections.addCards('U_A', [cards[0], cards[0]]);

  let v1;
  await test('cartes possédées : compteurs, doublons, image, lien', async () => {
    const data = await (await api('U_A', tokenOf('U_A'))).json();
    v1 = data.version;
    assert.strictEqual(data.stats.owned, 5);
    assert.strictEqual(data.stats.copies, 7);
    assert.strictEqual(data.stats.doubles, 2);
    assert.strictEqual(data.stats.byRarity.legendary.owned, 1);
    const owned = data.sections.flatMap((s) => s.stickers).filter((s) => s.owned);
    const first = owned.find((s) => s.link === cards[0].url);
    assert.strictEqual(first.count, 3);
    assert.match(first.image, /^api\/card-image\/F[A-Z0-9]+$/);
  });

  await test('cartes manquantes : seulement numéro + rareté (ni image, ni titre, ni lien)', async () => {
    const data = await (await api('U_A', tokenOf('U_A'))).json();
    const missing = data.sections.flatMap((s) => s.stickers).filter((s) => !s.owned);
    assert.strictEqual(missing.length, bank.length - 5);
    for (const st of missing) assert.deepStrictEqual(Object.keys(st).sort(), ['n', 'owned', 'rarity']);
    const raw = JSON.stringify(data);
    const hidden = bank.filter((m) => !cards.includes(m));
    assert.ok(hidden.every((m) => !raw.includes(m.url)), 'aucune URL de carte manquante');
  });

  await test('numéros = « Surprise #N », triés dans chaque intercalaire', () => {
    const album = buildAlbum('U_A');
    const all = album.sections.flatMap((s) => s.stickers.map((st) => st.n));
    assert.strictEqual(new Set(all).size, all.length, 'numéros uniques');
    for (const s of album.sections) {
      const ns = s.stickers.map((st) => st.n);
      assert.deepStrictEqual(ns, [...ns].sort((a, b) => a - b));
    }
    const n1 = album.sections[0].stickers.find((st) => st.link === bank[0].url);
    assert.strictEqual(n1.n, 1);
  });

  await test('version change quand une carte arrive (le direct), pas sinon', async () => {
    const same = await (await api('U_A', tokenOf('U_A'))).json();
    assert.strictEqual(same.version, v1);
    collections.addCards('U_A', pick('epic', 1));
    const next = await (await api('U_A', tokenOf('U_A'))).json();
    assert.notStrictEqual(next.version, v1);
    assert.strictEqual(next.stats.owned, 6);
  });

  await test('carte possédée retirée de la banque → intercalaire « Hors série », hors complétion', () => {
    collections.addCards('U_A', [{ url: 'https://example.test/vieille.gif', title: '👻 Surprise #999', rarity: 'rare', type: 'image' }]);
    const album = buildAlbum('U_A');
    const extra = album.sections.find((s) => s.key === 'extra');
    assert.ok(extra && extra.stickers.length === 1);
    assert.strictEqual(extra.stickers[0].n, 999);
    assert.strictEqual(album.stats.total, bank.length);
    assert.strictEqual(album.stats.owned, 6);
  });

  await test('nom Slack mis en cache (un seul users.info par joueur)', async () => {
    const before = nameCalls;
    await api('U_A', tokenOf('U_A'));
    await api('U_A', tokenOf('U_A'));
    assert.strictEqual(nameCalls, before);
  });

  await test('users.info en échec → classeur servi quand même (nom null)', async () => {
    const s2 = web.startWebServer({ client: { users: { info: async () => { throw new Error('missing_scope'); } } }, logger: quiet, port: 0 });
    await new Promise((r) => s2.once('listening', r));
    const res = await fetch(`http://127.0.0.1:${s2.address().port}/api/collection/U_Z?t=${tokenOf('U_Z')}`);
    const data = await res.json();
    s2.close();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.owner.name, null);
  });

  await test('ouverture de booster web → renvoie le lien relatif du classeur', async () => {
    const id = boosters.createPending('U_K', 'common');
    const t = new URL(web.buildOpenUrl(id, 'U_K')).searchParams.get('t');
    const data = await (await fetch(`${base}/api/open/${id}?t=${t}`, { method: 'POST' })).json();
    assert.strictEqual(data.collection, `collection/U_K?t=${tokenOf('U_K')}`);
  });

  await test('Accueil : bouton-lien « Mon classeur » si la page web est active, rien sinon', () => {
    const ctx = {
      isAdmin: false, attackPrice: 30, creditsPerJeanpipLabel: '1', targetEmoji: 'x',
      farmRemainingMs: 0, farmQuota: { used: 0, max: 10, nextFreeMs: 0 }, formatRemaining: () => '',
    };
    const find = (view) => view.blocks.find((b) => b.accessory && b.accessory.action_id === 'open_collection_web');
    const withUrl = find(home.buildHomeView('U_A', { ...ctx, collectionUrl: web.buildCollectionUrl('U_A') }));
    assert.ok(withUrl, 'bouton présent');
    assert.strictEqual(withUrl.accessory.url, web.buildCollectionUrl('U_A'));
    assert.ok(!find(home.buildHomeView('U_A', { ...ctx, collectionUrl: null })), 'absent sans page web');
  });

  server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} test(s) OK${process.exitCode ? ' — ❌ ÉCHECS ci-dessus' : ' 🎉'}\n`);
})();
