#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  ⚖️ Simulation d'équilibrage de l'Arène
//
//  Utilise le VRAI moteur (src/game/engine.js) dans une copie
//  temporaire du projet (les archétypes de test sont imposés via
//  un data/card-overrides.json temporaire ; les vraies surcharges
//  sont reprises en plus, pour tester les spécialités).
//
//  1. Duels à élixir égal : une carte X (rareté R) + 1 commune
//     contre TOUTES les mains communes de même coût, posées en même
//     temps dans le même couloir, dans les deux sens.
//  2. Combats complets (2 min) entre deux bots : deck avec une carte
//     rare/épique/légendaire contre deck 100 % commun (indicatif).
//
//  3. Spécialités : une légendaire qui porte la spécialité, en duel.
//  4. Capitaines : combats complets entre BONS joueurs, deck avec Capitaine
//     (7 poses) contre deck sans Capitaine (8 poses).
//
//  Critères (code de sortie 1 si non respectés) :
//    • aucune rareté au-dessus de 70 % de victoires en duel (hors spécialité) ;
//    • chaque archétype commun entre 35 % et 65 % ;
//    • une spécialité ajoute au plus +8 pts à la même légendaire sans spécialité ;
//    • chaque Capitaine entre 40 % et 65 % en combat complet ;
//  5. Stratégie contre raretés (principe de Paul) :
//    Deck « riche » = 2 légendaires, 2 épiques, 2 rares, 2 communes
//    (spécialités automatiques comprises) :
//    • à stratégie égale (bon contre bon), le deck riche gagne PLUS de 50 % ;
//    • un bon joueur 100 % commun bat un mauvais joueur au deck riche
//      AU MOINS 60 % du temps.
//    (le deck « tout rare » 3 légendaires + 3 épiques + 2 rares est indiqué)
//
//  Usage : node scripts/simulate-balance.js [--matches 200]
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-balance-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));

const FIGHTERS = ['tank', 'guerrier', 'tireur', 'essaim'];
const ALL = [...FIGHTERS, 'sort', 'pompe'];
const RARITIES = ['common', 'rare', 'epic', 'legendary'];

// Cartes de test : `<archétype>-<n>`, archétype imposé
const realOverrides = fs.existsSync(path.join(ROOT, 'data', 'card-overrides.json'))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'card-overrides.json'), 'utf-8'))
  : {};
const overrides = { ...realOverrides };
// Rareté seule (sans spécialité) pour les tableaux 1 et 2
for (const a of ALL) for (let i = 0; i < 20; i += 1) overrides[`${a}-${i}`] = { archetype: a, specialty: 'none' };
// Cartes « réelles » (spécialité automatique des épiques / légendaires) pour le tableau 5
for (const a of ALL) for (let i = 0; i < 20; i += 1) overrides[`st-${a}-${i}`] = { archetype: a };
// Cartes porteuses d'une spécialité précise (tableau 3)
const SPEC_ARCH = { charge: 'guerrier', bouclier: 'tank', vampire: 'guerrier', explosion: 'guerrier', invocation: 'tank', ralenti: 'tireur', soin: 'tireur' };
for (const [spec, arch] of Object.entries(SPEC_ARCH)) overrides[`sp-${spec}`] = { archetype: arch, specialty: spec };
fs.writeFileSync(path.join(TMP, 'data', 'card-overrides.json'), JSON.stringify(overrides));

const engine = require(path.join(TMP, 'src', 'game', 'engine.js'));
const { getCardStats } = require(path.join(TMP, 'src', 'game', 'cards.js'));

const argMatches = process.argv.indexOf('--matches');
const MATCHES = argMatches > 0 ? parseInt(process.argv[argMatches + 1], 10) : 200;
// --only rarity | specialties | captains | skill : une seule section
const argOnly = process.argv.indexOf('--only');
const ONLY = argOnly > 0 ? process.argv[argOnly + 1] : null;
const section = (name) => !ONLY || ONLY === name;

const costOf = (arch, rarity = 'common') => getCardStats({ url: `${arch}-0`, rarity }).cost;

// ─────────────────────────────────────────────
// 1. Duels à élixir égal
// ─────────────────────────────────────────────

