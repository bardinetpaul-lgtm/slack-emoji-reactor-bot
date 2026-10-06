// ═══════════════════════════════════════════════════════════
//  🎖 MODULE CAPITAINES (Arène)
//  Une carte du deck est désignée Capitaine : elle n'est JAMAIS posée
//  (donc jamais risquée) et occupe un des 8 emplacements. Son archétype
//  donne un style de jeu : un passif permanent + un pouvoir utilisable
//  une seule fois par combat. Appliqué par src/game/engine.js.
// ═══════════════════════════════════════════════════════════

const CAPTAINS = {
  tank: {
    style: 'Siège',
    passive: 'Tes Tanks ont +50 % de PV.',
    power: { key: 'rempart', label: 'Rempart', lane: true, desc: 'Ta tour la plus proche du point touché est invulnérable 10 s.' },
  },
  guerrier: {
    style: 'Rush',
    passive: 'Tes unités avancent 20 % plus vite et frappent 15 % plus fort.',
    power: { key: 'charge', label: 'Charge', lane: true, desc: 'Tes unités autour du point touché foncent 6 s (vitesse ×2, dégâts +40 %).' },
  },
  tireur: {
    style: 'Contrôle',
    passive: 'Tes tours tirent 10 % plus loin.',
    power: { key: 'salve', label: 'Salve', lane: true, desc: '200 dégâts à toutes les unités ennemies autour du point touché.' },
  },
  essaim: {
    style: 'Nuée',
    passive: 'Tes Essaims ont deux abeilles de plus.',
    power: { key: 'renforts', label: 'Renforts', lane: true, desc: '4 abeilles gratuites au point touché (aucune carte engagée).' },
  },
  vigie: {
    style: 'Garnison',
    passive: 'Tes Vigies restent deux fois plus longtemps.',
    power: { key: 'alarme', label: 'Alarme', lane: false, desc: 'Toutes tes tours en vie tirent deux fois plus fort pendant 6 s.' },
  },
  sort: {
    style: 'Magie',
    passive: 'Écho : chaque Sort se relance une seconde fois, gratuitement (sans carte en jeu), et coûte 1 élixir de moins.',
    power: { key: 'gel', label: 'Gel', lane: true, desc: 'Les unités ennemies autour du point touché sont figées 3 s.' },
  },
};

// Valeurs utilisées par le moteur (réglables, validées par la simulation)
const TUNING = {
  tankHp: 1.5,
  // v2.1.1 : 1,35 / 1,3 → 1,2 / 1,15. Le Rush gagnait 69 % de ses combats entre joueurs simples
  // et 61 % entre bons joueurs (matrice Capitaine contre Capitaine) ; il retombe à 59 % / 50 %.
  rushSpeed: 1.2,
  rushDps: 1.15,
  towerRange: 1.1,
  extraSwarm: 2,
  spellDiscount: 1,
  spellDamage: 1,
  rempartMs: 10000,
  chargeMs: 6000,
  chargeSpeed: 2,
  chargeDps: 1.4,
  salveDamage: 200,
  renforts: 4,
  gelMs: 3000,
  // v2.3 : Garnison (remplace Économie : élixir de départ, maximum 11, recharge, Surchauffe)
  vigieDuration: 2,   // simulation : 1,5 → 2 (la Nuée gagnait 81 % de ses combats contre la Garnison)
  alarmeMs: 6000,
  alarmeDps: 2,
};

module.exports = { CAPTAINS, TUNING };
