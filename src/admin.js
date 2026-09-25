// ═══════════════════════════════════════════════════════════
//  👑 MODULE ADMIN
//  Logique des actions admin, partagée entre les commandes slash
//  (/jeanpip-give, /jeanpip-give-credits, /jeanpip-addmedia, /jeanpip-auto)
//  et le panneau « 👑 Admin » de l'onglet Accueil.
//
//  Chaque action fait le travail (+ notifie la personne ciblée si besoin)
//  et renvoie { ok, error?, text, blocks? } : c'est l'APPELANT qui décide
//  comment répondre à l'admin (DM pour une commande, erreur dans la modale
//  ou DM de confirmation pour l'Accueil).
// ═══════════════════════════════════════════════════════════

const scores = require('./scores');
const credits = require('./credits');
const targets = require('./targets');
const { addMedia, getRarityInfo } = require('./media');
const { buildMediaBlocks } = require('./blocks');

// 🎨 Crédits offerts à l'auteur d'un média, selon sa rareté
const AUTHOR_REWARDS = { common: 10, rare: 15, epic: 20, legendary: 30 };

/** Formate un nombre de crédits à la française (12.5 → « 12,5 »). */
function formatCredits(n) {
  return String(n).replace('.', ',');
}

/** Bloc section mrkdwn simple. */
function section(text) {
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

/**
 * @param {Object} deps
 * @param {Function} deps.safeSendDM - (client, userId, message, logger) → bool
 * @param {Function} deps.isBot      - (client, userId) → bool
 * @param {string}   deps.targetEmoji
 */
function createAdminActions({ safeSendDM, isBot, targetEmoji }) {
  // ─────────────────────────────────────────────
  // 🎁 Offrir une Attaque Jeanpip
  // ─────────────────────────────────────────────
  async function giveAttack(client, adminId, targetId, logger) {
    if (await isBot(client, targetId)) {
      return { ok: false, error: 'bot', text: `🤖 *Impossible de créditer un bot.*` };
    }

    if (!scores.giveAttack(targetId)) {
      logger.info(`ℹ️ <@${targetId}> avait déjà une attaque, give ignoré`);
      return { ok: false, error: 'already', text: `ℹ️ *<@${targetId}> a déjà une Attaque Jeanpip disponible.*\nRien à faire.` };
    }

    await safeSendDM(client, targetId, {
      text: `🎁 On t'a offert une Attaque Jeanpip !`,
      blocks: [section(`🎁 *On t'a offert une Attaque Jeanpip !* :${targetEmoji}:\n\nUn admin vient de te créditer une Attaque Jeanpip 🎉\n\n*Comment l'activer :*\nTape la commande \`/jeanpip-attack\` dans n'importe quel channel (ou clique sur ⚔️ dans l'onglet *Accueil* du bot) pour envoyer un Jeanpip aux 7 dernières personnes ayant posté dans le canal choisi !\n\n⚠️ _Si tu ne l'actives pas avant dimanche 20h, tu la perds._`)],
    }, logger);

    logger.info(`🎁 <@${adminId}> a offert une attaque à <@${targetId}>`);
    return { ok: true, text: `✅ *Attaque Jeanpip offerte à <@${targetId}> !*\nLa personne a été notifiée.` };
  }

  // ─────────────────────────────────────────────
  // 💳 Ajouter (montant > 0, notifie) ou retirer (montant < 0, sans notif)
  //    des crédits. Arrondi au demi-crédit.
  // ─────────────────────────────────────────────
  async function adjustCredits(client, adminId, targetId, rawAmount, logger) {
    const amount = Math.round(Number(rawAmount) * 2) / 2;
    if (!Number.isFinite(amount) || amount === 0) {
      return { ok: false, error: 'amount', text: `❓ *Montant invalide.* Il doit être non nul (demi-crédits acceptés, ex. \`2,5\` ou \`-10\`).` };
    }

    if (await isBot(client, targetId)) {
      return { ok: false, error: 'bot', text: `🤖 *Impossible de créditer un bot.*` };
    }

    if (amount > 0) {
      // ➕ Cadeau : on ajoute et on notifie la personne
      const newBalance = credits.addCredit(targetId, amount);

      await safeSendDM(client, targetId, {
        text: `🎁 Un admin t'a offert ${formatCredits(amount)} crédits JeanPip !`,
        blocks: [section(`🎁 *Un admin t'a offert ${formatCredits(amount)} crédit(s) JeanPip !* 💰\n\nNouveau solde : *${formatCredits(newBalance)}* crédit(s)\n\nDépense-les avec \`/jeanpip-booster\` ou depuis l'onglet *Accueil* du bot ! 🎁`)],
      }, logger);

      logger.info(`💳 <@${adminId}> a crédité +${amount} à <@${targetId}> (solde ${newBalance})`);
      return { ok: true, text: `✅ *${formatCredits(amount)} crédit(s) offert(s) à <@${targetId}>.*\nNouveau solde de la personne : *${formatCredits(newBalance)}*.` };
    }

    // ➖ Correction : on retire (solde jamais négatif), sans notifier la personne
    const before = credits.getBalance(targetId);
    const newBalance = credits.setBalance(targetId, before + amount); // amount négatif
    const removed = before - newBalance;

    logger.info(`💳 <@${adminId}> a corrigé <@${targetId}> : ${before} → ${newBalance}`);
    return { ok: true, text: `✅ *Correction appliquée à <@${targetId}>.*\nAncien solde : *${formatCredits(before)}* → nouveau solde : *${formatCredits(newBalance)}* (retiré : ${formatCredits(removed)}).\n\n_La personne n'a pas été notifiée._` };
  }

  // ─────────────────────────────────────────────
  // 🖼️ Ajouter un média à la banque (rareté déjà normalisée)
  //    `authorId` (optionnel, jamais un bot : à vérifier AVANT) = la personne
  //    qui a fourni l'image : elle est créditée de AUTHOR_REWARDS[rareté].
  //    Synchrone (utilisable avant l'ack d'une modale) : le DM à l'auteur
  //    se fait ensuite avec notifyMediaAuthor().
  //    Renvoie un aperçu du média dans `blocks`.
  // ─────────────────────────────────────────────
  function addMediaToBank(adminId, { url, rarity, title, authorId }, logger) {
    const result = addMedia({ url, rarity, title, author: authorId });

    if (!result.ok) {
      const reason = {
        url_invalide: 'Le lien est invalide (il doit commencer par http:// ou https://).',
        rarete_invalide: 'La rareté est invalide.',
        ecriture: `Erreur d'écriture du fichier${result.detail ? ` : ${result.detail}` : ''}.`,
      }[result.error] || 'Erreur inconnue.';
      return { ok: false, error: result.error, text: `❌ *Impossible d'ajouter le média.*\n${reason}` };
    }

    const info = getRarityInfo(rarity);
    logger.info(`🖼️ <@${adminId}> a ajouté un média ${rarity} (${result.media.type}) : ${url}${authorId ? ` — auteur <@${authorId}>` : ''}`);

    // 🎨 Récompense de l'auteur
    let author = null;
    let authorLine = '';
    if (authorId) {
      const reward = AUTHOR_REWARDS[rarity];
      const newBalance = credits.addCredit(authorId, reward);
      author = { id: authorId, reward, newBalance };
      logger.info(`🎨 <@${authorId}> a reçu +${reward} pour son média ${rarity} (solde ${newBalance})`);
      authorLine = `\n🎨 Attribué à <@${authorId}> : *+${formatCredits(reward)} crédit(s)* (nouveau solde : *${formatCredits(newBalance)}*). La personne a été notifiée.`;
    }

    const text = `✅ *Média ajouté à la banque !*\n\n🔢 Numéro attribué : *Surprise #${result.number}*\n${info.emoji} Rareté : *${info.label}* · Type : *${result.media.type}*\n📊 Il y a maintenant *${result.count}* média(s) en ${info.label}.${authorLine}\n\n👇 Aperçu :`;

    return {
      ok: true,
      text,
      blocks: [
        section(text),
        ...buildMediaBlocks({ headerText: `🖼️ *Nouveau Jeanpip ${info.label}*`, media: result.media }),
      ],
      media: result.media,
      number: result.number,
      author,
    };
  }

  /** 🎨 DM à l'auteur d'un média ajouté (résultat ok de addMediaToBank). Ne fait rien sans auteur. */
  async function notifyMediaAuthor(client, result, logger) {
    if (!result.ok || !result.author) return;
    const { id, reward, newBalance } = result.author;
    const info = getRarityInfo(result.media.rarity);

    await safeSendDM(client, id, {
      text: `🎨 Ton image est entrée dans la banque JeanPip : +${formatCredits(reward)} crédits !`,
      blocks: [
        section(`🎨 *Ton image est entrée dans la banque JeanPip !* :${targetEmoji}:\n\nMerci pour ta contribution 🙏 Elle a été ajoutée en ${info.emoji} *${info.label}* (*Surprise #${result.number}*).\n\n💰 *+${formatCredits(reward)} crédit(s)* — nouveau solde : *${formatCredits(newBalance)}*\n\nDépense-les avec \`/jeanpip-booster\` ou depuis l'onglet *Accueil* du bot ! 🎁`),
        ...buildMediaBlocks({ headerText: `🖼️ *Ta carte ${info.label}*`, media: result.media }),
      ],
    }, logger);
  }

  // ─────────────────────────────────────────────
  // 🎪 Cibles auto-react
  // ─────────────────────────────────────────────
  function addAutoTarget(adminId, targetId, logger) {
    const res = targets.addTarget(targetId);
    logger.info(`🎪 add <@${targetId}> par <@${adminId}> → ${res}`);
    return {
      ok: res === 'added',
      error: res === 'added' ? undefined : res,
      text: {
        added: `✅ <@${targetId}> est maintenant une cible auto-react ! :${targetEmoji}:`,
        already: `ℹ️ <@${targetId}> est déjà une cible auto-react.`,
        env: `ℹ️ <@${targetId}> est déjà défini comme cible fixe dans le .env.`,
      }[res],
    };
  }

  function removeAutoTarget(adminId, targetId, logger) {
    const res = targets.removeTarget(targetId);
    logger.info(`🎪 remove <@${targetId}> par <@${adminId}> → ${res}`);
    return {
      ok: res === 'removed',
      error: res === 'removed' ? undefined : res,
      text: {
        removed: `✅ <@${targetId}> n'est plus une cible auto-react.`,
        not_found: `ℹ️ <@${targetId}> n'était pas une cible auto-react.`,
        env: `⚠️ <@${targetId}> est une cible fixe du .env, impossible de la retirer en live. Modifie le .env et redémarre le bot.`,
      }[res],
    };
  }

  /** Liste des cibles : [{ id, fixed }] (fixed = définie dans le .env). */
  function listAutoTargets() {
    const envSet = new Set(targets.ENV_TARGETS);
    return targets.getTargets().map((id) => ({ id, fixed: envSet.has(id) }));
  }

  return {
    giveAttack,
    adjustCredits,
    addMediaToBank,
    notifyMediaAuthor,
    addAutoTarget,
    removeAutoTarget,
    listAutoTargets,
  };
}

module.exports = { createAdminActions, formatCredits, AUTHOR_REWARDS };
