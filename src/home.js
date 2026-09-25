// ═══════════════════════════════════════════════════════════
//  🏠 MODULE HOME
//  Construit l'onglet Accueil (App Home) du bot, PAR UTILISATEUR,
//  ainsi que les modales ouvertes depuis l'Accueil.
//  Fonctions pures : aucun appel Slack ici (voir refreshHome dans app.js).
//
//  • Partie joueur (tout le monde) : solde, score, attaque, boosters,
//    liste de diffusion.
//  • Panneau « 👑 Admin » : UNIQUEMENT construit pour les admins.
// ═══════════════════════════════════════════════════════════

const scores = require('./scores');
const credits = require('./credits');
const boosters = require('./boosters');
const broadcast = require('./broadcast');
const { RARITIES } = require('./media');
const settings = require('./settings');
const { formatCredits } = require('./admin');

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

/**
 * Coût de l'attaque pour un user : 'admin' (illimitée), 'free' (débloquée)
 * ou 'paid' (ATTACK_PRICE crédits).
 */
function attackMode(userId, isAdmin) {
  if (isAdmin) return 'admin';
  return scores.hasAttack(userId) ? 'free' : 'paid';
}

// ─────────────────────────────────────────────
// 🏠 Vue Accueil
// ─────────────────────────────────────────────

/**
 * @param {string} userId
 * @param {Object} ctx
 * @param {boolean} ctx.isAdmin
 * @param {number}  ctx.attackPrice
 * @param {string}  ctx.creditsPerJeanpipLabel
 * @param {string}  ctx.targetEmoji
 * @param {number}  ctx.farmRemainingMs   - pénalité anti-farm restante (0 si aucune)
 * @param {Function} ctx.formatRemaining  - ms → « 42 min »
 * @param {Array<{id, fixed}>} [ctx.autoTargets] - cibles auto-react (admins)
 */
function buildHomeView(userId, ctx) {
  const balance = credits.getBalance(userId);
  const score = scores.getScore(userId);
  const mode = attackMode(userId, ctx.isAdmin);
  const pending = boosters.countPending(userId);
  const subscribed = broadcast.isSubscribed(userId);

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '🤖 Jeanpip', emoji: true } },
    section(`💰 *Ton solde : ${formatCredits(balance)} crédit(s)*\n_+${ctx.creditsPerJeanpipLabel} crédit(s) à chaque réaction :${ctx.targetEmoji}: que tu poses (Jeanpip délivré, hors spam/farm)._`),
    { type: 'divider' },
  ];

  // 📊 Semaine + ⚔️ Attaque
  const scoreLine = `📊 *Ta semaine :* ${score}/${scores.ATTACK_THRESHOLD} :${ctx.targetEmoji}:`;
  let attackText;
  let attackButton = button('⚔️ Lancer une attaque', 'home_attack_open', { style: 'danger' });

  if (ctx.farmRemainingMs > 0) {
    attackText = `🚜 *Pénalité anti-farm* encore *${ctx.formatRemaining(ctx.farmRemainingMs)}* : tu ne peux pas attaquer pour l'instant.`;
    attackButton = null;
  } else if (mode === 'admin') {
    attackText = `⚔️ *Attaque Jeanpip :* 👑 illimitée (admin)`;
  } else if (mode === 'free') {
    attackText = `⚔️ *Attaque Jeanpip :* ✅ *débloquée, gratuite !* À lancer avant dimanche 20h.`;
  } else if (balance >= ctx.attackPrice) {
    const missing = Math.max(0, scores.ATTACK_THRESHOLD - score);
    attackText = `⚔️ *Attaque Jeanpip :* ${ctx.attackPrice} crédits\n_Ou envoie encore ${missing} Jeanpip(s) cette semaine pour la débloquer gratuitement._`;
  } else {
    const missing = Math.max(0, scores.ATTACK_THRESHOLD - score);
    attackText = `⚔️ *Attaque Jeanpip :* ${ctx.attackPrice} crédits — ❌ il te manque *${formatCredits(ctx.attackPrice - balance)}* crédit(s).\n_Ou envoie encore ${missing} Jeanpip(s) cette semaine pour la débloquer gratuitement._`;
    attackButton = null;
  }

  blocks.push(section(`${scoreLine}\n${attackText}`, attackButton));
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `L'attaque envoie un Jeanpip aux 7 dernières personnes inscrites ayant posté dans le channel choisi. _Scores remis à 0 chaque dimanche 20h._` }] });
  blocks.push({ type: 'divider' });

  // 🎁 Boosters
  blocks.push(section(`🎁 *Boosters* — 8 cartes chacun, plus il est cher, plus les cartes rares sont probables.`));
  blocks.push({
    type: 'actions',
    block_id: 'home_boosters',
    elements: boosters.listBoosters().map((b) => button(
      `${b.emoji} ${b.label} (${b.price})`,
      `buy_booster_${b.type}`,
      { value: b.type, ...(balance >= b.price ? { style: 'primary' } : {}) },
    )),
  });
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: pending > 0
        ? `🎁 *${pending} booster(s) non ouvert(s)* → va dans l'onglet *Messages* et clique sur « Ouvrir le booster ».`
        : `L'achat est débité tout de suite ; tu ouvres ton booster depuis l'onglet *Messages*.`,
    }],
  });
  blocks.push({ type: 'divider' });

  // 📮 Liste de diffusion
  blocks.push(section(
    subscribed
      ? `📮 *Liste de diffusion :* ✅ inscrit — tu reçois les Jeanpips que les autres t'envoient.`
      : `📮 *Liste de diffusion :* 🔕 pas inscrit — personne ne peut t'envoyer de Jeanpip (et réagir à tes messages ne rapporte rien aux autres).`,
    subscribed
      ? button('🚪 Sortir de la liste', 'broadcast_leave', { value: 'leave' })
      : button('✅ Rejoindre la liste', 'broadcast_join', { value: 'join', style: 'primary' }),
  ));

  // 👑 Panneau admin (jamais construit pour un non-admin)
  if (ctx.isAdmin) {
    blocks.push(...buildAdminBlocks(ctx.autoTargets || []));
  }

  blocks.push({ type: 'divider' });
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `❓ Guide complet : \`/jeanpip-help\` · 🤖 _Jeanpip Bot — Fait avec ❤️_` }] });

  return { type: 'home', blocks };
}

