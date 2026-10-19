// ═══════════════════════════════════════════════════════════
//  🏠 MODULE HOME
//  Construit l'onglet Accueil (App Home) du bot, PAR UTILISATEUR,
//  ainsi que les modales ouvertes depuis l'Accueil.
//  Fonctions pures : aucun appel Slack ici (voir refreshHome dans app.js).
//
//  • Partie joueur (tout le monde) : solde, score, raid, boosters,
//    liste de diffusion.
//  • Panneau « 👑 Admin » : UNIQUEMENT construit pour les admins.
// ═══════════════════════════════════════════════════════════

const scores = require('./scores');
const credits = require('./credits');
const boosters = require('./boosters');
const boosterSpam = require('./boosterSpam');
const scratch = require('./scratch');
const scratchTickets = require('./scratchTickets');

const spamLockClock = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** Heure de fin d'un blocage anti-spam, à l'heure de Paris (« 9h42 »). */
const spamLockTime = (ms) => spamLockClock.format(new Date(ms)).replace(':', 'h');
const banDayFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' });
/** Fin d'une sanction booster : « jeudi 22 octobre à 9h36 ». */
const banEndText = (ms) => `${banDayFmt.format(new Date(ms))} à ${spamLockTime(ms)}`;
const boosterBans = require('./boosterBans');
const weekend = require('./weekend');
const raid = require('./raid');
const broadcast = require('./broadcast');
const { RARITIES, getAllMedia, listCustomMedia, mediaNumber } = require('./media');
const { ARCHETYPES, getCardStats, getOverride } = require('./game/cards');
const settings = require('./settings');
const weeklyGift = require('./weeklyGift');
const { formatCredits, AUTHOR_REWARDS } = require('./admin');
const releases = require('./releases');

// Nombre max de cibles auto-react affichées (limite Slack : 100 blocs par vue)
const MAX_TARGETS_SHOWN = 40;

function section(text, accessory) {
  return { type: 'section', text: { type: 'mrkdwn', text }, ...(accessory ? { accessory } : {}) };
}

function button(text, actionId, { value, style } = {}) {
  return {
    type: 'button',
    text: { type: 'plain_text', text, emoji: true },
    action_id: actionId,
    ...(value !== undefined ? { value } : {}),
    ...(style ? { style } : {}),
  };
}

// ─────────────────────────────────────────────
// 🏠 Vue Accueil
// ─────────────────────────────────────────────

/**
 * @param {string} userId
 * @param {Object} ctx
 * @param {boolean} ctx.isAdmin
 * @param {string}  ctx.creditsPerJeanpipLabel
 * @param {string}  ctx.targetEmoji
 * @param {number}  ctx.farmRemainingMs   - pénalité anti-farm restante (0 si aucune)
 * @param {{used, max, nextFreeMs}} ctx.farmQuota - quota anti-farm sur l'heure glissante
 * @param {Function} ctx.formatRemaining  - ms → « 42 min »
 * @param {Array<{id, fixed}>} [ctx.autoTargets] - cibles auto-react (admins)
 * @param {string|null} [ctx.collectionUrl] - lien du classeur web (null si page web désactivée)
 * @param {string|null} [ctx.statsUrl] - lien du dashboard /stats (admins)
 * @param {string|null} [ctx.ticketsUrl] - lien du Kiosque à tickets à gratter (null si page web désactivée)
 * @param {string|null} [ctx.deckUrl] - lien « Mon deck » de l'Arène (null si page web désactivée)
 * @param {object} [ctx.arena] - état Arène du joueur (src/arenaSlack.js homeState) : bloc « ⚔️ Arène »
 */
