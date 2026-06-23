// ═══════════════════════════════════════════════════════════
//  🤖 SLACK EMOJI REACTOR BOT
//  Envoie des images/vidéos aléatoires en DM quand
//  quelqu'un réagit avec un emoji spécifique
// ═══════════════════════════════════════════════════════════

const { App, LogLevel } = require('@slack/bolt');
require('dotenv').config();

const { getRandomMedia } = require('./media');
const { buildMediaBlocks } = require('./blocks');

// ─────────────────────────────────────────────
// 🔧 Validation de la configuration
// ─────────────────────────────────────────────
const REQUIRED_ENV = ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET', 'SLACK_APP_TOKEN', 'TARGET_EMOJI'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ Variable d'environnement manquante : ${key}`);
    console.error(`   → Copie .env.example en .env et remplis les valeurs`);
    process.exit(1);
  }
}

const TARGET_EMOJI = process.env.TARGET_EMOJI;

// Multi-cibles : on parse la liste séparée par des virgules
const TARGET_USER_IDS = process.env.TARGET_USER_IDS
  ? process.env.TARGET_USER_IDS.split(',').map((id) => id.trim()).filter(Boolean)
  : [];

// ─────────────────────────────────────────────
// 🚨 Anti-spam config
// ─────────────────────────────────────────────
const SPAM_THRESHOLD_SECONDS = 8;
const SPAM_PUNISHMENT_INTERVAL_MS = 5000; // 5 secondes

// Les 10 photos troll envoyées dans l'ordre au spammeur
const SPAM_TROLL_SEQUENCE = [
  { type: 'image', url: 'https://slack-files.com/T6EFSEHCN-F0BDBMU8CTS-77c6932553', title: '🚨 Spammer c\'est mal.' },
  { type: 'image', url: 'https://slack-files.com/T6EFSEHCN-F0BCE3SGC7P-941026d6a8', title: '🚨 Spammer c\'est mal.' },
  { type: 'image', url: 'https://slack-files.com/T6EFSEHCN-F0BC21YHVAB-83455d1ed8', title: '🚨 Spammer c\'est mal.' },
  { type: 'image', url: 'https://slack-files.com/T6EFSEHCN-F0BDBQLPEF2-af87fefb2a', title: '🚨 Spammer c\'est mal.' },
  { type: 'image', url: 'https://slack-files.com/T6EFSEHCN-F0BCE55GUBX-07592141a1', title: '🚨 Spammer c\'est mal.' },
  { type: 'image', url: 'https://slack-files.com/T6EFSEHCN-F0BCE5J6URK-53abe5b196', title: '🚨 Spammer c\'est mal.' },
  { type: 'image', url: 'https://slack-files.com/T6EFSEHCN-F0BC23V6JKH-e490b68a5e', title: '🚨 Spammer c\'est mal.' },
  { type: 'image', url: 'https://slack-files.com/T6EFSEHCN-F0BCB7W1FH9-737f44b887', title: '🚨 Spammer c\'est mal.' },
  { type: 'image', url: 'https://slack-files.com/T6EFSEHCN-F0BCFG6PKFY-7090b859e8', title: '🚨 Spammer c\'est mal.' },
  { type: 'image', url: 'https://slack-files.com/T6EFSEHCN-F0BCM8HH7FE-514efee20f', title: '🚨 Spammer c\'est mal.' },
];

// Mémoire des réactions : clé = "userId:channelId:messageTs" → timestamp
const reactionHistory = new Map();

// Set des spammeurs en cours de punition (pour éviter double punition)
const spammersBeingPunished = new Set();

/**
 * Vérifie si c'est du spam et retourne true si oui
 * Spam = même personne réagit sur le même message en moins de 8s
 */
function isSpam(userId, channelId, messageTs) {
  const key = `${userId}:${channelId}:${messageTs}`;
  const now = Date.now();
  const lastReaction = reactionHistory.get(key);

  // Enregistrer cette réaction
  reactionHistory.set(key, now);

  // Nettoyer les vieilles entrées (> 60s) pour ne pas fuir la mémoire
  for (const [k, timestamp] of reactionHistory) {
    if (now - timestamp > 60000) {
      reactionHistory.delete(k);
    }
  }

  // Si pas de réaction précédente sur ce message → pas spam
  if (!lastReaction) return false;

  // Si moins de 8 secondes → SPAM
  return (now - lastReaction) < (SPAM_THRESHOLD_SECONDS * 1000);
}

/**
 * Punir le spammeur : 10 DMs avec des photos troll différentes, une toutes les 5s
 */
async function punishSpammer(client, userId, logger) {
  // Éviter de double-punir si déjà en cours
  if (spammersBeingPunished.has(userId)) {
    logger.info(`⏳ <@${userId}> est déjà en cours de punition, on skip`);
    return;
  }

  spammersBeingPunished.add(userId);
  const total = SPAM_TROLL_SEQUENCE.length;
  logger.info(`💀 PUNITION ANTI-SPAM lancée pour <@${userId}> : ${total} Jeanpips en ${total * 5}s`);

  for (let i = 0; i < total; i++) {
    try {
      await sendDM(client, userId, {
        text: `🚨 Spammer c'est mal. (${i + 1}/${total})`,
        blocks: buildMediaBlocks({
          headerText: `🚨 Spammer c'est mal. (${i + 1}/${total})`,
          media: SPAM_TROLL_SEQUENCE[i],
        }),
      });

      logger.info(`💀 Punition ${i + 1}/${total} envoyée à <@${userId}>`);

      // Attendre 5 secondes avant le prochain (sauf le dernier)
      if (i < total - 1) {
        await new Promise((resolve) => setTimeout(resolve, SPAM_PUNISHMENT_INTERVAL_MS));
      }
    } catch (error) {
      logger.error(`❌ Erreur punition ${i + 1} pour <@${userId}>:`, error.message);
    }
  }

  spammersBeingPunished.delete(userId);
  logger.info(`✅ Punition terminée pour <@${userId}>`);
}