/** Toutes les mains communes (1 à 3 cartes) de coût total = budget, avec au moins un combattant. */
function commonHands(budget) {
  const hands = [];
  const rec = (start, hand, spent) => {
    if (spent === budget) { if (hand.some((a) => FIGHTERS.includes(a))) hands.push(hand); return; }
    if (hand.length === 3) return;
    for (let i = start; i < ALL.length; i += 1) {
      if (ALL[i] === 'pompe') continue;
      const c = costOf(ALL[i]);
      if (spent + c <= budget) rec(i, [...hand, ALL[i]], spent + c);
    }
  };
  rec(0, [], 0);
  return hands;
}

/** Duel : `handA` et `handB` = [{ arch, rarity }], posés à t=0 dans le couloir 1. → 'A' | 'B' | '=' */
function duel(handA, handB) {
  const toDeck = (hand, offset) => {
    const deck = hand.map((c, i) => ({ url: c.url || `${c.arch}-${offset + i}`, title: c.arch, rarity: c.rarity }));
    while (deck.length < 8) deck.push({ url: `guerrier-${offset + deck.length}`, title: 'pad', rarity: 'common' });
    return deck;
  };
  const deckA = toDeck(handA, 0);
  const deckB = toDeck(handB, 10);
  const copies = (deck) => Object.fromEntries(deck.map((c) => [c.url, 1]));
  const s = engine.createMatch({
    id: 'duel', seed: 1,
    players: { A: { userId: 'A', deck: deckA, copies: copies(deckA) }, B: { userId: 'B', deck: deckB, copies: copies(deckB) } },
  });
  for (const [side, hand, deck] of [['A', handA, deckA], ['B', handB, deckB]]) {
    const p = s.players[side];
    p.elixir = 100;
    hand.forEach((_, i) => {
      p.hand = [deck[i].url];
      engine.applyAction(s, side, { type: 'deploy', url: deck[i].url, lane: 1 });
    });
  }
  const alive = (side) => s.units.some((u) => u.side === side) || s.pending.some((p) => p.side === side);
  for (let t = 0; t < 400 && s.status === 'running'; t += 1) {
    engine.tick(s, 100);
    if (t > 12 && (!alive('A') || !alive('B'))) break;
  }
  const hp = (side) => s.units.filter((u) => u.side === side && !u.summoned).reduce((sum, u) => sum + u.hp / u.maxHp, 0);
  const towerDmg = (side) => s.buildings.filter((b) => b.side !== side).reduce((sum, b) => sum + (b.maxHp - b.hp), 0);
  const a = hp('A') + towerDmg('A') / 600;
  const b = hp('B') + towerDmg('B') / 600;
  if (Math.abs(a - b) < 1e-6) return '=';
  return a > b ? 'A' : 'B';
}

function duelRate(arch, rarity, url) {
  let score = 0;
  let n = 0;
  for (const mate of [...FIGHTERS, 'sort']) {
    const handA = [{ arch, rarity, url }, { arch: mate, rarity: 'common' }];
    const budget = costOf(arch, rarity) + costOf(mate);
    for (const combo of commonHands(budget)) {
      const handB = combo.map((a) => ({ arch: a, rarity: 'common' }));
      const r1 = duel(handA, handB);
      const r2 = duel(handB, handA);
      score += (r1 === 'A' ? 1 : r1 === '=' ? 0.5 : 0) + (r2 === 'B' ? 1 : r2 === '=' ? 0.5 : 0);
      n += 2;
    }
  }
  return n ? (100 * score) / n : 50;
}

// ─────────────────────────────────────────────
// 2. Combats complets entre bots
// ─────────────────────────────────────────────

function lcg(seed) {
  let x = seed >>> 0;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
}

