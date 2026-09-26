#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test de l'envoi différentiel des états (public/arena-wire.js)
//
//  Un combat complet entre bots : chaque état est encodé côté serveur
//  puis décodé côté « navigateur ». L'état reconstruit doit être
//  IDENTIQUE à l'état allégé du serveur, à chaque pas ; et le volume
//  doit fortement baisser.
//
//  Usage : node scripts/test-arena-wire.js
// ═══════════════════════════════════════════════════════════
const path = require('path');

const origLog = console.log;
console.log = () => {};
const media = require('../src/media');
const engine = require('../src/game/engine');
const { compact } = require('../src/game/arenaWeb');
const wire = require('../public/arena-wire.js');
console.log = origLog;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

// Égalité profonde, sans tenir compte de l'ordre des clés
function same(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => same(a[k], b[k]));
}

const bank = media.getAllMedia();
const deckA = bank.slice(0, 8);
const deckB = bank.slice(8, 16);
const toDeck = (c) => c.map((m) => ({ url: m.url, title: m.title, rarity: m.rarity }));
const copies = (c) => Object.fromEntries(c.map((m) => [m.url, 3]));
const keyOf = {};
[...deckA, ...deckB].forEach((m, i) => { keyOf[m.url] = `c${i}`; });

let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

for (const viewer of ['A', 'B']) {
  const s = engine.createMatch({
    id: 'w', seed: 11,
    players: { A: { userId: 'UA', deck: toDeck(deckA), copies: copies(deckA) }, B: { userId: 'UB', deck: toDeck(deckB), copies: copies(deckB) } },
  });
  const enc = wire.createEncoder();
  const dec = wire.createDecoder();
  let mismatch = 0;
  let firstBad = null;
  let full = 0;
  let sent = 0;
  let n = 0;
  while (s.status === 'running') {
    for (const side of ['A', 'B']) {
      const p = s.players[side];
      const u = p.hand.find((x) => engine.cardStats(s, side, x).cost <= p.elixir);
      if (u && rnd() < 0.08) engine.applyAction(s, side, { type: 'deploy', url: u, lane: Math.floor(rnd() * 3) });
    }
    const events = engine.tick(s, 100);
    const view = compact({ matchId: 'w', you: viewer, opponent: 'X', arena: 'port', phase: 'running', ...engine.publicState(s, viewer), events }, keyOf);
    const packet = enc.encode(view);
    const text = JSON.stringify(packet);
    const back = dec.decode(JSON.parse(text));
    if (!same(back, view)) {
      mismatch += 1;
      if (!firstBad) firstBad = { n, back, view };
    }
    full += JSON.stringify(view).length;
    sent += text.length;
    n += 1;
  }
  check(`vue ${viewer} : ${n} états reconstruits à l'identique côté navigateur`, mismatch === 0);
  if (firstBad) console.log('   1er écart au pas', firstBad.n);
  const gain = 1 - sent / full;
  check(`vue ${viewer} : volume divisé (${Math.round(full / n)} → ${Math.round(sent / n)} o par état, −${Math.round(gain * 100)} %)`, gain >= 0.6);
}

// Les autres phases passent telles quelles ; un nouveau décodeur repart de zéro
const enc = wire.createEncoder();
const dec = wire.createDecoder();
const prep = { phase: 'preparing', you: 'A', deadline: 1, ready: { you: false, opponent: false } };
check('préparation : transmise telle quelle', same(dec.decode(JSON.parse(JSON.stringify(enc.encode(prep)))), prep));
check('reset : l\'encodeur renvoie tout après une reconnexion', (() => {
  const e = wire.createEncoder();
  const v = { phase: 'running', you: 'A', players: { A: { hand: [], next: null, elixir: 1 }, B: { elixir: 1 } }, units: [{ id: 1, y: 2, hp: 3, side: 'A', lane: 0, maxHp: 3, archetype: 'guerrier', url: 'c0', slot: 0, packSize: 3 }], buildings: [], pending: [], events: [] };
  e.encode(v);
  e.reset();
  return JSON.stringify(e.encode(v)).includes('guerrier');
})());

console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
