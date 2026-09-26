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
//  Mécaniques de style de jeu :
//    🎖 Capitaine  : une carte du deck jamais posée → passif + pouvoir 1×
//    🏳 Rappel     : un groupe fait demi-tour ; sorti du terrain, sa carte
//                    est sauvée (même en cas de défaite)
//    🔥 Rage       : perdre une tour → +2 élixir et +10 % de dégâts 10 s
//    ✨ Spécialités : pouvoirs de certaines cartes (src/game/specialties.js)
//
//  Pas de simulation fixe : 100 ms.
// ═══════════════════════════════════════════════════════════

const { getCardStats, damageMultiplier } = require('./cards');
const specialties = require('./specialties');
const { CAPTAINS, TUNING } = require('./captains');

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

const RAGE = { elixir: 2, ms: 10000, dps: 1.1 };
const RECALL_SPEED = 1.5;   // un groupe rappelé recule 50 % plus vite
const SLOW = 0.6;           // Ralenti : vitesse ×0,6

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
//    players.X = { userId, deck: [{ url, title, rarity }], copies: { url: n },
//                  captain?: url (une carte du deck) }
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
    // Deck = 8 emplacements ; une carte en occupe au plus autant qu'on en
    // possède d'exemplaires. Chaque emplacement se joue UNE fois par combat :
    // copies[url] = poses restantes de cette carte.
    const cards = {};
    const copies = {};
    const slots = [];
    for (const card of p.deck) {
      if (!cards[card.url]) cards[card.url] = getCardStats(card);
      const owned = Math.max(0, (p.copies && p.copies[card.url]) || 0);
      if ((copies[card.url] || 0) < owned) {
        copies[card.url] = (copies[card.url] || 0) + 1;
        slots.push(card.url);
      } else if (copies[card.url] === undefined) {
        copies[card.url] = 0;
      }
    }

    // 🎖 Capitaine : retire un emplacement de sa carte (jamais posée)
    let captain = null;
    const capIdx = p.captain ? slots.indexOf(p.captain) : -1;
    if (capIdx >= 0) {
      slots.splice(capIdx, 1);
      copies[p.captain] -= 1;
      const s = cards[p.captain];
      captain = { url: p.captain, title: s.title, rarity: s.rarity, archetype: s.archetype, power: CAPTAINS[s.archetype].power.key, used: false };
    }
    const arch = captain && captain.archetype;
    if (arch === 'sort') {
      for (const url of Object.keys(cards)) {
        if (cards[url].archetype === 'sort') cards[url] = { ...cards[url], cost: Math.max(1, cards[url].cost - TUNING.spellDiscount) };
      }
    }

    const order = shuffle(state, slots);
    state.players[side] = {
      userId: p.userId,
      elixir: ELIXIR_START + (arch === 'pompe' ? TUNING.startElixir : 0),
      hand: order.slice(0, HAND_SIZE),
      queue: order.slice(HAND_SIZE),
      copies,
      cards,
      captain,
      effects: { overheatUntil: 0, rageUntil: 0, charge: null },
    };

    for (let lane = 0; lane < LANES; lane += 1) {
      state.buildings.push({
        id: state.nextId++, side, kind: 'tower', lane, y: pos(side, 15),
        hp: TOWER.hp, maxHp: TOWER.hp, dps: TOWER.dps,
        range: TOWER.range * (arch === 'tireur' ? TUNING.towerRange : 1),
        alive: true, invulnerableUntil: 0,
      });
    }
    state.buildings.push({
      id: state.nextId++, side, kind: 'qg', lane: null, y: pos(side, 5),
      hp: QG.hp, maxHp: QG.hp, dps: QG.dps, range: QG.range, alive: true, invulnerableUntil: 0,
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
const captainArch = (state, side) => (state.players[side].captain ? state.players[side].captain.archetype : null);
const poseOf = (state, id) => state.poses.find((p) => p.id === id);

function towersDestroyed(state, side) {
  return state.buildings.filter((b) => b.side === side && b.kind === 'tower' && !b.alive).length;
}

function hasPump(state, side) {
  return state.buildings.some((b) => b.side === side && b.kind === 'pompe' && b.alive)
    || state.pending.some((p) => p.side === side && cardStats(state, side, p.url).archetype === 'pompe');
}

// ─────────────────────────────────────────────
// 🧍 Création d'une unité (poses, renforts, invocations)
// ─────────────────────────────────────────────

function makeUnit(state, side, lane, y, props) {
  const unit = {
    id: state.nextId++, side, lane, y,
    poseId: null, url: null, specialty: null, slot: 0, packSize: 1,
    targets: 'all', recalling: false, frozenUntil: 0, slowUntil: 0, shield: 0,
    ...props,
  };
  unit.maxHp = unit.maxHp || unit.hp;
  state.units.push(unit);
  return unit;
}

// ─────────────────────────────────────────────
// 🎮 Actions d'un joueur
//    { type: 'deploy', url, lane, forward? } | { type: 'power', lane? }
//    | { type: 'recall', poseId } | { type: 'forfeit' }
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
  if (action.type === 'power') return usePower(state, side, action, events);
  if (action.type === 'recall') return recall(state, side, action, events);
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

  // 🃏 L'emplacement est dépensé pour tout le combat ; la suivante entre en main
  player.hand.splice(player.hand.indexOf(url), 1);
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
// 🎖 Pouvoir du Capitaine (une fois par combat)
// ─────────────────────────────────────────────

function usePower(state, side, { lane }, events) {
  const player = state.players[side];
  const cap = player.captain;
  if (!cap) return { ok: false, reason: 'no_captain', events };
  if (cap.used) return { ok: false, reason: 'power_used', events };
  const def = CAPTAINS[cap.archetype].power;
  if (def.lane && (!Number.isInteger(lane) || lane < 0 || lane >= LANES)) return { ok: false, reason: 'lane', events };
  const now = state.timeMs;
  const foe = other(side);

  switch (def.key) {
    case 'rempart': {
      const t = towerOf(state, side, lane);
      if (!t.alive) return { ok: false, reason: 'lane', events };
      t.invulnerableUntil = now + TUNING.rempartMs;
      break;
    }
    case 'charge':
      player.effects.charge = { lane, until: now + TUNING.chargeMs };
      break;
    case 'salve': {
      const hits = new Map();
      for (const u of state.units) if (u.side === foe && u.lane === lane) hits.set(u, TUNING.salveDamage);
      applyDamage(state, hits, events);
      break;
    }
    case 'renforts': {
      const base = getCardStats({ url: cap.url, rarity: 'common' });
      const stats = base.archetype === 'essaim' ? base : { hp: 105, dps: 20, range: 2, speed: 11 };
      for (let i = 0; i < TUNING.renforts; i += 1) {
        makeUnit(state, side, lane, pos(side, 20) - dir(side) * i * 0.8, {
          url: cap.url, archetype: 'essaim', hp: stats.hp, dps: stats.dps, range: stats.range, speed: stats.speed,
          slot: i, packSize: TUNING.renforts, summoned: true,
        });
      }
      break;
    }
    case 'surchauffe':
      player.effects.overheatUntil = now + TUNING.surchauffeMs;
      break;
    case 'gel':
      for (const u of state.units) if (u.side === foe && u.lane === lane) u.frozenUntil = now + TUNING.gelMs;
      break;
    default:
      return { ok: false, reason: 'invalid', events };
  }
  cap.used = true;
  events.push({ type: 'power', side, power: def.key, lane: def.lane ? lane : null });
  return { ok: true, events };
}

// ─────────────────────────────────────────────
// 🏳 Rappel : le groupe fait demi-tour ; sorti du terrain (à sa tour),
//    sa carte est sauvée. Tué pendant la retraite : perdu.
// ─────────────────────────────────────────────

function recall(state, side, { poseId }, events) {
  const pose = poseOf(state, poseId);
  if (!pose) return { ok: false, reason: 'invalid', events };
  if (pose.side !== side) return { ok: false, reason: 'not_yours', events };
  const units = state.units.filter((u) => u.poseId === poseId);
  if (pose.status !== 'alive' || !units.length) return { ok: false, reason: 'not_recallable', events };
  if (units.every((u) => u.recalling)) return { ok: false, reason: 'already', events };
  for (const u of units) u.recalling = true;
  events.push({ type: 'recall', side, poseId, lane: units[0].lane });
  return { ok: true, events };
}

// ─────────────────────────────────────────────
// ✨ Apparition d'une pose (1 s après)
// ─────────────────────────────────────────────

function spawn(state, pending, events) {
  const { side, url, lane, forward } = pending;
  const stats = cardStats(state, side, url);
  const pose = poseOf(state, pending.poseId);

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
      archetype: 'pompe', url, invulnerableUntil: 0,
      nextProductionAt: state.timeMs + stats.productionMs,
      productionMs: stats.productionMs,
      expiresAt: state.timeMs + stats.lifetimeMs,
    });
    events.push({ type: 'spawn', side, lane, poseId: pose.id, archetype: 'pompe' });
    return;
  }

  const arch = captainArch(state, side);
  const count = stats.count + (arch === 'essaim' ? TUNING.extraUnit : 0);
  const hp = stats.hp * (arch === 'tank' && stats.archetype === 'tank' ? TUNING.tankHp : 1);
  const speed = stats.speed * (arch === 'guerrier' ? TUNING.rushSpeed : 1);
  const baseY = pos(side, forward ? 60 : 20);
  for (let i = 0; i < count; i += 1) {
    const unit = makeUnit(state, side, lane, baseY - dir(side) * i * 0.8, {   // le groupe arrive en paquet serré
      poseId: pose.id, url, archetype: stats.archetype, specialty: stats.specialty,
      slot: i, packSize: count,
      hp, maxHp: hp, dps: stats.dps, range: stats.range, speed, targets: stats.targets,
    });
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
  const near = (side, radius) => state.units.filter((u) => u.side === side && u.lane === unit.lane && u.hp > 0 && Math.abs(u.y - unit.y) <= radius);
  return spec[hook]({
    state,
    unit,
    ...extra,
    time: state.timeMs,
    dt: STEP_MS / 1000,
    emit: (e) => events.push(e),
    foesNear: (radius) => near(other(unit.side), radius),
    alliesNear: (radius) => near(unit.side, radius),
    hurt: (target, dmg) => { hurt(target, dmg); },
    summon: (props) => makeUnit(state, unit.side, unit.lane, unit.y, { url: unit.url, summoned: true, ...props }),
  });
}

