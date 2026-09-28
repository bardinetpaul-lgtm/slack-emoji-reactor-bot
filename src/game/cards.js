// ═══════════════════════════════════════════════════════════
//  🃏 MODULE CARTES (Arène)
//  Stats de combat d'une carte Jeanpip : archétype + rareté.
//
//  Archétype :
//    1. data/card-overrides.json s'il a une entrée pour la carte
//       { "<url>": { "archetype": "tank", "specialty": "..." } }
//    2. sinon tirage STABLE : sha256(url) → [0, 100) → répartition `share`.
//
//  Rareté : renforce les PV (et les dégâts d'un Sort, les PV / la durée
//  d'une Pompe), jamais les dégâts des unités ; à moitié pour l'Essaim.
//  Les épiques / légendaires reçoivent en plus une spécialité.
//  Réglé par la simulation : à stratégie égale un deck riche gagne ~64 %,
//  mais un bon joueur 100 % commun bat un mauvais joueur au deck riche ~63 %.
//
//  Contres : l'attaquant fait ×1,5 à ce qu'il contre, ×0,67 à ce
//  qui le contre. Tank → Guerrier → Tireur → Essaim → Tank ; Sort → Essaim.
//
//  Une carte de combattants pose TOUJOURS un groupe (`count`) : hp et dps
//  sont PAR personnage (total de la carte = count × valeur).
//
//  Unités du terrain : distance en « cases » (terrain de 0 à 100),
//  vitesse en cases/s, durées en ms.
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OVERRIDES_PATH = path.join(__dirname, '..', '..', 'data', 'card-overrides.json');

// ─────────────────────────────────────────────
// 🎭 Archétypes (valeurs d'une carte COMMUNE, par personnage du groupe)
//    `share` = part des cartes (total 100)
// ─────────────────────────────────────────────

const ARCHETYPES = {
  tank:     { key: 'tank',     label: 'Tank',     emoji: '🛡', share: 20, cost: 5, hp: 700, dps: 22.5, range: 2,  speed: 6,  count: 2, targets: 'buildings' },
  guerrier: { key: 'guerrier', label: 'Guerrier', emoji: '⚔️', share: 27, cost: 3, hp: 170, dps: 24,   range: 2,  speed: 8,  count: 3, targets: 'all' },
  tireur:   { key: 'tireur',   label: 'Tireur',   emoji: '🏹', share: 23, cost: 3, hp: 115, dps: 29,   range: 10, speed: 8,  count: 3, targets: 'all' },
  essaim:   { key: 'essaim',   label: 'Essaim',   emoji: '🐝', share: 15, cost: 3, hp: 105, dps: 20,   range: 2,  speed: 11, count: 6, targets: 'all', rarityWeight: 0.5 },
  sort:     { key: 'sort',     label: 'Sort',     emoji: '💥', share: 10, cost: 4, damage: 350, radius: 6, buildingRatio: 0.4 },
  pompe:    { key: 'pompe',    label: 'Pompe',    emoji: '⚗️', share: 5,  cost: 4, hp: 500, productionMs: 7000, lifetimeMs: 45000 },
};

const RARITY_MODS = {
  common:    { mult: 1,    cost: 0 },
  rare:      { mult: 1.04, cost: 0 },
  epic:      { mult: 1.07, cost: 0 },
  legendary: { mult: 1.1, cost: 0 },
};

// attaquant → archétype qu'il contre
// ✨ Spécialités tirées automatiquement pour les épiques / légendaires
const SPECIAL_RARITIES = ['epic', 'legendary'];
const SPECIALTIES_BY_ARCH = {
  tank: ['bouclier', 'invocation'],
  guerrier: ['charge', 'vampire', 'explosion'],
  tireur: ['ralenti', 'soin'],
  essaim: ['explosion', 'charge'],
};

function autoSpecialty(url, archetype, rarity) {
  const pool = SPECIALTIES_BY_ARCH[archetype];
  if (!pool || !SPECIAL_RARITIES.includes(rarity)) return null;
  const hash = crypto.createHash('sha256').update(String(url)).digest();
  return pool[hash.readUInt32BE(4) % pool.length];
}