/**
 * Vérifie si un utilisateur est un bot
 */
async function isBot(client, userId) {
  try {
    const userInfo = await client.users.info({ user: userId });
    return userInfo.user.is_bot || false;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────
// 🚀 Initialisation de l'app Slack Bolt
// ─────────────────────────────────────────────
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  logLevel: LogLevel.INFO,
});

// ─────────────────────────────────────────────
// 🤖 Récupérer l'ID du bot au démarrage
// ─────────────────────────────────────────────
let botUserId = null;
let botName = 'Jeanpip Bot';

// ─────────────────────────────────────────────
// 📡 Listener : message (auto-react sur les cibles)
//    + déclenche le flow normal (DM à la cible)
// ─────────────────────────────────────────────
app.event('message', async ({ event, client, logger }) => {
  try {
    // Ignorer si pas de cibles configurées
    if (TARGET_USER_IDS.length === 0) return;

    // Ignorer les messages du bot lui-même
    if (event.user === botUserId) return;

    // Ignorer les messages de bots / apps / intégrations
    if (event.subtype) return;
    if (event.bot_id) return;
    if (event.app_id) return;
    if (!event.user) return;

    // Vérifier que c'est une des cibles
    if (!TARGET_USER_IDS.includes(event.user)) return;

    logger.info(`🎯 Message de la cible <@${event.user}> détecté dans <#${event.channel}>`);

    // 1️⃣ Réagir avec :jeanpip: sur le message
    await client.reactions.add({
      channel: event.channel,
      name: TARGET_EMOJI,
      timestamp: event.ts,
    });

    logger.info(`✅ Réaction :${TARGET_EMOJI}: ajoutée au message de <@${event.user}>`);

    // 2️⃣ Déclencher le flow normal → DM à la cible
    const media = await getRandomMedia();

    await sendDM(client, event.user, {
      text: `Bonjour jeune, ${botName} t'a envoyé un Jeanpip !`,
      blocks: buildMediaBlocks({
        headerText: `Bonjour jeune <@${event.user}>, ${botName} t'a envoyé un Jeanpip ! :${TARGET_EMOJI}:`,
        media: media,
      }),
    });

    logger.info(`📨 DM envoyé à la cible <@${event.user}>`);
  } catch (error) {
    logger.error('❌ Erreur dans message listener:', error);
  }
});

