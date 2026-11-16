// ═══════════════════════════════════════════════════════════
//  🏡 MAISON ET FERME À JEANPIPS (v4.4, bases)
//
//  1. La maison de chaque inscrit a un niveau (1 à 4). Monter d'un
//     niveau se paie en JP$ ; le niveau se voit dans Jeanpip City, par
//     tout le monde (maison plus grande, clôture, fleurs, drapeau…).
//  2. La ferme à Jeanpips : un bâtiment qu'on achète (puis qu'on
//     agrandit), qui produit des JP$ en continu dans un silo. Le joueur
//     vient « récolter » le silo ; plein, il ne produit plus.
//     Production ET récolte seulement les jours ouvrés du joueur : rien
//     ne pousse et on ne récolte pas le week-end, pendant une fermeture
//     de l'entreprise ni pendant ses congés (src/weekend.js, src/leave.js).
//
//  3. Les travaux prennent du temps (`hours`) : quelques heures pour les
//     premiers niveaux, quelques jours pour les derniers. On paie tout de
//     suite ; pendant le chantier, tout le monde voit des cônes et une
//     barrière devant la maison ; le niveau arrive à la fin du chantier.
//     Un chantier à la fois pour la maison, un à la fois pour la ferme.
//     Pendant le chantier de la ferme, elle produit à son ancien niveau.
//     Les durées comptent en temps réel (week-end compris).
//
//  ⚠️ Tous les prix, rendements et durées ci-dessous sont des PROPOSITIONS
//     à faire valider par Paul (équilibrage de l'économie).
//
//  DB = data/maisons.json
//    { users: { U123: { level: 2, farm: 1, stock: 3.25, tickAt: ms,
//                       works: { house: { level: 3, endsAt: ms }, farm: null } } } }
//    stock  = JP$ produits non récoltés (décimal, plafonné au silo) ;
//    tickAt = instant jusqu'où la production est déjà comptée ;
//    works  = chantiers en cours (appliqués à la lecture une fois finis).
//  Relu à chaque appel (petit fichier), écriture atomique (src/storage.js).
//  Achats : débit (credits.spend) puis écriture ; si l'écriture échoue,
//  le joueur est remboursé. Chaque demande dit le niveau visé : un double
//  clic ne paie jamais deux niveaux.
// ═══════════════════════════════════════════════════════════

const path = require('path');
const { readJson, writeJsonAtomic } = require('./storage');
const credits = require('./credits');
const weekend = require('./weekend');
const events = require('./events');
const leave = require('./leave');
const { parisDay } = require('./octobreRose');

const MAISONS_PATH = path.join(__dirname, '..', 'data', 'maisons.json');
const HOUR_MS = 60 * 60 * 1000;
const MAX_CATCHUP_MS = 45 * 24 * HOUR_MS; // au-delà, le silo est plein de toute façon

// 🏠 Niveaux de maison (le 1 est gratuit : c'est la maison actuelle).
//    Chaque niveau garde le décor des précédents et en ajoute (houses.js).
const HOUSE_LEVELS = [
  null,
  { level: 1, name: 'Maison', price: 0, hours: 0, desc: 'La maison de départ.' },
  { level: 2, name: 'Maison fleurie', price: 150, hours: 3, desc: 'Clôture blanche, jardinières de fleurs aux fenêtres, massif fleuri et boîte aux lettres.' },
  { level: 3, name: 'Grande maison', price: 400, hours: 24, desc: 'Maison agrandie, arche fleurie au portail, lanternes allumées la nuit et cheminée qui fume.' },
  { level: 4, name: 'Villa', price: 900, hours: 72, desc: 'Encore plus grande, toit de tuiles neuf, grille en fer forgé, façade illuminée la nuit et drapeau doré.' },
  { level: 5, name: 'Château Jeanpip', price: 2000, hours: 120, desc: 'La plus belle demeure de la ville : un château façon Chambord, avec ses tours, sa lanterne, son tapis rouge, la statue de Jeanpip en or et une étoile dorée qui tourne au-dessus.' },
];

