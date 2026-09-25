#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test de l'anti-farm persistant (src/farm.js)
//
//  Travaille dans une COPIE temporaire du projet (aucune donnée réelle
//  touchée). Simule des redémarrages du bot (module rechargé) : le quota
//  de l'heure et les pénalités en cours doivent survivre.
//
//  Usage : node scripts/test-farm.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-farm-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
const FARM_MODULE = path.join(TMP, 'src', 'farm.js');

/** Recharge le module comme au redémarrage du bot (mémoire vide). */
function restart() {
  delete require.cache[require.resolve(FARM_MODULE)];
  return require(FARM_MODULE);
}

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 8, 25, 14, 0);
const MAX = 15;

let farm = restart();

// 📊 Quota : 15 autorisés, le 16e déclenche la pénalité
for (let i = 0; i < 10; i += 1) farm.record('UA', MAX, T0 + i * MIN);
check('10 Jeanpips → quota 10/15', farm.getQuota('UA', MAX, T0 + 10 * MIN).used === 10);

// 🔁 Le bug : un redémarrage remettait le compteur à zéro
farm = restart();
check('après redémarrage : quota toujours 10/15', farm.getQuota('UA', MAX, T0 + 11 * MIN).used === 10);

let triggered = false;
for (let i = 0; i < 5; i += 1) triggered = farm.record('UA', MAX, T0 + (11 + i) * MIN) || triggered;
check('11e à 15e : pas de pénalité', !triggered);
check('16e : pénalité', farm.record('UA', MAX, T0 + 16 * MIN) === true);
check('pénalité de 1 h', farm.getPenaltyRemaining('UA', T0 + 16 * MIN) === 60 * MIN);

// 🔁 La pénalité survit au redémarrage
farm = restart();
check('après redémarrage : pénalité toujours là (40 min restantes)', farm.getPenaltyRemaining('UA', T0 + 36 * MIN) === 40 * MIN);
check('pénalités actives listées au démarrage', farm.listPenalties(T0 + 36 * MIN).some((p) => p.userId === 'UA' && p.remainingMs === 40 * MIN));

// ⌛ Fin de pénalité : on repart à zéro
check('pénalité finie après 1 h', farm.getPenaltyRemaining('UA', T0 + 76 * MIN) === 0);
check('quota remis à 0 après la pénalité', farm.getQuota('UA', MAX, T0 + 76 * MIN).used === 0);
check('plus listée au démarrage', farm.listPenalties(T0 + 76 * MIN).length === 0);

// 🪟 Fenêtre glissante d'1 h
farm.record('UB', MAX, T0);
farm.record('UB', MAX, T0 + 30 * MIN);
check('fenêtre glissante : le Jeanpip de +61 min sort', farm.getQuota('UB', MAX, T0 + 61 * MIN).used === 1);
check('prochaine place libre dans 29 min', farm.getQuota('UB', MAX, T0 + 61 * MIN).nextFreeMs === 29 * MIN);

// 🧹 clear (fin de pénalité via le timer)
farm.record('UC', 1, T0);
farm.record('UC', 1, T0 + MIN);
farm.clear('UC');
farm = restart();
check('clear : ni pénalité ni historique, même après redémarrage', farm.getPenaltyRemaining('UC', T0 + 2 * MIN) === 0 && farm.getQuota('UC', 1, T0 + 2 * MIN).used === 0);

// 🔧 Limite baissée en cours d'heure : le prochain Jeanpip déclenche
farm.record('UD', 15, T0);
farm.record('UD', 15, T0 + MIN);
farm.record('UD', 15, T0 + 2 * MIN);
check('limite baissée à 2 avec 3 déjà faits : pénalité au suivant', farm.record('UD', 2, T0 + 3 * MIN) === true);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)\n` : '\n🎉 Anti-farm persistant OK\n');
process.exit(failures ? 1 : 0);
