#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test du placement libre (moteur + terrain)
//
//  • Une carte se pose au POINT touché : profondeur `depth` (0 = ma base,
//    100 = base adverse) dans ma moitié ; chez l'adversaire seulement
//    dans un couloir dont la tour est tombée.
//  • Un Sort frappe au point visé, n'importe où.
//  • Côté page : point touché → { lane, depth } (vue A et vue B).
//
//  Usage : node scripts/test-arena-placement.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-arena-place-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.mkdirSync(path.join(TMP, 'data'));
const overrides = {};
for (const a of ['tank', 'guerrier', 'tireur', 'essaim', 'sort', 'pompe']) for (let i = 1; i <= 8; i += 1) overrides[`${a}${i}`] = { archetype: a, specialty: 'none' };
fs.writeFileSync(path.join(TMP, 'data', 'card-overrides.json'), JSON.stringify(overrides));

const engine = require(path.join(TMP, 'src', 'game', 'engine.js'));
const board = require(path.join(ROOT, 'public', 'arena-board.js'));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const DECK_A = ['guerrier1', 'guerrier2', 'tireur1', 'tireur2', 'tank1', 'essaim1', 'sort1', 'pompe1'];
const DECK_B = ['guerrier3', 'guerrier4', 'tireur3', 'tireur4', 'tank2', 'essaim2', 'sort2', 'pompe2'];
const player = (u, urls) => ({ userId: u, deck: urls.map((x) => ({ url: x, title: x, rarity: 'common' })), copies: Object.fromEntries(urls.map((x) => [x, 1])) });
const match = () => engine.createMatch({ id: 'p', seed: 2, players: { A: player('UA', DECK_A), B: player('UB', DECK_B) } });
const give = (s, side, urls) => { s.players[side].hand = urls.slice(); s.players[side].elixir = 10; };
const tower = (s, side, lane) => s.buildings.find((b) => b.side === side && b.kind === 'tower' && b.lane === lane);

// ─── Moteur : pose au point choisi ───
{
  const s = match();
  give(s, 'A', ['guerrier1']);
  check('A : pose à la profondeur 42 acceptée', engine.applyAction(s, 'A', { type: 'deploy', url: 'guerrier1', lane: 1, depth: 42 }).ok);
  engine.tick(s, 500);
  check('A : le groupe apparaît au point choisi (y ≈ 42)', s.units.length === 3 && Math.abs(s.units[0].y - 42) < 1.5);

  const b = match();
  give(b, 'B', ['guerrier3']);
  engine.applyAction(b, 'B', { type: 'deploy', url: 'guerrier3', lane: 0, depth: 30 });
  engine.tick(b, 500);
  check('B : profondeur vue de son camp (y ≈ 70)', Math.abs(b.units[0].y - 70) < 1.5);

  const z = match();
  give(z, 'A', ['guerrier1', 'guerrier2']);
  check('refus : dans la rivière', engine.applyAction(z, 'A', { type: 'deploy', url: 'guerrier1', lane: 0, depth: 50 }).reason === 'zone');
  check('refus : chez l\'adversaire sans brèche', engine.applyAction(z, 'A', { type: 'deploy', url: 'guerrier1', lane: 0, depth: 65 }).reason === 'no_breach');
  check('refus : derrière ma base', engine.applyAction(z, 'A', { type: 'deploy', url: 'guerrier1', lane: 0, depth: 2 }).reason === 'zone');
  tower(z, 'B', 0).alive = false;
  check('brèche : pose chez l\'adversaire acceptée', engine.applyAction(z, 'A', { type: 'deploy', url: 'guerrier2', lane: 0, depth: 65 }).ok);
  engine.tick(z, 500);
  check('brèche : groupe au point choisi (y ≈ 65)', Math.abs(z.units[0].y - 65) < 1.5);

  const d = match();
  give(d, 'A', ['guerrier1']);
  engine.applyAction(d, 'A', { type: 'deploy', url: 'guerrier1', lane: 2 });
  engine.tick(d, 500);
  check('sans profondeur : comme avant (devant ma tour, y ≈ 20)', Math.abs(d.units[0].y - 20) < 1.5);
}

// ─── Moteur : Sort visé ───
{
  const s = match();
  give(s, 'B', ['guerrier3', 'tireur3']);
  engine.applyAction(s, 'B', { type: 'deploy', url: 'guerrier3', lane: 1, depth: 45 });   // y ≈ 55
  engine.applyAction(s, 'B', { type: 'deploy', url: 'tireur3', lane: 1, depth: 15 });     // y ≈ 85 (derrière)
  engine.tick(s, 500);
  s.units.forEach((u) => { u.speed = 0; });
  const front = () => s.units.filter((u) => u.archetype === 'guerrier').reduce((a, u) => a + u.hp, 0);
  const back = () => s.units.filter((u) => u.archetype === 'tireur').reduce((a, u) => a + u.hp, 0);
  const f0 = front();
  const b0 = back();
  give(s, 'A', ['sort1']);
  check('Sort visé chez l\'adversaire : accepté', engine.applyAction(s, 'A', { type: 'deploy', url: 'sort1', lane: 1, depth: 86 }).ok);
  engine.tick(s, 500);
  check('Sort visé : touche le groupe visé (derrière)', back() < b0);
  check('Sort visé : épargne le groupe hors zone (devant)', Math.abs(front() - f0) < 1 || front() >= f0 - 5);
}

// ─── Terrain : point touché → point du moteur (x absolu + profondeur) ───
{
  const none = { you: 'A', buildings: [0, 1, 2].map((lane) => ({ side: 'B', kind: 'tower', lane, alive: true })) };
  const at = board.toBoard(50, 30, 'A');
  const p = board.pointToDeploy(at.x, at.y, none);
  check('vue A : point → x ≈ 50, profondeur ≈ 30', p.ok && Math.abs(p.x - 50) < 0.5 && Math.abs(p.depth - 30) < 1);
  const bb = { you: 'B', buildings: [0, 1, 2].map((lane) => ({ side: 'A', kind: 'tower', lane, alive: true })) };
  const atB = board.toBoard(17, 70, 'B');   // y absolu 70 = profondeur 30 pour B
  const q = board.pointToDeploy(atB.x, atB.y, bb);
  check('vue B : même geste, profondeur ≈ 30 et même x absolu', q.ok && Math.abs(q.x - 17) < 0.5 && Math.abs(q.depth - 30) < 1);
  check('rivière : refusée', board.pointToDeploy(180, 320, none).reason === 'zone');
  const spell = board.pointToDeploy(180, 150, none, { spell: true });
  check('Sort : visable n\'importe où, même chez l\'adversaire', spell.ok && spell.depth > 80);
  check('aller-retour : profondeur → point → profondeur', Math.abs(board.pointToDeploy(board.toBoard(83, 40, 'A').x, board.toBoard(83, 40, 'A').y, none).depth - 40) < 1);
  const ghost = board.renderGhost({ x: 60, y: 450, ok: true, archetype: 'guerrier', sprite: 's1' });
  check('fantôme : aperçu du groupe au point', ghost.includes('#s1') && ghost.includes('data-fx="ghost"'));
  check('fantôme : rouge si interdit', board.renderGhost({ x: 180, y: 320, ok: false, archetype: 'guerrier', sprite: 's1' }).includes('#FF6229'));
  check('fantôme : zone d\'impact pour un Sort', board.renderGhost({ x: 180, y: 150, ok: true, archetype: 'sort' }).includes('data-fx="ghost-spell"'));
}

try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }   // Windows : fichier ouvert = non supprimable
fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
