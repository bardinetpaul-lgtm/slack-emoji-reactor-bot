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

// 🤖 v3.2 : clic automatique = 6 clics d'affilée à intervalles identiques (±0,125 s)
/** Clics aux décalages `offsets` (s) après `start` → verdicts. */
const series = (user, start, offsets) => offsets.map((o) => spam.click(user, start + Math.round(o * 1000)));

// Cas réel du 15/10 (U02URAGLMHT) : un clic toutes les ~6,0 s, relevé dans les logs
const real = [0, 5.978, 11.998, 18.023, 23.978, 29.968];
let v = series('UBOT', Date.parse('2026-10-15T07:32:50.980Z'), real);
check('5 premiers clics réguliers : traités normalement', v.slice(0, 5).every((x) => x.action === 'process'));
check('6e clic à 6,0 s d\'écart : clic automatique → bloqué 2 min', v[5].action === 'lock' && v[5].reason === 'bot' && v[5].minutes === 2);
check('… avec les 5 écarts pour l\'alerte admin', Array.isArray(v[5].gaps) && v[5].gaps.length === 5 && v[5].gaps.every((g) => Math.abs(g - 6000) < 100));

// Un humain qui clique en boucle : écarts irréguliers (relevés le 15/10 avant le script)
v = series('UHUM', Date.parse('2026-10-15T07:21:33Z'), [0, 19.1, 39.6, 62.4, 103.7, 142.4, 160.9, 189, 221.8]);
check('humain qui clique en boucle (18 à 41 s d\'écart) : jamais pris pour un bot', v.every((x) => x.action === 'process'));
v = series('UHUM2', Date.parse('2026-10-15T07:30:00Z'), [0, 4.1, 8.4, 12.2, 16.9, 20.8, 25.3, 29.1]);
check('humain rapide et appliqué (~4 s, ±0,5 s) : jamais pris pour un bot', v.every((x) => x.action !== 'lock'));
v = series('UFAST', Date.parse('2026-10-15T07:30:00Z'), [0, 1.5, 3.0, 4.5, 6.0, 7.5]);
check('rythme trop rapide pour la règle de cadence (1,5 s) : ce n\'est pas elle qui sanctionne', v.every((x) => x.reason !== 'bot'));
v = series('USLOW', Date.parse('2026-10-15T07:00:00Z'), [0, 70, 140, 210, 280, 350]);
check('clics à 70 s pile : hors règle (une personne qui repasse de temps en temps)', v.every((x) => x.action === 'process'));

// Un bot qui ralentit après le blocage est repris : la série repart de zéro
const after = spam.lockedUntil('UBOT', Date.parse('2026-10-15T07:34:00Z'));
v = series('UBOT', after + S, [0, 6, 12, 18, 24, 30]);
check('récidive du bot après le blocage : 5 min', v[5].action === 'lock' && v[5].reason === 'bot' && v[5].minutes === 5);
v = series('UBOT', v[5].until - 2 * MIN, [0, 6, 12, 18, 24, 30]);
check('pendant le blocage suivant : clics ignorés, pas de nouvelle série', v.every((x) => x.action === 'ignore'));

console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
