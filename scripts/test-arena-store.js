#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test du stockage de l'Arène (src/game/arenaStore.js)
//     + retrait de cartes (collections.removeCards)
//
//  Travaille dans une COPIE temporaire du projet. Simule des
//  redémarrages (modules rechargés) : tout doit survivre.
//
//  Usage : node scripts/test-arena-store.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-arena-store-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.mkdirSync(path.join(TMP, 'data'));
const STORE = path.join(TMP, 'src', 'game', 'arenaStore.js');
const COLL = path.join(TMP, 'src', 'collections.js');

function restart() {
  delete require.cache[require.resolve(STORE)];
  delete require.cache[require.resolve(COLL)];
  return { store: require(STORE), collections: require(COLL) };
}

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

let { store, collections } = restart();

// ➖ removeCards
collections.addCards('UA', [
  { url: 'a', title: 'A', rarity: 'common', type: 'image' },
  { url: 'a', title: 'A', rarity: 'common', type: 'image' },
  { url: 'b', title: 'B', rarity: 'rare', type: 'image' },
]);
const after = collections.removeCards('UA', ['a', 'b', 'zzz']);
check('removeCards : compteurs après retrait', JSON.stringify(after) === JSON.stringify([1, 0, 0]));
check('removeCards : carte à 0 retirée du classeur', !collections.getCollection('UA').some((c) => c.url === 'b'));
check('removeCards : doublon → il en reste 1', collections.getCount('UA', 'a') === 1);
collections.removeCards('UA', ['a', 'a']);
check('removeCards : jamais sous 0', collections.getCount('UA', 'a') === 0);
check('removeCards : user inconnu sans erreur', JSON.stringify(collections.removeCards('NOPE', ['a'])) === '[0]');

// 🃏 Decks
store.setDeck('UA', ['1', '2', '3', '4', '5', '6', '7', '8']);
({ store, collections } = restart());
check('deck sauvegardé et relu après redémarrage', store.getDeck('UA').length === 8);
check('pas de deck → null', store.getDeck('UB') === null);

// 📊 Stats
const T0 = Date.UTC(2026, 8, 25, 10, 0);
const DAY = 24 * 3600 * 1000;
store.recordResult({ matchId: 'm1', at: T0, winnerId: 'UA', loserId: 'UB', draw: false, loot: { url: 'x', title: 'X', rarity: 'rare' } });
store.recordResult({ matchId: 'm2', at: T0 + 1, winnerId: 'UA', loserId: 'UB', draw: false, loot: { url: 'y', title: 'Y', rarity: 'common' } });
store.recordResult({ matchId: 'm3', at: T0 + 2, winnerId: null, loserId: null, draw: true, players: ['UA', 'UB'] });
({ store, collections } = restart());
const sa = store.getStats('UA');
const sb = store.getStats('UB');
check('stats vainqueur : 2 V, 1 N', sa.wins === 2 && sa.draws === 1 && sa.losses === 0);
check('stats perdant : 2 D, 1 N', sb.losses === 2 && sb.draws === 1);
check('série remise à 0 par le nul', sa.streak === 0 && sa.bestStreak === 2);
check('meilleur butin = la plus rare', sa.bestLoot && sa.bestLoot.url === 'x');
check('stats d\'un inconnu = zéros', store.getStats('UZ').wins === 0);

// 🏆 Top de la semaine (glissant 7 jours)
store.recordResult({ matchId: 'old', at: T0 - 8 * DAY, winnerId: 'UC', loserId: 'UA', draw: false });
store.recordResult({ matchId: 'm4', at: T0 + 3, winnerId: 'UB', loserId: 'UA', draw: false });
const top = store.weeklyTop(T0 + 10, 5);
check('top : UA en tête avec 2 victoires', top[0].userId === 'UA' && top[0].wins === 2);
check('top : victoire de plus de 7 jours ignorée', !top.some((t) => t.userId === 'UC'));

// 💰 Plafonds de récompense
let n = 0;
for (let i = 0; i < 3; i += 1) if (store.consumeReward('UW', 'UL1', T0)) n += 1;
check('max 2 victoires récompensées contre le même adversaire', n === 2);
for (const l of ['UL2', 'UL3', 'UL4', 'UL5']) if (store.consumeReward('UW', l, T0)) n += 1;
check('max 5 victoires récompensées par jour', n === 5);
({ store, collections } = restart());
check('plafond conservé après redémarrage', store.consumeReward('UW', 'UL6', T0) === false);
check('le lendemain (heure de Paris), ça repart', store.consumeReward('UW', 'UL1', T0 + DAY) === true);

// 🔒 Idempotence du règlement
check('match non réglé', store.isSettled('mX') === false);
store.markSettled('mX');
({ store, collections } = restart());
check('match réglé, même après redémarrage', store.isSettled('mX') === true);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
