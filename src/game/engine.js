// ═══════════════════════════════════════════════════════════
//  ⚔️ MODULE MOTEUR DE COMBAT (Arène)
//  Simulation PURE d'un combat 1 contre 1 : aucun I/O, aucun timer,
//  aléa à graine → un même combat (graine + actions) se rejoue à
//  l'identique. Utilisé par les vrais combats (src/game/matches.js)
//  ET par la simulation d'équilibrage (scripts/simulate-balance.js).
//
//  Les fonctions MUTENT l'état qu'on leur passe et renvoient la liste
//  des événements produits (pour l'affichage / les logs).
//
//  Terrain : 3 couloirs, axe y de 0 (camp A) à 100 (camp B).
//    QG A y=5   · tours A y=15 · pose A y=20 (avancée y=60 si brèche)
//    QG B y=95  · tours B y=85 · pose B y=80 (avancée y=40 si brèche)
//    Pompe posée devant sa tour (A y=18, B y=82).
//
//  Pas de simulation fixe : 100 ms.
// ═══════════════════════════════════════════════════════════

const { getCardStats, damageMultiplier } = require('./cards');
const specialties = require('./specialties');

const STEP_MS = 100;
const DURATION_MS = 120000;
const DOUBLE_ELIXIR_MS = 60000;   // double élixir quand il reste ≤ 60 s
const ELIXIR_START = 5;
const ELIXIR_MAX = 10;
const ELIXIR_REGEN_MS = 2800;
const DEPLOY_DELAY_MS = 1000;
const HAND_SIZE = 4;
const LANES = 3;

const TOWER = { hp: 600, dps: 80, range: 12 };
const QG = { hp: 2000, dps: 100, range: 10 };

const SIDES = ['A', 'B'];
const other = (side) => (side === 'A' ? 'B' : 'A');
const dir = (side) => (side === 'A' ? 1 : -1);
// Position sur l'axe, vue depuis le camp A (le camp B est symétrique)
const pos = (side, yFromA) => (side === 'A' ? yFromA : 100 - yFromA);

// ─────────────────────────────────────────────
// 🎲 Aléa à graine (mulberry32)
// ─────────────────────────────────────────────