/** Bot simple : défend le couloir menacé, sinon pousse au hasard ; pouvoir du Capitaine au milieu du combat. */
function botAct(s, side, rand) {
  const p = s.players[side];
  if (p.captain && !p.captain.used && s.timeMs > 25000 && rand() < 0.05) {
    const foe = side === 'A' ? 'B' : 'A';
    const count = [0, 1, 2].map((l) => s.units.filter((u) => u.side === foe && u.lane === l).length);
    const mine = [0, 1, 2].map((l) => s.units.filter((u) => u.side === side && u.lane === l).length);
    const useMine = p.captain.power === 'charge' || p.captain.power === 'renforts';
    const pick = (arr) => arr.indexOf(Math.max(...arr));
    engine.applyAction(s, side, { type: 'power', lane: useMine ? pick(mine) : pick(count) });
  }
  const playable = p.hand.filter((u) => engine.cardStats(s, side, u).cost <= p.elixir);
  if (!playable.length || rand() < 0.5) return;
  const url = playable[Math.floor(rand() * playable.length)];
  const foe = side === 'A' ? 'B' : 'A';
  const threat = s.units.filter((u) => u.side === foe)
    .sort((x, y) => (side === 'A' ? x.y - y.y : y.y - x.y))[0];
  const lane = threat ? threat.lane : Math.floor(rand() * 3);
  engine.applyAction(s, side, { type: 'deploy', url, lane });
}

function fullMatchRate(rarity) {
  let score = 0;
  for (let m = 0; m < MATCHES; m += 1) {
    const rand = lcg(1000 + m);
    const archs = ALL.slice();
    // 8 cartes : les 6 archétypes + guerrier + tireur
    const base = [...archs, 'guerrier', 'tireur'];
    const starIdx = m % 4;      // la carte « rare+ » tourne sur les combattants
    const deckA = base.map((a, i) => ({ url: `${a}-${i}`, title: a, rarity: i === starIdx ? rarity : 'common' }));
    const deckB = base.map((a, i) => ({ url: `${a}-${10 + i}`, title: a, rarity: 'common' }));
    const copies = (deck) => Object.fromEntries(deck.map((c) => [c.url, 3]));
    const sideOfStar = m % 2 === 0 ? 'A' : 'B';
    const s = engine.createMatch({
      id: `m${m}`, seed: 5000 + m,
      players: sideOfStar === 'A'
        ? { A: { userId: 'A', deck: deckA, copies: copies(deckA) }, B: { userId: 'B', deck: deckB, copies: copies(deckB) } }
        : { A: { userId: 'A', deck: deckB, copies: copies(deckB) }, B: { userId: 'B', deck: deckA, copies: copies(deckA) } },
    });
    while (s.status === 'running') {
      botAct(s, 'A', rand);
      botAct(s, 'B', rand);
      engine.tick(s, 500);
    }
    const w = s.result.winner;
    score += w === sideOfStar ? 1 : w === null ? 0.5 : 0;
  }
  return (100 * score) / MATCHES;
}

/** Combats complets : deck avec Capitaine `arch` contre deck sans Capitaine. */
function captainRate(arch) {
  let score = 0;
  for (let m = 0; m < MATCHES; m += 1) {
    const rand = lcg(7000 + m);
    const base = [...ALL, 'guerrier', 'tireur'];
    // Un joueur qui choisit ce Capitaine garde une autre carte de l'archétype
    // dans son deck (sinon le passif ne s'applique à rien)
    const capBase = base.slice();
    if (base.filter((x) => x === arch).length < 2 && arch !== 'pompe') capBase[6] = arch;
    const deckA = capBase.map((a, i) => ({ url: `${a}-${i}`, title: a, rarity: 'common' }));
    const deckB = base.map((a, i) => ({ url: `${a}-${10 + i}`, title: a, rarity: 'common' }));
    const copies = (deck) => Object.fromEntries(deck.map((c) => [c.url, 3]));
    const captain = `${arch}-${capBase.indexOf(arch)}`;
    const capSide = m % 2 === 0 ? 'A' : 'B';
    const withCap = { userId: 'C', deck: deckA, copies: copies(deckA), captain };
    const without = { userId: 'N', deck: deckB, copies: copies(deckB) };
    const s = engine.createMatch({ id: `c${m}`, seed: 9000 + m, players: capSide === 'A' ? { A: withCap, B: without } : { A: without, B: withCap } });
    while (s.status === 'running') {
      goodAct(s, 'A', rand);   // bon joueur des deux côtés : un style de jeu se juge bien joué
      goodAct(s, 'B', rand);
      engine.tick(s, 500);
    }
    const w = s.result.winner;
    score += w === capSide ? 1 : w === null ? 0.5 : 0;
  }
  return (100 * score) / MATCHES;
}

