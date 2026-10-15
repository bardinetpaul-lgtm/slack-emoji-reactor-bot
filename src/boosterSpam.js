// ═══════════════════════════════════════════════════════════
//  🚦 MODULE ANTI-SPAM DU BOUTON D'ACHAT (booster à stock du jour)
//  Le Booster Octobre Rose part en quelques secondes à son arrivée :
//  certains cliquent en rafale pour l'avoir. Règles (v3.0.3) :
//    • un clic traité toutes les 3 s par personne (un double-clic
//      accidentel est simplement ignoré, sans sanction) ;
//    • plus de 4 clics (5) en moins de 5 s = spam → bouton bloqué
//      2 min, puis 5, 10, 20, 30 et 60 min à chaque récidive ;
//    • v3.2 : clic automatique = 6 clics d'affilée à intervalles
//      identiques (±0,125 s, entre 2 s et 60 s d'écart) → même blocage,
//      et les admins sont prévenus. Une main ne tient pas ce rythme ;
//      un auto-clicker, si (cas réel le 15/10 : un clic toutes les 6,0 s) ;
//    • pendant le blocage, les clics sont ignorés (ils ne comptent pas) ;
//    • le compteur de récidives repart à zéro chaque jour (Paris).
//  En mémoire : un redémarrage du bot lève les blocages en cours.
//  Logique pure : l'horloge `now` est passée par l'appelant.
// ═══════════════════════════════════════════════════════════

const { parisDay } = require('./octobreRose');

const COOLDOWN_MS = 3000;                   // un clic traité toutes les 3 s
const BURST = { clicks: 5, windowMs: 5000 }; // plus de 4 clics en moins de 5 s = spam
const LADDER_MIN = [2, 5, 10, 20, 30, 60];   // durée du blocage (min) par récidive
// 🤖 v3.2 : rythme de machine = 6 clics d'affilée dont les 5 écarts tiennent
//    dans une fourchette de 0,25 s, avec un écart moyen entre 2 et 60 s
const CADENCE = { clicks: 6, spreadMs: 250, minMs: 2000, maxMs: 60000 };

const states = new Map();   // userId → { day, level, until, clicks: [ms], recent: [ms], lastProcessed }

function stateOf(userId, now) {
  const day = parisDay(now);
  let s = states.get(userId);
  if (!s || s.day !== day) {
    s = { day, level: 0, until: 0, clicks: [], recent: [], lastProcessed: -Infinity };
    states.set(userId, s);
  }
  return s;
}

const ladder = (level) => LADDER_MIN[Math.min(level, LADDER_MIN.length) - 1];

/** Écarts (ms) entre les derniers clics s'ils ont un rythme de machine, sinon null. */
function machineCadence(recent) {
  if (recent.length < CADENCE.clicks) return null;
  const last = recent.slice(-CADENCE.clicks);
  const gaps = last.slice(1).map((t, i) => t - last[i]);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (mean < CADENCE.minMs || mean > CADENCE.maxMs) return null;
  return Math.max(...gaps) - Math.min(...gaps) <= CADENCE.spreadMs ? gaps : null;
}

function lock(s, now, extra = {}) {
  s.level += 1;
  s.clicks = [];
  s.recent = [];
  const minutes = ladder(s.level);
  s.until = now + minutes * 60 * 1000;
  return { action: 'lock', minutes, until: s.until, nextMinutes: ladder(s.level + 1), ...extra };
}

/**
 * Un clic sur « Acheter ».
 * → { action: 'process' }                       : traiter l'achat
 *   { action: 'ignore', reason, until? }        : rien à faire (rafale courte ou bloqué)
 *   { action: 'lock', reason: 'burst'|'bot', minutes, until, nextMinutes, gaps? } : spam détecté → prévenir la personne
 *     (reason 'bot' : `gaps` = écarts en ms des derniers clics, pour l'alerte admin)
 */
function click(userId, now = Date.now()) {
  const s = stateOf(userId, now);
  if (s.until > now) return { action: 'ignore', reason: 'locked', until: s.until };

  s.clicks = s.clicks.filter((c) => now - c < BURST.windowMs);
  s.clicks.push(now);
  if (s.clicks.length >= BURST.clicks) return lock(s, now, { reason: 'burst' });

  s.recent = [...s.recent, now].slice(-CADENCE.clicks);
  const gaps = machineCadence(s.recent);
  if (gaps) return lock(s, now, { reason: 'bot', gaps });

  if (now - s.lastProcessed < COOLDOWN_MS) return { action: 'ignore', reason: 'cooldown' };
  s.lastProcessed = now;
  return { action: 'process' };
}

/** Fin du blocage en cours (ms), ou 0 si le bouton est utilisable. */
function lockedUntil(userId, now = Date.now()) {
  const s = states.get(userId);
  return s && s.day === parisDay(now) && s.until > now ? s.until : 0;
}

module.exports = { COOLDOWN_MS, BURST, LADDER_MIN, CADENCE, click, lockedUntil };
