// ═══════════════════════════════════════════════════════════
//  🤖 SLACK EMOJI REACTOR BOT
//  Envoie des images/vidéos aléatoires en DM quand
//  quelqu'un réagit avec un emoji spécifique
// ═══════════════════════════════════════════════════════════

const { App, LogLevel } = require('@slack/bolt');
require('dotenv').config();

const { getRandomMedia, normalizeRarity, getAllMedia, getRemovedMedia, RARITIES } = require('./media');
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
const { createAdminActions, formatCredits, AUTHOR_REWARDS } = require('./admin');
const settings = require('./settings');
const farm = require('./farm');
const boosterSpam = require('./boosterSpam');
const boosterBans = require('./boosterBans');
const octobreRose = require('./octobreRose');
const weekend = require('./weekend');
const leave = require('./leave');
const closure = require('./closure');
const resale = require('./resale');
const dailyJeanpips = require('./dailyJeanpips');
const raid = require('./raid');

/**
 * 🏖️ v3.3 : le week-end, le bot n'envoie aucune notification automatique
 * (seule la réponse directe à un clic du joueur part encore). → true = ne rien envoyer.
 */
function weekendMuted(logger, what) {
  if (!weekend.isPaused()) return false;   // v3.6 : aussi pendant une fermeture de l'entreprise
  (logger || console).info(`🏖️ Pause (week-end / fermeture) : ${what} non envoyé`);
  return true;
}

/** 🌴 v3.6 : idem pour un seul joueur (pause pour tous, ou ses congés). → true = ne rien lui envoyer. */
function userMuted(userId, logger, what) {
  const p = weekend.pauseFor(userId);
  if (!p) return false;
  (logger || console).info(`${p.icon} Pause (${p.kind}) : ${what} non envoyé`);
  return true;
}
const weeklyGift = require('./weeklyGift');
const { SPAM_CARDS } = require('./spamCards');
const looks = require('./game/looks');
const cards = require('./game/cards');
const arenaSlack = require('./arenaSlack');
const bugsSlack = require('./bugsSlack');
const events = require('./events');

// 🗄️ Base SQLite (crédits + journal des stats) : sans elle, pas de démarrage
//    (mieux vaut un bot arrêté qu'une économie non tracée ou remise à zéro).
try {
  require('./db').getDb();
  credits.ensureImported();
} catch (e) {
  console.error(`❌ Base SQLite indisponible (data/jeanpip.db) : ${e.message}`);
  console.error('   → vérifier `npm install` (better-sqlite3) et les droits sur data/.');
  process.exit(1);
}
// 🎯 v3.6 : au premier démarrage, 20 Jeanpips par jour à 1 JP$ (une seule fois, puis réglages admin)
if (settings.applyV36Defaults()) console.log('🎯 v3.6 : réglages passés à 20 Jeanpips par jour et 1 JP$ par Jeanpip');
// ⚔️ Liens de l'Arène (null si la page web est désactivée)
const ARENA_LINKS = {
  arena: (matchId, userId) => web.buildArenaUrl(matchId, userId),
  deck: (userId) => web.buildDeckUrl(userId),
  openBooster: (boosterId, userId) => web.buildOpenUrl(boosterId, userId),
};
const { describeText: describeCharacter } = require('./game/characters');

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

// 💰 Crédits gagnés par Jeanpip envoyé (demi-crédits autorisés) : réglable en
//    live par un admin depuis l'onglet Accueil (src/settings.js, défaut 0,5).
const creditsPerJeanpipLabel = () => String(settings.getCreditsPerJeanpip()).replace('.', ',');

// ─────────────────────────────────────────────
// 🚨 Anti-spam config
// ─────────────────────────────────────────────
const SPAM_THRESHOLD_SECONDS = 8;
const SPAM_PUNISHMENT_INTERVAL_MS = 5000;
// 🔢 Les 10 photos troll (« Surprise #62 → #71 ») : src/spamCards.js
const SPAM_TROLL_SEQUENCE = SPAM_CARDS;

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
      // 🔢 Photo numérotée « Surprise #62 → #71 », comme la banque de médias
      const card = SPAM_TROLL_SEQUENCE[i];
      // 🗂️ Elle entre dans la collection (intercalaire « Hors série » du classeur)
      const nextCount = collections.getCount(userId, card.url) + 1;
      await sendDM(client, userId, {
        text: `${card.title} — Spammer c'est mal. (${i + 1}/${total})`,
        blocks: buildMediaBlocks({
          headerText: `🚨 *Spammer c'est mal.* — ${card.title} (${i + 1}/${total})
${collections.copyPhrase(nextCount)}`,
          media: { type: card.type, url: card.url, title: card.title },
        }),
      });
      collections.addCards(userId, [card]);
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
//    Plus de N Jeanpips en 1 h → pénalité de 1 h (N réglable par un admin
//    depuis l'onglet Accueil : settings.farmMaxPerHour, défaut 10).
//    Pendant la pénalité :
//      ❌ ses Jeanpips n'envoient plus rien aux autres
//      ❌ il n'accumule plus de crédits (ni score)
//      ✅ il continue de RECEVOIR des Jeanpips
//      ✅ il peut toujours ouvrir ses boosters
// ─────────────────────────────────────────────
//    L'historique et les pénalités sont persistés (src/farm.js → data/farm.json)
//    pour survivre aux redémarrages du bot.
const farmReleaseTimers = new Map(); // userId → timer de fin de pénalité

/** Limite anti-farm en cours (Jeanpips max par heure glissante). */
const farmMaxPerHour = () => settings.getFarmMaxPerHour();

/** Temps de pénalité restant pour un user (0 s'il n'est pas pénalisé). */
const getFarmPenaltyRemaining = (userId) => farm.getPenaltyRemaining(userId);

/**
 * Enregistre un Jeanpip dans la fenêtre glissante.
 * Retourne true si l'utilisateur vient de dépasser le seuil (→ pénalité).
 */
const recordJeanpipForFarm = (userId) => farm.record(userId, farmMaxPerHour());

/** Quota anti-farm d'un user (onglet Accueil) : { used, max, nextFreeMs }. */
const getFarmQuota = (userId) => farm.getQuota(userId, farmMaxPerHour());

/** Formate un temps restant en texte lisible (« 42 min »). */
function formatRemaining(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  return minutes >= 60 ? '1 h' : `${minutes} min`;
}

/**
 * Programme la fin de pénalité : nettoie l'état et prévient la personne
 * que son accès au Jeanpip est rétabli.
 */
