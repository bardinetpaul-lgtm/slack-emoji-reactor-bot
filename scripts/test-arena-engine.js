#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test du moteur de combat de l'Arène (src/game/engine.js)
//
//  Le moteur est pur (aucun I/O) : on fabrique des decks à la main,
//  on impose les archétypes via data/card-overrides.json dans une
//  COPIE temporaire du projet, puis on joue des scénarios.
//
//  Usage : node scripts/test-arena-engine.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-arena-engine-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));

// Cartes de test : l'URL dit l'archétype (imposé par surcharge)
const ARCHS = ['tank', 'guerrier', 'tireur', 'essaim', 'sort', 'pompe'];
const overrides = {};
for (const a of ARCHS) for (let i = 1; i <= 8; i += 1) overrides[`${a}${i}`] = { archetype: a };
fs.writeFileSync(path.join(TMP, 'data', 'card-overrides.json'), JSON.stringify(overrides));

const engine = require(path.join(TMP, 'src', 'game', 'engine.js'));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const card = (url, rarity = 'common') => ({ url, title: url, rarity });

/** Deck de 8 cartes, 1 exemplaire chacune sauf `copies` précisé. */
function player(userId, urls, copies = {}) {
  const deck = urls.map((u) => (typeof u === 'string' ? card(u) : u));
  const c = {};
  for (const d of deck) c[d.url] = copies[d.url] || 1;
  return { userId, deck, copies: c };
}

const DECK_A = ['guerrier1', 'guerrier2', 'tireur1', 'tireur2', 'tank1', 'essaim1', 'sort1', 'pompe1'];
const DECK_B = ['guerrier3', 'guerrier4', 'tireur3', 'tireur4', 'tank2', 'essaim2', 'sort2', 'pompe2'];

function newMatch(opts = {}) {
  return engine.createMatch({
    id: 'm1',
    seed: opts.seed || 42,
    players: {
      A: opts.A || player('UA', DECK_A),
      B: opts.B || player('UB', DECK_B),
    },
  });
}

/** Met une carte précise en main (pour des scénarios déterministes). */
function forceHand(state, side, urls) {
  state.players[side].hand = urls.slice();
}

const run = (state, ms) => engine.tick(state, ms);
const tower = (state, side, lane) => state.buildings.find((b) => b.side === side && b.kind === 'tower' && b.lane === lane);
const qg = (state, side) => state.buildings.find((b) => b.side === side && b.kind === 'qg');

// ─── 💧 Élixir ───
{
  const s = newMatch();
  check('élixir de départ = 5', s.players.A.elixir === 5);
  run(s, 2800);
  check('+1 élixir après 2,8 s', Math.abs(s.players.A.elixir - 6) < 0.01);
  run(s, 60000);
  check('élixir plafonné à 10', s.players.A.elixir === 10);
  const d = newMatch();
  d.players.A.elixir = 0;
  d.players.B.elixir = 0;
  run(d, 60000); // reste 60 s → double élixir
  d.players.A.elixir = 0;
  run(d, 1400);
  check('double élixir la dernière minute : +1 en 1,4 s', Math.abs(d.players.A.elixir - 1) < 0.01);
}

