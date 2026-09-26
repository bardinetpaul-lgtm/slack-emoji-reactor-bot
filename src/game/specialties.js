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
  charge:     { emoji: '⚡', label: 'Charge',     desc: 'Frappe deux fois plus fort pendant ses 1,5 premières secondes de combat.' },
  bouclier:   { emoji: '🛡', label: 'Bouclier',   desc: 'Un bouclier absorbe 30 % de ses PV en dégâts.' },
  vampire:    { emoji: '🩸', label: 'Vampire',    desc: 'Récupère 30 % des dégâts qu’il inflige.' },
  explosion:  { emoji: '💣', label: 'Explosion',  desc: 'Explose à sa mort et blesse les ennemis autour.' },
  invocation: { emoji: '👻', label: 'Invocation', desc: 'À sa mort, deux petits guerriers prennent le relais.' },
  ralenti:    { emoji: '🧊', label: 'Ralenti',    desc: 'Ralentit de 40 % les ennemis qu’il touche.' },
  soin:       { emoji: '💚', label: 'Soin',       desc: 'Soigne les alliés proches de 10 PV par seconde.' },
};

// ─────────────────────────────────────────────
// ⚙️ Les spécialités
// ─────────────────────────────────────────────

register('charge', {
  onDeploy: ({ unit }) => { unit.chargeLeftMs = 1500; },
  onHit: ({ unit, damage, dt }) => {
    if (unit.chargeLeftMs > 0) {
      unit.chargeLeftMs -= dt * 1000;
      return damage * 2;
    }
    return damage;
  },
});

register('bouclier', {
  onDeploy: ({ unit }) => { unit.shield = unit.maxHp * 0.3; },
});

register('vampire', {
  onHit: ({ unit, damage }) => {
    unit.hp = Math.min(unit.maxHp, unit.hp + damage * 0.3);
    return damage;
  },
});

register('explosion', {
  onDeath: ({ unit, foesNear, hurt, emit }) => {
    for (const foe of foesNear(4)) hurt(foe, unit.dps * 2.5);
    emit({ type: 'explosion', side: unit.side, lane: unit.lane, y: unit.y });
  },
});

register('invocation', {
  onDeath: ({ unit, summon }) => {
    for (let i = 0; i < 2; i += 1) {
      summon({ archetype: 'guerrier', hp: 60, dps: 12, range: 2, speed: 8, targets: 'all', slot: i, packSize: 2 });
    }
  },
});

register('ralenti', {
  onHit: ({ target, damage, time }) => {
    if (target && target.poseId !== undefined && target.kind === undefined) target.slowUntil = time + 1500;
    return damage;
  },
});

register('soin', {
  onTick: ({ alliesNear, dt }) => {
    for (const ally of alliesNear(6)) ally.hp = Math.min(ally.maxHp, ally.hp + 10 * dt);
  },
});

module.exports = { register, get, list, INFO };
