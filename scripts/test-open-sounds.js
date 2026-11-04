#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Bruitages de l'ouverture de booster (v3.9)
//
//  • quel son pour quelle rareté (public/open-sounds.js)
//  • son activé par défaut, 🔇 mémorisé respecté
//  • les mp3 sont dans le projet et servis en audio/mpeg
//  • la page charge le module et s'en sert au bon endroit
//
//  Copie src/ et public/ dans un dossier temporaire (aucun
//  fichier runtime réel touché).
//
//  Usage : node scripts/test-open-sounds.js
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const SOUNDS_DIR = path.join(ROOT, 'public', 'assets', 'sounds');
const sounds = require('../public/open-sounds.js');

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

const isMp3 = (buf) => buf.slice(0, 3).toString('latin1') === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);

(async () => {
  console.log('\n🧪 Bruitages de l\'ouverture\n');

  await test('révélation : Rare / Épique / Légendaire → leur mp3', () => {
    assert.strictEqual(sounds.revealFileFor('rare'), 'rare.mp3');
    assert.strictEqual(sounds.revealFileFor('epic'), 'epic.mp3');
    assert.strictEqual(sounds.revealFileFor('legendary'), 'legendaire.mp3');
  });

  await test('révélation : Commune, 🎀 Octobre Rose, 🎃 Halloween → son synthétique (null)', () => {
    for (const r of ['common', 'rose', 'halloween', undefined, 'inconnue']) {
      assert.strictEqual(sounds.revealFileFor(r), null, String(r));
    }
  });

  await test('son activé par défaut ; seul un « off » mémorisé le coupe', () => {
    assert.strictEqual(sounds.isSoundOn(null), true, 'jamais réglé');
    assert.strictEqual(sounds.isSoundOn('on'), true);
    assert.strictEqual(sounds.isSoundOn('off'), false);
  });

  await test('les 3 bruitages sont dans le projet, en MP3 et légers (< 200 Ko)', () => {
    for (const r of ['rare', 'epic', 'legendary']) {
      const file = path.join(SOUNDS_DIR, sounds.FILES[r]);
      assert.ok(fs.existsSync(file), `${sounds.FILES[r]} manquant`);
      const buf = fs.readFileSync(file);
      assert.ok(isMp3(buf), `${sounds.FILES[r]} n'est pas un MP3`);
      assert.ok(buf.length < 200 * 1024, `${sounds.FILES[r]} trop lourd (${buf.length} o)`);
    }
  });

  await test('ouverture.mp3 facultatif : s\'il est là, c\'est un MP3', () => {
    const file = path.join(SOUNDS_DIR, sounds.FILES.open);
    if (fs.existsSync(file)) assert.ok(isMp3(fs.readFileSync(file)));
  });

  // ── Page : chargement du module et branchements ──
  const html = fs.readFileSync(path.join(ROOT, 'public', 'open.html'), 'utf-8');
  const js = fs.readFileSync(path.join(ROOT, 'public', 'open.js'), 'utf-8');

  await test('open.html charge open-sounds.js avant open.js', () => {
    const a = html.indexOf('open-sounds.js');
    const b = html.indexOf('../open.js');
    assert.ok(a > 0 && b > a);
  });

  await test('open.js : révélation par mp3, annonce Épique en synthétique, coupure en enchaînant', () => {
    assert.match(js, /playFile\(SOUNDS\.revealFileFor\(rarity\)\)/, 'reveal() passe par les mp3');
    assert.match(js, /playFile\(SOUNDS\.FILES\.open\)/, 'déchirure : ouverture.mp3 si présent');
    assert.match(js, /sound\.synthReveal\(best\)/, 'écran ÉPIQUE : son synthétique');
    assert.match(js, /sound\.fanfare\(\)/, 'écran LÉGENDAIRE : fanfare');
    assert.match(js, /sound\.stopFile\(\);\s*\/\/ carte suivante/, 'carte suivante : bruitage coupé');
    assert.match(js, /SOUNDS\.isSoundOn\(localStorage/, 'préférence lue via isSoundOn');
    assert.match(js, /all\.push\(sound\.preload\(\)\)/, 'bruitages téléchargés avant le pack');
  });

  // ── Serveur : statiques ──
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-sounds-'));
  fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
  fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
  fs.mkdirSync(path.join(TMP, 'data'));
  fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));
  process.env.WEB_PUBLIC_URL = 'https://example.test/jeanpip';
  process.env.WEB_SECRET = 'secret-de-test';

  const origLog = console.log;
  console.log = () => {};
  const web = require(path.join(TMP, 'src', 'web.js'));
  console.log = origLog;
  const quiet = { info() {}, warn() {}, error() {} };
  const server = web.startWebServer({ client: {}, logger: quiet, port: 0 });
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  await test('les mp3 sont servis en audio/mpeg, avec le cache long des assets', async () => {
    for (const r of ['rare', 'epic', 'legendary']) {
      const res = await fetch(`${base}/${sounds.DIR}${sounds.FILES[r]}`);
      assert.strictEqual(res.status, 200, sounds.FILES[r]);
      assert.strictEqual(res.headers.get('content-type'), 'audio/mpeg');
      assert.match(res.headers.get('cache-control'), /max-age=604800/);
      const body = Buffer.from(await res.arrayBuffer());
      assert.ok(body.equals(fs.readFileSync(path.join(SOUNDS_DIR, sounds.FILES[r]))), 'contenu identique');
    }
  });

  await test('ouverture.mp3 absent → 404 (la page garde la déchirure synthétique)', async () => {
    if (fs.existsSync(path.join(SOUNDS_DIR, sounds.FILES.open))) return;
    assert.strictEqual((await fetch(`${base}/${sounds.DIR}${sounds.FILES.open}`)).status, 404);
  });

  await test('open-sounds.js versionné comme open.js (même ?v=)', async () => {
    const page = await (await fetch(`${base}/open/b_x`)).text();
    const mod = /src="\.\.\/open-sounds\.js\?v=([a-f0-9]{10})"/.exec(page);
    const main = /src="\.\.\/open\.js\?v=([a-f0-9]{10})"/.exec(page);
    assert.ok(mod && main && mod[1] === main[1]);
    assert.strictEqual((await fetch(`${base}/open-sounds.js?v=${mod[1]}`)).status, 200);
  });

  server.close();
  try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} test(s) OK${process.exitCode ? ' — ❌ ÉCHECS ci-dessus' : ' 🎉'}\n`);
})();
