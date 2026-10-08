// ═══════════════════════════════════════════════════════════
//  🚦 MODULE ANTI-SPAM DU BOUTON D'ACHAT (booster à stock du jour)
//  Le Booster Octobre Rose part en quelques secondes à son arrivée :
//  certains cliquent en rafale pour l'avoir. Règles (v3.0.3) :
//    • un clic traité toutes les 3 s par personne (un double-clic
//      accidentel est simplement ignoré, sans sanction) ;
//    • 3 clics ou plus en moins de 5 s = spam → bouton bloqué
//      2 min, puis 5, 10, 20, 30 et 60 min à chaque récidive ;
//    • pendant le blocage, les clics sont ignorés (ils ne comptent pas) ;
//    • le compteur de récidives repart à zéro chaque jour (Paris).
//  En mémoire : un redémarrage du bot lève les blocages en cours.
//  Logique pure : l'horloge `now` est passée par l'appelant.
// ═══════════════════════════════════════════════════════════

const { parisDay } = require('./octobreRose');

const COOLDOWN_MS = 3000;                   // un clic traité toutes les 3 s
const BURST = { clicks: 3, windowMs: 5000 }; // 3 clics en moins de 5 s = spam
const LADDER_MIN = [2, 5, 10, 20, 30, 60];   // durée du blocage (min) par récidive

const states = new Map();   // userId → { day, level, until, clicks: [ms], lastProcessed }

function stateOf(userId, now) {
  const day = parisDay(now);
  let s = states.get(userId);
  if (!s || s.day !== day) {
    s = { day, level: 0, until: 0, clicks: [], lastProcessed: -Infinity };
    states.set(userId, s);
  }
  return s;
}

const ladder = (level) => LADDER_MIN[Math.min(level, LADDER_MIN.length) - 1];

/**
 * Un clic sur « Acheter ».
 * → { action: 'process' }                       : traiter l'achat
 *   { action: 'ignore', reason, until? }        : rien à faire (rafale courte ou bloqué)
 *   { action: 'lock', minutes, until, nextMinutes } : spam détecté → prévenir la personne
 */
function click(userId, now = Date.now()) {
  const s = stateOf(userId, now);
  if (s.until > now) return { action: 'ignore', reason: 'locked', until: s.until };

  s.clicks = s.clicks.filter((c) => now - c < BURST.windowMs);
  s.clicks.push(now);
  if (s.clicks.length >= BURST.clicks) {
    s.level += 1;
    s.clicks = [];
    const minutes = ladder(s.level);
    s.until = now + minutes * 60 * 1000;
    return { action: 'lock', minutes, until: s.until, nextMinutes: ladder(s.level + 1) };
  }
  if (now - s.lastProcessed < COOLDOWN_MS) return { action: 'ignore', reason: 'cooldown' };
  s.lastProcessed = now;
  return { action: 'process' };
}

/** Fin du blocage en cours (ms), ou 0 si le bouton est utilisable. */
function lockedUntil(userId, now = Date.now()) {
  const s = states.get(userId);
  return s && s.day === parisDay(now) && s.until > now ? s.until : 0;
}

module.exports = { COOLDOWN_MS, BURST, LADDER_MIN, click, lockedUntil };
