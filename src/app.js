// ═══════════════════════════════════════════════════════════
//  🤖 SLACK EMOJI REACTOR BOT
//  Envoie des images/vidéos aléatoires en DM quand
//  quelqu'un réagit avec un emoji spécifique
// ═══════════════════════════════════════════════════════════

const { App, LogLevel } = require('@slack/bolt');
require('dotenv').config();

const { getRandomMedia, normalizeRarity } = require('./media');
const { buildMediaBlocks } = require('./blocks');
const scores = require('./scores');
const targets = require('./targets');
const credits = require('./credits');
const boosters = require('./boosters');
const collections = require('./collections');
const broadcast = require('./broadcast');
const { openOnce } = require('./openBooster');
const web = require('./web');
const home = require('./home');
const { createAdminActions } = require('./admin');
const settings = require('./settings');

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

// ⚔️ Prix d'une Attaque Jeanpip achetée en crédits (si pas d'attaque gratuite)
const ATTACK_PRICE = 25;

// 💰 Crédits gagnés par Jeanpip envoyé (demi-crédits autorisés) : réglable en
//    live par un admin depuis l'onglet Accueil (src/settings.js, défaut 0,5).
const creditsPerJeanpipLabel = () => String(settings.getCreditsPerJeanpip()).replace('.', ',');

