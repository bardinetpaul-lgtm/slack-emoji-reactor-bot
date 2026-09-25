// ═══════════════════════════════════════════════════════════
//  🧩 MODULE SPÉCIALITÉS (Arène)
//  Registre des pouvoirs spéciaux attribuables à certaines cartes
//  via data/card-overrides.json (champ `specialty`).
//
//  Une spécialité = un objet de points d'accroche, tous optionnels,
//  appelés par le moteur (src/game/engine.js) :
//    onDeploy(ctx)          → à l'apparition de l'unité
//    onHit(ctx) → dégâts    → quand l'unité frappe (peut modifier les dégâts)
//    onDeath(ctx)           → quand l'unité meurt
//    onTick(ctx)            → à chaque pas de simulation (100 ms)
//  ctx = { state, unit, target?, damage?, emit(event) }
//
//  Vide en V1 : chaque nouvelle spécialité se valide avec
//  scripts/simulate-balance.js avant d'arriver en prod.
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

module.exports = { register, get, list };