function buildHomeView(userId, ctx) {
  const balance = credits.getBalance(userId);
  const score = scores.getScore(userId);
  const pending = boosters.countPending(userId);
  const subscribed = broadcast.isSubscribed(userId);
  const now = Date.now();
  const isWeekend = weekend.isWeekend(now);   // 🏖️ v3.3 : jeu en pause du samedi 0h au lundi 0h

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '🤖 Jeanpip', emoji: true } },
    section(`💰 *Ton solde : ${formatCredits(balance)} JP$*\n_+${ctx.creditsPerJeanpipLabel} JP$ à chaque réaction :${ctx.targetEmoji}: que tu poses (Jeanpip délivré, hors spam/farm)._`),
    ...(isWeekend ? [section(`${weekend.PAUSE_TEXT}\nPas de Jeanpip, de raid, de booster, de ticket ni de nouveau combat : on laisse les collègues tranquilles. Ton classeur et ton deck restent ouverts.`)] : []),
    { type: 'divider' },
  ];

  // 🎁 Crédits JeanPip du vendredi à offrir (seulement s'il en reste)
  const giftAllowance = weeklyGift.getAllowance(userId);
  if (giftAllowance > 0) {
    blocks.push(section(
      `🎁 *Tu as ${giftAllowance} JP$ à offrir*\n_Tu ne peux pas les garder : donne-les aux inscrits de ton choix. Ce qui n'est pas donné est perdu vendredi 9h._`,
      button('🎁 Offrir des JP$', 'weekly_gift_open', { style: 'primary' }),
    ));
    blocks.push({ type: 'divider' });
  }

  // 📊 Semaine + ⚔️ Raid (v3.4) : défenses à jouer, raid en cours, ou lancer un raid
  blocks.push(...buildRaidBlocks(userId, { ...ctx, balance, score, isWeekend, now }));
  blocks.push(buildFarmQuotaBlock(ctx));
  blocks.push({ type: 'divider' });

  // 🎁 Boosters
  const seasonal = boosters.listBoosters(now).find((b) => b.dailyStock);
  // 🚦 v3.0.3 : bouton du booster à stock bloqué après des clics en rafale (src/boosterSpam.js)
  const spamLock = seasonal ? boosterSpam.lockedUntil(userId, now) : 0;
  // 🙈 v3.2 : le bouton du booster à stock n'apparaît QUE quand il est achetable
  //    (stock arrivé, pas épuisé, pas déjà eu le sien, pas bloqué ni sanctionné)
  const seasonalBlock = seasonal ? boosters.purchaseBlock(seasonal, now, userId) : null;
  const ban = seasonalBlock === 'banned' ? boosterBans.activeBan(userId, seasonal.type, now) : null;
  const seasonalStatus = {
    banned: ban && `🚫 *Booster interdit jusqu'au ${banEndText(ban.until)}* (sanction d'un admin${ban.reason ? ` : ${ban.reason}` : ''}).`,
    weekend: boosters.restockText(now),   // « Pas de booster le week-end » : ligne commune plus bas
    user_limit: `✅ *Tu as déjà eu le tien aujourd'hui.* Reviens ${boosters.restockText(now).includes('lundi') ? 'lundi' : 'demain'} 😉`,
    sold_out: seasonal && `😢 *Épuisé pour aujourd'hui* : les ${seasonal.dailyStock} boosters du jour sont partis. ${boosters.restockText(now)}`,
    not_yet: `⏳ ${boosters.DROP_TEXT} *Le bouton d'achat apparaîtra ici à leur arrivée.*`,
  }[seasonalBlock] || '';
  blocks.push(section(`🎁 *Boosters* — 8 cartes chacun, plus il est cher, plus les cartes rares sont probables.${seasonal
    ? `
${seasonal.emoji} *Booster ${seasonal.label}* : 1 ou 2 cartes exclusives qu'on ne trouve nulle part ailleurs, et 30 % de chances d'une légendaire. Seulement *${seasonal.dailyStock} par jour pour tout le monde*${seasonal.weekdaysOnly ? ', *du lundi au vendredi*' : ''}${seasonal.dailyPerUser ? `, *${seasonal.dailyPerUser} par personne*` : ''} !${seasonalStatus ? `
${seasonalStatus}` : ''}${spamLock ? `
🚫 *Bloqué jusqu'à ${spamLockTime(spamLock)}* : tu as cliqué en rafale sur ce booster. Un seul clic suffit 😉` : ''}`
    : ''}${isWeekend ? `
🏖️ *Pas de booster le week-end*, ni achat ni ouverture : retour lundi 0h.` : ''}`));
  if (!isWeekend) blocks.push({
    type: 'actions',
    block_id: 'home_boosters',
    elements: boosters.listBoosters(now).filter((b) => !(seasonal && b.type === seasonal.type && (seasonalBlock || spamLock))).map((b) => button(
      boosters.buttonLabel(b, now),
      `buy_booster_${b.type}`,
      { value: b.type, ...(balance >= b.price && !boosters.purchaseBlock(b, now, userId) ? { style: 'primary' } : {}) },
    )),
  });
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: pending > 0
        ? (isWeekend
          ? `🎁 *${pending} booster(s) non ouvert(s)* : ils t'attendent, ouvre-les lundi depuis l'onglet *Messages*.`
          : `🎁 *${pending} booster(s) non ouvert(s)* → va dans l'onglet *Messages* et clique sur « Ouvrir le booster ».`)
        : `L'achat est débité tout de suite ; tu ouvres ton booster depuis l'onglet *Messages*.`,
    }],
  });
  blocks.push({ type: 'divider' });

  // 🎟️ Tickets à gratter « ESSAI ! » (page web)
  if (ctx.ticketsUrl) blocks.push(...buildTicketsBlocks(userId, ctx.ticketsUrl), { type: 'divider' });

  // 📒 Classeur Panini (page web, bureaux uniquement)
  if (ctx.collectionUrl) {
    blocks.push(section(
      `📒 *Mon classeur* — toutes tes cartes rangées comme un album Panini, mis à jour en direct.`,
      { ...button('📒 Ouvrir mon classeur', 'open_collection_web'), url: ctx.collectionUrl },
    ));
    blocks.push({ type: 'divider' });
  }

  // ⚔️ Arène : combattre (défi, combat rapide), son combat en cours, ses decks
  if (ctx.arena) {
    const arenaSlack = require('./arenaSlack');
    blocks.push(...arenaSlack.buildHomeBlocks(ctx.arena));
    blocks.push({ type: 'divider' });
    // 🏆 Classement de l'Arène (v2.2)
    if (ctx.arena.ranking) {
      blocks.push(...arenaSlack.buildRankingBlocks(ctx.arena.ranking, userId));
      blocks.push({ type: 'divider' });
    }
  } else if (ctx.deckUrl) {
    blocks.push(section(
      `⚔️ *Arène — Mon deck* — prépare tes 3 decks de combat et ton Capitaine, quand tu veux. Le deck actif est celui que tu emmènes au combat.`,
      { ...button('🃏 Modifier mon deck', 'open_deck_web'), url: ctx.deckUrl },
    ));
    blocks.push({ type: 'divider' });
  }

  // 📮 Liste de diffusion
  blocks.push(section(
    subscribed
      ? `📮 *Liste de diffusion :* ✅ inscrit — tu reçois les Jeanpips que les autres t'envoient.`
      : `📮 *Liste de diffusion :* 🔕 pas inscrit — personne ne peut t'envoyer de Jeanpip (et réagir à tes messages ne rapporte rien aux autres).`,
    subscribed
      ? button('🚪 Sortir de la liste', 'broadcast_leave', { value: 'leave' })
      : button('✅ Rejoindre la liste', 'broadcast_join', { value: 'join', style: 'primary' }),
  ));
  blocks.push({ type: 'divider' });

  // 📰 Nouveautés : release note du jeu (avant le panneau admin, pour rester visible)
  const release = releases.current();
  blocks.push(section(
    `📰 *Nouveautés — v${release.version}* : ${release.title}\n_Mise à jour du ${releases.formatDate(release.date)}._`,
    button('📰 Nouveautés', 'release_notes_open'),
  ));
  // 🐛 Signaler un bug (v2.2.1)
  const bugsSlack = require('./bugsSlack');
  blocks.push(...bugsSlack.buildReportBlocks());

  // 👑 Panneau admin (jamais construit pour un non-admin)
  if (ctx.isAdmin) {
    blocks.push(...buildAdminBlocks(ctx.autoTargets || [], ctx.statsUrl));
    blocks.push({ type: 'divider' }, ...bugsSlack.buildAdminBugBlocks());
  }

  blocks.push({ type: 'divider' });
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `❓ Guide complet : \`/jeanpip-help\` · 🤖 _Jeanpip Bot v${release.version} — Fait avec ❤️_` }] });

  return { type: 'home', blocks };
}

