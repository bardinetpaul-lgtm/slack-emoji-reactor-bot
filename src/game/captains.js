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
    passive: 'Tes Tanks ont +15 % de PV.',
    power: { key: 'rempart', label: 'Rempart', lane: true, desc: 'Ta tour la plus proche du point touché est invulnérable 4 s.' },
  },
  guerrier: {
    style: 'Rush',
    passive: 'Tes unités avancent 25 % plus vite et frappent 15 % plus fort.',
    power: { key: 'charge', label: 'Charge', lane: true, desc: 'Tes unités autour du point touché foncent 3 s (vitesse ×2, dégâts +20 %).' },
  },
  tireur: {
    style: 'Contrôle',
    passive: 'Tes tours tirent 20 % plus loin.',
    power: { key: 'salve', label: 'Salve', lane: true, desc: '200 dégâts à toutes les unités ennemies autour du point touché.' },
  },
  essaim: {
    style: 'Nuée',
    passive: 'Tes Essaims ont deux abeilles de plus.',
    power: { key: 'renforts', label: 'Renforts', lane: true, desc: '4 abeilles gratuites au point touché (aucune carte engagée).' },
  },
  pompe: {
    style: 'Économie',
    passive: '+2 élixir au départ, recharge 10 % plus rapide, et ton élixir monte jusqu’à 12.',
    power: { key: 'surchauffe', label: 'Surchauffe', lane: false, desc: 'Ton élixir se recharge deux fois plus vite pendant 12 s.' },
  },
  sort: {
    style: 'Magie',
    passive: 'Écho : chaque Sort se relance une seconde fois, gratuitement (sans carte en jeu), et coûte 1 élixir de moins.',
    power: { key: 'gel', label: 'Gel', lane: true, desc: 'Les unités ennemies autour du point touché sont figées 3 s.' },
  },
};

// Valeurs utilisées par le moteur (réglables, validées par la simulation)
const TUNING = {
  tankHp: 1.7,
  rushSpeed: 1.25,
  rushDps: 1.45,
  towerRange: 1.05,
  extraSwarm: 2,
  startElixir: 4,
  elixirMax: 12,
  ecoRegen: 1.25,
  spellDiscount: 1,
  spellDamage: 1,
  rempartMs: 4000,
  chargeMs: 3000,
  chargeSpeed: 2,
  chargeDps: 1.2,
  salveDamage: 200,
  renforts: 4,
  surchauffeMs: 12000,
  gelMs: 3000,
};

module.exports = { CAPTAINS, TUNING };