function scheduleFarmRelease(client, userId, logger, delayMs = farm.FARM_PENALTY_MS) {
  clearTimeout(farmReleaseTimers.get(userId));
  const timer = setTimeout(async () => {
    farm.clear(userId);
    farmReleaseTimers.delete(userId);
    refreshHomeIfSeen(client, userId, logger); // pénalité terminée → quota à 0
    if (userMuted(userId, logger, `DM de fin de pénalité anti-farm à <@${userId}>`)) return;
    try {
      await safeSendDM(client, userId, {
        text: `✅ Ton accès au Jeanpip est rétabli !`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *Ton accès au Jeanpip est rétabli !* :${TARGET_EMOJI}:\n\nTa pénalité anti-farm est terminée. Tu peux de nouveau :\n• 📤 Envoyer des Jeanpips aux autres\n• 📥 Recevoir des images\n• 💰 Gagner des JP$\n\n_Reste sous ${farmMaxPerHour()} Jeanpips par heure pour éviter un nouveau bridage._ 😉`,
            },
          },
        ],
      }, logger);
      logger.info(`✅ Fin de pénalité anti-farm notifiée à <@${userId}>`);
    } catch (error) {
      logger.error(`❌ Erreur notif fin de pénalité anti-farm :`, error.message);
    }
  }, delayMs);

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

/**
 * 🔕 Prévient le réacteur, en message éphémère dans le canal (visible de lui seul) ;
 * repli en DM si l'éphémère est impossible.
 */
async function notifyReactor(client, channelId, userId, text, logger) {
  try {
    await client.chat.postEphemeral({ channel: channelId, user: userId, text });
  } catch (error) {
    logger.warn(`ℹ️  Éphémère impossible (${error.data ? error.data.error : error.message}) → DM à <@${userId}>`);
    await safeSendDM(client, userId, { text }, logger).catch((e) => logger.error('❌ DM de notification :', e.message));
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
 *   • collect = false → envoi simple, sans collection (Jeanpip qui ne compte pas)
 * La carte n'est ajoutée que si le DM est vraiment parti.
 * 🚜 v3.0.2 : sous pénalité anti-farm, le destinataire ne reçoit AUCUNE image
 *    (ni la sienne, ni celles des autres, ni auto-réaction, ni attaque) → false.
 */
async function sendJeanpipDM(client, userId, { text, headerText, media, collect = true }, logger) {
  if (getFarmPenaltyRemaining(userId) > 0) {
    logger.info(`🚜 <@${userId}> sous pénalité anti-farm → aucune image envoyée`);
    return false;
  }
  // 🌴 v3.6 : en congés, on ne reçoit aucun Jeanpip
  if (leave.activeLeave(userId)) {
    logger.info(`🌴 <@${userId}> en congés → aucune image envoyée`);
    return false;
  }
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
    creditsPerJeanpipLabel: creditsPerJeanpipLabel(),
    targetEmoji: TARGET_EMOJI,
    farmRemainingMs: getFarmPenaltyRemaining(userId),
    farmQuota: getFarmQuota(userId),
    dailyJeanpips: { used: dailyJeanpips.countToday(userId), max: settings.getDailyJeanpipLimit() },
    formatRemaining,
    autoTargets: isAdmin ? adminActions.listAutoTargets() : undefined,
    collectionUrl: web.buildCollectionUrl(userId),
    statsUrl: isAdmin ? web.buildStatsUrl(userId) : null,
    deckUrl: web.buildDeckUrl(userId),
    ticketsUrl: web.buildTicketsUrl(userId),
    arena: arenaSlack.homeState(userId, ARENA_LINKS),
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

/**
 * 🙈 v3.2 : republie TOUS les Accueils ouverts (+ `alsoUserId`), en parallèle et
 * dans un ordre mélangé : à l'arrivée du stock Octobre Rose, personne ne voit le
 * bouton d'achat avant les autres parce qu'il est en tête de liste.
 */
async function refreshAllHomes(client, logger, alsoUserId = null) {
  const users = [...new Set([...homeViewers, ...(alsoUserId ? [alsoUserId] : [])])];
  for (let i = users.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [users[i], users[j]] = [users[j], users[i]];
  }
  await Promise.all(users.map((u) => refreshHome(client, u, logger)));
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
    // 🏖️ v3.3 : pas d'auto-react le week-end (v3.6 : ni pendant une fermeture ou ses congés)
    if (weekend.pauseFor(authorId)) return;

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

    // 🏖️ v3.3 : le week-end, une réaction ne fait rien (ni image, ni JP$, ni score)
    //    🌴 v3.6 : pareil pendant une fermeture de l'entreprise ou ses propres congés
    const pause = weekend.pauseFor(reactingUserId);
    if (pause) {
      logger.info(`${pause.icon} Pause (${pause.kind}) : réaction de <@${reactingUserId}> ignorée, prévenu`);
      await notifyReactor(client, channelId, reactingUserId, weekend.reactionText(pause), logger);
      return;
    }

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
        logger.warn('⚠️  Message original introuvable → aucun JP$');
        return;
      }
      originalAuthorId = result.messages[0].user || null;
    } catch (historyError) {
      const reason = historyError.data ? historyError.data.error : historyError.message;
      logger.warn(`🚫 Bot absent de la conversation (${reason}) → aucun JP$ pour <@${reactingUserId}>`);
      return;
    }

    // 🔒 Anti-farm : réagir à SON PROPRE message ne compte pas.
    //    (Sinon on pourrait farmer des crédits en s'auto-réagissant dans un
    //     channel où le bot est présent.) Aucun crédit, aucun score, aucune image.
    if (originalAuthorId && originalAuthorId === reactingUserId) {
      logger.info(`🚫 <@${reactingUserId}> a réagi à son propre message → ignoré (anti-farm)`);
      return;
    }

    // 📮 Liste de diffusion (OPT-IN) : une réaction ne compte que sur le message
    //    d'une personne inscrite via /jeanpip (ni crédit, ni score, ni compteur
    //    anti-farm sinon). v3.6 : l'auteur ne reçoit plus d'image, la règle reste.
    //    🚜 v3.0.2 : un auteur sous pénalité anti-farm ne reçoit rien non plus → même règle.
    //    🔕 v3.0.3 : dans ces deux cas le réacteur ne reçoit RIEN non plus (avant : une
    //    image qui n'entrait pas au classeur) ; il est prévenu, en éphémère dans le canal.
    const authorPenalized = Boolean(originalAuthorId) && getFarmPenaltyRemaining(originalAuthorId) > 0;
    const delivers = broadcast.isSubscribed(originalAuthorId) && !authorPenalized;
    if (!delivers) {
      const why = authorPenalized
        ? `🚜 <@${originalAuthorId}> est en pénalité anti-farm (encore ${formatRemaining(getFarmPenaltyRemaining(originalAuthorId))}) : cette personne ne peut rien recevoir pour le moment. Ta réaction ne compte pas : tu ne reçois rien.`
        : `📮 <@${originalAuthorId}> n'est pas dans la liste de diffusion Jeanpip : ta réaction sur ses messages ne compte pas et tu ne reçois rien. Cette personne peut s'inscrire avec \`/jeanpip\`.`;
      logger.info(`${authorPenalized ? '🚜' : '📮'} <@${originalAuthorId}> ne reçoit pas de Jeanpip (${authorPenalized ? 'pénalité anti-farm' : 'hors liste de diffusion'}) → rien pour <@${reactingUserId}>, prévenu`);
      await notifyReactor(client, channelId, reactingUserId, why, logger);
      return;
    }

    // 🌴 v3.6 : réagir au message de quelqu'un en congés ne compte pas (on le laisse tranquille)
    const authorLeave = leave.activeLeave(originalAuthorId);
    if (authorLeave) {
      logger.info(`🌴 <@${originalAuthorId}> en congés → rien pour <@${reactingUserId}>, prévenu`);
      await notifyReactor(client, channelId, reactingUserId, `🌴 <@${originalAuthorId}> est en congés jusqu'au ${weekend.longDay(authorLeave.end)} inclus : ta réaction ne compte pas et tu ne reçois rien. On le laisse se reposer 😉`, logger);
      return;
    }

    // 🎯 v3.6 : limite de Jeanpips par jour atteinte → plus rien jusqu'à demain (ni image, ni JP$, ni point)
    const dailyLimit = settings.getDailyJeanpipLimit();
    if (dailyJeanpips.countToday(reactingUserId) >= dailyLimit) {
      logger.info(`🎯 <@${reactingUserId}> a déjà ses ${dailyLimit} Jeanpips du jour → rien, prévenu`);
      await notifyReactor(client, channelId, reactingUserId, `🎯 Tu as posé tes *${dailyLimit} Jeanpips du jour* : ta réaction ne compte plus et ne rapporte rien jusqu'à demain. Reviens demain 😉`, logger);
      return;
    }

    // ✅ Bot présent + message d'autrui + destinataire inscrit → le Jeanpip compte.

    // 🚜 Anti-farm : plus de N Jeanpips en 1 h (réglable) → pénalité de 1 h.
    //    On ne compte que les Jeanpips réellement délivrés.
    let farmBlocked = getFarmPenaltyRemaining(reactingUserId) > 0;

    if (!farmBlocked && recordJeanpipForFarm(reactingUserId)) {
      farmBlocked = true;
      logger.warn(`🚜 ANTI-FARM : <@${reactingUserId}> dépasse ${farmMaxPerHour()} Jeanpips/h → pénalité 1 h`);
      await safeSendDM(client, reactingUserId, {
        text: `🚜 Alerte anti-farm : tu es bridé pendant 1 heure.`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `🚜 *ALERTE ANTI-FARM !* :${TARGET_EMOJI}:\n\nTu as posé *plus de ${farmMaxPerHour()} Jeanpips en moins d'une heure*.\n\n*Pendant 1 heure :*\n• ❌ Tes Jeanpips n'envoient plus rien aux autres\n• ❌ Tu ne reçois plus *aucune image* (ni la tienne, ni celles des autres)\n• ❌ Tu n'accumules plus de JP$\n• ✅ Tu peux toujours *ouvrir tes boosters*\n\n_Lève le pied, ça revient tout seul dans 1 h._ 😉`,
            },
          },
        ],
      }, logger);

      // ⏰ Prévenir la personne dès que son accès est rétabli (dans 1 h)
      scheduleFarmRelease(client, reactingUserId, logger);
      refreshHomeIfSeen(client, reactingUserId, logger); // quota → pénalité
    }

    if (farmBlocked) {
      const remaining = getFarmPenaltyRemaining(reactingUserId);
      logger.info(`🚜 <@${reactingUserId}> sous pénalité anti-farm (${formatRemaining(remaining)} restantes) → ni JP$ ni envoi aux autres`);
    }

    // 📊 Score / crédits : hors pénalité anti-farm (le destinataire est inscrit, vérifié plus haut).
    let justUnlocked = false;
    if (!farmBlocked) {
      const result = scores.incrementScore(reactingUserId);
      justUnlocked = result.justUnlocked;
      dailyJeanpips.recordToday(reactingUserId);   // 🎯 v3.6 : un Jeanpip du jour de plus
      logger.info(`📊 Score de <@${reactingUserId}> : ${result.score}`);

      // 📈 Compteur durable pour le classement JeanPip du dashboard (all-time + semaine)
      scores.recordHit(reactingUserId);

      // 💰 +N crédit(s) permanent(s) (porte-monnaie booster, N réglable : src/settings.js). Spam déjà exclu ci-dessus,
      //    et présence du bot dans la conversation vérifiée juste au-dessus.
      //    Seule TA réaction crédite : l'attaque et l'auto-react ne créditent pas.
      const newBalance = credits.addCredit(reactingUserId, settings.getCreditsPerJeanpip(), { source: 'reaction', ref: channelId });
      events.record('reaction', reactingUserId, { channel: channelId });
      logger.info(`💰 JP$ de <@${reactingUserId}> : ${newBalance}`);
      refreshHomeIfSeen(client, reactingUserId, logger);
    }

    // 🎉 Notification : Raid gratuit débloqué (v3.6 : 65 Jeanpips dans la semaine)
    if (justUnlocked) {
      await safeSendDM(client, reactingUserId, {
        text: `🎉 Tu as débloqué un Raid gratuit !`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `🎉 *Tu as débloqué un Raid gratuit !* :${TARGET_EMOJI}:\n\nTu as envoyé *${scores.ATTACK_THRESHOLD} Jeanpips* cette semaine, bravo !\n\n*Comment le lancer :*\nClique sur ⚔️ dans l'onglet *Accueil* du bot (ou tape \`/jeanpip-attack\`), choisis jusqu'à ${raid.BASE_TARGETS} cibles et ton style secret. Celles qui ne devinent pas ta tactique te donnent une carte !\n\n⚠️ _Les raids se lancent ${raid.OPEN.text}. Ton raid gratuit est perdu dimanche à 20h s'il n'a pas servi._`,
            },
          },
        ],
      }, logger);
      logger.info(`🎉 Notification déblocage envoyée à <@${reactingUserId}>`);
    }

    const reactorInfo = await client.users.info({ user: reactingUserId });
    const reactorName = reactorInfo.user.real_name || reactorInfo.user.name;

    const mediaForReactor = await getRandomMedia();

    // 🗂️ Toute image reçue entre au classeur (v3.0.3). Sous pénalité anti-farm,
    //    sendJeanpipDM n'envoie rien du tout.
    const sentToReactor = await sendJeanpipDM(client, reactingUserId, {
      text: `Hey @${reactorName} tu as réagi avec jean pip coucou !`,
      headerText: `Hey <@${reactingUserId}> tu as réagi avec jean pip coucou :${TARGET_EMOJI}:`,
      media: mediaForReactor,
    }, logger);
    if (sentToReactor) logger.info(`📨 DM envoyé au réacteur <@${reactingUserId}>`);

    // 🔕 v3.6 : une réaction n'envoie plus d'image à l'auteur du message, seul le réacteur reçoit.

    logger.info('✅ Flow terminé avec succès');
  } catch (error) {
    logger.error('❌ Erreur dans reaction_added:', error);
  }
});

// ─────────────────────────────────────────────
// ⚔️ RAID (v3.4) — remplace l'Attaque Jeanpip (src/raid.js)
//    Modale (cibles + style secret) → alerte en DM aux victimes avec
//    3 boutons de défense → 20 min plus tard (ou dès que toutes ont
//    répondu), cartes échangées et résultats en DM, tous en même temps.
// ─────────────────────────────────────────────
const RAID_TARGET_TEXT = {
  self: 'toi-même',
  bot: 'un bot',
  unsubscribed: 'pas inscrit(e) à la liste de diffusion',
  leave: 'en congés 🌴',
  busy: 'subit déjà un raid',
  limit: `a déjà subi ${raid.MAX_RECEIVED_PER_DAY} raids aujourd'hui`,
};
const raidStyle = (key) => `${raid.STYLES[key].emoji} ${raid.STYLES[key].label}`;
const raidDefense = (key) => `${raid.DEFENSES[key].emoji} ${raid.DEFENSES[key].label}`;
const cardText = (c) => `${(RARITIES[c.rarity] || RARITIES.common).emoji} *${c.title}*`;

/** Nom affichable d'un user (erreurs de modale, en texte brut). */
async function userName(client, userId) {
  try {
    const info = await client.users.info({ user: userId });
    return info.user.real_name || info.user.name || userId;
  } catch {
    return userId;
  }
}

/** Ouvre la modale du raid (Accueil ou /jeanpip-attack). */
function openRaidModal(client, triggerId, userId, logger) {
  return openModal(client, { trigger_id: triggerId }, home.buildRaidModal(userId), logger);
}

app.command('/jeanpip-attack', async ({ command, ack, client, logger }) => {
  await ack();
  await openRaidModal(client, command.trigger_id, command.user_id, logger);
});

app.action('home_attack_open', async ({ ack, body, client, logger }) => {
  await ack();
  await openRaidModal(client, body.trigger_id, body.user.id, logger);
});

// Vieux DM « Lancer l'attaque (25 JP$) » d'avant la v3.4 : l'Attaque est devenue le Raid
app.action('buy_attack', async ({ ack, body, client, logger }) => {
  await ack();
  const text = '⚔️ *L\'Attaque Jeanpip est devenue le Raid !* Lance-le depuis l\'onglet *Accueil* du bot (ou `/jeanpip-attack`).';
  await safeSendDM(client, body.user.id, { text: plain(text), blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] }, logger)
    .catch((e) => logger.error('❌ DM ancienne attaque :', e.message));
});

/** Alerte envoyée à chaque victime. */
function buildRaidAlert(r) {
  const text = `🚨 *RAID EN COURS !* <@${r.attacker}> te raide.\nDevine son style d'attaque pour te défendre, avant *${parisTime(r.endsAt)}* :\n${home.RAID_RULES}\n\n✅ Ta défense bat son style : *riposte*, tu lui prends une carte.\n🤝 Elle tient : rien ne se passe.\n❌ Elle cède, ou pas de réponse : il te prend une carte (jamais une légendaire).\n_Un seul clic. Résultat à la fin du raid, pour tout le monde en même temps._`;
  return { text: `🚨 Raid en cours : réponds avant ${parisTime(r.endsAt)} !`, blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }, home.raidDefenseButtons(r.id)] };
}