// ─────────────────────────────────────────────
// 🧠 Joueurs de niveaux différents
//    Bon : garde l'élixir pour des poussées groupées (Tank devant,
//          soutien derrière, dans le couloir à la tour la plus faible),
//          défend la menace avec la carte qui la contre, Sort sur les
//          paquets, pouvoir du Capitaine au bon moment.
//    Mauvais : pose n'importe quoi, n'importe où, dès qu'il peut.
// ─────────────────────────────────────────────

const COUNTER_OF = { guerrier: 'tank', tireur: 'guerrier', essaim: 'tireur', tank: 'essaim' };   // menace → ce qui la bat

function goodAct(s, side, rand) {
  const p = s.players[side];
  const foe = side === 'A' ? 'B' : 'A';
  const mineY = (y) => (side === 'A' ? y : 100 - y);   // 0 = chez moi
  const arch = (u) => engine.cardStats(s, side, u).archetype;
  const cost = (u) => engine.cardStats(s, side, u).cost;
  const hand = p.hand.slice();
  const can = (u) => cost(u) <= p.elixir;

  // 🛡 Défense : ennemis dans ma moitié
  const threats = s.units.filter((u) => u.side === foe && mineY(u.y) < 45 && !u.recalling);
  if (threats.length) {
    const lanes = [0, 1, 2].map((l) => threats.filter((u) => u.lane === l).length);
    const lane = lanes.indexOf(Math.max(...lanes));
    const inLane = threats.filter((u) => u.lane === lane);
    const main = inLane[0].archetype;
    if (p.captain && !p.captain.used && ['salve', 'gel', 'rempart'].includes(p.captain.power) && inLane.length >= 2) {
      // pouvoir au point du groupe menaçant (terrain ouvert : une zone, plus une colonne)
      const cx = inLane.reduce((a, u) => a + u.x, 0) / inLane.length;
      const cy = inLane.reduce((a, u) => a + mineY(u.y), 0) / inLane.length;
      engine.applyAction(s, side, { type: 'power', x: cx, depth: cy });
      return;
    }
    const pick = (inLane.length >= 3 && hand.find((u) => arch(u) === 'sort' && can(u)))
      || hand.find((u) => arch(u) === COUNTER_OF[main] && can(u))
      || hand.find((u) => ['guerrier', 'tireur', 'essaim'].includes(arch(u)) && can(u));
    if (pick) engine.applyAction(s, side, { type: 'deploy', url: pick, lane });
    return;
  }

  // 🎖 Surchauffe quand l'élixir est bas (sinon elle est gâchée)
  if (p.captain && !p.captain.used && p.captain.power === 'surchauffe' && p.elixir < 3 && s.timeMs > 10000) {
    engine.applyAction(s, side, { type: 'power' });
  }

  // ⚗️ Économie tôt : Pompe si calme
  const pompe = hand.find((u) => arch(u) === 'pompe' && can(u));
  if (pompe && s.timeMs < 60000) {
    engine.applyAction(s, side, { type: 'deploy', url: pompe, lane: Math.floor(rand() * 3) });
    return;
  }

  // 💥 Sort offensif : achever une tour, ou nettoyer les défenseurs d'une poussée
  const spell = hand.find((u) => arch(u) === 'sort' && can(u));
  if (spell) {
    const dmg = engine.cardStats(s, side, spell).damage;
    const weak = [0, 1, 2].find((l) => {
      const t = s.buildings.find((b) => b.side === foe && b.kind === 'tower' && b.lane === l);
      return t.alive && t.hp <= dmg * 0.4 && !s.units.some((u) => u.side === foe && u.lane === l);
    });
    if (weak !== undefined) { engine.applyAction(s, side, { type: 'deploy', url: spell, lane: weak }); return; }
    const mine2 = s.units.filter((u) => u.side === side && mineY(u.y) > 45);
    for (let l = 0; l < 3; l += 1) {
      const defenders = s.units.filter((u) => u.side === foe && u.lane === l);
      if (mine2.some((u) => u.lane === l) && defenders.length >= 2) {
        engine.applyAction(s, side, { type: 'deploy', url: spell, lane: l });
        return;
      }
    }
  }

  // ⚔️ Contre-attaque : mes survivants avancent → je les soutiens
  const pushing = s.units.filter((u) => u.side === side && !u.recalling && mineY(u.y) > 45);
  if (pushing.length >= 2) {
    const lanes = [0, 1, 2].map((l) => pushing.filter((u) => u.lane === l).length);
    const lane = lanes.indexOf(Math.max(...lanes));
    const sup = hand.find((u) => arch(u) === 'tireur' && can(u)) || hand.find((u) => arch(u) === 'guerrier' && can(u));
    if (sup && p.elixir >= 6) { engine.applyAction(s, side, { type: 'deploy', url: sup, lane }); return; }
  }

  // ⚔️ Poussée groupée : Tank + soutien d'un coup (sinon on patiente)
  const max = p.captain && p.captain.archetype === 'pompe' ? 12 : 10;
  if (p.elixir < max - 1.5) return;
  const towers = [0, 1, 2].map((l) => {
    const t = s.buildings.find((b) => b.side === foe && b.kind === 'tower' && b.lane === l);
    return t.alive ? t.hp : -1;
  });
  const alive = towers.map((hp, l) => [hp, l]).filter(([hp]) => hp >= 0);
  const lane = alive.length ? alive.sort((a, b) => a[0] - b[0])[0][1] : 1;
  const tank = hand.find((u) => arch(u) === 'tank' && can(u));
  const lead = tank || hand.find((u) => ['guerrier', 'essaim'].includes(arch(u)) && can(u));
  if (!lead) return;
  engine.applyAction(s, side, { type: 'deploy', url: lead, lane });
  const support = p.hand.find((u) => ['tireur', 'guerrier'].includes(arch(u)) && can(u));
  if (support) engine.applyAction(s, side, { type: 'deploy', url: support, lane });
  if (p.captain && !p.captain.used && ['charge', 'renforts'].includes(p.captain.power)) {
    engine.applyAction(s, side, { type: 'power', lane });
  }
}

