// ═══════════════════════════════════════════════════════════
//  ⚔️ MODULE RAID (v3.4) — remplace l'Attaque Jeanpip
//  Spec : docs/superpowers/specs/2026-10-19-raid-jeanpip-design.md
//
//  L'attaquant choisit ses cibles (5 incluses, +10 JP$ par cible en
//  plus, 10 max) et UN style secret pour tout le raid. Chaque victime
//  a 20 min pour deviner (pierre-feuille-ciseaux) :
//    • riposte  → l'attaquant perd une carte au profit de la victime
//    • repoussé → rien ne se passe
//    • tombe    → la victime perd une carte au profit de l'attaquant
//  Pas de réponse = tombe. Les résultats ne sont révélés qu'à la fin
//  du raid (sinon une victime soufflerait la bonne défense au bureau).
//
//  Butin : un doublon d'abord, sinon une carte unique ; jamais une
//  légendaire ni une carte hors série (🎀 Octobre Rose, anti-spam).
//
//  Lancement : en semaine, de 9h à 17h40 (Paris) → tout est fini à 18h.
//
//  DB = data/raids.json
//    { raids: { <id>: { id, attacker, style, price, free, createdAt, endsAt,
//        targets: [{ userId, defense, answeredAt, outcome, card, dm }],
//        attackerDm, resolved, resolvedAt } } }
//  Logique pure : `now` et `rand` sont passés par l'appelant.
// ═══════════════════════════════════════════════════════════

const path = require('path');
const { readJson, writeJsonAtomic } = require('./storage');
const collections = require('./collections');
const weekend = require('./weekend');
const { parisDay, parisMinutes } = require('./octobreRose');

const RAIDS_PATH = path.join(__dirname, '..', 'data', 'raids.json');

const PRICE = 50;                 // sans Raid gratuit débloqué (100 Jeanpips dans la semaine)
const BASE_TARGETS = 5;           // cibles incluses
const EXTRA_TARGET_PRICE = 10;    // par cible au-delà de 5
const MAX_TARGETS = 10;
const DEFENSE_MS = 20 * 60 * 1000;
const MAX_RECEIVED_PER_DAY = 2;   // raids subis par jour et par personne
const OPEN = { from: 9 * 60, to: 17 * 60 + 40, text: 'en semaine, de 9h à 17h40' };

const STYLES = {
  assaut:    { key: 'assaut',    emoji: '💥', label: 'Assaut' },
  ruse:      { key: 'ruse',      emoji: '🦊', label: 'Ruse' },
  embuscade: { key: 'embuscade', emoji: '🌫️', label: 'Embuscade' },
};
const DEFENSES = {
  bouclier: { key: 'bouclier', emoji: '🛡️', label: 'Bouclier', beats: 'assaut',    holds: 'ruse' },
  piege:    { key: 'piege',    emoji: '🪤', label: 'Piège',    beats: 'ruse',      holds: 'embuscade' },
  esquive:  { key: 'esquive',  emoji: '🏃', label: 'Esquive',  beats: 'embuscade', holds: 'assaut' },
};
const STEALABLE = new Set(['common', 'rare', 'epic']);   // jamais légendaire ni hors série

/** Issue d'une défense face au style du raid : 'riposte' | 'repousse' | 'tombe'. */
function outcome(defense, style) {
  const d = DEFENSES[defense];
  if (!d) return 'tombe';   // pas de réponse
  if (d.beats === style) return 'riposte';
  if (d.holds === style) return 'repousse';
  return 'tombe';
}

/** Pourquoi on ne peut pas lancer de raid maintenant : 'weekend' | 'hours' | null. */
function launchBlock(now = Date.now()) {
  if (weekend.isWeekend(now)) return 'weekend';
  const m = parisMinutes(now);
  return m >= OPEN.from && m < OPEN.to ? null : 'hours';
}

/** Coût d'un raid : 50 JP$ (0 si gratuit) + 10 JP$ par cible au-delà de 5. */
function cost(nTargets, free = false) {
  return (free ? 0 : PRICE) + Math.max(0, nTargets - BASE_TARGETS) * EXTRA_TARGET_PRICE;
}

// ─────────────────────────────────────────────
// 💾 Persistance
// ─────────────────────────────────────────────

function load() {
  const data = readJson(RAIDS_PATH, { raids: {} });
  return data && typeof data.raids === 'object' ? data : { raids: {} };
}
const save = (data) => writeJsonAtomic(RAIDS_PATH, data);

const unresolved = (data) => Object.values(data.raids).filter((r) => !r.resolved);

/** Raid en cours lancé par ce joueur, ou null. */
function activeRaidOf(attacker, data = load()) {
  return unresolved(data).find((r) => r.attacker === attacker) || null;
}

/** Raids en cours qui visent ce joueur. */
function raidsAgainst(userId, data = load()) {
  return unresolved(data).filter((r) => r.targets.some((t) => t.userId === userId));
}

/** Raids subis aujourd'hui (Paris), en cours ou finis. */
function receivedToday(userId, now = Date.now(), data = load()) {
  const day = parisDay(now);
  return Object.values(data.raids)
    .filter((r) => parisDay(r.createdAt) === day && r.targets.some((t) => t.userId === userId)).length;
}

