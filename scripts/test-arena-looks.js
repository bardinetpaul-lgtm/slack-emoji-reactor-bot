#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test du « look » des cartes (src/game/looks.js + lookAnalyzer.js)
//
//  • Priorité : analyse Haiku > traits d'origine > couleurs des pixels
//    > tirage stable ; même carte → même look.
//  • Couleurs lues dans une photo (image de synthèse : visage, chapeau,
//    tenue) ; réduction JPEG avant l'envoi à Haiku.
//  • Réponse de Haiku revalidée (valeurs hors liste remplacées).
//  • needsLook / backfill : règles périmées, analyse devenue possible.
//  Sans réseau ni clé (les appels Haiku ne sont pas faits ici).
//
//  Usage : node scripts/test-arena-looks.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-arena-looks-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));
// la copie résout les modules (pngjs, jpeg-js) depuis le dépôt
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_FOUNDRY_API_KEY;

const origLog = console.log;
console.log = () => {};
const looks = require(path.join(TMP, 'src', 'game', 'looks.js'));
const analyzer = require(path.join(TMP, 'src', 'game', 'lookAnalyzer.js'));
console.log = origLog;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}
const LOOKS = path.join(TMP, 'data', 'card-looks.json');
const write = (data) => { fs.writeFileSync(LOOKS, JSON.stringify(data)); looks.reload(); };

// 🔑 Clés
check('clé = FILEID Slack', looks.keyOf({ url: 'https://slack-files.com/T6EF-F0ABC123-xyz' }) === 'F0ABC123');
check('clé = URL sinon', looks.keyOf({ url: 'https://youtu.be/abc' }) === 'https://youtu.be/abc');

