// ═══════════════════════════════════════════════════════════
//  🃏 MODULE CARTES (Arène)
//  Stats de combat d'une carte Jeanpip : archétype + rareté.
//
//  Archétype :
//    1. data/card-overrides.json s'il a une entrée pour la carte
//       { "<url>": { "archetype": "tank", "specialty": "..." } }
//    2. sinon tirage STABLE : sha256(url) → [0, 100) → répartition `share`.
//
//  Rareté : renforce les PV (et les dégâts d'un Sort, la garde / la durée
//  d'une Vigie), jamais les dégâts des unités ; à moitié pour l'Essaim.
//  Les épiques / légendaires reçoivent en plus une spécialité.
//  Réglé par la simulation (v2.3, avec la Vigie) : à stratégie égale un deck riche gagne ~76 %
//  (combats presque tous départagés aux PV, très peu de tours tombées),
//  mais un bon joueur 100 % commun bat un mauvais joueur au deck riche ~69 %.
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
  tireur:   { key: 'tireur',   label: 'Tireur',   emoji: '🏹', share: 23, cost: 3, hp: 115, dps: 29,   range: 10, speed: 9,  count: 3, targets: 'all' },
  essaim:   { key: 'essaim',   label: 'Essaim',   emoji: '🐝', share: 15, cost: 3, hp: 105, dps: 20,   range: 2,  speed: 11, count: 6, targets: 'all', rarityWeight: 0.5 },
  sort:     { key: 'sort',     label: 'Sort',     emoji: '💥', share: 10, cost: 4, damage: 350, radius: 6, buildingRatio: 0.4 },
  // 🗼 Vigie (v2.3, à la place exacte de l'ancienne Pompe dans le tirage) : monte sur une tour de
  //    son camp. Garde = PV qui encaissent avant la tour ; tir +40 % ; portée +2
  //    (v2.3, simulation avec départage des nuls : garde 250 → 200, tir +60 % → +40 %, portée +4 → +2).
  vigie:    { key: 'vigie',    label: 'Vigie',    emoji: '🗼', share: 5,  cost: 4, durationMs: 40000, guard: 200, dpsBonus: 0.4, rangeBonus: 2 },
};

// Anciens noms d'archétypes (surcharges écrites avant la v2.3) → nom actuel
const RENAMED = { pompe: 'vigie' };

const RARITY_MODS = {
  common:    { mult: 1,    cost: 0 },
  rare:      { mult: 1.06, cost: 0 },
  epic:      { mult: 1.11, cost: 0 },
  legendary: { mult: 1.16, cost: 0 },
  rose:      { mult: 1.11, cost: 0 },   // 🎀 Octobre Rose (hors série) = puissance d'une épique
};

// attaquant → archétype qu'il contre
// ✨ Spécialités tirées automatiquement pour les épiques / légendaires
const SPECIAL_RARITIES = ['epic', 'legendary', 'rose'];
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

/** Archétype imposé par une surcharge (ancien nom traduit : « pompe » → « vigie »), ou null. */
function overrideArchetype(override) {
  if (!override || !override.archetype) return null;
  const key = RENAMED[override.archetype] || override.archetype;
  return ARCHETYPES[key] ? key : null;
}

/**
 * ⚔️ Impose le type (archétype) d'une carte — panneau Admin de l'Accueil,
 * ou à l'ajout d'un média. `archetype` = null → retour au tirage automatique.
 * Écrit data/card-overrides.json (les autres réglages de la carte sont gardés).
 * → { ok, archetype } | { ok: false, error }
 */
function setArchetype(url, archetype) {
  if (!url) return { ok: false, error: 'carte' };
  if (archetype !== null && !ARCHETYPES[archetype]) return { ok: false, error: 'type' };
  const data = { ...reloadOverrides() };
  const entry = { ...(data[url] || {}) };
  if (archetype) entry.archetype = archetype;
  else delete entry.archetype;
  if (Object.keys(entry).length) data[url] = entry;
  else delete data[url];
  try {
    fs.mkdirSync(path.dirname(OVERRIDES_PATH), { recursive: true });
    const tmp = `${OVERRIDES_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, OVERRIDES_PATH);
  } catch (e) {
    return { ok: false, error: 'ecriture', detail: e.message };
  }
  overrides = data;
  return { ok: true, archetype: archetype || archetypeFromUrl(url), auto: !archetype };
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
  const archetype = overrideArchetype(override) || archetypeFromUrl(card.url);
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
  } else if (archetype === 'vigie') {
    // la rareté allonge la durée et renforce la garde ; le tir et la portée restent ceux de la carte
    Object.assign(stats, { durationMs: base.durationMs * mod.mult, guard: base.guard * mod.mult, dpsBonus: base.dpsBonus, rangeBonus: base.rangeBonus });
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
  overrideArchetype,
  setArchetype,
};