/** Message d'alerte une fois la défense choisie (plus de boutons). */
function buildRaidAnswered(r, defense) {
  const text = `🚨 *Raid de <@${r.attacker}>* : ${raidDefense(defense)} enregistré. Résultat à la fin du raid, au plus tard à ${parisTime(r.endsAt)}. 🤫`;
  return { text: plain(text), blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] };
}

app.view('raid_submit', async ({ ack, body, view, client, logger }) => {
  const attacker = body.user.id;
  const values = view.state.values;
  const targets = [...new Set((values.targets.value.selected_users || []))];
  const style = values.style.value.selected_option && values.style.value.selected_option.value;

  const block = raid.launchBlock(Date.now(), attacker);
  if (block === 'weekend') {
    const p = weekend.pauseFor(attacker);
    return ack(fieldError('targets', `${p.icon} Pas de raid ${p.short} : ça reprend ${p.back}.`));
  }
  if (block) return ack(fieldError('targets', `⏰ Les raids se lancent ${raid.OPEN.text}.`));
  if (getFarmPenaltyRemaining(attacker) > 0) return ack(fieldError('targets', `🚜 Pénalité anti-farm : réessaie dans ${formatRemaining(getFarmPenaltyRemaining(attacker))}.`));
  if (!targets.length) return ack(fieldError('targets', 'Choisis au moins une cible.'));
  if (targets.length > raid.MAX_TARGETS) return ack(fieldError('targets', `${raid.MAX_TARGETS} cibles au maximum.`));
  if (!raid.STYLES[style]) return ack(fieldError('style', 'Choisis ton style d\'attaque.'));

  // Cibles refusées (en parallèle : la modale doit répondre en moins de 3 s)
  const bots = await Promise.all(targets.map((t) => isBot(client, t)));
  // 🚜 v3.6 : une cible en pénalité anti-farm peut être raidée (décision de Paul le 2026-10-21)
  const problemOf = (t, i) => (t === attacker ? 'self'
    : bots[i] ? 'bot'
      : !broadcast.isSubscribed(t) ? 'unsubscribed'
        : raid.targetProblem(attacker, t));
  let refused = targets.map((t, i) => [t, problemOf(t, i)]).filter(([, p]) => p);
  if (refused.length) {
    const names = await Promise.all(refused.map(([t, p]) => userName(client, t).then((n) => `${n} (${RAID_TARGET_TEXT[p]})`)));
    return ack(fieldError('targets', `Impossible de raider : ${names.join(', ')}.`));
  }

  // 🔒 Plus aucun await jusqu'à l'enregistrement : re-vérification, paiement et création d'un bloc
  if (raid.activeRaidOf(attacker)) return ack(fieldError('targets', 'Tu as déjà un raid en cours.'));
  refused = targets.filter((t) => raid.targetProblem(attacker, t));
  if (refused.length) return ack(fieldError('targets', 'Une de tes cibles vient d\'être raidée par quelqu\'un d\'autre : change ta sélection.'));
  const free = scores.hasAttack(attacker);
  const price = raid.cost(targets.length, free);
  if (price > 0 && !credits.spend(attacker, price, { source: 'raid', item: `${targets.length} cibles` })) {
    return ack(fieldError('targets', `Il te faut ${price} JP$ (ton solde : ${formatCredits(credits.getBalance(attacker))} JP$).`));
  }
  if (free) scores.consumeAttack(attacker);
  const r = raid.create({ attacker, targets, style, price, free });
  events.record('raid_launched', attacker, { raidId: r.id, targets, style, price, free });
  await ack();
  logger.info(`⚔️ Raid ${r.id} lancé par <@${attacker}> (${style}) sur ${targets.map((t) => `<@${t}>`).join(', ')} · ${free ? 'gratuit' : ''}${price ? ` ${price} JP$` : ''}`);

  try {
    for (const t of targets) {
      try {
        const ref = await sendDM(client, t, buildRaidAlert(r));
        raid.setDm(r.id, t, ref);
      } catch (error) {
        logger.error(`❌ Alerte de raid à <@${t}> :`, error.message);
      }
    }
    const paid = [free ? '🎉 raid gratuit utilisé' : null, price ? `💰 ${price} JP$ débités` : null].filter(Boolean).join(' + ');
    const text = `⚔️ *Raid lancé* en ${raidStyle(style)} sur ${targets.map((t) => `<@${t}>`).join(', ')}.\n${paid}.\n\nChaque cible a jusqu'à *${parisTime(r.endsAt)}* pour se défendre. Tu reçois le récap à la fin du raid.`;
    const ref = await sendDM(client, attacker, { text: plain(text), blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] });
    raid.setDm(r.id, null, ref);
  } catch (error) {
    logger.error('❌ Erreur dans raid_submit:', error);
  }
  await Promise.all([attacker, ...targets].map((u) => refreshHomeIfSeen(client, u, logger)));
});

// 🛡️ Une victime choisit sa défense (DM d'alerte ou Accueil)
app.action(/^raid_defend_(bouclier|piege|esquive)$/, async ({ ack, body, action, client, logger }) => {
  await ack();
  const userId = body.user.id;
  const defense = action.action_id.replace('raid_defend_', '');
  const res = raid.defend(action.value, userId, defense);
  const inDm = body.channel && body.message;
  try {
    if (res.status === 'ok' || res.status === 'already') {
      const t = res.raid.targets.find((x) => x.userId === userId);
      if (inDm) await client.chat.update({ channel: body.channel.id, ts: body.message.ts, ...buildRaidAnswered(res.raid, t.defense) });
      else if (t.dm) await client.chat.update({ channel: t.dm.channel, ts: t.dm.ts, ...buildRaidAnswered(res.raid, t.defense) }).catch(() => {});
      if (res.status === 'ok') logger.info(`🛡️ Raid ${res.raid.id} : <@${userId}> joue ${defense}`);
    } else if (res.status === 'over' && inDm) {
      await client.chat.update({ channel: body.channel.id, ts: body.message.ts, text: 'Raid terminé', blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '⌛ *Ce raid est terminé.* Ton résultat t\'a été envoyé.' } }] });
    }
  } catch (error) {
    logger.error('❌ Erreur dans raid_defend:', error);
  }
  await refreshHomeIfSeen(client, userId, logger);
  if (res.status === 'ok' && res.allAnswered) await finishRaid(client, res.raid.id, logger);
  else if (res.status === 'ok') await refreshHomeIfSeen(client, res.raid.attacker, logger);   // « 2/5 défenses reçues »
});

/** Résultat d'une victime (DM de fin). */
function victimResultText(r, t) {
  const by = `<@${r.attacker}> attaquait en ${raidStyle(r.style)}`;
  const mine = t.defense ? `ton ${raidDefense(t.defense)}` : null;
  if (t.outcome === 'riposte') {
    return `✅ *Riposte réussie !* ${by}, ${mine} l'a renvoyé.\n${t.card ? `Tu lui prends ${cardText(t.card)} 🎁` : 'Il n\'avait aucune carte prenable : tu ne gagnes rien, mais l\'honneur est sauf.'}`;
  }
  if (t.outcome === 'repousse') return `🤝 *Raid repoussé.* ${by}, ${mine} a tenu. Rien ne bouge.`;
  const head = t.defense ? `❌ *Tu es tombé(e).* ${by}, ${mine} a cédé.` : `❌ *Pas de réponse à temps.* ${by}.`;
  return `${head}\n${t.card ? `Il te prend ${cardText(t.card)}.` : 'Tu n\'avais aucune carte prenable : tu ne perds rien.'}`;
}

const OUTCOME_LABEL = { tombe: '❌ tombé(e)', repousse: '🤝 repoussé', riposte: '✅ riposte' };

/** Termine un raid : cartes échangées, résultats en DM à tous en même temps. */
async function finishRaid(client, raidId, logger) {
  const res = raid.resolve(raidId);
  if (res.status !== 'resolved') return;
  const r = res.raid;
  const count = (o) => r.targets.filter((t) => t.outcome === o).length;
  events.record('raid_resolved', r.attacker, {
    raidId: r.id, style: r.style,
    targets: r.targets.map((t) => ({ userId: t.userId, defense: t.defense, outcome: t.outcome, card: t.card && { url: t.card.url, title: t.card.title, rarity: t.card.rarity } })),
  });
  logger.info(`⚔️ Raid ${r.id} terminé : ${count('tombe')} tombé(s), ${count('repousse')} repoussé(s), ${count('riposte')} riposte(s)`);

  // Raid fini pendant une coupure, rattrapé un week-end : cartes échangées, mais pas de DM
  if (!weekendMuted(logger, `résultats du raid ${r.id}`)) {
    for (const t of r.targets) {
      const text = victimResultText(r, t);
      try {
        if (t.dm) await client.chat.update({ channel: t.dm.channel, ts: t.dm.ts, text: 'Raid terminé', blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `⌛ *Raid de <@${r.attacker}> terminé.* Ton résultat est juste en dessous.` } }] }).catch(() => {});
        await sendDM(client, t.userId, { text: plain(text), blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] });
      } catch (error) {
        logger.error(`❌ Résultat de raid à <@${t.userId}> :`, error.message);
      }
    }
    const lines = r.targets.map((t) => `• <@${t.userId}> : ${t.defense ? raidDefense(t.defense) : '_pas de réponse_'} → ${OUTCOME_LABEL[t.outcome]}${t.card ? ` (${t.outcome === 'riposte' ? 'tu perds' : 'tu gagnes'} ${cardText(t.card)})` : ''}`);
    const text = `⚔️ *Raid terminé* (${raidStyle(r.style)}) : ${count('tombe')} tombé(s), ${count('repousse')} repoussé(s), ${count('riposte')} riposte(s).\n`
      + `${res.won.length ? `🎁 Tu gagnes ${res.won.length} carte${res.won.length > 1 ? 's' : ''}` : '🎁 Aucune carte gagnée'}${res.lost.length ? ` · 💔 tu en perds ${res.lost.length}` : ''}.\n\n${lines.join('\n')}`;
    try {
      await sendDM(client, r.attacker, { text: plain(text), blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] });
    } catch (error) {
      logger.error(`❌ Récap de raid à <@${r.attacker}> :`, error.message);
    }
  }
  await Promise.all([r.attacker, ...r.targets.map((t) => t.userId)].map((u) => refreshHomeIfSeen(client, u, logger)));
}

/** Raids arrivés au bout de leurs 20 min (vérifié toutes les 10 s, et au démarrage). */
async function finishDueRaids(client, logger) {
  for (const r of raid.dueRaids()) await finishRaid(client, r.id, logger);
}
const RAID_CHECK_MS = 10 * 1000;

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

// 🏖️ v3.3 : un cadeau admin notifie le joueur → pas le week-end
const WEEKEND_GIFT_TEXT = '🏖️ Jeanpip est en pause (week-end ou fermeture de l\'entreprise) : pas de cadeau (il notifierait la personne). Réessaie à la reprise.';