/** Pourquoi cette cible est refusée : 'self' | 'busy' | 'limit' | null. */
function targetProblem(attacker, target, now = Date.now(), data = load()) {
  if (target === attacker) return 'self';
  if (raidsAgainst(target, data).length) return 'busy';
  if (receivedToday(target, now, data) >= MAX_RECEIVED_PER_DAY) return 'limit';
  return null;
}

function generateId(now) {
  return `r_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Enregistre un raid (le paiement est fait par l'appelant). → raid */
function create({ attacker, targets, style, price = 0, free = false, now = Date.now() }) {
  const data = load();
  const raid = {
    id: generateId(now),
    attacker,
    style,
    price,
    free,
    createdAt: now,
    endsAt: now + DEFENSE_MS,
    targets: targets.map((userId) => ({ userId, defense: null, answeredAt: null, outcome: null, card: null, dm: null })),
    attackerDm: null,
    resolved: false,
    resolvedAt: null,
  };
  data.raids[raid.id] = raid;
  save(data);
  return raid;
}

function getRaid(id) {
  return load().raids[id] || null;
}

/** Mémorise un DM (pour le mettre à jour ensuite) : `userId` null = DM de l'attaquant. */
function setDm(id, userId, ref) {
  const data = load();
  const raid = data.raids[id];
  if (!raid || !ref) return;
  if (userId === null) raid.attackerDm = ref;
  else {
    const t = raid.targets.find((x) => x.userId === userId);
    if (t) t.dm = ref;
  }
  save(data);
}

/**
 * Une victime choisit sa défense (un seul clic, définitif).
 * → { status: 'ok'|'unknown'|'not_target'|'over'|'already', raid, allAnswered }
 */
function defend(id, userId, defense, now = Date.now()) {
  const data = load();
  const raid = data.raids[id];
  if (!raid) return { status: 'unknown' };
  const t = raid.targets.find((x) => x.userId === userId);
  if (!t) return { status: 'not_target', raid };
  if (raid.resolved || now >= raid.endsAt) return { status: 'over', raid };
  if (t.defense) return { status: 'already', raid };
  if (!DEFENSES[defense]) return { status: 'unknown', raid };
  t.defense = defense;
  t.answeredAt = now;
  save(data);
  return { status: 'ok', raid, allAnswered: raid.targets.every((x) => x.defense) };
}

/** Carte que `userId` peut perdre : un doublon d'abord, sinon une unique ; null si rien de prenable. */
function pickLoot(userId, rand = Math.random) {
  const pool = collections.getCollection(userId).filter((c) => c.count > 0 && STEALABLE.has(c.rarity));
  const doubles = pool.filter((c) => c.count > 1);
  const from = doubles.length ? doubles : pool;
  if (!from.length) return null;
  const c = from[Math.floor(rand() * from.length)];
  return { url: c.url, title: c.title, rarity: c.rarity, type: c.type };
}

/** Fait passer une carte de `from` à `to` → la carte, ou null. */
function steal(from, to, rand) {
  const card = pickLoot(from, rand);
  if (!card) return null;
  collections.removeCards(from, [card.url]);
  collections.addCards(to, [card]);
  return card;
}

/**
 * Termine le raid : issue de chaque victime, cartes échangées.
 * → { status: 'resolved'|'already'|'unknown', raid, won: [card], lost: [card] }
 */
function resolve(id, now = Date.now(), rand = Math.random) {
  const data = load();
  const raid = data.raids[id];
  if (!raid) return { status: 'unknown' };
  if (raid.resolved) return { status: 'already', raid };
  // 🔒 marqué fini d'abord : jamais résolu deux fois
  raid.resolved = true;
  raid.resolvedAt = now;
  save(data);

  const won = [];
  const lost = [];
  for (const t of raid.targets) {
    t.outcome = outcome(t.defense, raid.style);
    if (t.outcome === 'tombe') {
      t.card = steal(t.userId, raid.attacker, rand);
      if (t.card) won.push(t.card);
    } else if (t.outcome === 'riposte') {
      t.card = steal(raid.attacker, t.userId, rand);
      if (t.card) lost.push(t.card);
    }
  }
  const after = load();
  after.raids[id] = raid;
  save(after);
  return { status: 'resolved', raid, won, lost };
}

/** Raids dont le délai est écoulé (ou dont toutes les victimes ont répondu) et pas encore finis. */
function dueRaids(now = Date.now()) {
  return unresolved(load()).filter((r) => now >= r.endsAt || r.targets.every((t) => t.defense));
}

module.exports = {
  PRICE, BASE_TARGETS, EXTRA_TARGET_PRICE, MAX_TARGETS, DEFENSE_MS, MAX_RECEIVED_PER_DAY, OPEN,
  STYLES, DEFENSES,
  outcome, launchBlock, cost, targetProblem, activeRaidOf, raidsAgainst, receivedToday,
  create, getRaid, setDm, defend, pickLoot, resolve, dueRaids,
};