function badAct(s, side, rand) {
  const p = s.players[side];
  const playable = p.hand.filter((u) => engine.cardStats(s, side, u).cost <= p.elixir);
  if (!playable.length) return;
  engine.applyAction(s, side, { type: 'deploy', url: playable[Math.floor(rand() * playable.length)], lane: Math.floor(rand() * 3) });
}

/** % de victoires du joueur 1 contre le joueur 2. deck : 'common', 'rich' (2 L, 2 É, 2 R, 2 C) ou 'star' (3 L, 3 É, 2 R). */
function skillRate(level1, deck1, level2, deck2) {
  const base = [...ALL, 'guerrier', 'tireur'];
  const DECKS = {
    star: ['legendary', 'legendary', 'legendary', 'epic', 'epic', 'epic', 'rare', 'rare'],
    rich: ['legendary', 'epic', 'legendary', 'epic', 'common', 'common', 'rare', 'rare'],
  };
  // Cartes « réelles » : les épiques / légendaires ont leur spécialité automatique
  const make = (kind, off) => base.map((a, i) => ({ url: `st-${a}-${off + i}`, title: a, rarity: DECKS[kind] ? DECKS[kind][i] : 'common' }));
  const act = { good: goodAct, bad: badAct };
  let score = 0;
  for (let m = 0; m < MATCHES; m += 1) {
    const rand = lcg(20000 + m);
    const d1 = make(deck1, 0);
    const d2 = make(deck2, 10);
    const copies = (deck) => Object.fromEntries(deck.map((c) => [c.url, 1]));
    const oneIsA = m % 2 === 0;
    const P1 = { userId: '1', deck: d1, copies: copies(d1) };
    const P2 = { userId: '2', deck: d2, copies: copies(d2) };
    const s = engine.createMatch({ id: `k${m}`, seed: 30000 + m, players: oneIsA ? { A: P1, B: P2 } : { A: P2, B: P1 } });
    const s1 = oneIsA ? 'A' : 'B';
    const s2 = oneIsA ? 'B' : 'A';
    while (s.status === 'running') {
      act[level1](s, s1, rand);
      act[level2](s, s2, rand);
      engine.tick(s, 500);
    }
    const w = s.result.winner;
    score += w === s1 ? 1 : w === null ? 0.5 : 0;
  }
  return (100 * score) / MATCHES;
}

