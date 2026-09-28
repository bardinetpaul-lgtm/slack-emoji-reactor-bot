#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test du ciblage des unités (moteur)
//
//  • Un groupe posé JUSTE DEVANT un ennemi qui l'a déjà dépassé (l'ennemi
//    est entre lui et sa tour) se retourne et le combat, au lieu de
//    filer vers la cible suivante.
//  • Un groupe combat l'ennemi le plus proche, pas celui d'après.
//  • Un ennemi loin derrière est ignoré (c'est le travail des tours).
//  • La pose apparaît vite (≤ 0,5 s).
//
//  Usage : node scripts/test-arena-targeting.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-arena-target-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
const overrides = {};
for (const a of ['tank', 'guerrier', 'tireur', 'essaim', 'sort', 'pompe']) for (let i = 1; i <= 8; i += 1) overrides[`${a}${i}`] = { archetype: a, specialty: 'none' };
fs.writeFileSync(path.join(TMP, 'data', 'card-overrides.json'), JSON.stringify(overrides));

const engine = require(path.join(TMP, 'src', 'game', 'engine.js'));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const DECK_A = ['guerrier1', 'guerrier2', 'tireur1', 'tireur2', 'tank1', 'essaim1', 'sort1', 'pompe1'];
const DECK_B = ['guerrier3', 'guerrier4', 'tireur3', 'tireur4', 'tank2', 'essaim2', 'sort2', 'pompe2'];
const player = (u, urls) => ({ userId: u, deck: urls.map((x) => ({ url: x, title: x, rarity: 'common' })), copies: Object.fromEntries(urls.map((x) => [x, 1])) });
const match = () => engine.createMatch({ id: 't', seed: 3, players: { A: player('UA', DECK_A), B: player('UB', DECK_B) } });
const give = (s, side, urls) => { s.players[side].hand = urls.slice(); s.players[side].elixir = 10; };
const groupHp = (s, url) => s.units.filter((u) => u.url === url).reduce((a, u) => a + u.hp, 0);

// ─── Délai de pose ───
{
  const s = match();
  give(s, 'A', ['guerrier1']);
  engine.applyAction(s, 'A', { type: 'deploy', url: 'guerrier1', lane: 1, depth: 30 });
  engine.tick(s, 500);
  check('la pose apparaît en 0,5 s', s.units.length === 3);
}

// ─── 👁 La pose annonce la carte (l'adversaire voit ce qui arrive) ───
{
  const s = match();
  give(s, 'B', ['tireur3']);
  const ev = engine.applyAction(s, 'B', { type: 'deploy', url: 'tireur3', lane: 2, depth: 30 }).events.find((e) => e.type === 'deploy');
  check('événement de pose : titre, rareté, rôle et point exact', ev.title === 'tireur3' && ev.rarity === 'common' && ev.archetype === 'tireur' && Math.abs(ev.y - 70) < 0.01);
}

// ─── Ennemi déjà dépassé : on se retourne pour le combattre ───
{
  const s = match();
  give(s, 'B', ['guerrier3']);
  give(s, 'A', ['guerrier1']);
  // l'ennemi B est à y ≈ 36, il descend vers ma tour (y = 15)
  engine.applyAction(s, 'B', { type: 'deploy', url: 'guerrier3', lane: 1, depth: 40 });
  s.pending[0].y = 36;
  engine.tick(s, 500);
  // je pose juste devant lui côté rivière (y = 40) : il est DERRIÈRE mon groupe
  engine.applyAction(s, 'A', { type: 'deploy', url: 'guerrier1', lane: 1, depth: 40 });
  const before = groupHp(s, 'guerrier3');
  engine.tick(s, 3000);
  check('mon groupe frappe l\'ennemi qu\'il vient de croiser', groupHp(s, 'guerrier3') < before);
  const mine = s.units.filter((u) => u.url === 'guerrier1');
  check('mon groupe ne part pas vers la tour adverse', mine.length && mine.every((u) => u.y < 45));
}

// ─── Deux groupes ennemis : on combat le premier ───
{
  const s = match();
  give(s, 'B', ['guerrier3', 'guerrier4']);
  give(s, 'A', ['guerrier1']);
  engine.applyAction(s, 'B', { type: 'deploy', url: 'guerrier3', lane: 1, depth: 45 });   // y ≈ 55 (premier)
  engine.applyAction(s, 'B', { type: 'deploy', url: 'guerrier4', lane: 1, depth: 25 });   // y ≈ 75 (suivant)
  engine.tick(s, 500);
  s.units.forEach((u) => { if (u.side === 'B') u.speed = 0; });
  engine.applyAction(s, 'A', { type: 'deploy', url: 'guerrier1', lane: 1, depth: 45 });
  const first = groupHp(s, 'guerrier3');
  const second = groupHp(s, 'guerrier4');
  engine.tick(s, 3000);
  check('le premier groupe ennemi prend les coups', groupHp(s, 'guerrier3') < first);
  check('le suivant n\'est pas touché', groupHp(s, 'guerrier4') === second);
}

// ─── Ennemi loin derrière : ignoré ───
{
  const s = match();
  give(s, 'B', ['guerrier3']);
  give(s, 'A', ['guerrier1']);
  tower(s, 'A', 1).alive = false;   // la brèche laisse B descendre loin
  engine.applyAction(s, 'B', { type: 'deploy', url: 'guerrier3', lane: 1, depth: 40 });
  s.pending[0].y = 12;
  engine.tick(s, 500);
  s.units.forEach((u) => { if (u.side === 'B') u.speed = 0; });
  engine.applyAction(s, 'A', { type: 'deploy', url: 'guerrier1', lane: 1, depth: 44 });
  engine.tick(s, 2000);
  const mine = s.units.filter((u) => u.url === 'guerrier1');
  check('un ennemi à 30 cases derrière est laissé aux tours', mine.every((u) => u.y > 44));
}

function tower(s, side, lane) { return s.buildings.find((b) => b.side === side && b.kind === 'tower' && b.lane === lane); }

console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
