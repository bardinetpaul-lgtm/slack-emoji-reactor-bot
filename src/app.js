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
const targets = require('./targets');

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

/**
 * Récupère les N derniers auteurs uniques d'un channel.
 * Pagine dans l'historique jusqu'à trouver assez de personnes,
 * peu importe si ça s'étale sur des semaines/mois.
 * Retourne un tableau de { user, ts } où ts = timestamp du DERNIER
 * message de cette personne (pour pouvoir y réagir).
 */
async function getLastUniqueAuthors(client, channelId, count, excludeIds, logger) {
  const victims = [];
  const seen = new Set(excludeIds);
  let cursor;
  let pagesFetched = 0;
  const MAX_PAGES = 20; // sécurité : jusqu'à 20 × 200 = 4000 messages max

  while (victims.length < count && pagesFetched < MAX_PAGES) {
    const result = await client.conversations.history({
      channel: channelId,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });

    pagesFetched++;

    for (const msg of result.messages) {
      if (!msg.user) continue;      // messages système / bots sans user
      if (msg.bot_id) continue;     // messages postés par un bot
      if (seen.has(msg.user)) continue;
      seen.add(msg.user);
      victims.push({ user: msg.user, ts: msg.ts });
      if (victims.length >= count) break;
    }

    if (!result.has_more || !result.response_metadata || !result.response_metadata.next_cursor) {
      break;
    }
    cursor = result.response_metadata.next_cursor;
  }

  logger.info(`🔎 ${victims.length} victime(s) trouvée(s) en ${pagesFetched} page(s) d'historique`);
  return victims;
}

/**
 * Extrait le premier ID utilisateur d'un texte de slash command.
 * Slack envoie les mentions sous la forme <@U12345|username> ou <@U12345>.
 * Accepte aussi un ID brut (U12345).
 */
function parseUserId(text) {
  if (!text) return null;
  const mention = text.match(/<@([A-Z0-9]+)(\|[^>]+)?>/i);
  if (mention) return mention[1];
  const raw = text.trim().match(/^([A-Z0-9]{6,})$/i);
  if (raw) return raw[1];
  return null;
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
    if (event.user === botUserId) return;
    if (event.subtype === 'message_changed' || event.subtype === 'message_deleted') return;
    if (!event.user && !event.bot_id) return;
    const authorId = event.user;
    if (!authorId) return;
    // Cibles = env + dynamiques (via /jeanpip-auto)
    if (!targets.isTarget(authorId)) return;

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

    // 📈 Compteur durable pour le classement JeanPip du dashboard (all-time + semaine)
    scores.recordHit(reactingUserId);

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

    // 🔎 Récupérer les 7 dernières personnes uniques (avec leur dernier message)
    let victims;
    try {
      victims = await getLastUniqueAuthors(client, channelId, 7, [userId, botUserId], logger);
    } catch (histError) {
      logger.error(`❌ Impossible de lire l'historique du channel:`, histError.message);
      await safeSendDM(client, userId, {
        text: `❌ Je n'arrive pas à lire ce channel. Suis-je bien invité dedans ?`,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `❌ *Je n'arrive pas à lire ce channel.*\nAssure-toi que le bot est invité dans le channel (\`/invite @${botName}\`).` } }],
      }, logger);
      return;
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
    for (const victim of victims) {
      const victimId = victim.user;
      try {
        // 1️⃣ Réagir avec :jeanpip: sur le dernier message de la victime (visible dans le channel)
        try {
          await client.reactions.add({
            channel: channelId,
            name: TARGET_EMOJI,
            timestamp: victim.ts,
          });
          logger.info(`⚔️  Réaction :${TARGET_EMOJI}: ajoutée sur le msg de <@${victimId}>`);
        } catch (reactError) {
          // already_reacted ou message introuvable → on continue quand même
          logger.info(`ℹ️  Pas pu réagir sur le msg de <@${victimId}>: ${reactError.data ? reactError.data.error : reactError.message}`);
        }

        // 2️⃣ Envoyer le DM avec média aléatoire pondéré (affiche la rareté)
        const media = await getRandomMedia();
        const ok = await safeSendDM(client, victimId, {
          text: `🚨 ALERTE ! ${attackerName} a lancé une Attaque Jeanpip !`,
          blocks: buildMediaBlocks({
            headerText: `🚨 *ALERTE ATTAQUE JEANPIP !*\n*<@${userId}>* t'a ciblé dans <#${channelId}> ! :${TARGET_EMOJI}:`,
            media: media,
          }),
        }, logger);
        if (ok) sent++;
      } catch (error) {
        logger.error(`❌ Erreur envoi attaque à <@${victimId}>:`, error.message);
      }
    }

    await safeSendDM(client, userId, {
      text: `⚔️ Attaque Jeanpip lancée sur ${sent} personnes !`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `⚔️ *Attaque Jeanpip lancée !*\n\nTu as ciblé *${sent} personne(s)* dans <#${channelId}> :${TARGET_EMOJI}:\n${victims.map(v => `• <@${v.user}>`).join('\n')}` } }],
    }, logger);

    logger.info(`✅ Attaque Jeanpip terminée : ${sent}/${victims.length} victimes`);
  } catch (error) {
    logger.error('❌ Erreur dans /jeanpip-attack:', error);
  }
});