// ─── 🃏 Main et cycle ───
{
  const s = newMatch();
  check('main de 4 cartes', s.players.A.hand.length === 4);
  check('file de 4 cartes', s.players.A.queue.length === 4);
  const played = s.players.A.hand.find((u) => engine.cardStats(s, 'A', u).cost <= 5);
  const next = s.players.A.queue[0];
  const r = engine.applyAction(s, 'A', { type: 'deploy', url: played, lane: 1 });
  check('pose acceptée', r.ok);
  check('la carte suivante de la file arrive en main', s.players.A.hand.includes(next) && s.players.A.hand.length === 4);
  check('carte sans exemplaire restant : sort du cycle', !s.players.A.queue.includes(played) && !s.players.A.hand.includes(played));

  const c = newMatch({ A: player('UA', DECK_A, { guerrier1: 2 }) });
  forceHand(c, 'A', ['guerrier1', 'guerrier2', 'tireur1', 'tireur2']);
  c.players.A.queue = ['tank1', 'essaim1', 'sort1', 'pompe1'];
  engine.applyAction(c, 'A', { type: 'deploy', url: 'guerrier1', lane: 0 });
  check('×1 dans le deck : une fois dépensée, elle ne revient pas (même avec 2 exemplaires possédés)', !c.players.A.queue.includes('guerrier1') && !c.players.A.hand.includes('guerrier1'));
  check('×1 dans le deck : 0 pose restante', c.players.A.copies.guerrier1 === 0);
  let poses = 1;
  for (let i = 0; i < 20; i += 1) {
    c.players.A.elixir = 10;
    const u = c.players.A.hand[0];
    if (!u) break;
    if (engine.applyAction(c, 'A', { type: 'deploy', url: u, lane: i % 3 }).ok) poses += 1;
    run(c, 1500);
  }
  check('au maximum 8 poses par combat (une par emplacement)', poses === 8 && c.players.A.hand.length === 0);
}

// ─── 👥 Une carte ×3 sur 3 emplacements : 3 poses ───
{
  const deck3 = ['guerrier1', 'guerrier1', 'guerrier1', 'tireur1', 'tireur2', 'tank1', 'essaim1', 'sort1'];
  const s = engine.createMatch({ id: 'd3', seed: 5, players: { A: player('UA', deck3.map((u) => ({ url: u, title: u, rarity: 'common' })), { guerrier1: 3 }), B: player('UB', DECK_B) } });
  check('×3 sur 3 emplacements : 8 cartes dans le cycle', s.players.A.hand.length + s.players.A.queue.length === 8);
  let uses = 0;
  for (let i = 0; i < 30; i += 1) {
    s.players.A.elixir = 10;
    const u = s.players.A.hand.includes('guerrier1') ? 'guerrier1' : s.players.A.hand[0];
    if (!u) break;
    if (engine.applyAction(s, 'A', { type: 'deploy', url: u, lane: 0 }).ok && u === 'guerrier1') uses += 1;
    run(s, 500);
  }
  check('×3 sur 3 emplacements : posée exactement 3 fois', uses === 3 && s.players.A.copies.guerrier1 === 0);
  check('plus d\'exemplaire : la carte a quitté main et file', !s.players.A.hand.includes('guerrier1') && !s.players.A.queue.includes('guerrier1'));
  const deck2 = ['guerrier1', 'guerrier1', 'tireur1', 'tireur2', 'tank1', 'essaim1', 'sort1', 'pompe1'];
  const s2 = engine.createMatch({ id: 'd2', seed: 5, players: { A: player('UA', deck2.map((u) => ({ url: u, title: u, rarity: 'common' })), { guerrier1: 1 }), B: player('UB', DECK_B) } });
  check('2 emplacements mais 1 seul exemplaire : 1 seul emplacement jouable', s2.players.A.hand.concat(s2.players.A.queue).filter((u) => u === 'guerrier1').length === 1);
}

// ─── 🚫 Refus ───
{
  const s = newMatch();
  forceHand(s, 'A', ['tank1', 'guerrier1', 'pompe1', 'sort1']);
  s.players.A.elixir = 4;
  check('refus : élixir insuffisant', engine.applyAction(s, 'A', { type: 'deploy', url: 'tank1', lane: 0 }).reason === 'elixir');
  check('refus : carte pas en main', engine.applyAction(s, 'A', { type: 'deploy', url: 'tireur1', lane: 0 }).reason === 'not_in_hand');
  check('refus : couloir invalide', engine.applyAction(s, 'A', { type: 'deploy', url: 'guerrier1', lane: 3 }).reason === 'lane');
  check('refus : pose avancée sans brèche', engine.applyAction(s, 'A', { type: 'deploy', url: 'guerrier1', lane: 0, forward: true }).reason === 'no_breach');
  s.players.A.elixir = 10;
  s.players.A.copies.pompe1 = 2;
  check('Pompe acceptée', engine.applyAction(s, 'A', { type: 'deploy', url: 'pompe1', lane: 0 }).ok);
  forceHand(s, 'A', ['pompe1', 'guerrier1', 'sort1', 'tank1']);
  check('refus : une seule Pompe à la fois', engine.applyAction(s, 'A', { type: 'deploy', url: 'pompe1', lane: 2 }).reason === 'pump_active');
}