// 🌾 Niveaux de ferme (0 = pas de ferme) : prix, durée du chantier (h), JP$ par heure, silo
//    Réglage C (2026-11-16, choisi par Paul) : entre le réglage A (1/2/3 JP$/h) et le
//    réglage B recommandé par la simulation (0,5/1/1,5 JP$/h), les maisons servant de
//    nouvelle dépense. Simulation : scripts/simulate-maison-ferme.js.
const FARM_LEVELS = [
  { level: 0, name: 'Pas de ferme', price: 0, hours: 0, perHour: 0, silo: 0 },
  { level: 1, name: 'Potager à Jeanpips', price: 220, hours: 4, perHour: 0.75, silo: 6 },
  { level: 2, name: 'Serre à Jeanpips', price: 450, hours: 24, perHour: 1.5, silo: 12 },
  { level: 3, name: 'Ferme à Jeanpips', price: 900, hours: 72, perHour: 2.25, silo: 18 },
];

const MAX_HOUSE = HOUSE_LEVELS.length - 1;
const MAX_FARM = FARM_LEVELS.length - 1;

// ─────────────────────────────────────────────
// 📦 Chargement / sauvegarde
// ─────────────────────────────────────────────

function load() {
  const data = readJson(MAISONS_PATH, { users: {} });
  return data && data.users && typeof data.users === 'object' ? data : { users: {} };
}

function save(data) {
  writeJsonAtomic(MAISONS_PATH, data);
}

function clampInt(v, min, max, dflt) {
  return Number.isInteger(v) && v >= min && v <= max ? v : dflt;
}

/** Chantier propre (ou null) : niveau suivant celui `current`, avec une fin. */
function workOf(raw, current, max) {
  return raw && raw.level === current + 1 && raw.level <= max && Number.isFinite(raw.endsAt)
    ? { level: raw.level, endsAt: raw.endsAt } : null;
}

/** Entrée propre d'un joueur (valeurs par défaut si absent ou abîmé). */
function entryOf(data, userId) {
  const raw = data.users[userId] || {};
  const level = clampInt(raw.level, 1, MAX_HOUSE, 1);
  const farm = clampInt(raw.farm, 0, MAX_FARM, 0);
  const works = raw.works || {};
  const e = {
    level,
    farm,
    stock: Number.isFinite(raw.stock) && raw.stock > 0 ? raw.stock : 0,
    tickAt: Number.isFinite(raw.tickAt) ? raw.tickAt : null,
    works: { house: workOf(works.house, level, MAX_HOUSE), farm: workOf(works.farm, farm, MAX_FARM) },
    levelAt: Number.isFinite(raw.levelAt) ? raw.levelAt : 0,
  };
  Object.defineProperty(e, 'userId', { value: userId, enumerable: false }); // pas écrit dans le fichier
  return e;
}

// ─────────────────────────────────────────────
// 🌾 Production
// ─────────────────────────────────────────────

/** Jeu en pause pour ce joueur à l'instant `t` (week-end, fermeture, ses congés) ? */
function pausedFor(userId, t) {
  return weekend.isPaused(t) || Boolean(userId && leave.activeLeave(userId, t));
}

/**
 * JP$ produits entre `from` et `to` au rythme `perHour`, seulement les
 * jours ouvrés du joueur. Pas d'une heure au plus : la pause commence et
 * finit à minuit, le compte est juste à l'heure près au pire. Un seul
 * contrôle de pause par jour (les fichiers de congés et de fermeture ne
 * sont pas relus à chaque heure).
 */
function produced(perHour, from, to, userId = null) {
  if (!perHour || !(to > from)) return 0;
  const start = Math.max(from, to - MAX_CATCHUP_MS);
  const days = new Map();
  let total = 0;
  for (let t = start; t < to; t += HOUR_MS) {
    const end = Math.min(t + HOUR_MS, to);
    const day = parisDay(t);
    if (!days.has(day)) days.set(day, pausedFor(userId, t));
    if (!days.get(day)) total += (perHour * (end - t)) / HOUR_MS;
  }
  return total;
}

