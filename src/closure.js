// ═══════════════════════════════════════════════════════════
//  🏢 MODULE FERMETURE DE L'ENTREPRISE (v3.6)
//  Un admin déclare une fermeture (du … au …, un motif) depuis le
//  panneau admin de l'Accueil. Pendant ces jours, Jeanpip est en
//  pause pour tout le monde, exactement comme le week-end
//  (src/weekend.js → isPaused). La série de combats saute ces jours.
//
//  Tout le monde est prévenu en DM au début (à partir de 9h le premier
//  jour) et à la reprise (à partir de 9h le premier jour où le jeu
//  n'est plus en pause, donc pas un samedi).
//
//  Jours à l'heure de Paris, bornes incluses.
//  DB = data/closures.json
//    { closures: [{ id, start: 'AAAA-MM-JJ', end, reason, by, createdAt,
//                   startAnnounced, endAnnounced }] }
// ═══════════════════════════════════════════════════════════

const path = require('path');
const { readJson, writeJsonAtomic } = require('./storage');
const { parisDay } = require('./octobreRose');

const CLOSURES_PATH = path.join(__dirname, '..', 'data', 'closures.json');
const MAX_DAYS = 60;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 3600 * 1000;

const noon = (day) => Date.parse(`${day}T12:00:00Z`);
/** Nombre de jours de `start` à `end`, bornes incluses. */
const daysBetween = (start, end) => Math.round((noon(end) - noon(start)) / DAY_MS) + 1;
/** Jour suivant (« AAAA-MM-JJ »). */
const nextDay = (day) => new Date(noon(day) + DAY_MS).toISOString().slice(0, 10);

function load() {
  const data = readJson(CLOSURES_PATH, { closures: [] });
  return data && Array.isArray(data.closures) ? data : { closures: [] };
}
const save = (data) => writeJsonAtomic(CLOSURES_PATH, data);

/**
 * Contrôle commun d'une période (congés ou fermeture).
 * → null si valide, sinon 'format' | 'past' | 'order' | 'too_long'.
 */
function periodProblem(start, end, now = Date.now(), maxDays = MAX_DAYS) {
  if (!DAY_RE.test(start || '') || !DAY_RE.test(end || '')) return 'format';
  if (end < parisDay(now)) return 'past';
  if (end < start) return 'order';
  if (daysBetween(start, end) > maxDays) return 'too_long';
  return null;
}

/** Fermeture en cours le jour `day` (« AAAA-MM-JJ »), ou null. */
function closureOnDay(day, data = load()) {
  return data.closures.find((c) => c.start <= day && day <= c.end) || null;
}

/** Fermeture en cours à l'instant `now`, ou null. */
const activeClosure = (now = Date.now()) => closureOnDay(parisDay(now));

/** Fermetures en cours ou à venir, de la plus proche à la plus lointaine. */
function listUpcoming(now = Date.now()) {
  const today = parisDay(now);
  return load().closures.filter((c) => c.end >= today).sort((a, b) => a.start.localeCompare(b.start));
}

/** Déclare une fermeture. → { ok, closure } | { ok: false, error } */
function addClosure({ start, end, reason, by, now = Date.now() }) {
  const problem = periodProblem(start, end, now);
  if (problem) return { ok: false, error: problem };
  const data = load();
  if (data.closures.some((c) => c.start <= end && start <= c.end)) return { ok: false, error: 'overlap' };
  const closure = {
    id: `f_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    start,
    end,
    reason: String(reason || '').trim().slice(0, 100),
    by,
    createdAt: now,
    startAnnounced: false,
    endAnnounced: false,
  };
  data.closures.push(closure);
  save(data);
  return { ok: true, closure };
}

/** Annule une fermeture (à venir ou en cours). → la fermeture retirée, ou null. */
function cancelClosure(id) {
  const data = load();
  const closure = data.closures.find((c) => c.id === id);
  if (!closure) return null;
  data.closures = data.closures.filter((c) => c.id !== id);
  save(data);
  return closure;
}

/**
 * Annonces à envoyer maintenant (appelé toutes les 5 min).
 * `isPaused(now)` = jeu en pause (week-end ou autre fermeture) : la reprise
 * n'est annoncée qu'une fois le jeu vraiment rouvert.
 * → [{ kind: 'start' | 'end', closure }], déjà marquées comme envoyées.
 */
function takeDueAnnouncements(now, isPaused, minuteOfDay) {
  const today = parisDay(now);
  const data = load();
  const due = [];
  let changed = false;
  for (const c of data.closures) {
    if (!c.startAnnounced && c.start <= today && today <= c.end && minuteOfDay >= 9 * 60) {
      c.startAnnounced = true;
      changed = true;
      due.push({ kind: 'start', closure: c });
    }
    if (!c.endAnnounced && today > c.end) {
      // Fermeture passée sans annonce de début (bot arrêté tout du long) : pas de « ça reprend » non plus
      if (!c.startAnnounced) { c.endAnnounced = true; changed = true; continue; }
      if (minuteOfDay >= 9 * 60 && !isPaused(now)) {
        c.endAnnounced = true;
        changed = true;
        due.push({ kind: 'end', closure: c });
      }
    }
  }
  // Ménage : les fermetures finies et annoncées depuis plus de 30 jours disparaissent
  const kept = data.closures.filter((c) => !(c.endAnnounced && daysBetween(c.end, today) > 31));
  if (kept.length !== data.closures.length) { data.closures = kept; changed = true; }
  if (changed) save(data);
  return due;
}

module.exports = {
  MAX_DAYS, periodProblem, daysBetween, nextDay, closureOnDay, activeClosure, listUpcoming,
  addClosure, cancelClosure, takeDueAnnouncements, CLOSURES_PATH,
};