/**
 * 🚜 Où en est le joueur de son quota anti-farm sur l'heure glissante.
 * Pas de mise à jour automatique avec le temps (limite Slack) : recalculé à
 * chaque Jeanpip envoyé et à chaque ouverture de l'onglet.
 */
function buildFarmQuotaBlock(ctx) {
  let text;
  if (ctx.farmRemainingMs > 0) {
    text = `🚜 *Pénalité anti-farm :* encore *${ctx.formatRemaining(ctx.farmRemainingMs)}* — tes Jeanpips n'envoient rien aux autres, tu ne reçois aucune image et tu ne gagnes pas de JP$.`;
  } else {
    const { used, max, nextFreeMs } = ctx.farmQuota;
    const full = used >= max;
    text = `🚜 *Quota de l'heure :* ${Math.min(used, max)}/${max} Jeanpips${full ? ' — ⚠️ *limite atteinte*' : ''}`;
    if (full) {
      text += `
_Le prochain Jeanpip avant ${ctx.formatRemaining(nextFreeMs)} déclenche 1 h de pénalité._`;
    } else if (used > 0) {
      text += `
_Ton plus ancien Jeanpip sort du compteur dans ${ctx.formatRemaining(nextFreeMs)}._`;
    }
  }
  return { type: 'context', elements: [{ type: 'mrkdwn', text }] };
}

function buildAdminBlocks(autoTargets, statsUrl = null) {
  const blocks = [
    { type: 'divider' },
    { type: 'header', text: { type: 'plain_text', text: '👑 Admin', emoji: true } },
    ...(statsUrl ? [{
      type: 'actions',
      block_id: 'home_admin_stats',
      elements: [{ ...button('📊 Stats du jeu', 'open_stats_web'), url: statsUrl }],
    }] : []),
    {
      type: 'actions',
      block_id: 'home_admin',
      elements: [
        button('🎁 Offrir un raid', 'admin_give_attack_open'),
        button('💳 JP$ ±', 'admin_credits_open'),
        button('🖼️ Ajouter un média', 'admin_addmedia_open'),
        button('🃏 Donner une carte', 'admin_give_card_open'),
        button('🎁 Offrir un booster', 'admin_give_booster_open'),
        button('🚫 Sanction booster', 'admin_booster_ban_open'),
        button('⚔️ Type de carte', 'admin_card_type_open'),
        button('🗑️ Retirer un média', 'admin_removemedia_open'),
        button('🎪 Ajouter une cible', 'admin_target_add_open'),
        button('⚙️ JP$ par Jeanpip', 'admin_credit_value_open'),
        button('🚜 Limite anti-farm', 'admin_farm_limit_open'),
        button('🎟️ Tickets à gratter', 'admin_tickets_open'),
      ],
    },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `⚙️ Réglages actuels : *1 Jeanpip envoyé = ${formatCredits(settings.getCreditsPerJeanpip())} JP$* · 🚜 *anti-farm : ${settings.getFarmMaxPerHour()} Jeanpips/h max*` }] },
  ];

  // 🚫 v3.2 : sanctions boosters en cours
  const bans = boosterBans.listActive();
  if (bans.length) {
    blocks.push(section(`🚫 *Sanctions boosters en cours (${bans.length})*\n${bans.map((b) => {
      const def = boosters.BOOSTERS[b.type];
      return `• <@${b.userId}> : ${def ? `${def.emoji} ${def.label}` : b.type} jusqu'au ${banEndText(b.until)}${b.reason ? ` _(${b.reason})_` : ''}`;
    }).join('\n')}\n_Pour lever une sanction : 🚫 Sanction booster avec 0 jour._`));
  }
  blocks.push(section(`🎪 *Cibles auto-react (${autoTargets.length})*${autoTargets.length ? '' : '\n_Aucune cible auto-react configurée._'}`));

  for (const t of autoTargets.slice(0, MAX_TARGETS_SHOWN)) {
    blocks.push(t.fixed
      ? section(`• <@${t.id}> _(fixe .env)_`)
      : section(`• <@${t.id}>`, button('Retirer', 'admin_target_remove', { value: t.id })));
  }
  if (autoTargets.length > MAX_TARGETS_SHOWN) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `… et ${autoTargets.length - MAX_TARGETS_SHOWN} autre(s). Liste complète : \`/jeanpip-auto list\`` }] });
  }
  return blocks;
}

// ─────────────────────────────────────────────
// 🪟 Modales
// ─────────────────────────────────────────────

function modal(callbackId, title, submit, blocks) {
  return {
    type: 'modal',
    callback_id: callbackId,
    title: { type: 'plain_text', text: title },
    submit: { type: 'plain_text', text: submit },
    close: { type: 'plain_text', text: 'Annuler' },
    blocks,
  };
}

function userInput(label) {
  return {
    type: 'input',
    block_id: 'user',
    label: { type: 'plain_text', text: label },
    element: { type: 'users_select', action_id: 'value', placeholder: { type: 'plain_text', text: 'Choisis une personne' } },
  };
}

// ─────────────────────────────────────────────
// ⚔️ Raid (v3.4) — src/raid.js
// ─────────────────────────────────────────────

const raidClock = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** Heure de Paris « 10h42 ». */
const raidTime = (ms) => raidClock.format(new Date(ms)).replace(':', 'h');
const styleText = (key) => `${raid.STYLES[key].emoji} ${raid.STYLES[key].label}`;
const defenseText = (key) => `${raid.DEFENSES[key].emoji} ${raid.DEFENSES[key].label}`;

