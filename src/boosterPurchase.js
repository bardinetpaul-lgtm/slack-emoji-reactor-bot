// ═══════════════════════════════════════════════════════════
//  🛒 ACHAT D'UN BOOSTER — logique partagée Slack / web (v4.0)
//  Appelée par app.js (boutons buy_booster_*) et par la Boutique web
//  (src/boutiqueWeb.js). Les deux appliquent donc exactement les mêmes
//  règles : canal du booster à stock, anti-spam (src/boosterSpam.js),
//  sanctions, pauses, limite par personne, stock du jour, solde.
//
//  ⚠️ SYNCHRONE : aucun await entre purchaseBlock() et createPending(),
//     deux clics simultanés ne peuvent pas dépasser le stock.
//
//  Canaux : 'slack' = Accueil Slack, 'web' = Boutique web,
//           'dm' = vieux bouton dans un DM (booster à stock refusé, v3.2).
// ═══════════════════════════════════════════════════════════

const boosters = require('./boosters');
const boosterSpam = require('./boosterSpam');
const boosterBans = require('./boosterBans');
const credits = require('./credits');
const events = require('./events');
const weekend = require('./weekend');
const octobreRose = require('./octobreRose');

/**
 * Tente l'achat d'un booster.
 * @param {object} [opts]
 * @param {'slack'|'web'|'dm'} [opts.channel]
 * @param {number} [opts.now]
 * @param {boolean} [opts.tooFast] - web : jeton d'achat utilisé trop tôt → compté comme
 *   un clic (anti-spam du booster à stock), puis refusé
 * @returns {{ status: 'unknown'|'wrong_channel'|'spam_ignore'|'spam_lock'|'too_fast'|'blocked'|'insufficient'|'bought', ... }}
 */
function purchaseBooster(userId, type, { channel = 'slack', now = Date.now(), tooFast = false } = {}) {
  const booster = boosters.getBooster(type, now);
  if (!booster) return { status: 'unknown', type };

  // 🙈 v3.2 : booster à stock = Accueil Slack ou Boutique web (v4.0), jamais un vieux DM
  if (booster.dailyStock && channel === 'dm') return { status: 'wrong_channel', booster };

  // 🚦 v3.0.3 : booster à stock du jour → anti-spam ; chaque clic gardé en base (v3.2)
  if (booster.dailyStock) {
    const verdict = boosterSpam.click(userId, now);
    const block = verdict.action === 'process' ? (tooFast ? 'too_fast' : boosters.purchaseBlock(booster, now, userId)) : null;
    events.record('booster_click', userId, { boosterType: type, verdict: verdict.action, reason: verdict.reason || block || null, channel });
    if (verdict.action === 'ignore') return { status: 'spam_ignore', verdict, booster };
    if (verdict.action === 'lock') return { status: 'spam_lock', verdict, booster };
  }
  if (tooFast) return { status: 'too_fast', booster };

  const blocked = boosters.purchaseBlock(booster, now, userId);
  if (blocked) {
    const ban = blocked === 'banned' ? boosterBans.activeBan(userId, booster.type, now) : null;
    return { status: 'blocked', blocked, ...(ban ? { ban } : {}), booster };
  }

  // 💸 Débit atomique : spend() re-vérifie le solde et renvoie false si insuffisant
  if (!credits.spend(userId, booster.price, { source: 'booster', item: type })) {
    const balance = credits.getBalance(userId);
    return { status: 'insufficient', balance, missing: booster.price - balance, booster };
  }

  const id = boosters.createPending(userId, type);
  events.record('booster_bought', userId, { boosterId: id, boosterType: type, price: booster.price, channel }, { dedup: `booster_created:${id}` });
  return {
    status: 'bought',
    id,
    booster,
    balance: credits.getBalance(userId),
    soldOut: Boolean(booster.dailyStock) && boosters.stockLeft(booster, now) === 0,
  };
}

// ─────────────────────────────────────────────
// 💬 Textes des refus (mrkdwn Slack), partagés par les DM et la Boutique web
// ─────────────────────────────────────────────

const parisClock = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** Heure de Paris « 9h42 ». */
const parisTime = (ms) => parisClock.format(new Date(ms)).replace(':', 'h');

const banDayFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' });

