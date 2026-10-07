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
const { settleMatch, REWARD_CREDITS } = require(path.join(TMP, 'src', 'game', 'settle.js'));
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
check('vainqueur : Vigie redescendue (expired) gardée', collections.getCount('UA', 'a3') === 1);
check('perdant : carte détruite perdue', collections.getCount('UB', 'b1') === 0);
check('perdant : carte SURVIVANTE perdue aussi', collections.getCount('UB', 'leg1') === 0 || r.A.loot.url === 'leg1');
check('perdant : carte non posée intacte', collections.getCount('UB', 'b2') === 1 && collections.getCount('UB', 'b3') === 1);
check('butin : une des poses du perdant', ['b1', 'leg1'].includes(r.A.loot.url));
check('butin : ajouté au vainqueur', collections.getCount('UA', r.A.loot.url) === 1);
check('butin : annoncé au perdant', r.B.stolen && r.B.stolen.url === r.A.loot.url);
check('butin : le perdant ne le garde pas', collections.getCount('UB', r.A.loot.url) === 0);
check('récap : pertes listées', r.A.lost.length === 1 && r.B.lost.length === 2);
check('récompense : pack booster Commun en attente', r.A.boosterId && boosters.getPending(r.A.boosterId).type === 'common' && boosters.getPending(r.A.boosterId).owner === 'UA');
// 📅 + 1 JP$ de série (1er combat du jour) pour chacun, vainqueur comme perdant
check('récompense : +10 JP$ (+1 JP$ de série)', credits.getBalance('UA') === 11 && r.A.credits === 10);
check('perdant : aucune récompense de victoire', !r.B.boosterId && r.B.credits === 0);
check('série : jour 1 pour les deux (+1 JP$)', r.A.streak.step === 1 && r.A.streak.credits === 1 && r.B.streak.step === 1 && credits.getBalance('UB') === 1);
check('stats enregistrées', arenaStore.getStats('UA').wins === 1 && arenaStore.getStats('UB').losses === 1);

// ─── 🔒 Idempotence ───
const again = settleMatch({ matchId: 'm1', players: { A: 'UA', B: 'UB' }, result: { winner: 'A', reason: 'towers', poses: [] } }, { now: T0 });
check('un match déjà réglé ne l\'est jamais deux fois', again.settled === false && credits.getBalance('UA') === 11);

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
check('nul : pas de butin ni de récompense de victoire', !n.A.loot && !n.B.loot && !n.A.boosterId && !n.B.boosterId);
check('nul : la série compte quand même (+1 JP$)', n.A.streak.step === 1 && n.B.streak.step === 1 && credits.getBalance('UC') === 1);
check('nul : stats', arenaStore.getStats('UC').draws === 1 && arenaStore.getStats('UD').draws === 1);

// ─── ❌ Combat annulé ───
give('UE', ['e1']);
const c = settleMatch({ matchId: 'm3', players: { A: 'UE', B: 'UF' }, cancelled: true, result: null }, { now: T0 });
check('annulé : rien de perdu', c.settled && c.cancelled && collections.getCount('UE', 'e1') === 1);
check('annulé : pas de stats', arenaStore.getStats('UE').wins + arenaStore.getStats('UE').losses + arenaStore.getStats('UE').draws === 0);
check('annulé : pas de série', !c.A.streak && arenaStore.getStreak('UE') === null && credits.getBalance('UE') === 0);

// ─── 💰 Aucun plafond : 7 victoires le même jour contre le même adversaire, toutes récompensées ───
for (let i = 0; i < 7; i += 1) {
  give('UG', [`g${i}`]);
  give('UH', [`h${i}`]);
}
const results = [0, 1, 2, 3, 4, 5, 6].map((i) => settleMatch({
  matchId: `cap${i}`,
  players: { A: 'UG', B: 'UH' },
  result: { winner: 'A', reason: 'qg', poses: [pose('B', `h${i}`, 'destroyed')] },
}, { now: T0 }));
check('7 victoires : pack + JP$ à chaque fois', results.every((r) => r.A.boosterId && r.A.rewarded === true && r.A.credits === REWARD_CREDITS));
check('7 boosters distincts', new Set(results.map((r) => r.A.boosterId)).size === 7);
check('le butin s\'applique toujours', results[6].A.loot && collections.getCount('UG', 'h6') === 1);
check('série : seul le 1er combat du jour compte', results[0].A.streak && results[0].A.streak.step === 1 && results.slice(1).every((x) => x.A.streak === null && x.B.streak === null));