// ─────────────────────────────────────────────
// 🚨 Anti-spam config
// ─────────────────────────────────────────────
const SPAM_THRESHOLD_SECONDS = 8;
const SPAM_PUNISHMENT_INTERVAL_MS = 5000;
// 🔢 Numérotation des photos anti-spam, dans le même style que la banque
//    (« Surprise #N »). Numéros FIXES #62→#71 : ne jamais les modifier.
const SPAM_PHOTO_START = 62;

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
      // 🔢 Photo numérotée « Surprise #N » à partir de 61, comme la banque de médias
      const photoNumber = SPAM_PHOTO_START + i;
      const photoTitle = `🚨 Surprise #${photoNumber}`;
      await sendDM(client, userId, {
        text: `${photoTitle} — Spammer c'est mal. (${i + 1}/${total})`,
        blocks: buildMediaBlocks({
          headerText: `🚨 *Spammer c'est mal.* — ${photoTitle} (${i + 1}/${total})`,
          media: { ...SPAM_TROLL_SEQUENCE[i], title: photoTitle },
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

// ─────────────────────────────────────────────
// 🚜 Anti-farm config
//    Plus de FARM_MAX_PER_HOUR Jeanpips en 1 h → pénalité de 1 h.
//    Pendant la pénalité :
//      ❌ ses Jeanpips n'envoient plus rien aux autres
//      ❌ il n'accumule plus de crédits (ni score)
//      ✅ il continue de RECEVOIR des Jeanpips
//      ✅ il peut toujours ouvrir ses boosters
// ─────────────────────────────────────────────
const FARM_WINDOW_MS = 60 * 60 * 1000;   // fenêtre glissante : 1 heure
const FARM_MAX_PER_HOUR = 10;            // au-delà de 10 → pénalité
const FARM_PENALTY_MS = 60 * 60 * 1000;  // durée de la pénalité : 1 heure

const farmHistory = new Map();      // userId → [timestamps des jeanpips]
const farmPenalties = new Map();    // userId → timestamp de fin de pénalité
const farmReleaseTimers = new Map(); // userId → timer de fin de pénalité

/**
 * Temps de pénalité restant pour un user (0 s'il n'est pas pénalisé).
 * Nettoie automatiquement les pénalités expirées.
 */
function getFarmPenaltyRemaining(userId) {
  const until = farmPenalties.get(userId);
  if (!until) return 0;
  const remaining = until - Date.now();
  if (remaining <= 0) {
    farmPenalties.delete(userId);
    farmHistory.delete(userId); // on repart à zéro après la pénalité
    return 0;
  }
  return remaining;
}

/**
 * Enregistre un Jeanpip dans la fenêtre glissante.
 * Retourne true si l'utilisateur vient de dépasser le seuil (→ pénalité).
 */
function recordJeanpipForFarm(userId) {
  const now = Date.now();
  const recent = (farmHistory.get(userId) || []).filter((t) => now - t < FARM_WINDOW_MS);
  recent.push(now);
  farmHistory.set(userId, recent);

  if (recent.length > FARM_MAX_PER_HOUR) {
    farmPenalties.set(userId, now + FARM_PENALTY_MS);
    farmHistory.delete(userId);
    return true;
  }
  return false;
}

/** Formate un temps restant en texte lisible (« 42 min »). */
function formatRemaining(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  return minutes >= 60 ? '1 h' : `${minutes} min`;
}

/**
 * Programme la fin de pénalité : nettoie l'état et prévient la personne
 * que son accès au Jeanpip est rétabli.
 */
function scheduleFarmRelease(client, userId, logger) {
  const timer = setTimeout(async () => {
    farmPenalties.delete(userId);
    farmHistory.delete(userId);
    farmReleaseTimers.delete(userId);
    try {
      await safeSendDM(client, userId, {
        text: `✅ Ton accès au Jeanpip est rétabli !`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *Ton accès au Jeanpip est rétabli !* :${TARGET_EMOJI}:\n\nTa pénalité anti-farm est terminée. Tu peux de nouveau :\n• 📤 Envoyer des Jeanpips aux autres\n• 💰 Gagner des crédits\n\n_Reste sous ${FARM_MAX_PER_HOUR} Jeanpips par heure pour éviter un nouveau bridage._ 😉`,
            },
          },
        ],
      }, logger);
      logger.info(`✅ Fin de pénalité anti-farm notifiée à <@${userId}>`);
    } catch (error) {
      logger.error(`❌ Erreur notif fin de pénalité anti-farm :`, error.message);
    }
  }, FARM_PENALTY_MS);

  // Ne pas retenir le process Node à cause de ce timer
  if (typeof timer.unref === 'function') timer.unref();
  farmReleaseTimers.set(userId, timer);
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
 * Envoie un Jeanpip (média) en DM ET l'ajoute à la collection du
 * destinataire, avec la phrase Nouvelle / Doublon / Triplon… dans l'en-tête.
 *   • collect = false → envoi simple, sans collection (ex. anti-farm)
 * La carte n'est ajoutée que si le DM est vraiment parti.
 */
async function sendJeanpipDM(client, userId, { text, headerText, media, collect = true }, logger) {
  const nextCount = collect && media && media.url ? collections.getCount(userId, media.url) + 1 : 0;
  const ok = await safeSendDM(client, userId, {
    text,
    blocks: buildMediaBlocks({
      headerText: nextCount ? `${headerText}\n${collections.copyPhrase(nextCount)}` : headerText,
      media,
    }),
  }, logger);
  if (ok && nextCount) collections.addCards(userId, [media]);
  return ok;
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
      // 📮 Liste de diffusion : on ne cible que les personnes inscrites
      if (!broadcast.isSubscribed(msg.user)) continue;
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

// 👑 Actions admin partagées (commandes slash + onglet Accueil)
const adminActions = createAdminActions({ safeSendDM, isBot, targetEmoji: TARGET_EMOJI });

// ─────────────────────────────────────────────
// 🏠 Onglet Accueil
// ─────────────────────────────────────────────

// Users ayant ouvert l'Accueil depuis le démarrage : on ne republie
// « passivement » (ex. crédits gagnés via une réaction) que pour eux.
const homeViewers = new Set();

function buildHomeFor(userId) {
  const isAdmin = JEANPIP_ADMINS.includes(userId);
  return home.buildHomeView(userId, {
    isAdmin,
    attackPrice: ATTACK_PRICE,
    creditsPerJeanpipLabel: creditsPerJeanpipLabel(),
    targetEmoji: TARGET_EMOJI,
    farmRemainingMs: getFarmPenaltyRemaining(userId),
    formatRemaining,
    autoTargets: isAdmin ? adminActions.listAutoTargets() : undefined,
  });
}

/** Republie l'onglet Accueil d'un user (views.publish). N'échoue jamais. */
async function refreshHome(client, userId, logger) {
  try {
    await client.views.publish({ user_id: userId, view: buildHomeFor(userId) });
    homeViewers.add(userId);
  } catch (error) {
    const reason = error.data ? error.data.error : error.message;
    (logger || console).error(`❌ Impossible de publier l'Accueil de <@${userId}> : ${reason}`);
  }
}

/** Republie l'Accueil seulement si le user l'a déjà ouvert depuis le démarrage. */
function refreshHomeIfSeen(client, userId, logger) {
  if (userId && homeViewers.has(userId)) return refreshHome(client, userId, logger);
  return Promise.resolve();
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

    // 📮 Liste de diffusion : on ne cible que les personnes inscrites
    if (!broadcast.isSubscribed(authorId)) {
      logger.info(`📮 Cible <@${authorId}> pas dans la liste de diffusion → auto-react ignoré`);
      return;
    }

    logger.info(`🎯 Message de la cible <@${authorId}> détecté dans <#${event.channel}>`);

    await client.reactions.add({
      channel: event.channel,
      name: TARGET_EMOJI,
      timestamp: event.ts,
    });
    logger.info(`✅ Réaction :${TARGET_EMOJI}: ajoutée`);

    const media = await getRandomMedia();
    const sent = await sendJeanpipDM(client, authorId, {
      text: `Bonjour jeune, ${botName} t'a envoyé un Jeanpip !`,
      headerText: `Bonjour jeune <@${authorId}>, ${botName} t'a envoyé un Jeanpip ! :${TARGET_EMOJI}:`,
      media,
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

    // 🔒 Anti-exploit : on ne compte le Jeanpip QUE si le bot est présent dans la
    //    conversation. conversations.history échoue (not_in_channel / channel_not_found)
    //    quand le bot n'est pas membre du channel → dans ce cas on ignore complètement
    //    l'événement, AVANT tout crédit/score.
    //    (Sinon, réagir dans une conversation privée sans le bot permettait de farmer
    //     des crédits sans qu'aucune image ne soit envoyée.)
    let originalAuthorId;
    try {
      const result = await client.conversations.history({
        channel: channelId,
        latest: messageTs,
        inclusive: true,
        limit: 1,
      });
      if (!result.messages || result.messages.length === 0) {
        logger.warn('⚠️  Message original introuvable → aucun crédit');
        return;
      }
      originalAuthorId = result.messages[0].user || null;
    } catch (historyError) {
      const reason = historyError.data ? historyError.data.error : historyError.message;
      logger.warn(`🚫 Bot absent de la conversation (${reason}) → aucun crédit pour <@${reactingUserId}>`);
      return;
    }

    // 🔒 Anti-farm : réagir à SON PROPRE message ne compte pas.
    //    (Sinon on pourrait farmer des crédits en s'auto-réagissant dans un
    //     channel où le bot est présent.) Aucun crédit, aucun score, aucune image.
    if (originalAuthorId && originalAuthorId === reactingUserId) {
      logger.info(`🚫 <@${reactingUserId}> a réagi à son propre message → ignoré (anti-farm)`);
      return;
    }

    // 📮 Liste de diffusion (OPT-IN) : l'auteur ne reçoit un Jeanpip que s'il
    //    s'est inscrit via /jeanpip. Sinon le Jeanpip n'atteint personne → il ne
    //    compte pas (ni crédit, ni score, ni compteur anti-farm).
    //    Le réacteur reçoit quand même SON image.
    const delivers = broadcast.isSubscribed(originalAuthorId);
    if (!delivers) {
      logger.info(`📮 <@${originalAuthorId}> n'est pas dans la liste de diffusion → rien ne lui est envoyé, aucun crédit pour <@${reactingUserId}>`);
    }

    // ✅ Bot présent + message d'autrui + destinataire inscrit → le Jeanpip compte.

    // 🚜 Anti-farm : plus de 10 Jeanpips en 1 h → pénalité de 1 h.
    //    On ne compte que les Jeanpips réellement délivrés.
    let farmBlocked = delivers && getFarmPenaltyRemaining(reactingUserId) > 0;

    if (delivers && !farmBlocked && recordJeanpipForFarm(reactingUserId)) {
      farmBlocked = true;
      logger.warn(`🚜 ANTI-FARM : <@${reactingUserId}> dépasse ${FARM_MAX_PER_HOUR} Jeanpips/h → pénalité 1 h`);
      await safeSendDM(client, reactingUserId, {
        text: `🚜 Alerte anti-farm : tu es bridé pendant 1 heure.`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `🚜 *ALERTE ANTI-FARM !* :${TARGET_EMOJI}:\n\nTu as posé *plus de ${FARM_MAX_PER_HOUR} Jeanpips en moins d'une heure*.\n\n*Pendant 1 heure :*\n• ❌ Tes Jeanpips n'envoient plus rien aux autres\n• ❌ Tu n'accumules plus de crédits\n• ✅ Tu continues à *recevoir* des Jeanpips\n• ✅ Tu peux toujours *ouvrir tes boosters*\n\n_Lève le pied, ça revient tout seul dans 1 h._ 😉`,
            },
          },
        ],
      }, logger);

      // ⏰ Prévenir la personne dès que son accès est rétabli (dans 1 h)
      scheduleFarmRelease(client, reactingUserId, logger);
    }

    if (farmBlocked) {
      const remaining = getFarmPenaltyRemaining(reactingUserId);
      logger.info(`🚜 <@${reactingUserId}> sous pénalité anti-farm (${formatRemaining(remaining)} restantes) → ni crédit ni envoi aux autres`);
    }

    // 📊 Score / crédits : uniquement si le Jeanpip est réellement délivré
    //    (destinataire inscrit) et hors pénalité anti-farm.
    let justUnlocked = false;
    if (delivers && !farmBlocked) {
      const result = scores.incrementScore(reactingUserId);
      justUnlocked = result.justUnlocked;
      logger.info(`📊 Score de <@${reactingUserId}> : ${result.score}`);

      // 📈 Compteur durable pour le classement JeanPip du dashboard (all-time + semaine)
      scores.recordHit(reactingUserId);

      // 💰 +N crédit(s) permanent(s) (porte-monnaie booster, N réglable : src/settings.js). Spam déjà exclu ci-dessus,
      //    et présence du bot dans la conversation vérifiée juste au-dessus.
      //    Seule TA réaction crédite : l'attaque et l'auto-react ne créditent pas.
      const newBalance = credits.addCredit(reactingUserId, settings.getCreditsPerJeanpip());
      logger.info(`💰 Crédits de <@${reactingUserId}> : ${newBalance}`);
      refreshHomeIfSeen(client, reactingUserId, logger);
    }

    // 🎉 Notification déblocage attaque
    if (justUnlocked) {
      await safeSendDM(client, reactingUserId, {
        text: `🎉 Tu as débloqué l'Attaque Jeanpip !`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `🎉 *Tu as débloqué l'Attaque Jeanpip !* :${TARGET_EMOJI}:\n\nTu as envoyé *${scores.ATTACK_THRESHOLD} Jeanpips* cette semaine, bravo !\n\n*Comment l'activer :*\nTape la commande \`/jeanpip-attack\` dans n'importe quel channel (ou clique sur ⚔️ dans l'onglet *Accueil* du bot) pour envoyer un Jeanpip aux 7 dernières personnes ayant posté dans le canal choisi !\n\n⚠️ _Si tu n'actives pas ton attaque avant dimanche 20h, tu perds tes Jeanpips._`,
            },
          },
        ],
      }, logger);
      logger.info(`🎉 Notification déblocage envoyée à <@${reactingUserId}>`);
    }

    const reactorInfo = await client.users.info({ user: reactingUserId });
    const reactorName = reactorInfo.user.real_name || reactorInfo.user.name;

    const mediaForReactor = await getRandomMedia();

    // 🗂️ Ta propre image n'entre dans ta collection que si ton Jeanpip « compte »
    //    (même règle que les crédits) → pas de farm de collection.
    const sentToReactor = await sendJeanpipDM(client, reactingUserId, {
      text: `Hey @${reactorName} tu as réagi avec jean pip coucou !`,
      headerText: `Hey <@${reactingUserId}> tu as réagi avec jean pip coucou :${TARGET_EMOJI}:`,
      media: mediaForReactor,
      collect: delivers && !farmBlocked,
    }, logger);
    if (sentToReactor) logger.info(`📨 DM envoyé au réacteur <@${reactingUserId}>`);

    // 📮 Envoi à l'auteur : seulement s'il est inscrit à la liste de diffusion,
    //    et si le réacteur n'est pas sous pénalité anti-farm.
    //    (Le réacteur a quand même reçu SON image juste au-dessus.)
    if (!delivers) {
      logger.info(`📮 Aucun envoi à <@${originalAuthorId}> : pas dans la liste de diffusion`);
    } else if (farmBlocked) {
      logger.info(`🚜 Envoi à l'auteur bloqué (anti-farm) pour <@${reactingUserId}>`);
    } else if (originalAuthorId && originalAuthorId !== reactingUserId) {
      const mediaForAuthor = await getRandomMedia();
      const sentToAuthor = await sendJeanpipDM(client, originalAuthorId, {
        text: `Bonjour jeune, ${reactorName} t'a envoyé un Jeanpip !`,
        headerText: `Bonjour jeune <@${originalAuthorId}>, <@${reactingUserId}> t'a envoyé un Jeanpip ! :${TARGET_EMOJI}:`,
        media: mediaForAuthor,
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

    // 🚜 Sous pénalité anti-farm : impossible d'envoyer aux autres
    const farmRemaining = getFarmPenaltyRemaining(userId);
    if (farmRemaining > 0) {
      await safeSendDM(client, userId, {
        text: `🚜 Anti-farm : tu ne peux pas lancer d'attaque pour le moment.`,
        blocks: [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🚜 *Tu es sous pénalité anti-farm.*\n\nTu ne peux rien envoyer aux autres pendant encore *${formatRemaining(farmRemaining)}*.\n\n_Ton attaque n'a pas été consommée, tu pourras la lancer après._`,
          },
        }],
      }, logger);
      logger.info(`🚜 /jeanpip-attack bloquée (anti-farm) pour <@${userId}>`);
      return;
    }

    if (!isAdmin && !userHasAttack) {
      // 💰 Pas d'attaque gratuite → on propose de l'acheter en crédits
      const currentScore = scores.getScore(userId);
      const balance = credits.getBalance(userId);
      const canAfford = balance >= ATTACK_PRICE;
      await safeSendDM(client, userId, {
        text: `⚔️ Tu n'as pas d'Attaque Jeanpip gratuite — achète-la pour ${ATTACK_PRICE} crédits !`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `⚔️ *Tu n'as pas d'Attaque Jeanpip gratuite.*\n\nTon score cette semaine : *${currentScore}/${scores.ATTACK_THRESHOLD}* :${TARGET_EMOJI}: (envoie-en ${scores.ATTACK_THRESHOLD} pour la débloquer gratuitement)\n\n💰 *Ou achète-la maintenant : ${ATTACK_PRICE} crédits* — ton solde : *${balance}*${canAfford ? '' : `\n\n❌ _Il te manque ${ATTACK_PRICE - balance} crédit(s)._`}`,
            },
          },
          ...(canAfford ? [{
            type: 'actions',
            elements: [{
              type: 'button',
              style: 'danger',
              text: { type: 'plain_text', text: `⚔️ Lancer l'attaque dans #${command.channel_name} (${ATTACK_PRICE} crédits)` },
              action_id: 'buy_attack',
              value: channelId,
            }],
          }] : []),
        ],
      }, logger);
      return;
    }

    await launchAttack(client, userId, channelId, logger, { consumeFree: !isAdmin });
  } catch (error) {
    logger.error('❌ Erreur dans /jeanpip-attack:', error);
  }
});