// 👁 Priorités
const fresh = { url: 'https://example.com/nouvelle.gif', title: 'Nouvelle' };
const seed = looks.getLook(fresh);
check('carte inconnue : tirage stable, complet', seed.source === 'seed' && analyzer.VOCAB.head.includes(seed.head) && Array.isArray(seed.accessories) && /^#/.test(seed.outfit));
check('tirage stable : même carte → même look', JSON.stringify(looks.getLook(fresh)) === JSON.stringify(seed));
const bundled = looks.getLook({ url: 'https://slack-files.com/T6EFSEHCN-F0APX27B02Z-0abf85e576' });
check('carte d’origine : traits analysés d’avance (chapeau, moustache, pipe)', bundled.source === 'traits' && bundled.head === 'chapeau' && bundled.facial === 'moustache' && bundled.accessories.includes('pipe'));
write({ 'https://example.com/nouvelle.gif': { rules: looks.RULES_VERSION, source: 'pixels', colors: { outfit: '#123456', outfit2: '#abcdef', accent: '#ff0000', skin: '#e0b090', hair: '#222222', hatColor: '#333333' } } });
check('couleurs des pixels : reprises', looks.getLook(fresh).source === 'pixels' && looks.getLook(fresh).outfit === '#123456');
write({ F0APX27B02Z: { rules: looks.RULES_VERSION, source: 'haiku', traits: { head: 'couronne', hairStyle: 'bol', glasses: 'soleil', facial: 'guidon', accessories: ['chaine'], weapon: 'hache', skin: '#e0a896', hair: '#111111', hatColor: '#ffc83d', outfit: '#222222', outfit2: '#cccccc', accent: '#ff0000', prop: 'none', vibe: '' } } });
const hk = looks.getLook({ url: 'https://slack-files.com/T6EFSEHCN-F0APX27B02Z-0abf85e576' });
check('analyse Haiku : prioritaire sur les traits d’origine', hk.source === 'haiku' && hk.head === 'couronne' && hk.facial === 'guidon');

// 🔄 À refaire ?
write({ 'https://example.com/nouvelle.gif': { rules: 1, source: 'pixels', colors: {} } });
check('règles périmées → à refaire', looks.needsLook(fresh));
write({ 'https://example.com/nouvelle.gif': { rules: looks.RULES_VERSION, source: 'pixels', colors: {} } });
check('à jour, sans clé Haiku → rien à faire', !looks.needsLook(fresh));
process.env.ANTHROPIC_FOUNDRY_API_KEY = 'test';
check('clé Haiku ajoutée → les looks « couleurs » sont à analyser', looks.needsLook(fresh));
delete process.env.ANTHROPIC_FOUNDRY_API_KEY;
check('--force → toujours à refaire', looks.needsLook(fresh, { force: true }));

// 🎨 Couleurs lues dans une photo de synthèse : fond gris, chapeau rouge, visage, tenue bleue
function synth() {
  const W = 200;
  const H = 240;
  const data = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      let c = [120, 124, 122];                                              // fond
      if (Math.hypot(x - 100, y - 95) < 38) c = [226, 176, 150];            // visage
      if (y > 40 && y < 62 && x > 55 && x < 145) c = [210, 30, 30];         // chapeau
      if (y > 150) c = x > 45 && x < 155 ? [30, 60, 170] : c;               // tenue
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}
const img = synth();
const colors = looks.extractColors(img);
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
check('couleurs : peau du visage', rgb(colors.skin)[0] > 190 && rgb(colors.skin)[2] < 180);
check('couleurs : tenue bleue', rgb(colors.outfit)[2] > 140 && rgb(colors.outfit)[0] < 80);
check('couleurs : couvre-chef rouge au-dessus du visage', rgb(colors.hatColor)[0] > 170 && rgb(colors.hatColor)[1] < 80);
const png = require(path.join(ROOT, 'node_modules', 'pngjs')).PNG.sync.write(img);
check('décodage PNG', looks.decode(png, 'image/png').width === 200);

// 🔎 Préparation pour Haiku
const big = { width: 1600, height: 1000, data: Buffer.alloc(1600 * 1000 * 4, 200) };
const jpg = analyzer.shrink(big);
const dec = require(path.join(ROOT, 'node_modules', 'jpeg-js')).decode(jpg);
check('photo réduite à 640 px max en JPEG avant l’envoi', dec.width === 640 && dec.height === 400);
const clean = analyzer.sanitize({ head: 'sombrero', hairStyle: 'bol', glasses: 'soleil', facial: 'guidon', accessories: ['pipe', 'fusee', 'pipe', 'chaine', 'cravate', 'medaille'], weapon: 'bazooka', skin: '#E0A896', hair: 'marron', hatColor: '#123456', outfit: '#000000', outfit2: '#ffffff', accent: '#ff0000', prop: 'PIPE', vibe: 'Test' }, { hair: '#3b2a1e' });
check('Haiku revalidé : valeur hors liste remplacée', clean.head === 'none' && clean.weapon === 'epee' && clean.hairStyle === 'bol');
check('Haiku revalidé : accessoires connus, sans doublon, 3 max', clean.accessories.join() === 'pipe,chaine,cravate');
check('Haiku revalidé : couleur invalide → repli', clean.hair === '#3b2a1e' && clean.skin === '#e0a896');
check('sans clé : analyse désactivée', !analyzer.enabled());

// 🗂️ Backfill (cartes sans photo lisible → look « none », jamais d'échec)
(async () => {
  write({});
  const cards = [{ url: 'https://example.com/a.gif', title: 'A' }, { url: 'https://example.com/b.gif', title: 'B' }];
  const r = await looks.backfill(cards, { logger: { warn() {}, error() {} } });
  check('backfill : chaque carte traitée une fois', r.done === 2 && r.none === 2);
  const again = await looks.backfill(cards, { logger: { warn() {}, error() {} } });
  check('backfill : déjà à jour → rien à refaire', again.skipped === 2 && again.done === 0);
  check('backfill : looks enregistrés dans data/card-looks.json', Object.keys(JSON.parse(fs.readFileSync(LOOKS, 'utf-8'))).length === 2);

  try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }   // Windows : fichier ouvert = non supprimable
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
  process.exit(failures ? 1 : 0);
})();
