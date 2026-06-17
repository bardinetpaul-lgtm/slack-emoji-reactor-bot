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
// 📡 Listener : reaction_added
// ─────────────────────────────────────────────
app.event('reaction_added', async ({ event, client, logger }) => {
  try {
    // 1️⃣ Vérifier que c'est le bon emoji
    if (event.reaction !== TARGET_EMOJI) {
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
      // Le bot n'a peut-être pas accès au channel
      logger.error(`❌ Impossible de lire le channel ${channelId}:`, historyError.message);
      logger.info('💡 Assure-toi que le bot est invité dans le channel (/invite @BotName)');
      return;
    }

    // 3️⃣ Choisir 2 médias aléatoires
    const mediaForReactor = await getRandomMedia();
    const mediaForAuthor = await getRandomMedia();

    // 4️⃣ Envoyer un DM à celui qui a réagi
    await sendDM(client, reactingUserId, {
      text: `Tu as réagi avec :${TARGET_EMOJI}: ! Voici ta surprise 🎁`,
      blocks: buildMediaBlocks({
        headerText: `✨ Tu as réagi avec :${TARGET_EMOJI}: !\nVoici ta surprise :`,
        media: mediaForReactor,
      }),
    });

    logger.info(`📨 DM envoyé au réacteur <@${reactingUserId}>`);

    // 5️⃣ Envoyer un DM à l'auteur du message original
    if (originalAuthorId && originalAuthorId !== reactingUserId) {
      // Récupérer le nom du réacteur
      const reactorInfo = await client.users.info({ user: reactingUserId });
      const reactorName = reactorInfo.user.real_name || reactorInfo.user.name;

      await sendDM(client, originalAuthorId, {
        text: `${reactorName} a réagi à ton message avec :${TARGET_EMOJI}: !`,
        blocks: buildMediaBlocks({
          headerText: `🎉 *${reactorName}* a réagi à ton message avec :${TARGET_EMOJI}: !\nVoici un petit cadeau :`,
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
  console.log('');
  console.log('══════════════════════════════════════════');
  console.log('  ⚡️  Slack Emoji Reactor Bot lancé !');
  console.log(`  🎯  Emoji surveillé : :${TARGET_EMOJI}:`);
  console.log('══════════════════════════════════════════');
  console.log('');
})();