// ─── ⏱ Délai d'apparition de 1 s ───
{
  const s = newMatch();
  forceHand(s, 'A', ['guerrier1', 'guerrier2', 'tireur1', 'tireur2']);
  const r = engine.applyAction(s, 'A', { type: 'deploy', url: 'guerrier1', lane: 1 });
  check('la pose est annoncée tout de suite (événement deploy)', r.events.some((e) => e.type === 'deploy' && e.url === 'guerrier1'));
  run(s, 900);
  check('pas encore apparue à 0,9 s', s.units.length === 0);
  run(s, 100);
  check('apparue à 1 s : un groupe de 3 Guerriers', s.units.length === 3 && s.units.every((u) => u.lane === 1));
  check('groupe : chaque personnage connaît sa place dans le groupe', JSON.stringify(s.units.map((u) => u.slot)) === '[0,1,2]' && s.units.every((u) => u.packSize === 3));
}

// ─── 🛡 Tank ignore les unités, 🏰 tours tirent ───
{
  const s = newMatch();
  forceHand(s, 'A', ['tank1', 'guerrier1', 'tireur1', 'tireur2']);
  forceHand(s, 'B', ['guerrier3', 'guerrier4', 'tireur3', 'tireur4']);
  engine.applyAction(s, 'A', { type: 'deploy', url: 'tank1', lane: 0 });
  engine.applyAction(s, 'B', { type: 'deploy', url: 'guerrier3', lane: 0 });
  const tankId = () => s.units.find((u) => u.archetype === 'tank');
  run(s, 12000);
  const t = tankId();
  check('le Tank traverse sans s\'arrêter sur le Guerrier', t && t.y > 60);
  run(s, 20000);
  check('la tour B du couloir 0 a pris des dégâts', tower(s, 'B', 0).hp < 600);
  check('le Tank prend les tirs de la tour', !tankId() || tankId().hp < tankId().maxHp);

  const g = newMatch();
  forceHand(g, 'A', ['guerrier1', 'guerrier2', 'tireur1', 'tireur2']);
  engine.applyAction(g, 'A', { type: 'deploy', url: 'guerrier1', lane: 2 });
  run(g, 40000);
  check('un groupe de Guerriers seul meurt sous la tour sans la raser', g.units.length === 0 && tower(g, 'B', 2).alive);
  const pose = g.poses.find((p) => p.url === 'guerrier1');
  check('sa pose est marquée détruite', pose.status === 'destroyed');
}

// ─── 🔓 Brèche, pose avancée, dégâts au QG ───
{
  const s = newMatch();
  tower(s, 'B', 1).hp = 1;
  forceHand(s, 'A', ['guerrier1', 'guerrier2', 'tireur1', 'tireur2']);
  engine.applyAction(s, 'A', { type: 'deploy', url: 'tireur1', lane: 1 });
  run(s, 15000);
  check('tour B couloir 1 détruite', !tower(s, 'B', 1).alive);
  check('compteur de tours détruites', engine.towersDestroyed(s, 'B') === 1);
  s.players.A.elixir = 10;
  forceHand(s, 'A', ['guerrier1', 'guerrier2', 'tireur2', 'tank1']);
  check('pose avancée autorisée après la brèche', engine.applyAction(s, 'A', { type: 'deploy', url: 'guerrier1', lane: 1, forward: true }).ok);
  run(s, 1000);
  check('unité avancée apparue au-delà de la rivière', s.units.some((u) => u.side === 'A' && u.y >= 60 && u.archetype === 'guerrier'));
  run(s, 6000);
  check('le QG B prend des dégâts', qg(s, 'B').hp < 2000);
}