/** Les 3 boutons de défense d'un raid (DM d'alerte et Accueil). */
function raidDefenseButtons(raidId) {
  return {
    type: 'actions',
    block_id: `raid_defend_${raidId}`,
    elements: Object.keys(raid.DEFENSES).map((d) => button(defenseText(d), `raid_defend_${d}`, { value: raidId })),
  };
}

/** Règles de la défense, lues par la victime (DM d'alerte). */
const RAID_RULES = Object.values(raid.DEFENSES)
  .map((d) => `• ${d.emoji} *${d.label}* bat ${styleText(d.beats)}, tient contre ${styleText(d.holds)}`)
  .join('\n');

/** Blocs « Ta semaine + ⚔️ Raid » de l'Accueil. */
function buildRaidBlocks(userId, ctx) {
  const blocks = [];
  const free = scores.hasAttack(userId);
  const missing = Math.max(0, scores.ATTACK_THRESHOLD - ctx.score);
  const scoreLine = `📊 *Ta semaine :* ${ctx.score}/${scores.ATTACK_THRESHOLD} :${ctx.targetEmoji}:${free ? '' : ` · encore ${missing} pour un raid gratuit`}`;

  // 🚨 Raids qui me visent : se défendre ici aussi (mêmes boutons que dans le DM)
  for (const r of raid.raidsAgainst(userId)) {
    const me = r.targets.find((t) => t.userId === userId);
    if (me.defense) {
      blocks.push(section(`🚨 *<@${r.attacker}> te raide.* ${defenseText(me.defense)} enregistré : résultat à la fin du raid, au plus tard à ${raidTime(r.endsAt)}. 🤫`));
    } else {
      blocks.push(section(`🚨 *<@${r.attacker}> te raide !* Devine son style d'attaque avant *${raidTime(r.endsAt)}*.\n${RAID_RULES}`));
      blocks.push(raidDefenseButtons(r.id));
    }
  }

  const mine = raid.activeRaidOf(userId);
  const block = raid.launchBlock(ctx.now);
  const price = raid.cost(raid.BASE_TARGETS, free);
  let text;
  let launch = null;
  if (mine) {
    const answered = mine.targets.filter((t) => t.defense).length;
    text = `⚔️ *Ton raid est en cours* (${styleText(mine.style)}) : ${answered}/${mine.targets.length} défense${mine.targets.length > 1 ? 's' : ''} reçue${answered > 1 ? 's' : ''}, fin au plus tard à ${raidTime(mine.endsAt)}.`;
  } else if (ctx.isWeekend) {
    text = '🏖️ *Pas de raid le week-end* : ça reprend lundi à 9h.';
  } else if (block === 'hours') {
    text = `⏰ *Raid :* ils se lancent ${raid.OPEN.text}, pour que tout soit fini à 18h.${free ? ' Ton raid gratuit t\'attend.' : ''}`;
  } else if (ctx.farmRemainingMs > 0) {
    text = `🚜 *Pénalité anti-farm* encore *${ctx.formatRemaining(ctx.farmRemainingMs)}* : pas de raid pour l'instant.`;
  } else if (free) {
    text = '🎉 *Raid gratuit débloqué !* Choisis jusqu\'à 5 cibles sans rien payer.';
    launch = button('⚔️ Lancer mon raid gratuit', 'home_attack_open', { style: 'primary' });
  } else {
    text = `⚔️ *Raid :* ${price} JP$ pour ${raid.BASE_TARGETS} cibles${ctx.balance < price ? ` · ❌ il te manque *${formatCredits(price - ctx.balance)}* JP$` : ''}.`;
    if (ctx.balance >= price) launch = button(`⚔️ Lancer un raid (${price} JP$)`, 'home_attack_open', { style: 'primary' });
  }
  blocks.push(section(`${scoreLine}\n${text}`, launch));
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `Tu choisis tes cibles (${raid.BASE_TARGETS} incluses, +${raid.EXTRA_TARGET_PRICE} JP$ par cible en plus, ${raid.MAX_TARGETS} max) et un style secret. Chacune a 20 min pour deviner : celles qui tombent te donnent une carte (jamais une légendaire), une bonne défense t'en coûte une. _Scores remis à 0 chaque dimanche 20h._` }] });
  return blocks;
}

/** ⚔️ Modale « Lancer un raid » (ou une modale d'info si on ne peut pas lancer). */
function buildRaidModal(userId, now = Date.now()) {
  const info = (text) => ({ type: 'modal', title: { type: 'plain_text', text: 'Raid Jeanpip' }, close: { type: 'plain_text', text: 'Fermer' }, blocks: [section(text)] });
  const block = raid.launchBlock(now);
  if (block === 'weekend') return info('🏖️ *Pas de raid le week-end.* Ça reprend lundi à 9h.');
  if (block === 'hours') return info(`⏰ *Les raids se lancent ${raid.OPEN.text}*, pour que tout soit fini à 18h.`);
  if (raid.activeRaidOf(userId)) return info('⚔️ *Tu as déjà un raid en cours.* Attends son résultat avant d\'en lancer un autre.');

  const free = scores.hasAttack(userId);
  const cost = free
    ? `🎉 *Raid gratuit* pour ${raid.BASE_TARGETS} cibles (tu l'as débloqué cette semaine)`
    : `💰 *${raid.PRICE} JP$* pour ${raid.BASE_TARGETS} cibles`;
  return modal('raid_submit', 'Raid Jeanpip', '⚔️ Lancer le raid', [
    section(`${cost}, puis *+${raid.EXTRA_TARGET_PRICE} JP$ par cible en plus* (${raid.MAX_TARGETS} max). Ton solde : *${formatCredits(credits.getBalance(userId))} JP$*.\n\nChaque cible reçoit une alerte et a *20 min* pour deviner ton style. Celles qui tombent te donnent une carte (un doublon d'abord, jamais une légendaire). Une bonne défense, c'est la *riposte* : tu perds une carte.`),
    {
      type: 'input',
      block_id: 'targets',
      label: { type: 'plain_text', text: 'Cibles' },
      element: { type: 'multi_users_select', action_id: 'value', max_selected_items: raid.MAX_TARGETS, placeholder: { type: 'plain_text', text: `Jusqu'à ${raid.MAX_TARGETS} personnes` } },
      hint: { type: 'plain_text', text: 'Inscrites à la liste de diffusion. Une personne ne subit qu\'un raid à la fois, et 2 par jour au maximum.' },
    },
    {
      type: 'input',
      block_id: 'style',
      label: { type: 'plain_text', text: 'Ton style d\'attaque (secret, le même pour tout le raid)' },
      element: {
        type: 'radio_buttons',
        action_id: 'value',
        options: Object.values(raid.STYLES).map((s) => ({ text: { type: 'plain_text', text: `${s.emoji} ${s.label}`, emoji: true }, value: s.key })),
      },
    },
    { type: 'context', elements: [{ type: 'mrkdwn', text: Object.values(raid.STYLES).map((s) => {
      const beats = Object.values(raid.DEFENSES).find((d) => d.beats === s.key);
      const holds = Object.values(raid.DEFENSES).find((d) => d.holds === s.key);
      return `${s.emoji} *${s.label}* : contré par ${beats.emoji} ${beats.label} (riposte), arrêté par ${holds.emoji} ${holds.label}`;
    }).join('\n') }] },
  ]);
}