/** Slash command admin de cadeau tentée le week-end → DM à l'admin, true = arrêter. */
async function weekendGiftRefused(client, adminId, logger) {
  if (!weekend.isPaused()) return false;
  await sendAdminResult(client, adminId, { text: WEEKEND_GIFT_TEXT }, logger);
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
//    Offre un Raid gratuit à quelqu'un et le notifie
//    (aussi disponible dans le panneau 👑 Admin de l'Accueil)
// ─────────────────────────────────────────────
app.command('/jeanpip-give', async ({ command, ack, client, logger }) => {
  await ack();

  const adminId = command.user_id;

  try {
    if (await rejectNonAdmin(client, adminId, logger, '/jeanpip-give')) return;
    if (await weekendGiftRefused(client, adminId, logger)) return;

    const targetId = parseUserId(command.text);
    if (!targetId) {
      await safeSendDM(client, adminId, {
        text: `❓ Usage : /jeanpip-give @utilisateur`,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `❓ *Usage :* \`/jeanpip-give @utilisateur\`\nMentionne la personne à qui tu veux offrir un Raid gratuit.` } }],
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
    if (await weekendGiftRefused(client, adminId, logger)) return;

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
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `❓ *Usage :* \`/jeanpip-give-credits @utilisateur <montant>\`\nEx : \`/jeanpip-give-credits @paul 50\` pour ajouter, \`/jeanpip-give-credits @paul -20\` pour retirer.\nLe montant doit être non nul (demi-JP$ acceptés, ex. \`2,5\`).` } }],
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
// 🖼️ Slash command : /jeanpip-addmedia <url> <rareté> [@auteur] [titre]  (admin)
//    Ajoute un média à la banque (persistant, sans redémarrage).
//    @auteur = qui a fourni le média → crédité selon la rareté (AUTHOR_REWARDS).
// ─────────────────────────────────────────────
app.command('/jeanpip-addmedia', async ({ command, ack, client, logger }) => {
  await ack();

  const adminId = command.user_id;

  try {
    if (await rejectNonAdmin(client, adminId, logger, '/jeanpip-addmedia')) return;

    const parts = (command.text || '').trim().split(/\s+/).filter(Boolean);
    const url = parts[0];
    const rarity = normalizeRarity(parts[1]);
    // @auteur optionnel, juste après la rareté (mention <@U…|nom>)
    const authorId = parts[2] && /^<@[A-Z0-9]+(?:\|[^>]+)?>$/i.test(parts[2]) ? parseUserId(parts[2]) : null;
    const title = parts.slice(authorId ? 3 : 2).join(' ');

    const usageBlocks = [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `❓ *Usage :* \`/jeanpip-addmedia <lien> <rareté> [@auteur] [titre optionnel]\`\n\n*Raretés acceptées :* \`commun\` ⚪ · \`rare\` 🔵 · \`epique\` 🟣 · \`legendaire\` 🟡\n\n*@auteur* (optionnel) : la personne qui t'a envoyé le média gagne ${AUTHOR_REWARDS.common} ⚪ · ${AUTHOR_REWARDS.rare} 🔵 · ${AUTHOR_REWARDS.epic} 🟣 · ${AUTHOR_REWARDS.legendary} 🟡 JP$ selon la rareté.\n\nEx : \`/jeanpip-addmedia https://media.giphy.com/media/xxx/giphy.gif rare @paul Super Jeanpip\``,
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
    if (authorId && await isBot(client, authorId)) {
      await safeSendDM(client, adminId, { text: `🤖 Impossible d'attribuer un média à un bot.`, blocks: usageBlocks }, logger);
      return;
    }

    const result = adminActions.addMediaToBank(adminId, { url, rarity, title, authorId }, logger);
    if (result.ok) createCardLook(client, result.media, logger);
    await sendAdminResult(client, adminId, result, logger);
    if (result.ok && authorId) {
      await adminActions.notifyMediaAuthor(client, result, logger);
      await refreshHomeIfSeen(client, authorId, logger);
    }
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
      text: `💰 Tu as ${balance} JP$`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `💰 *Tu as ${balance} JP$ !*\n\nTu gagnes *+${creditsPerJeanpipLabel()} JP$* à chaque fois que tu poses une réaction :${TARGET_EMOJI}: sur un message.\n\n🎁 Dépense-les en boosters avec \`/jeanpip-booster\`\n⚔️ ou lance un Raid Jeanpip (*${raid.PRICE}* JP$) depuis l'Accueil ou avec \`/jeanpip-attack\` !`,
          },
        },
      ],
    }, logger);
    logger.info(`💰 /jeanpip-credits : <@${userId}> a ${balance} JP$`);
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

    // 🙈 v3.2 : pas de booster à stock (Octobre Rose) ici : un DM reste cliquable des
    //    jours entiers, son bouton n'apparaît que dans l'Accueil, quand il est achetable.
    const shop = boosters.listBoosters().filter((b) => !b.dailyStock);
    const seasonal = boosters.listBoosters().find((b) => b.dailyStock);
    const buttons = shop.map((b) => ({
      type: 'button',
      text: { type: 'plain_text', text: boosters.buttonLabel(b) },
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
            text: `💰 Ton solde : *${balance}* JP$\n\nChaque booster contient *8 cartes*. Plus le booster est cher, plus tes chances de tomber sur du 🔵 rare, 🟣 épique ou 🟡 légendaire sont élevées !`,
          },
        },
        { type: 'actions', elements: buttons },
        { type: 'context', elements: [{ type: 'mrkdwn', text: shop.map((b) => `${b.emoji} ${b.label} · ${b.price} JP$`).join('   ') }] },
        ...(seasonal ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: `${seasonal.emoji} *Booster ${seasonal.label}* (${seasonal.price} JP$) : uniquement dans l'onglet *Accueil* du bot. Son bouton y apparaît à l'arrivée des boosters du jour, ${octobreRose.DROP_WINDOW.text}.` }] }] : []),
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
const parisClock = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** Heure de Paris « 9h42 ». */
const parisTime = (ms) => parisClock.format(new Date(ms)).replace(':', 'h');

/**
 * 📨 DM « booster prêt à ouvrir » (achat ou cadeau admin) : boutons d'ouverture
 * Slack / animée. `headline` = 1re ligne en mrkdwn. Mémorise le message (ouverture web).
 */
async function sendBoosterDM(client, userId, id, booster, headline) {
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
        text: `${headline}\n\nClique pour révéler tes 8 cartes 👇`,
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

  const sent = await sendDM(client, userId, { text: plain(headline), blocks });
  boosters.setMessageRef(id, sent.channel, sent.ts);
}

// 🙈 v3.2 : le bouton du booster à stock est caché tant que le stock du jour n'est
//    pas arrivé. Vérifié toutes les 2 s ; à l'arrivée, tous les Accueils ouverts
//    sont republiés d'un coup. Au démarrage, la journée en cours compte comme vue.
const BOOSTER_DROP_CHECK_MS = 2000;
let lastDropDay = (() => {
  const now = Date.now();
  const seasonal = boosters.listBoosters(now).find((b) => b.dailyStock);
  return seasonal && octobreRose.hasDropped(now) ? octobreRose.parisDay(now) : null;
})();

async function checkBoosterDrop(client, logger) {
  const now = Date.now();
  const day = octobreRose.parisDay(now);
  if (lastDropDay === day || !octobreRose.hasDropped(now)) return;
  lastDropDay = day;
  const seasonal = boosters.listBoosters(now).find((b) => b.dailyStock);
  const block = seasonal ? boosters.purchaseBlock(seasonal, now) : 'closed';
  if (block === 'closed' || block === 'weekend') return;
  logger.info(`🎀 Stock du jour arrivé (${seasonal.label}) : ${homeViewers.size} Accueil(s) republié(s)`);
  await refreshAllHomes(client, logger);
}

