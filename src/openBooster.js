// ═══════════════════════════════════════════════════════════
//  🎴 MODULE OUVERTURE DE BOOSTER (partagé Slack + page web)
//
//  openOnce() est ENTIÈREMENT SYNCHRONE (aucun await) : Node étant
//  mono-thread, deux ouvertures simultanées (clic Slack + page web,
//  double-clic, 2 onglets…) ne peuvent pas s'entremêler dans les
//  fichiers JSON. La première gagne, les suivantes reçoivent 'already'.
//
//  Les cartes sont en collection AVANT toute animation : fermer
//  l'onglet ou redémarrer le bot en cours de révélation ne fait
//  rien perdre.
// ═══════════════════════════════════════════════════════════

const boosters = require('./boosters');
const collections = require('./collections');

/**
 * Ouvre un booster une seule fois.
 * @param {string} id     - id du booster
 * @param {string} userId - qui ouvre (doit être le propriétaire)
 * @param {'slack'|'web'} via
 * @returns {{ status: 'not_found'|'forbidden'|'already'|'opened',
 *             pending?, via?, cards?, counts? }}
 */
function openOnce(id, userId, via) {
  const pending = boosters.getPending(id);
  if (!pending) return { status: 'not_found' };
  if (pending.owner !== userId) return { status: 'forbidden', pending };

  if (pending.opened) {
    return {
      status: 'already',
      pending,
      via: pending.openedVia || 'slack', // anciens boosters : ouverts dans Slack
      cards: pending.cards || null,
      counts: pending.counts || null,
    };
  }

  // 🔒 markOpened ne réussit qu'une fois
  if (!boosters.markOpened(id)) {
    return { status: 'already', pending, via: 'slack', cards: null, counts: null };
  }

  const cards = boosters.openBooster(pending.type);
  const counts = collections.addCards(pending.owner, cards);
  boosters.saveOpening(id, { via, cards, counts });

  return { status: 'opened', pending, via, cards, counts };
}

module.exports = { openOnce };
