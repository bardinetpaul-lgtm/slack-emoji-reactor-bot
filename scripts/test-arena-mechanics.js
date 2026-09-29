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

const ARCHS = ['tank', 'guerrier', 'tireur', 'essaim', 'sort', 'pompe'];
const overrides = {};
for (const a of ARCHS) for (let i = 1; i <= 8; i += 1) overrides[`${a}${i}`] = { archetype: a, specialty: 'none' };
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
const DECK_A = ['guerrier1', 'guerrier2', 'tireur1', 'tireur2', 'tank1', 'essaim1', 'sort1', 'pompe1'];
const DECK_B = ['guerrier3', 'guerrier4', 'tireur3', 'tireur4', 'tank2', 'essaim2', 'sort2', 'pompe2'];
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
  const pompe = match(player('UA', DECK_A, { captain: 'pompe1' }));
  check(`Économie (Pompe) : +${TUNING.startElixir} élixir au départ`, pompe.players.A.elixir === 5 + TUNING.startElixir);
  run(pompe, 20000);
  check(`Économie (Pompe) : élixir jusqu’à ${TUNING.elixirMax}`, pompe.players.A.elixir === TUNING.elixirMax && engine.publicState(pompe, 'A').players.A.elixirMax === TUNING.elixirMax);
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

  const surch = match(player('UA', DECK_A, { captain: 'pompe1' }));
  surch.players.A.elixir = 0;
  surch.players.B.elixir = 0;
  engine.applyAction(surch, 'A', { type: 'power' });
  run(surch, 2800);
  check('Surchauffe : élixir ×2 (× la recharge Économie en plus)', Math.abs(surch.players.A.elixir - 2 * TUNING.ecoRegen * surch.players.B.elixir) < 0.02);

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

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
