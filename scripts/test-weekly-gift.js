#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test des 20 crédits JeanPip du vendredi (src/weeklyGift.js)
//
//  Travaille dans une COPIE temporaire du projet (aucune donnée réelle
//  touchée). Joue : calcul du vendredi 9h, première initialisation,
//  distribution unique par semaine, expiration, dons partiels et refus.
//
//  Usage : node scripts/test-weekly-gift.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-weekly-gift-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));

const weeklyGift = require(path.join(TMP, 'src', 'weeklyGift'));
const credits = require(path.join(TMP, 'src', 'credits'));
const broadcast = require(path.join(TMP, 'src', 'broadcast'));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

// Dates en heure locale (comme le reset du dimanche 20h)
const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min);

// 📅 Dernier vendredi 9h
const f = weeklyGift.getLastFridayAt9h;
check('vendredi 9h00 → ce vendredi', f(at(2026, 9, 25, 9, 0)).getTime() === at(2026, 9, 25, 9).getTime());
check('vendredi 8h59 → vendredi précédent', f(at(2026, 9, 25, 8, 59)).getTime() === at(2026, 9, 18, 9).getTime());
check('jeudi → vendredi précédent', f(at(2026, 10, 1, 18)).getTime() === at(2026, 9, 25, 9).getTime());
check('samedi → la veille', f(at(2026, 9, 26, 1)).getTime() === at(2026, 9, 25, 9).getTime());

// 🆕 Première initialisation : pas de distribution rétroactive
broadcast.subscribe('UA');
broadcast.subscribe('UB');
broadcast.subscribe('UC');
check('1er lancement (jeudi) : rien distribué', weeklyGift.distributeIfDue(broadcast.getSubscribers(), at(2026, 9, 24, 12)).length === 0);
check('1er lancement : solde à offrir 0', weeklyGift.getAllowance('UA', at(2026, 9, 24, 12)) === 0);

// 🎁 Vendredi 9h : distribution une seule fois
const fri = at(2026, 9, 25, 9, 2);
const granted = weeklyGift.distributeIfDue(broadcast.getSubscribers(), fri);
check('vendredi 9h : 3 inscrits reçoivent', granted.length === 3 && granted.includes('UA'));
check(`solde à offrir = ${weeklyGift.WEEKLY_AMOUNT}`, weeklyGift.getAllowance('UA', fri) === weeklyGift.WEEKLY_AMOUNT);
check('2e passage la même semaine : rien', weeklyGift.distributeIfDue(broadcast.getSubscribers(), at(2026, 9, 25, 15)).length === 0);
check('non inscrit : 0 à offrir', weeklyGift.getAllowance('UZ', fri) === 0);

// 💸 Dons
const give = (from, to, amount) => weeklyGift.give(from, to, amount, at(2026, 9, 26, 10));
check('don à soi-même refusé', give('UA', 'UA', 5).error === 'soi');
check('don à un non-inscrit refusé', give('UA', 'UZ', 5).error === 'non_inscrit');
check('montant 0 refusé', give('UA', 'UB', 0).error === 'montant');
check('montant décimal refusé', give('UA', 'UB', 2.5).error === 'montant');
check('montant > solde refusé', give('UA', 'UB', 21).error === 'solde');
check('rien débité après les refus', weeklyGift.getAllowance('UA', at(2026, 9, 26, 10)) === 20);

const r1 = give('UA', 'UB', 5);
check('don de 5 à UB accepté, reste 15', r1.ok && r1.remaining === 15);
check('UB crédité de 5 dans son porte-monnaie', credits.getBalance('UB') === 5);
check('solde à offrir de UB inchangé', weeklyGift.getAllowance('UB', at(2026, 9, 26, 10)) === 20);
const r2 = give('UA', 'UC', 15);
check('don de 15 à UC accepté, reste 0', r2.ok && r2.remaining === 0);
check('plus rien à offrir', give('UA', 'UB', 1).error === 'solde');
check('porte-monnaie de UA intact', credits.getBalance('UA') === 0);

// ⌛ Vendredi suivant : le non-donné expire, tout le monde repart à 20
check('jeudi 23h59 : UB a encore 20', weeklyGift.getAllowance('UB', at(2026, 10, 1, 23, 59)) === 20);
check('vendredi 9h pile, avant distribution : non-donné expiré', weeklyGift.getAllowance('UB', at(2026, 10, 2, 9)) === 0);
check('don refusé tant que la distribution n\'est pas faite', weeklyGift.give('UB', 'UA', 1, at(2026, 10, 2, 9)).error === 'solde');
broadcast.unsubscribe('UC');
const granted2 = weeklyGift.distributeIfDue(broadcast.getSubscribers(), at(2026, 10, 2, 9, 1));
check('semaine suivante : 2 inscrits reçoivent (UC parti)', granted2.length === 2 && !granted2.includes('UC'));
check('UB repart à 20 (pas 40)', weeklyGift.getAllowance('UB', at(2026, 10, 2, 9, 1)) === 20);
check('UA repart à 20', weeklyGift.getAllowance('UA', at(2026, 10, 2, 9, 1)) === 20);
check('UC désinscrit : 0', weeklyGift.getAllowance('UC', at(2026, 10, 2, 9, 1)) === 0);

// 🔁 Bot éteint à 9h : rattrapage au redémarrage, une seule fois
check('bot éteint 2 semaines : rattrapage', weeklyGift.distributeIfDue(broadcast.getSubscribers(), at(2026, 10, 20, 8)).length === 2);
check('… puis plus rien', weeklyGift.distributeIfDue(broadcast.getSubscribers(), at(2026, 10, 20, 9)).length === 0);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)\n` : '\n🎉 Crédits du vendredi OK\n');
process.exit(failures ? 1 : 0);
