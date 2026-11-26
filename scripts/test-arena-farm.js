#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test v4.4.2 : contrôle anti-farm de l'Arène (src/game/farmCheck.js,
//  branché dans settle.js, arenaSlack.js) + script check-arena-farm.js
//
//  Dans une COPIE temporaire (aucune donnée réelle touchée) :
//    • vrai combat → récompensé (booster, 10 JP$, série, classement)
//    • perdant sans aucune pose → « farm » : ni booster, ni JP$, ni série,
//      ni victoire au classement ; message au joueur, alerte admin
//    • perdant qui pose 1 carte, combat court → « suspect » (récompensé)
//    • 3e combat bâclé du jour dans la même paire → « farm »
//    • le lendemain, la paire repart à zéro
//    • le script de contrôle sort la paire en tête
//    • allers-retours sur plusieurs jours (perdant avec des cartes non jouées,
//      3 changements de vainqueur) → suspect + alerte une fois par jour ;
//      vrais combats (toutes les cartes jouées) → rien
//
//  Usage : npx -y -p node@20 node scripts/test-arena-farm.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-arena-farm-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

const origLog = console.log;
console.log = () => {};
const req = (m) => require(path.join(TMP, 'src', m));
const { settleMatch } = req(path.join('game', 'settle.js'));
const farmCheck = req(path.join('game', 'farmCheck.js'));
const arenaStore = req(path.join('game', 'arenaStore.js'));
const credits = req('credits.js');
const collections = req('collections.js');
const arenaSlack = req('arenaSlack.js');
const { analyzePairs, swingPairs } = require(path.join(ROOT, 'scripts', 'check-arena-farm.js'));
console.log = origLog;

let failures = 0;
const check = (label, cond) => { console.log(`${cond ? '✅' : '❌'} ${label}`); if (!cond) failures += 1; };

const pose = (side, url, status = 'destroyed') => ({ side, url, title: url, rarity: 'common', archetype: 'guerrier', status });
for (const u of ['UA', 'UB', 'UC', 'UD']) collections.addCards(u, ['c1', 'c2', 'c3', 'c4', 'c5'].map((x) => ({ url: `${u}-${x}`, title: x, rarity: 'common', type: 'image' })));
let n = 0;
const fight = (A, B, winner, loserPoses, { now, durationMs = 120000, reason = 'towers', unplayed } = {}) => {
  n += 1;
  const loser = winner === 'A' ? 'B' : 'A';
  const players = { A, B };
  const poses = [pose(winner, `${players[winner]}-c1`, 'alive'), ...Array.from({ length: loserPoses }, (_, i) => pose(loser, `${players[loser]}-c${i + 1}`))];
  return settleMatch({ matchId: `m${n}`, players, result: { winner, reason, durationMs, poses, ...(unplayed ? { unplayed } : {}) } }, { now, random: () => 0 });
};
const T = (h, day = 25) => Date.UTC(2026, 10, day, h - 1, 0);   // heure de Paris (UTC+1)

// ─── ✅ Vrai combat : C bat D, D a posé 3 cartes ───
let r = fight('UC', 'UD', 'A', 3, { now: T(10) });
check('vrai combat : verdict ok (pas de summary.farm)', !r.farm);
check('vrai combat : booster + 10 JP$', Boolean(r.A.boosterId) && r.A.credits === 10);
check('vrai combat : série pour les deux', Boolean(r.A.streak) && Boolean(r.B.streak));

// ─── 🕵️ A bat B, B ne pose rien ───
const balA = credits.getBalance('UA');
r = fight('UA', 'UB', 'A', 0, { now: T(10) });
check('perdant sans pose : verdict farm (no_play)', r.farm && r.farm.verdict === 'farm' && r.farm.signals.includes('no_play'));
check('farm : ni booster ni JP$', !r.A.boosterId && r.A.credits === 0 && credits.getBalance('UA') === balA);
check('farm : pas de jour de série (ni pour l\'un ni pour l\'autre)', !r.A.streak && !r.B.streak);
check('farm : la victoire ne compte pas au classement', arenaStore.getStats('UA').wins === 0 && arenaStore.getStats('UB').losses === 0);
check('farm : gardé dans l\'historique avec les poses', arenaStore.history().some((h) => h.matchId === 'm2' && h.farm === 'farm' && h.poses.UB === 0));
check('farm : hors « top de la semaine »', !arenaStore.weeklyTop(T(11)).some((x) => x.userId === 'UA'));

// Messages
const match = { id: 'm2', status: 'ended', players: { A: { userId: 'UA' }, B: { userId: 'UB' } }, engine: { result: { winner: 'A', reason: 'towers' } } };
const dmA = JSON.stringify(arenaSlack.buildResultDM(match, r, 'UA'));
check('DM du vainqueur : « Combat non récompensé » + raison', /Combat non récompensé/.test(dmA) && /aucune carte/.test(dmA));
const alert = JSON.stringify(arenaSlack.buildFarmAlertDM(match, r));
check('alerte admin : joueurs + raison', /<@UA> bat <@UB>/.test(alert) && /non récompensé/.test(alert));

