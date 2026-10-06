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
const COL = [17, 50, 83];   // x du moteur des trois tours

// 📐 Placement (plan de la DA : tours en x = 60 / 180 / 300)
check('mes tours en bas (DA : y ≈ 500)', near(board.toBoard(COL[0], 15, 'A').y, 504, 1) && near(board.toBoard(COL[0], 15, 'A').x, 60));
check('mon QG = tour principale en bas (y = 592)', near(board.toBoard(COL[1], 5, 'A').y, 592));
check('tours adverses en haut (y ≈ 146)', near(board.toBoard(COL[2], 85, 'A').y, 146, 1));
check('QG adverse en haut (y = 56)', near(board.toBoard(COL[1], 95, 'A').y, 56));
check('rivière au milieu (y = 320)', near(board.toBoard(COL[1], 50, 'A').y, 320));
check('vue du joueur B : son camp en bas aussi', near(board.toBoard(COL[0], 85, 'B').y, board.toBoard(COL[0], 15, 'A').y));
check('vue du joueur B : terrain en miroir', near(board.toBoard(COL[0], 50, 'B').x, 300) && near(board.toBoard(COL[2], 50, 'B').x, 60));
check('ordre monotone : plus on avance, plus on monte', board.toBoard(COL[1], 30, 'A').y > board.toBoard(COL[1], 60, 'A').y);

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
    { id: 1, side: 'A', kind: 'tower', lane: 0, x: 17, y: 15, hp: 600, maxHp: 600, alive: true },
    { id: 2, side: 'B', kind: 'tower', lane: 0, x: 17, y: 85, hp: 200, maxHp: 600, alive: true },
    { id: 3, side: 'B', kind: 'tower', lane: 2, x: 83, y: 85, hp: 0, maxHp: 600, alive: false },
    { id: 4, side: 'B', kind: 'qg', lane: null, x: 50, y: 95, hp: 2000, maxHp: 2000, alive: true },
    { id: 5, side: 'A', kind: 'pompe', lane: 1, x: 50, y: 18, hp: 500, maxHp: 500, alive: true, url: 'p' },
  ],
  units: [
    { id: 10, side: 'A', lane: 1, x: 50, y: 40, hp: 100, maxHp: 170, archetype: 'guerrier', url: 'g', slot: 0, packSize: 3 },
    { id: 11, side: 'B', lane: 1, x: 50, y: 60, hp: 105, maxHp: 105, archetype: 'essaim', url: 'e', slot: 0, packSize: 6 },
    { id: 12, side: 'B', lane: 1, x: 50, y: 61, hp: 105, maxHp: 105, archetype: 'essaim', url: 'e', slot: 1, packSize: 6 },
    { id: 13, side: 'B', lane: 1, x: 50, y: 62, hp: 105, maxHp: 105, archetype: 'essaim', url: 'e', slot: 2, packSize: 6 },
  ],
  pending: [{ side: 'B', url: 'g2', lane: 0, x: 17, y: 80, archetype: 'tireur' }],
};
const sprites = { g: 's1', e: 's2', p: 's3', g2: 's4' };
const svg = board.renderScene(view, { arena: 'port', sprites });
check('scène : SVG au format du plan 360×640', svg.startsWith('<svg') && svg.includes('viewBox="0 0 360 640"'));
check('scène : tour détruite en ruine', svg.includes('#t-ruine'));
check('scène : tour principale', svg.includes('#t-king'));
check('scène : mes unités en bleu, les adverses en orange', svg.includes('#s1') && svg.includes('#1C72F1') && svg.includes('#FF6229'));
check('scène : chaque personnage du groupe est dessiné', (svg.match(/href="#s2"/g) || []).length === 3);
check('scène : Pompe dessinée avec son personnage', svg.includes('href="#s3"'));
check('scène : pose en cours d\'apparition visible', svg.includes('stroke-dasharray="3 5"'));
check('scène : barre de vie de la tour abîmée', svg.includes('#FF6229') && svg.includes('#2F3733'));
check('scène : aucune valeur cassée', !/NaN|undefined/.test(svg));