// ─────────────────────────────────────────────
// 💰 Action : clic sur « Lancer l'attaque (X crédits) »
//    action_id = buy_attack · value = <channelId>
// ─────────────────────────────────────────────
const attackPurchaseLocks = new Set(); // userId → achat en cours (anti-double-clic)

app.action('buy_attack', async ({ ack, body, action, client, logger }) => {
  await ack();

  const userId = body.user.id;
  const channelId = action.value;
  if (attackPurchaseLocks.has(userId)) return;
  attackPurchaseLocks.add(userId);

  try {
    const farmRemaining = getFarmPenaltyRemaining(userId);
    if (farmRemaining > 0) {
      await safeSendDM(client, userId, {
        text: `🚜 Anti-farm : tu ne peux pas lancer d'attaque pour le moment.`,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `🚜 *Tu es sous pénalité anti-farm.*\n\nRéessaie dans *${formatRemaining(farmRemaining)}*. _Aucun crédit n'a été débité._` } }],
      }, logger);
      return;
    }

    const launched = await launchAttack(client, userId, channelId, logger, { price: ATTACK_PRICE });

    // 🔕 Désactiver le bouton une fois l'attaque partie
    if (launched && body.channel && body.message) {
      try {
        await client.chat.update({
          channel: body.channel.id,
          ts: body.message.ts,
          text: `⚔️ Attaque Jeanpip achetée !`,
          blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `⚔️ *Attaque Jeanpip achetée et lancée dans <#${channelId}> !* (-${ATTACK_PRICE} crédits)` } }],
        });
      } catch (updateError) {
        logger.error(`❌ Impossible de désactiver le bouton :`, updateError.message);
      }
    }
  } catch (error) {
    logger.error('❌ Erreur dans buy_attack:', error);
  } finally {
    attackPurchaseLocks.delete(userId);
  }
});

/**
 * Lance une Attaque Jeanpip dans `channelId`.
 *   • consumeFree : consomme l'attaque gratuite débloquée par le score
 *   • price       : débite ce nombre de crédits (attaque achetée)
 * Rien n'est consommé/débité si personne n'est attaquable.
 * Retourne true si l'attaque est partie.
 */
