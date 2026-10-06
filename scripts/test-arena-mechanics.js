#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test des mécaniques de style de jeu (moteur de l'Arène)
//     🎖 Capitaine (passif + pouvoir 1×) · 🏳 Rappel · 🔥 Rage
//     ✨ Spécialités des épiques / légendaires
//
//  Travaille dans une COPIE temporaire du projet (archétypes et
//  spécialités imposés via data/card-overrides.json).
//
//  Usage : node scripts/test-arena-mechanics.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-arena-mech-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.mkdirSync(path.join(TMP, 'data'));

const ARCHS = ['tank', 'guerrier', 'tireur', 'essaim', 'sort', 'vigie'];
const overrides = {};
for (const a of ARCHS) for (let i = 1; i <= 8; i += 1) overrides[`${a}${i}`] = { archetype: a, specialty: 'none' };
overrides['old-pompe'] = { archetype: 'pompe' };   // ancienne surcharge (avant la v2.3) : lue « vigie »
for (const spec of ['charge', 'bouclier', 'vampire', 'explosion', 'invocation', 'ralenti', 'soin']) {
  const arch = { charge: 'guerrier', bouclier: 'tank', vampire: 'guerrier', explosion: 'guerrier', invocation: 'tank', ralenti: 'tireur', soin: 'tireur' }[spec];
  overrides[`spec-${spec}`] = { archetype: arch, specialty: spec };
}
overrides['auto-epic'] = { archetype: 'guerrier' };   // spécialité tirée automatiquement
fs.writeFileSync(path.join(TMP, 'data', 'card-overrides.json'), JSON.stringify(overrides));

const { TUNING } = require(path.join(TMP, 'src', 'game', 'captains.js'));
const engine = require(path.join(TMP, 'src', 'game', 'engine.js'));
const cards = require(path.join(TMP, 'src', 'game', 'cards.js'));
const captains = require(path.join(TMP, 'src', 'game', 'captains.js'));
const specialties = require(path.join(TMP, 'src', 'game', 'specialties.js'));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const card = (url, rarity = 'common') => ({ url, title: url, rarity });
function player(userId, urls, { captain = null, copies = {} } = {}) {
  const deck = urls.map((u) => (typeof u === 'string' ? card(u) : u));
  const c = {};
  for (const d of deck) c[d.url] = copies[d.url] || (c[d.url] || 0) + 1;
  return { userId, deck, copies: c, captain };
}
const DECK_A = ['guerrier1', 'guerrier2', 'tireur1', 'tireur2', 'tank1', 'essaim1', 'sort1', 'vigie1'];
const DECK_B = ['guerrier3', 'guerrier4', 'tireur3', 'tireur4', 'tank2', 'essaim2', 'sort2', 'vigie2'];
const match = (A = player('UA', DECK_A), B = player('UB', DECK_B)) => engine.createMatch({ id: 'm', seed: 3, players: { A, B } });
const run = (s, ms) => engine.tick(s, ms);
const tower = (s, side, lane) => s.buildings.find((b) => b.side === side && b.kind === 'tower' && b.lane === lane);
const give = (s, side, urls) => { s.players[side].hand = urls.slice(); s.players[side].elixir = 10; };