function nextRandom(state) {
  state.rng = (state.rng + 0x6D2B79F5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffle(state, list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextRandom(state) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─────────────────────────────────────────────
// 🏗️ Création d'un combat
//    players.X = { userId, deck: [{ url, title, rarity }], copies: { url: n } }
// ─────────────────────────────────────────────

function createMatch({ id, seed = 1, players }) {
  const state = {
    id,
    rng: seed >>> 0,
    timeMs: 0,
    durationMs: DURATION_MS,
    status: 'running',
    nextId: 1,
    players: {},
    buildings: [],
    units: [],
    pending: [],
    poses: [],
    result: null,
  };

  for (const side of SIDES) {
    const p = players[side];
    const cards = {};
    const copies = {};
    for (const card of p.deck) {
      cards[card.url] = getCardStats(card);
      copies[card.url] = Math.max(0, (p.copies && p.copies[card.url]) || 0);
    }
    const order = shuffle(state, p.deck.map((c) => c.url).filter((u) => copies[u] > 0));
    state.players[side] = {
      userId: p.userId,
      elixir: ELIXIR_START,
      hand: order.slice(0, HAND_SIZE),
      queue: order.slice(HAND_SIZE),
      copies,
      cards,
    };

    for (let lane = 0; lane < LANES; lane += 1) {
      state.buildings.push({
        id: state.nextId++, side, kind: 'tower', lane, y: pos(side, 15),
        hp: TOWER.hp, maxHp: TOWER.hp, dps: TOWER.dps, range: TOWER.range, alive: true,
      });
    }
    state.buildings.push({
      id: state.nextId++, side, kind: 'qg', lane: null, y: pos(side, 5),
      hp: QG.hp, maxHp: QG.hp, dps: QG.dps, range: QG.range, alive: true,
    });
  }
  return state;
}

// ─────────────────────────────────────────────
// 🔎 Petits accès
// ─────────────────────────────────────────────

const cardStats = (state, side, url) => state.players[side].cards[url];
const towerOf = (state, side, lane) => state.buildings.find((b) => b.side === side && b.kind === 'tower' && b.lane === lane);
const qgOf = (state, side) => state.buildings.find((b) => b.side === side && b.kind === 'qg');

function towersDestroyed(state, side) {
  return state.buildings.filter((b) => b.side === side && b.kind === 'tower' && !b.alive).length;
}

function hasPump(state, side) {
  return state.buildings.some((b) => b.side === side && b.kind === 'pompe' && b.alive)
    || state.pending.some((p) => p.side === side && cardStats(state, side, p.url).archetype === 'pompe');
}

// ─────────────────────────────────────────────
// 🎮 Actions d'un joueur
//    { type: 'deploy', url, lane, forward? } | { type: 'forfeit' }
//    → { ok, reason?, events }
// ─────────────────────────────────────────────

function applyAction(state, side, action) {
  const events = [];
  if (state.status !== 'running') return { ok: false, reason: 'not_running', events };
  if (!action || !SIDES.includes(side)) return { ok: false, reason: 'invalid', events };

  if (action.type === 'forfeit') {
    endMatch(state, other(side), 'forfeit', events);
    return { ok: true, events };
  }
  if (action.type !== 'deploy') return { ok: false, reason: 'invalid', events };

  const player = state.players[side];
  const { url, lane } = action;
  const forward = Boolean(action.forward);
  if (!Number.isInteger(lane) || lane < 0 || lane >= LANES) return { ok: false, reason: 'lane', events };
  if (!player.hand.includes(url)) return { ok: false, reason: 'not_in_hand', events };
  const stats = cardStats(state, side, url);
  if (player.elixir < stats.cost) return { ok: false, reason: 'elixir', events };
  if (forward && towerOf(state, other(side), lane).alive) return { ok: false, reason: 'no_breach', events };
  if (stats.archetype === 'pompe' && hasPump(state, side)) return { ok: false, reason: 'pump_active', events };

  // 💧 Paiement + engagement d'un exemplaire
  player.elixir -= stats.cost;
  player.copies[url] -= 1;

  // 🔁 Cycle : la carte repart en fin de file s'il reste des exemplaires
  player.hand.splice(player.hand.indexOf(url), 1);
  if (player.copies[url] > 0) player.queue.push(url);
  if (player.queue.length && player.hand.length < HAND_SIZE) player.hand.push(player.queue.shift());

  const pose = {
    id: state.nextId++, side, url, title: stats.title, rarity: stats.rarity,
    archetype: stats.archetype, status: 'pending',
  };
  state.poses.push(pose);
  state.pending.push({ poseId: pose.id, side, url, lane, forward, readyAt: state.timeMs + DEPLOY_DELAY_MS });

  events.push({ type: 'deploy', side, url, lane, forward, poseId: pose.id, archetype: stats.archetype });
  return { ok: true, events };
}

// ─────────────────────────────────────────────
// ✨ Apparition d'une pose (1 s après)
// ─────────────────────────────────────────────

function spawn(state, pending, events) {
  const { side, url, lane, forward } = pending;
  const stats = cardStats(state, side, url);
  const pose = state.poses.find((p) => p.id === pending.poseId);

  if (stats.archetype === 'sort') {
    castSpell(state, side, lane, stats, events);
    pose.status = 'destroyed';   // un Sort est toujours consommé
    return;
  }

  pose.status = 'alive';

  if (stats.archetype === 'pompe') {
    state.buildings.push({
      id: state.nextId++, side, kind: 'pompe', lane, y: pos(side, 18),
      hp: stats.hp, maxHp: stats.hp, dps: 0, range: 0, alive: true, poseId: pose.id,
      archetype: 'pompe', url,
      nextProductionAt: state.timeMs + stats.productionMs,
      productionMs: stats.productionMs,
      expiresAt: state.timeMs + stats.lifetimeMs,
    });
    events.push({ type: 'spawn', side, lane, poseId: pose.id, archetype: 'pompe' });
    return;
  }

  const baseY = pos(side, forward ? 60 : 20);
  for (let i = 0; i < stats.count; i += 1) {
    const unit = {
      id: state.nextId++, side, lane, poseId: pose.id, url,
      archetype: stats.archetype, specialty: stats.specialty,
      y: baseY - dir(side) * i * 0.8,   // le groupe arrive en paquet serré
      slot: i, packSize: stats.count,
      hp: stats.hp, maxHp: stats.hp, dps: stats.dps,
      range: stats.range, speed: stats.speed, targets: stats.targets,
    };
    state.units.push(unit);
    callHook(state, unit, 'onDeploy', {}, events);
  }
  events.push({ type: 'spawn', side, lane, poseId: pose.id, archetype: stats.archetype });
}

// ─────────────────────────────────────────────
// 💥 Sort : frappe la 1re unité ennemie du couloir (sinon Pompe,
//    tour ou QG), dégâts de zone, 40 % sur les bâtiments.
// ─────────────────────────────────────────────

function castSpell(state, side, lane, stats, events) {
  const foe = other(side);
  const d = dir(side);
  const foeUnits = state.units.filter((u) => u.side === foe && u.lane === lane);
  let centerY;
  if (foeUnits.length) {
    // la plus avancée vers moi = la plus petite distance à mon camp
    centerY = foeUnits.reduce((best, u) => (d * u.y < d * best.y ? u : best)).y;
  } else {
    const building = state.buildings.find((b) => b.side === foe && b.alive && b.kind === 'pompe' && b.lane === lane)
      || [towerOf(state, foe, lane)].find((b) => b.alive)
      || qgOf(state, foe);
    centerY = building.y;
  }

  const hits = new Map();
  for (const u of foeUnits) {
    if (Math.abs(u.y - centerY) <= stats.radius) hits.set(u, stats.damage * damageMultiplier('sort', u.archetype));
  }
  for (const b of state.buildings) {
    if (b.side !== foe || !b.alive) continue;
    if (b.kind !== 'qg' && b.lane !== lane) continue;
    if (Math.abs(b.y - centerY) <= stats.radius) hits.set(b, stats.damage * stats.buildingRatio);
  }
  events.push({ type: 'spell', side, lane, y: centerY });
  applyDamage(state, hits, events);
}

// ─────────────────────────────────────────────
// 🎯 Cible d'une unité : la plus proche devant elle (ou à portée)
//    parmi unités ennemies du couloir (sauf Tank), Pompe du couloir,
//    tour du couloir, et QG seulement si la tour est tombée.
// ─────────────────────────────────────────────

function findTarget(state, unit) {
  const foe = other(unit.side);
  const d = dir(unit.side);
  const candidates = [];
  if (unit.targets === 'all') {
    for (const u of state.units) if (u.side === foe && u.lane === unit.lane && u.hp > 0) candidates.push(u);
  }
  for (const b of state.buildings) {
    if (b.side !== foe || !b.alive) continue;
    if (b.kind === 'pompe' && b.lane === unit.lane) candidates.push(b);
    if (b.kind === 'tower' && b.lane === unit.lane) candidates.push(b);
  }
  const tower = towerOf(state, foe, unit.lane);
  if (!tower.alive) candidates.push(qgOf(state, foe));

  let best = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const ahead = d * (c.y - unit.y);
    if (ahead < -unit.range) continue;   // derrière elle, hors de portée
    const dist = Math.abs(c.y - unit.y);
    if (dist < bestDist) { best = c; bestDist = dist; }
  }
  return best;
}

// Cible d'une tour / du QG : unité ennemie la plus proche à portée
function findBuildingTarget(state, building) {
  const foe = other(building.side);
  let best = null;
  let bestDist = Infinity;
  for (const u of state.units) {
    if (u.side !== foe || u.hp <= 0) continue;
    if (building.kind === 'tower' && u.lane !== building.lane) continue;
    if (building.kind === 'qg' && towerOf(state, building.side, u.lane).alive) continue;
    const dist = Math.abs(u.y - building.y);
    if (dist <= building.range && dist < bestDist) { best = u; bestDist = dist; }
  }
  return best;
}

// ─────────────────────────────────────────────
// 🧩 Spécialités (points d'accroche)
// ─────────────────────────────────────────────

function callHook(state, unit, hook, extra, events) {
  const spec = specialties.get(unit.specialty);
  if (!spec || typeof spec[hook] !== 'function') return undefined;
  return spec[hook]({ state, unit, ...extra, emit: (e) => events.push(e) });
}

// ─────────────────────────────────────────────
// 🩸 Dégâts simultanés + morts
// ─────────────────────────────────────────────

function applyDamage(state, hits, events) {
  for (const [target, dmg] of hits) target.hp -= dmg;

  for (const u of state.units.filter((x) => x.hp <= 0)) {
    callHook(state, u, 'onDeath', {}, events);
    events.push({ type: 'death', side: u.side, lane: u.lane, poseId: u.poseId, archetype: u.archetype });
  }
  const dead = new Set(state.units.filter((x) => x.hp <= 0).map((x) => x.poseId));
  state.units = state.units.filter((x) => x.hp > 0);
  for (const poseId of dead) {
    if (!state.units.some((x) => x.poseId === poseId)) {
      state.poses.find((p) => p.id === poseId).status = 'destroyed';
    }
  }

  for (const b of state.buildings) {
    if (!b.alive || b.hp > 0) continue;
    b.hp = 0;
    b.alive = false;
    if (b.kind === 'pompe') state.poses.find((p) => p.id === b.poseId).status = 'destroyed';
    events.push({ type: 'destroyed', side: b.side, kind: b.kind, lane: b.lane });
  }
}

// ─────────────────────────────────────────────
// ⏩ Un pas de simulation (100 ms)
// ─────────────────────────────────────────────

function step(state, events) {
  state.timeMs += STEP_MS;
  const remaining = state.durationMs - state.timeMs;
  const regenMs = remaining <= DOUBLE_ELIXIR_MS ? ELIXIR_REGEN_MS / 2 : ELIXIR_REGEN_MS;
  for (const side of SIDES) {
    const p = state.players[side];
    p.elixir = Math.min(ELIXIR_MAX, p.elixir + STEP_MS / regenMs);
  }

  // ✨ Poses arrivées à échéance
  const ready = state.pending.filter((p) => p.readyAt <= state.timeMs);
  state.pending = state.pending.filter((p) => p.readyAt > state.timeMs);
  for (const p of ready) spawn(state, p, events);

  // ⚗️ Pompes : production + expiration
  for (const b of state.buildings) {
    if (b.kind !== 'pompe' || !b.alive) continue;
    if (state.timeMs >= b.nextProductionAt) {
      const p = state.players[b.side];
      p.elixir = Math.min(ELIXIR_MAX, p.elixir + 1);
      b.nextProductionAt += b.productionMs;
      events.push({ type: 'pump', side: b.side });
    }
    if (state.timeMs >= b.expiresAt) {
      b.alive = false;
      state.poses.find((p) => p.id === b.poseId).status = 'expired';
      events.push({ type: 'expired', side: b.side, lane: b.lane });
    }
  }

  // 🎯 Déplacements et attaques (dégâts appliqués en même temps)
  const dt = STEP_MS / 1000;
  const hits = new Map();
  const hit = (target, dmg) => hits.set(target, (hits.get(target) || 0) + dmg);

  for (const u of state.units) {
    callHook(state, u, 'onTick', {}, events);
    const target = findTarget(state, u);
    if (!target) continue;
    const dist = Math.abs(target.y - u.y);
    if (dist <= u.range) {
      const targetArch = target.archetype || target.kind;
      let dmg = u.dps * dt * damageMultiplier(u.archetype, targetArch);
      const modified = callHook(state, u, 'onHit', { target, damage: dmg }, events);
      if (typeof modified === 'number') dmg = modified;
      hit(target, dmg);
    } else {
      u.y += dir(u.side) * Math.min(u.speed * dt, dist - u.range);
    }
  }
  for (const b of state.buildings) {
    if (!b.alive || !b.dps) continue;
    const target = findBuildingTarget(state, b);
    if (target) hit(target, b.dps * dt);
  }
  applyDamage(state, hits, events);

  // 🏁 Fin : QG détruit, sinon fin du temps
  for (const side of SIDES) {
    if (!qgOf(state, side).alive) return endMatch(state, other(side), 'qg', events);
  }
  if (state.timeMs >= state.durationMs) endByTime(state, events);
}

function endByTime(state, events) {
  const tA = towersDestroyed(state, 'B');   // tours détruites PAR A
  const tB = towersDestroyed(state, 'A');
  if (tA !== tB) return endMatch(state, tA > tB ? 'A' : 'B', 'towers', events);
  const hpA = qgOf(state, 'A').hp / QG.hp;
  const hpB = qgOf(state, 'B').hp / QG.hp;
  if (Math.abs(hpA - hpB) > 1e-9) return endMatch(state, hpA > hpB ? 'A' : 'B', 'qg_hp', events);
  return endMatch(state, null, 'draw', events);
}

// ─────────────────────────────────────────────
// 🏁 Fin du combat → state.result
//    Poses en attente d'apparition = encore « vivantes ».
// ─────────────────────────────────────────────

function endMatch(state, winner, reason, events = []) {
  if (state.status === 'ended') return events;
  state.status = 'ended';
  for (const p of state.poses) if (p.status === 'pending') p.status = 'alive';
  state.result = {
    winner,
    reason,
    poses: state.poses.map(({ side, url, title, rarity, archetype, status }) => ({ side, url, title, rarity, archetype, status })),
  };
  events.push({ type: 'end', winner, reason });
  return events;
}

// ─────────────────────────────────────────────
// ⏱ Avancer le temps de `dtMs` (par pas de 100 ms)
// ─────────────────────────────────────────────

function tick(state, dtMs) {
  const events = [];
  let left = dtMs;
  while (left >= STEP_MS && state.status === 'running') {
    step(state, events);
    left -= STEP_MS;
  }
  return events;
}

// ─────────────────────────────────────────────
// 👁 Vue d'un joueur (main adverse cachée)
// ─────────────────────────────────────────────

function publicState(state, viewer) {
  const players = {};
  for (const side of SIDES) {
    const p = state.players[side];
    const view = {
      userId: p.userId,
      elixir: p.elixir,
      handCount: p.hand.length,
      towersDestroyed: towersDestroyed(state, other(side)),
    };
    if (side === viewer) {
      view.hand = p.hand.map((url) => ({ ...p.cards[url], copies: p.copies[url] }));
      view.next = p.queue[0] ? { ...p.cards[p.queue[0]] } : null;
    }
    players[side] = view;
  }
  return {
    id: state.id,
    you: viewer,
    status: state.status,
    timeMs: state.timeMs,
    remainingMs: Math.max(0, state.durationMs - state.timeMs),
    doubleElixir: state.durationMs - state.timeMs <= DOUBLE_ELIXIR_MS,
    players,
    buildings: state.buildings.map(({ id, side, kind, lane, y, hp, maxHp, alive, expiresAt, url }) => ({ id, side, kind, lane, y, hp, maxHp, alive, expiresAt, url })),
    units: state.units.map(({ id, side, lane, y, hp, maxHp, archetype, url, poseId, slot, packSize }) => ({ id, side, lane, y, hp, maxHp, archetype, url, poseId, slot, packSize })),
    pending: state.pending.map(({ side, url, lane, forward, readyAt }) => ({ side, url, lane, forward, readyAt, archetype: cardStats(state, side, url).archetype })),
    result: state.result,
  };
}

module.exports = {
  STEP_MS,
  DURATION_MS,
  LANES,
  createMatch,
  applyAction,
  tick,
  endMatch,
  publicState,
  cardStats,
  towersDestroyed,
};