async function launchAttack(client, userId, channelId, logger, { consumeFree = false, price = 0 } = {}) {
  logger.info(`⚔️  Attaque Jeanpip lancée par <@${userId}> dans <#${channelId}>${price ? ` (payée ${price} crédits)` : ''}`);

  // 🔎 Récupérer les 7 dernières personnes uniques (avec leur dernier message)
  let victims;
  try {
    victims = await getLastUniqueAuthors(client, channelId, 7, [userId, botUserId], logger);
  } catch (histError) {
    logger.error(`❌ Impossible de lire l'historique du channel:`, histError.message);
    await safeSendDM(client, userId, {
      text: `❌ Je n'arrive pas à lire ce channel. Suis-je bien invité dedans ?`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `❌ *Je n'arrive pas à lire ce channel.*\nAssure-toi que le bot est invité dans le channel (\`/invite @${botName}\`).${price ? '\n\n_Aucun crédit n\'a été débité._' : ''}` } }],
    }, logger);
    return false;
  }

  if (victims.length === 0) {
    await safeSendDM(client, userId, {
      text: `😅 Personne à attaquer dans ce channel !`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `😅 *Personne à attaquer dans ce channel !*\n\nPersonne n'y a posté récemment… ou personne n'est inscrit à la liste de diffusion Jeanpip 📮\n\n_${price ? 'Aucun crédit n\'a été débité.' : 'Ton attaque n\'a pas été consommée.'}_` } }],
    }, logger);
    return false;
  }

  if (price) {
    if (!credits.spend(userId, price)) {
      const balance = credits.getBalance(userId);
      await safeSendDM(client, userId, {
        text: `❌ Solde insuffisant pour l'Attaque Jeanpip`,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `❌ *Il te manque ${price - balance} crédit(s)* pour acheter l'Attaque Jeanpip.\n\n💰 Ton solde : *${balance}* · Prix : *${price}*` } }],
      }, logger);
      return false;
    }
  } else if (consumeFree) {
    scores.consumeAttack(userId);
  }

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
      const ok = await sendJeanpipDM(client, victimId, {
        text: `🚨 ALERTE ! ${attackerName} a lancé une Attaque Jeanpip !`,
        headerText: `🚨 *ALERTE ATTAQUE JEANPIP !*\n*<@${userId}>* t'a ciblé dans <#${channelId}> ! :${TARGET_EMOJI}:`,
        media,
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
  await refreshHome(client, userId, logger);
  return true;
}

// ─────────────────────────────────────────────
// 👑 Helpers communs aux commandes admin
// ─────────────────────────────────────────────

/** DM « réservé aux admins » ; retourne true si l'user N'EST PAS admin. */
async function rejectNonAdmin(client, userId, logger, commandName) {
  if (JEANPIP_ADMINS.includes(userId)) return false;
  await safeSendDM(client, userId, {
    text: `⛔ Commande réservée aux admins.`,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `⛔ *Cette commande est réservée aux admins.*` } }],
  }, logger);
  logger.info(`⛔ <@${userId}> a tenté ${commandName} sans être admin`);
  return true;
}

/** Envoie en DM à l'admin le résultat d'une action admin ({ text, blocks? }). */
async function sendAdminResult(client, adminId, result, logger) {
  await safeSendDM(client, adminId, {
    text: result.text.replace(/\*/g, ''),
    blocks: result.blocks || [{ type: 'section', text: { type: 'mrkdwn', text: result.text } }],
  }, logger);
}

// ─────────────────────────────────────────────
// 🎁 Slash command : /jeanpip-give @user  (admin uniquement)
//    Crédite une Attaque Jeanpip à quelqu'un et le notifie
//    (aussi disponible dans le panneau 👑 Admin de l'Accueil)
// ─────────────────────────────────────────────
app.command('/jeanpip-give', async ({ command, ack, client, logger }) => {
  await ack();

  const adminId = command.user_id;

  try {
    if (await rejectNonAdmin(client, adminId, logger, '/jeanpip-give')) return;

    const targetId = parseUserId(command.text);
    if (!targetId) {
      await safeSendDM(client, adminId, {
        text: `❓ Usage : /jeanpip-give @utilisateur`,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `❓ *Usage :* \`/jeanpip-give @utilisateur\`\nMentionne la personne à qui tu veux offrir une Attaque Jeanpip.` } }],
      }, logger);
      return;
    }

    const result = await adminActions.giveAttack(client, adminId, targetId, logger);
    await sendAdminResult(client, adminId, result, logger);
    if (result.ok) await refreshHomeIfSeen(client, targetId, logger);
  } catch (error) {
    logger.error('❌ Erreur dans /jeanpip-give:', error);
  }
});

// ─────────────────────────────────────────────
// 💳 Slash command : /jeanpip-give-credits @user <montant>  (admin)
//    Crédite manuellement le porte-monnaie de quelqu'un
// ─────────────────────────────────────────────
app.command('/jeanpip-give-credits', async ({ command, ack, client, logger }) => {
  await ack();

  const adminId = command.user_id;

  try {
    if (await rejectNonAdmin(client, adminId, logger, '/jeanpip-give-credits')) return;

    const targetId = parseUserId(command.text);

    // ⚠️ On retire d'abord la mention <@ID|nom> ET un éventuel ID brut du texte :
    //    sinon les CHIFFRES contenus dans l'ID Slack (ex. U096...) seraient pris
    //    pour le montant (bug : "give @jonathan 10" créditait 96).
    const rest = (command.text || '')
      .replace(/<@[A-Z0-9]+(?:\|[^>]+)?>/ig, ' ')
      .replace(/\b[UW][A-Z0-9]{6,}\b/ig, ' ');
    const amountMatch = rest.match(/-?\d+(?:[.,]\d+)?/);
    const amount = amountMatch ? parseFloat(amountMatch[0].replace(',', '.')) : NaN;

    if (!targetId || !Number.isFinite(amount) || amount === 0) {
      await safeSendDM(client, adminId, {
        text: `❓ Usage : /jeanpip-give-credits @utilisateur <montant>`,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `❓ *Usage :* \`/jeanpip-give-credits @utilisateur <montant>\`\nEx : \`/jeanpip-give-credits @paul 50\` pour ajouter, \`/jeanpip-give-credits @paul -20\` pour retirer.\nLe montant doit être non nul (demi-crédits acceptés, ex. \`2,5\`).` } }],
      }, logger);
      return;
    }

    const result = await adminActions.adjustCredits(client, adminId, targetId, amount, logger);
    await sendAdminResult(client, adminId, result, logger);
    if (result.ok) await refreshHomeIfSeen(client, targetId, logger);
  } catch (error) {
    logger.error('❌ Erreur dans /jeanpip-give-credits:', error);
  }
});

// ─────────────────────────────────────────────
// 🖼️ Slash command : /jeanpip-addmedia <url> <rareté> [titre]  (admin)
//    Ajoute un média à la banque (persistant, sans redémarrage)
// ─────────────────────────────────────────────
app.command('/jeanpip-addmedia', async ({ command, ack, client, logger }) => {
  await ack();

  const adminId = command.user_id;

  try {
    if (await rejectNonAdmin(client, adminId, logger, '/jeanpip-addmedia')) return;

    const parts = (command.text || '').trim().split(/\s+/).filter(Boolean);
    const url = parts[0];
    const rarity = normalizeRarity(parts[1]);
    const title = parts.slice(2).join(' ');

    const usageBlocks = [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `❓ *Usage :* \`/jeanpip-addmedia <lien> <rareté> [titre optionnel]\`\n\n*Raretés acceptées :* \`commun\` ⚪ · \`rare\` 🔵 · \`epique\` 🟣 · \`legendaire\` 🟡\n\nEx : \`/jeanpip-addmedia https://media.giphy.com/media/xxx/giphy.gif rare Super Jeanpip\``,
      },
    }];

    if (!url || !/^https?:\/\//i.test(url)) {
      await safeSendDM(client, adminId, { text: `❓ Lien manquant ou invalide`, blocks: usageBlocks }, logger);
      return;
    }
    if (!rarity) {
      await safeSendDM(client, adminId, { text: `❓ Rareté manquante ou invalide`, blocks: usageBlocks }, logger);
      return;
    }

    // Confirmation + aperçu du média ajouté (l'admin vérifie que le lien s'affiche bien)
    const result = adminActions.addMediaToBank(adminId, { url, rarity, title }, logger);
    await sendAdminResult(client, adminId, result, logger);
  } catch (error) {
    logger.error('❌ Erreur dans /jeanpip-addmedia:', error);
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
    if (await rejectNonAdmin(client, adminId, logger, '/jeanpip-auto')) return;

    const text = (command.text || '').trim();
    const parts = text.split(/\s+/);
    const action = (parts[0] || '').toLowerCase();

    // 📋 LIST
    if (action === 'list' || action === '') {
      const list = adminActions.listAutoTargets();
      const lines = list.length
        ? list.map((t) => `• <@${t.id}>${t.fixed ? ' _(fixe .env)_' : ''}`).join('\n')
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

    // ➕ ADD / ➖ REMOVE
    if (action === 'add' || action === 'remove') {
      const result = action === 'add'
        ? adminActions.addAutoTarget(adminId, targetId, logger)
        : adminActions.removeAutoTarget(adminId, targetId, logger);
      await sendAdminResult(client, adminId, result, logger);
      if (result.ok) await refreshHomeIfSeen(client, adminId, logger);
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
// 💰 Slash command : /jeanpip-credits
//    Affiche le solde de crédits en DM
// ─────────────────────────────────────────────
app.command('/jeanpip-credits', async ({ command, ack, client, logger }) => {
  await ack();

  const userId = command.user_id;

  try {
    const balance = credits.getBalance(userId);
    await safeSendDM(client, userId, {
      text: `💰 Tu as ${balance} crédits`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `💰 *Tu as ${balance} crédit(s) JeanPip !*\n\nTu gagnes *+${creditsPerJeanpipLabel()} crédit(s)* à chaque fois que tu poses une réaction :${TARGET_EMOJI}: sur un message.\n\n🎁 Dépense-les en boosters avec \`/jeanpip-booster\`\n⚔️ ou achète une Attaque Jeanpip (*${ATTACK_PRICE}* crédits) avec \`/jeanpip-attack\` !`,
          },
        },
      ],
    }, logger);
    logger.info(`💰 /jeanpip-credits : <@${userId}> a ${balance} crédits`);
  } catch (error) {
    logger.error('❌ Erreur dans /jeanpip-credits:', error);
  }
});

