#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test du tuto de l'Arène (stockage « vu » par joueur)
//
//  • Un joueur neuf n'a pas vu le tuto ; une fois marqué, c'est
//    durable (fichier data/arena.json) et propre à chaque joueur.
//  • Le tuto couvre les 8 écrans prévus.
//
//  Usage : node scripts/test-arena-tutorial.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-arena-tuto-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const store = require(path.join(TMP, 'src', 'game', 'arenaStore.js'));
check('joueur neuf : tuto pas encore vu', store.hasSeenTutorial('U1') === false);
store.markTutorialSeen('U1');
check('marqué : tuto vu', store.hasSeenTutorial('U1') === true);
check('propre à chaque joueur', store.hasSeenTutorial('U2') === false);
const saved = JSON.parse(fs.readFileSync(path.join(TMP, 'data', 'arena.json'), 'utf-8'));
check('persisté dans data/arena.json', typeof saved.tutorial.U1 === 'string');
const first = saved.tutorial.U1;
store.markTutorialSeen('U1', Date.now() + 60000);
check('re-marquer garde la première date', JSON.parse(fs.readFileSync(path.join(TMP, 'data', 'arena.json'), 'utf-8')).tutorial.U1 === first);
check('les decks restent intacts', store.getDecks('U1').decks.length === store.DECK_SLOTS);

// Contenu : chargé comme dans la page (sans DOM : on ne lit que la liste des écrans)
const sandbox = {};
new Function('self', fs.readFileSync(path.join(ROOT, 'public', 'arena-tutorial.js'), 'utf-8'))(sandbox);
const titles = sandbox.ArenaTutorial.STEPS.map((s) => s.title);
check('8 écrans', titles.length === 8);
check('l’élixir et la carte grisée sont expliqués', titles.some((t) => /élixir/i.test(t)));
check('les enjeux (cartes perdues) sont expliqués', titles.some((t) => /risquer/i.test(t)));

console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
