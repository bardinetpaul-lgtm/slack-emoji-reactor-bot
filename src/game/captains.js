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
    power: { key: 'rempart', label: 'Rempart', lane: true, desc: 'La tour du couloir choisi est invulnérable 4 s.' },
  },
  guerrier: {
    style: 'Rush',
    passive: 'Tes unités avancent 15 % plus vite.',
    power: { key: 'charge', label: 'Charge', lane: true, desc: 'Tes unités du couloir foncent 3 s (vitesse ×2, dégâts +20 %).' },
  },
  tireur: {
    style: 'Contrôle',
    passive: 'Tes tours tirent 20 % plus loin.',
    power: { key: 'salve', label: 'Salve', lane: true, desc: '200 dégâts à toutes les unités ennemies du couloir.' },
  },
  essaim: {
    style: 'Nuée',
    passive: 'Chacun de tes groupes a un personnage de plus.',
    power: { key: 'renforts', label: 'Renforts', lane: true, desc: '3 abeilles gratuites dans le couloir (aucune carte engagée).' },
  },
  pompe: {
    style: 'Économie',
    passive: '+1 élixir au départ.',
    power: { key: 'surchauffe', label: 'Surchauffe', lane: false, desc: 'Ton élixir se recharge deux fois plus vite pendant 8 s.' },
  },
  sort: {
    style: 'Magie',
    passive: 'Tes Sorts coûtent 1 élixir de moins.',
    power: { key: 'gel', label: 'Gel', lane: true, desc: 'Les unités ennemies du couloir sont figées 2 s.' },
  },
};

// Valeurs utilisées par le moteur (réglables, validées par la simulation)
const TUNING = {
  tankHp: 1.15,
  rushSpeed: 1.15,
  towerRange: 1.2,
  extraUnit: 1,
  startElixir: 1,
  spellDiscount: 1,
  rempartMs: 4000,
  chargeMs: 3000,
  chargeSpeed: 2,
  chargeDps: 1.2,
  salveDamage: 200,
  renforts: 3,
  surchauffeMs: 8000,
  gelMs: 2000,
};

module.exports = { CAPTAINS, TUNING };
