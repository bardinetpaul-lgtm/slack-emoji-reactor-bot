#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test de l'anti-spam du bouton d'achat Octobre Rose (src/boosterSpam.js)
//  Logique pure (horloge passée en paramètre).
//  Spam = plus de 4 clics (donc 5) en moins de 5 s.
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
/** `n` clics espacés de 100 ms à partir de `start` → verdict du dernier. */
const burst = (user, start, n) => {
  let last = null;
  for (let i = 0; i < n; i += 1) last = spam.click(user, start + i * 100);
  return last;
};
let t = Date.parse('2026-10-12T07:30:00Z');   // 9h30 à Paris

check('1er clic : traité', spam.click('U1', t).action === 'process');
check('2e clic (< 3 s) : ignoré, pas de sanction', spam.click('U1', t + 300).action === 'ignore');
check('4 clics en rafale : toujours pas de sanction', spam.click('U1', t + 600).action === 'ignore' && spam.click('U1', t + 900).action === 'ignore');
const lock1 = spam.click('U1', t + 1200);
check('5e clic en moins de 5 s : bouton bloqué 2 min', lock1.action === 'lock' && lock1.minutes === 2 && lock1.until === t + 1200 + 2 * MIN);
check('… avec la sanction suivante annoncée (5 min)', lock1.nextMinutes === 5);
check('pendant le blocage : clics ignorés', spam.click('U1', t + 30 * S).action === 'ignore' && spam.click('U1', t + 31 * S).action === 'ignore');
check('pendant le blocage : lockedUntil renvoie la fin', spam.lockedUntil('U1', t + 60 * S) === lock1.until);
check('les clics pendant le blocage ne relancent pas une sanction', spam.lockedUntil('U1', t + 61 * S) === lock1.until);

t = lock1.until + S;
check('après 2 min : le bouton remarche', spam.lockedUntil('U1', t) === 0 && spam.click('U1', t).action === 'process');
check('clics espacés (> 3 s) : tous traités, jamais sanctionnés', spam.click('U1', t + 4 * S).action === 'process' && spam.click('U1', t + 8 * S).action === 'process');
check('4 clics en 1 s : jamais sanctionnés', burst('U1', t + 20 * S, 4).action !== 'lock' && spam.lockedUntil('U1', t + 21 * S) === 0);

t += 40 * S;
const lock2 = burst('U1', t, 5);
check('récidive : 5 min', lock2.action === 'lock' && lock2.minutes === 5 && lock2.nextMinutes === 10);

const ladder = [];
let u = lock2.until + S;
for (let i = 0; i < 6; i += 1) {
  const l = burst('U1', u, 5);
  ladder.push(l.minutes);
  u = l.until + S;
}
check(`progression : 10, 20, 30 puis 60 min (${ladder.join(', ')})`, ladder.join() === '10,20,30,60,60,60');

check('un autre joueur n\'est pas touché', spam.click('U2', u).action === 'process');

const tomorrow = Date.parse('2026-10-13T07:00:00Z');
const next = burst('U1', tomorrow, 5);
check('le lendemain : compteur remis à zéro (1re rafale = 2 min)', next.action === 'lock' && next.minutes === 2);

console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
