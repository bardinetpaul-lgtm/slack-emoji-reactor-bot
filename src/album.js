// ═══════════════════════════════════════════════════════════
//  📒 MODULE ALBUM — le classeur Panini d'un joueur (page web)
//
//  Chaque média de la banque = un emplacement numéroté du classeur
//  (le numéro vient du titre « Surprise #N »). Les emplacements sont
//  rangés par rareté (intercalaires), puis par numéro.
//
//  Confidentialité : pour une carte NON possédée, on n'envoie que son
//  numéro et sa rareté — jamais son image, son titre ni son lien.
//
//  Intercalaire « Hors série » (hors pourcentage de complétion) :
//    • les 10 photos anti-spam #62 → #71 (emplacements toujours affichés)
//    • les cartes possédées qui ne sont plus dans la banque
//
//  Fonction pure (lecture seule) : aucun appel Slack ici.
// ═══════════════════════════════════════════════════════════

const crypto = require('crypto');

const collections = require('./collections');
const { getAllMedia, RARITIES } = require('./media');
const { cardImageUrl } = require('./cardImages');
const { SPAM_CARDS } = require('./spamCards');

const SECTION_ORDER = ['common', 'rare', 'epic', 'legendary'];

function rarityOf(value) {
  return RARITIES[value] ? value : 'common';
}

/** « 🎉 Surprise #12 — Titre » → 12 (null si pas de numéro). */
function numberFromTitle(title) {
  const match = /#(\d+)/.exec(title || '');
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Numérote la banque : numéro du titre, sinon (ou si déjà pris)
 * le premier numéro libre après le plus grand.
 */
function numberBank(bank) {
  const used = new Set();
  const numbers = bank.map((m) => {
    const n = numberFromTitle(m.title);
    if (n && !used.has(n)) {
      used.add(n);
      return n;
    }
    return null;
  });
  let next = used.size ? Math.max(...used) : 0;
  return numbers.map((n) => {
    if (n) return n;
    do { next += 1; } while (used.has(next));
    used.add(next);
    return next;
  });
}

function ownedSticker(n, rarity, card, mediaCard) {
  return {
    n,
    rarity,
    owned: true,
    count: card.count,
    title: card.title || (mediaCard && mediaCard.title) || `#${n}`,
    image: cardImageUrl({ url: card.url, type: card.type || (mediaCard && mediaCard.type) }),
    link: card.url,
    firstAt: card.firstAt || null,
    lastAt: card.lastAt || null,
  };
}

/**
 * Classeur d'un joueur.
 * @returns {{ sections: Array<{ key, stickers }>, stats, version }}
 */
function buildAlbum(userId) {
  const bank = getAllMedia().filter((m) => m && m.url);
  const numbers = numberBank(bank);
  const owned = new Map(collections.getCollection(userId).map((c) => [c.url, c]));

  const sections = Object.fromEntries(SECTION_ORDER.map((k) => [k, []]));
  const seen = new Set();

  bank.forEach((m, i) => {
    if (seen.has(m.url)) return; // doublon dans la banque → un seul emplacement
    seen.add(m.url);
    const rarity = rarityOf(m.rarity);
    const card = owned.get(m.url);
    sections[rarity].push(card
      ? ownedSticker(numbers[i], rarity, card, m)
      : { n: numbers[i], rarity, owned: false });
  });

  // 🚨 Hors série : les photos anti-spam (emplacements fixes)…
  const extra = SPAM_CARDS.filter((c) => !seen.has(c.url)).map((c) => {
    seen.add(c.url);
    const card = owned.get(c.url);
    return card ? ownedSticker(c.number, 'extra', card, c) : { n: c.number, rarity: 'extra', owned: false };
  });
  // 🗃️ … puis les cartes possédées retirées de la banque
  extra.push(...[...owned.values()]
    .filter((c) => !seen.has(c.url))
    .sort((a, b) => (a.firstAt || '').localeCompare(b.firstAt || ''))
    .map((c) => ownedSticker(numberFromTitle(c.title) || 0, 'extra', c, null)));

  const list = SECTION_ORDER.map((key) => ({
    key,
    stickers: sections[key].sort((a, b) => a.n - b.n),
  })).filter((s) => s.stickers.length);
  if (extra.length) list.push({ key: 'extra', stickers: extra });

  // 📊 Statistiques (le « Hors série » ne compte pas dans la complétion)
  const byRarity = {};
  let total = 0;
  let got = 0;
  let copies = 0;
  let unique = 0;
  for (const s of list) {
    for (const st of s.stickers) {
      byRarity[s.key] = byRarity[s.key] || { total: 0, owned: 0 };
      byRarity[s.key].total += 1;
      if (st.owned) {
        byRarity[s.key].owned += 1;
        copies += st.count;
        unique += 1;
      }
      if (s.key === 'extra') continue;
      total += 1;
      if (st.owned) got += 1;
    }
  }
  const stats = { total, owned: got, copies, doubles: copies - unique, byRarity };

  // 🔁 Empreinte : change dès qu'une carte arrive (la page ne redessine que dans ce cas)
  const version = crypto.createHash('sha1')
    .update(JSON.stringify(list.map((s) => s.stickers.map((st) => [st.n, st.rarity, st.owned ? st.count : 0]))))
    .digest('hex')
    .slice(0, 12);

  return { sections: list, stats, version };
}

module.exports = { buildAlbum, numberFromTitle };
