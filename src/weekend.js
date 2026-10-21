// ═══════════════════════════════════════════════════════════
//  🏖️ MODULE WEEK-END (v3.3)
//  Du samedi 0h au lundi 0h (heure de Paris), Jeanpip est en pause :
//    • une réaction :jeanpip: ne fait rien (ni image, ni JP$, ni score) ;
//      le réacteur reçoit juste un message, visible de lui seul ;
//    • pas d'auto-react sur les cibles, pas d'Attaque ;
//    • aucune carte : pas d'achat ni d'ouverture de booster, pas de
//      ticket à gratter, pas de nouveau combat d'Arène ;
//    • aucune notification automatique du bot (fin de pénalité anti-farm,
//      DM du vendredi rattrapé, alertes…) : seule la réponse directe à un
//      clic du joueur part encore.
//  Ce qui a commencé avant samedi 0h se termine normalement (combat en
//  cours, ticket déjà acheté).
//
//  v3.6 : la même pause s'applique
//    • à tout le monde pendant une fermeture de l'entreprise (src/closure.js) ;
//    • à un seul joueur pendant ses congés (src/leave.js).
//  isPaused(now) = pause pour tout le monde ; pauseFor(userId, now) = pause
//  pour ce joueur, avec les textes à afficher. isWeekend reste le seul
//  samedi/dimanche (calendrier des boosters « du lundi au vendredi »).
// ═══════════════════════════════════════════════════════════

const closure = require('./closure');
const leave = require('./leave');
const { parisDay } = require('./octobreRose');

const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' });

/** Samedi ou dimanche, à l'heure de Paris. */
function isWeekend(now = Date.now()) {
  const wd = new Date(`${dayFmt.format(new Date(now))}T12:00:00Z`).getUTCDay();
  return wd === 0 || wd === 6;
}

const DAY_MS = 24 * 3600 * 1000;
const noon = (day) => Date.parse(`${day}T12:00:00Z`);
const isWeekendDay = (day) => [0, 6].includes(new Date(noon(day)).getUTCDay());

/** Jour en pause pour tout le monde (week-end ou fermeture) ? `day` = « AAAA-MM-JJ ». */
const isPausedDay = (day) => isWeekendDay(day) || Boolean(closure.closureOnDay(day));

/** Jeu en pause pour tout le monde (week-end ou fermeture de l'entreprise). */
const isPaused = (now = Date.now()) => isPausedDay(parisDay(now));

const longDayFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
const weekdayFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long' });

/** « lundi 5 janvier » pour « AAAA-MM-JJ ». */
const longDay = (day) => longDayFmt.format(new Date(noon(day)));

/**
 * Pause de ce joueur maintenant, ou null :
 * { kind: 'weekend'|'closure'|'leave', icon, title, short, back, until, closure?, leave? }
 *   title = ligne en gras pour l'Accueil ;
 *   short = « le week-end » | « pendant la fermeture » | « pendant tes congés » ;
 *   back  = « lundi » | « le lundi 5 janvier » (jour de reprise) ;
 *   until = « jusqu'à lundi 0h » | « jusqu'au lundi 5 janvier ».
 */
function pauseFor(userId, now = Date.now()) {
  const today = parisDay(now);
  const c = closure.closureOnDay(today);
  const l = userId ? leave.activeLeave(userId, now) : null;
  const kind = c ? 'closure' : isWeekendDay(today) ? 'weekend' : l ? 'leave' : null;
  if (!kind) return null;

  // Premier jour où ce joueur peut rejouer (ni week-end, ni fermeture, ni congés)
  let resume = today;
  for (let i = 0; i < 400; i += 1) {
    resume = new Date(noon(resume) + DAY_MS).toISOString().slice(0, 10);
    if (!isPausedDay(resume) && !(l && resume <= l.end)) break;
  }
  const near = (noon(resume) - noon(today)) / DAY_MS <= 6;
  const back = near ? weekdayFmt.format(new Date(noon(resume))) : `le ${longDay(resume)}`;
  const until = near ? `jusqu'à ${back} 0h` : `jusqu'au ${longDay(resume)}`;

  if (kind === 'closure') {
    return {
      kind, icon: '🏢', short: 'pendant la fermeture', back, until, closure: c,
      title: `🏢 *L'entreprise est fermée${c.reason ? ` (${c.reason})` : ''} : Jeanpip est en pause pour tout le monde ${until}.*`,
    };
  }
  if (kind === 'weekend') {
    return { kind, icon: '🏖️', short: 'le week-end', back, until, title: `🏖️ *C'est le week-end : Jeanpip est en pause ${until}.*` };
  }
  return { kind, icon: '🌴', short: 'pendant tes congés', back, until, leave: l, title: `🌴 *Tu es en congés : Jeanpip est en pause pour toi ${until}.*` };
}

/** Message (visible du seul réacteur) quand sa réaction ne compte pas à cause d'une pause. */
function reactionText(pause) {
  if (pause.kind === 'weekend') return REACTION_TEXT;
  if (pause.kind === 'closure') return `🏢 L'entreprise est fermée : ta réaction ne compte pas et ne rapporte rien. Ça reprend ${pause.back} 😉`;
  return `🌴 Tu es en congés : ta réaction ne compte pas et ne rapporte rien. Bon repos, ça reprend ${pause.back} 😉`;
}

const PAUSE_TEXT = '🏖️ *C\'est le week-end : Jeanpip est en pause jusqu\'à lundi 0h.*';
const REACTION_TEXT = '🏖️ Fous la paix à tes collègues le week-end ! Ton Jeanpip n\'est pas envoyé et ne rapporte rien. Ça reprend lundi 😉';

module.exports = { isWeekend, isWeekendDay, isPaused, isPausedDay, pauseFor, reactionText, longDay, PAUSE_TEXT, REACTION_TEXT };
