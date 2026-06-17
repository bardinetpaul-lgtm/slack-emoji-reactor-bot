// ═══════════════════════════════════════════════════════════
//  🧱 MODULE BLOCKS
//  Construit les blocs Slack (Block Kit) pour les messages
// ═══════════════════════════════════════════════════════════

/**
 * Construit les blocs Slack pour afficher un média
 * @param {Object} options
 * @param {string} options.headerText - Texte d'en-tête (supporte mrkdwn)
 * @param {Object} options.media - Objet média { type, url, title }
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
  ];

  if (media.type === 'image') {
    // Slack supporte nativement les blocs image
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
    // Pour les vidéos, on envoie un lien cliquable
    // (Slack ne supporte pas les blocs vidéo en DM natif)
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🎬 *${media.title}*\n<${media.url}|▶️ Clique ici pour voir la vidéo>`,
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

module.exports = { buildMediaBlocks };
