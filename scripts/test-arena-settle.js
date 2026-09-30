#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test du règlement de fin de combat (src/game/settle.js)
//
//  Pertes vainqueur / perdant / nul, butin, pack + crédits,
//  plafonds, idempotence. Travaille dans une COPIE temporaire.
//
//  Usage : node scripts/test-arena-settle.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-arena-settle-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

const origLog = console.log;
console.log = () => {};   // media.js annonce le catalogue au chargement
const { settleMatch } = require(path.join(TMP, 'src', 'game', 'settle.js'));
const collections = require(path.join(TMP, 'src', 'collections.js'));
const credits = require(path.join(TMP, 'src', 'credits.js'));
const boosters = require(path.join(TMP, 'src', 'boosters.js'));
const arenaStore = require(path.join(TMP, 'src', 'game', 'arenaStore.js'));
console.log = origLog;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const card = (url, rarity = 'common') => ({ url, title: url.toUpperCase(), rarity, type: 'image' });
function give(userId, urls) {
  collections.addCards(userId, urls.map((u) => card(u, u.startsWith('leg') ? 'legendary' : 'common')));
}
const pose = (side, url, status) => ({ side, url, title: url.toUpperCase(), rarity: url.startsWith('leg') ? 'legendary' : 'common', archetype: 'guerrier', status });
const T0 = Date.UTC(2026, 8, 25, 10, 0);

// ─── 🏆 Victoire de A ───
give('UA', ['a1', 'a1', 'a2', 'a3']);
give('UB', ['b1', 'b2', 'leg1', 'b3']);
const r = settleMatch({
  matchId: 'm1',
  players: { A: 'UA', B: 'UB' },
  result: {
    winner: 'A',
    reason: 'towers',
    poses: [
      pose('A', 'a1', 'destroyed'),
      pose('A', 'a2', 'alive'),
      pose('A', 'a3', 'expired'),
      pose('B', 'b1', 'destroyed'),
      pose('B', 'leg1', 'alive'),
    ],
  },
}, { random: () => 0.99, now: T0 });

check('vainqueur : perd seulement ses cartes détruites', collections.getCount('UA', 'a1') === 1);
check('vainqueur : survivante gardée', collections.getCount('UA', 'a2') === 1);
check('vainqueur : Pompe expirée gardée', collections.getCount('UA', 'a3') === 1);
check('perdant : carte détruite perdue', collections.getCount('UB', 'b1') === 0);
check('perdant : carte SURVIVANTE perdue aussi', collections.getCount('UB', 'leg1') === 0 || r.A.loot.url === 'leg1');
check('perdant : carte non posée intacte', collections.getCount('UB', 'b2') === 1 && collections.getCount('UB', 'b3') === 1);
check('butin : une des poses du perdant', ['b1', 'leg1'].includes(r.A.loot.url));
check('butin : ajouté au vainqueur', collections.getCount('UA', r.A.loot.url) === 1);
check('butin : annoncé au perdant', r.B.stolen && r.B.stolen.url === r.A.loot.url);
check('butin : le perdant ne le garde pas', collections.getCount('UB', r.A.loot.url) === 0);
check('récap : pertes listées', r.A.lost.length === 1 && r.B.lost.length === 2);
check('récompense : pack booster Commun en attente', r.A.boosterId && boosters.getPending(r.A.boosterId).type === 'common' && boosters.getPending(r.A.boosterId).owner === 'UA');
check('récompense : +10 crédits', credits.getBalance('UA') === 10 && r.A.credits === 10);
check('perdant : aucune récompense', !r.B.boosterId && credits.getBalance('UB') === 0);
check('stats enregistrées', arenaStore.getStats('UA').wins === 1 && arenaStore.getStats('UB').losses === 1);

// ─── 🔒 Idempotence ───
const again = settleMatch({ matchId: 'm1', players: { A: 'UA', B: 'UB' }, result: { winner: 'A', reason: 'towers', poses: [] } }, { now: T0 });
check('un match déjà réglé ne l\'est jamais deux fois', again.settled === false && credits.getBalance('UA') === 10);

// ─── 🤝 Match nul ───
give('UC', ['c1', 'c2']);
give('UD', ['d1', 'd2']);
const n = settleMatch({
  matchId: 'm2',
  players: { A: 'UC', B: 'UD' },
  result: { winner: null, reason: 'draw', poses: [pose('A', 'c1', 'destroyed'), pose('A', 'c2', 'alive'), pose('B', 'd1', 'alive')] },
}, { now: T0 });
check('nul : cartes détruites perdues', collections.getCount('UC', 'c1') === 0);
check('nul : survivantes gardées des deux côtés', collections.getCount('UC', 'c2') === 1 && collections.getCount('UD', 'd1') === 1);
check('nul : pas de butin ni de récompense', !n.A.loot && !n.B.loot && !n.A.boosterId && credits.getBalance('UC') === 0);
check('nul : stats', arenaStore.getStats('UC').draws === 1 && arenaStore.getStats('UD').draws === 1);

// ─── ❌ Combat annulé ───
give('UE', ['e1']);
const c = settleMatch({ matchId: 'm3', players: { A: 'UE', B: 'UF' }, cancelled: true, result: null }, { now: T0 });
check('annulé : rien de perdu', c.settled && c.cancelled && collections.getCount('UE', 'e1') === 1);
check('annulé : pas de stats', arenaStore.getStats('UE').wins + arenaStore.getStats('UE').losses + arenaStore.getStats('UE').draws === 0);

// ─── 💰 Plafond : 3e victoire contre le même adversaire ───
for (let i = 0; i < 3; i += 1) {
  give('UG', [`g${i}`]);
  give('UH', [`h${i}`]);
}
const results = [0, 1, 2].map((i) => settleMatch({
  matchId: `cap${i}`,
  players: { A: 'UG', B: 'UH' },
  result: { winner: 'A', reason: 'qg', poses: [pose('B', `h${i}`, 'destroyed')] },
}, { now: T0 }));
check('2 premières victoires récompensées', results[0].A.boosterId && results[1].A.boosterId);
check('3e contre le même adversaire : pas de pack ni crédits', !results[2].A.boosterId && results[2].A.credits === 0 && results[2].A.rewarded === false);
check('3e : le butin s\'applique quand même', results[2].A.loot && collections.getCount('UG', 'h2') === 1);

// ─── 🏳 Rappel : carte sauvée même en cas de défaite, hors butin ───
give('UK', ['k1', 'k2']);
give('UL', ['l1']);
const rc = settleMatch({
  matchId: 'recall',
  players: { A: 'UK', B: 'UL' },
  result: { winner: 'B', reason: 'qg', poses: [pose('A', 'k1', 'recalled'), pose('A', 'k2', 'alive')] },
}, { random: () => 0, now: T0 });
check('rappel : la carte rappelée est sauvée malgré la défaite', collections.getCount('UK', 'k1') === 1);
check('rappel : l’autre pose du perdant est perdue', collections.getCount('UK', 'k2') === 0);
check('rappel : jamais prise en butin', rc.B.loot && rc.B.loot.url === 'k2');

// ─── Perdant qui n'a rien posé ───
const empty = settleMatch({ matchId: 'm4', players: { A: 'UI', B: 'UJ' }, result: { winner: 'B', reason: 'forfeit', poses: [] } }, { now: T0 });
check('perdant sans pose : pas de butin, récompense quand même', !empty.B.loot && empty.B.boosterId);

try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }   // Windows : fichier ouvert = non supprimable
fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