// ─────────────────────────────────────────────
// 🎁 Slash command : /jeanpip-give @user  (admin uniquement)
//    Crédite une Attaque Jeanpip à quelqu'un et le notifie
// ─────────────────────────────────────────────
app.command('/jeanpip-give', async ({ command, ack, client, logger }) => {
  await ack();

  const adminId = command.user_id;

  try {
    if (!JEANPIP_ADMINS.includes(adminId)) {
      await safeSendDM(client, adminId, {
        text: `⛔ Commande réservée aux admins.`,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `⛔ *Cette commande est réservée aux admins.*` } }],
      }, logger);
      logger.info(`⛔ <@${adminId}> a tenté /jeanpip-give sans être admin`);
      return;
    }

    const targetId = parseUserId(command.text);
    if (!targetId) {
      await safeSendDM(client, adminId, {
        text: `❓ Usage : /jeanpip-give @utilisateur`,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `❓ *Usage :* \`/jeanpip-give @utilisateur\`\nMentionne la personne à qui tu veux offrir une Attaque Jeanpip.` } }],
      }, logger);
      return;
    }

    if (await isBot(client, targetId)) {
      await safeSendDM(client, adminId, {
        text: `🤖 Impossible de créditer un bot.`,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `🤖 *Impossible de créditer un bot.*` } }],
      }, logger);
      return;
    }

    const given = scores.giveAttack(targetId);

    if (!given) {
      await safeSendDM(client, adminId, {
        text: `ℹ️ <@${targetId}> a déjà une Attaque Jeanpip disponible.`,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `ℹ️ *<@${targetId}> a déjà une Attaque Jeanpip disponible.*\nRien à faire.` } }],
      }, logger);
      logger.info(`ℹ️ <@${targetId}> avait déjà une attaque, give ignoré`);
      return;
    }

    await safeSendDM(client, targetId, {
      text: `🎁 On t'a offert une Attaque Jeanpip !`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🎁 *On t'a offert une Attaque Jeanpip !* :${TARGET_EMOJI}:\n\nUn admin vient de te créditer une Attaque Jeanpip 🎉\n\n*Comment l'activer :*\nTape la commande \`/jeanpip-attack\` dans n'importe quel channel pour envoyer un Jeanpip aux 7 dernières personnes ayant posté dans le canal dans lequel tu l'actives !\n\n⚠️ _Si tu ne l'actives pas avant dimanche 20h, tu la perds._`,
          },
        },
      ],
    }, logger);

    await safeSendDM(client, adminId, {
      text: `✅ Attaque Jeanpip offerte à <@${targetId}> !`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `✅ *Attaque Jeanpip offerte à <@${targetId}> !*\nLa personne a été notifiée.` } }],
    }, logger);

    logger.info(`🎁 <@${adminId}> a offert une attaque à <@${targetId}>`);
  } catch (error) {
    logger.error('❌ Erreur dans /jeanpip-give:', error);
  }
});