function buildAdminBlocks(autoTargets) {
  const blocks = [
    { type: 'divider' },
    { type: 'header', text: { type: 'plain_text', text: '👑 Admin', emoji: true } },
    {
      type: 'actions',
      block_id: 'home_admin',
      elements: [
        button('🎁 Offrir une attaque', 'admin_give_attack_open'),
        button('💳 Crédits ±', 'admin_credits_open'),
        button('🖼️ Ajouter un média', 'admin_addmedia_open'),
        button('🎪 Ajouter une cible', 'admin_target_add_open'),
        button('⚙️ Crédits par Jeanpip', 'admin_credit_value_open'),
      ],
    },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `⚙️ Réglage actuel : *1 Jeanpip envoyé = ${formatCredits(settings.getCreditsPerJeanpip())} crédit(s)*` }] },
    section(`🎪 *Cibles auto-react (${autoTargets.length})*${autoTargets.length ? '' : '\n_Aucune cible auto-react configurée._'}`),
  ];

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

/** ⚔️ Modale « Lancer une attaque » : choix du channel + coût. */
function buildAttackModal(userId, { isAdmin, attackPrice }) {
  const mode = attackMode(userId, isAdmin);
  const cost = {
    admin: '👑 *Illimitée* (admin)',
    free: '✅ *Gratuite* (débloquée cette semaine)',
    paid: `💰 *${attackPrice} crédits* — ton solde : *${formatCredits(credits.getBalance(userId))}*`,
  }[mode];

  return modal('home_attack_submit', 'Attaque Jeanpip', '⚔️ Lancer', [
    section(`${cost}\n\nUn Jeanpip part vers les *7 dernières personnes inscrites* ayant posté dans le channel choisi.\n_Rien n'est débité si personne n'est attaquable._`),
    {
      type: 'input',
      block_id: 'channel',
      label: { type: 'plain_text', text: 'Channel' },
      element: {
        type: 'conversations_select',
        action_id: 'value',
        placeholder: { type: 'plain_text', text: 'Choisis un channel' },
        filter: { include: ['public', 'private'], exclude_bot_users: true },
      },
      hint: { type: 'plain_text', text: 'Le bot doit être invité dans ce channel.' },
    },
  ]);
}

function buildGiveAttackModal() {
  return modal('admin_give_attack_submit', 'Offrir une attaque', 'Offrir', [
    userInput('À qui offrir une Attaque Jeanpip ?'),
  ]);
}

function buildCreditsModal() {
  return modal('admin_credits_submit', 'Crédits ±', 'Valider', [
    userInput('Personne'),
    {
      type: 'input',
      block_id: 'amount',
      label: { type: 'plain_text', text: 'Montant' },
      element: { type: 'plain_text_input', action_id: 'value', placeholder: { type: 'plain_text', text: 'ex. 50, 2,5 ou -20' } },
      hint: { type: 'plain_text', text: 'Positif = cadeau (la personne est notifiée). Négatif = correction (sans notification). Demi-crédits acceptés.' },
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
      block_id: 'title',
      optional: true,
      label: { type: 'plain_text', text: 'Titre (optionnel)' },
      element: { type: 'plain_text_input', action_id: 'value' },
      hint: { type: 'plain_text', text: 'Le numéro « Surprise #N » est attribué automatiquement.' },
    },
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
  return modal('admin_credit_value_submit', 'Crédits par Jeanpip', 'Enregistrer', [
    {
      type: 'input',
      block_id: 'value',
      label: { type: 'plain_text', text: '1 Jeanpip envoyé = combien de crédits ?' },
      element: {
        type: 'plain_text_input',
        action_id: 'value',
        initial_value: formatCredits(settings.getCreditsPerJeanpip()),
      },
      hint: { type: 'plain_text', text: `Multiple de 0,5 entre ${formatCredits(settings.CREDITS_PER_JEANPIP_MIN)} et ${settings.CREDITS_PER_JEANPIP_MAX} (ex. 0,5 · 1 · 2). S'applique aux prochains Jeanpips, pas de rétroactivité.` },
    },
  ]);
}

module.exports = {
  buildHomeView,
  buildCreditValueModal,
  buildAttackModal,
  buildGiveAttackModal,
  buildCreditsModal,
  buildAddMediaModal,
  buildAddTargetModal,
  attackMode,
};
