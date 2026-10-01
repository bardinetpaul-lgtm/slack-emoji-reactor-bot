#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test des versions du jeu et de la release note (src/releases.js)
//
//  Travaille dans une COPIE temporaire du projet (aucune donnée réelle
//  touchée). Vérifie : format et ordre des versions, synchro avec
//  package.json, bouton « Nouveautés » de l'Accueil, modale sous les
//  limites Slack.
//
//  Usage : node scripts/test-releases.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-releases-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

const releases = require(path.join(TMP, 'src', 'releases'));
const home = require(path.join(TMP, 'src', 'home'));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

// 🏷️ Format des versions
const list = releases.RELEASES;
check('au moins une version', Array.isArray(list) && list.length > 0);
check('versions au format 2.1 ou 2.1.1', list.every((r) => /^\d+\.\d+(\.\d+)?$/.test(r.version)));
check('dates au format AAAA-MM-JJ', list.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && !Number.isNaN(Date.parse(r.date))));
check('chaque version a un titre et au moins un changement', list.every((r) => r.title && Array.isArray(r.changes) && r.changes.length > 0 && r.changes.every((c) => typeof c === 'string' && c.trim())));
check('aucun numéro de version en double', new Set(list.map((r) => r.version)).size === list.length);

// 📚 Ordre : de la plus récente à la plus ancienne
const sorted = list.every((r, i) => i === 0 || releases.compareVersions(list[i - 1].version, r.version) > 0);
check('versions triées de la plus récente à la plus ancienne', sorted);
check('dates décroissantes', list.every((r, i) => i === 0 || list[i - 1].date >= r.date));
check('compareVersions : 2.10 > 2.9 > 2.1.1 > 2.1', releases.compareVersions('2.10', '2.9') > 0 && releases.compareVersions('2.9', '2.1.1') > 0 && releases.compareVersions('2.1.1', '2.1') > 0 && releases.compareVersions('2.1', '2.1.0') === 0);

// 🔗 Version courante = première entrée = package.json
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
check('version courante = première entrée', releases.currentVersion() === list[0].version);
check(`package.json (${pkg.version}) aligné sur la version courante (${releases.currentVersion()})`, releases.compareVersions(pkg.version, releases.currentVersion()) === 0);
check('formatDate : 2026-10-01 → 01/10/2026', releases.formatDate('2026-10-01') === '01/10/2026');

// 🏠 Accueil : version + bouton « Nouveautés » pour tout le monde
const ctx = { attackPrice: 50, creditsPerJeanpipLabel: '0,5', targetEmoji: 'jeanpip', farmRemainingMs: 0, farmQuota: { used: 0, max: 10, nextFreeMs: 0 }, formatRemaining: String };
for (const isAdmin of [false, true]) {
  const json = JSON.stringify(home.buildHomeView('U1', { ...ctx, isAdmin }));
  const who = isAdmin ? 'admin' : 'joueur';
  check(`Accueil (${who}) : bouton « Nouveautés »`, json.includes('release_notes_open'));
  check(`Accueil (${who}) : version v${releases.currentVersion()} affichée`, json.includes(`v${releases.currentVersion()}`));
}

// 🪟 Modale : contenu + limites Slack (100 blocs, 3000 caractères par section, titre ≤ 24)
const modal = home.buildReleaseNotesModal();
const modalJson = JSON.stringify(modal);
check('modale : type modal, sans bouton de validation', modal.type === 'modal' && !modal.submit && modal.close);
check('modale : titre ≤ 24 caractères', modal.title.text.length <= 24);
check('modale : la version courante et son titre y figurent', modalJson.includes(`v${list[0].version}`) && modalJson.includes(JSON.stringify(list[0].title).slice(1, -1)));
check('modale : ≤ 100 blocs', modal.blocks.length <= 100);
check('modale : sections ≤ 3000 caractères', modal.blocks.every((b) => !b.text || b.text.text.length <= 3000));

// 🗜️ Beaucoup de versions, très longues : toujours sous les limites
const many = Array.from({ length: 80 }, (_, i) => ({
  version: `9.${80 - i}`, date: '2030-01-01', title: `Version ${i}`, changes: Array.from({ length: 40 }, () => 'x'.repeat(200)),
}));
const big = home.buildReleaseNotesModal(many);
check('80 versions : ≤ 100 blocs', big.blocks.length <= 100);
check('80 versions : sections ≤ 3000 caractères', big.blocks.every((b) => !b.text || b.text.text.length <= 3000));
check('80 versions : la plus récente est gardée', JSON.stringify(big).includes('v9.80'));
check('80 versions : mention des versions plus anciennes masquées', JSON.stringify(big).includes('plus ancienne'));

try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }   // Windows : fichier ouvert = non supprimable
fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)\n` : '\n🎉 Versions et release note OK\n');
process.exit(failures ? 1 : 0);
