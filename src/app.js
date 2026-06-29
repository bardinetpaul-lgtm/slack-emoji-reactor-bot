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

    // 📊 Incrémenter le score
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

    if (!isAdmin && !userHasAttack) {
      const currentScore = scores.getScore(userId);
      await safeSendDM(client, userId, {
        text: `❌ Tu n'as pas encore débloqué l'Attaque Jeanpip !`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *Tu n'as pas encore débloqué l'Attaque Jeanpip !*\n\nTon score cette semaine : *${currentScore}/${scores.ATTACK_THRESHOLD}* :${TARGET_EMOJI}:\n\nEnvoie des Jeanpips pour débloquer la feature ! 💪\n\n_Tape \`/jeanpip-help\` pour voir toutes les features disponibles._`,
            },
          },
        ],
      }, logger);
      return;
    }

    logger.info(`⚔️  Attaque Jeanpip lancée par <@${userId}> dans <#${channelId}>`);

    const result = await client.conversations.history({ channel: channelId, limit: 50 });
    const victims = [];
    const seen = new Set();

    for (const msg of result.messages) {
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
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `😅 *Pas assez de monde à attaquer dans ce channel !*` } }],
      }, logger);
      return;
    }

    if (!isAdmin) scores.consumeAttack(userId);

    const attackerInfo = await client.users.info({ user: userId });
    const attackerName = attackerInfo.user.real_name || attackerInfo.user.name;

    let sent = 0;
    for (const victimId of victims) {
      try {
        const media = await getRandomMedia();
        const ok = await safeSendDM(client, victimId, {
          text: `🚨 ALERTE ! ${attackerName} a lancé une Attaque Jeanpip !`,
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: `🚨 *ALERTE ATTAQUE JEANPIP !*\n*<@${userId}>* t'a ciblé dans <#${channelId}> ! :${TARGET_EMOJI}:` } },
            { type: 'divider' },
            { type: 'section', text: { type: 'mrkdwn', text: `🖼️ *${media.title}*\n<${media.url}|👉 Clique ici pour voir l'image>` } },
            { type: 'context', elements: [{ type: 'mrkdwn', text: '🤖 _Envoyé par Emoji Reactor Bot_' }] },
          ],
        }, logger);
        if (ok) sent++;
      } catch (error) {
        logger.error(`❌ Erreur envoi attaque à <@${victimId}>:`, error.message);
      }
    }

    await safeSendDM(client, userId, {
      text: `⚔️ Attaque Jeanpip lancée sur ${sent} personnes !`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `⚔️ *Attaque Jeanpip lancée !*\n\nTu as ciblé *${sent} personne(s)* dans <#${channelId}> :${TARGET_EMOJI}:\n${victims.map(v => `• <@${v}>`).join('\n')}` } }],
    }, logger);

    logger.info(`✅ Attaque Jeanpip terminée : ${sent}/${victims.length} victimes`);
  } catch (error) {
    logger.error('❌ Erreur dans /jeanpip-attack:', error);
  }
});