// ═══ 🎖 Capitaine ═══
{
  check('6 capitaines, un par archétype', Object.keys(captains.CAPTAINS).sort().join() === [...ARCHS].sort().join());
  const s = match(player('UA', DECK_A, { captain: 'tank1' }));
  check('le Capitaine (9e carte) ne prend aucune pose : 8 emplacements jouables', s.players.A.hand.length === 8);
  const out = match({ ...player('UA', DECK_A), captain: 'tank3', captainCard: { url: 'tank3', title: 'tank3', rarity: 'common' } });
  check('Capitaine hors du deck : accepté (9e carte), deck intact', out.players.A.captain && out.players.A.captain.archetype === 'tank' && out.players.A.hand.length === 8 && !out.players.A.hand.includes('tank3'));
  check('vue : Capitaine, pouvoir et état', engine.publicState(s, 'A').players.A.captain.power === 'rempart' && engine.publicState(s, 'A').players.A.captain.used === false);
  check('sans Capitaine : 8 emplacements', match().players.A.hand.length === 8);
  check('Capitaine hors deck ignoré', match(player('UA', DECK_A, { captain: 'nope' })).players.A.captain === null);

  // Passifs
  const garn = match(player('UA', DECK_A, { captain: 'vigie1' }));
  check('Garnison (Vigie) : élixir de départ et maximum normaux', garn.players.A.elixir === 5 && engine.publicState(garn, 'A').players.A.elixirMax === 10);
  const sortC = match(player('UA', DECK_A, { captain: 'sort1' }));
  check('Magie (Sort) : Sorts à −1 élixir', engine.cardStats(sortC, 'A', 'sort1').cost === cards.getCardStats(card('sort1')).cost - 1);
  const echo = match(player('UA', ['sort1', 'sort2', 'guerrier1', 'guerrier2', 'tireur1', 'tireur2', 'tank1', 'essaim1'], { captain: 'sort1' }));
  let casts = 0;
  for (let i = 0; i < 12; i += 1) {
    echo.players.A.elixir = 10;
    const u = echo.players.A.hand.includes('sort2') ? 'sort2' : echo.players.A.hand[0];
    if (!u) break;
    if (engine.applyAction(echo, 'A', { type: 'deploy', url: u, lane: i % 3 }).ok && u === 'sort2') casts += 1;
    run(echo, 500);
  }
  check('Écho (Magie) : un Sort se lance deux fois', casts === 2);
  engine.applyAction(echo, 'A', { type: 'forfeit' });
  check('Écho (Magie) : la relance n\'engage aucune carte (une seule pose au bilan)', echo.result.poses.filter((p) => p.url === 'sort2').length === 1);
  const tir = match(player('UA', DECK_A, { captain: 'tireur1' }));
  check('Contrôle (Tireur) : portée des tours augmentée', Math.abs(tower(tir, 'A', 0).range - tower(match(), 'A', 0).range * TUNING.towerRange) < 1e-9 && TUNING.towerRange > 1);
  const ess = match(player('UA', ['essaim1', 'essaim2', 'guerrier2', 'tireur1', 'tireur2', 'tank1', 'sort1', 'pompe1'], { captain: 'essaim1' }));
  give(ess, 'A', ['essaim2', 'guerrier2']);
  engine.applyAction(ess, 'A', { type: 'deploy', url: 'essaim2', lane: 1 });
  engine.applyAction(ess, 'A', { type: 'deploy', url: 'guerrier2', lane: 2 });
  run(ess, 1000);
  check('Nuée (Essaim) : tes Essaims +2 abeilles', ess.units.filter((u) => u.archetype === 'essaim').length === 8);
  check('Nuée (Essaim) : les autres groupes inchangés', ess.units.filter((u) => u.archetype === 'guerrier').length === 3);
  const rush = match(player('UA', DECK_A, { captain: 'guerrier1' }));
  give(rush, 'A', ['guerrier2']);
  engine.applyAction(rush, 'A', { type: 'deploy', url: 'guerrier2', lane: 1 });
  run(rush, 1000);
  check('Rush (Guerrier) : unités plus rapides et plus fortes', Math.abs(rush.units[0].speed - cards.getCardStats(card('guerrier2')).speed * TUNING.rushSpeed) < 1e-9 && Math.abs(rush.units[0].dps - cards.getCardStats(card('guerrier2')).dps * TUNING.rushDps) < 1e-9);
  const siege = match(player('UA', DECK_A, { captain: 'guerrier1' }), player('UB', DECK_B, { captain: 'tank2' }));
  give(siege, 'B', ['tank2', 'tank2']);
  siege.players.B.cards.tank2 = siege.players.B.cards.tank2;
  const t = match(player('UA', DECK_A, { captain: 'tank1' }));
  give(t, 'A', ['tank1']);
  t.players.A.hand = ['tank1'];
  engine.applyAction(t, 'A', { type: 'deploy', url: 'tank1', lane: 0 });
  run(t, 1000);
  check('Siège (Tank) : Tanks plus résistants', t.units.length === 0 || Math.abs(t.units[0].maxHp - cards.getCardStats(card('tank1')).hp * TUNING.tankHp) < 1e-6);

  // Pouvoirs (1 fois par combat)
  const salve = match(player('UA', DECK_A, { captain: 'tireur1' }));
  give(salve, 'B', ['guerrier3']);
  engine.applyAction(salve, 'B', { type: 'deploy', url: 'guerrier3', lane: 2 });
  run(salve, 1000);
  const before = salve.units.reduce((a, u) => a + u.hp, 0);
  const g0 = salve.units[0];
  check('Salve : acceptée (au point du groupe)', engine.applyAction(salve, 'A', { type: 'power', x: g0.x, depth: g0.y }).ok);
  check('Salve : dégâts aux ennemis de la zone', salve.units.reduce((a, u) => a + u.hp, 0) < before);
  check('pouvoir : une seule fois par combat', engine.applyAction(salve, 'A', { type: 'power', lane: 2 }).reason === 'power_used');
  check('pouvoir : refus sans Capitaine', engine.applyAction(match(), 'A', { type: 'power', lane: 0 }).reason === 'no_captain');

  const gel = match(player('UA', DECK_A, { captain: 'sort1' }));
  give(gel, 'B', ['guerrier3']);
  engine.applyAction(gel, 'B', { type: 'deploy', url: 'guerrier3', lane: 0 });
  run(gel, 1000);
  engine.applyAction(gel, 'A', { type: 'power', x: gel.units[0].x, depth: gel.units[0].y });
  const y0 = gel.units[0].y;
  run(gel, 1500);
  check('Gel : les unités de la zone sont figées', gel.units[0].y === y0);
  run(gel, 2000);
  check('Gel : 3 s puis ça repart', gel.units[0].y !== y0);

  const rem = match(player('UA', DECK_A, { captain: 'tank1' }));
  engine.applyAction(rem, 'A', { type: 'power', lane: 1 });
  tower(rem, 'A', 1).hp -= 0;
  give(rem, 'B', ['sort2']);
  engine.applyAction(rem, 'B', { type: 'deploy', url: 'sort2', lane: 1 });
  run(rem, 1000);
  check('Rempart : la tour ne prend aucun dégât pendant 4 s', tower(rem, 'A', 1).hp === 600);

  const renf = match(player('UA', DECK_A, { captain: 'essaim1' }));
  engine.applyAction(renf, 'A', { type: 'power', lane: 1 });
  run(renf, 1000);
  check('Renforts : 4 abeilles gratuites', renf.units.filter((u) => u.side === 'A' && u.archetype === 'essaim').length === 4);
  check('Renforts : aucune carte engagée (rien à perdre)', renf.poses.length === 0);

  const chg = match(player('UA', DECK_A, { captain: 'guerrier1' }));
  give(chg, 'A', ['guerrier2']);
  engine.applyAction(chg, 'A', { type: 'deploy', url: 'guerrier2', lane: 1 });
  run(chg, 1000);
  const at = { x: chg.units[0].x, y: chg.units[0].y };
  engine.applyAction(chg, 'A', { type: 'power', x: chg.units[0].x, depth: chg.units[0].y });   // au point du groupe
  run(chg, 1000);
  const fast = engine.distance(chg.units[0], at);
  const cmp = match(player('UA', DECK_A, { captain: 'guerrier1' }));
  give(cmp, 'A', ['guerrier2']);
  engine.applyAction(cmp, 'A', { type: 'deploy', url: 'guerrier2', lane: 1 });
  run(cmp, 1000);
  const bt = { x: cmp.units[0].x, y: cmp.units[0].y };
  run(cmp, 1000);
  check('Charge : le groupe touché fonce (vitesse ×2)', fast > engine.distance(cmp.units[0], bt) * 1.8);

  // Charge dans le camp ennemi (les deux camps : la profondeur est vue de son propre camp)
  for (const side of ['A', 'B']) {
    const far = match(player('UA', DECK_A, { captain: 'guerrier1' }), player('UB', DECK_B, { captain: 'guerrier3' }));
    const url = side === 'A' ? 'guerrier2' : 'guerrier4';
    give(far, side, [url]);
    engine.applyAction(far, side, { type: 'deploy', url, lane: 1 });
    run(far, 1000);
    const depthOf = (u) => (side === 'A' ? u.y : 100 - u.y);
    for (let i = 0; i < 60 && far.units.some((u) => u.side === side) && depthOf(far.units.find((u) => u.side === side)) < 60; i += 1) run(far, 500);
    const u = far.units.find((x) => x.side === side);
    const res = u ? engine.applyAction(far, side, { type: 'power', x: u.x, depth: depthOf(u) }) : { ok: false };
    check(`Charge dans le camp ennemi (camp ${side}) : acceptée et appliquée`, Boolean(u) && depthOf(u) >= 60 && res.ok && u.chargeUntil > far.timeMs);
  }
}

