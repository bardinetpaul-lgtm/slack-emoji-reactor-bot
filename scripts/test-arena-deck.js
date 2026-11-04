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

// v3.9 : faux module d'échanges (cartes réservées pilotées par le test)
const reservedByUser = {};
const tradesPath = path.join(TMP, 'src', 'trades.js');
if (!fs.existsSync(tradesPath)) fs.writeFileSync(tradesPath, '');   // le vrai module est remplacé par le faux ci-dessous
require.cache[tradesPath] = { id: tradesPath, filename: tradesPath, loaded: true, exports: { reservedCounts: (u) => new Map(Object.entries(reservedByUser[u] || {})) } };

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

// 🔒 v3.9 : une carte réservée par un échange / une enchère ne peut pas entrer dans un deck
{
  const collections = require(path.join(TMP, 'src', 'collections.js'));
  const matches = require(path.join(TMP, 'src', 'game', 'matches.js'));
  const base = ['tank1', 'guerrier2', 'guerrier3', 'tireur2', 'tireur3', 'essaim1', 'sort1'];
  collections.addCards('UR', [...base, 'vigie1', 'vigie1'].map((u) => ({ url: u, title: u, rarity: 'common' })));
  collections.addCards('UO', ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'].map((u) => ({ url: u, title: u, rarity: 'common' })));
  const twice = [...base, 'vigie1', 'vigie1'].slice(1);   // vigie1 ×2 + 6 autres = 8
  const m = matches.createMatchFor('UR', 'UO', Date.now());
  check('sans réservation : vigie1 ×2 acceptée', m.id && matches.setDeck(m.id, 'UR', twice).ok);
  reservedByUser.UR = { vigie1: 1 };
  const avail = collections.getAvailableCollection('UR');
  check('1 des 2 vigie1 réservée : la collection disponible n’en montre qu’1', avail.find((x) => x.url === 'vigie1').count === 1);
  check('enregistrer un deck avec vigie1 ×2 est refusé (copies)', matches.setDeck(m.id, 'UR', twice).reason === 'copies');
  check('vigie1 ×1 reste acceptée', matches.setDeck(m.id, 'UR', [...base, 'vigie1']).ok);
  reservedByUser.UR = { vigie1: 2 };
  check('toutes les copies réservées : la carte disparaît de la collection disponible', !collections.getAvailableCollection('UR').some((x) => x.url === 'vigie1'));
  check('toutes réservées : deck avec cette carte refusé (not_owned)', matches.setDeck(m.id, 'UR', [...base, 'vigie1']).reason === 'not_owned');
  check('la collection réelle est inchangée', collections.getCollection('UR').find((x) => x.url === 'vigie1').count === 2);
}

// 🔒 v3.9 : la construction du deck (création du combat, deck auto) ignore aussi les cartes réservées
{
  const collections = require(path.join(TMP, 'src', 'collections.js'));
  const matches = require(path.join(TMP, 'src', 'game', 'matches.js'));
  const arenaStore = require(path.join(TMP, 'src', 'game', 'arenaStore.js'));
  const mk = (u) => ({ url: u, title: u, rarity: 'common' });
  const nine = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9'];
  collections.addCards('UP', nine.map(mk));
  collections.addCards('UQ', nine.map(mk));
  arenaStore.setDeck('UP', nine.slice(0, 8));   // deck enregistré : b1…b8
  reservedByUser.UP = { b1: 1 };                // b1 réservée par un échange
  const created = matches.createMatchFor('UP', 'UQ', Date.now());
  const urlsP = created.match.players.A.deckUrls;
  check('deck enregistré avec une carte réservée : créé sans elle, complété à 8', urlsP.length === 8 && !urlsP.includes('b1') && urlsP.includes('b9'));
  const autoAvail = deck.buildAutoDeck(collections.getAvailableCollection('UP'));
  check('deck auto : une carte réservée n’est jamais choisie', autoAvail.length === 8 && !autoAvail.includes('b1'));
  delete reservedByUser.UP;
}

try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }   // Windows : fichier ouvert = non supprimable
fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