// ─── 💥 Sort ───
{
  const s = newMatch();
  forceHand(s, 'B', ['guerrier3', 'guerrier4', 'tireur3', 'tireur4']);
  s.players.B.elixir = 10;
  s.players.B.copies.essaim2 = 1;
  forceHand(s, 'B', ['essaim2', 'guerrier4', 'tireur3', 'tireur4']);
  engine.applyAction(s, 'B', { type: 'deploy', url: 'essaim2', lane: 0 });
  run(s, 1500);
  check('Essaim : 6 personnages', s.units.filter((u) => u.archetype === 'essaim').length === 6);
  forceHand(s, 'A', ['sort1', 'guerrier1', 'tireur1', 'tireur2']);
  engine.applyAction(s, 'A', { type: 'deploy', url: 'sort1', lane: 0 });
  run(s, 1000);
  check('Sort : l\'Essaim est rasé (zone + contre)', s.units.filter((u) => u.archetype === 'essaim').length === 0);
  check('Sort : toujours compté comme détruit', s.poses.find((p) => p.url === 'sort1').status === 'destroyed');

  const b = newMatch();
  forceHand(b, 'A', ['sort1', 'guerrier1', 'tireur1', 'tireur2']);
  engine.applyAction(b, 'A', { type: 'deploy', url: 'sort1', lane: 2 });
  run(b, 1000);
  check('Sort sur couloir vide : 40 % des dégâts sur la tour', Math.abs(tower(b, 'B', 2).hp - (600 - 350 * 0.4)) < 0.01);
}

// ─── ⚗️ Pompe ───
{
  const s = newMatch();
  forceHand(s, 'A', ['pompe1', 'guerrier1', 'tireur1', 'tireur2']);
  engine.applyAction(s, 'A', { type: 'deploy', url: 'pompe1', lane: 0 });
  s.players.A.elixir = 0;
  s.players.B.elixir = 0;
  run(s, 1000 + 7000);
  const withPump = s.players.A.elixir;
  const without = s.players.B.elixir;
  check('Pompe : +1 élixir après 7 s', Math.abs(withPump - without - 1) < 0.01);
  run(s, 45000);
  check('Pompe expirée après 45 s', !s.buildings.some((b) => b.kind === 'pompe' && b.alive));
  check('Pompe expirée = survivante (expired)', s.poses.find((p) => p.url === 'pompe1').status === 'expired');
}

// ─── ⚔️ Contres ───
{
  // Guerrier contre Tireur au corps à corps : le Guerrier doit gagner
  const s = newMatch();
  forceHand(s, 'A', ['guerrier1', 'guerrier2', 'tireur1', 'tireur2']);
  forceHand(s, 'B', ['tireur3', 'guerrier4', 'tireur4', 'tank2']);
  engine.applyAction(s, 'A', { type: 'deploy', url: 'guerrier1', lane: 1 });
  engine.applyAction(s, 'B', { type: 'deploy', url: 'tireur3', lane: 1 });
  run(s, 10000);
  check('le Guerrier bat le Tireur (contre)', s.poses.find((p) => p.url === 'tireur3').status === 'destroyed'
    && s.poses.find((p) => p.url === 'guerrier1').status !== 'destroyed');
}