const texts = {
  /** Booster à stock cliqué depuis un vieux DM. */
  wrongChannel(booster) {
    return `${booster.emoji} *Le Booster ${booster.label} s'achète uniquement depuis l'onglet Accueil du bot ou la Boutique de Jeanpip City.* Son bouton y apparaît à l'arrivée des boosters du jour, ${octobreRose.DROP_WINDOW.text}.`;
  },

  /** Blocage anti-spam → { text (notification), body (mrkdwn) }. */
  lock({ booster, verdict }) {
    const until = parisTime(verdict.until);
    const bot = verdict.reason === 'bot';
    const text = bot
      ? `🤖 Clics automatiques détectés sur le Booster ${booster.label} : ton bouton est bloqué ${verdict.minutes} min.`
      : `🚫 Clics en rafale sur le Booster ${booster.label} : ton bouton est bloqué ${verdict.minutes} min.`;
    const body = bot
      ? `🤖 *Clics automatiques détectés* sur le Booster ${booster.emoji} ${booster.label} : tes clics arrivent à intervalles parfaitement réguliers, ce qu'une main ne fait pas.\n\nTon bouton est *bloqué ${verdict.minutes} min*, jusqu'à *${until}*, et les admins sont prévenus. Les auto-clickers et scripts sont interdits : ils peuvent coûter une interdiction de booster.\n\n_Aucun JP$ n'a été débité._`
      : `🚫 *Doucement !* Tu as cliqué en rafale sur le Booster ${booster.emoji} ${booster.label}.\n\nTon bouton est *bloqué ${verdict.minutes} min*, jusqu'à *${until}*. Si tu recommences, ce sera *${verdict.nextMinutes} min*, et ainsi de suite.\n\n_Un seul clic suffit : le premier arrivé est servi. Aucun JP$ n'a été débité._`;
    return { text, body, until };
  },

  /** Raison d'un refus `blocked` (hors saison, sanction, pause, limite, stock). */
  blocked({ booster, blocked, ban }, userId, now = Date.now()) {
    if (ban) {
      return `🚫 *Tu ne peux pas acheter de Booster ${booster.emoji} ${booster.label} jusqu'au ${banDayFmt.format(new Date(ban.until))} à ${parisTime(ban.until)}* (sanction d'un admin${ban.reason ? ` : ${ban.reason}` : ''}).`;
    }
    if (blocked === 'weekend') {
      const p = weekend.pauseFor(userId, now);
      return `${p.icon} *Pas de Booster ${booster.emoji} ${booster.label} ${p.short} !* Jeanpip est en pause ${p.until}.${booster.dailyStock && p.kind === 'weekend' ? ` ${boosters.restockText()}` : ''}`;
    }
    if (blocked === 'user_limit') {
      return `🎀 *Tu as déjà eu ton Booster ${booster.emoji} ${booster.label} aujourd'hui !* C'est ${booster.dailyPerUser} par personne et par jour, pour en laisser aux autres. ${boosters.comeBackDay(booster) ? `Reviens ${boosters.comeBackDay(booster)} 😉` : "C'était le dernier jour de la saison 😢"}`;
    }
    if (blocked === 'not_yet') {
      return `⏳ *Pas encore de Booster ${booster.emoji} ${booster.label} aujourd'hui !* ${boosters.DROP_TEXT} Reviens un peu plus tard 😉`;
    }
    if (blocked === 'sold_out') {
      return `😢 *Plus de Booster ${booster.emoji} ${booster.label} aujourd'hui !* Les ${booster.dailyStock} du jour sont partis.\n\n${boosters.restockText()} Sois rapide 😉`;
    }
    return `⏳ *Le Booster ${booster.emoji} ${booster.label} n'est plus en vente.*`;
  },

  /** Solde insuffisant. `reactWith` = « :jeanpip: » dans Slack. */
  insufficient({ booster, balance, missing }, reactWith) {
    return `❌ *Il te manque ${missing} JP$* pour le Booster ${booster.emoji} ${booster.label}.\n\n💰 Ton solde : *${balance}* · Prix : *${booster.price}*\n\nRéagis avec ${reactWith} pour gagner des JP$ ! 💪`;
  },
};

module.exports = { purchaseBooster, texts, parisTime };