// Limites Slack : 100 blocs par modale, 3000 caractères par section
const MAX_RELEASES_SHOWN = 15;

/** 📰 Modale « Nouveautés » : la release note, de la version la plus récente à la plus ancienne. */
function buildReleaseNotesModal(list = releases.RELEASES) {
  const blocks = [];
  for (const r of list.slice(0, MAX_RELEASES_SHOWN)) {
    if (blocks.length) blocks.push({ type: 'divider' });
    blocks.push(section(cut(
      `*v${r.version} — ${r.title}*\n_${releases.formatDate(r.date)}_\n${r.changes.map((c) => `• ${c}`).join('\n')}`,
      3000,
    )));
  }
  if (list.length > MAX_RELEASES_SHOWN) {
    const hidden = list.length - MAX_RELEASES_SHOWN;
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `_… et ${hidden} version(s) plus ancienne(s)._` }] });
  }
  return {
    type: 'modal',
    callback_id: 'release_notes',
    title: { type: 'plain_text', text: 'Nouveautés' },
    close: { type: 'plain_text', text: 'Fermer' },
    blocks,
  };
}

/** 🎁 Modale « Offrir des crédits » (crédits JeanPip du vendredi). */
function buildWeeklyGiftModal(userId) {
  const allowance = weeklyGift.getAllowance(userId);
  return modal('weekly_gift_submit', 'Offrir des JP$', '🎁 Offrir', [
    section(`🎁 Il te reste *${allowance} JP$* à offrir cette semaine.\n_Ils vont dans le porte-monnaie de la personne choisie. Tu peux les répartir entre plusieurs personnes._`),
    userInput('À qui ?'),
    {
      type: 'input',
      block_id: 'amount',
      label: { type: 'plain_text', text: 'Combien de JP$ ?' },
      element: {
        type: 'number_input',
        action_id: 'value',
        is_decimal_allowed: false,
        min_value: '1',
        max_value: String(Math.max(1, allowance)),
        initial_value: String(Math.max(1, allowance)),
      },
      hint: { type: 'plain_text', text: 'La personne doit être inscrite à la liste de diffusion.' },
    },
  ]);
}

function buildGiveAttackModal() {
  return modal('admin_give_attack_submit', 'Offrir un raid', 'Offrir', [
    userInput('À qui offrir un Raid gratuit ?'),
  ]);
}

function buildCreditsModal() {
  return modal('admin_credits_submit', 'JP$ ±', 'Valider', [
    userInput('Personne'),
    {
      type: 'input',
      block_id: 'amount',
      label: { type: 'plain_text', text: 'Montant' },
      element: { type: 'plain_text_input', action_id: 'value', placeholder: { type: 'plain_text', text: 'ex. 50, 2,5 ou -20' } },
      hint: { type: 'plain_text', text: 'Positif = cadeau (la personne est notifiée). Négatif = correction (sans notification). Demi-JP$ acceptés.' },
    },
  ]);
}

function buildAddMediaModal() {
  return modal('admin_addmedia_submit', 'Ajouter un média', 'Ajouter', [
    {
      type: 'input',
      block_id: 'url',
      label: { type: 'plain_text', text: 'Lien du média' },
      element: { type: 'url_text_input', action_id: 'value', placeholder: { type: 'plain_text', text: 'https://…' } },
    },
    {
      type: 'input',
      block_id: 'rarity',
      label: { type: 'plain_text', text: 'Rareté' },
      element: {
        type: 'static_select',
        action_id: 'value',
        placeholder: { type: 'plain_text', text: 'Choisis une rareté' },
        options: Object.entries(RARITIES).map(([key, r]) => ({
          text: { type: 'plain_text', text: `${r.emoji} ${r.label}`, emoji: true },
          value: key,
        })),
      },
    },
    {
      type: 'input',
      block_id: 'arch',
      optional: true,
      label: { type: 'plain_text', text: 'Type en Arène (optionnel)' },
      element: { type: 'static_select', action_id: 'value', placeholder: { type: 'plain_text', text: '🎲 Automatique' }, options: archetypeOptions() },
      hint: { type: 'plain_text', text: 'Son rôle en combat. Sans choix : tiré automatiquement. Modifiable ensuite (⚔️ Type de carte).' },
    },
    {
      type: 'input',
      block_id: 'title',
      optional: true,
      label: { type: 'plain_text', text: 'Titre (optionnel)' },
      element: { type: 'plain_text_input', action_id: 'value' },
      hint: { type: 'plain_text', text: 'Le numéro « Surprise #N » est attribué automatiquement.' },
    },
    {
      type: 'input',
      block_id: 'author',
      optional: true,
      label: { type: 'plain_text', text: 'Auteur (optionnel)' },
      element: { type: 'users_select', action_id: 'value', placeholder: { type: 'plain_text', text: 'Qui t’a envoyé ce média ?' } },
      hint: { type: 'plain_text', text: `La personne reçoit des JP$ selon la rareté : ${Object.entries(AUTHOR_REWARDS).map(([key, n]) => `${RARITIES[key].emoji} ${n}`).join(' · ')}. Elle est notifiée en DM.` },
    },
  ]);
}