// ─── 👥 Une carte = toujours un groupe ───
{
  const s = newMatch();
  s.players.A.elixir = 10;
  forceHand(s, 'A', ['tank1', 'tireur1', 'guerrier1', 'guerrier2']);
  engine.applyAction(s, 'A', { type: 'deploy', url: 'tank1', lane: 0 });
  engine.applyAction(s, 'A', { type: 'deploy', url: 'tireur1', lane: 2 });
  run(s, 1000);
  const count = (a) => s.units.filter((u) => u.archetype === a).length;
  check('Tank : groupe de 2', count('tank') === 2);
  check('Tireur : groupe de 3', count('tireur') === 3);
  check('la pose reste une seule carte engagée', s.poses.filter((p) => p.side === 'A').length === 2);
}

// ─── 🏁 Fins de combat ───
{
  const s = newMatch();
  qg(s, 'B').hp = 1;
  tower(s, 'B', 0).hp = 0;
  tower(s, 'B', 0).alive = false;
  forceHand(s, 'A', ['guerrier1', 'guerrier2', 'tireur1', 'tireur2']);
  engine.applyAction(s, 'A', { type: 'deploy', url: 'guerrier1', lane: 0, forward: true });
  run(s, 20000);
  check('QG détruit → victoire immédiate', s.status === 'ended' && s.result.winner === 'A' && s.result.reason === 'qg');

  const t = newMatch();
  tower(t, 'A', 2).hp = 0;
  tower(t, 'A', 2).alive = false;
  run(t, 120000);
  check('à 2:00 : plus de tours détruites gagne', t.status === 'ended' && t.result.winner === 'B' && t.result.reason === 'towers');

  const h = newMatch();
  qg(h, 'A').hp = 1500;
  run(h, 120000);
  check('à égalité de tours : PV du QG', h.result.winner === 'B' && h.result.reason === 'qg_hp');

  const n = newMatch();
  run(n, 120000);
  check('égalité parfaite → nul', n.result.winner === null && n.result.reason === 'draw');

  const f = newMatch();
  engine.applyAction(f, 'A', { type: 'forfeit' });
  check('abandon → défaite', f.status === 'ended' && f.result.winner === 'B' && f.result.reason === 'forfeit');
  check('plus aucune action après la fin', engine.applyAction(f, 'B', { type: 'deploy', url: f.players.B.hand[0], lane: 0 }).reason === 'not_running');

  const p = newMatch();
  forceHand(p, 'A', ['guerrier1', 'guerrier2', 'tireur1', 'tireur2']);
  engine.applyAction(p, 'A', { type: 'deploy', url: 'guerrier1', lane: 1 });
  run(p, 2000);
  engine.applyAction(p, 'B', { type: 'forfeit' });
  const r = p.result.poses.find((x) => x.url === 'guerrier1');
  check('résultat : pose encore vivante = alive', r && r.status === 'alive' && r.side === 'A');
}

// ─── 🎲 Déterminisme ───
{
  const play = () => {
    const s = newMatch({ seed: 7 });
    const log = [];
    for (let t = 0; t < 120; t += 1) {
      for (const side of ['A', 'B']) {
        const hand = s.players[side].hand;
        const u = hand.find((x) => engine.cardStats(s, side, x).cost <= s.players[side].elixir);
        if (u) engine.applyAction(s, side, { type: 'deploy', url: u, lane: t % 3 });
      }
      run(s, 1000);
      log.push(JSON.stringify(s.buildings.map((b) => Math.round(b.hp))));
    }
    return { log: log.join('|'), result: JSON.stringify(s.result) };
  };
  const a = play();
  const b = play();
  check('même graine + mêmes actions → même combat', a.log === b.log && a.result === b.result);
  check('le combat automatique se termine', JSON.parse(a.result) !== null);
}

// ─── 👁 Vue publique ───
{
  const s = newMatch();
  const v = engine.publicState(s, 'A');
  check('vue publique : ma main visible', Array.isArray(v.players.A.hand) && v.players.A.hand.length === 4);
  check('vue publique : main adverse cachée', v.players.B.hand === undefined && v.players.B.handCount === 4);
  check('vue publique : élixir adverse visible', typeof v.players.B.elixir === 'number');
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