// ─────────────────────────────────────────────
// 🎁 Slash command : /jeanpip-booster
//    Ouvre la boutique de boosters en DM (3 boutons d'achat)
// ─────────────────────────────────────────────
app.command('/jeanpip-booster', async ({ command, ack, client, logger }) => {
  await ack();

  const userId = command.user_id;

  try {
    const balance = credits.getBalance(userId);

    const buttons = boosters.listBoosters().map((b) => ({
      type: 'button',
      text: { type: 'plain_text', text: `${b.emoji} ${b.label} (${b.price})` },
      action_id: `buy_booster_${b.type}`,
      value: b.type,
    }));

    await safeSendDM(client, userId, {
      text: `🎁 Boutique de boosters JeanPip`,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: '🎁 Boosters JeanPip' } },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `💰 Ton solde : *${balance}* crédit(s)\n\nChaque booster contient *8 cartes*. Plus le booster est cher, plus tes chances de tomber sur du 🔵 rare, 🟣 épique ou 🟡 légendaire sont élevées !`,
          },
        },
        { type: 'actions', elements: buttons },
        { type: 'context', elements: [{ type: 'mrkdwn', text: boosters.listBoosters().map((b) => `${b.emoji} ${b.label} · ${b.price} crédits`).join('   ') }] },
      ],
    }, logger);
    logger.info(`🎁 /jeanpip-booster : boutique envoyée à <@${userId}> (solde ${balance})`);
  } catch (error) {
    logger.error('❌ Erreur dans /jeanpip-booster:', error);
  }
});

// ─────────────────────────────────────────────
// 🛒 Action : clic sur un bouton d'achat de booster
//    action_id = buy_booster_<type> · value = <type>
// ─────────────────────────────────────────────
app.action(/^buy_booster_/, async ({ ack, body, action, client, logger }) => {
  await ack();

  const userId = body.user.id;
  const type = action.value;

  try {
    const booster = boosters.getBooster(type);
    if (!booster) {
      logger.warn(`⚠️ Type de booster inconnu : ${type}`);
      return;
    }

    // 💸 Débit atomique : spend() re-vérifie le solde et renvoie false si insuffisant
    if (!credits.spend(userId, booster.price)) {
      const balance = credits.getBalance(userId);
      const missing = booster.price - balance;
      await sendDM(client, userId, {
        text: `❌ Il te manque ${missing} crédits`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *Il te manque ${missing} crédit(s)* pour le Booster ${booster.emoji} ${booster.label}.\n\n💰 Ton solde : *${balance}* · Prix : *${booster.price}*\n\nRéagis avec :${TARGET_EMOJI}: pour gagner des crédits ! 💪`,
            },
          },
        ],
      });
      logger.info(`💸 Achat refusé (solde insuffisant) : <@${userId}> ${booster.type}`);
      return;
    }

    // ✅ Débit OK → on enregistre le booster en attente
    const id = boosters.createPending(userId, type);
    const balance = credits.getBalance(userId);

    // 🎬 Ouverture animée (page web, bureaux uniquement) si configurée,
    //    sinon seulement l'ouverture dans Slack.
    const openUrl = web.buildOpenUrl(id, userId);
    const openButtons = [];
    if (openUrl) {
      openButtons.push({
        type: 'button',
        style: 'primary',
        text: { type: 'plain_text', text: '🎬 Ouverture animée' },
        action_id: 'open_booster_web',
        url: openUrl,
      });
    }
    openButtons.push({
      type: 'button',
      ...(openUrl ? {} : { style: 'primary' }),
      text: { type: 'plain_text', text: openUrl ? '💬 Ouvrir dans Slack' : '🎁 Ouvrir le booster' },
      action_id: 'open_booster',
      value: id,
    });

    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${booster.emoji} *Booster ${booster.label} acheté !* 🎉\n\n💰 Nouveau solde : *${balance}* crédit(s)\n\nClique pour révéler tes 8 cartes 👇`,
        },
      },
      { type: 'actions', elements: openButtons },
    ];
    if (openUrl) {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: "🎬 _L'ouverture animée ne marche que depuis le bureau de Lorient ou d'Asnières. En télétravail, ouvre-le dans Slack._" }],
      });
    }

    const sent = await sendDM(client, userId, {
      text: `${booster.emoji} Booster ${booster.label} acheté !`,
      blocks,
    });
    boosters.setMessageRef(id, sent.channel, sent.ts);
    logger.info(`🛒 <@${userId}> a acheté un booster ${booster.type} (id ${id}, solde ${balance})`);
    await refreshHome(client, userId, logger);
  } catch (error) {
    logger.error('❌ Erreur dans buy_booster:', error);
  }
});

// ─────────────────────────────────────────────
// 🎁 Action : clic sur « Ouvrir le booster »
//    action_id = open_booster · value = <booster id>
//    Révèle les 8 cartes, une toutes les 2 s, dans le DM.
//    (Ouverture partagée avec la page web : src/openBooster.js)
// ─────────────────────────────────────────────
const SLACK_REVEAL_INTERVAL_MS = 2000;

