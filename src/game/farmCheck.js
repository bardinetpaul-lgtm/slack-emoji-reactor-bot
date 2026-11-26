// ═══════════════════════════════════════════════════════════
//  🕵️ CONTRÔLE ANTI-FARM DE L'ARÈNE (v4.4.2)
//  Des joueurs s'arrangent : l'un se laisse battre sans rien poser, l'autre
//  empoche le booster Commun + 10 JP$, puis ils inversent.
//
//  À chaque fin de combat, on compare le combat à ceux de la MÊME paire de
//  joueurs le même jour (heure de Paris), et on rend un verdict :
//    • 'farm'    → combat non récompensé : ni booster, ni JP$, ni série,
//                  ni victoire au classement ; les admins sont prévenus ;
//    • 'suspect' → récompensé normalement, mais les admins sont prévenus ;
//    • 'ok'      → rien.
//
//  Signaux (calculés sur les cartes posées par le perdant, Écho exclu) :
//    • no_play   : le perdant n'a posé AUCUNE carte                  → farm
//    • repeat    : 3e combat du jour de la paire où le perdant a posé
//                  au plus 1 carte (« combat bâclé »)                 → farm
//    • token     : perdant ≤ 1 carte, combat de moins d'1 min ou abandon → suspect
//    • ping_pong : les deux joueurs se sont déjà battus mutuellement
//                  aujourd'hui, chaque fois avec un combat bâclé       → suspect
//    • aller_retour : sur 7 jours, la paire alterne les victoires (A, B, A, B…)
//                  et le perdant garde chaque fois des cartes en main sans les
//                  jouer ; à partir de 3 changements de vainqueur  → suspect
//                  (alerte admin une seule fois par paire et par jour)
//
//  Pur : aucune écriture ici (voir settle.js). Seuils en tête de fichier.
// ═══════════════════════════════════════════════════════════

const { parisDay } = require('../octobreRose');

const LOW_EFFORT_POSES = 1;      // « combat bâclé » : le perdant a posé au plus 1 carte
const SHORT_MS = 60 * 1000;      // combat de moins d'une minute
const REPEAT_FARM = 3;           // 3e combat bâclé du jour dans la même paire → farm
const SWING_WINDOW_MS = 7 * 24 * 3600 * 1000;   // aller-retour : regardé sur 7 jours glissants
const SWING_MIN = 3;             // A→B→A→B : 3 changements de vainqueur = 2 allers-retours

const LABELS = {
  no_play: 'le perdant n\'a posé aucune carte',
  repeat: `${REPEAT_FARM}e combat bâclé du jour entre ces deux joueurs`,
  token: 'le perdant a posé une carte au plus, combat très court ou abandon',
  ping_pong: 'ils se laissent gagner chacun leur tour aujourd\'hui',
  aller_retour: `allers-retours : ils se battent chacun leur tour (${SWING_MIN} changements de vainqueur ou plus en 7 jours), le perdant gardant chaque fois des cartes sans les jouer`,
};

/** Cartes posées par chaque camp → { A: n, B: n } (poses « free » déjà exclues par le moteur). */
function poseCounts(result) {
  const out = { A: 0, B: 0 };
  for (const p of (result && result.poses) || []) if (out[p.side] !== undefined) out[p.side] += 1;
  return out;
}

const samePair = (h, a, b) => h && !h.draw && ((h.winnerId === a && h.loserId === b) || (h.winnerId === b && h.loserId === a));
/** Le perdant a fini avec des cartes en main (pas toutes jouées) ; inconnu avant la v4.4.2 → false. */
const incomplete = (h) => h.unplayed && typeof h.unplayed[h.loserId] === 'number' && h.unplayed[h.loserId] > 0;

/** Changements de vainqueur dans une suite de combats (du plus ancien au plus récent). */
function swings(list) {
  let n = 0;
  for (let i = 1; i < list.length; i++) if (list[i].winnerId !== list[i - 1].winnerId) n += 1;
  return n;
}

const lowEffort = (h) => h.poses && typeof h.poses[h.loserId] === 'number' && h.poses[h.loserId] <= LOW_EFFORT_POSES;

/**
 * @param {{ players: { A, B }, result, history: [entrée de arenaStore], now }} p
 * @returns {{ verdict: 'ok'|'suspect'|'farm', signals: string[], poses: { [userId]: n } }}
 */
function analyze({ players, result, history = [], now = Date.now() }) {
  const counts = poseCounts(result);
  const poses = { [players.A]: counts.A, [players.B]: counts.B };
  const left = (result && result.unplayed) || {};
  const unplayed = typeof left.A === 'number' ? { [players.A]: left.A, [players.B]: left.B } : null;
  const winner = result && result.winner;
  if (!winner) return { verdict: 'ok', signals: [], poses, unplayed, alert: false };   // nul : aucune récompense en jeu
  const loser = winner === 'A' ? 'B' : 'A';
  const winnerId = players[winner];
  const loserId = players[loser];
  const loserPoses = counts[loser];

  const signals = [];
  if (loserPoses === 0) signals.push('no_play');

  const today = parisDay(now);
  const pairToday = history.filter((h) => samePair(h, winnerId, loserId) && parisDay(h.at) === today);
  const thisLow = loserPoses <= LOW_EFFORT_POSES;
  if (thisLow && pairToday.filter(lowEffort).length + 1 >= REPEAT_FARM) signals.push('repeat');

  const short = typeof result.durationMs === 'number' && result.durationMs < SHORT_MS;
  if (thisLow && loserPoses > 0 && (short || result.reason === 'forfeit')) signals.push('token');
  // L'actuel perdant a déjà battu l'actuel vainqueur aujourd'hui, sur un combat bâclé
  if (thisLow && pairToday.some((h) => h.winnerId === loserId && lowEffort(h))) signals.push('ping_pong');

  // Allers-retours sur 7 jours : seuls les combats où le perdant n'a pas tout joué, celui-ci compris
  let swingAlertedToday = false;
  if (unplayed && unplayed[loserId] > 0) {
    const chain = history.filter((h) => samePair(h, winnerId, loserId) && now - h.at <= SWING_WINDOW_MS && incomplete(h))
      .concat([{ winnerId, loserId, at: now }]);
    if (swings(chain) >= SWING_MIN) {
      signals.push('aller_retour');
      swingAlertedToday = pairToday.some((h) => Array.isArray(h.signals) && h.signals.includes('aller_retour'));
    }
  }

  const verdict = signals.includes('no_play') || signals.includes('repeat') ? 'farm' : signals.length ? 'suspect' : 'ok';
  // Alerte admin : toujours pour un verdict farm ; pour un aller-retour seul, une fois par paire et par jour
  const onlySwing = signals.length === 1 && signals[0] === 'aller_retour';
  const alert = verdict !== 'ok' && !(onlySwing && swingAlertedToday);
  return { verdict, signals, poses, unplayed, alert };
}

/** « le perdant n'a posé aucune carte ; … » */
const describe = (signals) => signals.map((s) => LABELS[s] || s).join(' ; ');

module.exports = { analyze, describe, poseCounts, swings, LABELS, LOW_EFFORT_POSES, SHORT_MS, REPEAT_FARM, SWING_WINDOW_MS, SWING_MIN };