// ⚔️ Types de carte de l'Arène (ordre d'affichage) + « automatique »
const ARCH_ORDER = ['tank', 'guerrier', 'tireur', 'essaim', 'sort', 'vigie'];
const ARCH_HINTS = {
  tank: 'char : ne vise que les bâtiments', guerrier: 'corps à corps', tireur: 'archer, tire de loin',
  essaim: 'petits volants', sort: 'explosion visée', vigie: 'guetteur sur une tour',
};

function archetypeOptions({ withAuto = false } = {}) {
  const opts = ARCH_ORDER.map((k) => ({
    text: { type: 'plain_text', text: `${ARCHETYPES[k].emoji} ${ARCHETYPES[k].label} — ${ARCH_HINTS[k]}`, emoji: true },
    value: k,
  }));
  if (withAuto) opts.push({ text: { type: 'plain_text', text: '🎲 Automatique (tirage stable)', emoji: true }, value: 'auto' });
  return opts;
}

const cut = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** Valeur d'option d'une carte : son URL (≤ 150 car., limite Slack), sinon son rang dans la banque. */
function cardValue(media, i) {
  return media.url.length <= 150 ? media.url : `#${i}`;
}

/**
 * ⚔️ Modale « Type de carte » : une carte (rangées par rareté) + son type.
 * Groupes de 100 options max (limite Slack) : une rareté trop fournie est découpée.
 */
function buildCardTypeModal() {
  const all = getAllMedia();
  const groups = [];
  for (const [key, r] of Object.entries(RARITIES)) {
    const list = all.map((m, i) => [m, i]).filter(([m]) => (m.rarity || 'common') === key);
    for (let from = 0; from < list.length; from += 100) {
      const chunk = list.slice(from, from + 100);
      const part = list.length > 100 ? ` (${from / 100 + 1}/${Math.ceil(list.length / 100)})` : '';
      groups.push({
        label: { type: 'plain_text', text: `${r.emoji} ${r.label}${part}`, emoji: true },
        options: chunk.map(([m, i]) => {
          const { archetype } = getCardStats(m);
          const forced = getOverride(m.url) && getOverride(m.url).archetype ? '' : ' 🎲';
          return {
            text: { type: 'plain_text', text: cut(`${m.title || 'Carte'} · ${ARCHETYPES[archetype].emoji} ${ARCHETYPES[archetype].label}${forced}`, 75), emoji: true },
            value: cardValue(m, i),
          };
        }),
      });
    }
  }
  return modal('admin_card_type_submit', 'Type de carte', 'Enregistrer', [
    section('⚔️ *Type d\'une carte dans l\'Arène* — son rôle en combat (stats, silhouette de son personnage).\n🎲 = tiré automatiquement.'),
    {
      type: 'input',
      block_id: 'card',
      label: { type: 'plain_text', text: 'Carte' },
      element: { type: 'static_select', action_id: 'value', placeholder: { type: 'plain_text', text: 'Choisis une carte' }, option_groups: groups.slice(0, 100) },
    },
    {
      type: 'input',
      block_id: 'arch',
      label: { type: 'plain_text', text: 'Type' },
      element: { type: 'static_select', action_id: 'value', placeholder: { type: 'plain_text', text: 'Choisis un type' }, options: archetypeOptions({ withAuto: true }) },
    },
    { type: 'context', elements: [{ type: 'mrkdwn', text: '_Le personnage garde les traits de sa photo (chapeau, lunettes, couleurs…) et prend la silhouette du nouveau rôle. Les combats en cours ne changent pas ; les decks déjà faits gardent la carte._' }] },
  ]);
}

// Exemplaires qu'un admin peut donner d'un coup
const GIVE_CARD_MAX = 5;

/**
 * 🃏 Modale « Donner une carte » : rend à un joueur une carte du catalogue (rattrapage à la
 * main : carte gagnée mais absente de son classeur). Légendaires en premier.
 */
function buildGiveCardModal() {
  const all = getAllMedia();
  const groups = [];
  for (const [key, r] of Object.entries(RARITIES).reverse()) {
    const list = all.map((m, i) => [m, i]).filter(([m]) => m && m.url && (m.rarity || 'common') === key);
    for (let from = 0; from < list.length; from += 100) {
      const part = list.length > 100 ? ` (${from / 100 + 1}/${Math.ceil(list.length / 100)})` : '';
      groups.push({
        label: { type: 'plain_text', text: `${r.emoji} ${r.label}${part}`, emoji: true },
        options: list.slice(from, from + 100).map(([m, i]) => ({
          text: { type: 'plain_text', text: cut(m.title || 'Carte', 75), emoji: true },
          value: cardValue(m, i),
        })),
      });
    }
  }
  return modal('admin_give_card_submit', 'Donner une carte', '🃏 Donner', [
    section('🃏 *Donner une carte à un joueur* — elle s\'ajoute à son classeur, comme s\'il l\'avait tirée d\'un booster.'),
    userInput('À qui ?'),
    {
      type: 'input',
      block_id: 'card',
      label: { type: 'plain_text', text: 'Carte' },
      element: { type: 'static_select', action_id: 'value', placeholder: { type: 'plain_text', text: 'Choisis une carte' }, option_groups: groups.slice(0, 100) },
    },
    {
      type: 'input',
      block_id: 'count',
      label: { type: 'plain_text', text: 'Combien d\'exemplaires ?' },
      element: { type: 'number_input', action_id: 'value', is_decimal_allowed: false, min_value: '1', max_value: String(GIVE_CARD_MAX), initial_value: '1' },
    },
    { type: 'context', elements: [{ type: 'mrkdwn', text: '_La personne est notifiée en DM. Seules les cartes du catalogue actuel sont listées (pas le Hors série ni les médias retirés)._' }] },
  ]);
}

