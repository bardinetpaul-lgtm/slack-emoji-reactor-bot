#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test du compteur d'exemplaires de l'éditeur de deck (v2.3)
//  public/deck-editor.js → DeckEditor.copiesInfo(copies, inDeck, isCaptain)
//  « Mon deck » et préparation d'un combat : sur chaque carte de la
//  collection, combien d'exemplaires restent disponibles.
//
//  Usage : node scripts/test-deck-copies.js
// ═══════════════════════════════════════════════════════════
const path = require('path');
const { DeckEditor } = require(path.join(__dirname, '..', 'public', 'deck-editor.js'));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const none = DeckEditor.copiesInfo(3, 0, false);
check('aucune dans le deck : « ×3 » comme avant', none.free === 3 && none.label === '×3');
check('aucune dans le deck : info-bulle', none.title === '3 exemplaires possédés');

const one = DeckEditor.copiesInfo(3, 1, false);
check('1 dans le deck sur 3 : 2 restants', one.free === 2 && one.label === '2/3');
check('1 dans le deck sur 3 : info-bulle claire', one.title === '2 exemplaires encore disponibles sur 3');

const last = DeckEditor.copiesInfo(3, 2, false);
check('2 sur 3 : 1 restant, singulier', last.free === 1 && last.label === '1/3' && last.title === '1 exemplaire encore disponible sur 3');

const all = DeckEditor.copiesInfo(2, 2, false);
check('tous utilisés : 0 restant', all.free === 0 && all.label === '0/2' && all.title === 'Tous tes exemplaires (2) sont déjà dans le deck');

const cap = DeckEditor.copiesInfo(3, 1, true);
check('le Capitaine prend aussi un exemplaire', cap.free === 1 && cap.label === '1/3');

const capOnly = DeckEditor.copiesInfo(1, 0, true);
check('Capitaine seul sur 1 exemplaire : 0 restant', capOnly.free === 0 && capOnly.label === '0/1');

const single = DeckEditor.copiesInfo(1, 0, false);
check('1 seul exemplaire : singulier', single.label === '×1' && single.title === '1 exemplaire possédé');

console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