/** 🤖 v3.2 : DM aux admins quand l'anti-spam repère des clics automatiques. */
function alertAdminsAutoClick(client, userId, booster, verdict, logger) {
  if (weekendMuted(logger, `alerte clics automatiques (<@${userId}>)`)) return;
  const gaps = verdict.gaps.map((g) => `${(g / 1000).toFixed(2)} s`).join(' · ');
  const text = `🤖 *Clics automatiques détectés* : <@${userId}> sur le Booster ${booster.emoji} ${booster.label}.\n\n`
    + `Écarts entre ses ${verdict.gaps.length + 1} derniers clics : ${gaps}\n`
    + `Bouton bloqué *${verdict.minutes} min* (jusqu'à ${parisTime(verdict.until)}).\n\n`
    + `_Pour aller plus loin : panneau 👑 Admin → 🚫 Sanction booster._`;
  for (const adminId of JEANPIP_ADMINS) {
    safeSendDM(client, adminId, { text: plain(text), blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] }, logger)
      .catch((e) => logger.error('❌ Alerte admin clics automatiques :', e.message));
  }
}

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

    // 🙈 v3.2 : booster à stock = depuis l'Accueil seulement (un vieux DM boutique
    //    garde son bouton, toujours cliquable, même quand l'Accueil le cache)
    if (booster.dailyStock && !(body.view && body.view.type === 'home')) {
      const text = `${booster.emoji} *Le Booster ${booster.label} s'achète uniquement depuis l'onglet Accueil du bot.* Son bouton y apparaît à l'arrivée des boosters du jour, ${octobreRose.DROP_WINDOW.text}.`;
      sendDM(client, userId, { text: plain(text), blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `${text}\n\n_Aucun JP$ n'a été débité._` } }] })
        .catch((e) => logger.error('❌ DM booster hors Accueil :', e.message));
      logger.info(`🚫 Achat refusé (hors Accueil) : <@${userId}> ${type}`);
      return;
    }

    // 🚦 v3.0.3 : booster à stock du jour (Octobre Rose) → anti-spam (src/boosterSpam.js) :
    //    un clic traité toutes les 3 s ; une rafale bloque le bouton 2 min, puis 5, 10…
    if (booster.dailyStock) {
      const verdict = boosterSpam.click(userId, Date.now());
      // 🔎 v3.2 : chaque clic est gardé en base (les logs systemd tournent en quelques jours)
      const block = verdict.action === 'process' ? boosters.purchaseBlock(booster, Date.now(), userId) : null;
      events.record('booster_click', userId, { boosterType: type, verdict: verdict.action, reason: verdict.reason || block || null });
      if (verdict.action === 'ignore') {
        logger.info(`🚦 Clic booster ${type} ignoré (${verdict.reason}) : <@${userId}>`);
        return;
      }
      if (verdict.action === 'lock') {
        const until = parisTime(verdict.until);
        const bot = verdict.reason === 'bot';
        const text = bot
          ? `🤖 Clics automatiques détectés sur le Booster ${booster.label} : ton bouton est bloqué ${verdict.minutes} min.`
          : `🚫 Clics en rafale sur le Booster ${booster.label} : ton bouton est bloqué ${verdict.minutes} min.`;
        logger.warn(`🚦 ${bot ? 'CLIC AUTOMATIQUE' : 'SPAM'} booster ${type} : <@${userId}> bloqué ${verdict.minutes} min (jusqu'à ${until})${bot ? ` · écarts ${verdict.gaps.map((g) => (g / 1000).toFixed(2)).join(' / ')} s` : ''}`);
        sendDM(client, userId, {
          text,
          blocks: [{ type: 'section', text: { type: 'mrkdwn', text: bot
            ? `🤖 *Clics automatiques détectés* sur le Booster ${booster.emoji} ${booster.label} : tes clics arrivent à intervalles parfaitement réguliers, ce qu'une main ne fait pas.\n\nTon bouton est *bloqué ${verdict.minutes} min*, jusqu'à *${until}*, et les admins sont prévenus. Les auto-clickers et scripts sont interdits : ils peuvent coûter une interdiction de booster.\n\n_Aucun JP$ n'a été débité._`
            : `🚫 *Doucement !* Tu as cliqué en rafale sur le Booster ${booster.emoji} ${booster.label}.\n\nTon bouton est *bloqué ${verdict.minutes} min*, jusqu'à *${until}*. Si tu recommences, ce sera *${verdict.nextMinutes} min*, et ainsi de suite.\n\n_Un seul clic suffit : le premier arrivé est servi. Aucun JP$ n'a été débité._` } }],
        }).catch((e) => logger.error('❌ DM anti-spam booster :', e.message));
        if (bot) alertAdminsAutoClick(client, userId, booster, verdict, logger);
        refreshHomeIfSeen(client, userId, logger);
        // ⏰ À la fin du blocage, l'Accueil réaffiche le bouton
        const timer = setTimeout(() => refreshHomeIfSeen(client, userId, logger), verdict.until - Date.now() + 1000);
        if (typeof timer.unref === 'function') timer.unref();
        return;
      }
    }

    // 🎀 Booster saisonnier : hors saison, stock du jour pas encore arrivé
    //    ou épuisé → rien n'est débité.
    //    ⚠️ Aucun await entre ce contrôle et createPending() : deux clics
    //    simultanés ne peuvent pas dépasser le stock.
    const blocked = boosters.purchaseBlock(booster, Date.now(), userId);
    if (blocked) {
      const ban = blocked === 'banned' ? boosterBans.activeBan(userId, booster.type) : null;
      const why = ban
        ? `🚫 *Tu ne peux pas acheter de Booster ${booster.emoji} ${booster.label} jusqu'au ${home.banEndText(ban.until)}* (sanction d'un admin${ban.reason ? ` : ${ban.reason}` : ''}).`
        : blocked === 'weekend'
        ? (() => {
          const p = weekend.pauseFor(userId);
          return `${p.icon} *Pas de Booster ${booster.emoji} ${booster.label} ${p.short} !* Jeanpip est en pause ${p.until}.${booster.dailyStock && p.kind === 'weekend' ? ` ${boosters.restockText()}` : ''}`;
        })()
        : blocked === 'user_limit'
        ? `🎀 *Tu as déjà eu ton Booster ${booster.emoji} ${booster.label} aujourd'hui !* C'est ${booster.dailyPerUser} par personne et par jour, pour en laisser aux autres. Reviens ${boosters.restockText().includes('lundi') ? 'lundi' : 'demain'} 😉`
        : blocked === 'not_yet'
        ? `⏳ *Pas encore de Booster ${booster.emoji} ${booster.label} aujourd'hui !* ${boosters.DROP_TEXT} Reviens un peu plus tard 😉`
        : blocked === 'sold_out'
        ? `😢 *Plus de Booster ${booster.emoji} ${booster.label} aujourd'hui !* Les ${booster.dailyStock} du jour sont partis.

${boosters.restockText()} Sois rapide 😉`
        : `⏳ *Le Booster ${booster.emoji} ${booster.label} n'est plus en vente.*`;
      sendDM(client, userId, { text: why, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `${why}

_Aucun JP$ n'a été débité._` } }] })
        .catch((e) => logger.error('❌ DM booster indisponible:', e.message));
      logger.info(`🚫 Achat refusé (${blocked}) : <@${userId}> ${booster.type}`);
      refreshHomeIfSeen(client, userId, logger);
      return;
    }

    // 💸 Débit atomique : spend() re-vérifie le solde et renvoie false si insuffisant
    if (!credits.spend(userId, booster.price, { source: 'booster', item: type })) {
      const balance = credits.getBalance(userId);
      const missing = booster.price - balance;
      await sendDM(client, userId, {
        text: `❌ Il te manque ${missing} JP$`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *Il te manque ${missing} JP$* pour le Booster ${booster.emoji} ${booster.label}.\n\n💰 Ton solde : *${balance}* · Prix : *${booster.price}*\n\nRéagis avec :${TARGET_EMOJI}: pour gagner des JP$ ! 💪`,
            },
          },
        ],
      });
      logger.info(`💸 Achat refusé (solde insuffisant) : <@${userId}> ${booster.type}`);
      return;
    }

    // ✅ Débit OK → on enregistre le booster en attente
    const id = boosters.createPending(userId, type);
    events.record('booster_bought', userId, { boosterId: id, boosterType: type, price: booster.price }, { dedup: `booster_created:${id}` });
    const balance = credits.getBalance(userId);

    await sendBoosterDM(client, userId, id, booster, `${booster.emoji} *Booster ${booster.label} acheté !* 🎉\n\n💰 Nouveau solde : *${balance}* JP$`);
    logger.info(`🛒 <@${userId}> a acheté un booster ${booster.type} (id ${id}, solde ${balance})`);
    // 🙈 v3.2 : dernier booster du jour parti → les Accueils ouverts perdent le bouton
    if (booster.dailyStock && boosters.stockLeft(booster) === 0) await refreshAllHomes(client, logger, userId);
    else await refreshHome(client, userId, logger);
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

    // 🏖️ v3.3 : pas d'ouverture le week-end, le booster attend lundi
    if (result.status === 'weekend') {
      const p = weekend.pauseFor(userId);
      const text = `${p.title}\nPas d'ouverture de booster ${p.short} : le tien t'attend, ouvre-le ${p.back} avec ce même bouton 😉`;
      await sendDM(client, userId, { text: plain(text), blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] });
      logger.info(`🏖️ Ouverture refusée (week-end) : <@${userId}> booster ${id}`);
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

// 📒 Bouton-lien « Mon classeur » de l'Accueil : même principe, rien à faire
app.action('open_collection_web', async ({ ack }) => {
  await ack();
});

// 📊 Bouton-lien « Stats du jeu » (admins) : la page s'ouvre dans le navigateur
app.action('open_stats_web', async ({ ack }) => {
  await ack();
});

// ⚔️ Bouton-lien « Mon deck » de l'Accueil : la page s'ouvre dans le navigateur
app.action('open_deck_web', async ({ ack }) => {
  await ack();
});

// 🎟️ Bouton-lien « Tickets ESSAI ! » de l'Accueil : la page s'ouvre dans le navigateur
app.action('open_tickets_web', async ({ ack }) => {
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

// 📰 Nouveautés : release note du jeu (src/releases.js)
app.action('release_notes_open', async ({ ack, body, client, logger }) => {
  await ack();
  await openModal(client, body, home.buildReleaseNotesModal(), logger);
});

// 🎁 Crédits JeanPip du vendredi : modale « Offrir des crédits »
app.action('weekly_gift_open', async ({ ack, body, client, logger }) => {
  await ack();
  const userId = body.user.id;
  if (weeklyGift.getAllowance(userId) <= 0) {
    await refreshHome(client, userId, logger); // JP$ expirés entre-temps
    return;
  }
  await openModal(client, body, home.buildWeeklyGiftModal(userId), logger);
});

app.view('weekly_gift_submit', async ({ ack, body, view, client, logger }) => {
  const userId = body.user.id;
  const values = view.state.values;
  const targetId = values.user.value.selected_user;
  const amount = Number(values.amount.value.value);

  const result = weeklyGift.give(userId, targetId, amount);
  if (!result.ok) {
    const allowance = weeklyGift.getAllowance(userId);
    return ack({
      soi: fieldError('user', 'Tu ne peux pas te les offrir à toi-même 😉'),
      non_inscrit: fieldError('user', "Cette personne n'est pas inscrite à la liste de diffusion."),
      montant: fieldError('amount', 'Nombre entier de JP$ attendu (au moins 1).'),
      solde: fieldError('amount', allowance > 0 ? `Il ne te reste que ${allowance} JP$ à offrir.` : "Tu n'as plus de JP$ à offrir cette semaine."),
    }[result.error]);
  }

  await ack();
  logger.info(`🎁 <@${userId}> a offert ${amount} JP$ du vendredi à <@${targetId}> (reste ${result.remaining})`);
  try {
    if (!userMuted(targetId, logger, `DM de don à <@${targetId}>`)) await safeSendDM(client, targetId, {
      text: `🎁 <@${userId}> t'a offert ${amount} JP$ !`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `🎁 *<@${userId}> t'a offert ${amount} JP$ !* 💰\n\nNouveau solde : *${formatCredits(result.recipientBalance)}* JP$\n\nDépense-les avec \`/jeanpip-booster\` ou depuis l'onglet *Accueil* du bot ! 🎁` } }],
    }, logger);
  } catch (error) {
    logger.error(`❌ DM de don à <@${targetId}> impossible :`, error.message);
  }
  await refreshHome(client, userId, logger);
  await refreshHomeIfSeen(client, targetId, logger);
});

/** Vendredi 9h : distribue les crédits à offrir et prévient chaque inscrit. */
async function runWeeklyGift(client, logger) {
  const granted = weeklyGift.distributeIfDue(broadcast.getSubscribers());
  if (granted.length === 0) return;
  logger.info(`🎁 JP$ du vendredi : ${weeklyGift.WEEKLY_AMOUNT} à offrir pour ${granted.length} inscrit(s)`);

  const text = `🎁 JeanPip vous donne ${weeklyGift.WEEKLY_AMOUNT} JP$ que vous ne pouvez pas garder pour vous, depuis votre dashboard accordez-les aux personnes de votre choix. Bonne fin de semaine !`;
  // 🏖️ v3.3 : rattrapé au redémarrage un week-end → JP$ versés, mais pas de DM (visibles dans l'Accueil)
  const muted = weekendMuted(logger, `DM du vendredi (${granted.length} inscrit(s))`);
  for (const userId of muted ? [] : granted.filter((u) => !userMuted(u, logger, `DM du vendredi à <@${u}>`))) {
    try {
      await safeSendDM(client, userId, {
        text,
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text } },
          { type: 'context', elements: [{ type: 'mrkdwn', text: `_Onglet *Accueil* du bot → « 🎁 Offrir des JP$ ». Ce qui n'est pas donné est perdu vendredi prochain 9h._` }] },
        ],
      }, logger);
    } catch (error) {
      logger.error(`❌ DM du vendredi à <@${userId}> impossible :`, error.message);
    }
  }
  // 🏠 Accueils déjà ouverts : afficher le nouveau solde à offrir (et masquer l'ancien)
  for (const userId of homeViewers) await refreshHome(client, userId, logger);
}

// ⚔️ Arène depuis Slack : défis, combat rapide, liens de combat, récaps de fin
const arenaHooks = arenaSlack.register(app, {
  sendDM,
  isBot,
  openModal,
  refreshHome: refreshHomeIfSeen,
  homeViewers: () => [...homeViewers],   // 🏆 classement en direct : Accueils à republier en fin de combat
  links: ARENA_LINKS,
});

// 🐛 Bugs signalés : modale joueur, DM admin (Valider / Refuser), suivi « Corrigé » dans l'Accueil
bugsSlack.register(app, {
  admins: JEANPIP_ADMINS,
  isAdmin: (userId) => JEANPIP_ADMINS.includes(userId),
  // 🏖️ v3.3 : le week-end, ni les admins ni le joueur ne sont notifiés (le bug reste listé dans l'Accueil admin)
  sendDM: async (client, userId, msg) => (weekendMuted(console, `DM « bug signalé » à <@${userId}>`) ? null : sendDM(client, userId, msg)),
  openModal,
  refreshHome: refreshHomeIfSeen,
});

// 👑 Boutons du panneau admin → ouverture des modales
const ADMIN_MODALS = {
  admin_give_attack_open: home.buildGiveAttackModal,
  admin_credits_open: home.buildCreditsModal,
  admin_addmedia_open: home.buildAddMediaModal,
  admin_give_card_open: home.buildGiveCardModal,
  admin_give_booster_open: home.buildGiveBoosterModal,
  admin_booster_ban_open: home.buildBoosterBanModal,
  admin_card_type_open: home.buildCardTypeModal,
  admin_removemedia_open: home.buildRemoveMediaModal,
  admin_target_add_open: home.buildAddTargetModal,
  admin_credit_value_open: home.buildCreditValueModal,
  admin_farm_limit_open: home.buildFarmLimitModal,
  admin_tickets_open: home.buildTicketsModal,
  admin_closure_open: home.buildClosureModal,
  admin_resale_cap_open: home.buildResaleCapModal,
  admin_daily_limit_open: home.buildDailyLimitModal,
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
  if (weekend.isPaused()) return ack(fieldError('user', WEEKEND_GIFT_TEXT));

  const targetId = view.state.values.user.value.selected_user;
  if (scores.hasAttack(targetId)) return ack(fieldError('user', 'Cette personne a déjà un Raid gratuit disponible.'));

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
  // 🏖️ v3.3 : un cadeau (montant positif) notifie la personne → pas le week-end ; une correction reste possible
  if (amount > 0 && weekend.isPaused()) return ack(fieldError('amount', WEEKEND_GIFT_TEXT));

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
  const authorId = (values.author && values.author.value.selected_user) || null;
  const arch = values.arch && values.arch.value.selected_option ? values.arch.value.selected_option.value : null;

  if (!/^https?:\/\//i.test(url)) return ack(fieldError('url', 'Le lien doit commencer par http:// ou https://.'));
  if (!rarity) return ack(fieldError('rarity', 'Choisis une rareté.'));
  if (authorId && await isBot(client, authorId)) return ack(fieldError('author', 'Impossible d\'attribuer un média à un bot.'));

  // ⚔️ Type en Arène choisi : imposé avant l'ajout (le DM de confirmation montre le bon personnage)
  if (arch) cards.setArchetype(url, arch);
  const result = adminActions.addMediaToBank(adminId, { url, rarity, title, authorId }, logger);
  if (!result.ok) return ack(fieldError('url', plain(result.text.split('\n')[1] || result.text)));
  createCardLook(client, result.media, logger);

  await ack();
  try {
    // Confirmation + aperçu en DM (l'admin vérifie que le lien s'affiche bien)
    await sendAdminResult(client, adminId, result, logger);
    if (authorId) {
      await adminActions.notifyMediaAuthor(client, result, logger);
      await refreshHomeIfSeen(client, authorId, logger);
    }
  } catch (error) {
    logger.error('❌ Erreur dans admin_addmedia_submit:', error);
  }
});