// ─────────────────────────────────────────────
// 🎪 Slash command : /jeanpip-auto  (admin uniquement)
//    Gère les cibles auto-react en live
//    Usage :
//      /jeanpip-auto add @user     → ajoute une cible
//      /jeanpip-auto remove @user  → retire une cible
//      /jeanpip-auto list          → liste les cibles
// ─────────────────────────────────────────────
app.command('/jeanpip-auto', async ({ command, ack, client, logger }) => {
  await ack();

  const adminId = command.user_id;

  try {
    // 🔒 Réservé aux admins
    if (!JEANPIP_ADMINS.includes(adminId)) {
      await safeSendDM(client, adminId, {
        text: `⛔ Commande réservée aux admins.`,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `⛔ *Cette commande est réservée aux admins.*` } }],
      }, logger);
      return;
    }

    const text = (command.text || '').trim();
    const parts = text.split(/\s+/);
    const action = (parts[0] || '').toLowerCase();

    // 📋 LIST
    if (action === 'list' || action === '') {
      const list = targets.getTargets();
      const envSet = new Set(targets.ENV_TARGETS);
      const lines = list.length
        ? list.map((id) => `• <@${id}>${envSet.has(id) ? ' _(fixe .env)_' : ''}`).join('\n')
        : '_Aucune cible auto-react configurée._';
      await safeSendDM(client, adminId, {
        text: `🎪 Cibles auto-react (${list.length})`,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `🎪 *Cibles auto-react (${list.length})*\n${lines}\n\n_Usage :_ \`/jeanpip-auto add @user\` · \`/jeanpip-auto remove @user\` · \`/jeanpip-auto list\`` } }],
      }, logger);
      return;
    }

    // Actions add / remove → besoin d'une mention
    const targetId = parseUserId(parts.slice(1).join(' '));
    if ((action === 'add' || action === 'remove') && !targetId) {
      await safeSendDM(client, adminId, {
        text: `❓ Usage : /jeanpip-auto ${action} @utilisateur`,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `❓ *Usage :* \`/jeanpip-auto ${action} @utilisateur\`` } }],
      }, logger);
      return;
    }

    // ➕ ADD
    if (action === 'add') {
      const res = targets.addTarget(targetId);
      const msg = {
        added: `✅ <@${targetId}> est maintenant une cible auto-react ! :${TARGET_EMOJI}:`,
        already: `ℹ️ <@${targetId}> est déjà une cible auto-react.`,
        env: `ℹ️ <@${targetId}> est déjà défini comme cible fixe dans le .env.`,
      }[res];
      await safeSendDM(client, adminId, {
        text: msg,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: msg } }],
      }, logger);
      logger.info(`🎪 add <@${targetId}> par <@${adminId}> → ${res}`);
      return;
    }

    // ➖ REMOVE
    if (action === 'remove') {
      const res = targets.removeTarget(targetId);
      const msg = {
        removed: `✅ <@${targetId}> n'est plus une cible auto-react.`,
        not_found: `ℹ️ <@${targetId}> n'était pas une cible auto-react.`,
        env: `⚠️ <@${targetId}> est une cible fixe du .env, impossible de la retirer en live. Modifie le .env et redémarre le bot.`,
      }[res];
      await safeSendDM(client, adminId, {
        text: msg,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: msg } }],
      }, logger);
      logger.info(`🎪 remove <@${targetId}> par <@${adminId}> → ${res}`);
      return;
    }

    // ❓ Action inconnue
    await safeSendDM(client, adminId, {
      text: `❓ Usage de /jeanpip-auto`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `❓ *Usage de \`/jeanpip-auto\` :*\n\`/jeanpip-auto add @user\` → ajoute une cible\n\`/jeanpip-auto remove @user\` → retire une cible\n\`/jeanpip-auto list\` → liste les cibles` } }],
    }, logger);
  } catch (error) {
    logger.error('❌ Erreur dans /jeanpip-auto:', error);
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
        {
          type: 'header',
          text: { type: 'plain_text', text: `🤖 Jeanpip Bot — Guide complet` },
        },
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:${TARGET_EMOJI}: *Réaction Jeanpip*\nQuand quelqu'un réagit avec :${TARGET_EMOJI}: sur un message :\n• La personne qui a réagi reçoit un DM avec une image/vidéo aléatoire\n• L'auteur du message reçoit aussi un DM avec une image/vidéo aléatoire`,
          },
        },
        { type: 'divider' },
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
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `⚔️ *Attaque Jeanpip — \`/jeanpip-attack\`*\nEnvoie un Jeanpip aux *7 dernières personnes* ayant posté dans le channel où tu lances la commande !\n\n*Comment débloquer :*\n• Envoie *${scores.ATTACK_THRESHOLD} Jeanpips* dans la semaine\n• Tu reçois un DM de notification quand c'est débloqué\n• Lance \`/jeanpip-attack\` dans le channel de ton choix\n• Ton compteur repart à 0, tu peux redébloquer ensuite !\n\n⚠️ _Si tu ne l'actives pas avant dimanche 20h → tu perds l'attaque_${isAdmin ? '\n\n👑 *Tu es admin : accès illimité + `/jeanpip-give @user` + `/jeanpip-auto` !*' : ''}`,
          },
        },
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🚨 *Anti-spam*\nSi tu réagis plusieurs fois avec :${TARGET_EMOJI}: sur le *même message* en moins de *8 secondes* :\n• La victime ne reçoit rien ✅\n• Toi tu reçois *10 images troll* en rafale toutes les 5 secondes 💀\n\n_Spammer c'est mal._`,
          },
        },
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `📋 *Toutes les commandes*\n\`/jeanpip-help\` → Affiche ce message avec ton score actuel\n\`/jeanpip-attack\` → Lance une Attaque Jeanpip sur le channel${isAdmin ? '\n`/jeanpip-give @user` → (admin) Offre une Attaque Jeanpip à quelqu\'un\n`/jeanpip-auto add|remove|list` → (admin) Gère les cibles auto-react' : ''}`,
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

  const currentTargets = targets.getTargets();

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
  if (currentTargets.length > 0) {
    console.log(`  🎪  Cibles auto-react (${currentTargets.length}) :`);
    currentTargets.forEach((id) => console.log(`       → <@${id}>`));
  }
  console.log('══════════════════════════════════════════');
  console.log('');
})();
