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
//  Terrain OUVERT (2026-09-28 : plus de couloirs) :
//    x de 0 (gauche du camp A) à 100, y de 0 (camp A) à 100 (camp B).
//    Par camp : 3 tours (x = 17, 50, 83, y = 15) et le QG (x = 50, y = 5).
//    Une rivière (y 45 → 55) se franchit par 2 PONTS (x = 28 et 72) ;
//    l'Essaim vole et passe partout.
//  Chaque unité va vers la cible la plus proche : un ennemi repéré
//  (≤ SIGHT), sinon le bâtiment ennemi le plus proche (tour, Pompe, QG).
//  Le Tank ne vise que les bâtiments.
//  Distances : D(a, b) = hypot((xa − xb) × XK, ya − yb), XK = 0,6 (le
//  terrain est plus haut que large : 100 en x ≈ 60 en y à l'écran).
//
//  Placement libre : une pose a un point (x, depth) vu de son camp
//  (depth 0 = sa base, 100 = base adverse) :
//    • ma moitié : depth 8 à 45, n'importe quel x ; rivière interdite ;
//    • chez l'adversaire : seulement autour d'une tour adverse détruite ;
//    • un Sort se vise n'importe où et frappe TOUT DE SUITE.
//  Rétro-compatibilité : { lane } (0, 1, 2) = la colonne d'une tour.
//
//  Deck : les 8 cartes sont jouables à tout moment (élixir permettant) ;
//  chaque emplacement se joue UNE fois par combat.
//
//  Mécaniques de style de jeu :
//    🎖 Capitaine  : une 9e carte HORS du deck, jamais posée → passif + pouvoir 1×
//    🏳 Rappel     : un groupe retourne à sa tour la plus proche ; sorti
//                    du terrain, sa carte est sauvée (même en cas de défaite)
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
const DEPLOY_DELAY_MS = 500;      // une troupe apparaît 0,5 s après ; un Sort frappe tout de suite
const SIGHT = 12;                 // un ennemi est repéré jusqu'à 12 (distance D)
const LANES = 3;                  // colonnes des tours (rétro-compatibilité)

const COLUMNS = [17, 50, 83];     // x des 3 tours
const BRIDGES = [28, 72];         // x des 2 ponts
const BRIDGE_HALF = 5;            // demi-largeur d'un pont
const RIVER = { low: 45, high: 55 };
const XK = 0.6;
const REACH_EPS = 0.05;           // tolérance de portée (arrondis des déplacements en 2D)
const POWER_RADIUS = 16;          // zone d'un pouvoir de Capitaine
const BREACH_RADIUS = 20;         // pose autour d'une tour adverse détruite

const TOWER = { hp: 600, dps: 80, range: 12 };
const QG = { hp: 2000, dps: 100, range: 10 };

const RAGE = { elixir: 2, ms: 10000, dps: 1.1 };
const ZONE = { homeMin: 8, homeMax: 45, foeMin: 55, foeMax: 92, spellMin: 3, spellMax: 97, xMin: 4, xMax: 96 };
const RECALL_SPEED = 1.5;   // un groupe rappelé recule 50 % plus vite
const SLOW = 0.6;           // Ralenti : vitesse ×0,6