// ─────────────────────────────────────────────
// 📋 Rapport
// ─────────────────────────────────────────────

let failures = 0;
const pct = (x) => `${x.toFixed(0).padStart(3)} %`;

if (section('rarity')) {
console.log('⚔️  Duels à élixir égal (carte + 1 commune contre toutes les mains communes de même coût)\n');
console.log(`${'rareté'.padEnd(11)}${FIGHTERS.map((a) => a.padStart(10)).join('')}   moyenne`);
for (const rarity of RARITIES) {
  const rates = FIGHTERS.map((a) => duelRate(a, rarity));
  const avg = rates.reduce((s, x) => s + x, 0) / rates.length;
  let flag = '';
  if (rarity === 'common') {
    const bad = FIGHTERS.filter((a, i) => rates[i] < 35 || rates[i] > 65);
    if (bad.length) { failures += 1; flag = `  ❌ hors [35 %, 65 %] : ${bad.join(', ')}`; }
  } else if (avg > 70) {
    failures += 1;
    flag = '  ❌ > 70 %';
  }
  console.log(`${rarity.padEnd(11)}${rates.map((r) => pct(r).padStart(10)).join('')}   ${pct(avg)}${flag}`);
}

console.log(`\n🤖 Combats complets de 2 min entre bots (${MATCHES} par rareté, indicatif)\n`);
for (const rarity of RARITIES.slice(1)) {
  console.log(`deck avec 1 ${rarity.padEnd(10)} contre deck commun : ${pct(fullMatchRate(rarity))} de victoires`);
}

}

if (section('specialties')) {
console.log('\n✨ Spécialités : une LÉGENDAIRE qui la porte, en duel à élixir égal (gain vs la même sans spécialité)\n');
for (const [spec, arch] of Object.entries(SPEC_ARCH)) {
  const rate = duelRate(arch, 'legendary', `sp-${spec}`);
  const gain = rate - duelRate(arch, 'legendary');
  const bad = gain > 8;
  if (bad) failures += 1;
  console.log(`${spec.padEnd(11)} (${arch.padEnd(8)}) ${pct(rate)}  ${gain >= 0 ? '+' : ''}${gain.toFixed(0)} pts${bad ? '  ❌ > +8 pts' : ''}`);
}

}

if (section('captains')) {
console.log(`\n🎖 Capitaines : deck avec Capitaine (7 poses) contre deck sans (8 poses), ${MATCHES} combats\n`);
for (const arch of ALL) {
  const rate = captainRate(arch);
  const bad = rate < 40 || rate > 65;
  if (bad) failures += 1;
  console.log(`${arch.padEnd(10)} ${pct(rate)}${bad ? '  ❌ hors [40 %, 65 %]' : ''}`);
}

}

if (section('skill')) {
console.log(`\n🧠 Stratégie contre raretés (${MATCHES} combats par ligne)\n`);
console.log(`écart de niveau pur : bon joueur commun contre mauvais joueur commun : ${pct(skillRate('good', 'common', 'bad', 'common'))} pour le bon joueur (indicatif)`);
const equal = skillRate('good', 'common', 'good', 'rich');
const skill = skillRate('good', 'common', 'bad', 'rich');
const eqBad = 100 - equal <= 50;   // les raretés doivent l'emporter à stratégie égale
const skBad = skill < 60;
if (eqBad) failures += 1;
if (skBad) failures += 1;
console.log(`à stratégie égale : bon commun contre bon deck riche       → ${pct(100 - equal)} pour le deck riche${eqBad ? '  ❌ doit être > 50 %' : ''}`);
console.log(`la stratégie paie : bon commun contre mauvais deck riche    → ${pct(skill)} pour le bon joueur${skBad ? '  ❌ < 60 %' : ''}`);
console.log(`(indicatif) bon commun contre mauvais deck « tout rare »    → ${pct(skillRate('good', 'common', 'bad', 'star'))} pour le bon joueur`);

}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ Équilibrage hors critères (${failures})` : '\n✅ Équilibrage dans les critères');
process.exit(failures ? 1 : 0);