app.action('open_booster', async ({ ack, body, action, client, logger }) => {
  await ack();

  const userId = body.user.id;
  const id = action.value;
  const channelId = body.channel && body.channel.id;
  const messageTs = body.message && body.message.ts;

  try {
    // 🔒 Tirage + collection + persistance en un seul bloc synchrone :
    //    un double-clic ou une ouverture web simultanée ne passe qu'une fois.
    const result = openOnce(id, userId, 'slack');

    if (result.status === 'not_found') {
      await sendDM(client, userId, {
        text: `❌ Booster introuvable`,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `❌ *Ce booster est introuvable.* Il a peut-être déjà été ouvert.` } }],
      });
      return;
    }

    if (result.status === 'forbidden') {
      logger.warn(`⛔ <@${userId}> a tenté d'ouvrir le booster de <@${result.pending.owner}>`);
      return;
    }

    if (result.status === 'already') {
      if (result.via === 'web') {
        await sendDM(client, userId, {
          text: `🎬 Booster déjà ouvert avec l'animation`,
          blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `🎬 *Ce booster a déjà été ouvert avec l'animation.* Tes cartes sont dans ta collection !` } }],
        });
      }
      logger.info(`ℹ️ Booster ${id} déjà ouvert (${result.via}), clic ignoré`);
      return;
    }
    refreshHomeIfSeen(client, userId, logger); // compteur « boosters non ouverts »

    const { pending, cards, counts: copyCounts } = result;
    const booster = boosters.getBooster(pending.type);
    const emoji = booster ? booster.emoji : '🎁';
    const label = booster ? booster.label : pending.type;

    // 🔕 Désactiver le bouton en remplaçant le message
    if (channelId && messageTs) {
      try {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: `${emoji} Booster ${label} ouvert !`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `${emoji} *Booster ${label} — ouvert !* 🎉\n\n_Les 8 cartes se révèlent ci-dessous, une toutes les 2 secondes..._`,
              },
            },
          ],
        });
      } catch (updateError) {
        logger.error(`❌ Impossible de désactiver le bouton :`, updateError.message);
      }
    }

    // 🎴 Cartes déjà tirées ET enregistrées en collection par openOnce
    //    (un crash en cours de révélation ne fait pas perdre les cartes).
    logger.info(`🎁 <@${userId}> ouvre le booster ${pending.type} dans Slack (${cards.length} cartes)`);

    // ⏱️ Révélation progressive : une carte toutes les 2 s, dans la conversation
    //    classique de Jeanpip (pas en réponse/thread au message d'ouverture).
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      try {
        await client.chat.postMessage({
          channel: channelId,
          text: `${card.title} (${i + 1}/${cards.length})`,
          blocks: buildMediaBlocks({
            headerText: `🎴 *${card.title}* — carte ${i + 1}/${cards.length}${copyCounts[i] ? `
${collections.copyPhrase(copyCounts[i])}` : ''}`,
            media: card,
          }),
        });
      } catch (revealError) {
        logger.error(`❌ Erreur révélation carte ${i + 1}:`, revealError.message);
      }
      if (i < cards.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, SLACK_REVEAL_INTERVAL_MS));
      }
    }

    logger.info(`✅ Booster ${id} entièrement révélé pour <@${userId}>`);
  } catch (error) {
    logger.error('❌ Erreur dans open_booster:', error);
  }
});

// ─────────────────────────────────────────────
// 🎬 Action : clic sur le bouton-lien « Ouverture animée »
//    Slack ouvre l'URL côté client mais envoie quand même une action :
//    il faut l'acquitter (sinon ⚠️ dans Slack). L'ouverture a lieu sur la page.
// ─────────────────────────────────────────────
app.action('open_booster_web', async ({ ack }) => {
  await ack();
});

// ─────────────────────────────────────────────
// 📮 Slash command : /jeanpip
//    Gère son inscription à la liste de diffusion (opt-in)
// ─────────────────────────────────────────────

/** Construit le message d'état + le bouton adapté (rejoindre / quitter). */
function buildBroadcastBlocks(userId) {
  const subscribed = broadcast.isSubscribed(userId);

  const statusText = subscribed
    ? `📮 *Tu es inscrit à la liste de diffusion Jeanpip !* :${TARGET_EMOJI}:\n\n✅ Tu *reçois* les Jeanpips que les autres t'envoient.\n\nTu peux en sortir à tout moment 👇`
    : `📮 *Tu n'es PAS dans la liste de diffusion Jeanpip.*\n\n🔕 Personne ne peut t'envoyer de Jeanpip : quand quelqu'un réagit à ton message, tu ne reçois rien.\n\n_Tu reçois quand même TON image quand c'est toi qui réagis, et tes boosters fonctionnent normalement._\n\nEnvie de participer ? 👇`;

  return [
    { type: 'header', text: { type: 'plain_text', text: '📮 Liste de diffusion Jeanpip' } },
    { type: 'section', text: { type: 'mrkdwn', text: statusText } },
    {
      type: 'actions',
      elements: [
        subscribed
          ? {
              type: 'button',
              style: 'danger',
              text: { type: 'plain_text', text: '🚪 Sortir de la liste' },
              action_id: 'broadcast_leave',
              value: 'leave',
            }
          : {
              type: 'button',
              style: 'primary',
              text: { type: 'plain_text', text: '✅ Rejoindre la liste' },
              action_id: 'broadcast_join',
              value: 'join',
            },
      ],
    },
  ];
}

app.command('/jeanpip', async ({ command, ack, client, logger }) => {
  await ack();

  const userId = command.user_id;

  try {
    await safeSendDM(client, userId, {
      text: `📮 Liste de diffusion Jeanpip`,
      blocks: buildBroadcastBlocks(userId),
    }, logger);
    logger.info(`📮 /jeanpip : état envoyé à <@${userId}> (inscrit=${broadcast.isSubscribed(userId)})`);
  } catch (error) {
    logger.error('❌ Erreur dans /jeanpip:', error);
  }
});

// ─────────────────────────────────────────────
// 📮 Actions : rejoindre / quitter la liste de diffusion
// ─────────────────────────────────────────────
app.action(/^broadcast_(join|leave)$/, async ({ ack, body, action, client, logger }) => {
  await ack();

  const userId = body.user.id;
  const channelId = body.channel && body.channel.id;
  const messageTs = body.message && body.message.ts;

  try {
    const joining = action.action_id === 'broadcast_join';

    if (joining) {
      broadcast.subscribe(userId);
      logger.info(`📮 <@${userId}> a REJOINT la liste de diffusion`);
    } else {
      broadcast.unsubscribe(userId);
      logger.info(`📮 <@${userId}> est SORTI de la liste de diffusion`);
    }

    const confirmation = joining
      ? `✅ *C'est fait, tu es dans la liste de diffusion !* :${TARGET_EMOJI}:\n\nTu vas maintenant recevoir les Jeanpips que les autres t'envoient. 🎉`
      : `🚪 *Tu es sorti de la liste de diffusion.*\n\nPersonne ne peut plus t'envoyer de Jeanpip. Tu peux revenir quand tu veux avec \`/jeanpip\`.`;

    // Clic depuis l'onglet Accueil : pas de message à mettre à jour
    await refreshHome(client, userId, logger);

    // Met à jour le message d'origine avec le nouvel état + le bouton inverse
    if (channelId && messageTs) {
      try {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: joining ? `✅ Tu es dans la liste de diffusion` : `🚪 Tu es sorti de la liste de diffusion`,
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: confirmation } },
            ...buildBroadcastBlocks(userId).slice(1), // état à jour + bouton inverse
          ],
        });
      } catch (updateError) {
        logger.error(`❌ Impossible de mettre à jour le message :`, updateError.message);
      }
    }
  } catch (error) {
    logger.error('❌ Erreur dans broadcast_join/leave:', error);
  }
});

// ═════════════════════════════════════════════
// 🏠 ONGLET ACCUEIL (App Home)
//    Construit par user (src/home.js). Le panneau 👑 Admin n'est construit
//    que pour JEANPIP_ADMINS, et chaque action admin revérifie les droits.
// ═════════════════════════════════════════════
app.event('app_home_opened', async ({ event, client, logger }) => {
  if (event.tab !== 'home') return;
  homeViewers.add(event.user);
  await refreshHome(client, event.user, logger);
});

async function openModal(client, body, view, logger) {
  try {
    await client.views.open({ trigger_id: body.trigger_id, view });
  } catch (error) {
    logger.error(`❌ Impossible d'ouvrir la modale ${view.callback_id} :`, error.data ? error.data.error : error.message);
  }
}

function isAdminUser(userId, logger, what) {
  if (JEANPIP_ADMINS.includes(userId)) return true;
  logger.warn(`⛔ <@${userId}> a tenté ${what} sans être admin`);
  return false;
}

/** Réponse de view_submission affichant une erreur sous un champ de la modale. */
function fieldError(blockId, message) {
  return { response_action: 'errors', errors: { [blockId]: message } };
}

