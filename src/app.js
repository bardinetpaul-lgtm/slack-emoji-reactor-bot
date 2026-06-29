// ═══════════════════════════════════════════════════════════
//  🤖 SLACK EMOJI REACTOR BOT
//  Envoie des images/vidéos aléatoires en DM quand
//  quelqu'un réagit avec un emoji spécifique
// ═══════════════════════════════════════════════════════════

const { App, LogLevel } = require('@slack/bolt');
require('dotenv').config();

const { getRandomMedia } = require('./media');
const { buildMediaBlocks } = require('./blocks');
const scores = require('./scores');

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

const TARGET_USER_IDS = process.env.TARGET_USER_IDS
  ? process.env.TARGET_USER_IDS.split(',').map((id) => id.trim()).filter(Boolean)
  : [];

const JEANPIP_ADMINS = process.env.JEANPIP_ADMINS
  ? process.env.JEANPIP_ADMINS.split(',').map((id) => id.trim()).filter(Boolean)
  : [];

// ─────────────────────────────────────────────
// 🚨 Anti-spam config
// ─────────────────────────────────────────────
const SPAM_THRESHOLD_SECONDS = 8;
const SPAM_PUNISHMENT_INTERVAL_MS = 5000;

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

const reactionHistory = new Map();
const spammersBeingPunished = new Set();

function isSpam(userId, channelId, messageTs) {
  const key = `${userId}:${channelId}:${messageTs}`;
  const now = Date.now();
  const lastReaction = reactionHistory.get(key);
  reactionHistory.set(key, now);
  for (const [k, timestamp] of reactionHistory) {
    if (now - timestamp > 60000) reactionHistory.delete(k);
  }
  if (!lastReaction) return false;
  return (now - lastReaction) < (SPAM_THRESHOLD_SECONDS * 1000);
}

async function punishSpammer(client, userId, logger) {
  if (spammersBeingPunished.has(userId)) {
    logger.info(`⏳ <@${userId}> est déjà en cours de punition, on skip`);
    return;
  }
  spammersBeingPunished.add(userId);
  const total = SPAM_TROLL_SEQUENCE.length;
  logger.info(`💀 PUNITION ANTI-SPAM lancée pour <@${userId}>`);
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
      if (i < total - 1) {
        await new Promise((resolve) => setTimeout(resolve, SPAM_PUNISHMENT_INTERVAL_MS));
      }
    } catch (error) {
      logger.error(`❌ Erreur punition ${i + 1}:`, error.message);
    }
  }
  spammersBeingPunished.delete(userId);
  logger.info(`✅ Punition terminée pour <@${userId}>`);
}

async function isBot(client, userId) {
  try {
    const userInfo = await client.users.info({ user: userId });
    return userInfo.user.is_bot || false;
  } catch {
    return false;
  }
}

async function safeSendDM(client, userId, message, logger) {
  const userIsBot = await isBot(client, userId);
  if (userIsBot) {
    logger.info(`ℹ️  <@${userId}> est un bot, pas de DM`);
    return false;
  }
  await sendDM(client, userId, message);
  return true;
}

// ─────────────────────────────────────────────
// 🚀 Initialisation
// ─────────────────────────────────────────────
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  logLevel: LogLevel.INFO,
});

let botUserId = null;
let botName = 'Jeanpip Bot';

// ─────────────────────────────────────────────
// 📡 Listener : message (auto-react sur les cibles)
// ─────────────────────────────────────────────
app.event('message', async ({ event, client, logger }) => {
  try {
    if (TARGET_USER_IDS.length === 0) return;
    if (event.user === botUserId) return;
    if (event.subtype === 'message_changed' || event.subtype === 'message_deleted') return;
    if (!event.user && !event.bot_id) return;
    const authorId = event.user;
    if (!authorId) return;
    if (!TARGET_USER_IDS.includes(authorId)) return;

    logger.info(`🎯 Message de la cible <@${authorId}> détecté dans <#${event.channel}>`);

    await client.reactions.add({
      channel: event.channel,
      name: TARGET_EMOJI,
      timestamp: event.ts,
    });
    logger.info(`✅ Réaction :${TARGET_EMOJI}: ajoutée`);

    const media = await getRandomMedia();
    const sent = await safeSendDM(client, authorId, {
      text: `Bonjour jeune, ${botName} t'a envoyé un Jeanpip !`,
      blocks: buildMediaBlocks({
        headerText: `Bonjour jeune <@${authorId}>, ${botName} t'a envoyé un Jeanpip ! :${TARGET_EMOJI}:`,
        media: media,
      }),
    }, logger);
    if (sent) logger.info(`📨 DM envoyé à la cible <@${authorId}>`);
  } catch (error) {
    logger.error('❌ Erreur dans message listener:', error);
  }
});