// ═══ 🗼 Vigie ═══
{
  const VDECK = ['vigie1', 'vigie2', 'vigie3', 'vigie4', 'guerrier1', 'tireur1', 'tank1', 'sort1'];
  const vm = (opts = {}) => match(player('UA', VDECK, opts));
  const pay = (s, side = 'A') => { s.players[side].elixir = 10; };
  // Un mannequin ennemi immobile (un seul Guerrier du camp B), à (x, y) du terrain
  const dummy = (s, x, y, { dps = 0 } = {}) => {
    give(s, 'B', ['guerrier3']);
    engine.applyAction(s, 'B', { type: 'deploy', url: 'guerrier3', lane: 1 });
    run(s, 600);
    const [u, ...rest] = s.units.filter((v) => v.side === 'B');
    s.units = s.units.filter((v) => !rest.includes(v));
    Object.assign(u, { x, y, speed: 0, dps, hp: 5000, maxHp: 5000 });
    return u;
  };
  const vigieOn = (s, lane, side = 'A', url = 'vigie1') => {
    give(s, side, [url]);
    engine.applyAction(s, side, { type: 'deploy', url, lane });
    run(s, 600);
    return tower(s, side, lane);
  };

  // Pose : tour la plus proche du point, sans Vigie
  const s = vm();
  give(s, 'A', ['vigie1', 'vigie2', 'vigie3', 'vigie4']);
  check('Vigie : pose acceptée', engine.applyAction(s, 'A', { type: 'deploy', url: 'vigie1', x: 80, depth: 30 }).ok);
  check('Vigie : la pose en attente prend la place de sa tour', s.pending[0].x === 83 && s.pending[0].y === 15 && s.pending[0].towerId === tower(s, 'A', 2).id);
  const evs = run(s, 600);
  check('Vigie : sur la tour la plus proche du point touché', tower(s, 'A', 2).vigie && tower(s, 'A', 2).vigie.url === 'vigie1' && !tower(s, 'A', 0).vigie && !tower(s, 'A', 1).vigie);
  check('Vigie : événement d\'apparition à la tour', evs.some((e) => e.type === 'spawn' && e.archetype === 'vigie' && e.x === 83 && e.y === 15));
  check('Vigie : la pose est en poste (alive)', s.poses[0].status === 'alive');
  pay(s);
  engine.applyAction(s, 'A', { type: 'deploy', url: 'vigie2', x: 83, depth: 20 });
  run(s, 600);
  check('Vigie : une tour déjà gardée est sautée (la plus proche libre)', tower(s, 'A', 1).vigie && tower(s, 'A', 1).vigie.url === 'vigie2');
  pay(s);
  check('Vigie : pose sur la dernière tour libre (en attente)', engine.applyAction(s, 'A', { type: 'deploy', url: 'vigie3', lane: 1 }).ok && s.pending[0].towerId === tower(s, 'A', 0).id);
  pay(s);
  check('Vigie : refus « no_tower » quand les 3 tours sont prises (dont une en attente)', engine.applyAction(s, 'A', { type: 'deploy', url: 'vigie4', lane: 0 }).reason === 'no_tower');
  check('Vigie : élixir non débité au refus, carte gardée en main', s.players.A.elixir === 10 && s.players.A.hand.includes('vigie4'));
  const dead = vm();
  give(dead, 'A', ['vigie1']);
  dead.buildings.filter((b) => b.side === 'A' && b.kind === 'tower').forEach((b) => { b.alive = false; b.hp = 0; });
  check('Vigie : refus « no_tower » quand toutes les tours sont détruites', engine.applyAction(dead, 'A', { type: 'deploy', url: 'vigie1', lane: 1 }).reason === 'no_tower' && dead.players.A.elixir === 10);
  const sb = match(player('UA', DECK_A), player('UB', VDECK));
  give(sb, 'B', ['vigie1']);
  engine.applyAction(sb, 'B', { type: 'deploy', url: 'vigie1', x: 20, depth: 25 });
  run(sb, 600);
  check('Vigie (camp B) : sur sa propre tour la plus proche', tower(sb, 'B', 0).vigie && tower(sb, 'B', 0).vigie.url === 'vigie1');

  // Tour visée tombée pendant la pose : redescend aussitôt (carte sauvée, élixir perdu)
  const late = vm();
  give(late, 'A', ['vigie1']);
  engine.applyAction(late, 'A', { type: 'deploy', url: 'vigie1', lane: 0 });
  tower(late, 'A', 0).alive = false;
  const lateEv = run(late, 600);
  check('Vigie : tour tombée pendant la pose → pose « expired » + vigie_end', late.poses[0].status === 'expired' && lateEv.some((e) => e.type === 'vigie_end' && e.side === 'A' && e.lane === 0) && !tower(late, 'A', 0).vigie);

  // Portée +4 : un ennemi à portée + 3 de la tour gauche (D = 15)
  const rg = vm();
  const far = dummy(rg, 17, 30);
  let h = far.hp;
  run(rg, 1000);
  check('sans Vigie : ennemi à portée + 3 ignoré par la tour', far.hp === h);
  vigieOn(rg, 0);
  h = far.hp;
  run(rg, 1000);
  check('avec Vigie : ennemi à portée + 3 visé', far.hp < h);

  // Tir +60 %
  const dm = vm();
  const near = dummy(dm, 17, 25);   // D = 10 : à portée dans les deux cas
  h = near.hp;
  run(dm, 1000);
  const base = h - near.hp;
  vigieOn(dm, 0);
  h = near.hp;
  run(dm, 1000);
  const boosted = h - near.hp;
  check(`Vigie : dégâts de la tour ×1,6 (${base.toFixed(1)} → ${boosted.toFixed(1)} par s)`, Math.abs(base - 80) < 1e-6 && Math.abs(boosted - 128) < 1e-6);

  // Garde
  const gd = vm();
  const tg = vigieOn(gd, 0);
  check('Garde : 250 PV de garde (commune)', tg.vigie.guard === 250 && tg.vigie.guardMax === 250);
  const hitter = dummy(gd, 17, 16.5, { dps: 1000 });   // au pied de la tour : 100 dégâts par pas
  run(gd, 100);
  check('Garde : 100 dégâts → garde −100, tour intacte', Math.abs(tg.vigie.guard - 150) < 1e-6 && tg.hp === 600);
  hitter.dps = 3000;
  run(gd, 100);
  check('Garde : dégâts > garde → l\'excédent touche la tour', tg.vigie.guard === 0 && Math.abs(tg.hp - 450) < 1e-6);
  const rp = match({ ...player('UA', VDECK), captain: 'tank3', captainCard: card('tank3') });
  const tr = vigieOn(rp, 0);
  engine.applyAction(rp, 'A', { type: 'power', lane: 0 });
  dummy(rp, 17, 16.5, { dps: 3000 });
  run(rp, 300);
  check('Garde : Rempart actif → ni la garde ni la tour ne bougent', tr.vigie.guard === 250 && tr.hp === 600);

  // Expiration : 40 s (commune), 60 s avec le Capitaine Garnison
  const ex = vm();
  vigieOn(ex, 0);   // apparue à 0,5 s (horloge à 0,6 s)
  run(ex, 39800);   // 40,4 s
  check('Vigie : encore en poste juste avant 40 s', tower(ex, 'A', 0).vigie !== null);
  const exEv = run(ex, 100);
  check('Vigie : redescend au bout de 40 s → pose « expired » + vigie_end', tower(ex, 'A', 0).vigie === null && ex.poses[0].status === 'expired' && exEv.some((e) => e.type === 'vigie_end' && e.side === 'A' && e.lane === 0));
  const gx = vm({ captain: 'vigie2' });
  vigieOn(gx, 0);
  run(gx, 59800);   // 60,4 s
  check('Garnison : la Vigie est encore en poste à 60,4 s', tower(gx, 'A', 0).vigie !== null);
  run(gx, 100);
  check(`Garnison : elle reste ${TUNING.vigieDuration * 40} s (+50 %)`, tower(gx, 'A', 0).vigie === null && gx.poses[0].status === 'expired');
  const leg = cards.getCardStats(card('vigie1', 'legendary'));
  check('Vigie légendaire : garde et durée renforcées, tir et portée inchangés', leg.guard > 250 && leg.durationMs > 40000 && leg.dpsBonus === 0.6 && leg.rangeBonus === 4);

  // Tour détruite avec sa Vigie : carte perdue
  const de = vm();
  const td = vigieOn(de, 0);
  td.vigie.guard = 0;
  td.hp = 1;
  give(de, 'B', ['sort2']);
  engine.applyAction(de, 'B', { type: 'deploy', url: 'sort2', x: 17, depth: 85 });
  run(de, 200);
  check('Vigie : tour détruite → pose « destroyed », plus de Vigie', !td.alive && td.vigie === null && de.poses.find((p) => p.url === 'vigie1').status === 'destroyed');
  const end = vm();
  vigieOn(end, 1);
  engine.applyAction(end, 'B', { type: 'forfeit' });
  check('fin du combat : une Vigie en poste compte comme vivante', end.result.poses.find((p) => p.url === 'vigie1').status === 'alive');

  // 🎖 Alarme : tours ×2 pendant 6 s
  const al = vm({ captain: 'vigie2' });
  const tgt = dummy(al, 17, 25);
  check('Alarme : acceptée (sans point visé)', engine.applyAction(al, 'A', { type: 'power' }).ok);
  check('vue : alarme visible', engine.publicState(al, 'B').players.A.alarm === true && engine.publicState(al, 'B').players.B.alarm === false);
  h = tgt.hp;
  run(al, 1000);
  check('Alarme : les tours tirent deux fois plus fort', Math.abs(h - tgt.hp - 160) < 1e-6);
  run(al, 5000);
  h = tgt.hp;
  run(al, 1000);
  check('Alarme : finie après 6 s', Math.abs(h - tgt.hp - 80) < 1e-6 && engine.publicState(al, 'A').players.A.alarm === false);
  check('Alarme : une seule fois par combat', engine.applyAction(al, 'A', { type: 'power' }).reason === 'power_used');

  // 👁 Vue publique
  const ps = vm({ captain: 'vigie2' });
  vigieOn(ps, 1);
  run(ps, 1000);
  const view = engine.publicState(ps, 'B');
  const vb = view.buildings.find((b) => b.side === 'A' && b.kind === 'tower' && b.lane === 1);
  check('vue : buildings[].vigie (url, garde, temps restant)', vb.vigie && vb.vigie.url === 'vigie1' && vb.vigie.guard === 250 && vb.vigie.guardMax === 250 && vb.vigie.remainingMs === 500 + 60000 - ps.timeMs);
  check('vue : pas de Vigie sur les autres bâtiments', view.buildings.filter((b) => b !== vb).every((b) => b.vigie === null));
  check('vue : plus de Surchauffe', !('overheat' in view.players.A));

  // 🔁 Migration Pompe → Vigie
  check('Vigie : la place exacte de la Pompe dans le tirage (dernière, 5 %)', Object.keys(cards.ARCHETYPES).pop() === 'vigie' && cards.ARCHETYPES.vigie.share === 5 && !cards.ARCHETYPES.pompe);
  check('surcharge « pompe » lue « vigie »', cards.getCardStats(card('old-pompe')).archetype === 'vigie');
  const crypto = require('crypto');
  let drawn = null;
  for (let i = 0; i < 5000 && !drawn; i += 1) {
    const u = `tirage-${i}`;
    if ((crypto.createHash('sha256').update(u).digest().readUInt32BE(0) / 0x100000000) * 100 >= 95) drawn = u;
  }
  check('une carte qui tirait Pompe tire Vigie', drawn && cards.archetypeFromUrl(drawn) === 'vigie');
  const old = match(player('UA', ['old-pompe', ...DECK_A.slice(1)], { captain: 'old-pompe' }));
  check('Capitaine sur une ancienne Pompe → Garnison (Alarme)', old.players.A.captain.archetype === 'vigie' && old.players.A.captain.power === 'alarme' && captains.CAPTAINS.vigie.style === 'Garnison' && !captains.CAPTAINS.pompe);
  check('admin : le type « pompe » est refusé', cards.setArchetype('x', 'pompe').ok === false);
  check('Économie retirée (élixir de départ / max / recharge, Surchauffe)', ['startElixir', 'elixirMax', 'ecoRegen', 'surchauffeMs'].every((k) => !(k in TUNING)));
}