// ─── 👀 B bat A en posant 1 carte côté A, 40 s : suspect (ping-pong pas encore : B n'avait pas gagné) ───
r = fight('UA', 'UB', 'B', 1, { now: T(11), durationMs: 40000 });
check('1 pose, 40 s : suspect (token + ping_pong), récompensé', r.farm && r.farm.verdict === 'suspect' && r.farm.signals.includes('token') && Boolean(r.B.boosterId));
check('suspect : la victoire compte', arenaStore.getStats('UB').wins === 1);

// ─── 🕵️ 3e combat bâclé du jour dans la paire : farm même avec 1 pose ───
r = fight('UB', 'UA', 'B', 1, { now: T(12) });
check('3e combat bâclé du jour : farm (repeat)', r.farm && r.farm.verdict === 'farm' && r.farm.signals.includes('repeat'));
check('repeat : pas de booster', !r.A.boosterId && !r.B.boosterId);

// ─── 🌅 Le lendemain : la paire repart à zéro ───
r = fight('UA', 'UB', 'A', 1, { now: T(10, 26) });
check('lendemain, 1 pose, combat normal : ok', !r.farm && Boolean(r.A.boosterId));

// ─── 🧮 analyze() pur : un nul n'est jamais suspect ───
check('nul : ok', farmCheck.analyze({ players: { A: 'UA', B: 'UB' }, result: { winner: null, poses: [] }, history: [], now: T(10) }).verdict === 'ok');

// ─── 📋 Script de contrôle ───
const rows = analyzePairs(arenaStore.history(), T(13), 7);
const top = rows[0];
check(`script : la paire UA/UB du 25 sort en tête (score ${top && top.score})`, top && top.a === 'UA' && top.b === 'UB' && top.day === '2026-11-25' && top.score >= 5);
check('script : la paire UC/UD (1 vrai combat) n\'est pas suspecte', rows.find((x) => x.a === 'UC').score < 5);

// ─── 🔁 Allers-retours : UE et UF, 2 cartes posées (pas bâclé), 5 cartes gardées en main ───
for (const u of ['UE', 'UF']) collections.addCards(u, Array.from({ length: 30 }, (_, i) => ({ url: `${u}-c${i % 5 + 1}`, title: 'x', rarity: 'common', type: 'image' })));
const left = (loserSide, k = 5) => (loserSide === 'A' ? { A: k, B: 0 } : { A: 0, B: k });
let s1 = fight('UE', 'UF', 'A', 2, { now: T(10, 23), unplayed: left('B') });        // E gagne
let s2 = fight('UE', 'UF', 'B', 2, { now: T(11, 23), unplayed: left('A') });        // F gagne (1 changement)
let s3 = fight('UE', 'UF', 'A', 2, { now: T(10, 24), unplayed: left('B') });        // E gagne (2)
check('2 changements de vainqueur : pas encore d\'alerte', !s1.farm && !s2.farm && !s3.farm);
let s4 = fight('UE', 'UF', 'B', 2, { now: T(10, 25), unplayed: left('A') });        // F gagne (3) → alerte
check('3e changement de vainqueur sur 3 jours : suspect (aller_retour), récompensé', s4.farm && s4.farm.verdict === 'suspect' && s4.farm.signals.includes('aller_retour') && Boolean(s4.B.boosterId));
check('aller-retour : alerte admin', s4.farm.alert === true);
let s5 = fight('UE', 'UF', 'A', 2, { now: T(11, 25), unplayed: left('B') });        // même jour → pas de 2e alerte
check('aller-retour, même jour : signal gardé, pas de 2e alerte', s5.farm && s5.farm.signals.includes('aller_retour') && s5.farm.alert === false);
const s6 = fight('UE', 'UF', 'B', 2, { now: T(10, 26), unplayed: left('A') });      // jour suivant → nouvelle alerte
check('aller-retour, jour suivant : nouvelle alerte', s6.farm && s6.farm.alert === true);
const alertSwing = JSON.stringify(arenaSlack.buildFarmAlertDM({ id: 'mx', players: { A: { userId: 'UE' }, B: { userId: 'UF' } }, engine: { result: { winner: 'B' } } }, s6));
check('alerte admin : « allers-retours » + « suspect »', /allers-retours/.test(alertSwing) && /suspect/.test(alertSwing));

// Vrais combats en alternance (le perdant a tout joué) : jamais d'alerte
for (const u of ['UG', 'UH']) collections.addCards(u, Array.from({ length: 30 }, (_, i) => ({ url: `${u}-c${i % 5 + 1}`, title: 'x', rarity: 'common', type: 'image' })));
let honest = [];
for (let i = 0; i < 6; i++) honest.push(fight('UG', 'UH', i % 2 ? 'B' : 'A', 4, { now: T(10 + i, 25), unplayed: { A: 0, B: 0 } }));
check('6 vrais combats chacun son tour, toutes les cartes jouées : aucune alerte', honest.every((r) => !r.farm));
check('historique : cartes non jouées enregistrées', arenaStore.history().some((h) => h.unplayed && h.unplayed.UF === 5));

// Script : la paire UE/UF ressort dans les allers-retours, pas UG/UH
const sw = swingPairs(arenaStore.history(), T(12, 26), 7);
check(`script : allers-retours UE ⇄ UF repérés (${sw.map((x) => `${x.a}/${x.b}:${x.switches}`).join(', ')})`, sw.some((x) => x.a === 'UE' && x.b === 'UF' && x.switches >= 3) && !sw.some((x) => x.a === 'UG'));

console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
