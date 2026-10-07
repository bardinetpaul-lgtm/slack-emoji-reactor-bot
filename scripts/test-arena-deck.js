#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test des decks de l'Arène (src/game/deck.js)
//
//  Deck = 8 emplacements ; une carte y figure au plus autant de fois
//  qu'on en possède d'exemplaires ; deck auto équilibré ;
//  complétion quand une carte a disparu de la collection.
//
//  Usage : node scripts/test-arena-deck.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-arena-deck-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.mkdirSync(path.join(TMP, 'data'));

const ARCHS = ['tank', 'guerrier', 'tireur', 'essaim', 'sort', 'vigie'];
const overrides = {};
for (const a of ARCHS) for (let i = 1; i <= 5; i += 1) overrides[`${a}${i}`] = { archetype: a };
fs.writeFileSync(path.join(TMP, 'data', 'card-overrides.json'), JSON.stringify(overrides));

const deck = require(path.join(TMP, 'src', 'game', 'deck.js'));
const { getCardStats } = require(path.join(TMP, 'src', 'game', 'cards.js'));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const c = (url, count = 1, rarity = 'common') => ({ url, title: url, rarity, count });

// Collection : 3 cartes de chaque archétype, une légendaire unique, une légendaire en double
const collection = [];
for (const a of ARCHS) for (let i = 1; i <= 3; i += 1) collection.push(c(`${a}${i}`));
collection.find((x) => x.url === 'guerrier1').rarity = 'legendary';               // unique → à protéger
Object.assign(collection.find((x) => x.url === 'tireur1'), { rarity: 'legendary', count: 2 }); // doublée → OK

check('deck de 8 emplacements', deck.DECK_SIZE === 8);
check('totalCopies : somme des exemplaires', deck.totalCopies([c('a', 3), c('b', 0), c('c', 2)]) === 5);
check('distinctCount', deck.distinctCount(collection) === 18);
check('distinctCount ignore les cartes à 0', deck.distinctCount([c('a', 0), c('b', 1)]) === 1);

// ✔️ Validation
const valid = ['tank1', 'guerrier2', 'guerrier3', 'tireur2', 'tireur3', 'essaim1', 'sort1', 'vigie1'];
check('deck valide', deck.validateDeck(collection, valid).ok);
check('refus : taille', deck.validateDeck(collection, valid.slice(0, 7)).reason === 'size');
check('refus : plus d’emplacements que d’exemplaires', deck.validateDeck(collection, [...valid.slice(0, 7), 'tank1']).reason === 'copies');
check('×2 possédée → 2 emplacements autorisés', deck.validateDeck(collection, [...valid.slice(0, 7), 'tireur1', 'tireur1'].slice(1)).ok);
check('×2 possédée → pas 3', deck.validateDeck(collection, ['tireur1', 'tireur1', 'tireur1', ...valid.slice(0, 5)]).reason === 'copies');
check('refus : carte non possédée', deck.validateDeck(collection, [...valid.slice(0, 7), 'tank5']).reason === 'not_owned');

// 🤖 Deck auto
const auto = deck.buildAutoDeck(collection);
check('deck auto : 8 cartes valides', deck.validateDeck(collection, auto).ok);
const archs = auto.map((u) => getCardStats(collection.find((x) => x.url === u)).archetype);
check('deck auto : au moins 4 archétypes différents', new Set(archs).size >= 4);
check('deck auto : légendaire unique laissée de côté', !auto.includes('guerrier1'));
check('deck auto : légendaire en double acceptée', auto.includes('tireur1'));
check('deck auto : déterministe', JSON.stringify(deck.buildAutoDeck(collection)) === JSON.stringify(auto));

// Petite collection (8 cartes pile, dont une légendaire unique) → on la prend quand même
const small = ['tank1', 'guerrier1', 'guerrier2', 'tireur1', 'tireur2', 'essaim1', 'sort1', 'vigie1'].map((u) => c(u));
small[1].rarity = 'legendary';
check('deck auto : petite collection → les 8 cartes', deck.validateDeck(small, deck.buildAutoDeck(small)).ok);
check('deck auto : moins de 8 cartes → null', deck.buildAutoDeck(small.slice(0, 7)) === null);

// 🧩 Résolution d'un deck sauvegardé
const r1 = deck.resolveDeck(valid, collection);
check('deck sauvegardé intact', JSON.stringify(r1.urls) === JSON.stringify(valid) && r1.replaced.length === 0);
const shrunk = collection.filter((x) => x.url !== 'sort1');
const r2 = deck.resolveDeck(valid, shrunk);
check('carte disparue : deck complété à 8', deck.validateDeck(shrunk, r2.urls).ok);
check('carte disparue : signalée', r2.replaced.length === 1 && r2.replaced[0] === 'sort1');
check('carte disparue : les 7 autres gardées', valid.filter((u) => u !== 'sort1').every((u) => r2.urls.includes(u)));
const r3 = deck.resolveDeck(null, collection);
check('pas de deck sauvegardé → deck auto', JSON.stringify(r3.urls) === JSON.stringify(auto));
check('collection trop petite → null', deck.resolveDeck(valid, small.slice(0, 7)) === null);

// 👥 Peu de cartes différentes mais des doublons : on joue quand même
const dupes = ['tank1', 'guerrier1', 'tireur1', 'essaim1', 'sort1'].map((u) => c(u, 2));
const autoDupes = deck.buildAutoDeck(dupes);
check('5 cartes ×2 → deck auto de 8 avec des doublons', autoDupes && autoDupes.length === 8 && deck.validateDeck(dupes, autoDupes).ok);
check('deck auto : d’abord des cartes différentes', new Set(autoDupes.slice(0, 5)).size === 5);
const kept = deck.resolveDeck(['tank1', 'tank1', 'tank1', 'sort1'], dupes);
check('deck sauvegardé : le 3e tank1 (non possédé) est remplacé', kept.urls.filter((u) => u === 'tank1').length === 2 && kept.replaced.join() === 'tank1' && deck.validateDeck(dupes, kept.urls).ok);

try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }   // Windows : fichier ouvert = non supprimable
fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