// ⚔️ Modale « Type de carte » : impose (ou rend automatique) le type d'une carte dans l'Arène
app.view('admin_card_type_submit', async ({ ack, body, view, client, logger }) => {
  const adminId = body.user.id;
  if (!isAdminUser(adminId, logger, 'admin_card_type_submit')) return ack(fieldError('card', 'Réservé aux admins.'));

  const values = view.state.values;
  const card = home.cardFromValue(values.card.value.selected_option && values.card.value.selected_option.value);
  const choice = values.arch.value.selected_option && values.arch.value.selected_option.value;
  if (!card) return ack(fieldError('card', 'Carte introuvable (la banque a peut-être changé) : rouvre la fenêtre.'));
  if (!choice) return ack(fieldError('arch', 'Choisis un type.'));

  const before = cards.getCardStats(card).archetype;
  const result = cards.setArchetype(card.url, choice === 'auto' ? null : choice);
  if (!result.ok) return ack(fieldError('arch', `Enregistrement impossible${result.detail ? ` : ${result.detail}` : ''}.`));
  await ack();

  const label = (k) => `${cards.ARCHETYPES[k].emoji} ${cards.ARCHETYPES[k].label}`;
  logger.info(`⚔️ <@${adminId}> : type de « ${card.title} » ${before} → ${result.archetype}${result.auto ? ' (automatique)' : ''}`);
  const text = `⚔️ *Type de carte mis à jour*\n*${card.title}* : ${label(before)} → *${label(result.archetype)}*${result.auto ? ' _(automatique)_' : ''}\n🎭 Son personnage : ${describeCharacter(card)}\n_Les combats en cours ne changent pas._`;
  await sendAdminResult(client, adminId, { text }, logger);
});

// 🃏 Modale « Donner une carte » : rattrapage à la main (carte gagnée mais absente du classeur)
app.view('admin_give_card_submit', async ({ ack, body, view, client, logger }) => {
  const adminId = body.user.id;
  if (!isAdminUser(adminId, logger, 'admin_give_card_submit')) return ack(fieldError('card', 'Réservé aux admins.'));
  if (weekend.isPaused()) return ack(fieldError('user', WEEKEND_GIFT_TEXT));

  const values = view.state.values;
  const targetId = values.user.value.selected_user;
  const card = home.cardFromValue(values.card.value.selected_option && values.card.value.selected_option.value);
  const count = Number(values.count.value.value);
  if (!targetId) return ack(fieldError('user', 'Choisis une personne.'));
  if (!card) return ack(fieldError('card', 'Carte introuvable (la banque a peut-être changé) : rouvre la fenêtre.'));
  if (!Number.isInteger(count) || count < 1 || count > home.GIVE_CARD_MAX) return ack(fieldError('count', `Entre 1 et ${home.GIVE_CARD_MAX} exemplaires.`));
  await ack();

  try {
    const rarity = RARITIES[card.rarity] ? card.rarity : 'common';
    const given = { url: card.url, title: card.title, rarity, type: card.type };
    const total = collections.addCards(targetId, Array.from({ length: count }, () => given)).at(-1);
    const what = `${RARITIES[rarity].emoji} *${card.title}*${count > 1 ? ` ×${count}` : ''}`;
    logger.info(`🃏 <@${adminId}> a donné « ${card.title} » ×${count} à <@${targetId}> (en possède ${total})`);
    await safeSendDM(client, targetId, {
      text: `🃏 Un admin t'a donné une carte : ${card.title}${count > 1 ? ` ×${count}` : ''}`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `🃏 *Un admin t'a donné une carte !*\n\n${what} (${RARITIES[rarity].label})\n\n_Elle est dans ton classeur : tu en as maintenant ${total}._` } }],
    }, logger);
    await sendAdminResult(client, adminId, { text: `🃏 *Carte donnée à <@${targetId}>*\n${what} (${RARITIES[rarity].label}) — la personne en possède maintenant *${total}* et a été notifiée.` }, logger);
  } catch (error) {
    logger.error('❌ Erreur dans admin_give_card_submit:', error);
  }
});

// 🎁 Modale « Offrir un booster » (v3.2) : hors stock du jour, hors limite par personne, rien débité
app.view('admin_give_booster_submit', async ({ ack, body, view, client, logger }) => {
  const adminId = body.user.id;
  if (!isAdminUser(adminId, logger, 'admin_give_booster_submit')) return ack(fieldError('user', 'Réservé aux admins.'));
  if (weekend.isPaused()) return ack(fieldError('user', WEEKEND_GIFT_TEXT));

  const values = view.state.values;
  const targetId = values.user.value.selected_user;
  const type = values.booster.value.selected_option && values.booster.value.selected_option.value;
  const count = Number(values.count.value.value);
  const booster = boosters.getBooster(type);
  if (!targetId) return ack(fieldError('user', 'Choisis une personne.'));
  if (await isBot(client, targetId)) return ack(fieldError('user', 'Impossible d\'offrir un booster à un bot.'));
  if (!booster) return ack(fieldError('booster', 'Choisis un booster.'));
  if (!Number.isInteger(count) || count < 1 || count > home.GIVE_BOOSTER_MAX) return ack(fieldError('count', `Entre 1 et ${home.GIVE_BOOSTER_MAX} boosters.`));
  await ack();

  try {
    const what = `${booster.emoji} Booster ${booster.label}`;
    for (let i = 0; i < count; i += 1) {
      const id = boosters.createPending(targetId, type, { granted: true });
      events.record('booster_granted', targetId, { boosterId: id, boosterType: type, reason: 'admin', by: adminId }, { dedup: `booster_created:${id}` });
      await sendBoosterDM(client, targetId, id, booster, `🎁 *Un admin t'offre un ${what} !*${count > 1 ? ` (${i + 1}/${count})` : ''}`);
    }
    logger.info(`🎁 <@${adminId}> a offert ${count} booster(s) ${type} à <@${targetId}>`);
    await sendAdminResult(client, adminId, { text: `🎁 *${count > 1 ? `${count} ${what}` : what} offert${count > 1 ? 's' : ''} à <@${targetId}>*\nLa personne les trouve dans ses Messages, prêts à ouvrir. Rien n'a été débité${booster.dailyStock ? ', et le stock du jour n\'est pas touché' : ''}.` }, logger);
    await refreshHomeIfSeen(client, targetId, logger);
  } catch (error) {
    logger.error('❌ Erreur dans admin_give_booster_submit:', error);
  }
});

// 🚫 Modale « Sanction booster » (v3.2) : interdire un booster N jours (0 = lever)
app.view('admin_booster_ban_submit', async ({ ack, body, view, client, logger }) => {
  const adminId = body.user.id;
  if (!isAdminUser(adminId, logger, 'admin_booster_ban_submit')) return ack(fieldError('user', 'Réservé aux admins.'));

  const values = view.state.values;
  const targetId = values.user.value.selected_user;
  const type = values.booster.value.selected_option && values.booster.value.selected_option.value;
  const days = Number(values.days.value.value);
  const reason = ((values.reason && values.reason.value.value) || '').trim();
  // 🏖️ v3.3 : pas de DM au joueur le week-end
  const notify = !weekend.isPaused() && ((values.notify && values.notify.value.selected_options) || []).some((o) => o.value === 'dm');
  const booster = boosters.getBooster(type);
  if (!targetId) return ack(fieldError('user', 'Choisis une personne.'));
  if (!booster) return ack(fieldError('booster', 'Choisis un booster.'));
  if (!Number.isInteger(days) || days < 0 || days > boosterBans.MAX_DAYS) return ack(fieldError('days', `Entre 0 et ${boosterBans.MAX_DAYS} jours.`));
  if (days === 0 && !boosterBans.activeBan(targetId, type)) return ack(fieldError('days', 'Aucune sanction en cours sur ce booster pour cette personne.'));
  await ack();

  try {
    const what = `${booster.emoji} Booster ${booster.label}`;
    let adminText;
    let playerText;
    if (days === 0) {
      boosterBans.lift(targetId, type);
      logger.info(`🚫 <@${adminId}> a levé la sanction ${type} de <@${targetId}>`);
      adminText = `✅ *Sanction levée* : <@${targetId}> peut de nouveau acheter le ${what}.`;
      playerText = `✅ *Ta sanction est levée* : tu peux de nouveau acheter le ${what}.`;
    } else {
      const ban = boosterBans.ban(targetId, type, days, { by: adminId, reason });
      const until = home.banEndText(ban.until);
      logger.info(`🚫 <@${adminId}> a interdit ${type} à <@${targetId}> pendant ${days} j (jusqu'au ${until})${reason ? ` : ${reason}` : ''}`);
      adminText = `🚫 *Sanction enregistrée* : <@${targetId}> ne peut plus acheter le ${what} jusqu'au *${until}* (${days} jour${days > 1 ? 's' : ''})${reason ? `\nRaison : ${reason}` : ''}\n${notify ? 'La personne a été prévenue par DM.' : '_La personne n\'a pas été prévenue._'}`;
      playerText = `🚫 *Tu ne peux plus acheter le ${what} jusqu'au ${until}.*${reason ? `\nRaison : ${reason}` : ''}\n\n_Décision d'un admin. Tes boosters déjà en main et ceux gagnés en Arène ne sont pas touchés._`;
    }
    if (notify) await safeSendDM(client, targetId, { text: plain(playerText), blocks: [{ type: 'section', text: { type: 'mrkdwn', text: playerText } }] }, logger);
    await sendAdminResult(client, adminId, { text: adminText }, logger);
    await refreshHomeIfSeen(client, targetId, logger);
    await refreshHomeIfSeen(client, adminId, logger);   // liste « Sanctions en cours » du panneau admin
  } catch (error) {
    logger.error('❌ Erreur dans admin_booster_ban_submit:', error);
  }
});