// ─────────────────────────────────────────────
// 🩸 Dégâts (bouclier, invulnérabilité) + morts en chaîne
// ─────────────────────────────────────────────

function hurt(target, dmg) {
  if (target.invulnerableUntil !== undefined && target.kind && target.invulnerableUntil > (target.nowMs || 0)) return;
  let left = dmg;
  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, left);
    target.shield -= absorbed;
    left -= absorbed;
  }
  target.hp -= left;
}

function applyDamage(state, hits, events) {
  for (const [target, dmg] of hits) {
    if (target.kind && target.invulnerableUntil > state.timeMs) continue;   // 🎖 Rempart
    hurt(target, dmg);
  }

  // Morts (les spécialités « à la mort » peuvent en provoquer d'autres)
  for (let guard = 0; guard < 5; guard += 1) {
    const dying = state.units.filter((x) => x.hp <= 0 && !x.dead);
    if (!dying.length) break;
    for (const u of dying) {
      u.dead = true;
      callHook(state, u, 'onDeath', {}, events);
      events.push({ type: 'death', side: u.side, lane: u.lane, poseId: u.poseId, archetype: u.archetype });
    }
  }
  const deadPoses = new Set(state.units.filter((x) => x.dead && x.poseId !== null).map((x) => x.poseId));
  state.units = state.units.filter((x) => !x.dead);
  for (const poseId of deadPoses) {
    if (!state.units.some((x) => x.poseId === poseId)) {
      const pose = poseOf(state, poseId);
      pose.status = pose.recalledHome ? 'recalled' : 'destroyed';
    }
  }

  for (const b of state.buildings) {
    if (!b.alive || b.hp > 0) continue;
    b.hp = 0;
    b.alive = false;
    if (b.kind === 'pompe') poseOf(state, b.poseId).status = 'destroyed';
    events.push({ type: 'destroyed', side: b.side, kind: b.kind, lane: b.lane });
    // 🔥 Rage : le camp qui perd une tour se déchaîne
    if (b.kind === 'tower') {
      const p = state.players[b.side];
      p.elixir = Math.min(ELIXIR_MAX, p.elixir + RAGE.elixir);
      p.effects.rageUntil = state.timeMs + RAGE.ms;
      events.push({ type: 'rage', side: b.side });
    }
  }
}

