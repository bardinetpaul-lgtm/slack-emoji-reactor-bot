#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test de l'écriture sûre des fichiers de données (src/storage.js)
//
//  Le bug (v3.0.3) : la VM tombe en pleine écriture → fichier JSON
//  tronqué → au redémarrage le module repart vide → la sauvegarde
//  suivante écrase les données de tout le monde.
//
//  Travaille dans une COPIE temporaire du projet (aucune donnée réelle
//  touchée).
//
//  Usage : node scripts/test-storage.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-storage-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
const DATA = path.join(TMP, 'data');
fs.mkdirSync(DATA);

const { readJson, writeJsonAtomic, writeFileAtomic } = require(path.join(TMP, 'src', 'storage.js'));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

/** Exécute fn en capturant console.error. */
function captureErrors(fn) {
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    return { result: fn(), logged };
  } finally {
    console.error = original;
  }
}

const leftovers = (dir, base, marker) => fs.readdirSync(dir).filter((f) => f.startsWith(base) && f.includes(marker));

// ─────────────────────────────────────────────
// 1. Écriture atomique
// ─────────────────────────────────────────────
const FILE = path.join(DATA, 'demo.json');
writeJsonAtomic(FILE, { v: 1 });
writeJsonAtomic(FILE, { v: 2, liste: [1, 2, 3] });
check('écriture atomique : la cible a le nouveau contenu', JSON.parse(fs.readFileSync(FILE, 'utf-8')).v === 2);
check('écriture atomique : indentation 2 conservée', fs.readFileSync(FILE, 'utf-8') === JSON.stringify({ v: 2, liste: [1, 2, 3] }, null, 2));
check('écriture atomique : aucun fichier temporaire restant', leftovers(DATA, 'demo.json', '.tmp-').length === 0);
writeJsonAtomic(FILE, { v: 3 }, 1);
check('indentation personnalisée (looks : 1)', fs.readFileSync(FILE, 'utf-8') === JSON.stringify({ v: 3 }, null, 1));
writeFileAtomic(path.join(DATA, 'bin.dat'), Buffer.from([1, 2, 3]));
check('écriture atomique binaire (cache images)', fs.readFileSync(path.join(DATA, 'bin.dat')).equals(Buffer.from([1, 2, 3])));
check('lecture : fichier absent → valeur par défaut', readJson(path.join(DATA, 'absent.json'), 'défaut') === 'défaut');
check('lecture : fichier valide → contenu', readJson(FILE, null).v === 3);

// ─────────────────────────────────────────────
// 2. Fichier tronqué / corrompu
// ─────────────────────────────────────────────
const BAD = path.join(DATA, 'abime.json');
const badBytes = '{"users":{"U1":{"cards":{"a":{"cou';
fs.writeFileSync(BAD, badBytes);
const { result: fallback, logged } = captureErrors(() => readJson(BAD, { users: {} }));
const backups = leftovers(DATA, 'abime.json', '.corrupt-');
check('corrompu : valeur par défaut renvoyée', fallback && typeof fallback.users === 'object' && Object.keys(fallback.users).length === 0);
check('corrompu : fichier mis de côté en *.corrupt-*', backups.length === 1);
check('corrompu : la copie garde les octets d\'origine', backups.length === 1 && fs.readFileSync(path.join(DATA, backups[0]), 'utf-8') === badBytes);
check('corrompu : la cible ne contient plus le contenu abîmé', !fs.existsSync(BAD) || fs.readFileSync(BAD, 'utf-8') !== badBytes);
check('corrompu : erreur loggée avec le fichier et la copie', logged.some((l) => l.includes(BAD) && l.includes(backups[0])));
check('nom de copie sans « : » (compatible Windows)', backups.length === 1 && !backups[0].includes(':'));

// ─────────────────────────────────────────────
// 2 bis. Chemins dangereux (fs simulé en panne)
// ─────────────────────────────────────────────