// ─────────────────────────────────────────────
// 📡 Listener : reaction_added
// ─────────────────────────────────────────────
app.event('reaction_added', async ({ event, client, logger }) => {
  try {
    // 1️⃣ Vérifier que c'est le bon emoji
    if (event.reaction !== TARGET_EMOJI) {
      return;
    }

    // 🛡️ Ignorer les réactions du bot lui-même (anti-boucle)
    if (event.user === botUserId) {
      return;
    }

    const reactingUserId = event.user;
    const channelId = event.item.channel;
    const messageTs = event.item.ts;

    logger.info(`🎯 Réaction :${TARGET_EMOJI}: détectée par <@${reactingUserId}>`);

    // 🚨 ANTI-SPAM : vérifier si c'est du spam
    if (isSpam(reactingUserId, channelId, messageTs)) {
      logger.warn(`🚨 SPAM DÉTECTÉ ! <@${reactingUserId}> a spammé :${TARGET_EMOJI}: sur le même message`);

      // Punir le spammeur (en arrière-plan, pas de await pour ne pas bloquer)
      punishSpammer(client, reactingUserId, logger);

      // La victime ne reçoit rien → on arrête le flow ici
      return;
    }

    // 2️⃣ Récupérer le message original pour trouver son auteur
    let originalAuthorId;
    try {
      const result = await client.conversations.history({
        channel: channelId,
        latest: messageTs,
        inclusive: true,
        limit: 1,
      });

      if (!result.messages || result.messages.length === 0) {
        logger.warn('⚠️  Message original introuvable');
        return;
      }

      const originalMessage = result.messages[0];
      originalAuthorId = originalMessage.user;

      // 🛡️ Si le message a été posté par un bot → pas de DM à l'auteur
      if (originalMessage.bot_id || !originalAuthorId) {
        logger.info('ℹ️  Message posté par un bot, pas de DM à l\'auteur');
        originalAuthorId = null;
      }
    } catch (historyError) {
      logger.error(`❌ Impossible de lire le channel ${channelId}:`, historyError.message);
      logger.info('💡 Assure-toi que le bot est invité dans le channel (/invite @BotName)');
      return;
    }

    // 3️⃣ Récupérer le nom du réacteur
    const reactorInfo = await client.users.info({ user: reactingUserId });
    const reactorName = reactorInfo.user.real_name || reactorInfo.user.name;

    // 4️⃣ Choisir 2 médias aléatoires
    const mediaForReactor = await getRandomMedia();
    const mediaForAuthor = await getRandomMedia();

    // 5️⃣ DM au réacteur (seulement si c'est un humain)
    if (!reactorInfo.user.is_bot) {
      await sendDM(client, reactingUserId, {
        text: `Hey @${reactorName} tu as réagi avec jean pip coucou !`,
        blocks: buildMediaBlocks({
          headerText: `Hey <@${reactingUserId}> tu as réagi avec jean pip coucou :${TARGET_EMOJI}:`,
          media: mediaForReactor,
        }),
      });

      logger.info(`📨 DM envoyé au réacteur <@${reactingUserId}>`);
    }

    // 6️⃣ DM à l'auteur du message original (seulement si humain et différent du réacteur)
    if (originalAuthorId && originalAuthorId !== reactingUserId) {
      // Vérifier que l'auteur n'est pas un bot
      const authorIsBot = await isBot(client, originalAuthorId);
      if (!authorIsBot) {
        const authorInfo = await client.users.info({ user: originalAuthorId });
        const authorName = authorInfo.user.real_name || authorInfo.user.name;

        await sendDM(client, originalAuthorId, {
          text: `Bonjour jeune @${authorName}, ${reactorName} t'a envoyé un Jeanpip !`,
          blocks: buildMediaBlocks({
            headerText: `Bonjour jeune <@${originalAuthorId}>, <@${reactingUserId}> t'a envoyé un Jeanpip ! :${TARGET_EMOJI}:`,
            media: mediaForAuthor,
          }),
        });

        logger.info(`📨 DM envoyé à l'auteur <@${originalAuthorId}>`);
      } else {
        logger.info(`ℹ️  Auteur <@${originalAuthorId}> est un bot, pas de DM`);
      }
    }

    logger.info('✅ Flow terminé avec succès');
  } catch (error) {
    logger.error('❌ Erreur dans reaction_added:', error);
  }
});

// ─────────────────────────────────────────────
// 💬 Helper : Envoyer un DM
// ─────────────────────────────────────────────
async function sendDM(client, userId, message) {
  const conversation = await client.conversations.open({
    users: userId,
  });

  await client.chat.postMessage({
    channel: conversation.channel.id,
    text: message.text,
    blocks: message.blocks,
  });
}

// ─────────────────────────────────────────────
// ▶️  Démarrage du bot
// ─────────────────────────────────────────────
(async () => {
  await app.start();

  // Récupérer l'ID du bot pour l'anti-boucle
  const authResult = await app.client.auth.test();
  botUserId = authResult.user_id;
  botName = authResult.user || 'Jeanpip Bot';

  console.log('');
  console.log('══════════════════════════════════════════');
  console.log('  ⚡️  Slack Emoji Reactor Bot lancé !');
  console.log(`  🎯  Emoji surveillé : :${TARGET_EMOJI}:`);
  console.log(`  🤖  Bot ID : ${botUserId}`);
  console.log(`  🚨  Anti-spam : ${SPAM_THRESHOLD_SECONDS}s seuil → ${SPAM_TROLL_SEQUENCE.length}x troll (toutes les 5s)`);
  if (TARGET_USER_IDS.length > 0) {
    console.log(`  🎪  Cibles auto-react (${TARGET_USER_IDS.length}) :`);
    TARGET_USER_IDS.forEach((id) => console.log(`       → <@${id}>`));
  } else {
    console.log('  🎪  Aucune cible auto-react configurée');
  }
  console.log('══════════════════════════════════════════');
  console.log('');
})();
