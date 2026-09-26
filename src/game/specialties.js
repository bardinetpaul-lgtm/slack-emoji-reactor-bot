// ═══════════════════════════════════════════════════════════
//  ✨ MODULE SPÉCIALITÉS (Arène)
//  Pouvoirs propres à certaines cartes. Les épiques et légendaires en
//  reçoivent une automatiquement (selon leur archétype, src/game/cards.js) ;
//  data/card-overrides.json permet d'en imposer une ou d'en retirer
//  (« specialty": "none" »).
//
//  Une spécialité = des points d'accroche appelés par le moteur :
//    onDeploy(ctx)          → à l'apparition de l'unité
//    onHit(ctx) → dégâts    → quand l'unité frappe (peut modifier les dégâts)
//    onDeath(ctx)           → quand l'unité meurt
//    onTick(ctx)            → à chaque pas (100 ms)
//  ctx = { state, unit, target?, damage?, time, dt, emit(event),
//          foesNear(radius), alliesNear(radius), hurt(cible, dégâts), summon(props) }
//
//  Toute nouvelle spécialité se valide avec scripts/simulate-balance.js.
// ═══════════════════════════════════════════════════════════

const registry = {};

function register(name, hooks) {
  registry[name] = hooks;
}

function get(name) {
  return (name && registry[name]) || null;
}

function list() {
  return Object.keys(registry);
}

// ─────────────────────────────────────────────
// 📖 Textes pour l'interface
// ─────────────────────────────────────────────

const INFO = {
  charge:     { emoji: '⚡', label: 'Charge',     desc: 'Frappe 30 % plus fort pendant sa première seconde de combat.' },
  bouclier:   { emoji: '🛡', label: 'Bouclier',   desc: 'Un bouclier absorbe 12 % de ses PV en dégâts.' },
  vampire:    { emoji: '🩸', label: 'Vampire',    desc: 'Récupère 12 % des dégâts qu’il inflige.' },
  explosion:  { emoji: '💣', label: 'Explosion',  desc: 'Explose à sa mort et blesse les ennemis autour.' },
  invocation: { emoji: '👻', label: 'Invocation', desc: 'À sa mort, un petit guerrier prend le relais.' },
  ralenti:    { emoji: '🧊', label: 'Ralenti',    desc: 'Ralentit de 40 % les ennemis qu’il touche.' },
  soin:       { emoji: '💚', label: 'Soin',       desc: 'Soigne les alliés proches de 2,5 PV par seconde.' },
};

// ─────────────────────────────────────────────
// ⚙️ Les spécialités
// ─────────────────────────────────────────────

// Valeurs réglées par scripts/simulate-balance.js
const T = {
  chargeMs: 800, chargeMult: 1.3,
  shield: 0.12,
  vampire: 0.12,
  explosionDps: 0.1, explosionRadius: 2,
  summonHp: 50, summonDps: 10, summonCount: 1,
  slowMs: 1500,
  heal: 2.5,
};

register('charge', {
  onDeploy: ({ unit }) => { unit.chargeLeftMs = T.chargeMs; },
  onHit: ({ unit, damage, dt }) => {
    if (unit.chargeLeftMs > 0) {
      unit.chargeLeftMs -= dt * 1000;
      return damage * T.chargeMult;
    }
    return damage;
  },
});

register('bouclier', {
  onDeploy: ({ unit }) => { unit.shield = unit.maxHp * T.shield; },
});

register('vampire', {
  onHit: ({ unit, damage }) => {
    unit.hp = Math.min(unit.maxHp, unit.hp + damage * T.vampire);
    return damage;
  },
});

register('explosion', {
  onDeath: ({ unit, foesNear, hurt, emit }) => {
    for (const foe of foesNear(T.explosionRadius)) hurt(foe, unit.dps * T.explosionDps);
    emit({ type: 'explosion', side: unit.side, lane: unit.lane, y: unit.y });
  },
});

register('invocation', {
  onDeath: ({ unit, summon }) => {
    for (let i = 0; i < T.summonCount; i += 1) {
      summon({ archetype: 'guerrier', hp: T.summonHp, dps: T.summonDps, range: 2, speed: 8, targets: 'all', slot: i, packSize: 2 });
    }
  },
});

register('ralenti', {
  onHit: ({ target, damage, time }) => {
    if (target && target.poseId !== undefined && target.kind === undefined) target.slowUntil = time + T.slowMs;
    return damage;
  },
});

register('soin', {
  onTick: ({ alliesNear, dt }) => {
    for (const ally of alliesNear(6)) ally.hp = Math.min(ally.maxHp, ally.hp + T.heal * dt);
  },
});

module.exports = { register, get, list, INFO };