/** Met la production à jour jusqu'à `now` (modifie `e`), sans les chantiers. */
function tick(e, now) {
  const f = FARM_LEVELS[e.farm];
  if (!f.perHour) { e.tickAt = now; return e; }
  if (e.tickAt == null || e.tickAt > now) e.tickAt = now;
  if (e.stock < f.silo) e.stock = Math.min(f.silo, e.stock + produced(f.perHour, e.tickAt, now, e.userId));
  e.tickAt = now;
  return e;
}

/**
 * Termine les chantiers finis puis compte la production jusqu'à `now`.
 * La ferme produit à son ancien niveau jusqu'à la fin de son chantier.
 */
function settle(e, now, { produce = true } = {}) {
  const fw = e.works.farm;
  if (fw && fw.endsAt <= now) {
    if (produce) tick(e, fw.endsAt);
    e.farm = fw.level;
    e.works.farm = null;
  }
  const hw = e.works.house;
  if (hw && hw.endsAt <= now) {
    e.level = hw.level;
    e.levelAt = hw.endsAt; // départage du concours : le premier arrivé à ce niveau
    e.works.house = null;
  }
  return produce ? tick(e, now) : e;
}

// ─────────────────────────────────────────────
// 👀 Lecture
// ─────────────────────────────────────────────

const looksOf = (e) => ({ level: e.level, farm: e.farm, building: Boolean(e.works.house || e.works.farm) });

/** Ce que TOUT LE MONDE voit d'une maison : { level, farm, building }. */
function publicOf(userId, now = Date.now()) {
  return looksOf(settle(entryOf(load(), userId), now, { produce: false }));
}

/** Pour la ville : Map userId → { level, farm, building } (une seule lecture du fichier). */
function publicMap(userIds, now = Date.now()) {
  const data = load();
  return new Map((userIds || []).map((u) => [u, looksOf(settle(entryOf(data, u), now, { produce: false }))]));
}

/**
 * 🏆 Concours de la plus belle maison, parmi `userIds` (les inscrits) :
 * niveau le plus haut d'abord, puis le premier arrivé à ce niveau.
 * Les maisons de départ (niveau 1) ne sont pas classées.
 * → [{ userId, rank, level, name }]
 */
function contest(userIds, now = Date.now()) {
  const data = load();
  return (userIds || [])
    .map((u) => ({ userId: u, e: settle(entryOf(data, u), now, { produce: false }) }))
    .filter((x) => x.e.level > 1)
    .sort((a, b) => b.e.level - a.e.level || a.e.levelAt - b.e.levelAt || (a.userId < b.userId ? -1 : 1))
    .map((x, i) => ({ userId: x.userId, rank: i + 1, level: x.e.level, name: HOUSE_LEVELS[x.e.level].name }));
}

/** Chantier vu par la page : { level, name, endsAt } ou null. */
function workView(w, table) {
  return w ? { level: w.level, name: table[w.level].name, endsAt: w.endsAt } : null;
}

/** Chantiers en cours, visibles par tous : { house, farm } (null si aucun). */
function worksOf(userId, now = Date.now()) {
  const e = settle(entryOf(load(), userId), now);
  return { house: workView(e.works.house, HOUSE_LEVELS), farm: workView(e.works.farm, FARM_LEVELS) };
}

/** État complet vu par le PROPRIÉTAIRE (prix suivants, chantiers, silo, production). */
function ownerView(userId, now = Date.now()) {
  const e = settle(entryOf(load(), userId), now);
  const f = FARM_LEVELS[e.farm];
  const nextHouse = e.works.house ? null : HOUSE_LEVELS[e.level + 1] || null;
  const nextFarm = e.works.farm ? null : FARM_LEVELS[e.farm + 1] || null;
  return {
    house: { ...HOUSE_LEVELS[e.level], next: nextHouse, works: workView(e.works.house, HOUSE_LEVELS) },
    farm: {
      works: workView(e.works.farm, FARM_LEVELS),
      level: e.farm, name: f.name, perHour: f.perHour, silo: f.silo,
      stock: Math.floor(e.stock * 100) / 100,
      ready: Math.floor(e.stock),
      full: f.silo > 0 && e.stock >= f.silo,
      paused: pausedFor(userId, now),
      next: nextFarm,
    },
  };
}

