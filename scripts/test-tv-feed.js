#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test du choix du combat à l'antenne de JP TV (src/game/tvFeed.js)
//  Logique pure : aucune copie du projet nécessaire.
//  Usage : node scripts/test-tv-feed.js
// ═══════════════════════════════════════════════════════════
const path = require('path');
const tvFeed = require(path.join(__dirname, '..', 'src', 'game', 'tvFeed.js'));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const S = 1000;
const NOW = 1_000_000;
const m = (id, status, startedAt, extra = {}) => ({ id, status, startedAt, endedAt: null, broadcast: true, arena: 'jardin', players: { A: `${id}A`, B: `${id}B` }, ...extra });

check('aucun combat → rien à l\'antenne', tvFeed.pickFeatured(null, [], NOW).featuredId === null && !tvFeed.isOnAir([], NOW));

const one = [m('m1', 'running', NOW - 30 * S)];
check('un combat en cours → à l\'antenne', tvFeed.pickFeatured(null, one, NOW).featuredId === 'm1' && tvFeed.isOnAir(one, NOW));

const notBroadcast = [m('m1', 'running', NOW - 30 * S, { broadcast: false })];
check('refus de diffusion → jamais à l\'antenne', tvFeed.pickFeatured(null, notBroadcast, NOW).featuredId === null && !tvFeed.isOnAir(notBroadcast, NOW));

const two = [m('m2', 'running', NOW - 10 * S), m('m1', 'running', NOW - 30 * S)];
const p2 = tvFeed.pickFeatured(null, two, NOW);
check('deux combats → le premier lancé à l\'antenne', p2.featuredId === 'm1');
check('deux combats → l\'autre dans « Aussi en direct »', p2.also.join() === 'm2');

const keep = tvFeed.pickFeatured('m2', two, NOW);
check('le combat déjà à l\'antenne y reste', keep.featuredId === 'm2' && keep.also.join() === 'm1');

const endedHold = [m('m1', 'ended', NOW - 90 * S, { endedAt: NOW - 3 * S }), m('m2', 'running', NOW - 10 * S)];
const hold = tvFeed.pickFeatured('m1', endedHold, NOW);
check('écran de fin : le combat fini reste 10 s', hold.featuredId === 'm1' && hold.also.join() === 'm2');
check('écran de fin : toujours « à l\'antenne »', tvFeed.isOnAir([endedHold[0]], NOW));

const after = tvFeed.pickFeatured('m1', endedHold, NOW + 8 * S);
check('après l\'écran de fin → bascule sur le combat suivant', after.featuredId === 'm2' && after.also.length === 0);

const lateTv = tvFeed.pickFeatured(null, [endedHold[0]], NOW);
check('un combat déjà fini n\'est jamais pris en cours de route', lateTv.featuredId === null);

const cancelled = [m('m1', 'cancelled', NOW - 50 * S, { endedAt: NOW - 2 * S })];
check('combat annulé en cours de route : écran de fin aussi', tvFeed.pickFeatured('m1', cancelled, NOW).featuredId === 'm1');

const vanished = tvFeed.pickFeatured('m1', [], NOW);
check('combat disparu (redémarrage du bot) → plus rien à l\'antenne', vanished.featuredId === null && !tvFeed.isOnAir([], NOW));

const old = [m('m1', 'ended', NOW - 200 * S, { endedAt: NOW - 11 * S })];
check('fini depuis plus de 10 s → plus à l\'antenne', !tvFeed.isOnAir(old, NOW) && tvFeed.pickFeatured('m1', old, NOW).featuredId === null);

console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
