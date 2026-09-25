// ═══════════════════════════════════════════════════════════
//  🧱 MODULE BLOCKS
//  Construit les blocs Slack (Block Kit) pour les messages
// ═══════════════════════════════════════════════════════════

const { getRarityInfo } = require('./media');

/**
 * Vérifie si une URL est une image publiquement accessible
 * (Slack ne peut pas afficher les images qui nécessitent une auth)
 */
function isPublicImageUrl(url) {
  const publicDomains = [
    'media.giphy.com',
    'i.imgur.com',
    'images.unsplash.com',
    'cdn.pixabay.com',
    'res.cloudinary.com',
  ];
  try {
    const hostname = new URL(url).hostname;
    return publicDomains.some((domain) => hostname.includes(domain));
  } catch {
    return false;
  }
}

/**
 * Construit la ligne d'affichage de la rareté d'un média
 */
function buildRarityLine(media) {
  const info = getRarityInfo(media.rarity);
  const rarity = media.rarity || 'common';

  if (rarity === 'legendary') {
    return `${info.emoji} *🎉 JEANPIP LÉGENDAIRE ! 🎉* — _seulement 0.5% de chance !_`;
  }
  if (rarity === 'epic') {
    return `${info.emoji} *Jeanpip Épique !* — _3.5% de chance_`;
  }
  if (rarity === 'rare') {
    return `${info.emoji} *Jeanpip Rare* — _11% de chance_`;
  }
  return `${info.emoji} *Jeanpip Commun*`;
}

/**
 * Construit les blocs Slack pour afficher un média
 * @param {Object} options
 * @param {string} options.headerText - Texte d'en-tête (supporte mrkdwn)
 * @param {Object} options.media - Objet média { type, url, title, rarity }
 * @returns {Array} Blocs Slack Block Kit
 */
function buildMediaBlocks({ headerText, media }) {
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: headerText,
      },
    },
    {
      type: 'divider',
    },
    // Ligne de rareté
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: buildRarityLine(media),
      },
    },
  ];

  if (media.type === 'image' && isPublicImageUrl(media.url)) {
    // Image publique → Slack peut l'afficher en inline
    blocks.push({
      type: 'image',
      image_url: media.url,
      alt_text: media.title,
      title: {
        type: 'plain_text',
        text: media.title,
      },
    });
  } else if (media.type === 'video') {
    // Vidéo → lien cliquable
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🎬 *${media.title}*\n<${media.url}|▶️ Clique ici pour voir la vidéo>`,
      },
    });
  } else {
    // Image privée (slack-files, etc.) → lien cliquable
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🖼️ *${media.title}*\n<${media.url}|👉 Clique ici pour voir l'image>`,
      },
    });
  }

  // Footer
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: '🤖 _Envoyé par Emoji Reactor Bot_',
      },
    ],
  });

  return blocks;
}

/**
 * Message DM « booster ouvert en mode FIFA » : remplace les boutons
 * du message d'achat par un récap texte des 8 cartes.
 * @param {Object} booster - entrée du catalogue { emoji, label } (ou null)
 * @param {Array} cards    - cartes tirées { title, rarity, url, type }
 * @param {Array} counts   - exemplaires possédés après ajout (1 = nouvelle)
 */
function buildWebOpenedBlocks(booster, cards, counts) {
  const emoji = booster ? booster.emoji : '🎁';
  const label = booster ? booster.label : '';
  const lines = cards.map((card, i) => {
    const info = getRarityInfo(card.rarity);
    const count = counts && counts[i];
    const badge = count === 1 ? ' — ✨ _nouvelle_' : count > 1 ? ` — 🔁 _×${count}_` : '';
    return `${info.emoji} <${card.url}|${card.title}>${badge}`;
  });
  const newCount = (counts || []).filter((c) => c === 1).length;

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *Booster ${label} — ✅ ouvert en mode FIFA !* 🎬\n\n${lines.join('\n')}`,
      },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `🗂️ ${newCount} nouvelle(s) carte(s) ajoutée(s) à ta collection` }],
    },
  ];
}

module.exports = { buildMediaBlocks, buildWebOpenedBlocks };