const COUNTERS = {
  tank: 'guerrier',
  guerrier: 'tireur',
  tireur: 'essaim',
  essaim: 'tank',
  sort: 'essaim',
};
const COUNTER_BONUS = 1.5;
const COUNTER_MALUS = 0.67;

// ─────────────────────────────────────────────
// ✍️ Surcharges manuelles (relues à la demande)
// ─────────────────────────────────────────────

let overrides = null;

function reloadOverrides() {
  try {
    overrides = fs.existsSync(OVERRIDES_PATH)
      ? JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf-8')) || {}
      : {};
  } catch (e) {
    console.error('[cards] card-overrides.json illisible:', e.message);
    overrides = {};
  }
  return overrides;
}

function getOverride(url) {
  if (!overrides) reloadOverrides();
  return overrides[url] || null;
}

// ─────────────────────────────────────────────
// 🎲 Archétype stable à partir de l'URL
// ─────────────────────────────────────────────

function archetypeFromUrl(url) {
  const hash = crypto.createHash('sha256').update(String(url)).digest();
  const roll = (hash.readUInt32BE(0) / 0x100000000) * 100;
  let acc = 0;
  const keys = Object.keys(ARCHETYPES);
  for (const key of keys) {
    acc += ARCHETYPES[key].share;
    if (roll < acc) return key;
  }
  return keys[keys.length - 1];
}

// ─────────────────────────────────────────────
// 📊 Stats complètes d'une carte
// ─────────────────────────────────────────────

function getCardStats(card) {
  const override = getOverride(card.url);
  const archetype = override && ARCHETYPES[override.archetype] ? override.archetype : archetypeFromUrl(card.url);
  const rarity = RARITY_MODS[card.rarity] ? card.rarity : 'common';
  const base = ARCHETYPES[archetype];
  const rarityMod = RARITY_MODS[rarity];
  // `rarityWeight` atténue le bonus de rareté (l'Essaim en profite ×3)
  const weight = base.rarityWeight === undefined ? 1 : base.rarityWeight;
  const mod = { mult: 1 + (rarityMod.mult - 1) * weight, cost: rarityMod.cost };

  const stats = {
    url: card.url,
    title: card.title,
    rarity,
    archetype,
    cost: base.cost + mod.cost,
    // surcharge : un nom impose la spécialité, « none » la retire
    specialty: override && override.specialty !== undefined
      ? (override.specialty === 'none' ? null : override.specialty)
      : autoSpecialty(card.url, archetype, rarity),
  };

  if (archetype === 'sort') {
    Object.assign(stats, { damage: base.damage * mod.mult, radius: base.radius, buildingRatio: base.buildingRatio });
  } else if (archetype === 'pompe') {
    Object.assign(stats, { hp: base.hp * mod.mult, productionMs: base.productionMs, lifetimeMs: base.lifetimeMs * mod.mult });
  } else {
    Object.assign(stats, {
      hp: base.hp * mod.mult,
      dps: base.dps,   // la rareté renforce les PV, pas les dégâts (la stratégie garde le dernier mot)
      range: base.range,
      speed: base.speed,
      count: base.count,
      targets: base.targets,
    });
  }
  return stats;
}

// ─────────────────────────────────────────────
// ⚔️ Multiplicateur de dégâts selon les contres
// ─────────────────────────────────────────────

function damageMultiplier(attackerArch, targetArch) {
  if (COUNTERS[attackerArch] === targetArch) return COUNTER_BONUS;
  if (COUNTERS[targetArch] === attackerArch) return COUNTER_MALUS;
  return 1;
}

module.exports = {
  ARCHETYPES,
  RARITY_MODS,
  COUNTERS,
  SPECIALTIES_BY_ARCH,
  archetypeFromUrl,
  getCardStats,
  damageMultiplier,
  reloadOverrides,
  getOverride,
};
