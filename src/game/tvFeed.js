// ═══════════════════════════════════════════════════════════
//  📺 JP TV — quel combat est à l'antenne ? (logique pure, sans I/O)
//
//  À l'antenne = combat diffusable (aucun refus des joueurs) en cours,
//  ou fini/annulé depuis moins de END_HOLD_MS (écran de fin).
//  Le combat déjà à l'antenne y reste jusqu'au bout de son écran de fin ;
//  sinon on prend le combat en cours lancé le premier. Les autres combats
//  en cours vont dans le bandeau « Aussi en direct ».
//  Entrée : matches.listForTv() → [{ id, status, startedAt, endedAt, broadcast }]
// ═══════════════════════════════════════════════════════════

const END_HOLD_MS = 10 * 1000;   // écran de fin
const SEND_EVERY_MS = 200;       // flux TV à 5 Hz

const isRunning = (m) => m.broadcast && m.status === 'running';
const inHold = (m, now) => m.broadcast && (m.status === 'ended' || m.status === 'cancelled')
  && typeof m.endedAt === 'number' && now - m.endedAt < END_HOLD_MS;
const byStart = (a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id);

function pickFeatured(prevId, list, now) {
  const running = list.filter(isRunning).sort(byStart);
  const prev = prevId ? list.find((m) => m.id === prevId) : null;
  const featured = prev && (isRunning(prev) || inHold(prev, now)) ? prev : running[0] || null;
  return {
    featuredId: featured ? featured.id : null,
    also: running.filter((m) => !featured || m.id !== featured.id).map((m) => m.id),
  };
}

function isOnAir(list, now) {
  return list.some((m) => isRunning(m) || inHold(m, now));
}

module.exports = { END_HOLD_MS, SEND_EVERY_MS, pickFeatured, isOnAir };
