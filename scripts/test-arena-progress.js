#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test de la progression des arènes + des 3 decks par joueur
//     (src/game/arenas.js, arenaStore, matchmaking, matches)
//
//  • 1er combat au jardin, puis déblocage selon les victoires ;
//  • le challenger choisit une arène QU'IL a débloquée, quel que
//    soit le niveau de l'adversaire ;
//  • combat rapide : la meilleure arène du 1er arrivé dans la file ;
//  • 3 decks enregistrés, un actif ; « Prêt » annulable.
//  Travaille dans une COPIE temporaire du projet.
//
//  Usage : node scripts/test-arena-progress.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-arena-progress-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

const origLog = console.log;
console.log = () => {};
const arenas = require(path.join(TMP, 'src', 'game', 'arenas.js'));
const arenaStore = require(path.join(TMP, 'src', 'game', 'arenaStore.js'));
const mm = require(path.join(TMP, 'src', 'game', 'matchmaking.js'));
const matches = require(path.join(TMP, 'src', 'game', 'matches.js'));
const collections = require(path.join(TMP, 'src', 'collections.js'));
console.log = origLog;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

// 🏟️ Niveaux
check('3 arènes dans l\'ordre du jardin à la salle serveur', arenas.ARENAS.map((a) => a.key).join() === 'jardin,port,serveurs');
check('1er combat : le jardin (niveau 1)', arenas.levelOf(0).key === 'jardin' && arenas.levelOf(0).level === 1);
check('10 victoires : le port (niveau 2)', arenas.levelOf(9).key === 'jardin' && arenas.levelOf(10).key === 'port');
check('25 victoires : la salle serveur (niveau 3)', arenas.levelOf(24).key === 'port' && arenas.levelOf(25).key === 'serveurs');
check('arènes débloquées', arenas.unlocked(12).join() === 'jardin,port');
check('peut jouer une arène débloquée', arenas.canPlay(12, 'port') && arenas.canPlay(12, 'jardin') && !arenas.canPlay(12, 'serveurs'));
check('prochain palier', arenas.nextUnlock(3).key === 'port' && arenas.nextUnlock(3).winsLeft === 7 && arenas.nextUnlock(30) === null);

// 🎯 Défi : l'arène est choisie par le challenger, dans SES arènes
const wins = { UA: 12, UB: 0, UC: 30, UD: 0 };
mm.reset();
mm.configure({ isBusy: () => false, cardCount: () => 10, winsOf: (u) => wins[u] || 0 });
const T0 = 1_000_000;
const c1 = mm.createChallenge('UA', 'UB', T0, { arena: 'port' });
check('niveau 2 contre niveau 1 : le port est autorisé', c1.ok && c1.arena === 'port');
mm.reset();
check('refus : arène pas débloquée par le challenger', mm.createChallenge('UB', 'UA', T0, { arena: 'port' }).reason === 'arena_locked');
const c2 = mm.createChallenge('UC', 'UD', T0);
check('sans choix : la meilleure arène du challenger', c2.ok && c2.arena === 'serveurs');
check('l\'arène suit le défi jusqu\'à l\'acceptation', mm.acceptChallenge(c2.id, 'UD', T0 + 1).arena === 'serveurs');

// ⚡ File rapide : meilleure arène du 1er arrivé
mm.reset();
mm.joinQueue('UA', T0);
const q = mm.joinQueue('UB', T0 + 1);
check('combat rapide : arène du 1er arrivé dans la file', q.matched === 'UA' && q.arena === 'port');

// 🃏 3 decks enregistrés
const d0 = arenaStore.getDecks('UZ');
check('3 decks par défaut, vides, le 1er actif', d0.decks.length === 3 && d0.active === 0 && d0.decks.every((d) => d.cards.length === 0) && d0.decks[0].name === 'Deck 1');
arenaStore.setDecks('UZ', { active: 1, decks: [{ name: 'Rush', cards: ['a', 'b'] }, { name: 'Contrôle', cards: ['c', 'c', 'd'] }, { name: '', cards: [] }] });
const d1 = arenaStore.getDecks('UZ');
check('decks enregistrés (nom, cartes, deck actif)', d1.active === 1 && d1.decks[0].name === 'Rush' && d1.decks[1].name === 'Contrôle');
check('doublons conservés (une carte peut occuper plusieurs emplacements)', d1.decks[1].cards.join() === 'c,c,d');
check('nom vide → nom par défaut', d1.decks[2].name === 'Deck 3');
check('getDeck = le deck actif', arenaStore.getDeck('UZ').join() === 'c,c,d');
arenaStore.setDecks('UZ', { active: 9, decks: [{ name: 'x'.repeat(80), cards: Array.from({ length: 12 }, (_, i) => `k${i}`) }] });
const d2 = arenaStore.getDecks('UZ');
check('garde-fous : 8 cartes max, nom court, index valide, toujours 3 decks', d2.decks[0].cards.length === 8 && d2.decks[0].name.length <= 24 && d2.active === 0 && d2.decks.length === 3);
fs.writeFileSync(path.join(TMP, 'data', 'arena.json'), JSON.stringify({ decks: { UOLD: ['a', 'b', 'c'] } }));
arenaStore.setDecks('UCAP', { active: 0, decks: [{ name: 'C', cards: ['a', 'b'], captain: 'b' }, { cards: ['x'], captain: 'zz' }, {}] });
check('Capitaine enregistré avec le deck', arenaStore.getCaptain('UCAP') === 'b');
check('Capitaine hors du deck gardé (9e carte, possession vérifiée au combat)', arenaStore.getDecks('UCAP').decks[1].captain === 'zz');
const old = arenaStore.getDecks('UOLD');
check('ancien format (un seul deck) repris en Deck 1', old.decks[0].cards.join() === 'a,b,c' && old.active === 0);

// 🏟️ Combat : arène transmise, « Prêt » annulable
const give = (u, p) => collections.addCards(u, Array.from({ length: 10 }, (_, i) => ({ url: `${p}${i}`, title: `${p}${i}`, rarity: 'common', type: 'image' })));
give('P1', 'x');
give('P2', 'y');
const m = matches.createMatchFor('P1', 'P2', T0, { arena: 'port' });
check('le combat garde son arène', m.ok && matches.getMatch(m.id).arena === 'port');
const v = matches.view(matches.getMatch(m.id), 'P1');
check('préparation : l\'arène et les decks du joueur sont dans la vue', v.arena === 'port' && Array.isArray(v.decks) && v.decks.length === 3);
matches.setReady(m.id, 'P1');
check('prêt', matches.getMatch(m.id).players.A.ready === true);
matches.setReady(m.id, 'P1', false);
check('« Prêt · annuler »', matches.getMatch(m.id).players.A.ready === false);
const cap = matches.setDeck(m.id, 'P1', ['x0', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7'], 'x9');
check('« Prêt » avec Capitaine (9e carte, hors deck) : accepté et gardé', cap.ok && matches.getMatch(m.id).players.A.captain === 'x9' && arenaStore.getCaptain('P1') === 'x9');
matches.setDeck(m.id, 'P1', ['x0', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7'], 'x3');
check('Capitaine déjà dans le deck sans exemplaire en plus : refusé', matches.getMatch(m.id).players.A.captain === null);
const m2 = matches.createMatchFor('P1', 'P2', T0, {});
check('sans arène précisée : le jardin', !m2.ok || matches.getMatch(m2.id).arena === 'jardin');

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
