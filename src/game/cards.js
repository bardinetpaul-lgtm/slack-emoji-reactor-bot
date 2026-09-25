// ═══════════════════════════════════════════════════════════
//  🃏 MODULE CARTES (Arène)
//  Stats de combat d'une carte Jeanpip : archétype + rareté.
//
//  Archétype :
//    1. data/card-overrides.json s'il a une entrée pour la carte
//       { "<url>": { "archetype": "tank", "specialty": "..." } }
//    2. sinon tirage STABLE : sha256(url) → [0, 100) → répartition `share`.
//
//  Rareté : multiplie les stats (pas la cadence de la Pompe ; à moitié
//  pour l'Essaim) et peut ajouter un surcoût en élixir.
//
//  Contres : l'attaquant fait ×1,5 à ce qu'il contre, ×0,67 à ce
//  qui le contre. Tank → Guerrier → Tireur → Essaim → Tank ; Sort → Essaim.
//
//  Unités du terrain : distance en « cases » (couloir de 0 à 100),
//  vitesse en cases/s, durées en ms.
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OVERRIDES_PATH = path.join(__dirname, '..', '..', 'data', 'card-overrides.json');

// ─────────────────────────────────────────────
// 🎭 Archétypes (valeurs d'une carte COMMUNE)
//    `share` = part des cartes (total 100)
// ─────────────────────────────────────────────

const ARCHETYPES = {
  tank:     { key: 'tank',     label: 'Tank',     emoji: '🛡', share: 20, cost: 5, hp: 1400, dps: 45, range: 2,  speed: 6,  count: 1, targets: 'buildings' },
  guerrier: { key: 'guerrier', label: 'Guerrier', emoji: '⚔️', share: 27, cost: 3, hp: 500,  dps: 70, range: 2,  speed: 8,  count: 1, targets: 'all' },
  tireur:   { key: 'tireur',   label: 'Tireur',   emoji: '🏹', share: 23, cost: 3, hp: 320,  dps: 80, range: 10, speed: 8,  count: 1, targets: 'all' },
  essaim:   { key: 'essaim',   label: 'Essaim',   emoji: '🐝', share: 15, cost: 3, hp: 230,  dps: 42, range: 2,  speed: 11, count: 3, targets: 'all', rarityWeight: 0.5 },
  sort:     { key: 'sort',     label: 'Sort',     emoji: '💥', share: 10, cost: 4, damage: 350, radius: 6, buildingRatio: 0.4 },
  pompe:    { key: 'pompe',    label: 'Pompe',    emoji: '⚗️', share: 5,  cost: 4, hp: 500, productionMs: 7000, lifetimeMs: 45000 },
};

const RARITY_MODS = {
  common:    { mult: 1,    cost: 0 },
  rare:      { mult: 1.06, cost: 0 },
  epic:      { mult: 1.13, cost: 0 },
  legendary: { mult: 1.2, cost: 0 },
};

// attaquant → archétype qu'il contre
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
    specialty: (override && override.specialty) || null,
  };

  if (archetype === 'sort') {
    Object.assign(stats, { damage: base.damage * mod.mult, radius: base.radius, buildingRatio: base.buildingRatio });
  } else if (archetype === 'pompe') {
    Object.assign(stats, { hp: base.hp * mod.mult, productionMs: base.productionMs, lifetimeMs: base.lifetimeMs * mod.mult });
  } else {
    Object.assign(stats, {
      hp: base.hp * mod.mult,
      dps: base.dps * mod.mult,
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
  archetypeFromUrl,
  getCardStats,
  damageMultiplier,
  reloadOverrides,
  getOverride,
};