// 🚶 Marche et formations
const walker = { id: 20, side: 'A', lane: 0, x: 17, y: 30, hp: 170, maxHp: 170, archetype: 'guerrier', url: 'w', slot: 1, packSize: 3, moving: true };
const wv = { you: 'A', buildings: [], units: [walker] };
const wsprites = { w: { id: 'w1', walk: 'step' } };
const f1 = board.renderDynamic(wv, { sprites: wsprites, time: 0 });
const f2 = board.renderDynamic(wv, { sprites: wsprites, time: 180 });
check('marche : calques dos + jambes + avant', f1.includes('#w1-b') && f1.includes('#w1-f'));
check('marche : l\'image change au fil du temps', f1 !== f2);
check('marche : sol fixe sous le personnage', f1.includes('M-20 2A20 7'));
const legsOf = (svg) => svg.split('#w1-b')[1].split('#w1-f')[0];
const still = { ...wv, units: [{ ...walker, moving: false }] };
check('à l\'arrêt : les jambes ne bougent pas', legsOf(board.renderDynamic(still, { sprites: wsprites, time: 0 })) === legsOf(board.renderDynamic(still, { sprites: wsprites, time: 180 })));
const pos = (slot) => board.renderDynamic({ ...wv, units: [{ ...walker, slot }] }, { sprites: wsprites }).match(/translate\(([\d.-]+) ([\d.-]+)\) scale/).slice(1).join();
check('formation : chaque membre du groupe a sa place', new Set([0, 1, 2].map(pos)).size === 3);
const tank = board.renderDynamic({ ...wv, units: [{ ...walker, archetype: 'tank', url: 't', packSize: 2 }] }, { sprites: { t: { id: 't1', walk: 'sway' } }, time: 100 });
check('Tank : balancement sans jambes animées', tank.includes('#t1-f') && !tank.includes('#t1-b'));

