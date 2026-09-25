#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test du rendu de terrain de l'Arène (public/arena-board.js)
//
//  Module partagé navigateur / Node : placement moteur → plan 360×640
//  (vue de chaque joueur, son camp en bas), trois arènes de la DA,
//  symboles des tours, rendu d'une scène complète.
//
//  Usage : node scripts/test-arena-board.js
// ═══════════════════════════════════════════════════════════
const path = require('path');

const board = require(path.join(__dirname, '..', 'public', 'arena-board.js'));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;

// 📐 Placement (plan de la DA : couloirs x = 60 / 180 / 300)
check('mes tours en bas (DA : y ≈ 500)', near(board.toBoard(0, 15, 'A').y, 504, 1) && near(board.toBoard(0, 15, 'A').x, 60));
check('mon QG = tour principale en bas (y = 592)', near(board.toBoard(1, 5, 'A').y, 592));
check('tours adverses en haut (y ≈ 146)', near(board.toBoard(2, 85, 'A').y, 146, 1));
check('QG adverse en haut (y = 56)', near(board.toBoard(1, 95, 'A').y, 56));
check('rivière au milieu (y = 320)', near(board.toBoard(1, 50, 'A').y, 320));
check('vue du joueur B : son camp en bas aussi', near(board.toBoard(0, 85, 'B').y, board.toBoard(0, 15, 'A').y));
check('vue du joueur B : couloirs en miroir', near(board.toBoard(0, 50, 'B').x, 300) && near(board.toBoard(2, 50, 'B').x, 60));
check('ordre monotone : plus on avance, plus on monte', board.toBoard(1, 30, 'A').y > board.toBoard(1, 60, 'A').y);

// 🏞️ Arènes de la DA
check('trois arènes', JSON.stringify(Object.keys(board.ARENAS)) === JSON.stringify(['jardin', 'port', 'serveurs']));
for (const key of Object.keys(board.ARENAS)) {
  const g = board.groundPaths(key);
  const bad = g.filter((p) => /NaN|undefined/.test(p.d));
  check(`${board.ARENAS[key].name} : décor valide (${g.length} tracés)`, g.length > 20 && bad.length === 0);
}
check('arène inconnue → le jardin', board.groundPaths('nope').length === board.groundPaths('jardin').length);
check('symboles des tours (couloir, principale, ruine)', ['t-lane', 't-king', 't-ruine'].every((id) => board.TOWER_SYMBOLS.includes(`id="${id}"`)));

// 🖼️ Scène complète à partir d'un état public du moteur
const view = {
  you: 'A',
  remainingMs: 72000,
  buildings: [
    { id: 1, side: 'A', kind: 'tower', lane: 0, y: 15, hp: 600, maxHp: 600, alive: true },
    { id: 2, side: 'B', kind: 'tower', lane: 0, y: 85, hp: 200, maxHp: 600, alive: true },
    { id: 3, side: 'B', kind: 'tower', lane: 2, y: 85, hp: 0, maxHp: 600, alive: false },
    { id: 4, side: 'B', kind: 'qg', lane: null, y: 95, hp: 2000, maxHp: 2000, alive: true },
    { id: 5, side: 'A', kind: 'pompe', lane: 1, y: 18, hp: 500, maxHp: 500, alive: true, url: 'p' },
  ],
  units: [
    { id: 10, side: 'A', lane: 1, y: 40, hp: 300, maxHp: 500, archetype: 'guerrier', url: 'g' },
    { id: 11, side: 'B', lane: 1, y: 60, hp: 230, maxHp: 230, archetype: 'essaim', url: 'e' },
    { id: 12, side: 'B', lane: 1, y: 61, hp: 230, maxHp: 230, archetype: 'essaim', url: 'e' },
    { id: 13, side: 'B', lane: 1, y: 62, hp: 230, maxHp: 230, archetype: 'essaim', url: 'e' },
  ],
  pending: [{ side: 'B', url: 'g2', lane: 0, archetype: 'tireur' }],
};
const sprites = { g: 's1', e: 's2', p: 's3', g2: 's4' };
const svg = board.renderScene(view, { arena: 'port', sprites });
check('scène : SVG au format du plan 360×640', svg.startsWith('<svg') && svg.includes('viewBox="0 0 360 640"'));
check('scène : tour détruite en ruine', svg.includes('#t-ruine'));
check('scène : tour principale', svg.includes('#t-king'));
check('scène : mes unités en bleu, les adverses en orange', svg.includes('#s1') && svg.includes('#1C72F1') && svg.includes('#FF6229'));
check('scène : essaim = 3 unités du moteur, 3 personnages', (svg.match(/href="#s2"/g) || []).length === 3);
check('scène : Pompe dessinée avec son personnage', svg.includes('href="#s3"'));
check('scène : pose en cours d\'apparition visible', svg.includes('stroke-dasharray="3 5"'));
check('scène : barre de vie de la tour abîmée', svg.includes('#FF6229') && svg.includes('#2F3733'));
check('scène : aucune valeur cassée', !/NaN|undefined/.test(svg));

// 👆 Menu de pose : point touché → couloir (DA « Combat - Menu de pose »)
const noBreach = { you: 'A', buildings: [0, 1, 2].map((lane) => ({ side: 'B', kind: 'tower', lane, alive: true })) };
check('pose : moitié basse, couloir gauche', JSON.stringify(board.pointToDeploy(50, 500, noBreach)) === JSON.stringify({ ok: true, lane: 0, forward: false }));
check('pose : couloir le plus proche du point', board.pointToDeploy(200, 400, noBreach).lane === 1 && board.pointToDeploy(340, 620, noBreach).lane === 2);
check('refus : rivière', board.pointToDeploy(180, 320, noBreach).reason === 'zone');
check('refus : moitié adverse sans brèche', board.pointToDeploy(60, 240, noBreach).reason === 'zone');
const breach = { you: 'A', buildings: [{ side: 'B', kind: 'tower', lane: 0, alive: false }, { side: 'B', kind: 'tower', lane: 1, alive: true }, { side: 'B', kind: 'tower', lane: 2, alive: true }] };
check('brèche : pose avancée dans le couloir ouvert', JSON.stringify(board.pointToDeploy(60, 240, breach)) === JSON.stringify({ ok: true, lane: 0, forward: true }));
check('brèche : pas ailleurs', board.pointToDeploy(300, 240, breach).reason === 'zone');
const breachB = { you: 'B', buildings: [{ side: 'A', kind: 'tower', lane: 0, alive: false }, { side: 'A', kind: 'tower', lane: 1, alive: true }, { side: 'A', kind: 'tower', lane: 2, alive: true }] };
check('joueur B : couloirs en miroir pour la pose', board.pointToDeploy(300, 500, breachB).lane === 0 && board.pointToDeploy(300, 240, breachB).forward === true);
const zones = board.renderZones(breach);
check('zones : moitié + brèche en pointillé bleu', (zones.match(/<path/g) || []).length === 2 && zones.includes('#1C72F1') && zones.includes('6 5'));
check('zones : sans brèche, seulement ma moitié', (board.renderZones(noBreach).match(/<path/g) || []).length === 1);

console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