// ─── 📅 Série sur 6 jours ouvrés : JP$ puis booster Rare, puis retour au jour 1 ───
const DAY = 24 * 3600 * 1000;
const MON = Date.UTC(2026, 9, 5, 10, 0);   // lundi 5 octobre 2026, midi à Paris
const days = [0, 1, 2, 3, 4, 7, 8].map((n) => MON + n * DAY);   // lun → ven, lun, mar
const streakRuns = days.map((now, i) => settleMatch({
  matchId: `streak${i}`, players: { A: 'US', B: 'UT' }, result: { winner: null, reason: 'draw', poses: [] },
}, { now }));
check('série : 1, 2, 4, 10, 20 JP$ du lundi au vendredi', streakRuns.slice(0, 5).map((x) => x.A.streak.credits).join(',') === '1,2,4,10,20');
const rare = streakRuns[5].A.streak;
check('série : jour 6 (lundi suivant) → booster Rare en attente', rare.step === 6 && rare.credits === 0 && rare.boosterId
  && boosters.getPending(rare.boosterId).type === 'rare' && boosters.getPending(rare.boosterId).owner === 'US');
check('série : le jour 6 vaut aussi pour l’adversaire', streakRuns[5].B.streak.boosterId && streakRuns[5].B.streak.boosterId !== rare.boosterId);
check('série : retour au jour 1 après le jour 6', streakRuns[6].A.streak.step === 1 && streakRuns[6].A.streak.credits === 1);
check('série : 38 JP$ au total sur les 7 jours', credits.getBalance('US') === 1 + 2 + 4 + 10 + 20 + 1);

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

// ─── 🗼 Vigie : redescendue = sauvée (sauf défaite), tombée avec sa tour = perdue ───
const vpose = (side, url, status) => ({ ...pose(side, url, status), archetype: 'vigie' });
give('UV', ['v1', 'v2', 'v3']);
give('UW', ['w1']);
settleMatch({
  matchId: 'vigie-win',
  players: { A: 'UV', B: 'UW' },
  result: { winner: 'A', reason: 'towers', poses: [vpose('A', 'v1', 'expired'), vpose('A', 'v2', 'destroyed'), vpose('A', 'v3', 'alive'), pose('B', 'w1', 'alive')] },
}, { random: () => 0, now: T0 });
check('Vigie : redescendue (expired) gardée par le vainqueur', collections.getCount('UV', 'v1') === 1);
check('Vigie : tour détruite avec elle (destroyed) → carte perdue, même pour le vainqueur', collections.getCount('UV', 'v2') === 0);
check('Vigie : encore en poste à la fin (alive) → gardée par le vainqueur', collections.getCount('UV', 'v3') === 1);
give('UX', ['x1']);
settleMatch({
  matchId: 'vigie-loss',
  players: { A: 'UX', B: 'UY' },
  result: { winner: 'B', reason: 'qg', poses: [vpose('A', 'x1', 'expired')] },
}, { random: () => 0, now: T0 });
check('Vigie : redescendue mais combat perdu → carte perdue (comme l’ancienne Pompe)', collections.getCount('UX', 'x1') === 0);

// ─── Perdant qui n'a rien posé ───
const empty = settleMatch({ matchId: 'm4', players: { A: 'UI', B: 'UJ' }, result: { winner: 'B', reason: 'forfeit', poses: [] } }, { now: T0 });
check('perdant sans pose : pas de butin, récompense quand même', !empty.B.loot && empty.B.boosterId);

try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }   // Windows : fichier ouvert = non supprimable
fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