// ─────────────────────────────────────────────
// ❓ Slash command : /jeanpip-help
// ─────────────────────────────────────────────
app.command('/jeanpip-help', async ({ command, ack, client, logger }) => {
  await ack();

  const userId = command.user_id;
  const isAdmin = JEANPIP_ADMINS.includes(userId);
  const currentScore = scores.getScore(userId);
  const userHasAttack = scores.hasAttack(userId);

  try {
    await safeSendDM(client, userId, {
      text: `👋 Voici toutes les features du Jeanpip Bot !`,
      blocks: [
        // Header
        {
          type: 'header',
          text: { type: 'plain_text', text: `🤖 Jeanpip Bot — Guide complet` },
        },
        { type: 'divider' },

        // Feature 1 : Réaction Jeanpip
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:${TARGET_EMOJI}: *Réaction Jeanpip*\nQuand quelqu'un réagit avec :${TARGET_EMOJI}: sur un message :\n• La personne qui a réagi reçoit un DM avec une image/vidéo aléatoire\n• L'auteur du message reçoit aussi un DM avec une image/vidéo aléatoire`,
          },
        },
        { type: 'divider' },

        // Feature 2 : Score
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `📊 *Ton score cette semaine*\nTu as envoyé *${currentScore}/${scores.ATTACK_THRESHOLD}* :${TARGET_EMOJI}: cette semaine\n${userHasAttack
              ? '✅ *Tu as une Attaque Jeanpip disponible ! Lance \`/jeanpip-attack\` !*'
              : `⏳ Il te manque *${Math.max(0, scores.ATTACK_THRESHOLD - currentScore)}* Jeanpip(s) pour débloquer l'Attaque`
            }\n\n_Les scores se remettent à 0 chaque dimanche à 20h_`,
          },
        },
        { type: 'divider' },

        // Feature 3 : Attaque Jeanpip
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `⚔️ *Attaque Jeanpip — \`/jeanpip-attack\`*\nEnvoie un Jeanpip aux *7 dernières personnes* ayant posté dans le channel où tu lances la commande !\n\n*Comment débloquer :*\n• Envoie *${scores.ATTACK_THRESHOLD} Jeanpips* dans la semaine\n• Tu reçois un DM de notification quand c'est débloqué\n• Lance \`/jeanpip-attack\` dans le channel de ton choix\n• Ton compteur repart à 0, tu peux redébloquer ensuite !\n\n⚠️ _Si tu ne l'actives pas avant dimanche 20h → tu perds l'attaque_${isAdmin ? '\n\n👑 *Tu es admin : tu as accès illimité à cette commande !*' : ''}`,
          },
        },
        { type: 'divider' },

        // Feature 4 : Anti-spam
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🚨 *Anti-spam*\nSi tu réagis plusieurs fois avec :${TARGET_EMOJI}: sur le *même message* en moins de *8 secondes* :\n• La victime ne reçoit rien ✅\n• Toi tu reçois *10 images troll* en rafale toutes les 5 secondes 💀\n\n_Spammer c'est mal._`,
          },
        },
        { type: 'divider' },

        // Toutes les commandes
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `📋 *Toutes les commandes*\n\`/jeanpip-help\` → Affiche ce message avec ton score actuel\n\`/jeanpip-attack\` → Lance une Attaque Jeanpip sur le channel`,
          },
        },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: '🤖 _Jeanpip Bot — Fait avec ❤️_' }],
        },
      ],
    }, logger);

    logger.info(`📖 /jeanpip-help envoyé à <@${userId}>`);
  } catch (error) {
    logger.error('❌ Erreur dans /jeanpip-help:', error);
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

  scores.checkAndReset();
  setInterval(() => scores.checkAndReset(), 60 * 60 * 1000);

  console.log('');
  console.log('══════════════════════════════════════════');
  console.log('  ⚡️  Slack Emoji Reactor Bot lancé !');
  console.log(`  🎯  Emoji surveillé : :${TARGET_EMOJI}:`);
  console.log(`  🤖  Bot ID : ${botUserId}`);
  console.log(`  🚨  Anti-spam : ${SPAM_THRESHOLD_SECONDS}s seuil → ${SPAM_TROLL_SEQUENCE.length}x troll`);
  console.log(`  ⚔️   Attaque Jeanpip : seuil ${scores.ATTACK_THRESHOLD} jeanpips/semaine`);
  if (JEANPIP_ADMINS.length > 0) {
    console.log(`  👑  Admins (${JEANPIP_ADMINS.length}) : ${JEANPIP_ADMINS.join(', ')}`);
  }
  if (TARGET_USER_IDS.length > 0) {
    console.log(`  🎪  Cibles auto-react (${TARGET_USER_IDS.length}) :`);
    TARGET_USER_IDS.forEach((id) => console.log(`       → <@${id}>`));
  }
  console.log('══════════════════════════════════════════');
  console.log('');
})();