/** Remplace fs[name] le temps de fn (le module storage partage le même fs). */
function withStub(name, impl, fn) {
  const original = fs[name];
  fs[name] = (...args) => impl(original, ...args);
  try {
    return fn();
  } finally {
    fs[name] = original;
  }
}
const fsError = (code) => Object.assign(new Error(`${code}: simulé`), { code });

// (a) rename en échec → cible intacte, pas de .tmp
const SAFE = path.join(DATA, 'sur.json');
writeJsonAtomic(SAFE, { garde: true });
const safeBefore = fs.readFileSync(SAFE);
let threw = false;
withStub('renameSync', () => { throw fsError('EXDEV'); }, () => {
  try { writeJsonAtomic(SAFE, { garde: false }); } catch { threw = true; }
});
check('rename en échec : erreur remontée', threw);
check('rename en échec : cible intacte (octets identiques)', fs.readFileSync(SAFE).equals(safeBefore));
check('rename en échec : aucun .tmp restant', leftovers(DATA, 'sur.json', '.tmp-').length === 0);

// (b) EPERM deux fois puis succès (Windows)
let calls = 0;
withStub('renameSync', (orig, ...args) => {
  calls += 1;
  if (calls <= 2) throw fsError('EPERM');
  return orig(...args);
}, () => writeJsonAtomic(SAFE, { essai: 3 }));
check('EPERM ×2 puis succès : écriture faite', readJson(SAFE, null).essai === 3 && calls === 3);
check('EPERM ×2 puis succès : aucun .tmp restant', leftovers(DATA, 'sur.json', '.tmp-').length === 0);

