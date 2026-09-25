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
//  Critères (code de sortie 1 si non respectés) :
//    • aucune rareté au-dessus de 70 % de victoires en duel ;
//    • chaque archétype commun entre 35 % et 65 %.
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
for (const a of ALL) for (let i = 0; i < 20; i += 1) overrides[`${a}-${i}`] = { archetype: a };
fs.writeFileSync(path.join(TMP, 'data', 'card-overrides.json'), JSON.stringify(overrides));

const engine = require(path.join(TMP, 'src', 'game', 'engine.js'));
const { getCardStats } = require(path.join(TMP, 'src', 'game', 'cards.js'));

const argMatches = process.argv.indexOf('--matches');
const MATCHES = argMatches > 0 ? parseInt(process.argv[argMatches + 1], 10) : 200;

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
    const deck = hand.map((c, i) => ({ url: `${c.arch}-${offset + i}`, title: c.arch, rarity: c.rarity }));
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
  const hp = (side) => s.units.filter((u) => u.side === side).reduce((sum, u) => sum + u.hp / u.maxHp, 0);
  const towerDmg = (side) => s.buildings.filter((b) => b.side !== side).reduce((sum, b) => sum + (b.maxHp - b.hp), 0);
  const a = hp('A') + towerDmg('A') / 600;
  const b = hp('B') + towerDmg('B') / 600;
  if (Math.abs(a - b) < 1e-6) return '=';
  return a > b ? 'A' : 'B';
}

function duelRate(arch, rarity) {
  let score = 0;
  let n = 0;
  for (const mate of [...FIGHTERS, 'sort']) {
    const handA = [{ arch, rarity }, { arch: mate, rarity: 'common' }];
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

/** Bot simple : défend le couloir menacé, sinon pousse au hasard. */
function botAct(s, side, rand) {
  const p = s.players[side];
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

// ─────────────────────────────────────────────
// 📋 Rapport
// ─────────────────────────────────────────────

let failures = 0;
const pct = (x) => `${x.toFixed(0).padStart(3)} %`;

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

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ Équilibrage hors critères (${failures})` : '\n✅ Équilibrage dans les critères');
process.exit(failures ? 1 : 0);