/** Texte mrkdwn → texte brut court (pour les erreurs de modale). */
function plain(text) {
  return text.replace(/[*_`]/g, '').replace(/<@([A-Z0-9]+)>/g, 'cette personne').split('\n')[0];
}

// ⚔️ Attaque depuis l'Accueil : modale avec choix du channel
app.action('home_attack_open', async ({ ack, body, client, logger }) => {
  await ack();
  const userId = body.user.id;
  await openModal(client, body, home.buildAttackModal(userId, {
    isAdmin: JEANPIP_ADMINS.includes(userId),
    attackPrice: ATTACK_PRICE,
  }), logger);
});

app.view('home_attack_submit', async ({ ack, body, view, client, logger }) => {
  const userId = body.user.id;
  const channelId = view.state.values.channel.value.selected_conversation;
  const mode = home.attackMode(userId, JEANPIP_ADMINS.includes(userId));

  // ✋ Vérifications rapides AVANT de fermer la modale (erreur affichée dedans)
  if (!channelId) return ack(fieldError('channel', 'Choisis un channel.'));
  const farmRemaining = getFarmPenaltyRemaining(userId);
  if (farmRemaining > 0) {
    return ack(fieldError('channel', `🚜 Pénalité anti-farm : réessaie dans ${formatRemaining(farmRemaining)}.`));
  }
  if (mode === 'paid' && credits.getBalance(userId) < ATTACK_PRICE) {
    return ack(fieldError('channel', `Solde insuffisant : il te faut ${ATTACK_PRICE} crédits.`));
  }
  if (attackPurchaseLocks.has(userId)) {
    return ack(fieldError('channel', 'Une attaque est déjà en cours de lancement…'));
  }

  await ack();
  attackPurchaseLocks.add(userId);
  try {
    // Mêmes règles que /jeanpip-attack : gratuite consommée / admin illimité / payée.
    // Rien n'est débité ni consommé si personne n'est attaquable (DM d'explication).
    await launchAttack(client, userId, channelId, logger,
      mode === 'paid' ? { price: ATTACK_PRICE } : { consumeFree: mode === 'free' });
  } catch (error) {
    logger.error('❌ Erreur dans home_attack_submit:', error);
  } finally {
    attackPurchaseLocks.delete(userId);
  }
});

// 👑 Boutons du panneau admin → ouverture des modales
const ADMIN_MODALS = {
  admin_give_attack_open: home.buildGiveAttackModal,
  admin_credits_open: home.buildCreditsModal,
  admin_addmedia_open: home.buildAddMediaModal,
  admin_target_add_open: home.buildAddTargetModal,
  admin_credit_value_open: home.buildCreditValueModal,
};

for (const [actionId, buildModal] of Object.entries(ADMIN_MODALS)) {
  app.action(actionId, async ({ ack, body, client, logger }) => {
    await ack();
    if (!isAdminUser(body.user.id, logger, actionId)) return;
    await openModal(client, body, buildModal(), logger);
  });
}

// 🎁 Modale « Offrir une attaque »
app.view('admin_give_attack_submit', async ({ ack, body, view, client, logger }) => {
  const adminId = body.user.id;
  if (!isAdminUser(adminId, logger, 'admin_give_attack_submit')) return ack(fieldError('user', 'Réservé aux admins.'));

  const targetId = view.state.values.user.value.selected_user;
  if (scores.hasAttack(targetId)) return ack(fieldError('user', 'Cette personne a déjà une Attaque Jeanpip disponible.'));

  await ack();
  try {
    const result = await adminActions.giveAttack(client, adminId, targetId, logger);
    await sendAdminResult(client, adminId, result, logger);
    if (result.ok) await refreshHomeIfSeen(client, targetId, logger);
  } catch (error) {
    logger.error('❌ Erreur dans admin_give_attack_submit:', error);
  }
});

// 💳 Modale « Crédits ± »
app.view('admin_credits_submit', async ({ ack, body, view, client, logger }) => {
  const adminId = body.user.id;
  if (!isAdminUser(adminId, logger, 'admin_credits_submit')) return ack(fieldError('user', 'Réservé aux admins.'));

  const values = view.state.values;
  const targetId = values.user.value.selected_user;
  const raw = (values.amount.value.value || '').trim().replace(',', '.');
  const amount = /^-?\d+(?:\.\d+)?$/.test(raw) ? Math.round(parseFloat(raw) * 2) / 2 : NaN;
  if (!Number.isFinite(amount) || amount === 0) {
    return ack(fieldError('amount', 'Montant non nul attendu (ex. 50, 2,5 ou -20).'));
  }

  await ack();
  try {
    const result = await adminActions.adjustCredits(client, adminId, targetId, amount, logger);
    await sendAdminResult(client, adminId, result, logger);
    if (result.ok) {
      await refreshHomeIfSeen(client, targetId, logger);
      if (targetId !== adminId) await refreshHomeIfSeen(client, adminId, logger);
    }
  } catch (error) {
    logger.error('❌ Erreur dans admin_credits_submit:', error);
  }
});

// 🖼️ Modale « Ajouter un média »
app.view('admin_addmedia_submit', async ({ ack, body, view, client, logger }) => {
  const adminId = body.user.id;
  if (!isAdminUser(adminId, logger, 'admin_addmedia_submit')) return ack(fieldError('url', 'Réservé aux admins.'));

  const values = view.state.values;
  const url = (values.url.value.value || '').trim();
  const rarity = values.rarity.value.selected_option && values.rarity.value.selected_option.value;
  const title = (values.title.value.value || '').trim();

  if (!/^https?:\/\//i.test(url)) return ack(fieldError('url', 'Le lien doit commencer par http:// ou https://.'));
  if (!rarity) return ack(fieldError('rarity', 'Choisis une rareté.'));

  const result = adminActions.addMediaToBank(adminId, { url, rarity, title }, logger);
  if (!result.ok) return ack(fieldError('url', plain(result.text.split('\n')[1] || result.text)));

  await ack();
  try {
    // Confirmation + aperçu en DM (l'admin vérifie que le lien s'affiche bien)
    await sendAdminResult(client, adminId, result, logger);
  } catch (error) {
    logger.error('❌ Erreur dans admin_addmedia_submit:', error);
  }
});

// ⚙️ Modale « Crédits par Jeanpip » (valeur d'un Jeanpip envoyé, sans rétroactivité)
app.view('admin_credit_value_submit', async ({ ack, body, view, client, logger }) => {
  const adminId = body.user.id;
  if (!isAdminUser(adminId, logger, 'admin_credit_value_submit')) return ack(fieldError('value', 'Réservé aux admins.'));

  const raw = (view.state.values.value.value.value || '').trim().replace(',', '.');
  const value = /^\d+(?:\.\d+)?$/.test(raw) ? parseFloat(raw) : NaN;
  const result = settings.setCreditsPerJeanpip(value);
  if (!result.ok) {
    return ack(fieldError('value', result.error === 'invalide'
      ? `Multiple de 0,5 entre ${settings.CREDITS_PER_JEANPIP_MIN} et ${settings.CREDITS_PER_JEANPIP_MAX} attendu (ex. 0,5 · 1 · 2).`
      : `Erreur d'écriture : ${result.detail}`));
  }

  await ack();
  const label = (n) => String(n).replace('.', ',');
  logger.info(`⚙️ <@${adminId}> a réglé 1 Jeanpip = ${result.value} crédit(s) (avant : ${result.previous})`);
  try {
    await sendAdminResult(client, adminId, {
      text: `⚙️ *Réglage enregistré : 1 Jeanpip envoyé = ${label(result.value)} crédit(s).*\nAvant : ${label(result.previous)}. S'applique aux prochains Jeanpips (pas de rétroactivité).`,
    }, logger);
    // Le solde affiché ne change pas, mais la ligne « +N crédit(s) » oui → on republie
    for (const userId of homeViewers) await refreshHome(client, userId, logger);
  } catch (error) {
    logger.error('❌ Erreur dans admin_credit_value_submit:', error);
  }
});