// ─────────────────────────────────────────────
// ⏩ Un pas de simulation (100 ms)
// ─────────────────────────────────────────────

function step(state, events) {
  state.timeMs += STEP_MS;
  const now = state.timeMs;
  const remaining = state.durationMs - now;
  for (const side of SIDES) {
    const p = state.players[side];
    let regenMs = remaining <= DOUBLE_ELIXIR_MS ? ELIXIR_REGEN_MS / 2 : ELIXIR_REGEN_MS;
    if (p.effects.overheatUntil > now) regenMs /= 2;   // 🎖 Surchauffe
    p.elixir = Math.min(ELIXIR_MAX, p.elixir + STEP_MS / regenMs);
  }

  // ✨ Poses arrivées à échéance
  const ready = state.pending.filter((p) => p.readyAt <= now);
  state.pending = state.pending.filter((p) => p.readyAt > now);
  for (const p of ready) spawn(state, p, events);

  // ⚗️ Pompes : production + expiration
  for (const b of state.buildings) {
    if (b.kind !== 'pompe' || !b.alive) continue;
    if (now >= b.nextProductionAt) {
      const p = state.players[b.side];
      p.elixir = Math.min(ELIXIR_MAX, p.elixir + 1);
      b.nextProductionAt += b.productionMs;
      events.push({ type: 'pump', side: b.side });
    }
    if (now >= b.expiresAt) {
      b.alive = false;
      poseOf(state, b.poseId).status = 'expired';
      events.push({ type: 'expired', side: b.side, lane: b.lane });
    }
  }

  // 🎯 Déplacements et attaques (dégâts appliqués en même temps)
  const dt = STEP_MS / 1000;
  const hits = new Map();
  const hit = (target, dmg) => hits.set(target, (hits.get(target) || 0) + dmg);
  const home = [];

  for (const u of state.units) {
    if (u.frozenUntil > now) continue;   // 🎖 Gel
    const fx = state.players[u.side].effects;
    const charging = fx.charge && fx.charge.until > now && fx.charge.lane === u.lane;
    let speed = u.speed * (u.slowUntil > now ? SLOW : 1) * (charging ? TUNING.chargeSpeed : 1);

    // 🏳 Rappel : recule vers sa tour sans combattre
    if (u.recalling) {
      speed *= RECALL_SPEED;
      u.y -= dir(u.side) * speed * dt;
      if (dir(u.side) * (u.y - pos(u.side, 15)) <= 0) home.push(u);
      continue;
    }

    callHook(state, u, 'onTick', {}, events);
    const target = findTarget(state, u);
    if (!target) continue;
    const dist = Math.abs(target.y - u.y);
    if (dist <= u.range) {
      const targetArch = target.archetype || target.kind;
      let dmg = u.dps * dt * damageMultiplier(u.archetype, targetArch);
      if (charging) dmg *= TUNING.chargeDps;
      if (fx.rageUntil > now) dmg *= RAGE.dps;   // 🔥 Rage
      const modified = callHook(state, u, 'onHit', { target, damage: dmg }, events);
      if (typeof modified === 'number') dmg = modified;
      hit(target, dmg);
    } else {
      u.y += dir(u.side) * Math.min(speed * dt, dist - u.range);
    }
  }
  for (const b of state.buildings) {
    if (!b.alive || !b.dps) continue;
    const target = findBuildingTarget(state, b);
    if (target) hit(target, b.dps * dt);
  }

  // 🏳 Groupes rappelés arrivés à leur tour : sortis, carte sauvée
  for (const u of home) {
    const pose = u.poseId !== null ? poseOf(state, u.poseId) : null;
    if (pose) pose.recalledHome = true;
    hits.delete(u);
  }
  if (home.length) {
    const gone = new Set(home);
    state.units = state.units.filter((u) => !gone.has(u));
    for (const u of home) {
      if (u.poseId !== null && !state.units.some((x) => x.poseId === u.poseId)) {
        poseOf(state, u.poseId).status = 'recalled';
        events.push({ type: 'recalled', side: u.side, poseId: u.poseId });
      }
    }
  }
  applyDamage(state, hits, events);

  // 🏁 Fin : QG détruit, sinon fin du temps
  for (const side of SIDES) {
    if (!qgOf(state, side).alive) return endMatch(state, other(side), 'qg', events);
  }
  if (now >= state.durationMs) endByTime(state, events);
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
//    Poses rappelées = « recalled » (jamais perdues).
// ─────────────────────────────────────────────

function endMatch(state, winner, reason, events = []) {
  if (state.status === 'ended') return events;
  state.status = 'ended';
  for (const p of state.poses) {
    if (p.status === 'pending') p.status = 'alive';
    if (p.status === 'alive' && p.recalledHome) p.status = 'recalled';
  }
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
  const now = state.timeMs;
  const players = {};
  for (const side of SIDES) {
    const p = state.players[side];
    const view = {
      userId: p.userId,
      elixir: p.elixir,
      handCount: p.hand.length,
      towersDestroyed: towersDestroyed(state, other(side)),
      captain: p.captain ? { ...p.captain } : null,
      rage: p.effects.rageUntil > now,
      overheat: p.effects.overheatUntil > now,
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
    timeMs: now,
    remainingMs: Math.max(0, state.durationMs - now),
    doubleElixir: state.durationMs - now <= DOUBLE_ELIXIR_MS,
    players,
    buildings: state.buildings.map(({ id, side, kind, lane, y, hp, maxHp, alive, expiresAt, url, invulnerableUntil }) => ({
      id, side, kind, lane, y, hp, maxHp, alive, expiresAt, url, shielded: invulnerableUntil > now,
    })),
    units: state.units.map((u) => ({
      id: u.id, side: u.side, lane: u.lane, y: u.y, hp: u.hp, maxHp: u.maxHp, archetype: u.archetype, url: u.url,
      poseId: u.poseId, slot: u.slot, packSize: u.packSize, specialty: u.specialty || null,
      recalling: u.recalling || false, frozen: u.frozenUntil > now, slowed: u.slowUntil > now, shield: u.shield > 0,
    })),
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