// 🗑️ Modale « Retirer un média »
app.view('admin_removemedia_submit', async ({ ack, body, view, client, logger }) => {
  const adminId = body.user.id;
  if (!isAdminUser(adminId, logger, 'admin_removemedia_submit')) return ack(fieldError('media', 'Réservé aux admins.'));

  const selected = view.state.values.media.value.selected_option;
  if (!selected) return ack(fieldError('media', 'Choisis un média.'));

  const result = adminActions.removeMediaFromBank(adminId, parseInt(selected.value, 10), logger);
  if (!result.ok) return ack(fieldError('media', plain(result.text.split('\n')[1] || result.text)));

  await ack();
  try {
    await sendAdminResult(client, adminId, result, logger);
  } catch (error) {
    logger.error('❌ Erreur dans admin_removemedia_submit:', error);
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
  logger.info(`⚙️ <@${adminId}> a réglé 1 Jeanpip = ${result.value} JP$ (avant : ${result.previous})`);
  try {
    await sendAdminResult(client, adminId, {
      text: `⚙️ *Réglage enregistré : 1 Jeanpip envoyé = ${label(result.value)} JP$.*\nAvant : ${label(result.previous)}. S'applique aux prochains Jeanpips (pas de rétroactivité).`,
    }, logger);
    // Le solde affiché ne change pas, mais la ligne « +N crédit(s) » oui → on republie
    for (const userId of homeViewers) await refreshHome(client, userId, logger);
  } catch (error) {
    logger.error('❌ Erreur dans admin_credit_value_submit:', error);
  }
});

// 🚜 Modale « Limite anti-farm » (Jeanpips max par heure, effet immédiat)
app.view('admin_farm_limit_submit', async ({ ack, body, view, client, logger }) => {
  const adminId = body.user.id;
  if (!isAdminUser(adminId, logger, 'admin_farm_limit_submit')) return ack(fieldError('value', 'Réservé aux admins.'));

  const raw = (view.state.values.value.value.value || '').trim();
  const value = /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
  const result = settings.setFarmMaxPerHour(value);
  if (!result.ok) {
    return ack(fieldError('value', result.error === 'invalide'
      ? `Nombre entier entre ${settings.FARM_MAX_PER_HOUR_MIN} et ${settings.FARM_MAX_PER_HOUR_MAX} attendu.`
      : `Erreur d'écriture : ${result.detail}`));
  }

  await ack();
  logger.info(`🚜 <@${adminId}> a réglé la limite anti-farm à ${result.value} Jeanpips/h (avant : ${result.previous})`);
  try {
    await sendAdminResult(client, adminId, {
      text: `🚜 *Limite anti-farm enregistrée : ${result.value} Jeanpips max par heure et par personne.*\nAvant : ${result.previous}. Effet immédiat ; les pénalités déjà en cours ne changent pas.`,
    }, logger);
    // Le quota « x/N » affiché à chacun change → on republie les Accueils ouverts
    for (const userId of homeViewers) await refreshHome(client, userId, logger);
  } catch (error) {
    logger.error('❌ Erreur dans admin_farm_limit_submit:', error);
  }
});

// 🎟️ Modale « Tickets à gratter » (prix + limite par jour, effet immédiat)
app.view('admin_tickets_submit', async ({ ack, body, view, client, logger }) => {
  const adminId = body.user.id;
  if (!isAdminUser(adminId, logger, 'admin_tickets_submit')) return ack(fieldError('price', 'Réservé aux admins.'));

  const read = (blockId) => {
    const raw = (view.state.values[blockId].value.value || '').trim();
    return /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
  };
  const result = settings.setTicketSettings({ price: read('price'), limit: read('limit') });
  if (!result.ok) {
    if (result.error !== 'invalide') return ack(fieldError('price', `Erreur d'écriture : ${result.detail}`));
    return ack(fieldError(result.field, result.field === 'price'
      ? `Nombre entier entre ${settings.TICKET_PRICE_MIN} et ${settings.TICKET_PRICE_MAX} attendu.`
      : `Nombre entier entre ${settings.TICKET_DAILY_LIMIT_MIN} et ${settings.TICKET_DAILY_LIMIT_MAX} attendu.`));
  }

  await ack();
  logger.info(`🎟️ <@${adminId}> a réglé les tickets à ${result.price} JP$, ${result.limit}/jour (avant : ${result.previous.price} JP$, ${result.previous.limit}/jour)`);
  try {
    await sendAdminResult(client, adminId, {
      text: `🎟️ *Tickets à gratter : ${result.price} JP$ le ticket, ${result.limit} par jour et par joueur.*
Avant : ${result.previous.price} JP$, ${result.previous.limit} par jour. Effet immédiat ; les lots suivent le prix.`,
    }, logger);
    for (const userId of homeViewers) await refreshHome(client, userId, logger);
  } catch (error) {
    logger.error('❌ Erreur dans admin_tickets_submit:', error);
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
            text: `🏠 *Le plus simple : l'onglet Accueil du bot !*\nClique sur le bot dans la barre latérale → onglet *Accueil* : ton solde, ton score, l'achat de boosters, le Raid Jeanpip (lancer, se défendre) et la liste de diffusion, en boutons.${isAdmin ? '\n👑 _Tu y trouveras aussi le panneau Admin._' : ''}`,
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
              ? '✅ *Tu as un Raid gratuit disponible ! Lance-le depuis l\'Accueil ou avec \`/jeanpip-attack\` !*'
              : `⏳ Il te manque *${Math.max(0, scores.ATTACK_THRESHOLD - currentScore)}* Jeanpip(s) pour débloquer un Raid gratuit`
            }\n\n_Les scores se remettent à 0 chaque dimanche à 20h_`,
          },
        },
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `⚔️ *Raid Jeanpip — Accueil ou \`/jeanpip-attack\`*\nChoisis tes cibles (${raid.BASE_TARGETS} incluses, +${raid.EXTRA_TARGET_PRICE} JP$ par cible en plus, ${raid.MAX_TARGETS} max) et un style d'attaque secret : 💥 Assaut, 🦊 Ruse ou 🌫️ Embuscade.\n• Chaque cible reçoit une alerte et a *20 min* pour deviner (🛡️ Bouclier, 🪤 Piège ou 🏃 Esquive)\n• ❌ Elle se trompe ou ne répond pas → elle te donne une carte (un doublon d'abord, jamais une légendaire)\n• 🤝 Sa défense tient → rien ne se passe\n• ✅ Elle devine → *riposte* : c'est toi qui lui donnes une carte\n• Les résultats tombent à la fin du raid, pour tout le monde en même temps\n\n*Prix :* gratuit si tu as envoyé *${scores.ATTACK_THRESHOLD} Jeanpips* dans la semaine, sinon *${raid.PRICE} JP$*.\n⏰ _Les raids se lancent ${raid.OPEN.text} : tout est fini à 18h._${isAdmin ? '\n\n👑 *Panneau 👑 Admin dans l\'onglet Accueil (ou `/jeanpip-give @user`, `/jeanpip-auto`) !*' : ''}`,
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
            }\n\nPar défaut *personne* n'est inscrit. Tant que tu n'es pas dans la liste :\n• Quand quelqu'un réagit à ton message, tu ne reçois rien\n• Tu reçois quand même *ton* image quand c'est *toi* qui réagis\n• Tes boosters fonctionnent normalement\n\n⚠️ _Envoyer un Jeanpip à quelqu'un qui n'est pas inscrit ne rapporte aucun JP$._\n\nTape \`/jeanpip\` pour entrer ou sortir de la liste.`,
          },
        },
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🎁 *Boosters JeanPip — \`/jeanpip-booster\`*\nTu as *${creditBalance}* JP$ 💰\n\n*Comment gagner des JP$ :*\n• *+${creditsPerJeanpipLabel()} JP$* à chaque réaction :${TARGET_EMOJI}: que TU poses (spam exclu)\n\n*Comment les dépenser :*\n• \`/jeanpip-booster\` → achète un booster (${boosters.listBoosters().map((b) => `${b.emoji} ${b.price}`).join(' · ')})\n• Un Raid Jeanpip (${raid.PRICE}) si tu n'en as pas de gratuit\n• Chaque booster = *8 cartes* révélées une par une\n• Plus le booster est cher, plus les cartes rares sont probables !\n\n_Tape \`/jeanpip-credits\` pour voir ton solde à tout moment._`,
          },
        },
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🚨 *Anti-spam*\nSi tu réagis plusieurs fois avec :${TARGET_EMOJI}: sur le *même message* en moins de *8 secondes* :\n• La victime ne reçoit rien ✅\n• Toi tu reçois *10 images troll* en rafale toutes les 5 secondes 💀\n\n_Spammer c'est mal._\n\n🌴 *Congés* : déclare tes dates depuis l'onglet *Accueil* (« Déclarer mes congés ») et Jeanpip te laisse tranquille jusqu'à ton retour.`,
          },
        },
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🚜 *Anti-farm*\nSi tu poses *plus de ${farmMaxPerHour()} Jeanpips en 1 heure*, tu prends une alerte et pendant *1 heure* :\n• ❌ Tes Jeanpips n'envoient plus rien aux autres\n• ❌ Tu ne reçois plus *aucune image* (ni la tienne, ni celles des autres)\n• ❌ Tu n'accumules plus de JP$\n• ✅ Tu peux toujours *ouvrir tes boosters*\n\n_Le Jeanpip se déguste, il ne se farme pas._`,
          },
        },
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `📋 *Toutes les commandes*\n\`/jeanpip\` → Entrer ou sortir de la liste de diffusion\n\`/jeanpip-help\` → Affiche ce message avec ton score actuel\n\`/jeanpip-attack\` → Lance un Raid Jeanpip (gratuit si débloqué, sinon ${raid.PRICE} JP$)\n\`/jeanpip-credits\` → Affiche ton solde de JP$\n\`/jeanpip-booster\` → Ouvre la boutique de boosters${isAdmin ? '\n`/jeanpip-give @user` → (admin) Offre un Raid gratuit à quelqu\'un\n`/jeanpip-give-credits @user <montant>` → (admin) Crédite le porte-monnaie de quelqu\'un\n`/jeanpip-addmedia <lien> <rareté> [@auteur] [titre]` → (admin) Ajoute un média à la banque (l\'auteur gagne des JP$)\n`/jeanpip-auto add|remove|list` → (admin) Gère les cibles auto-react' : ''}`,
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
// 🎭 Personnage d'Arène d'une carte : analyse de sa photo (Claude
//    Haiku 4.5 si une clé est configurée, sinon ses couleurs), en fond.
// ─────────────────────────────────────────────
function createCardLook(client, media, logger) {
  if (!media) return;
  looks.ensureLook(media, { client, logger })
    .then((r) => logger.info(`🎭 Personnage d'Arène de « ${media.title} » : ${r.source}`))
    .catch((error) => logger.error('❌ Personnage d\'Arène :', error.message));
}

// ─────────────────────────────────────────────
// ♻️ REVENTE DE DOUBLONS (v3.6) — src/resale.js
//    Bouton de l'Accueil → modale (quantité par rareté) → cartes retirées + JP$.
// ─────────────────────────────────────────────
app.action('resale_open', async ({ ack, body, client, logger }) => {
  await ack();
  await openModal(client, body, home.buildResaleModal(body.user.id), logger);
});

app.view('resale_submit', async ({ ack, body, view, client, logger }) => {
  const userId = body.user.id;
  const values = view.state.values;
  const firstField = Object.keys(values)[0] || 'sell_common';
  const pause = weekend.pauseFor(userId);
  if (pause) return ack(fieldError(firstField, `${pause.icon} Pas de revente ${pause.short}.`));
  if (raid.raidsAgainst(userId).length) return ack(fieldError(firstField, '🚨 Tu subis un raid : pas de revente avant sa fin.'));

  const wanted = {};
  for (const r of resale.RARITY_ORDER) {
    const raw = values[`sell_${r}`] && values[`sell_${r}`].value && values[`sell_${r}`].value.value;
    if (raw) wanted[r] = parseInt(raw, 10);
  }
  const res = resale.sell(userId, wanted);
  if (!res.ok) {
    if (res.error === 'empty') return ack(fieldError(firstField, 'Indique combien de cartes revendre.'));
    if (res.error === 'too_many') return ack(fieldError(`sell_${res.rarity}`, `Tu n'en as que ${res.available} en double.`));
    return ack(fieldError(firstField, `Ça dépasse ton plafond : tu peux encore toucher ${formatCredits(res.remaining)} JP$ cette semaine.`));
  }
  await ack();
  events.record('cards_sold', userId, { sold: res.sold, gained: res.gained });
  const detail = Object.entries(res.sold).map(([r, n]) => `${n} ${resale.LABELS[r].split(' ')[0]}`).join(' · ');
  logger.info(`♻️ <@${userId}> revend ${detail} → +${res.gained} JP$`);
  const text = `♻️ *Revente faite : +${formatCredits(res.gained)} JP$* (${detail}).\nNouveau solde : *${formatCredits(res.balance)} JP$* · encore ${formatCredits(res.remaining)} JP$ de revente possible cette semaine.`;
  await safeSendDM(client, userId, { text: plain(text), blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] }, logger)
    .catch((e) => logger.error('❌ DM de revente :', e.message));
  await refreshHome(client, userId, logger);
});

