// ═══════════════════════════════════════════════════════════
//  🏙️ MODULE WEB — Boutique de boosters (v4.0, Tâche 1)
//
//  Lien personnel signé de la ville (src/villeToken.js) : t = <userId>.<hmac>
//    GET  /boutique?t=            → la page
//    GET  /api/boutique?t=        → état (solde, pause, boosters, jeton d'achat)
//                                   1 interrogation par seconde et par joueur, sinon 429
//    POST /api/boutique/buy?t=    → corps { type, nonce } → { ok, openUrl, balance }
//                                   ou { ok:false, reason, text }
//
//  Même logique d'achat que Slack (src/boosterPurchase.js). En plus, pour le web :
//  jeton d'achat à usage unique (src/purchaseNonce.js) ; un achat arrivé moins d'1 s
//  après la remise du jeton compte comme un clic en rafale (src/boosterSpam.js).
//  Booster à stock du jour : le jeton doit avoir été remis alors que ce booster était
//  déjà achetable, sinon refus « stale » (rien débité, pas compté comme spam) : un
//  script qui interroge la page chaque seconde n'achète pas dès l'arrivée du stock.
//  Pendant la fenêtre d'arrivée (octobreRose.DROP_WINDOW), tant qu'un booster à stock
//  n'est pas arrivé, l'état indique fastRefresh : la page se rafraîchit toutes les ~5 s.
//  Après un achat (ou un blocage anti-spam), hooks.onBoosterBought envoie le DM
//  Slack habituel et rafraîchit l'Accueil (app.js).
//
//  ctx = { publicUrl, getSecret, send, sendJson, servePage, readJson,
//          userProfile, client, logger, hooks, buildUrls, signToken }
// ═══════════════════════════════════════════════════════════

const boosters = require('./boosters');
const boosterSpam = require('./boosterSpam');
const boosterBans = require('./boosterBans');
const credits = require('./credits');
const weekend = require('./weekend');
const octobreRose = require('./octobreRose');
const villeToken = require('./villeToken');
const purchaseNonce = require('./purchaseNonce');
const { purchaseBooster, texts, parisTime } = require('./boosterPurchase');

let ctx = null;

function configure(context) {
  ctx = context;
}

const POLL_MIN_MS = 1000;      // « pas d'avance sur Slack » : 1 interrogation par seconde
const lastPoll = new Map();    // userId → ms de la dernière interrogation servie

const NO_DEBIT = " Aucun JP$ n'a été débité.";

