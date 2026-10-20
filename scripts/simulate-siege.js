#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🏰 Banc d'essai « siège » de l'Arène (v3.5)
//
//  Complète simulate-balance.js sur deux questions précises :
//  1. Siège : une carte commune posée seule face à une tour sans défense
//     de troupes → dégâts aux bâtiments en 40 s, temps pour abattre la
//     tour, et dégâts ramenés à l'élixir.
//  2. Face-à-face : chaque combattant commun contre chaque autre, à élixir
//     égal (2 cartes de 3 contre 1 Tank + 1 de… non : une carte contre une
//     carte, posées en même temps dans le même couloir) → qui survit, en
//     combien de temps, et ce qu'il reste au vainqueur.
//
//  Usage : node scripts/simulate-siege.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-siege-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.mkdirSync(path.join(TMP, 'data'));

const FIGHTERS = ['tank', 'guerrier', 'tireur', 'essaim'];
const overrides = {};
for (const a of [...FIGHTERS, 'sort']) for (let i = 0; i < 20; i += 1) overrides[`${a}-${i}`] = { archetype: a, specialty: 'none' };
fs.writeFileSync(path.join(TMP, 'data', 'card-overrides.json'), JSON.stringify(overrides));

const engine = require(path.join(TMP, 'src', 'game', 'engine.js'));
const { getCardStats } = require(path.join(TMP, 'src', 'game', 'cards.js'));
const costOf = (arch) => getCardStats({ url: `${arch}-0`, rarity: 'common' }).cost;

function setup(handA, handB) {
  const toDeck = (hand, offset) => {
    const deck = hand.map((a, i) => ({ url: `${a}-${offset + i}`, title: a, rarity: 'common' }));
    while (deck.length < 8) deck.push({ url: `guerrier-${offset + deck.length}`, title: 'pad', rarity: 'common' });
    return deck;
  };
  const deckA = toDeck(handA, 0);
  const deckB = toDeck(handB, 10);
  const copies = (deck) => Object.fromEntries(deck.map((c) => [c.url, 1]));
  const s = engine.createMatch({
    id: 'siege', seed: 1,
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
  return s;
}

// 1. Siège
const pad = (x, n) => String(x).padEnd(n);
console.log('\n🏰 1. Siège : une carte commune seule contre une tour (40 s)');
console.log(`   ${pad('carte', 10)}${pad('coût', 6)}${pad('dégâts', 9)}${pad('/élixir', 9)}tour abattue`);
for (const arch of FIGHTERS) {
  const s = setup([arch], []);
  const dmg = () => s.buildings.filter((b) => b.side === 'B').reduce((sum, b) => sum + (b.maxHp - Math.max(0, b.hp)), 0);
  let fell = null;
  for (let t = 1; t <= 400 && s.status === 'running'; t += 1) {
    engine.tick(s, 100);
    if (fell === null && s.buildings.some((b) => b.side === 'B' && b.kind === 'tower' && !b.alive)) fell = t / 10;
  }
  const d = Math.round(dmg());
  console.log(`   ${pad(arch, 10)}${pad(costOf(arch), 6)}${pad(d, 9)}${pad(Math.round(d / costOf(arch)), 9)}${fell === null ? 'non' : `oui, à ${fell} s`}`);
}

// 2. Face-à-face (une carte contre une carte, hors tours : on s'arrête quand un camp n'a plus de troupes)
console.log('\n⚔️ 2. Face-à-face : carte contre carte (communes), PV restants du vainqueur');
for (const a of FIGHTERS) {
  for (const b of FIGHTERS) {
    if (a >= b) continue;
    const s = setup([a], [b]);
    const alive = (side) => s.units.some((u) => u.side === side) || s.pending.some((p) => p.side === side);
    let t = 0;
    for (; t < 400 && s.status === 'running'; t += 1) {
      engine.tick(s, 100);
      if (t > 12 && (!alive('A') || !alive('B'))) break;
    }
    const left = (side) => s.units.filter((u) => u.side === side && !u.summoned);
    const hpPct = (side) => {
      const us = left(side);
      return us.length ? Math.round((100 * us.reduce((x, u) => x + u.hp, 0)) / us.reduce((x, u) => x + u.maxHp, 0)) : 0;
    };
    const winner = alive('A') && !alive('B') ? a : alive('B') && !alive('A') ? b : '—';
    const side = winner === a ? 'A' : winner === b ? 'B' : null;
    console.log(`   ${pad(`${a} (${costOf(a)})`, 14)} vs ${pad(`${b} (${costOf(b)})`, 14)} → ${pad(winner, 10)} en ${(t / 10).toFixed(1)} s${side ? `, ${left(side).length} perso(s) à ${hpPct(side)} % de PV` : ''}`);
  }
}

fs.rmSync(TMP, { recursive: true, force: true });