// ─────────────────────────────────────────────
// 🛒 Achats et récolte
//    → { ok:true, ... } ou { ok:false, reason, ... }
//    reasons : max, stale, busy, pause, insufficient, error, empty
// ─────────────────────────────────────────────

function buy(userId, kind, to, now) {
  const isHouse = kind === 'house';
  if (weekend.pauseFor(userId, now)) return { ok: false, reason: 'pause' };
  const data = load();
  const e = settle(entryOf(data, userId), now);
  const current = isHouse ? e.level : e.farm;
  const table = isHouse ? HOUSE_LEVELS : FARM_LEVELS;
  const work = e.works[kind];
  if (work) return { ok: false, reason: to === work.level ? 'stale' : 'busy', level: current, endsAt: work.endsAt };
  const next = table[current + 1];
  if (!next) return { ok: false, reason: 'max' };
  if (to !== next.level) return { ok: false, reason: 'stale', level: current };

  const source = isHouse ? 'house_upgrade' : 'farm_upgrade';
  if (!credits.spend(userId, next.price, { source, item: String(next.level) })) {
    return { ok: false, reason: 'insufficient', price: next.price, balance: credits.getBalance(userId) };
  }
  const endsAt = now + next.hours * HOUR_MS;
  e.works[kind] = { level: next.level, endsAt };
  settle(e, now); // chantier de 0 h : fini tout de suite
  data.users[userId] = e;
  try {
    save(data);
  } catch (err) {
    console.error('[maison] écriture :', err.message);
    credits.addCredit(userId, next.price, { source: `${source}_refund`, item: String(next.level) });
    return { ok: false, reason: 'error' };
  }
  events.record(source, userId, { level: next.level, price: next.price, endsAt });
  return { ok: true, kind, level: next.level, name: next.name, price: next.price, endsAt, balance: credits.getBalance(userId) };
}

/** Monte la maison au niveau `to` (doit être le niveau suivant). */
function upgradeHouse(userId, to, now = Date.now()) {
  return buy(userId, 'house', to, now);
}

/** Achète la ferme (to = 1) ou monte au niveau `to`. */
function upgradeFarm(userId, to, now = Date.now()) {
  return buy(userId, 'farm', to, now);
}

/** Récolte le silo (jours ouvrés seulement) : les JP$ entiers sont crédités, les centimes restent. */
function collect(userId, now = Date.now()) {
  if (pausedFor(userId, now)) return { ok: false, reason: 'pause' };
  const data = load();
  const e = settle(entryOf(data, userId), now);
  if (!e.farm) return { ok: false, reason: e.works.farm ? 'building' : 'no_farm' };
  const amount = Math.floor(e.stock);
  if (amount < 1) return { ok: false, reason: 'empty', stock: e.stock };
  e.stock -= amount;
  data.users[userId] = e;
  try {
    save(data);   // d'abord le silo vidé : un plantage ne peut pas faire payer deux fois
  } catch (err) {
    console.error('[maison] écriture :', err.message);
    return { ok: false, reason: 'error' };
  }
  const balance = credits.addCredit(userId, amount, { source: 'farm', item: String(e.farm) });
  events.record('farm_collect', userId, { amount, farm: e.farm });
  return { ok: true, amount, balance };
}

module.exports = {
  HOUSE_LEVELS, FARM_LEVELS, MAX_HOUSE, MAX_FARM, MAISONS_PATH,
  publicOf, publicMap, contest, worksOf, ownerView, upgradeHouse, upgradeFarm, collect,
  _produced: produced,
};
