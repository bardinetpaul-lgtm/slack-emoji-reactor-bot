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
