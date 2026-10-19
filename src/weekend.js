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
// ═══════════════════════════════════════════════════════════

const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' });

/** Samedi ou dimanche, à l'heure de Paris. */
function isWeekend(now = Date.now()) {
  const wd = new Date(`${dayFmt.format(new Date(now))}T12:00:00Z`).getUTCDay();
  return wd === 0 || wd === 6;
}

const PAUSE_TEXT = '🏖️ *C\'est le week-end : Jeanpip est en pause jusqu\'à lundi 0h.*';
const REACTION_TEXT = '🏖️ Fous la paix à tes collègues le week-end ! Ton Jeanpip n\'est pas envoyé et ne rapporte rien. Ça reprend lundi 😉';

module.exports = { isWeekend, PAUSE_TEXT, REACTION_TEXT };
