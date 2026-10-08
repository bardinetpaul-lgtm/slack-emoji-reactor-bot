#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test de l'anti-spam du bouton d'achat Octobre Rose (src/boosterSpam.js)
//  Logique pure (horloge passée en paramètre).
//
//  Usage : node scripts/test-booster-spam.js
// ═══════════════════════════════════════════════════════════
const path = require('path');
const spam = require(path.join(__dirname, '..', 'src', 'boosterSpam.js'));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const S = 1000;
const MIN = 60 * S;
let t = Date.parse('2026-10-12T07:30:00Z');   // 9h30 à Paris

check('1er clic : traité', spam.click('U1', t).action === 'process');
check('double-clic (< 3 s) : 2e clic ignoré, pas de sanction', spam.click('U1', t + 500).action === 'ignore');
const lock1 = spam.click('U1', t + 1000);
check('3e clic en moins de 5 s : bouton bloqué 2 min', lock1.action === 'lock' && lock1.minutes === 2 && lock1.until === t + 1000 + 2 * MIN);
check('… avec la sanction suivante annoncée (5 min)', lock1.nextMinutes === 5);
check('pendant le blocage : clics ignorés', spam.click('U1', t + 30 * S).action === 'ignore' && spam.click('U1', t + 31 * S).action === 'ignore');
check('pendant le blocage : lockedUntil renvoie la fin', spam.lockedUntil('U1', t + 60 * S) === lock1.until);
check('les clics pendant le blocage ne relancent pas une sanction', spam.lockedUntil('U1', t + 61 * S) === lock1.until);

t = lock1.until + S;
check('après 2 min : le bouton remarche', spam.lockedUntil('U1', t) === 0 && spam.click('U1', t).action === 'process');
check('clics espacés (> 3 s) : tous traités, jamais sanctionnés', spam.click('U1', t + 4 * S).action === 'process' && spam.click('U1', t + 8 * S).action === 'process');

t += 20 * S;
spam.click('U1', t);
spam.click('U1', t + 300);
const lock2 = spam.click('U1', t + 600);
check('récidive : 5 min', lock2.action === 'lock' && lock2.minutes === 5 && lock2.nextMinutes === 10);

const ladder = [];
let u = lock2.until + S;
for (let i = 0; i < 6; i += 1) {
  spam.click('U1', u);
  spam.click('U1', u + 100);
  const l = spam.click('U1', u + 200);
  ladder.push(l.minutes);
  u = l.until + S;
}
check(`progression : 10, 20, 30 puis 60 min (${ladder.join(', ')})`, ladder.join() === '10,20,30,60,60,60');

check('un autre joueur n\'est pas touché', spam.click('U2', u).action === 'process');

const tomorrow = Date.parse('2026-10-13T07:00:00Z');
check('le lendemain : compteur remis à zéro (1re rafale = 2 min)', (() => {
  spam.click('U1', tomorrow);
  spam.click('U1', tomorrow + 100);
  const l = spam.click('U1', tomorrow + 200);
  return l.action === 'lock' && l.minutes === 2;
})());

console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