const SIDES = ['A', 'B'];
const other = (side) => (side === 'A' ? 'B' : 'A');
const dir = (side) => (side === 'A' ? 1 : -1);
// Profondeur vue d'un camp → y du terrain (repère du camp A). x est ABSOLU (le même pour
// les deux joueurs, comme les anciens couloirs) : c'est la page qui retourne l'affichage du camp B.
const pos = (side, yFromA) => (side === 'A' ? yFromA : 100 - yFromA);
const D = (a, b) => Math.hypot((a.x - b.x) * XK, a.y - b.y);
const columnOf = (x) => COLUMNS.reduce((best, cx, i) => (Math.abs(cx - x) < Math.abs(COLUMNS[best] - x) ? i : best), 0);

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
//                  captain?: url, captainCard?: { url, title, rarity } }
//    Le Capitaine est une 9e carte, en PLUS des 8 du deck : il ne prend
//    aucune pose (2026-09-28 : avec tout le deck en main, perdre une pose
//    pour lui coûtait trop cher).
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
      if (!cards[card.url]) cards[card.url] = { ...getCardStats(card), rented: Boolean(card.rented) };
      const owned = Math.max(0, (p.copies && p.copies[card.url]) || 0);
      if ((copies[card.url] || 0) < owned) {
        copies[card.url] = (copies[card.url] || 0) + 1;
        slots.push(card.url);
      } else if (copies[card.url] === undefined) {
        copies[card.url] = 0;
      }
    }

    // 🎖 Capitaine : une 9e carte, hors du deck (jamais posée, aucune pose en moins)
    let captain = null;
    const capCard = p.captain ? (p.captainCard && p.captainCard.url === p.captain ? p.captainCard : p.deck.find((c) => c.url === p.captain)) : null;
    if (capCard) {
      const s = getCardStats(capCard);
      captain = { url: capCard.url, title: s.title, rarity: s.rarity, archetype: s.archetype, power: CAPTAINS[s.archetype].power.key, used: false };
    }
    const arch = captain && captain.archetype;
    if (arch === 'sort') {
      for (const url of Object.keys(cards)) {
        if (cards[url].archetype === 'sort') {
          cards[url] = { ...cards[url], cost: Math.max(1, cards[url].cost - TUNING.spellDiscount), damage: cards[url].damage * TUNING.spellDamage };
        }
      }
    }

    // 🃏 Tout le deck est en main (ordre mélangé, seulement pour l'affichage)
    const order = shuffle(state, slots);
    state.players[side] = {
      userId: p.userId,
      elixir: ELIXIR_START + (arch === 'pompe' ? TUNING.startElixir : 0),
      hand: order,
      copies,
      cards,
      captain,
      effects: { overheatUntil: 0, rageUntil: 0 },
      echo: {},   // 🎖 Magie : url → nombre de relances gratuites restantes
    };
    if (arch === 'sort') {
      for (const url of order) if (cards[url].archetype === 'sort') state.players[side].echo[url] = (state.players[side].echo[url] || 0) + 1;
    }

    COLUMNS.forEach((cx, lane) => {
      state.buildings.push({
        id: state.nextId++, side, kind: 'tower', lane, x: cx, y: pos(side, 15),
        hp: TOWER.hp, maxHp: TOWER.hp, dps: TOWER.dps,
        range: TOWER.range * (arch === 'tireur' ? TUNING.towerRange : 1),
        alive: true, invulnerableUntil: 0,
      });
    });
    state.buildings.push({
      id: state.nextId++, side, kind: 'qg', lane: 1, x: 50, y: pos(side, 5),
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
const elixirMax = (player) => (player.captain && player.captain.archetype === 'pompe' ? TUNING.elixirMax : ELIXIR_MAX);
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
// 📍 Un point demandé par un joueur → { x, y } sur le terrain
//    { x (absolu), depth (vue de son camp) } ou, à l'ancienne, { lane, depth? }
// ─────────────────────────────────────────────

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function pointOf(side, action, defaultDepth) {
  let x;
  if (isNum(action.x)) x = action.x;
  else if (Number.isInteger(action.lane) && action.lane >= 0 && action.lane < LANES) x = COLUMNS[action.lane];
  else return null;
  const depth = isNum(action.depth) ? action.depth : defaultDepth;
  return { x, y: pos(side, depth), fx: x, depth };
}

/** Pose autorisée au point (vu du camp `side`) ? → null ou la raison du refus */
function placementError(state, side, pt) {
  if (pt.fx < ZONE.xMin || pt.fx > ZONE.xMax) return 'zone';
  if (pt.depth >= ZONE.homeMin && pt.depth <= ZONE.homeMax) return null;
  if (pt.depth > ZONE.homeMax && pt.depth < ZONE.foeMin) return 'zone';   // rivière
  if (pt.depth < ZONE.homeMin || pt.depth > ZONE.foeMax) return 'zone';
  // chez l'adversaire : seulement autour d'une de ses tours détruites
  const breach = state.buildings.some((b) => b.side === other(side) && b.kind === 'tower' && !b.alive && D(b, pt) <= BREACH_RADIUS);
  return breach ? null : 'no_breach';
}

// ─────────────────────────────────────────────
// 🧍 Création d'une unité (poses, renforts, invocations)
// ─────────────────────────────────────────────

function makeUnit(state, side, x, y, props) {
  const unit = {
    id: state.nextId++, side, x, y, lane: columnOf(x),
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
//    { type: 'deploy', url, x, depth } (ou { url, lane, depth?, forward? })
//    | { type: 'power', x?, depth? } | { type: 'recall', poseId } | { type: 'forfeit' }
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
  const { url } = action;
  if (!player.hand.includes(url)) return { ok: false, reason: 'not_in_hand', events };
  const stats = cardStats(state, side, url);
  if (player.elixir < stats.cost) return { ok: false, reason: 'elixir', events };

  // 📍 Placement : point choisi (ou positions par défaut)
  const spell = stats.archetype === 'sort';
  let pt;
  if (spell && !isNum(action.x) && !isNum(action.depth)) {
    pt = pointOf(side, action, 50);   // Sort sans point visé : sur la colonne, cible trouvée à l'impact
    if (!pt) return { ok: false, reason: 'lane', events };
    pt.auto = true;
  } else {
    const defDepth = stats.archetype === 'pompe' ? 18 : (action.forward ? 72 : 20);   // avancée : au pied de la tour tombée
    pt = pointOf(side, action, defDepth);
    if (!pt) return { ok: false, reason: 'lane', events };
    if (spell) {
      if (pt.fx < ZONE.spellMin || pt.fx > ZONE.spellMax || pt.depth < ZONE.spellMin || pt.depth > ZONE.spellMax) return { ok: false, reason: 'zone', events };
    } else {
      const err = placementError(state, side, pt);
      if (err) return { ok: false, reason: err, events };
    }
  }
  const forward = pt.depth >= ZONE.foeMin;
  if (stats.archetype === 'pompe' && hasPump(state, side)) return { ok: false, reason: 'pump_active', events };

  // 💧 Paiement ; 🎖 Écho (Magie) : la relance d'un Sort n'engage aucune carte
  player.elixir -= stats.cost;
  const echoed = player.echoPending && player.echoPending[url] > 0;
  if (echoed) player.echoPending[url] -= 1;
  else player.copies[url] -= 1;

  // 🃏 L'emplacement est dépensé pour tout le combat
  player.hand.splice(player.hand.indexOf(url), 1);
  if (!echoed && player.echo[url] > 0) {
    // première fois : l'emplacement revient en main pour un Écho
    player.echo[url] -= 1;
    player.echoPending = player.echoPending || {};
    player.echoPending[url] = (player.echoPending[url] || 0) + 1;
    player.hand.push(url);
  }

  const pose = {
    id: state.nextId++, side, url, title: stats.title, rarity: stats.rarity,
    archetype: stats.archetype, status: 'pending', free: echoed || stats.rented,   // 🛒 achetée : hors bilan
  };
  state.poses.push(pose);
  const lane = columnOf(pt.x);
  state.pending.push({
    poseId: pose.id, side, url, lane, forward, x: pt.x, y: pt.y, auto: Boolean(pt.auto),
    // 💥 un Sort visé frappe au pas suivant ; sans point visé, il attend que les poses adverses apparaissent
    readyAt: state.timeMs + (spell ? (pt.auto ? DEPLOY_DELAY_MS + STEP_MS : 0) : DEPLOY_DELAY_MS),
  });

  // 👁 l'adversaire voit ce qui est posé (carte, rareté, rôle) et où
  events.push({
    type: 'deploy', side, url, lane, forward, poseId: pose.id, archetype: stats.archetype,
    x: pt.x, y: pt.y, title: stats.title, rarity: stats.rarity, cost: stats.cost,
  });
  return { ok: true, events };
}

// ─────────────────────────────────────────────
// 🎖 Pouvoir du Capitaine (une fois par combat), au point touché
// ─────────────────────────────────────────────

function usePower(state, side, action, events) {
  const player = state.players[side];
  const cap = player.captain;
  if (!cap) return { ok: false, reason: 'no_captain', events };
  if (cap.used) return { ok: false, reason: 'power_used', events };
  const def = CAPTAINS[cap.archetype].power;
  const pt = def.lane ? pointOf(side, action, 30) : null;
  if (def.lane && !pt) return { ok: false, reason: 'lane', events };
  const now = state.timeMs;
  const foe = other(side);
  // zone : autour du point touché (un simple « lane » vise sa colonne, à mi-chemin de ma tour)
  const inZone = (u) => D(u, pt) <= POWER_RADIUS;

  switch (def.key) {
    case 'rempart': {
      const t = state.buildings.filter((b) => b.side === side && b.kind === 'tower' && b.alive).sort((a, b) => D(a, pt) - D(b, pt))[0];
      if (!t) return { ok: false, reason: 'lane', events };
      t.invulnerableUntil = now + TUNING.rempartMs;
      break;
    }
    case 'charge':
      // les unités présentes dans la zone chargent pendant toute la durée
      for (const u of state.units) if (u.side === side && inZone(u)) u.chargeUntil = now + TUNING.chargeMs;
      break;
    case 'salve': {
      const hits = new Map();
      for (const u of state.units) if (u.side === foe && inZone(u)) hits.set(u, TUNING.salveDamage);
      applyDamage(state, hits, events);
      break;
    }
    case 'renforts': {
      const base = getCardStats({ url: cap.url, rarity: 'common' });
      const stats = base.archetype === 'essaim' ? base : { hp: 105, dps: 20, range: 2, speed: 11 };
      const at = pt.depth >= ZONE.homeMin && pt.depth <= ZONE.homeMax ? pt : { x: pt.x, y: pos(side, 20) };
      for (let i = 0; i < TUNING.renforts; i += 1) {
        makeUnit(state, side, at.x, at.y - dir(side) * i * 0.8, {
          url: cap.url, archetype: 'essaim', hp: stats.hp, dps: stats.dps, range: stats.range, speed: stats.speed,
          slot: i, packSize: TUNING.renforts, summoned: true, flying: true,
        });
      }
      break;
    }
    case 'surchauffe':
      player.effects.overheatUntil = now + TUNING.surchauffeMs;
      break;
    case 'gel':
      for (const u of state.units) if (u.side === foe && inZone(u)) u.frozenUntil = now + TUNING.gelMs;
      break;
    default:
      return { ok: false, reason: 'invalid', events };
  }
  cap.used = true;
  events.push({ type: 'power', side, power: def.key, lane: pt ? columnOf(pt.x) : null, x: pt ? pt.x : null, y: pt ? pt.y : null });
  return { ok: true, events };
}

// ─────────────────────────────────────────────
// 🏳 Rappel : le groupe rentre à sa tour la plus proche ; sorti du
//    terrain, sa carte est sauvée. Tué pendant la retraite : perdu.
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
// ✨ Apparition d'une pose
// ─────────────────────────────────────────────

function spawn(state, pending, events) {
  const { side, url } = pending;
  const stats = cardStats(state, side, url);
  const pose = poseOf(state, pending.poseId);

  if (stats.archetype === 'sort') {
    castSpell(state, side, stats, events, pending);
    pose.status = 'destroyed';   // un Sort est toujours consommé
    return;
  }

  pose.status = 'alive';

  if (stats.archetype === 'pompe') {
    state.buildings.push({
      id: state.nextId++, side, kind: 'pompe', lane: pending.lane, x: pending.x, y: pending.y,
      hp: stats.hp, maxHp: stats.hp, dps: 0, range: 0, alive: true, poseId: pose.id,
      archetype: 'pompe', url, invulnerableUntil: 0,
      nextProductionAt: state.timeMs + stats.productionMs,
      productionMs: stats.productionMs,
      expiresAt: state.timeMs + stats.lifetimeMs,
    });
    events.push({ type: 'spawn', side, lane: pending.lane, poseId: pose.id, archetype: 'pompe' });
    return;
  }

  const arch = captainArch(state, side);
  const count = stats.count + (arch === 'essaim' && stats.archetype === 'essaim' ? TUNING.extraSwarm : 0);
  const hp = stats.hp * (arch === 'tank' && stats.archetype === 'tank' ? TUNING.tankHp : 1);
  const speed = stats.speed * (arch === 'guerrier' ? TUNING.rushSpeed : 1);
  const dps = stats.dps * (arch === 'guerrier' ? TUNING.rushDps : 1);
  for (let i = 0; i < count; i += 1) {
    const unit = makeUnit(state, side, pending.x, pending.y - dir(side) * i * 0.8, {   // le groupe arrive en paquet serré
      poseId: pose.id, url, archetype: stats.archetype, specialty: stats.specialty,
      slot: i, packSize: count, flying: stats.archetype === 'essaim',
      hp, maxHp: hp, dps, range: stats.range, speed, targets: stats.targets,
    });
    callHook(state, unit, 'onDeploy', {}, events);
  }
  events.push({ type: 'spawn', side, lane: pending.lane, poseId: pose.id, archetype: stats.archetype });
}

// ─────────────────────────────────────────────
// 💥 Sort : frappe au point visé (dégâts de zone, 40 % sur les bâtiments).
//    Sans point visé : l'ennemi le plus avancé de la colonne, sinon un
//    bâtiment de la colonne.
// ─────────────────────────────────────────────

function castSpell(state, side, stats, events, at) {
  const foe = other(side);
  let center = { x: at.x, y: at.y };
  if (at.auto) {
    const inColumn = state.units.filter((u) => u.side === foe && Math.abs(u.x - at.x) <= 17);
    if (inColumn.length) {
      const d = dir(side);
      center = inColumn.reduce((best, u) => (d * u.y < d * best.y ? u : best));
    } else {
      const b = state.buildings.filter((x) => x.side === foe && x.alive && x.kind !== 'qg' && Math.abs(x.x - at.x) <= 17).sort((a, c) => (a.kind === 'pompe' ? -1 : c.kind === 'pompe' ? 1 : 0))[0] || qgOf(state, foe);
      center = b;
    }
  }
  const hits = new Map();
  for (const u of state.units) {
    if (u.side === foe && D(u, center) <= stats.radius) hits.set(u, stats.damage * damageMultiplier('sort', u.archetype));
  }
  for (const b of state.buildings) {
    if (b.side === foe && b.alive && D(b, center) <= stats.radius) hits.set(b, stats.damage * stats.buildingRatio);
  }
  events.push({ type: 'spell', side, lane: columnOf(center.x), x: center.x, y: center.y });
  applyDamage(state, hits, events);
}

// ─────────────────────────────────────────────
// 🎯 Cible d'une unité : l'ennemi repéré le plus proche (≤ SIGHT), sinon
//    le bâtiment ennemi le plus proche (tour, Pompe, QG).
//    Le Tank ne vise que les bâtiments.
// ─────────────────────────────────────────────

function findTarget(state, unit) {
  const foe = other(unit.side);
  let best = null;
  let bestDist = Infinity;
  if (unit.targets === 'all') {
    for (const u of state.units) {
      if (u.side !== foe || u.hp <= 0) continue;
      const d = D(u, unit);
      if (d <= Math.max(SIGHT, unit.range) && d < bestDist) { best = u; bestDist = d; }
    }
    if (best) return best;
  }
  for (const b of state.buildings) {
    if (b.side !== foe || !b.alive) continue;
    const d = D(b, unit);
    if (d < bestDist) { best = b; bestDist = d; }
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
    const d = D(u, building);
    if (d <= building.range && d < bestDist) { best = u; bestDist = d; }
  }
  return best;
}

// ─────────────────────────────────────────────
// 🌉 Chemin : pour traverser la rivière à pied, passer par un pont
// ─────────────────────────────────────────────

const bankOf = (y) => (y < RIVER.low ? -1 : y > RIVER.high ? 1 : 0);

function waypoint(unit, target) {
  if (unit.flying) return target;
  const from = bankOf(unit.y);
  const to = bankOf(target.y);
  if (from === to || to === 0) return target;
  if (from === 0) {
    // sur un pont : on le traverse tout droit
    return { x: unit.x, y: to > 0 ? RIVER.high + 0.6 : RIVER.low - 0.6 };
  }
  const near = from > 0 ? RIVER.high + 0.4 : RIVER.low - 0.4;
  const bx = BRIDGES.reduce((best, b) => {
    const cost = (x) => D(unit, { x, y: near }) + D({ x, y: near }, target);
    return cost(b) < cost(best) ? b : best;
  }, BRIDGES[0]);
  if (Math.abs(unit.x - bx) <= BRIDGE_HALF - 1 && Math.abs(unit.y - near) < 1.2) {
    return { x: unit.x, y: to > 0 ? RIVER.high + 0.6 : RIVER.low - 0.6 };   // engagé sur le pont
  }
  return { x: bx, y: near };
}

/** Avance l'unité de `step` (distance D) vers `goal`, sans dépasser `stopAt` du but final. */
function moveToward(unit, goal, step) {
  const dx = (goal.x - unit.x) * XK;
  const dy = goal.y - unit.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  const f = Math.min(1, step / len);
  unit.x += (goal.x - unit.x) * f;
  unit.y += dy * f;
  unit.lane = columnOf(unit.x);
}

// ─────────────────────────────────────────────
// 🧩 Spécialités (points d'accroche)
// ─────────────────────────────────────────────

function callHook(state, unit, hook, extra, events) {
  const spec = specialties.get(unit.specialty);
  if (!spec || typeof spec[hook] !== 'function') return undefined;
  const near = (side, radius) => state.units.filter((u) => u.side === side && u.hp > 0 && D(u, unit) <= radius);
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
    summon: (props) => makeUnit(state, unit.side, unit.x, unit.y, { url: unit.url, summoned: true, ...props }),
  });
}

// ─────────────────────────────────────────────
// 🩸 Dégâts (bouclier, invulnérabilité) + morts en chaîne
// ─────────────────────────────────────────────

function hurt(target, dmg) {
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
      events.push({ type: 'death', side: u.side, lane: u.lane, x: u.x, y: u.y, poseId: u.poseId, archetype: u.archetype });
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
    events.push({ type: 'destroyed', side: b.side, kind: b.kind, lane: b.lane, x: b.x, y: b.y });
    // 🔥 Rage : le camp qui perd une tour se déchaîne
    if (b.kind === 'tower') {
      const p = state.players[b.side];
      p.elixir = Math.min(elixirMax(p), p.elixir + RAGE.elixir);
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
    if (p.captain && p.captain.archetype === 'pompe') regenMs /= TUNING.ecoRegen;   // 🎖 Économie
    p.elixir = Math.min(elixirMax(p), p.elixir + STEP_MS / regenMs);
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
      p.elixir = Math.min(elixirMax(p), p.elixir + 1);
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

  // Deux temps, pour qu'aucun camp ne soit avantagé par l'ordre de traitement :
  //   1. chaque unité choisit sa cible et son action sur les positions du DÉBUT du pas ;
  //   2. puis toutes agissent (déplacements, coups).
  const plans = [];
  for (const u of state.units) {
    u.attackY = null;   // ⚔️ cible frappée ce pas-ci (flèches, coups à l'écran)
    u.attackX = null;
    if (u.frozenUntil > now) continue;   // 🎖 Gel
    const charging = u.chargeUntil > now;   // 🎖 Charge
    let speed = u.speed * (u.slowUntil > now ? SLOW : 1) * (charging ? TUNING.chargeSpeed : 1);
    if (u.recalling) {
      speed *= RECALL_SPEED;
      const mine = state.buildings.filter((b) => b.side === u.side && (b.kind === 'tower' || b.kind === 'qg'));
      plans.push({ u, speed, recallTo: mine.sort((a, b) => D(a, u) - D(b, u))[0] });
      continue;
    }
    callHook(state, u, 'onTick', {}, events);
    const target = findTarget(state, u);
    if (!target) continue;
    const dist = D(target, u);
    const goal = dist <= u.range + REACH_EPS ? null : waypoint(u, target);
    plans.push({ u, speed, charging, target, dist, goal });
  }

  for (const { u, speed, charging, target, dist, goal, recallTo } of plans) {
    const fx = state.players[u.side].effects;
    // 🏳 Rappel : rentre à sa tour la plus proche sans combattre
    if (recallTo) {
      moveToward(u, waypoint(u, recallTo), speed * dt);
      if (D(u, recallTo) <= 2) home.push(u);
      continue;
    }
    if (!goal) {   // à portée (tolérance : arrivée pile à portée malgré les arrondis)
      const targetArch = target.archetype || target.kind;
      let dmg = u.dps * dt * damageMultiplier(u.archetype, targetArch);
      if (charging) dmg *= TUNING.chargeDps;
      if (fx.rageUntil > now) dmg *= RAGE.dps;   // 🔥 Rage
      const modified = callHook(state, u, 'onHit', { target, damage: dmg }, events);
      if (typeof modified === 'number') dmg = modified;
      hit(target, dmg);
      u.attackY = target.y;
      u.attackX = target.x;
    } else {
      moveToward(u, goal, Math.min(speed * dt, goal === target ? dist - u.range : D(goal, u)));
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
    // les poses « free » (Écho) n'engagent aucune carte : exclues du bilan
    poses: state.poses.filter((p) => !p.free).map(({ side, url, title, rarity, archetype, status }) => ({ side, url, title, rarity, archetype, status })),
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
//    main = les cartes encore jouables (une entrée par carte, copies = poses restantes)
// ─────────────────────────────────────────────

function handView(p) {
  const seen = new Map();
  for (const url of p.hand) seen.set(url, (seen.get(url) || 0) + 1);
  return [...seen.entries()].map(([url, n]) => ({ ...p.cards[url], copies: n, echo: Boolean(p.echoPending && p.echoPending[url] > 0) }));
}

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
      elixirMax: elixirMax(p),
      rage: p.effects.rageUntil > now,
      overheat: p.effects.overheatUntil > now,
    };
    if (side === viewer) {
      view.hand = handView(p);
      view.next = null;
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
    buildings: state.buildings.map(({ id, side, kind, lane, x, y, hp, maxHp, alive, expiresAt, url, invulnerableUntil }) => ({
      id, side, kind, lane, x, y, hp, maxHp, alive, expiresAt, url, shielded: invulnerableUntil > now,
    })),
    units: state.units.map((u) => ({
      id: u.id, side: u.side, lane: u.lane, x: u.x, y: u.y, hp: u.hp, maxHp: u.maxHp, archetype: u.archetype, url: u.url,
      poseId: u.poseId, slot: u.slot, packSize: u.packSize, specialty: u.specialty || null,
      recalling: u.recalling || false, frozen: u.frozenUntil > now, slowed: u.slowUntil > now, shield: u.shield > 0,
      atk: typeof u.attackY === 'number' ? u.attackY : null,
      atkX: typeof u.attackX === 'number' ? u.attackX : null,
    })),
    pending: state.pending.map(({ side, url, lane, forward, x, y, readyAt }) => ({ side, url, lane, forward, x, y, readyAt, archetype: cardStats(state, side, url).archetype })),
    result: state.result,
  };
}

module.exports = {
  STEP_MS,
  DURATION_MS,
  LANES,
  COLUMNS,
  BRIDGES,
  RIVER,
  XK,
  ZONE,
  BREACH_RADIUS,
  createMatch,
  applyAction,
  tick,
  endMatch,
  publicState,
  cardStats,
  towersDestroyed,
  distance: D,
};
