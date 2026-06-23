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
const TARGET_USER_ID = process.env.TARGET_USER_ID || '';
const TARGET_USER_MESSAGE = process.env.TARGET_USER_MESSAGE || `Hey <@${TARGET_USER_ID}>, tu as posté un message et tu mérites un Jeanpip ! :${TARGET_EMOJI}:`;

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
// ─────────────────────────────────────
let botUserId = null;

// ─────────────────────────────────────────────
// 📡 Listener : message (auto-react sur la cible)
// ─────────────────────────────────────────────
app.event('message', async ({ event, client, logger }) => {
  try {
    // Ignorer si pas de cible configurée
    if (!TARGET_USER_ID) return;

    // Ignorer les messages du bot lui-même
    if (event.user === botUserId) return;

    // Ignorer les messages modifiés, supprimés, etc.
    if (event.subtype) return;

    // Vérifier que c'est la cible
    if (event.user !== TARGET_USER_ID) return;

    logger.info(`🎯 Message de la cible <@${TARGET_USER_ID}> détecté dans <#${event.channel}>`);

    // 1️⃣ Réagir avec :jeanpip: sur le message
    await client.reactions.add({
      channel: event.channel,
      name: TARGET_EMOJI,
      timestamp: event.ts,
    });

    logger.info(`✅ Réaction :${TARGET_EMOJI}: ajoutée au message`);

    // 2️⃣ Envoyer un DM à la cible avec un média aléatoire
    const media = await getRandomMedia();

    await sendDM(client, TARGET_USER_ID, {
      text: TARGET_USER_MESSAGE,
      blocks: buildMediaBlocks({
        headerText: TARGET_USER_MESSAGE,
        media: media,
      }),
    });

    logger.info(`📨 DM envoyé à la cible <@${TARGET_USER_ID}>`);
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

    logger.info(`🎯 Réaction :${TARGET_EMOJI}: détectée par <@${event.user}>`);

    const reactingUserId = event.user;
    const channelId = event.item.channel;
    const messageTs = event.item.ts;

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

      originalAuthorId = result.messages[0].user;
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

    // 5️⃣ DM au réacteur
    await sendDM(client, reactingUserId, {
      text: `Hey @${reactorName} tu as réagi avec jean pip coucou !`,
      blocks: buildMediaBlocks({
        headerText: `Hey <@${reactingUserId}> tu as réagi avec jean pip coucou :${TARGET_EMOJI}:`,
        media: mediaForReactor,
      }),
    });

    logger.info(`📨 DM envoyé au réacteur <@${reactingUserId}>`);

    // 6️⃣ DM à l'auteur du message original
    if (originalAuthorId && originalAuthorId !== reactingUserId) {
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
    }

    logger.info('✅ Flow terminé avec succès');
  } catch (error) {
    logger.error('❌ Erreur dans reaction_added:', error);
  }
});

// ─────────────────────────────────────────────
// 💬 Helper : Envoyer un DM
// ────────────────────────────────────
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

  console.log('');
  console.log('══════════════════════════════════');
  console.log('  ⚡️  Slack Emoji Reactor Bot lancé !');
  console.log(`  🎯  Emoji surveillé : :${TARGET_EMOJI}:`);
  console.log(`  🤖  Bot ID : ${botUserId}`);
  if (TARGET_USER_ID) {
    console.log(`  🎪  Cible auto-react : <@${TARGET_USER_ID}>`);
  }
  console.log('══════════════════════════════════════════');
  console.log('');
})();