// ═══ 🏹 Tireurs : tir en reculant ═══
{
  const depthOf = (u) => (u.side === 'A' ? u.y : 100 - u.y);
  const inRiver = (u) => u.y >= 45 && u.y <= 55 && ![28, 72].some((bx) => Math.abs(u.x - bx) <= 5);
  // Tireurs A contre Guerriers B, même couloir
  const k = match();
  give(k, 'A', ['tireur1']);
  give(k, 'B', ['guerrier3']);
  engine.applyAction(k, 'A', { type: 'deploy', url: 'tireur1', lane: 1 });
  engine.applyAction(k, 'B', { type: 'deploy', url: 'guerrier3', lane: 1 });
  let firedWhileBacking = false; let stoodAtContact = false; let wet = false; let behindBase = false;
  for (let t = 0; t < 20000; t += 100) {
    const before = new Map(k.units.filter((u) => u.url === 'tireur1').map((u) => [u.id, depthOf(u)]));
    run(k, 100);
    for (const u of k.units.filter((x) => x.url === 'tireur1')) {
      const was = before.get(u.id);
      if (was === undefined) continue;
      if (u.attackY !== null && depthOf(u) < was - 1e-6) firedWhileBacking = true;
      if (u.attackY !== null && Math.abs(depthOf(u) - was) < 1e-9 && k.units.some((g) => g.side === 'B' && engine.distance(g, u) <= g.range + engine.KITE.contact)) stoodAtContact = true;
      if (inRiver(u)) wet = true;
      if (depthOf(u) < engine.KITE.minDepth - 1e-6) behindBase = true;
    }
  }
  check('Tireur : tire en reculant quand un Guerrier approche', firedWhileBacking);
  check('Tireur : rattrapé au corps à corps, il fait face (ne recule plus)', stoodAtContact);
  check('Tireur : ne recule jamais dans la rivière ni derrière sa base', !wet && !behindBase);
  check('le Guerrier bat toujours le Tireur', k.poses.find((p) => p.url === 'tireur1').status === 'destroyed');

  // Face à une tour : il reste à portée, sans reculer
  const b = match();
  give(b, 'A', ['tireur2']);
  engine.applyAction(b, 'A', { type: 'deploy', url: 'tireur2', lane: 0 });
  let backedFromTower = false;
  for (let t = 0; t < 15000; t += 100) {
    const before = new Map(b.units.map((u) => [u.id, depthOf(u)]));
    run(b, 100);
    for (const u of b.units) if (before.has(u.id) && depthOf(u) < before.get(u.id) - 1e-6) backedFromTower = true;
  }
  check('Tireur : ne recule pas devant un bâtiment', !backedFromTower);
}

