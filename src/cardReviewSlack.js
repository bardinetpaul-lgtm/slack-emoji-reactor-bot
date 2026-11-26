// ═══════════════════════════════════════════════════════════
//  👀 VALIDATION DES NOUVELLES CARTES : Slack (v4.4.2)
//  Règles et stockage : src/cardReview.js. Ici : le DM au valideur, ses
//  boutons, la minuterie des 12 h et les messages aux admins.
//
//  ctx = {
//    sendDM(client, userId, msg) → { channel, ts } | null,
//    publish(client, { url, rarity, title, authorId, adminId, arch }, logger)
//      → résultat de addMediaToBank ({ ok, number, media, text }) : SYNCHRONE
//        jusqu'à l'ajout à la banque (le reste se fait ensuite, sans attendre),
//    remove(client, number, adminId, logger) → { ok, text },
//    rarityInfo(rarity) → { emoji, label },
//  }
// ═══════════════════════════════════════════════════════════

const cardReview = require('./cardReview');
const { buildMediaBlocks } = require('./blocks');

const RARITY_KEYS = ['common', 'rare', 'epic', 'legendary'];

const section = (text) => ({ type: 'section', text: { type: 'mrkdwn', text } });
const context = (text) => ({ type: 'context', elements: [{ type: 'mrkdwn', text }] });
const plain = (text) => ({ type: 'plain_text', text, emoji: true });

/** « jeudi 26/11 à 21h30 », heure de Paris. */
function whenText(ms) {
  const day = new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'numeric' });
  const hour = new Date(ms).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
  return `${day} à ${hour}`;
}