const GIVE_BOOSTER_MAX = 5;

/** Menu « Booster » des modales admin (tous les types du catalogue, saisonnier compris). */
function boosterSelect(initialType = null) {
  const options = Object.values(boosters.BOOSTERS).map((b) => ({
    text: { type: 'plain_text', text: `${b.emoji} ${b.label}`, emoji: true },
    value: b.type,
  }));
  const initial = options.find((o) => o.value === initialType);
  return {
    type: 'input',
    block_id: 'booster',
    label: { type: 'plain_text', text: 'Booster' },
    element: { type: 'static_select', action_id: 'value', placeholder: { type: 'plain_text', text: 'Choisis un booster' }, options, ...(initial ? { initial_option: initial } : {}) },
  };
}

/** 🎁 Modale « Offrir un booster » (v3.2) : hors stock du jour et hors limite par personne. */
function buildGiveBoosterModal() {
  return modal('admin_give_booster_submit', 'Offrir un booster', '🎁 Offrir', [
    section('🎁 *Offrir un booster* — il arrive dans les Messages de la personne, prêt à ouvrir. Rien n\'est débité.'),
    userInput('À qui ?'),
    boosterSelect(),
    {
      type: 'input',
      block_id: 'count',
      label: { type: 'plain_text', text: 'Combien ?' },
      element: { type: 'number_input', action_id: 'value', is_decimal_allowed: false, min_value: '1', max_value: String(GIVE_BOOSTER_MAX), initial_value: '1' },
    },
    { type: 'context', elements: [{ type: 'mrkdwn', text: '_Un Octobre Rose offert ne prend pas de place dans le stock du jour et ne compte pas dans la limite d\'un par personne. Ça marche aussi hors saison et le week-end._' }] },
  ]);
}

const NOTIFY_OPTION = { text: { type: 'plain_text', text: 'Prévenir la personne par DM' }, value: 'dm' };

/** 🚫 Modale « Sanction booster » (v3.2) : interdit d'acheter un booster pendant N jours (0 = lever). */
function buildBoosterBanModal() {
  return modal('admin_booster_ban_submit', 'Sanction booster', 'Valider', [
    section('🚫 *Interdire un booster à un joueur* — le bouton disparaît de son Accueil et ses clics sont refusés. Ses boosters déjà en main et ceux gagnés en Arène ne sont pas touchés.'),
    userInput('Qui ?'),
    boosterSelect('octobre_rose'),
    {
      type: 'input',
      block_id: 'days',
      label: { type: 'plain_text', text: 'Durée (jours)' },
      element: { type: 'number_input', action_id: 'value', is_decimal_allowed: false, min_value: '0', max_value: String(boosterBans.MAX_DAYS), initial_value: '7' },
      hint: { type: 'plain_text', text: 'À partir de maintenant. 0 = lever la sanction en cours.' },
    },
    {
      type: 'input',
      block_id: 'reason',
      optional: true,
      label: { type: 'plain_text', text: 'Raison (montrée au joueur)' },
      element: { type: 'plain_text_input', action_id: 'value', max_length: 150, placeholder: { type: 'plain_text', text: 'ex. clics automatiques' } },
    },
    {
      type: 'input',
      block_id: 'notify',
      optional: true,
      label: { type: 'plain_text', text: 'Prévenir' },
      element: { type: 'checkboxes', action_id: 'value', options: [NOTIFY_OPTION], initial_options: [NOTIFY_OPTION] },
    },
  ]);
}

/** Retrouve la carte choisie dans la modale (URL, ou « #rang »). */
function cardFromValue(value) {
  const all = getAllMedia();
  if (typeof value !== 'string') return null;
  if (value.startsWith('#')) return all[Number(value.slice(1))] || null;
  return all.find((m) => m.url === value) || null;
}

// Limites Slack : 100 options par menu, 75 caractères par option
const MAX_REMOVABLE_SHOWN = 100;

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** 🗑️ Modale « Retirer un média » : choix parmi les médias ajoutés en live. */
function buildRemoveMediaModal() {
  const removable = listCustomMedia().filter((m) => mediaNumber(m) !== null);

  if (removable.length === 0) {
    return {
      type: 'modal',
      title: { type: 'plain_text', text: 'Retirer un média' },
      close: { type: 'plain_text', text: 'Fermer' },
      blocks: [section(`ℹ️ *Aucun média ajouté depuis l'admin.*\n_Seuls les médias ajoutés en live (🖼️ Ajouter un média ou \`/jeanpip-addmedia\`) peuvent être retirés ici._`)],
    };
  }

  return modal('admin_removemedia_submit', 'Retirer un média', '🗑️ Retirer', [
    {
      type: 'input',
      block_id: 'media',
      label: { type: 'plain_text', text: 'Quel média retirer ?' },
      element: {
        type: 'static_select',
        action_id: 'value',
        placeholder: { type: 'plain_text', text: 'Choisis un média' },
        options: removable.slice(0, MAX_REMOVABLE_SHOWN).map((m) => ({
          text: { type: 'plain_text', text: truncate(m.title, 75), emoji: true },
          value: String(mediaNumber(m)),
        })),
      },
      hint: { type: 'plain_text', text: `Du plus récent au plus ancien${removable.length > MAX_REMOVABLE_SHOWN ? ` (les ${MAX_REMOVABLE_SHOWN} derniers)` : ''}. Seuls les médias ajoutés en live sont listés.` },
    },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `_Le média ne sortira plus au tirage. Ceux qui l'ont déjà le gardent (« Hors série » du classeur), son numéro n'est pas réattribué et les JP$ de l'auteur ne sont pas repris. Tu recevras un aperçu en DM._` }] },
  ]);
}

