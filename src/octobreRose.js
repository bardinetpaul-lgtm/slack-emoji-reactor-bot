// ═══════════════════════════════════════════════════════════
//  🎀 MODULE OCTOBRE ROSE
//  Les 8 cartes « hors série » qui ne sortent QUE dans le Booster
//  Octobre Rose (jamais via les réactions, les autres boosters ni
//  la boutique de l'Arène). Comme les photos anti-spam, elles ne sont
//  pas dans la banque de médias : intercalaire « Hors série » du
//  classeur, hors pourcentage de complétion, absentes de l'Arène.
//
//  Rareté interne : 'rose'. Titre : « 🎀 Octobre Rose N/8 ».
//
//  ⚠️ Le booster reste INVISIBLE tant que les 8 liens ne sont pas
//  renseignés ci-dessous (et hors de la période SEASON).
// ═══════════════════════════════════════════════════════════

// 📅 Période de vente (jours à l'heure de Paris, bornes incluses)
const SEASON = { from: '2026-10-01', to: '2026-10-31' };

// 🖼️ Les 8 cartes, dans l'ordre (N/8). `url` = lien slack-files (comme les
//    photos anti-spam) ou image publique ; `name` = sous-titre optionnel.
//    Ne jamais modifier une URL une fois distribuée : c'est l'identifiant
//    de la carte dans les collections.
const ROSE_CARD_DEFS = [
  { url: '', name: '' },
  { url: '', name: '' },
  { url: '', name: '' },
  { url: '', name: '' },
  { url: '', name: '' },
  { url: '', name: '' },
  { url: '', name: '' },
  { url: '', name: '' },
];

const ROSE_CARDS = ROSE_CARD_DEFS.map((d, i) => ({
  type: /\.(?:mp4|mov|webm|m4v)(?:$|\?)/i.test(d.url) ? 'video' : 'image',
  url: d.url.trim(),
  title: `🎀 Octobre Rose ${i + 1}/${ROSE_CARD_DEFS.length}${d.name ? ` — ${d.name}` : ''}`,
  rarity: 'rose',
  number: i + 1,
}));

/** Les 8 liens sont renseignés (et distincts). */
function isReady() {
  const urls = ROSE_CARDS.map((c) => c.url).filter(Boolean);
  return urls.length === ROSE_CARDS.length && new Set(urls).size === urls.length;
}

const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' });
/** Jour « AAAA-MM-JJ » à l'heure de Paris. */
const parisDay = (when) => dayFmt.format(new Date(when));

function inSeason(now = Date.now()) {
  const day = parisDay(now);
  return day >= SEASON.from && day <= SEASON.to;
}

/**
 * Tire une carte Octobre Rose parmi les MOINS distribuées jusqu'ici
 * (toutes ouvertures confondues) : chacune des 8 cartes sort au moins
 * une fois avant qu'une autre ne sorte une 2e fois. Calculé depuis
 * l'historique → garanti même après un redémarrage du bot.
 * @param {Map<string, number>} drawn - url → nombre de fois déjà sortie
 * @param {Set<string>} exclude       - urls déjà dans ce booster
 */
function drawRoseCard(drawn, exclude = new Set()) {
  const pool = ROSE_CARDS.filter((c) => c.url && !exclude.has(c.url));
  if (!pool.length) return null;
  const min = Math.min(...pool.map((c) => drawn.get(c.url) || 0));
  const least = pool.filter((c) => (drawn.get(c.url) || 0) === min);
  return least[Math.floor(Math.random() * least.length)];
}

module.exports = { ROSE_CARDS, SEASON, isReady, inSeason, parisDay, drawRoseCard };