// ─────────────────────────────────────────────
// 📡 Listener : reaction_added
// ─────────────────────────────────────────────
app.event('reaction_added', async ({ event, client, logger }) => {
  try {
    if (event.reaction !== TARGET_EMOJI) return;
    if (event.user === botUserId) return;

    const reactingUserId = event.user;
    const channelId = event.item.channel;
    const messageTs = event.item.ts;

    logger.info(`🎯 Réaction :${TARGET_EMOJI}: détectée par <@${reactingUserId}>`);

    // 🚨 Anti-spam
    if (isSpam(reactingUserId, channelId, messageTs)) {
      logger.warn(`🚨 SPAM DÉTECTÉ ! <@${reactingUserId}>`);
      punishSpammer(client, reactingUserId, logger);
      return;
    }

    // 📊 Incrémenter le score du réacteur
    const { justUnlocked, score } = scores.incrementScore(reactingUserId);
    logger.info(`📊 Score de <@${reactingUserId}> : ${score}`);

    // 🎉 Notification déblocage attaque
    if (justUnlocked) {
      await safeSendDM(client, reactingUserId, {
        text: `🎉 Tu as débloqué l'Attaque Jeanpip !`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `🎉 *Tu as débloqué l'Attaque Jeanpip !* :${TARGET_EMOJI}:\n\nTu as envoyé *${scores.ATTACK_THRESHOLD} Jeanpips* cette semaine, bravo !\n\n*Comment l'activer :*\nTape la commande \`/jeanpip-attack\` dans n'importe quel channel pour envoyer un Jeanpip aux 7 dernières personnes ayant posté dans le canal dans lequel tu l'actives !\n\n⚠️ _Si tu n'actives pas ton attaque avant dimanche 20h, tu perds tes Jeanpips._`,
            },
          },
        ],
      }, logger);
      logger.info(`🎉 Notification déblocage envoyée à <@${reactingUserId}>`);
    }

    // Récupérer le message original
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
      originalAuthorId = result.messages[0].user || null;
    } catch (historyError) {
      logger.error(`❌ Impossible de lire le channel:`, historyError.message);
      return;
    }

    const reactorInfo = await client.users.info({ user: reactingUserId });
    const reactorName = reactorInfo.user.real_name || reactorInfo.user.name;

    const mediaForReactor = await getRandomMedia();
    const mediaForAuthor = await getRandomMedia();

    const sentToReactor = await safeSendDM(client, reactingUserId, {
      text: `Hey @${reactorName} tu as réagi avec jean pip coucou !`,
      blocks: buildMediaBlocks({
        headerText: `Hey <@${reactingUserId}> tu as réagi avec jean pip coucou :${TARGET_EMOJI}:`,
        media: mediaForReactor,
      }),
    }, logger);
    if (sentToReactor) logger.info(`📨 DM envoyé au réacteur <@${reactingUserId}>`);

    if (originalAuthorId && originalAuthorId !== reactingUserId) {
      const sentToAuthor = await safeSendDM(client, originalAuthorId, {
        text: `Bonjour jeune, ${reactorName} t'a envoyé un Jeanpip !`,
        blocks: buildMediaBlocks({
          headerText: `Bonjour jeune <@${originalAuthorId}>, <@${reactingUserId}> t'a envoyé un Jeanpip ! :${TARGET_EMOJI}:`,
          media: mediaForAuthor,
        }),
      }, logger);
      if (sentToAuthor) logger.info(`📨 DM envoyé à l'auteur <@${originalAuthorId}>`);
    }

    logger.info('✅ Flow terminé avec succès');
  } catch (error) {
    logger.error('❌ Erreur dans reaction_added:', error);
  }
});