// (c) lecture impossible (EACCES) → fichier laissé, défaut, écriture REFUSÉE
const LOCKED = path.join(DATA, 'verrou.json');
writeJsonAtomic(LOCKED, { users: { U1: 1, U2: 2 } });
const lockedBefore = fs.readFileSync(LOCKED);
const denied = captureErrors(() => withStub('readFileSync', (orig, file, ...rest) => {
  if (path.resolve(String(file)) === path.resolve(LOCKED)) throw fsError('EACCES');
  return orig(file, ...rest);
}, () => readJson(LOCKED, { users: {} })));
check('EACCES : valeur par défaut renvoyée', Object.keys(denied.result.users).length === 0);
check('EACCES : fichier laissé en place, sans copie', fs.existsSync(LOCKED) && leftovers(DATA, 'verrou.json', '.corrupt-').length === 0);
check('EACCES : erreur loggée', denied.logged.some((l) => l.includes(LOCKED) && l.includes('BLOQUÉE')));
let refused = null;
try { writeJsonAtomic(LOCKED, { users: {} }); } catch (e) { refused = e; }
check('EACCES : l\'écriture suivante est REFUSÉE', refused && /refus d'écrire/.test(refused.message));
check('EACCES : cible intacte', fs.readFileSync(LOCKED).equals(lockedBefore));
check('lecture réussie ensuite → contenu', readJson(LOCKED, null).users.U2 === 2);
writeJsonAtomic(LOCKED, { users: { U1: 1, U2: 2, U3: 3 } });
check('… et les écritures repartent', readJson(LOCKED, null).users.U3 === 3);

// (d) mise de côté par rename impossible → copie
const STUCK = path.join(DATA, 'coince.json');
fs.writeFileSync(STUCK, badBytes);
const copied = captureErrors(() => withStub('renameSync', () => { throw fsError('EPERM'); }, () => readJson(STUCK, { users: {} })));
const stuckBackups = leftovers(DATA, 'coince.json', '.corrupt-');
check('rename de côté impossible : copie *.corrupt-* créée', stuckBackups.length === 1);
check('… avec les octets d\'origine', stuckBackups.length === 1 && fs.readFileSync(path.join(DATA, stuckBackups[0]), 'utf-8') === badBytes);
check('… erreur loggée avec la copie', copied.logged.some((l) => l.includes(stuckBackups[0] || '§')));
writeJsonAtomic(STUCK, { users: {} });
check('… copie faite → écriture permise', readJson(STUCK, null) !== null);

// (d bis) ni rename ni copie possibles → écriture bloquée
const STUCK2 = path.join(DATA, 'coince2.json');
fs.writeFileSync(STUCK2, badBytes);
captureErrors(() => withStub('renameSync', () => { throw fsError('EPERM'); },
  () => withStub('copyFileSync', () => { throw fsError('ENOSPC'); }, () => readJson(STUCK2, {}))));
let refused2 = null;
try { writeJsonAtomic(STUCK2, {}); } catch (e) { refused2 = e; }
check('ni rename ni copie : écriture REFUSÉE, octets d\'origine gardés', refused2 && fs.readFileSync(STUCK2, 'utf-8') === badBytes);

// BOM UTF-8 de tête (fichier édité à la main sous Windows)
const BOM = path.join(DATA, 'bom.json');
fs.writeFileSync(BOM, '﻿{"ok":true}', 'utf-8');
check('BOM UTF-8 ignoré à la lecture', readJson(BOM, null)?.ok === true && leftovers(DATA, 'bom.json', '.corrupt-').length === 0);

// ─────────────────────────────────────────────
// 3. Bout en bout sur un vrai module : collections
// ─────────────────────────────────────────────
const COLLECTIONS_MODULE = path.join(TMP, 'src', 'collections.js');
const COLLECTIONS_FILE = path.join(DATA, 'collections.json');

function restart() {
  delete require.cache[require.resolve(COLLECTIONS_MODULE)];
  return require(COLLECTIONS_MODULE);
}

const card = (n) => ({ url: `https://exemple.test/carte-${n}.gif`, title: `Carte ${n}`, rarity: 'common', type: 'image' });

let collections = restart();
collections.addCards('U1', [card(1), card(2)]);
collections.addCards('U2', [card(3)]);
check('collections : U1 et U2 enregistrés', collections.getCount('U1', card(1).url) === 1 && collections.getCount('U2', card(3).url) === 1);
check('collections : aucun fichier temporaire restant', leftovers(DATA, 'collections.json', '.tmp-').length === 0);

// 💥 Coupure de courant en pleine écriture : fichier tronqué (fin manquante)
const full = fs.readFileSync(COLLECTIONS_FILE, 'utf-8');
fs.writeFileSync(COLLECTIONS_FILE, full.slice(0, full.length - 8));

collections = restart();
const run = captureErrors(() => collections.addCards('U3', [card(4)]));
const colBackups = leftovers(DATA, 'collections.json', '.corrupt-');
check('après corruption : une copie *.corrupt-* existe', colBackups.length === 1);
const backupText = colBackups.length ? fs.readFileSync(path.join(DATA, colBackups[0]), 'utf-8') : '';
check('la copie contient encore U1 et U2 (récupérable)', backupText.includes('"U1"') && backupText.includes('"U2"') && backupText.includes('carte-1') && backupText.includes('carte-3'));
check('la copie n\'a pas été écrasée par la sauvegarde de U3', !backupText.includes('"U3"'));
check('erreur bien visible loggée', run.logged.some((l) => l.includes('CORROMPU') && l.includes('collections.json')));
check('le jeu continue : U3 enregistré', collections.getCount('U3', card(4).url) === 1);
check('une seule copie, même après d\'autres écritures', (collections.addCards('U3', [card(5)]), leftovers(DATA, 'collections.json', '.corrupt-').length === 1));

try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }   // Windows : fichier ouvert = non supprimable
fs.rmSync(TMP, { recursive: true, force: true });

if (failures) {
  console.log(`\n❌ ${failures} échec(s)`);
  process.exit(1);
}
console.log('\n✅ Tous les tests passent');