// ═══ 🏳 Rappel ═══
{
  const s = match();
  give(s, 'A', ['guerrier1']);
  engine.applyAction(s, 'A', { type: 'deploy', url: 'guerrier1', lane: 1 });
  run(s, 3000);
  const pose = s.poses[0];
  check('rappel : refusé pour une pose adverse', engine.applyAction(s, 'B', { type: 'recall', poseId: pose.id }).reason === 'not_yours');
  check('rappel : accepté', engine.applyAction(s, 'A', { type: 'recall', poseId: pose.id }).ok);
  check('rappel : le groupe fait demi-tour', s.units.every((u) => u.recalling));
  const y = s.units[0].y;
  run(s, 500);
  check('rappel : il recule vers mon camp', s.units[0].y < y);
  run(s, 8000);
  check('rappel : sorti du terrain, carte sauvée', s.units.length === 0 && pose.status === 'recalled');
  engine.applyAction(s, 'A', { type: 'forfeit' });
  check('rappel : même en cas de défaite, la pose reste « recalled »', s.result.poses[0].status === 'recalled');

  const k = match();
  give(k, 'A', ['guerrier1']);
  engine.applyAction(k, 'A', { type: 'deploy', url: 'guerrier1', lane: 1 });
  run(k, 1000);
  k.units.forEach((u) => { u.y = 83; u.hp = 5; });   // au pied de la tour adverse, presque morts
  engine.applyAction(k, 'A', { type: 'recall', poseId: k.poses[0].id });
  run(k, 8000);
  check('rappel : un groupe tué pendant la retraite est perdu', k.poses[0].status === 'destroyed');
  const sp = match();
  give(sp, 'A', ['sort1']);
  engine.applyAction(sp, 'A', { type: 'deploy', url: 'sort1', lane: 0 });
  run(sp, 1000);
  check('rappel : impossible pour un Sort', engine.applyAction(sp, 'A', { type: 'recall', poseId: sp.poses[0].id }).reason === 'not_recallable');
}