// 🛡 Char qui roule · 🐝 essaim qui vole · ⚔️ frappe · 🏹 flèches
const tk = { ...walker, archetype: 'tank', url: 'k', packSize: 2, slot: 0 };
const roll = (u, time) => board.renderDynamic({ ...wv, units: [u] }, { sprites: { k: { id: 'k1', walk: 'roll' } }, time });
check('Tank : chenilles et roues dessinées', roll(tk, 0).includes('stroke-dasharray="3 5"') && (roll(tk, 0).match(/rotate\(/g) || []).length >= 4);
check('Tank : les chenilles défilent en roulant', roll(tk, 0) !== roll(tk, 130));
check('Tank : immobile, rien ne roule', roll({ ...tk, moving: false }, 0) === roll({ ...tk, moving: false }, 130));
const fl = { ...walker, archetype: 'essaim', url: 'b', packSize: 6, slot: 0 };
const fly = (time) => board.renderDynamic({ ...wv, units: [fl] }, { sprites: { b: { id: 'b1', walk: 'fly' } }, time });
check('Essaim : ailes à part + ombre au sol', fly(0).includes('#b1-w') && fly(0).includes('#b1-f') && fly(0).includes('opacity="0.55"'));
check('Essaim : les ailes battent', fly(0).match(/scale\(1 ([\d.]+)\)/)[1] !== fly(40).match(/scale\(1 ([\d.]+)\)/)[1]);
const fighter = (u) => board.renderDynamic({ ...wv, units: [u] }, { sprites: { w: { id: 'w1', walk: 'step' } }, time: 90 });
check('Guerrier : l\'arme frappe au contact (pivot de la main)', /rotate\([-\d.]+ 16 -22\)/.test(fighter({ ...walker, atk: 34 })));
check('Guerrier : sans cible, l\'arme ne bouge pas', !/rotate\([-\d.]+ 16 -22\)/.test(fighter({ ...walker, atk: null })));
const shots = board.renderDynamic({ you: 'A', units: [], buildings: [] }, { fx: [
  { type: 'arrow', x0: 10, y0: 10, x1: 100, y1: 10, dur: 260, age: 130, color: '#1C72F1' },
  { type: 'shell', x0: 10, y0: 10, x1: 100, y1: 10, dur: 200, age: 50 },
  { type: 'hit', x: 50, y: 50, age: 60 },
] });
check('effets : flèche, obus et impact dessinés', shots.includes('data-fx="arrow"') && shots.includes('data-fx="hit"') && !/NaN|undefined/.test(shots));

// ⏱ Le moteur d'animation tire une flèche quand un Tireur attaque
{
  let tickCb = null;
  global.requestAnimationFrame = (cb) => { tickCb = cb; return 1; };
  global.cancelAnimationFrame = () => {};
  global.performance = global.performance || { now: () => Date.now() };
  const live = { innerHTML: '' };
  const svgEl = { setAttribute() {}, innerHTML: '', querySelector: (q) => (q === '[data-live]' ? live : { innerHTML: '' }) };
  const r = board.createRenderer(svgEl, { arena: 'jardin', symbols: '', sprites: { a: { id: 'a1', walk: 'step' } } });
  const archer = { id: 7, side: 'A', lane: 1, x: 50, y: 40, hp: 115, maxHp: 115, archetype: 'tireur', url: 'a', slot: 0, packSize: 3, atk: 52 };
  r.push({ you: 'A', status: 'running', units: [archer], buildings: [], events: [] });
  tickCb(performance.now() + 50);
  check('animation : un Tireur qui attaque décoche une flèche', live.innerHTML.includes('data-fx="arrow"'));
  r.stop();
}

// 👆 Menu de pose : point touché → point du moteur (pose libre)
const towers = (side, dead = []) => [0, 1, 2].map((lane) => ({ side, kind: 'tower', lane, x: COL[lane], y: side === 'B' ? 85 : 15, alive: !dead.includes(lane) }));
const noBreach = { you: 'A', buildings: towers('B') };
const p1 = board.pointToDeploy(50, 500, noBreach);
check('pose : ma moitié, au point touché (x absolu, profondeur)', p1.ok && Math.abs(board.planX(p1.x) - 50) < 1 && Math.abs(p1.depth - board.unmapY(500)) < 0.2 && !p1.forward);
check('pose : n’importe où en largeur (entre les tours aussi)', board.pointToDeploy(120, 450, noBreach).ok && board.pointToDeploy(240, 450, noBreach).ok);
check('refus : rivière', board.pointToDeploy(180, 320, noBreach).reason === 'zone');
check('refus : bord du terrain', board.pointToDeploy(2, 500, noBreach).reason === 'zone');
check('refus : moitié adverse sans brèche', board.pointToDeploy(60, 200, noBreach).reason === 'no_breach');
const breach = { you: 'A', buildings: towers('B', [0]) };
check('brèche : pose autour de la tour tombée', board.pointToDeploy(60, 170, breach).ok && board.pointToDeploy(60, 170, breach).forward);
check('brèche : pas loin d’elle', board.pointToDeploy(300, 170, breach).reason === 'no_breach');
const breachB = { you: 'B', buildings: towers('A', [0]) };
const pb = board.pointToDeploy(300, 170, breachB);
check('joueur B : terrain en miroir (x absolu) pour la pose', pb.ok && Math.abs(pb.x - 17) < 3 && board.pointToDeploy(60, 500, breachB).x > 80);
const zones = board.renderZones(breach);
check('zones : moitié + brèche en pointillé bleu', (zones.match(/<path/g) || []).length === 2 && zones.includes('#1C72F1') && zones.includes('6 5'));
check('zones : sans brèche, seulement ma moitié', (board.renderZones(noBreach).match(/<path/g) || []).length === 1);
// 💥 Sort : on vise le corps d'un ennemi → le Sort colle à son groupe
const foeAt = { you: 'A', buildings: towers('B'), units: [{ id: 5, side: 'B', x: 40, y: 62, archetype: 'guerrier' }] };
const body = board.toBoard(40, 62, 'A');
const aim = board.pointToDeploy(body.x + 6, body.y - 18, foeAt, { spell: true });
check('Sort : visé sur le corps → centré sur le groupe ennemi', aim.ok && Math.abs(aim.x - 40) < 0.01 && Math.abs(aim.depth - 62) < 0.01);
check('Sort : loin de tout ennemi → au point touché', Math.abs(board.pointToDeploy(300, 150, foeAt, { spell: true }).x - board.engineX(300)) < 0.2);

// 🎖 Pouvoir : point touché · 🏳 Rappel : groupe touché
const pw = board.pointToPower(60, 500, { you: 'A' });
check('pouvoir : point du moteur touché (vue A)', Math.abs(pw.x - 17) < 0.5 && Math.abs(pw.depth - board.unmapY(500)) < 0.2);
check('pouvoir : en miroir (vue B)', Math.abs(board.pointToPower(60, 500, { you: 'B' }).x - 83) < 0.5);
const rv = { you: 'A', units: [
  { id: 1, side: 'A', lane: 0, x: 17, y: 30, poseId: 7, slot: 0, packSize: 3, archetype: 'guerrier' },
  { id: 2, side: 'B', lane: 0, x: 17, y: 32, poseId: 8, slot: 0, packSize: 3, archetype: 'guerrier' },
  { id: 3, side: 'A', lane: 2, x: 83, y: 30, poseId: 9, slot: 0, packSize: 3, archetype: 'guerrier', recalling: true },
] };
const at = board.toBoard(COL[0], 30, 'A');
check('rappel : toucher mon groupe le désigne', board.unitAtPoint(at.x, at.y, rv, 'A') && board.unitAtPoint(at.x, at.y, rv, 'A').poseId === 7);
check('rappel : jamais un groupe adverse', !board.unitAtPoint(board.toBoard(COL[0], 32, 'A').x, board.toBoard(COL[0], 32, 'A').y - 60, rv, 'A'));
check('rappel : un groupe déjà en retraite est ignoré', !board.unitAtPoint(board.toBoard(COL[2], 30, 'A').x, board.toBoard(COL[2], 30, 'A').y, rv, 'A'));
check('rappel : rien à toucher loin des groupes', board.unitAtPoint(180, 600, rv, 'A') === null);

// ✨ États visibles
const fv = { you: 'A', buildings: [{ id: 1, side: 'A', kind: 'tower', lane: 0, x: 17, y: 15, hp: 600, maxHp: 600, alive: true, shielded: true }], units: [
  { id: 1, side: 'B', lane: 1, x: 50, y: 60, hp: 10, maxHp: 10, archetype: 'guerrier', url: 'g', slot: 0, packSize: 3, frozen: true },
  { id: 2, side: 'B', lane: 1, x: 50, y: 60, hp: 10, maxHp: 10, archetype: 'guerrier', url: 'g', slot: 1, packSize: 3, shield: true },
  { id: 3, side: 'A', lane: 1, x: 50, y: 30, hp: 10, maxHp: 10, archetype: 'guerrier', url: 'g', slot: 0, packSize: 3, recalling: true },
] };
const fs2 = board.renderDynamic(fv, { sprites: { g: 's1' } });
check('gel : anneau bleu', fs2.includes('data-fx="frozen"'));
check('bouclier : anneau blanc', fs2.includes('data-fx="shield"'));
check('retraite : groupe estompé', fs2.includes('opacity="0.55"'));
check('Rempart : tour protégée', fs2.includes('data-fx="rempart"'));
// 🐛 v2.3 : le cercle blanc était invisible sur le sol crème → couleur de l'équipe + 🛡
const rempart = /<g data-fx="rempart">([\s\S]*?)<\/g>/.exec(fs2)[1];
check('Rempart : cercle à la couleur de mon équipe (bleu), pas blanc', rempart.includes(`stroke="${board.COLORS.BLUE}"`) && !rempart.includes('stroke="#FFFFFF"'));
check('Rempart : bouclier 🛡 au-dessus de la tour', rempart.includes('🛡'));
const foeShield = board.renderDynamic({ ...fv, buildings: [{ ...fv.buildings[0], side: 'B', y: 85 }] }, { sprites: { g: 's1' } });
check('Rempart adverse : cercle orange', /<g data-fx="rempart">[\s\S]*?stroke="#FF6229"/.test(foeShield));
const fx2 = board.renderDynamic({ you: 'A', units: [], buildings: [] }, { fx: [{ type: 'lane', lane: 1, color: '#FF73C0', age: 100 }, { type: 'ring', x: 10, y: 10, age: 0, color: '#FF6229' }] });
check('pouvoir : le couloir visé s\'illumine', fx2.includes('data-fx="lane"'));

console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
