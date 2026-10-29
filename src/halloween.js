// ═══════════════════════════════════════════════════════════
//  🎃 MODULE HALLOWEEN
//  Les cartes « hors série » qui ne sortent QUE dans le Booster
//  Halloween (jamais via les réactions, les autres boosters ni la
//  boutique de l'Arène). Même principe que 🎀 Octobre Rose :
//  intercalaire « Hors série » du classeur, jouables dans l'Arène.
//
//  Rareté interne : 'halloween'. Titre : « 🎃 Halloween N/6 ».
//
//  ⏰ Vente : du vendredi 30/10 à 14h au lundi 2/11 à 14h (heure de
//     Paris), sans limite par personne. Le week-end, la pause du jeu
//     (src/weekend.js) ferme la boutique : en pratique on achète le
//     vendredi après-midi, puis le lundi jusqu'à 14h.
//
//  🌗 DEUX VAGUES (demande de Paul) : la moitié des cartes sort dès le
//     vendredi, l'autre moitié est IMPOSSIBLE à obtenir avant le lundi
//     matin. Les numéros des deux vagues sont entremêlés exprès.
//
//  ⚠️ Le booster reste INVISIBLE tant qu'un lien ci-dessous est vide
//  (ou en double), comme Octobre Rose.
// ═══════════════════════════════════════════════════════════

const { parisDay, parisMinutes } = require('./octobreRose');

// 📅 Fenêtre de vente (heure de Paris)
const OPEN  = { day: '2026-10-30', minutes: 14 * 60, text: 'vendredi 30/10 à 14h' };
const CLOSE = { day: '2026-11-02', minutes: 14 * 60, text: 'lundi 2/11 à 14h' };

// 🌗 Ouverture de chaque vague. La vague 2 n'existe pas avant le lundi 0h.
const WAVES = {
  1: { ...OPEN, label: 'vendredi après-midi' },
  2: { day: '2026-11-02', minutes: 0, label: 'lundi matin' },
};

// 🖼️ Les cartes, dans l'ordre (N/6). `url` = lien slack-files (comme les
//    photos anti-spam) ou image publique ; `name` = sous-titre optionnel ;
//    `wave` = 1 (dès le vendredi) ou 2 (pas avant le lundi matin).
//    Ne jamais modifier une URL une fois distribuée : c'est l'identifiant
//    de la carte dans les collections.
const HALLOWEEN_CARD_DEFS = [
  { url: 'https://slack-files.com/T6EFSEHCN-F0CD3LFP414-6d2bfd1f08', name: '', wave: 1 },
  { url: 'https://slack-files.com/T6EFSEHCN-F0CD3LH9GDC-b09ce6fcf0', name: '', wave: 2 },
  { url: 'https://slack-files.com/T6EFSEHCN-F0CD7GD6CPK-3eaa1a1513', name: '', wave: 1 },
  { url: 'https://slack-files.com/T6EFSEHCN-F0CE00Z10BS-f813ce801a', name: '', wave: 1 },
  { url: 'https://slack-files.com/T6EFSEHCN-F0CD3LS39C6-ab236168a5', name: '', wave: 2 },
  { url: 'https://slack-files.com/T6EFSEHCN-F0CD9AQP0JY-6e9e3d268d', name: '', wave: 1 },
  { url: 'https://slack-files.com/T6EFSEHCN-F0CD3LUDJLW-c05bf50601', name: '', wave: 2 },
];

const HALLOWEEN_CARDS = HALLOWEEN_CARD_DEFS.map((d, i) => ({
  type: /\.(?:mp4|mov|webm|m4v)(?:$|\?)/i.test(d.url) ? 'video' : 'image',
  url: d.url.trim(),
  title: `🎃 Halloween ${i + 1}/${HALLOWEEN_CARD_DEFS.length}${d.name ? ` — ${d.name}` : ''}`,
  rarity: 'halloween',
  number: i + 1,
  wave: d.wave,
}));

/** Tous les liens sont renseignés (et distincts). */
function isReady() {
  const urls = HALLOWEEN_CARDS.map((c) => c.url).filter(Boolean);
  return urls.length === HALLOWEEN_CARDS.length && new Set(urls).size === urls.length;
}

/** `now` a-t-il atteint ce repère (jour + heure de Paris) ? */
function reached(now, mark) {
  const day = parisDay(now);
  return day > mark.day || (day === mark.day && parisMinutes(now) >= mark.minutes);
}

/** Le booster est-il dans sa fenêtre de vente ? */
function inSeason(now = Date.now()) {
  return reached(now, OPEN) && !reached(now, CLOSE);
}

/** Cette vague est-elle sortie ? */
const waveOpen = (wave, now = Date.now()) => reached(now, WAVES[wave] || WAVES[1]);

/** Les cartes qu'on peut obtenir maintenant (vague 1, puis tout le lundi). */
const releasedCards = (now = Date.now()) => HALLOWEEN_CARDS.filter((c) => c.url && waveOpen(c.wave, now));

/**
 * Tire une carte Halloween parmi les MOINS distribuées jusqu'ici, dans les
 * vagues déjà sorties : chacune sort au moins une fois avant qu'une autre
 * ne sorte une 2e fois. Calculé depuis l'historique → garanti même après
 * un redémarrage du bot.
 * @param {Map<string, number>} drawn - url → nombre de fois déjà sortie
 * @param {Set<string>} exclude       - urls déjà dans ce booster
 */
function drawHalloweenCard(drawn, exclude = new Set(), now = Date.now()) {
  const pool = releasedCards(now).filter((c) => !exclude.has(c.url));
  if (!pool.length) return null;
  const min = Math.min(...pool.map((c) => drawn.get(c.url) || 0));
  const least = pool.filter((c) => (drawn.get(c.url) || 0) === min);
  return least[Math.floor(Math.random() * least.length)];
}

/** Combien de cartes ne sont pas encore sorties (vague suivante). */
const lockedCount = (now = Date.now()) => HALLOWEEN_CARDS.filter((c) => c.url && !waveOpen(c.wave, now)).length;

/** Combien de cartes compte la série (liens renseignés). */
const cardCount = () => HALLOWEEN_CARDS.filter((c) => c.url).length;

module.exports = {
  HALLOWEEN_CARDS, OPEN, CLOSE, WAVES,
  isReady, inSeason, waveOpen, releasedCards, drawHalloweenCard, lockedCount, cardCount,
};