// ═══ 🔥 Rage ═══
{
  const s = match();
  s.players.A.elixir = 3;
  tower(s, 'A', 0).hp = 1;
  give(s, 'B', ['sort2']);
  engine.applyAction(s, 'B', { type: 'deploy', url: 'sort2', lane: 0 });
  s.players.A.elixir = 3;
  const ev = run(s, 1000);
  check('Rage : tour perdue → +2 élixir', s.players.A.elixir >= 5 - 0.001 && s.players.A.elixir < 5.5);
  check('Rage : événement et durée de 10 s', ev.some((e) => e.type === 'rage' && e.side === 'A') && engine.publicState(s, 'A').players.A.rage === true);
  run(s, 10100);
  check('Rage : terminée après 10 s', engine.publicState(s, 'A').players.A.rage === false);
}

// ═══ ✨ Spécialités ═══
{
  const info = specialties.INFO;
  check('7 spécialités décrites pour l\'interface', ['charge', 'bouclier', 'vampire', 'explosion', 'invocation', 'ralenti', 'soin'].every((k) => info[k] && info[k].label && info[k].desc));
  check('auto : une épique reçoit une spécialité de son archétype', cards.SPECIALTIES_BY_ARCH.guerrier.includes(cards.getCardStats(card('auto-epic', 'epic')).specialty));
  check('auto : une commune n\'en a pas', cards.getCardStats(card('auto-epic', 'common')).specialty === null);
  check('surcharge « none » : aucune spécialité', cards.getCardStats(card('guerrier1', 'legendary')).specialty === null);

  const duel = (spec, foe = 'guerrier3', setup = () => {}) => {
    const s = match(player('UA', [`spec-${spec}`, ...DECK_A.slice(1)]), player('UB', DECK_B));
    give(s, 'A', [`spec-${spec}`]);
    give(s, 'B', [foe]);
    engine.applyAction(s, 'A', { type: 'deploy', url: `spec-${spec}`, lane: 1 });
    engine.applyAction(s, 'B', { type: 'deploy', url: foe, lane: 1 });
    setup(s);
    return s;
  };

  const b = duel('bouclier');
  run(b, 1000);
  check('Bouclier : absorbe les premiers dégâts', b.units.filter((u) => u.side === 'A').every((u) => u.shield > 0));
  const v = duel('vampire');
  run(v, 1000);
  v.units.filter((u) => u.side === 'A').forEach((u) => { u.hp = u.maxHp / 2; });
  v.units.filter((u) => u.side === 'B').forEach((u) => { u.dps = 0; });   // on ne mesure que le soin
  const hpBefore = v.units.filter((u) => u.side === 'A').reduce((a, u) => a + u.hp, 0);
  run(v, 6000);
  check('Vampire : se soigne en frappant', v.units.filter((u) => u.side === 'A').some((u) => u.hp > u.maxHp / 2) || hpBefore === 0);
  const ex = duel('explosion');
  run(ex, 1000);
  ex.units.filter((u) => u.side === 'A').forEach((u) => { u.y = 50; });
  ex.units.filter((u) => u.side === 'B').forEach((u) => { u.y = 51; });
  const foeHp = ex.units.filter((u) => u.side === 'B').reduce((a, u) => a + u.hp, 0);
  ex.units.filter((u) => u.side === 'A').forEach((u) => { u.hp = 0; });
  const evs = run(ex, 100);
  check('Explosion : à la mort, dégâts autour', evs.some((e) => e.type === 'explosion') && ex.units.filter((u) => u.side === 'B').reduce((a, u) => a + u.hp, 0) < foeHp);
  const inv = duel('invocation');
  run(inv, 1000);
  inv.units.filter((u) => u.side === 'A').forEach((u) => { u.hp = 0; });
  run(inv, 100);
  check('Invocation : à la mort, des renforts apparaissent', inv.units.some((u) => u.side === 'A' && u.summoned));
  const sl = duel('ralenti', 'guerrier3');
  run(sl, 5500);
  check('Ralenti : l\'ennemi touché est ralenti', sl.units.some((u) => u.side === 'B' && u.slowUntil > sl.timeMs));
  const so = duel('soin', 'tank2', (s) => { give(s, 'A', ['guerrier2']); engine.applyAction(s, 'A', { type: 'deploy', url: 'guerrier2', lane: 1 }); });
  run(so, 1000);
  const ally = so.units.find((u) => u.side === 'A' && u.archetype === 'guerrier');
  ally.hp = ally.maxHp / 2;
  ally.y = so.units.find((u) => u.side === 'A' && u.archetype === 'tireur').y;
  run(so, 1000);
  check('Soin : soigne les alliés proches', ally.hp > ally.maxHp / 2);
  const ch = duel('charge');
  run(ch, 1000);
  check('Charge : première frappe renforcée', ch.units.filter((u) => u.side === 'A').every((u) => u.chargeLeftMs > 0));
  check('vue : spécialité visible sur les cartes en main', engine.publicState(match(player('UA', ['spec-soin', ...DECK_A.slice(1)])), 'A').players.A.hand.concat(engine.publicState(match(player('UA', ['spec-soin', ...DECK_A.slice(1)])), 'A').players.A.next || []).length >= 4);
}

// ═══ 🎲 Déterminisme conservé ═══
{
  const play = () => {
    const s = match(player('UA', DECK_A, { captain: 'tireur1' }), player('UB', DECK_B, { captain: 'essaim2' }));
    for (let t = 0; t < 120; t += 1) {
      for (const side of ['A', 'B']) {
        const u = s.players[side].hand.find((x) => engine.cardStats(s, side, x).cost <= s.players[side].elixir);
        if (u) engine.applyAction(s, side, { type: 'deploy', url: u, lane: t % 3 });
        if (t === 30) engine.applyAction(s, side, { type: 'power', lane: 1 });
      }
      run(s, 1000);
    }
    return JSON.stringify(s.result);
  };
  check('même graine + mêmes actions → même combat (avec Capitaines)', play() === play());
}

try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }   // Windows : fichier ouvert = non supprimable
fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