// ─────────────────────────────────────────────
// ⚔️  Slash command : /jeanpip-attack
// ─────────────────────────────────────────────
app.command('/jeanpip-attack', async ({ command, ack, client, logger }) => {
  await ack();

  const userId = command.user_id;
  const channelId = command.channel_id;

  try {
    const isAdmin = JEANPIP_ADMINS.includes(userId);
    const userHasAttack = scores.hasAttack(userId);

    // Vérifier les droits
    if (!isAdmin && !userHasAttack) {
      const currentScore = scores.getScore(userId);
      await safeSendDM(client, userId, {
        text: `❌ Tu n'as pas encore débloqué l'Attaque Jeanpip !`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *Tu n'as pas encore débloqué l'Attaque Jeanpip !*\n\nTon score cette semaine : *${currentScore}/${scores.ATTACK_THRESHOLD}* :${TARGET_EMOJI}:\n\nEnvoie des Jeanpips pour débloquer la feature !`,
            },
          },
        ],
      }, logger);
      logger.info(`⛔ <@${userId}> n'a pas les droits pour /jeanpip-attack (score: ${currentScore})`);
      return;
    }

    // Récupérer les 7 derniers auteurs uniques du channel
    logger.info(`⚔️  Attaque Jeanpip lancée par <@${userId}> dans <#${channelId}>`);

    const result = await client.conversations.history({
      channel: channelId,
      limit: 50,
    });

    const victims = [];
    const seen = new Set();

    for (const msg of result.messages) {
      // Ignorer les messages sans user, les bots et l'attaquant
      if (!msg.user) continue;
      if (msg.bot_id) continue;
      if (msg.user === userId) continue;
      if (msg.user === botUserId) continue;
      if (seen.has(msg.user)) continue;

      seen.add(msg.user);
      victims.push(msg.user);

      if (victims.length >= 7) break;
    }

    if (victims.length === 0) {
      await safeSendDM(client, userId, {
        text: `😅 Pas assez de monde à attaquer dans ce channel !`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `😅 *Pas assez de monde à attaquer dans ce channel !*\nAucune victime trouvée parmi les derniers messages.`,
            },
          },
        ],
      }, logger);
      return;
    }

    // Consommer l'attaque (si pas admin)
    if (!isAdmin) {
      scores.consumeAttack(userId);
    }

    // Récupérer le nom de l'attaquant
    const attackerInfo = await client.users.info({ user: userId });
    const attackerName = attackerInfo.user.real_name || attackerInfo.user.name;

    // Envoyer un DM à chaque victime
    let sent = 0;
    for (const victimId of victims) {
      try {
        const media = await getRandomMedia();
        const ok = await safeSendDM(client, victimId, {
          text: `🚨 ALERTE ! ${attackerName} a lancé une Attaque Jeanpip !`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `🚨 *ALERTE ATTAQUE JEANPIP !*\n*<@${userId}>* t'a ciblé avec une Attaque Jeanpip dans <#${channelId}> ! :${TARGET_EMOJI}:`,
              },
            },
            { type: 'divider' },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `🖼️ *${media.title}*\n<${media.url}|👉 Clique ici pour voir l'image>`,
              },
            },
            {
              type: 'context',
              elements: [{ type: 'mrkdwn', text: '🤖 _Envoyé par Emoji Reactor Bot_' }],
            },
          ],
        }, logger);
        if (ok) sent++;
        logger.info(`⚔️  Attaque envoyée à <@${victimId}>`);
      } catch (error) {
        logger.error(`❌ Erreur envoi attaque à <@${victimId}>:`, error.message);
      }
    }

    // Confirmation à l'attaquant
    await safeSendDM(client, userId, {
      text: `⚔️ Attaque Jeanpip lancée sur ${sent} personnes !`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `⚔️ *Attaque Jeanpip lancée !*\n\nTu as ciblé *${sent} personne(s)* dans <#${channelId}> :${TARGET_EMOJI}:\n${victims.map(v => `• <@${v}>`).join('\n')}`,
          },
        },
      ],
    }, logger);

    logger.info(`✅ Attaque Jeanpip terminée : ${sent}/${victims.length} victimes touchées`);
  } catch (error) {
    logger.error('❌ Erreur dans /jeanpip-attack:', error);
  }
});

// ─────────────────────────────────────────────
// 💬 Helpers
// ─────────────────────────────────────────────
async function sendDM(client, userId, message) {
  const conversation = await client.conversations.open({ users: userId });
  await client.chat.postMessage({
    channel: conversation.channel.id,
    text: message.text,
    blocks: message.blocks,
  });
}

// ─────────────────────────────────────────────
// ▶️  Démarrage
// ─────────────────────────────────────────────
(async () => {
  await app.start();

  const authResult = await app.client.auth.test();
  botUserId = authResult.user_id;
  botName = authResult.user || 'Jeanpip Bot';

  // Vérifier le reset hebdomadaire au démarrage
  scores.checkAndReset();

  // Vérifier le reset toutes les heures
  setInterval(() => scores.checkAndReset(), 60 * 60 * 1000);

  console.log('');
  console.log('══════════════════════════════════════════');
  console.log('  ⚡️  Slack Emoji Reactor Bot lancé !');
  console.log(`  🎯  Emoji surveillé : :${TARGET_EMOJI}:`);
  console.log(`  🤖  Bot ID : ${botUserId}`);
  console.log(`  🚨  Anti-spam : ${SPAM_THRESHOLD_SECONDS}s seuil → ${SPAM_TROLL_SEQUENCE.length}x troll`);
  console.log(`  ⚔️   Attaque Jeanpip : seuil ${scores.ATTACK_THRESHOLD} jeanpips/semaine`);
  if (JEANPIP_ADMINS.length > 0) {
    console.log(`  👑  Admins attaque (${JEANPIP_ADMINS.length}) : ${JEANPIP_ADMINS.join(', ')}`);
  }
  if (TARGET_USER_IDS.length > 0) {
    console.log(`  🎪  Cibles auto-react (${TARGET_USER_IDS.length}) :`);
    TARGET_USER_IDS.forEach((id) => console.log(`       → <@${id}>`));
  }
  console.log('══════════════════════════════════════════');
  console.log('');
})();
