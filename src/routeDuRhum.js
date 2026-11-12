// ═══════════════════════════════════════════════════════════
//  ⛵ MODULE ROUTE DU RHUM
//  Les cartes « hors série » qui ne sortent QUE dans le Booster
//  Route du Rhum (jamais via les réactions, les autres boosters ni la
//  boutique de l'Arène). Même principe que 🎃 Halloween et 🎀 Octobre
//  Rose : intercalaire « Hors série » du classeur, jouables dans l'Arène.
//
//  Rareté interne : 'rhum'. Titre : « ⛵ Route du Rhum N/6 ». Code : RRn.
//
//  ⏰ Vente (décidée par Paul le 2026-11-12) : comme Octobre Rose, du vendredi
//     13/11 au vendredi 20/11 (arrivée du dernier de la course), du lundi au
//     vendredi. Chaque jour, 3 boosters pour tout le monde, 1 par personne,
//     qui tombent à une minute aléatoire entre 9h et 10h (heure de Paris,
//     mécanisme de src/octobreRose.js). 80 JP$ (règles dans src/boosters.js).
//
//  🎲 Les 6 cartes sortent TOUTES sur la durée, dans un ordre aléatoire : à
//     chaque tirage on pioche parmi les moins sorties jusque-là.
//
//  ⚠️ Le booster reste INVISIBLE si un lien de carte est vide (ou en double),
//     comme Halloween et Octobre Rose.
// ═══════════════════════════════════════════════════════════

// 📅 Période de vente (jours à l'heure de Paris, bornes incluses)
const SEASON = { from: '2026-11-13', to: '2026-11-20' };

// 🖼️ Les cartes, dans l'ordre (N/6). `url` = lien slack-files ; `name` =
//    sous-titre optionnel. Ne jamais modifier une URL une fois distribuée :
//    c'est l'identifiant de la carte dans les collections.
const RHUM_CARD_DEFS = [
  { url: 'https://slack-files.com/T6EFSEHCN-F0CJ097JEF2-4d8d6d6b17', name: '' },
  { url: 'https://slack-files.com/T6EFSEHCN-F0CGZLVQHK5-b1b46892fa', name: '' },
  { url: 'https://slack-files.com/T6EFSEHCN-F0CGZLWJ30B-5968210c77', name: '' },
  { url: 'https://slack-files.com/T6EFSEHCN-F0CH3UN9V8W-3b9a1ce954', name: '' },
  { url: 'https://slack-files.com/T6EFSEHCN-F0CJ099TSEL-bcd6f92f33', name: '' },
  { url: 'https://slack-files.com/T6EFSEHCN-F0CGQGMPW1M-9f4348c6c4', name: '' },
];

const RHUM_CARDS = RHUM_CARD_DEFS.map((d, i) => ({
  type: /\.(?:mp4|mov|webm|m4v)(?:$|\?)/i.test(d.url) ? 'video' : 'image',
  url: d.url.trim(),
  title: `⛵ Route du Rhum ${i + 1}/${RHUM_CARD_DEFS.length}${d.name ? ` — ${d.name}` : ''}`,
  rarity: 'rhum',
  number: i + 1,
}));

/** Tous les liens sont renseignés (et distincts). */
function isReady() {
  const urls = RHUM_CARDS.map((c) => c.url).filter(Boolean);
  return urls.length === RHUM_CARDS.length && new Set(urls).size === urls.length;
}

/** Le booster est-il dans sa période de vente ? (le jour de Paris, bornes incluses) */
function inSeason(now = Date.now()) {
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(new Date(now));
  return day >= SEASON.from && day <= SEASON.to;
}

/** Les cartes qu'on peut obtenir maintenant (toutes, pas de vagues : décision de Paul). */
const releasedCards = () => RHUM_CARDS.filter((c) => c.url);

/**
 * Tire une carte Route du Rhum parmi les MOINS distribuées jusqu'ici :
 * chacune sort au moins une fois avant qu'une autre ne sorte une 2e fois.
 * Calculé depuis l'historique → garanti même après un redémarrage du bot.
 * @param {Map<string, number>} drawn - url → nombre de fois déjà sortie
 * @param {Set<string>} exclude       - urls déjà dans ce booster
 */
function drawRhumCard(drawn, exclude = new Set()) {
  const pool = releasedCards().filter((c) => !exclude.has(c.url));
  if (!pool.length) return null;
  const min = Math.min(...pool.map((c) => drawn.get(c.url) || 0));
  const least = pool.filter((c) => (drawn.get(c.url) || 0) === min);
  return least[Math.floor(Math.random() * least.length)];
}

/** Combien de cartes compte la série (liens renseignés). */
const cardCount = () => RHUM_CARDS.filter((c) => c.url).length;

module.exports = {
  RHUM_CARDS, SEASON,
  isReady, inSeason, releasedCards, drawRhumCard, cardCount,
};