/** mrkdwn Slack → texte de page (sans *gras*, _italique_ ni :emoji:). */
function toPlain(text) {
  return String(text).replace(/[*_`]/g, '').replace(/:[a-z0-9_+-]+:/gi, '').replace(/[ \t]+\n/g, '\n').trim();
}

// ─────────────────────────────────────────────
// 📦 État vu par la page
// ─────────────────────────────────────────────

function publicBooster(b, userId, now) {
  let block = boosters.purchaseBlock(b, now, userId);
  let blockText = null;
  const lock = b.dailyStock ? boosterSpam.lockedUntil(userId, now) : 0;
  if (block) {
    blockText = toPlain(texts.blocked({ booster: b, blocked: block, ban: block === 'banned' ? boosterBans.activeBan(userId, b.type, now) : null }, userId, now));
  } else if (lock) {
    block = 'spam_lock';
    blockText = `🚫 Bloqué jusqu'à ${parisTime(lock)} : tu as cliqué en rafale sur ce booster. Un seul clic suffit 😉`;
  }
  const left = boosters.stockLeft(b, now);
  return {
    type: b.type,
    label: b.label,
    emoji: b.emoji,
    price: b.price,
    buttonLabel: boosters.buttonLabel(b, now),
    block,
    blockText,
    // Pas d'avance sur l'Accueil : le stock n'est montré qu'une fois arrivé
    stockLeft: left === null || !octobreRose.hasDropped(now) ? null : left,
    dailyStock: b.dailyStock || null,
    dailyPerUser: b.dailyPerUser || null,
    seasonal: Boolean(b.seasonal),
  };
}

/** Dans la fenêtre d'arrivée du stock du jour (9h-10h à Paris) ? */
function inDropWindow(now) {
  const m = octobreRose.parisMinutes(now);
  return m >= octobreRose.DROP_WINDOW.from && m < octobreRose.DROP_WINDOW.from + octobreRose.DROP_WINDOW.minutes;
}

function state(userId, now) {
  const pause = weekend.pauseFor(userId, now);
  const list = boosters.listBoosters(now);
  const shown = list.map((b) => publicBooster(b, userId, now));
  // Achetables à cet instant (purchaseBlock null) : retenus par le jeton (règle « stale »)
  const purchasable = list.filter((b) => !boosters.purchaseBlock(b, now, userId)).map((b) => b.type);
  return {
    ok: true,
    balance: credits.getBalance(userId),
    pause: pause ? { title: toPlain(pause.title), short: pause.short, back: pause.back } : null,
    boosters: shown,
    nonce: purchaseNonce.issue(userId, now, { purchasable }).value,
    fastRefresh: inDropWindow(now) && shown.some((b) => b.dailyStock && b.block === 'not_yet'),
  };
}

// ─────────────────────────────────────────────
// 🛒 Achat
// ─────────────────────────────────────────────

const NONCE_TEXT = {
  invalid: `🔄 Ta page n'est plus à jour : elle se recharge, réessaie.${NO_DEBIT}`,
  expired: `🔄 Ta page est restée ouverte longtemps : elle se recharge, réessaie.${NO_DEBIT}`,
  stale: `🔄 Ce booster vient d'arriver : ta page se met à jour, réessaie dans un instant.${NO_DEBIT}`,
};

/** Résultat de purchaseBooster → réponse JSON de refus. */
function refusal(result, userId, now) {
  const r = (reason, text) => ({ ok: false, reason, text });
  switch (result.status) {
    case 'unknown': return r('unknown', `🤔 Ce booster n'existe pas.${NO_DEBIT}`);
    case 'too_fast': return r('too_fast', `🐢 Trop rapide ! Prends le temps de regarder la page avant d'acheter, puis réessaie.${NO_DEBIT}`);
    case 'spam_ignore':
      return result.verdict.reason === 'locked'
        ? r('spam_locked', `🚫 Ton bouton est bloqué jusqu'à ${parisTime(result.verdict.until)} : tu as cliqué en rafale.${NO_DEBIT}`)
        : r('cooldown', `⏳ Un seul clic suffit : attends quelques secondes avant de réessayer.${NO_DEBIT}`);
    case 'spam_lock': return r('spam_lock', toPlain(texts.lock(result).body));
    case 'blocked': return { ...r('blocked', toPlain(`${texts.blocked(result, userId, now)}\n\n${NO_DEBIT.trim()}`)), block: result.blocked };
    case 'insufficient': return { ...r('insufficient', toPlain(texts.insufficient(result, 'un Jeanpip'))), balance: result.balance };
    case 'wrong_channel': return r('wrong_channel', toPlain(texts.wrongChannel(result.booster)));
    default: return r('error', `😕 Achat impossible.${NO_DEBIT}`);
  }
}

function notify(userId, result) {
  const hook = ctx.hooks && ctx.hooks.onBoosterBought;
  if (!hook) return;
  Promise.resolve()
    .then(() => hook(userId, result))
    .catch((e) => ctx.logger.error('[boutique] onBoosterBought:', e.message));
}

async function handleBuy(req, res, userId) {
  const body = await ctx.readJson(req);
  const now = Date.now();
  const type = typeof body.type === 'string' ? body.type : '';
  const booster = boosters.getBooster(type, now);
  const check = purchaseNonce.consume(userId, body.nonce, now, {
    requirePurchasable: booster && booster.dailyStock ? booster.type : null,
  });
  if (check === 'invalid' || check === 'expired' || check === 'stale') {
    ctx.logger.info(`🎫 Boutique web : jeton d'achat ${check} pour <@${userId}> (${type})`);
    ctx.sendJson(res, 200, { ok: false, reason: check, text: NONCE_TEXT[check] });
    return;
  }

  // ⚠️ Synchrone : aucun await entre le contrôle du stock et la création du booster
  const result = purchaseBooster(userId, type, { channel: 'web', now, tooFast: check === 'too_fast' });

  if (result.status === 'bought') {
    ctx.logger.info(`🛒 Boutique web : <@${userId}> achète un booster ${type} (id ${result.id}, solde ${result.balance})`);
    notify(userId, result);
    ctx.sendJson(res, 200, {
      ok: true,
      openUrl: `open/${encodeURIComponent(result.id)}?t=${ctx.signToken(result.id, userId)}`,
      balance: result.balance,
    });
    return;
  }
  if (result.status === 'spam_lock') notify(userId, result);   // DM, alerte admins, Accueil
  ctx.logger.info(`🚫 Boutique web : achat refusé (${result.status}${result.blocked ? `/${result.blocked}` : ''}) : <@${userId}> ${type}`);
  ctx.sendJson(res, 200, refusal(result, userId, now));
}

// ─────────────────────────────────────────────
// 🚦 Routage
// ─────────────────────────────────────────────

async function route(req, res, url) {
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/boutique') {
    ctx.servePage(res, 'boutique');
    return true;
  }
  if (pathname !== '/api/boutique' && !pathname.startsWith('/api/boutique/')) return false;

  const userId = villeToken.read(url.searchParams.get('t'));
  if (!userId) { ctx.sendJson(res, 403, { ok: false, reason: 'invalid' }); return true; }

  if (pathname === '/api/boutique') {
    if (req.method !== 'GET') { ctx.send(res, 405, 'Method not allowed', { Allow: 'GET' }); return true; }
    const now = Date.now();
    if (now - (lastPoll.get(userId) || -Infinity) < POLL_MIN_MS) {
      ctx.sendJson(res, 429, { ok: false, reason: 'slow_down' });
      return true;
    }
    lastPoll.set(userId, now);
    ctx.sendJson(res, 200, state(userId, now));
    return true;
  }

  if (pathname === '/api/boutique/buy') {
    if (req.method !== 'POST') { ctx.send(res, 405, 'Method not allowed', { Allow: 'POST' }); return true; }
    await handleBuy(req, res, userId);
    return true;
  }

  ctx.sendJson(res, 404, { ok: false, reason: 'not_found' });
  return true;
}

module.exports = { configure, route, _ctx: () => ctx };