/** DM du valideur pour une demande, selon son état. */
function buildReviewDM(review, rarityInfo) {
  const label = (r) => { const i = rarityInfo(r); return `${i.emoji} ${i.label}`; };
  const final = cardReview.finalRarity(review);
  const lines = [
    `👀 *Nouvelle carte à valider pour Jeanpip* (n° ${review.id})`,
    `🃏 *Nom :* ${review.title ? review.title : '_sans titre (numéro « Surprise » attribué à la publication)_'}`,
    `🎨 *Proposée par :* ${review.authorId ? `<@${review.authorId}>` : '_auteur non précisé_'} · ajoutée par <@${review.adminId}>`,
    `🎚️ *Rareté conseillée :* ${label(review.rarity)}${review.chosen && review.chosen !== review.rarity ? ` · *ton choix :* ${label(review.chosen)}` : ''}`,
  ];
  const media = { type: 'image', url: review.url, title: review.mediaTitle || review.title || `Carte n° ${review.id}`, rarity: final };
  const preview = buildMediaBlocks({ headerText: '🖼️ *La carte :*', media }).filter((b) => b.type !== 'divider');
  const blocks = [section(lines.join('\n')), ...preview];

  if (review.status === 'pending') {
    blocks.push(context(`⏳ Sans réponse avant *${whenText(review.deadline)}*, elle part dans le jeu telle quelle, en ${label(final)}.`));
    blocks.push({
      type: 'actions',
      block_id: `card_review_${review.id}`,
      elements: [
        { type: 'button', text: plain(`✅ Valider en ${rarityInfo(final).label}`), action_id: 'card_review_ok', value: String(review.id), style: 'primary' },
        {
          type: 'button', text: plain('✖️ Invalider'), action_id: 'card_review_no', value: String(review.id), style: 'danger',
          confirm: { title: plain('Invalider la carte ?'), text: plain('Elle ne sera jamais mise dans le jeu.'), confirm: plain('Invalider'), deny: plain('Annuler') },
        },
        {
          type: 'static_select', action_id: 'card_review_rarity', placeholder: plain('🎚️ Changer la rareté'),
          options: RARITY_KEYS.map((r) => ({ text: plain(label(r)), value: `${review.id}|${r}` })),
          initial_option: { text: plain(label(final)), value: `${review.id}|${final}` },
        },
      ],
    });
  } else if (review.status === 'published') {
    const how = review.how === 'timeout' ? '⌛ *Publiée telle quelle* (pas de réponse en 12 h)' : '✅ *Validée et publiée*';
    blocks.push(context(`${how} en ${label(final)}${review.number ? ` : *Surprise #${review.number}*` : ''}.`));
    blocks.push({
      type: 'actions',
      block_id: `card_review_${review.id}`,
      elements: [{
        type: 'button', text: plain('🗑️ Retirer du jeu'), action_id: 'card_review_remove', value: String(review.id), style: 'danger',
        confirm: { title: plain('Retirer la carte ?'), text: plain('Elle sort du catalogue et ne sera plus tirée. Ceux qui l\'ont déjà la gardent (Hors série).'), confirm: plain('Retirer'), deny: plain('Annuler') },
      }],
    });
  } else if (review.status === 'refused') {
    blocks.push(context('✖️ *Invalidée* : elle n\'a jamais été mise dans le jeu.'));
  } else if (review.status === 'removed') {
    blocks.push(context(`🗑️ *Retirée du jeu*${review.number ? ` (Surprise #${review.number})` : ''} : elle ne sort plus au tirage.`));
  }
  return { text: `👀 Nouvelle carte à valider (n° ${review.id})`, blocks };
}

/** DM à l'admin qui l'a ajoutée : la décision du valideur. */
function buildAdminNoticeDM(review, event, rarityInfo) {
  const i = rarityInfo(cardReview.finalRarity(review));
  const who = cardReview.reviewer() ? `<@${cardReview.reviewer()}>` : 'Le valideur';
  const what = review.title ? `« ${review.title} »` : `n° ${review.id}`;
  const text = {
    sent: `👀 *Carte ${what} envoyée à ${who} pour validation.* Sans réponse, elle part dans le jeu le *${whenText(review.deadline)}*.`,
    validated: `✅ *${who} a validé la carte ${what}* en ${i.emoji} ${i.label} : elle est dans le jeu (Surprise #${review.number}).`,
    timeout: `⌛ *Carte ${what} publiée telle quelle* en ${i.emoji} ${i.label} (Surprise #${review.number}) : ${who} n'a pas répondu en 12 h.`,
    refused: `✖️ *${who} a invalidé la carte ${what}* : elle n'est pas mise dans le jeu.`,
    removed: `🗑️ *${who} a retiré du jeu la carte ${what}* (Surprise #${review.number}).`,
    failed: `❌ *La carte ${what} n'a pas pu être publiée* : ${review.error || 'erreur inconnue'}. Elle reste en attente.`,
  }[event];
  return { text: text.replace(/\*/g, ''), blocks: [section(text)] };
}

function register(app, ctx) {
  const { rarityInfo } = ctx;

  async function refreshDM(client, review) {
    if (!review.dm) return;
    try {
      const msg = buildReviewDM(review, rarityInfo);
      await client.chat.update({ channel: review.dm.channel, ts: review.dm.ts, text: msg.text, blocks: msg.blocks });
    } catch (e) {
      console.error('❌ Validation des cartes (DM) :', e.data ? e.data.error : e.message);
    }
  }
  const tellAdmin = (client, review, event) => ctx.sendDM(client, review.adminId, buildAdminNoticeDM(review, event, rarityInfo));

  /**
   * Publie une demande en attente (synchrone jusqu'à l'ajout à la banque : pas de double publication).
   * → la demande à jour, ou null si elle n'était plus en attente.
   */
  function publishNow(client, id, how, logger) {
    const review = cardReview.get(id);
    if (!review || review.status !== 'pending') return null;
    const result = ctx.publish(client, { url: review.url, rarity: cardReview.finalRarity(review), title: review.title, authorId: review.authorId, adminId: review.adminId, arch: review.arch }, logger);
    if (!result.ok) {
      logger.error(`❌ Carte n° ${id} : publication impossible`, result.text);
      return { ...review, failed: true, error: (result.text || '').split('\n').pop() };
    }
    return cardReview.update(id, (r) => {
      Object.assign(r, { status: 'published', how, decidedAt: Date.now(), number: result.number, mediaTitle: result.media && result.media.title });
    });
  }

  /** Nouvelle carte d'un admin → DM au valideur. Retourne la demande créée. */
  async function submit(client, card, logger) {
    const review = cardReview.create(card);
    const ref = await ctx.sendDM(client, cardReview.reviewer(), buildReviewDM(review, rarityInfo));
    const saved = cardReview.update(review.id, (r) => { r.dm = ref ? { channel: ref.channel, ts: ref.ts } : null; });
    logger.info(`👀 Carte n° ${review.id} envoyée en validation à <@${cardReview.reviewer()}>`);
    await tellAdmin(client, saved, 'sent');
    return saved;
  }

  const isReviewer = (body) => body.user && body.user.id === cardReview.reviewer();

  app.action('card_review_ok', async ({ ack, body, action, client, logger }) => {
    await ack();
    if (!isReviewer(body)) return;
    const review = publishNow(client, action.value, 'validated', logger);
    if (!review) return refreshDM(client, cardReview.get(action.value));
    if (review.failed) return tellAdmin(client, review, 'failed');
    await refreshDM(client, review);
    await tellAdmin(client, review, 'validated');
  });

  app.action('card_review_no', async ({ ack, body, action, client }) => {
    await ack();
    if (!isReviewer(body)) return;
    let changed = false;
    const review = cardReview.update(action.value, (r) => {
      if (r.status !== 'pending') return false;
      Object.assign(r, { status: 'refused', decidedAt: Date.now() });
      changed = true;
      return true;
    });
    if (!review) return;
    await refreshDM(client, review);
    if (changed) await tellAdmin(client, review, 'refused');
  });

  app.action('card_review_rarity', async ({ ack, body, action, client, logger }) => {
    await ack();
    if (!isReviewer(body)) return;
    const [id, rarity] = String((action.selected_option && action.selected_option.value) || '').split('|');
    if (!RARITY_KEYS.includes(rarity)) return;
    const review = cardReview.update(id, (r) => {
      if (r.status !== 'pending') return false;
      r.chosen = rarity;
      return true;
    });
    if (!review) return;
    logger.info(`🎚️ Carte n° ${id} : rareté choisie par le valideur → ${rarity}`);
    await refreshDM(client, review);
  });

  app.action('card_review_remove', async ({ ack, body, action, client, logger }) => {
    await ack();
    if (!isReviewer(body)) return;
    const review = cardReview.get(action.value);
    if (!review || review.status !== 'published' || !review.number) return;
    const res = ctx.remove(client, review.number, body.user.id, logger);
    if (!res.ok) logger.error(`❌ Carte n° ${review.id} : retrait impossible`, res.text);
    const updated = cardReview.update(review.id, (r) => {
      if (r.status !== 'published') return false;
      Object.assign(r, { status: 'removed', decidedAt: Date.now() });
      return true;
    });
    await refreshDM(client, updated);
    if (res.ok) await tellAdmin(client, updated, 'removed');
  });

  /** ⏰ Demandes sans réponse depuis 12 h → publiées telles quelles. */
  async function runTick(client, logger = console) {
    for (const due of cardReview.due()) {
      const review = publishNow(client, due.id, 'timeout', logger);
      if (!review) continue;
      if (review.failed) continue;   // reste en attente : nouvel essai au prochain passage
      logger.info(`⌛ Carte n° ${review.id} publiée telle quelle (pas de réponse en 12 h)`);
      await refreshDM(client, review);
      await tellAdmin(client, review, 'timeout');
    }
  }

  return { submit, runTick };
}

module.exports = { register, buildReviewDM, buildAdminNoticeDM, RARITY_KEYS };