// 🎪 Modale « Ajouter une cible » + bouton « Retirer »
app.view('admin_target_add_submit', async ({ ack, body, view, client, logger }) => {
  const adminId = body.user.id;
  if (!isAdminUser(adminId, logger, 'admin_target_add_submit')) return ack(fieldError('user', 'Réservé aux admins.'));

  const targetId = view.state.values.user.value.selected_user;
  const result = adminActions.addAutoTarget(adminId, targetId, logger);
  if (!result.ok) return ack(fieldError('user', plain(result.text)));

  await ack();
  await refreshHome(client, adminId, logger);
});

app.action('admin_target_remove', async ({ ack, body, action, client, logger }) => {
  await ack();
  const adminId = body.user.id;
  if (!isAdminUser(adminId, logger, 'admin_target_remove')) return;

  adminActions.removeAutoTarget(adminId, action.value, logger);
  await refreshHome(client, adminId, logger);
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
  const creditBalance = credits.getBalance(userId);
  const isSubscribed = broadcast.isSubscribed(userId);

  try {
    await safeSendDM(client, userId, {
      text: `👋 Voici toutes les features du Jeanpip Bot !`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `🤖 Jeanpip Bot — Guide complet` },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🏠 *Le plus simple : l'onglet Accueil du bot !*\nClique sur le bot dans la barre latérale → onglet *Accueil* : ton solde, ton score, l'achat de boosters, l'Attaque Jeanpip (avec choix du channel) et la liste de diffusion, en boutons.${isAdmin ? '\n👑 _Tu y trouveras aussi le panneau Admin._' : ''}`,
          },
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
            text: `⚔️ *Attaque Jeanpip — \`/jeanpip-attack\`*\nEnvoie un Jeanpip aux *7 dernières personnes* ayant posté dans le channel où tu lances la commande !\n\n*Comment débloquer :*\n• Envoie *${scores.ATTACK_THRESHOLD} Jeanpips* dans la semaine\n• Tu reçois un DM de notification quand c'est débloqué\n• Lance \`/jeanpip-attack\` dans le channel de ton choix\n• Ton compteur repart à 0, tu peux redébloquer ensuite !

💰 *Pas envie d'attendre ?* Achète une attaque pour *${ATTACK_PRICE} crédits* : lance `/jeanpip-attack` et clique sur le bouton.\n\n⚠️ _Si tu ne l'actives pas avant dimanche 20h → tu perds l'attaque_${isAdmin ? '\n\n👑 *Tu es admin : accès illimité + panneau 👑 Admin dans l\'onglet Accueil (ou `/jeanpip-give @user`, `/jeanpip-auto`) !*' : ''}`,
          },
        },
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `📮 *Liste de diffusion — \`/jeanpip\`*\n${isSubscribed
              ? '✅ *Tu es inscrit* : tu reçois les Jeanpips que les autres t\'envoient.'
              : '🔕 *Tu n\'es pas inscrit* : personne ne peut t\'envoyer de Jeanpip.'
            }\n\nPar défaut *personne* n'est inscrit. Tant que tu n'es pas dans la liste :\n• Quand quelqu'un réagit à ton message, tu ne reçois rien\n• Tu reçois quand même *ton* image quand c'est *toi* qui réagis\n• Tes boosters fonctionnent normalement\n\n⚠️ _Envoyer un Jeanpip à quelqu'un qui n'est pas inscrit ne rapporte aucun crédit._\n\nTape \`/jeanpip\` pour entrer ou sortir de la liste.`,
          },
        },
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🎁 *Boosters JeanPip — \`/jeanpip-booster\`*\nTu as *${creditBalance}* crédit(s) 💰\n\n*Comment gagner des crédits :*\n• *+${creditsPerJeanpipLabel()} crédit(s)* à chaque réaction :${TARGET_EMOJI}: que TU poses (spam exclu)\n\n*Comment les dépenser :*\n• \`/jeanpip-booster\` → achète un booster (${boosters.listBoosters().map((b) => `${b.emoji} ${b.price}`).join(' · ')})\n• \`/jeanpip-attack\` → achète une Attaque Jeanpip (${ATTACK_PRICE}) si tu n'en as pas de gratuite\n• Chaque booster = *8 cartes* révélées une par une\n• Plus le booster est cher, plus les cartes rares sont probables !\n\n_Tape \`/jeanpip-credits\` pour voir ton solde à tout moment._`,
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
            text: `🚜 *Anti-farm*\nSi tu poses *plus de ${FARM_MAX_PER_HOUR} Jeanpips en 1 heure*, tu prends une alerte et pendant *1 heure* :\n• ❌ Tes Jeanpips n'envoient plus rien aux autres\n• ❌ Tu n'accumules plus de crédits\n• ✅ Tu continues à *recevoir* des Jeanpips\n• ✅ Tu peux toujours *ouvrir tes boosters*\n\n_Le Jeanpip se déguste, il ne se farme pas._`,
          },
        },
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `📋 *Toutes les commandes*\n\`/jeanpip\` → Entrer ou sortir de la liste de diffusion\n\`/jeanpip-help\` → Affiche ce message avec ton score actuel\n\`/jeanpip-attack\` → Lance une Attaque Jeanpip sur le channel (gratuite si débloquée, sinon ${ATTACK_PRICE} crédits)\n\`/jeanpip-credits\` → Affiche ton solde de crédits\n\`/jeanpip-booster\` → Ouvre la boutique de boosters${isAdmin ? '\n`/jeanpip-give @user` → (admin) Offre une Attaque Jeanpip à quelqu\'un\n`/jeanpip-give-credits @user <montant>` → (admin) Crédite le porte-monnaie de quelqu\'un\n`/jeanpip-addmedia <lien> <rareté> [titre]` → (admin) Ajoute un média à la banque\n`/jeanpip-auto add|remove|list` → (admin) Gère les cibles auto-react' : ''}`,
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
// Retourne { channel, ts } du message envoyé (pour un éventuel chat.update).
async function sendDM(client, userId, message) {
  const conversation = await client.conversations.open({ users: userId });
  const result = await client.chat.postMessage({
    channel: conversation.channel.id,
    text: message.text,
    blocks: message.blocks,
  });
  return { channel: result.channel, ts: result.ts };
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

  // 🎬 Page d'ouverture animée (si WEB_PUBLIC_URL est défini)
  try {
    web.startWebServer({
      client: app.client,
      logger: console,
      // 🏠 Ouverture animée → compteur « boosters non ouverts » de l'Accueil à jour
      onOpened: (userId) => refreshHomeIfSeen(app.client, userId, console),
    });
  } catch (webError) {
    console.error('❌ Serveur web non démarré :', webError.message);
  }

  const currentTargets = targets.getTargets();

  console.log('');
  console.log('══════════════════════════════════════════');
  console.log('  ⚡️  Slack Emoji Reactor Bot lancé !');
  console.log(`  🎯  Emoji surveillé : :${TARGET_EMOJI}:`);
  console.log(`  🤖  Bot ID : ${botUserId}`);
  console.log(`  🚨  Anti-spam : ${SPAM_THRESHOLD_SECONDS}s seuil → ${SPAM_TROLL_SEQUENCE.length}x troll`);
  console.log(`  ⚔️   Attaque Jeanpip : seuil ${scores.ATTACK_THRESHOLD} jeanpips/semaine`);
  console.log(`  🎁  Boosters : ${boosters.listBoosters().map((b) => `${b.emoji}${b.price}`).join(' ')} (8 cartes)`);
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