// 🎯 v3.6 : Jeanpips par jour (admin)
app.view('admin_daily_limit_submit', async ({ ack, body, view, client, logger }) => {
  const adminId = body.user.id;
  if (!isAdminUser(adminId, logger, 'admin_daily_limit_submit')) return ack(fieldError('value', 'Réservé aux admins.'));
  const raw = (view.state.values.value.value.value || '').trim();
  const result = settings.setDailyJeanpipLimit(/^\d+$/.test(raw) ? parseInt(raw, 10) : NaN);
  if (!result.ok) {
    return ack(fieldError('value', result.error === 'invalide'
      ? `Nombre entier entre ${settings.DAILY_JEANPIP_LIMIT_MIN} et ${settings.DAILY_JEANPIP_LIMIT_MAX} attendu.`
      : `Erreur d'écriture : ${result.detail}`));
  }
  await ack();
  logger.info(`🎯 <@${adminId}> a réglé la limite à ${result.value} Jeanpips/jour (avant : ${result.previous})`);
  await sendAdminResult(client, adminId, {
    text: `🎯 *Limite enregistrée : ${result.value} Jeanpips par personne et par jour.*\nAvant : ${result.previous}. Effet immédiat.`,
  }, logger);
  await refreshAllHomes(client, logger, adminId);
});

app.view('admin_resale_cap_submit', async ({ ack, body, view, client, logger }) => {
  const adminId = body.user.id;
  if (!isAdminUser(adminId, logger, 'admin_resale_cap_submit')) return ack(fieldError('value', 'Réservé aux admins.'));
  const raw = (view.state.values.value.value.value || '').trim();
  const result = settings.setResaleWeeklyCap(/^\d+$/.test(raw) ? parseInt(raw, 10) : NaN);
  if (!result.ok) {
    return ack(fieldError('value', result.error === 'invalide'
      ? `Nombre entier entre ${settings.RESALE_WEEKLY_CAP_MIN} et ${settings.RESALE_WEEKLY_CAP_MAX} attendu.`
      : `Erreur d'écriture : ${result.detail}`));
  }
  await ack();
  logger.info(`♻️ <@${adminId}> a réglé le plafond de revente à ${result.value} JP$/semaine (avant : ${result.previous})`);
  await sendAdminResult(client, adminId, {
    text: `♻️ *Plafond de revente enregistré : ${result.value} JP$ par personne et par semaine.*\nAvant : ${result.previous}. Effet immédiat.`,
  }, logger);
  await refreshAllHomes(client, logger, adminId);
});

// ─────────────────────────────────────────────
// 🌴 CONGÉS (v3.6) — src/leave.js
//    Bouton de l'Accueil → modale du … au … → pause pour ce joueur seul.
// ─────────────────────────────────────────────
const PERIOD_ERRORS = {
  format: ['start', 'Choisis les deux dates.'],
  past: ['end', 'Ces dates sont déjà passées.'],
  order: ['end', 'Le dernier jour doit être après le premier.'],
  too_long: ['end', `${leave.MAX_DAYS} jours au maximum.`],
  overlap: ['start', 'Une fermeture est déjà prévue sur ces dates.'],
};
const periodError = (code) => fieldError(...(PERIOD_ERRORS[code] || ['start', 'Dates invalides.']));
const dateValue = (values, id) => values[id] && values[id].value && values[id].value.selected_date;

app.action('leave_open', async ({ ack, body, client, logger }) => {
  await ack();
  await openModal(client, body, home.buildLeaveModal(body.user.id), logger);
});

app.view('leave_submit', async ({ ack, body, view, client, logger }) => {
  const userId = body.user.id;
  const res = leave.declareLeave(userId, dateValue(view.state.values, 'start'), dateValue(view.state.values, 'end'));
  if (!res.ok) return ack(periodError(res.error));
  await ack();
  // Déjà en congés : on sort de la file de combat rapide (les combats commencés vont au bout)
  if (leave.activeLeave(userId)) require('./game/matchmaking').leaveQueue(userId);
  logger.info(`🌴 <@${userId}> en congés du ${res.leave.start} au ${res.leave.end}`);
  await refreshHome(client, userId, logger);
});

app.action('leave_end', async ({ ack, body, action, client, logger }) => {
  await ack();
  const userId = body.user.id;
  if (leave.endLeave(userId)) logger.info(`🌴 <@${userId}> : congés ${action.value === 'back' ? 'terminés (de retour)' : 'annulés'}`);
  await refreshHome(client, userId, logger);
});

// ─────────────────────────────────────────────
// 🏢 FERMETURE DE L'ENTREPRISE (v3.6, admin) — src/closure.js
//    Pause pour tout le monde ; DM à tous le 1er jour à 9h et à la reprise.
// ─────────────────────────────────────────────
app.view('closure_submit', async ({ ack, body, view, client, logger }) => {
  const adminId = body.user.id;
  if (!isAdminUser(adminId, logger, 'closure_submit')) return ack(fieldError('start', 'Réservé aux admins.'));
  const values = view.state.values;
  const res = closure.addClosure({
    start: dateValue(values, 'start'),
    end: dateValue(values, 'end'),
    reason: values.reason && values.reason.value && values.reason.value.value,
    by: adminId,
  });
  if (!res.ok) return ack(periodError(res.error));
  await ack();
  const c = res.closure;
  logger.info(`🏢 <@${adminId}> déclare une fermeture du ${c.start} au ${c.end}${c.reason ? ` (${c.reason})` : ''}`);
  await sendAdminResult(client, adminId, {
    text: `🏢 *Fermeture enregistrée* du ${weekend.longDay(c.start)} au ${weekend.longDay(c.end)} inclus${c.reason ? ` (${c.reason})` : ''}.\nTout le monde sera prévenu en DM le premier jour à 9h, puis à la reprise.`,
  }, logger);
  await announceClosures(client, logger);   // fermeture qui commence aujourd'hui (après 9h) : annonce tout de suite
  await refreshAllHomes(client, logger, adminId);
});

app.action('admin_closure_cancel', async ({ ack, body, action, client, logger }) => {
  await ack();
  const adminId = body.user.id;
  if (!isAdminUser(adminId, logger, 'admin_closure_cancel')) return;
  const c = closure.cancelClosure(action.value);
  if (!c) return refreshHome(client, adminId, logger);
  logger.info(`🏢 <@${adminId}> annule la fermeture du ${c.start} au ${c.end}`);
  // Fermeture déjà annoncée → on prévient que Jeanpip rouvre (sauf si c'est le week-end)
  if (c.startAnnounced && !weekend.isPaused()) await broadcastClosure(client, 'end', c, logger);
  await refreshAllHomes(client, logger, adminId);
});

/** DM de début ou de reprise d'une fermeture, à tous les inscrits. */
async function broadcastClosure(client, kind, c, logger) {
  const text = kind === 'start'
    ? `🏢 *L'entreprise est fermée${c.reason ? ` (${c.reason})` : ''} : Jeanpip est en pause pour tout le monde jusqu'au ${weekend.longDay(c.end)} inclus.*\nPas de Jeanpip, de raid, de booster, de ticket ni de combat. Ton classeur et ton deck restent ouverts. Bonnes vacances ! 🌴`
    : `🎉 *Jeanpip est de retour !* La fermeture${c.reason ? ` (${c.reason})` : ''} est terminée : réactions, raids, boosters, tickets et Arène sont rouverts.`;
  const users = broadcast.getSubscribers();
  logger.info(`🏢 Annonce de ${kind === 'start' ? 'fermeture' : 'reprise'} à ${users.length} inscrit(s)`);
  for (const userId of users) {
    if (kind === 'end' && leave.activeLeave(userId)) continue;   // 🌴 encore en congés : on ne le dérange pas
    try {
      await safeSendDM(client, userId, { text: plain(text), blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] }, logger);
    } catch (error) {
      logger.error(`❌ Annonce de fermeture à <@${userId}> :`, error.message);
    }
  }
}

/** Annonces de fermeture dues (vérifié toutes les 5 min, et au démarrage). */
async function announceClosures(client, logger) {
  const now = Date.now();
  const due = closure.takeDueAnnouncements(now, weekend.isPaused, octobreRose.parisMinutes(now));
  for (const { kind, closure: c } of due) await broadcastClosure(client, kind, c, logger);
  if (due.length) await refreshAllHomes(client, logger);
}

// ─────────────────────────────────────────────
// ▶️  Démarrage
// ─────────────────────────────────────────────
(async () => {
  await app.start();

  arenaHooks.setClient(app.client);   // ⚔️ récaps de fin et expirations, même sans clic préalable
  const authResult = await app.client.auth.test();
  botUserId = authResult.user_id;
  botName = authResult.user || 'Jeanpip Bot';

  scores.checkAndReset();
  setInterval(() => scores.checkAndReset(), 60 * 60 * 1000);

  // 🎁 Crédits JeanPip du vendredi 9h (vérifié toutes les 5 min, rattrapé au redémarrage)
  const weeklyGiftTick = () => runWeeklyGift(app.client, console)
    .catch((error) => console.error('❌ JP$ du vendredi :', error.message));
  weeklyGiftTick();
  setInterval(weeklyGiftTick, 5 * 60 * 1000);

  // 🏢 v3.6 : annonces de fermeture de l'entreprise (1er jour 9h, reprise)
  const closureTick = () => announceClosures(app.client, console)
    .catch((error) => console.error('❌ Annonces de fermeture :', error.message));
  closureTick();
  setInterval(closureTick, 5 * 60 * 1000);

  // ⚔️ v3.4 : raids arrivés au bout de leurs 20 min (et ceux finis pendant une coupure)
  const raidTick = () => finishDueRaids(app.client, console)
    .catch((error) => console.error('❌ Fin des raids :', error.message));
  raidTick();
  setInterval(raidTick, RAID_CHECK_MS);

  // 🙈 v3.2 : arrivée du stock du jour → le bouton d'achat apparaît dans tous les Accueils ouverts
  const dropTick = () => checkBoosterDrop(app.client, console)
    .catch((error) => console.error('❌ Arrivée du stock :', error.message));
  setInterval(dropTick, BOOSTER_DROP_CHECK_MS);

  // 🚜 Pénalités anti-farm en cours avant le redémarrage → reprogrammer la notif de fin
  for (const { userId, remainingMs } of farm.listPenalties()) {
    scheduleFarmRelease(app.client, userId, console, remainingMs);
  }

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

  // 🎭 Personnages d'Arène : cartes sans look (ou aux règles périmées) faites en fond
  //    (banque + Hors série jouable dans l'Arène depuis la v3.4 : Octobre Rose, anti-spam, cartes retirées)
  looks.backfill([...getAllMedia(), ...octobreRose.ROSE_CARDS.filter((c) => c.url), ...SPAM_CARDS, ...getRemovedMedia()], { client: app.client, logger: console })
    .then((r) => { if (r.done) console.log(`🎭 Personnages d'Arène : ${r.done} créé(s) — ${r.haiku} analysé(s) par Haiku, ${r.pixels} par leurs couleurs`); })
    .catch((error) => console.error('❌ Personnages d\'Arène :', error.message));

  const currentTargets = targets.getTargets();

  console.log('');
  console.log('══════════════════════════════════════════');
  console.log('  ⚡️  Slack Emoji Reactor Bot lancé !');
  console.log(`  🏷️   Version : v${require('./releases').currentVersion()}`);
  console.log(`  🎯  Emoji surveillé : :${TARGET_EMOJI}:`);
  console.log(`  🤖  Bot ID : ${botUserId}`);
  console.log(`  🚨  Anti-spam : ${SPAM_THRESHOLD_SECONDS}s seuil → ${SPAM_TROLL_SEQUENCE.length}x troll`);
  console.log(`  ⚔️   Raid : gratuit à ${scores.ATTACK_THRESHOLD} jeanpips/semaine, sinon ${raid.PRICE} JP$ (${raid.OPEN.text})`);
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