function buildAddTargetModal() {
  return modal('admin_target_add_submit', 'Ajouter une cible', 'Ajouter', [
    userInput('Qui doit recevoir un Jeanpip auto à chaque message ?'),
    { type: 'context', elements: [{ type: 'mrkdwn', text: '_La personne doit aussi être inscrite à la liste de diffusion pour recevoir quelque chose._' }] },
  ]);
}

/** ⚙️ Modale « Crédits par Jeanpip » (valeur actuelle pré-remplie). */
function buildCreditValueModal() {
  return modal('admin_credit_value_submit', 'JP$ par Jeanpip', 'Enregistrer', [
    {
      type: 'input',
      block_id: 'value',
      label: { type: 'plain_text', text: '1 Jeanpip envoyé = combien de JP$ ?' },
      element: {
        type: 'plain_text_input',
        action_id: 'value',
        initial_value: formatCredits(settings.getCreditsPerJeanpip()),
      },
      hint: { type: 'plain_text', text: `Multiple de 0,5 entre ${formatCredits(settings.CREDITS_PER_JEANPIP_MIN)} et ${settings.CREDITS_PER_JEANPIP_MAX} (ex. 0,5 · 1 · 2). S'applique aux prochains Jeanpips, pas de rétroactivité.` },
    },
  ]);
}

/** 🎟️ Bloc « Tickets ESSAI ! » de l'Accueil : règle en une phrase + compteur du jour + lien. */
function buildTicketsBlocks(userId, url) {
  const price = settings.getTicketPrice();
  const limit = settings.getTicketDailyLimit();
  const used = scratchTickets.boughtToday(userId);
  const pending = scratchTickets.pendingTicket(userId);
  const jackpot = scratch.prizeTable(price).reduce((max, p) => Math.max(max, p.amount || 0), 0);
  const status = pending
    ? '🎟️ *Tu as un ticket pas encore gratté !*'
    : used >= limit
      ? `✅ *${used}/${limit} aujourd'hui* : reviens demain 😉`
      : `_${used}/${limit} ticket${used > 1 ? 's' : ''} aujourd'hui._`;
  // 🏖️ v3.3 : Kiosque fermé le week-end (un ticket acheté avant samedi 0h peut encore être gratté)
  if (weekend.isWeekend() && !pending) {
    return [section('🏉 *Tickets à gratter ESSAI !* — 🏖️ le Kiosque est fermé le week-end, retour lundi 0h.')];
  }
  return [section(
    `🏉 *Tickets à gratter ESSAI !* — ${formatCredits(price)} JP$ le ticket, 9 ballons à gratter : *3 symboles identiques = le lot*. 🏆 Coupe = *carte légendaire*, 🥅 Poteaux = *${formatCredits(jackpot)} JP$* !
${status}`,
    { ...button(pending ? '🎟️ Gratter mon ticket' : '🎟️ Jouer', 'open_tickets_web', { style: 'primary' }), url },
  )];
}

/** 🎟️ Modale « Tickets à gratter » (prix + limite par jour, valeurs actuelles pré-remplies). */
function buildTicketsModal() {
  const numberInput = (blockId, label, min, max, value, hint) => ({
    type: 'input',
    block_id: blockId,
    label: { type: 'plain_text', text: label },
    element: { type: 'number_input', action_id: 'value', is_decimal_allowed: false, min_value: String(min), max_value: String(max), initial_value: String(value) },
    hint: { type: 'plain_text', text: hint },
  });
  return modal('admin_tickets_submit', 'Tickets à gratter', 'Enregistrer', [
    numberInput('price', "Prix d'un ticket (JP$)", settings.TICKET_PRICE_MIN, settings.TICKET_PRICE_MAX, settings.getTicketPrice(),
      `Entier de ${settings.TICKET_PRICE_MIN} à ${settings.TICKET_PRICE_MAX}. Les lots JP$ suivent le prix (×1 à ×40) et la chance de légendaire = prix ÷ 300 : la rentabilité ne change pas.`),
    numberInput('limit', 'Tickets max par jour et par joueur', settings.TICKET_DAILY_LIMIT_MIN, settings.TICKET_DAILY_LIMIT_MAX, settings.getTicketDailyLimit(),
      `Entier de ${settings.TICKET_DAILY_LIMIT_MIN} à ${settings.TICKET_DAILY_LIMIT_MAX}. Jour de Paris, effet immédiat.`),
  ]);
}

/** 🚜 Modale « Limite anti-farm » (valeur actuelle pré-remplie). */
function buildFarmLimitModal() {
  return modal('admin_farm_limit_submit', 'Limite anti-farm', 'Enregistrer', [
    {
      type: 'input',
      block_id: 'value',
      label: { type: 'plain_text', text: 'Jeanpips max par heure et par personne' },
      element: {
        type: 'number_input',
        action_id: 'value',
        is_decimal_allowed: false,
        min_value: String(settings.FARM_MAX_PER_HOUR_MIN),
        max_value: String(settings.FARM_MAX_PER_HOUR_MAX),
        initial_value: String(settings.getFarmMaxPerHour()),
      },
      hint: { type: 'plain_text', text: `Entier de ${settings.FARM_MAX_PER_HOUR_MIN} à ${settings.FARM_MAX_PER_HOUR_MAX}. Au-delà, 1 h de pénalité. Effet immédiat ; les pénalités en cours ne changent pas.` },
    },
  ]);
}

module.exports = {
  buildHomeView,
  buildFarmLimitModal,
  buildTicketsModal,
  buildCreditValueModal,
  buildRaidModal,
  raidDefenseButtons,
  raidTime,
  RAID_RULES,
  buildWeeklyGiftModal,
  buildReleaseNotesModal,
  buildGiveAttackModal,
  buildCreditsModal,
  buildAddMediaModal,
  buildRemoveMediaModal,
  buildAddTargetModal,
  buildCardTypeModal,
  buildGiveCardModal,
  GIVE_CARD_MAX,
  buildGiveBoosterModal,
  GIVE_BOOSTER_MAX,
  buildBoosterBanModal,
  banEndText,
  cardFromValue,
};
