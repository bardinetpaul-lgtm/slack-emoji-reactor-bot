// ═══════════════════════════════════════════════════════════
//  🤝 MODULE ÉCHANGES ↔ SLACK (v3.9)
//    • Accueil : bloc « Échanges » (inscrits seulement), 3 boutons
//      et « mes échanges en cours » ;
//    • demande à une personne : modale (joueur → numéros → offre),
//      DM au vendeur (Accepter / Refuser / Contre-offre),
//      DM de résultat à l'acheteur.
//  Demande générale, contre-offres et enchères : tâches suivantes
//  (leurs boutons ouvrent pour l'instant une modale « bientôt »).
//  Règles et stockage : src/trades.js. Ici : messages et boutons.
//  Constructeurs (build*) purs → testés par scripts/test-trades-slack.js.
// ═══════════════════════════════════════════════════════════

const trades = require('./trades');
const cardIndex = require('./cardIndex');
const credits = require('./credits');
const broadcast = require('./broadcast');
const weekend = require('./weekend');

const MAX_OPTIONS = 100;          // limite Slack d'un menu
const MAX_HOME_LINES = 10;        // échanges en cours affichés dans l'Accueil
const SECTION_MAX = 2900;         // limite Slack : 3 000 caractères par section

const RARITY_ORDER = ['legendary', 'halloween', 'rose', 'epic', 'rare', 'common', 'extra'];
const RARITY_LABEL = {
  legendary: '🟡 Légendaires',
  halloween: '🎃 Halloween',
  rose: '🎀 Octobre Rose',
  epic: '🟣 Épiques',
  rare: '🔵 Rares',
  common: '⚪ Communes',
  extra: '📸 Photos anti-spam',
};

/** Erreurs de trades.* → texte pour le joueur (texte brut : sert aussi d'erreur de modale). */
const ERROR_TEXT = {
  self: 'Tu ne peux pas échanger avec toi-même.',
  blocked_buyer: 'L\'acheteur ne peut pas échanger en ce moment (pas inscrit, en pause, en plein raid ou sous pénalité anti-farm).',
  blocked_seller: 'Ce joueur ne peut pas échanger en ce moment (pas inscrit, en pause, en plein raid ou sous pénalité anti-farm).',
  unavailable: 'Cette carte n\'est plus disponible chez ce joueur.',
  cards_unavailable: 'Une des cartes proposées n\'est plus disponible (placée dans un deck, déjà proposée ailleurs ou partie).',
  floor: 'Une offre en JP$ seulement doit valoir au moins le prix de rachat de la banque',
  empty: 'Propose des JP$, une ou plusieurs de tes cartes, ou les deux.',
  balance: 'Ton solde ne suffit pas pour cette offre.',
  bad_amount: 'Le montant en JP$ doit être un nombre entier.',
  expired: 'Trop tard : cette demande a expiré.',
  closed: 'Cette demande est déjà conclue ou fermée.',
  not_seller: 'Cette demande ne t\'est pas adressée.',
  not_subscribed: 'Pour échanger, inscris-toi d\'abord à la liste de diffusion : tape /jeanpip.',
  pause: 'Jeanpip est en pause : pas d\'échange pour le moment.',
  raid: 'Tu subis un raid : pas d\'échange avant sa fin.',
  farm: 'Tu es sous pénalité anti-farm : pas d\'échange avant sa fin.',
};

const section = (text, accessory) => ({ type: 'section', text: { type: 'mrkdwn', text }, ...(accessory ? { accessory } : {}) });
const context = (text) => ({ type: 'context', elements: [{ type: 'mrkdwn', text }] });
const button = (text, actionId, extra = {}) => ({ type: 'button', text: { type: 'plain_text', text, emoji: true }, action_id: actionId, ...extra });
const plainText = (text) => ({ type: 'plain_text', text, emoji: true });
const option = (text, value) => ({ text: plainText(text.slice(0, 75)), value });

/** « 11h05 », heure de Paris. */
const hour = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).replace(':', 'h');

const pauseText = (pause) => `${pause.icon} Pas d'échange ${pause.short} : ça reprend ${pause.back}.`;

/** Texte d'erreur pour le joueur `userId`, qu'il soit bloqué lui-même ou que ce soit l'autre. */
function errorFor(error, userId, { asBuyer = true, now = Date.now() } = {}) {
  const selfBlocked = (asBuyer && error === 'blocked_buyer') || (!asBuyer && error === 'blocked_seller');
  if (selfBlocked) {
    const reason = trades.blockReason(userId, now);
    if (reason === 'pause') return pauseText(weekend.pauseFor(userId, now));
    if (reason) return ERROR_TEXT[reason];
  }
  return ERROR_TEXT[error] || ERROR_TEXT.closed;
}

const codeOf = (card) => card.code || cardIndex.codeOf(card.url, card.title);

/** Cartes du classeur groupées par rareté (ordre du classeur dans chaque groupe). */
function byRarity(cards) {
  const groups = new Map(RARITY_ORDER.map((r) => [r, []]));
  for (const c of cards) (groups.get(c.rarity) || groups.get('common')).push(c);
  return [...groups].filter(([, list]) => list.length);
}

/** Menu (static_select ou multi_static_select) groupé par rareté, ou champ texte au-delà de 100 options. */
function cardPicker(cards, { multi, placeholder, textHint }) {
  if (cards.length > MAX_OPTIONS) {
    return {
      element: { type: 'plain_text_input', action_id: 'value', placeholder: plainText(textHint) },
      hint: plainText(multi ? 'Numéros séparés par des virgules, par exemple : #12, HW3' : 'Un numéro, par exemple : HW3 ou #42'),
    };
  }
  return {
    element: {
      type: multi ? 'multi_static_select' : 'static_select',
      action_id: 'value',
      placeholder: plainText(placeholder),
      option_groups: byRarity(cards).map(([r, list]) => ({
        label: plainText(RARITY_LABEL[r]),
        options: list.map((c) => option(multi && c.title ? `${c.code} · ${c.title}` : c.code, c.code)),
      })),
    },
  };
}

/** Lignes mrkdwn coupées en sections de moins de 3 000 caractères. */
function chunkSections(lines) {
  const out = [];
  let cur = '';
  for (const line of lines) {
    if (cur && cur.length + line.length + 1 > SECTION_MAX) { out.push(section(cur)); cur = ''; }
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(section(cur));
  return out;
}

/** « 12 JP$ + #3, HW1 » */
function describeOffer(offer) {
  const parts = [];
  if (offer.jp > 0) parts.push(`*${offer.jp} JP$*`);
  if (offer.cards && offer.cards.length) parts.push(offer.cards.map((url) => `*${cardIndex.codeOf(url)}*`).join(', '));
  return parts.join(' + ') || 'rien';
}

const cardLine = (card) => `*${codeOf(card)}* (${(RARITY_LABEL[card.rarity] || RARITY_LABEL.common).replace(/s$/, '')})`;

// ─────────────────────────────────────────────
// 🏠 Accueil
// ─────────────────────────────────────────────

function homeLine(t, userId) {
  if (t.kind === 'auction') return auctionHomeLine(t, userId);   // section « Enchères et minuterie »
  const code = `*${codeOf(t.card || {})}*`;
  if (t.kind === 'direct' && t.buyer === userId) return `→ Tu demandes ${code} à <@${t.seller}> · fin à ${hour(t.expiresAt)}`;
  if (t.kind === 'direct') return `← <@${t.buyer}> te demande ${code} · réponds avant ${hour(t.expiresAt)} (dans tes messages)`;
  return `• Échange ${code} · fin à ${hour(t.expiresAt)}`;
}

/** Bloc « Échanges » de l'Accueil. */
function buildTradeBlocks(userId, now = Date.now()) {
  const head = '🤝 *Échanges de cartes* — tes cartes contre des JP$ ou d\'autres cartes, avec les autres joueurs.';
  if (!broadcast.isSubscribed(userId)) {
    return [section(`${head}\nPour échanger, inscris-toi d'abord à la liste de diffusion : tape \`/jeanpip\`.`)];
  }
  const blocks = [section(head)];
  const pause = weekend.pauseFor(userId, now);
  if (pause) {
    blocks.push(context(pauseText(pause)));
  } else {
    blocks.push({
      type: 'actions',
      block_id: 'home_trades',
      elements: [
        button('🤝 Demander une carte', 'trade_direct_open', { style: 'primary' }),
        button('📣 Demande générale', 'trade_general_open'),
        button('🔨 Mettre aux enchères', 'trade_auction_open'),
      ],
    });
  }
  const mine = trades.openTradesOf(userId).sort((a, b) => a.expiresAt - b.expiresAt);
  if (!mine.length) {
    blocks.push(context('_Aucun échange en cours._'));
  } else {
    const lines = mine.slice(0, MAX_HOME_LINES).map((t) => homeLine(t, userId));
    if (mine.length > MAX_HOME_LINES) lines.push(`_… et ${mine.length - MAX_HOME_LINES} autre(s)._`);
    blocks.push(section(`*Mes échanges en cours*\n${lines.join('\n')}`));
  }
  return blocks;
}

// ─────────────────────────────────────────────
// 🪟 Modales
// ─────────────────────────────────────────────

/** Modale d'information (sans bouton d'envoi). */
function infoModal(title, text) {
  return { type: 'modal', callback_id: 'trade_info', title: plainText(title), close: plainText('Fermer'), blocks: [section(text)] };
}

const buildSoonModal = (title) => infoModal(title, '🚧 *Bientôt disponible !* Cette façon d\'échanger arrive dans quelques jours.');

/**
 * Demande à une personne. Sans `seller` : seulement le choix du joueur
 * (dispatch_action → views.update avec le vendeur choisi).
 */
function buildDirectModal(buyer, seller = null, now = Date.now()) {
  const pause = weekend.pauseFor(buyer, now);
  if (pause) return infoModal('Demander une carte', pauseText(pause));
  const reason = trades.blockReason(buyer, now);
  if (reason) return infoModal('Demander une carte', ERROR_TEXT[reason]);

  const blocks = [{
    type: 'input',
    block_id: 'seller',
    dispatch_action: true,
    label: plainText('À qui demandes-tu une carte ?'),
    element: { type: 'users_select', action_id: 'trade_direct_seller', placeholder: plainText('Choisis un joueur'), ...(seller ? { initial_user: seller } : {}) },
  }];
  const view = {
    type: 'modal',
    callback_id: 'trade_direct_submit',
    private_metadata: seller || '',
    title: plainText('Demander une carte'),
    submit: plainText('📨 Envoyer'),
    close: plainText('Annuler'),
    blocks,
  };
  if (!seller) {
    blocks.push(context('Tu verras ensuite les numéros de ses cartes. Seuls les joueurs inscrits à `/jeanpip` peuvent échanger.'));
    return view;
  }
  if (seller === buyer) { blocks.push(section(`⚠️ ${ERROR_TEXT.self}`)); return view; }
  if (trades.blockReason(seller, now)) { blocks.push(section(`⚠️ ${ERROR_TEXT.blocked_seller}`)); return view; }

  // Liste des numéros : disponibles en gras, non disponibles barrés (jamais d'image)
  const free = trades.cessible(seller);
  const all = cardIndex.listCards();
  const available = all.filter((c) => free.has(c.url));
  const lines = byRarity(all).map(([r, list]) => `${RARITY_LABEL[r]} : ${list.map((c) => (free.has(c.url) ? `*${c.code}*` : `~${c.code}~`)).join(' ')}`);
  blocks.push(...chunkSections([`*Les cartes de <@${seller}>* — en gras : disponibles · ~barrées~ : non disponibles`, ...lines]));
  if (!available.length) {
    blocks.push(section('😕 Ce joueur n\'a aucune carte à céder pour le moment.'));
    return view;
  }
  const wanted = cardPicker(available, { multi: false, placeholder: 'Choisis un numéro', textHint: 'HW3' });
  blocks.push({ type: 'input', block_id: 'card', label: plainText('Carte demandée'), ...wanted });

  // Offre : JP$ et/ou cartes cessibles de l'acheteur
  blocks.push({
    type: 'input',
    block_id: 'jp',
    optional: true,
    label: plainText('Ton offre en JP$'),
    element: { type: 'number_input', action_id: 'value', is_decimal_allowed: false, min_value: '0', placeholder: plainText('0') },
    hint: plainText('Sans carte en échange : au moins le prix de rachat de la banque (commune 1, rare 2, épique 5, hors série 10, légendaire 20).'),
  });
  const mineFree = trades.cessible(buyer);
  const mine = all.filter((c) => mineFree.has(c.url));
  if (mine.length) {
    const offered = cardPicker(mine, { multi: true, placeholder: 'Choisis tes cartes', textHint: '#12, HW3' });
    blocks.push({ type: 'input', block_id: 'cards', optional: true, label: plainText('Et / ou tes cartes en échange'), ...offered });
  } else {
    blocks.push(context('Tu n\'as aucune carte à proposer en échange : offre des JP$.'));
  }
  blocks.push(context(`💰 Ton solde : *${credits.getBalance(buyer)} JP$*. Les JP$ proposés sont mis de côté tout de suite, et rendus si <@${seller}> refuse ou ne répond pas dans l'heure.`));
  return view;
}

// ─────────────────────────────────────────────
// 💬 Messages
// ─────────────────────────────────────────────

function sellerStatusLine(trade) {
  switch (trade.status) {
    case 'done': return `✅ *Échange conclu* : la carte est partie chez <@${trade.buyer}>, tu as reçu ${describeOffer(trade.offer)}.`;
    case 'refused': return `✖️ *Tu as refusé cette demande.* <@${trade.buyer}> a été prévenu.`;
    case 'expired': return '⌛ *Demande expirée* : tu n\'as pas répondu à temps.';
    case 'cancelled': return `🚫 *Échange annulé*${ERROR_TEXT[trade.reason] ? ` : ${ERROR_TEXT[trade.reason]}` : '.'}`;
    default: return '';
  }
}

/** DM au vendeur : la demande, puis les boutons (ouverte) ou la décision. */
function buildSellerDM(trade, sellerId) {
  const head = `🤝 *<@${trade.buyer}> te demande ta carte* ${cardLine(trade.card)}\nSon offre : ${describeOffer(trade.offer)}${trade.offer.jp > 0 ? ' (déjà mis de côté)' : ''}.`;
  const blocks = [];
  if (trade.status === 'open') {
    blocks.push(section(`${head}\n⏳ Réponds avant *${hour(trade.expiresAt)}*, sinon la demande expire.`));
    blocks.push({
      type: 'actions',
      block_id: `trade_${trade.id}`,
      elements: [
        button('✅ Accepter', 'trade_accept', { value: trade.id, style: 'primary' }),
        button('✖️ Refuser', 'trade_refuse', { value: trade.id }),
        button('💬 Contre-offre', 'trade_counter_open', { value: `${trade.id}|${sellerId}` }),
      ],
    });
  } else {
    blocks.push(section(head), context(sellerStatusLine(trade)));
  }
  return { text: `🤝 ${codeOf(trade.card)} : demande de <@${trade.buyer}>`, blocks };
}

/** DM de résultat à l'acheteur. event : 'accepted' | 'refused' | 'expired' | 'cancelled'. */
function buildBuyerResultDM(trade, event) {
  const card = cardLine(trade.card);
  const back = [
    trade.offer.jp > 0 ? `tes *${trade.offer.jp} JP$* te sont rendus` : '',
    trade.offer.cards.length ? 'tes cartes proposées sont libérées' : '',
  ].filter(Boolean).join(' et ');
  const giveBack = back ? `\n↩️ ${back.charAt(0).toUpperCase()}${back.slice(1)}.` : '';
  const text = {
    accepted: `✅ *<@${trade.seller}> a accepté ton échange !* La carte ${card} est dans ton classeur. Tu as cédé ${describeOffer(trade.offer)}.`,
    refused: `✖️ *<@${trade.seller}> a refusé ta demande* pour la carte ${card}.${giveBack}`,
    expired: `⌛ *<@${trade.seller}> n'a pas répondu à temps* : ta demande pour la carte ${card} a expiré.${giveBack}`,
    cancelled: `🚫 *Ta demande pour la carte ${card} est annulée* : ${ERROR_TEXT[trade.reason] || ERROR_TEXT.closed}${giveBack}`,
  }[event];
  return { text: text.replace(/\*/g, ''), blocks: [section(text)] };
}

function buildBuyerSentDM(trade) {
  const text = `📨 *Demande envoyée à <@${trade.seller}>* pour la carte ${cardLine(trade.card)}.\nTon offre : ${describeOffer(trade.offer)}. Réponse attendue avant *${hour(trade.expiresAt)}*, sinon tout t'est rendu.`;
  return { text: text.replace(/\*/g, ''), blocks: [section(text)] };
}

// ─────────────────────────────────────────────
// 📝 Lecture de la modale
// ─────────────────────────────────────────────

/** Codes saisis (menu ou champ texte) → { cards: [carte], bad: [code] } */
function readCodes(field) {
  if (!field) return { cards: [], bad: [] };
  const raw = field.selected_options ? field.selected_options.map((o) => o.value)
    : field.selected_option ? [field.selected_option.value]
      : String(field.value || '').split(/[,;\s]+/);
  const codes = raw.map((c) => String(c || '').trim()).filter(Boolean);
  const cards = [];
  const bad = [];
  for (const code of codes) { const c = cardIndex.byCode(code); if (c) cards.push(c); else bad.push(code); }
  return { cards, bad };
}

/** Erreur de trades.createDirect → champ de la modale. */
const FIELD_OF = { floor: 'jp', bad_amount: 'jp', empty: 'jp', balance: 'jp', cards_unavailable: 'cards', unavailable: 'card' };

// ─────────────────────────────────────────────
// 🔌 Branchement Slack
//    ctx = { sendDM(client, userId, msg) → { channel, ts } | null (réduit au silence en pause),
//            openModal(client, body, view, logger), refreshHome(client, userId, logger) }
// ─────────────────────────────────────────────

let registered = null;

function register(app, ctx) {
  registered = ctx;
  const log = (what, e) => console.error(`❌ Échanges (${what}) :`, e.data ? e.data.error : e.message);
  const dm = async (client, userId, msg) => { try { return await ctx.sendDM(client, userId, msg); } catch (e) { log(`DM <@${userId}>`, e); return null; } };
  const refresh = (client, users) => Promise.all([...new Set(users)].filter(Boolean).map((u) => ctx.refreshHome(client, u, console)));
  // Réponse à un clic dans un DM : visible du seul joueur, jamais un nouveau DM
  const reply = async (client, body, text) => {
    if (!body.channel) return;
    try { await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text }); } catch (e) { log('réponse au clic', e); }
  };
  const updateSellerDM = async (client, trade, sellerId, body) => {
    const ref = (trade.dms && trade.dms[sellerId]) || (body.channel && body.message ? { channel: body.channel.id, ts: body.message.ts } : null);
    if (!ref) return;
    const msg = buildSellerDM(trade, sellerId);
    try { await client.chat.update({ channel: ref.channel, ts: ref.ts, text: msg.text, blocks: msg.blocks }); } catch (e) { log('mise à jour DM vendeur', e); }
  };

  // 🏠 Boutons de l'Accueil
  app.action('trade_direct_open', async ({ ack, body, client, logger }) => {
    await ack();
    await ctx.openModal(client, body, buildDirectModal(body.user.id), logger);
  });
  app.action('trade_general_open', async ({ ack, body, client, logger }) => {
    await ack();
    await ctx.openModal(client, body, buildSoonModal('Demande générale'), logger);
  });
  // 👤 Choix du vendeur : la modale se complète avec ses numéros et l'offre
  app.action('trade_direct_seller', async ({ ack, body, action, client }) => {
    await ack();
    try {
      await client.views.update({ view_id: body.view.id, hash: body.view.hash, view: buildDirectModal(body.user.id, action.selected_user || null) });
    } catch (e) { log('mise à jour de la modale', e); }
  });

  // 📨 Envoi de la demande
  app.view('trade_direct_submit', async ({ ack, body, view, client }) => {
    const buyer = body.user.id;
    const now = Date.now();
    const values = view.state.values;
    const seller = (values.seller && values.seller.trade_direct_seller && values.seller.trade_direct_seller.selected_user) || view.private_metadata || null;
    const fail = (field, text) => ack({ response_action: 'errors', errors: { [values[field] ? field : 'seller']: text } });

    const pause = weekend.pauseFor(buyer, now);
    if (pause) return fail('seller', pauseText(pause));
    if (!seller) return fail('seller', 'Choisis un joueur.');
    const wanted = readCodes(values.card && values.card.value);
    if (wanted.bad.length || wanted.cards.length !== 1) return fail('card', wanted.bad.length ? `Numéro inconnu : ${wanted.bad[0]}.` : 'Choisis une carte.');
    const offered = readCodes(values.cards && values.cards.value);
    if (offered.bad.length) return fail('cards', `Numéro inconnu : ${offered.bad.join(', ')}.`);
    const raw = values.jp && values.jp.value && values.jp.value.value;
    const jp = raw == null || String(raw).trim() === '' ? 0 : Number(raw);

    const res = trades.createDirect({ buyer, seller, code: wanted.cards[0].code, jp, cards: offered.cards.map((c) => c.url), now });
    if (!res.ok) {
      let text = errorFor(res.error, buyer, { asBuyer: true, now });
      if (res.error === 'floor') text = `${ERROR_TEXT.floor} : ${trades.floor(wanted.cards[0].rarity)} JP$ minimum pour cette carte.`;
      return fail(FIELD_OF[res.error] || 'seller', text);
    }
    await ack();
    const { trade } = res;
    console.log(`🤝 <@${buyer}> demande ${trade.card.code} à <@${seller}> (${trade.offer.jp} JP$ + ${trade.offer.cards.length} carte(s)) → ${trade.id}`);
    const ref = await dm(client, seller, buildSellerDM(trade, seller));
    if (ref) trades.setDm(trade.id, seller, ref);
    await dm(client, buyer, buildBuyerSentDM(trade));
    await refresh(client, [buyer, seller]);
  });

  // ✅ / ✖️ Réponse du vendeur
  const sellerAction = (actionId, decide, event) => app.action(actionId, async ({ ack, body, action, client }) => {
    await ack();
    const userId = body.user.id;
    const now = Date.now();
    const tradeId = String(action.value || '').split('|')[0];
    const pause = weekend.pauseFor(userId, now);
    if (pause) return reply(client, body, pauseText(pause));

    const res = decide(tradeId, userId, now);
    if (res.ok || (res.trade && res.trade.status !== 'open')) {
      const { trade } = res;
      console.log(`🤝 ${trade.id} : ${trade.status} (${trade.reason}) par <@${userId}>`);
      if (res.ok && event === 'accepted') recordDone(trade);
      await updateSellerDM(client, trade, userId, body);
      await dm(client, trade.buyer, buildBuyerResultDM(trade, res.ok ? event : 'cancelled'));
      if (!res.ok) await reply(client, body, errorFor(res.error, userId, { asBuyer: false, now }));
      await refresh(client, [trade.buyer, userId]);
      return;
    }
    await reply(client, body, errorFor(res.error, userId, { asBuyer: false, now }));
    const current = trades.getTrade(tradeId);
    if (current && current.status !== 'open' && current.seller === userId) await updateSellerDM(client, current, userId, body);
  });
  sellerAction('trade_accept', trades.accept, 'accepted');
  sellerAction('trade_refuse', trades.refuse, 'refused');
  registerAuction(app, ctx);   // 🔨 section « Enchères et minuterie »
}

/**
 * Le joueur quitte /jeanpip : ses échanges en cours sont annulés (trades.onUnsubscribe,
 * tâche 5, si présent) et les Accueils concernés republiés.
 */
async function onUnsubscribe(client, userId) {
  const involved = new Set([userId]);
  for (const t of trades.openTradesOf(userId)) { involved.add(t.buyer); involved.add(t.seller); }
  if (typeof trades.onUnsubscribe === 'function') trades.onUnsubscribe(userId, Date.now());
  if (!registered) return;
  await Promise.all([...involved].filter(Boolean).map((u) => registered.refreshHome(client, u, console)));
}

module.exports = {
  ERROR_TEXT,
  buildTradeBlocks,
  buildDirectModal,
  buildSellerDM,
  buildBuyerResultDM,
  register,
  onUnsubscribe,
};

// ═══════════════════════════════════════════════════════════
//  🔨 ENCHÈRES ET MINUTERIE (v3.9, tâche 8)
//    • Accueil « Mettre aux enchères » → modale (mes cartes cessibles,
//      prix de départ ≥ plancher, heure de fin calculée) ;
//    • DM d'annonce à chaque inscrit sauf le vendeur (image, prix actuel,
//      fin, bouton Enchérir), mis à jour à chaque enchère ;
//    • DM au précédent meilleur enchérisseur quand il est dépassé ;
//    • runTick(client, logger) : trades.tick() puis les DM de fin
//      (enchères réglées, demandes expirées ou annulées) ;
//    • événement trade_done à chaque échange conclu (recordDone).
//  Pendant une pause : aucun DM (ctx.sendDM est réduit au silence).
// ═══════════════════════════════════════════════════════════

const events = require('./events');
const { cardThumbUrl } = require('./cardImages');
const { parisDay } = require('./octobreRose');

Object.assign(ERROR_TEXT, {
  ends_in_pause: 'Cette enchère finirait pendant une pause (week-end ou fermeture de l\'entreprise) : relance-la un autre jour.',
  too_low: 'Enchère trop basse.',
  already_best: 'Tu es déjà le meilleur enchérisseur : attends qu\'on te dépasse.',
  ended: 'Cette enchère est terminée.',
  blocked: 'Tu ne peux pas enchérir en ce moment (pas inscrit, en pause, en plein raid ou sous pénalité anti-farm).',
  self_bid: 'Tu ne peux pas enchérir sur ta propre enchère.',
  not_found: 'Cet échange n\'existe plus.',
  card_lost: 'La carte n\'est plus disponible (partie, volée ou placée dans un deck).',
  unsubscribed: 'Un des joueurs a quitté la liste /jeanpip.',
  stopped: 'Cet échange n\'a pas pu aboutir.',
});

/** DM du vendeur d'une demande, par sorte (la section « demande générale » peut ajouter la sienne). */
const SELLER_DM_BUILDERS = { direct: buildSellerDM };

/** « mercredi 4/11 à 10h00 », heure de Paris. */
function whenText(ms) {
  const day = new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'numeric' });
  return `${day} à ${hour(ms)}`;
}

/** Image de la carte pour Slack (adresse publique, comme le classeur), ou null. */
function cardImage(card) {
  const known = cardIndex.byCode(codeOf(card)) || {};
  const src = cardThumbUrl({ url: card.url, type: card.type || known.type || 'image' });
  if (!src) return null;
  if (/^https?:\/\//.test(src)) return src;
  const base = (process.env.WEB_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  return base ? `${base}/${src}` : null;
}

const imageBlock = (card) => {
  const url = cardImage(card);
  return url ? [{ type: 'image', image_url: url, alt_text: String(card.title || codeOf(card)).slice(0, 2000) }] : [];
};

const bestOf = (trade) => (trade.bids && trade.bids.length ? trade.bids[trade.bids.length - 1] : null);

/** Un échange conclu → événement trade_done (statistiques). `offer` : ce que l'acheteur a donné (défaut : son offre, ou l'enchère gagnante). */
function recordDone(trade, offer = null) {
  const best = bestOf(trade);
  const given = offer || (trade.kind === 'auction' ? { jp: best ? best.jp : 0, cards: [] } : trade.offer || {});
  events.record('trade_done', trade.buyer, {
    tradeId: trade.id,
    kind: trade.kind,
    card: trade.card && trade.card.url,
    jp: given.jp || 0,
    cards: given.cards || [],
    seller: trade.seller,
  });
}

/** Ligne de l'Accueil pour une enchère (vendeur ou enchérisseur). */
function auctionHomeLine(t, userId) {
  const best = bestOf(t);
  const price = `${best ? best.jp : t.startPrice} JP$`;
  const code = `*${codeOf(t.card || {})}*`;
  if (t.seller === userId) return `🔨 Ta carte ${code} est aux enchères · prix actuel ${price} · fin ${whenText(t.endsAt)}`;
  if (best && best.userId === userId) return `🥇 Tu mènes l'enchère sur ${code} (${price}) · fin ${whenText(t.endsAt)}`;
  return `🔨 Tu as été dépassé sur l'enchère ${code} (${price}) · fin ${whenText(t.endsAt)} (dans tes messages)`;
}

function auctionStatusLine(trade) {
  const best = bestOf(trade);
  if (trade.status === 'done') return `✅ *Adjugée* à <@${trade.buyer}> pour *${best ? best.jp : 0} JP$*.`;
  if (trade.status === 'expired') return `⌛ *Terminée sans enchère* : la carte reste à <@${trade.seller}>.`;
  return `🚫 *Enchère annulée* : ${ERROR_TEXT[trade.reason] || ERROR_TEXT.ended}`;
}

/** Modale « Mettre aux enchères ». */
function buildAuctionModal(seller, now = Date.now()) {
  const title = 'Mettre aux enchères';
  const pause = weekend.pauseFor(seller, now);
  if (pause) return infoModal(title, pauseText(pause));
  const reason = trades.blockReason(seller, now);
  if (reason) return infoModal(title, ERROR_TEXT[reason]);
  const endsAt = trades.auctionEnd(now);
  if (weekend.isPausedDay(parisDay(endsAt))) return infoModal(title, `⏸️ ${ERROR_TEXT.ends_in_pause}`);
  const free = trades.cessible(seller);
  const mine = cardIndex.listCards().filter((c) => free.has(c.url));
  if (!mine.length) return infoModal(title, '😕 Tu n\'as aucune carte à mettre aux enchères (les cartes de tes decks et celles déjà en jeu ne comptent pas).');

  const picked = cardPicker(mine, { multi: false, placeholder: 'Choisis une carte', textHint: 'HW3' });
  return {
    type: 'modal',
    callback_id: 'trade_auction_submit',
    title: plainText(title),
    submit: plainText('🔨 Lancer'),
    close: plainText('Annuler'),
    blocks: [
      section('🔨 *Mets une de tes cartes aux enchères.* Tous les joueurs inscrits à `/jeanpip` sont prévenus et peuvent enchérir en JP$. La plus haute enchère emporte la carte.'),
      { type: 'input', block_id: 'card', label: plainText('Carte mise en vente'), ...picked },
      {
        type: 'input',
        block_id: 'price',
        optional: true,
        label: plainText('Prix de départ en JP$'),
        element: { type: 'number_input', action_id: 'value', is_decimal_allowed: false, min_value: '1', placeholder: plainText('Le minimum de la carte') },
        hint: plainText('Au moins le prix de rachat de la banque (commune 1, rare 2, épique 5, hors série 10, légendaire 20). Vide : ce minimum.'),
      },
      context(`⏰ Durée : 12 h. Lancée maintenant, elle finit *${whenText(endsAt)}* (une fin entre 20h et 9h est repoussée à 10h). Ta carte est réservée jusque-là ; sans enchère, elle te reste.`),
    ],
  };
}

/** DM d'une enchère, vu par `viewerId` (annonce, ou suivi pour le vendeur). */
function buildAuctionDM(trade, viewerId = null) {
  const best = bestOf(trade);
  const open = trade.status === 'open';
  const isSeller = viewerId === trade.seller;
  const lines = [
    isSeller ? `🔨 *Ta carte ${cardLine(trade.card)} est aux enchères*` : `🔨 *<@${trade.seller}> met aux enchères sa carte* ${cardLine(trade.card)}`,
    best ? `💰 Prix actuel : *${best.jp} JP$* (meilleure offre : <@${best.userId}>)` : `💰 Prix de départ : *${trade.startPrice} JP$* (aucune enchère pour l'instant)`,
  ];
  if (open) lines.push(`⏰ Fin : *${whenText(trade.endsAt)}*`);
  if (open && best && best.userId === viewerId) lines.push('🥇 Tu es le meilleur enchérisseur pour l\'instant.');
  const blocks = [section(lines.join('\n')), ...imageBlock(trade.card)];
  if (open && !isSeller) {
    blocks.push({ type: 'actions', block_id: `auction_${trade.id}`, elements: [button('🔨 Enchérir', 'trade_bid_open', { value: trade.id, style: 'primary' })] });
  } else if (!open) {
    blocks.push(context(auctionStatusLine(trade)));
  }
  return { text: `🔨 Enchère : ${codeOf(trade.card)} à ${best ? best.jp : trade.startPrice} JP$`, blocks };
}

/** Modale « Enchérir » (minimum = trades.minBid). */
function buildBidModal(trade, userId, now = Date.now()) {
  const title = 'Enchérir';
  if (!trade || trade.kind !== 'auction' || trade.status !== 'open' || now >= trade.endsAt) return infoModal(title, ERROR_TEXT.ended);
  if (trade.seller === userId) return infoModal(title, ERROR_TEXT.self_bid);
  const pause = weekend.pauseFor(userId, now);
  if (pause) return infoModal(title, pauseText(pause));
  const reason = trades.blockReason(userId, now);
  if (reason) return infoModal(title, ERROR_TEXT[reason]);
  const best = bestOf(trade);
  if (best && best.userId === userId) return infoModal(title, `🥇 ${ERROR_TEXT.already_best}`);
  const min = trades.minBid(trade);
  return {
    type: 'modal',
    callback_id: 'trade_bid_submit',
    private_metadata: trade.id,
    title: plainText(title),
    submit: plainText('🔨 Enchérir'),
    close: plainText('Annuler'),
    blocks: [
      section(`🔨 Enchère de <@${trade.seller}> : ${cardLine(trade.card)}\n${best ? `💰 Prix actuel : *${best.jp} JP$*` : `💰 Prix de départ : *${trade.startPrice} JP$*`} · fin *${whenText(trade.endsAt)}*`),
      ...imageBlock(trade.card),
      {
        type: 'input',
        block_id: 'jp',
        label: plainText('Ton enchère en JP$'),
        element: { type: 'number_input', action_id: 'value', is_decimal_allowed: false, min_value: String(min), initial_value: String(min) },
        hint: plainText(`Au moins ${min} JP$.`),
      },
      context(`💰 Ton solde : *${credits.getBalance(userId)} JP$*. Ton enchère est mise de côté tout de suite, et rendue si quelqu'un enchérit plus haut.`),
    ],
  };
}

function buildOutbidDM(trade, userId) {
  const best = bestOf(trade);
  const mine = [...(trade.bids || [])].reverse().find((b) => b.userId === userId);
  const text = `😬 *Tu as été dépassé* sur l'enchère de <@${trade.seller}> pour la carte ${cardLine(trade.card)} : nouvelle offre *${best.jp} JP$*.\n↩️ Tes *${mine ? mine.jp : 0} JP$* te sont rendus. Fin *${whenText(trade.endsAt)}*.`;
  return {
    text: text.replace(/\*/g, ''),
    blocks: [section(text), { type: 'actions', block_id: `outbid_${trade.id}`, elements: [button('🔨 Enchérir encore', 'trade_bid_open', { value: trade.id, style: 'primary' })] }],
  };
}

/** DM de fin d'enchère. outcome : 'sold' | 'no_bid' | 'cancelled' ; who : 'seller' | 'winner' | 'bidder'. */
function buildAuctionEndDM(trade, outcome, who) {
  const best = bestOf(trade);
  const card = cardLine(trade.card);
  let text;
  if (outcome === 'sold') {
    text = who === 'seller'
      ? `✅ *Ta carte ${card} est vendue !* <@${trade.buyer}> la remporte pour *${best.jp} JP$*, versés sur ton solde.`
      : `🎉 *Tu remportes l'enchère !* La carte ${card} est dans ton classeur, pour *${best.jp} JP$*.`;
  } else if (outcome === 'no_bid') {
    text = `⌛ *Ton enchère sur la carte ${card} est terminée sans enchère* : la carte reste dans ton classeur.`;
  } else {
    text = who === 'seller'
      ? `🚫 *Ton enchère sur la carte ${card} est annulée* : ${ERROR_TEXT.card_lost}`
      : `🚫 *L'enchère de <@${trade.seller}> sur la carte ${card} est annulée* : ${ERROR_TEXT.card_lost}\n↩️ Tes *${best ? best.jp : 0} JP$* te sont rendus.`;
  }
  return { text: text.replace(/\*/g, ''), blocks: [section(text)] };
}

/** DM de fin d'une demande générale (la demande à une personne a buildBuyerResultDM). */
function buildRequestEndDM(trade, event) {
  const back = trade.offer && trade.offer.jp > 0 ? `\n↩️ Tes *${trade.offer.jp} JP$* te sont rendus.` : '';
  const card = cardLine(trade.card);
  const text = event === 'expired'
    ? `⌛ *Ta demande générale pour la carte ${card} a expiré* sans preneur.${back}`
    : `🚫 *Ta demande générale pour la carte ${card} est annulée* : ${ERROR_TEXT[trade.reason] || ERROR_TEXT.closed}${back}`;
  return { text: text.replace(/\*/g, ''), blocks: [section(text)] };
}

function buildCounterEndDM(trade, sellerId, event) {
  const text = event === 'counter_expired'
    ? `⌛ *La contre-offre de <@${sellerId}>* pour la carte ${cardLine(trade.card)} a expiré.`
    : `🚫 *La contre-offre de <@${sellerId}>* pour la carte ${cardLine(trade.card)} est annulée.`;
  return { text: text.replace(/\*/g, ''), blocks: [section(text)] };
}

// ── Envoi (avec le ctx de register : sendDM réduit au silence pendant une pause) ──
const tickLog = (what, e) => console.error(`❌ Échanges (${what}) :`, e.data ? e.data.error : e.message);

async function safeDM(client, userId, msg) {
  if (!registered || !userId) return null;
  try { return await registered.sendDM(client, userId, msg); } catch (e) { tickLog(`DM <@${userId}>`, e); return null; }
}

async function updateDM(client, ref, msg) {
  try { await client.chat.update({ channel: ref.channel, ts: ref.ts, text: msg.text, blocks: msg.blocks }); } catch (e) { tickLog('mise à jour d\'un DM', e); }
}

async function refreshAll(client, users) {
  if (!registered) return;
  await Promise.all([...new Set(users)].filter(Boolean).map((u) => registered.refreshHome(client, u, console)));
}

/** Met à jour tous les DM d'une enchère (prix actuel, ou résultat). */
async function updateAuctionDMs(client, trade) {
  for (const [userId, ref] of Object.entries(trade.dms || {})) await updateDM(client, ref, buildAuctionDM(trade, userId));
}

/** Met à jour les DM des vendeurs d'une demande close. */
async function updateSellerDMs(client, trade) {
  const build = SELLER_DM_BUILDERS[trade.kind];
  if (!build) return;
  for (const [userId, ref] of Object.entries(trade.dms || {})) {
    if (userId !== trade.buyer) await updateDM(client, ref, build(trade, userId));
  }
}

async function handleTickEvent(client, ev, involved) {
  const { trade, event } = ev;
  involved.add(trade.seller);
  involved.add(trade.buyer);
  if (trade.kind === 'auction') {
    for (const b of trade.bids || []) involved.add(b.userId);
    // 'settled' + outcome 'cancelled' (carte placée dans un deck…) = annulation, comme 'cancelled' (carte partie)
    const outcome = event === 'settled' ? ev.outcome : 'cancelled';
    const best = bestOf(trade);
    console.log(`🔨 ${trade.id} : enchère ${outcome}${best ? ` (${best.jp} JP$, <@${best.userId}>)` : ''}`);
    if (outcome === 'sold') {
      recordDone(trade);
      await safeDM(client, trade.seller, buildAuctionEndDM(trade, 'sold', 'seller'));
      await safeDM(client, trade.buyer, buildAuctionEndDM(trade, 'sold', 'winner'));
    } else if (outcome === 'no_bid') {
      await safeDM(client, trade.seller, buildAuctionEndDM(trade, 'no_bid', 'seller'));
    } else {
      await safeDM(client, trade.seller, buildAuctionEndDM(trade, 'cancelled', 'seller'));
      if (best) await safeDM(client, best.userId, buildAuctionEndDM(trade, 'cancelled', 'bidder'));
    }
    await updateAuctionDMs(client, trade);
    return;
  }

  if (event === 'counter_expired' || event === 'counter_cancelled') {
    involved.add(ev.counter);
    await safeDM(client, trade.buyer, buildCounterEndDM(trade, ev.counter, event));
    return;
  }
  // Demande annulée « pour pause » : elle a pu expirer avant la pause (bot redémarré le week-end) → texte neutre
  const shown = trade.reason === 'pause' ? { ...trade, reason: 'stopped' } : trade;
  for (const u of Object.keys(trade.dms || {})) involved.add(u);
  console.log(`🤝 ${trade.id} : ${event} (${trade.reason})`);
  const msg = trade.kind === 'direct' ? buildBuyerResultDM(shown, event === 'expired' ? 'expired' : 'cancelled') : buildRequestEndDM(shown, event);
  await safeDM(client, trade.buyer, msg);
  await updateSellerDMs(client, shown);
}

/**
 * Minuterie (toutes les 10 s, et au démarrage pour rattraper un arrêt) :
 * fait avancer les échanges et prévient les joueurs. → les événements traités.
 */
async function runTick(client, logger = console) {
  const evs = trades.tick(Date.now());
  if (!evs.length) return evs;
  const involved = new Set();
  for (const ev of evs) {
    try { await handleTickEvent(client, ev, involved); } catch (e) { logger.error(`❌ Échanges (minuterie ${ev.trade && ev.trade.id}) :`, e.message); }
  }
  await refreshAll(client, [...involved]);
  return evs;
}

function registerAuction(app, ctx) {
  // 🏠 Bouton de l'Accueil
  app.action('trade_auction_open', async ({ ack, body, client, logger }) => {
    await ack();
    await ctx.openModal(client, body, buildAuctionModal(body.user.id), logger);
  });

  // 🔨 Lancement : annonce à chaque inscrit sauf le vendeur, suivi pour le vendeur
  app.view('trade_auction_submit', async ({ ack, body, view, client }) => {
    const seller = body.user.id;
    const now = Date.now();
    const values = view.state.values;
    const fail = (field, text) => ack({ response_action: 'errors', errors: { [values[field] ? field : 'card']: text } });

    const pause = weekend.pauseFor(seller, now);
    if (pause) return fail('card', pauseText(pause));
    const wanted = readCodes(values.card && values.card.value);
    if (wanted.bad.length || wanted.cards.length !== 1) return fail('card', wanted.bad.length ? `Numéro inconnu : ${wanted.bad[0]}.` : 'Choisis une carte.');
    const raw = values.price && values.price.value && values.price.value.value;
    const price = raw == null || String(raw).trim() === '' ? null : Number(raw);
    if (price != null && !Number.isInteger(price)) return fail('price', ERROR_TEXT.bad_amount);

    const card = wanted.cards[0];
    const res = trades.createAuction({ seller, code: card.code, startPrice: price, now });
    if (!res.ok) {
      if (res.error === 'floor') return fail('price', `Prix de départ trop bas : ${trades.floor(card.rarity)} JP$ minimum pour cette carte.`);
      if (res.error === 'blocked_seller') return fail('card', errorFor(res.error, seller, { asBuyer: false, now }));
      return fail('card', ERROR_TEXT[res.error] || ERROR_TEXT.closed);
    }
    await ack();
    const { trade, recipients } = res;
    console.log(`🔨 <@${seller}> met ${trade.card.code} aux enchères à ${trade.startPrice} JP$ → ${trade.id} (${recipients.length} inscrit(s) prévenus)`);
    for (const u of [seller, ...recipients]) {
      const ref = await safeDM(client, u, buildAuctionDM(trade, u));
      if (ref) trades.setDm(trade.id, u, ref);
    }
    await refreshAll(client, [seller]);
  });

  // 🔨 Bouton Enchérir (DM d'annonce ou DM « dépassé »)
  app.action('trade_bid_open', async ({ ack, body, action, client, logger }) => {
    await ack();
    await ctx.openModal(client, body, buildBidModal(trades.getTrade(String(action.value || '')), body.user.id), logger);
  });

  // 💰 Enchère
  app.view('trade_bid_submit', async ({ ack, body, view, client }) => {
    const userId = body.user.id;
    const now = Date.now();
    const tradeId = view.private_metadata;
    const fail = (text) => ack({ response_action: 'errors', errors: { jp: text } });

    const pause = weekend.pauseFor(userId, now);
    if (pause) return fail(pauseText(pause));
    const field = view.state.values.jp && view.state.values.jp.value;
    const raw = field && field.value;
    if (raw == null || String(raw).trim() === '') return fail('Indique ton enchère en JP$.');

    const res = trades.bid(tradeId, userId, Number(raw), now);
    if (!res.ok) {
      switch (res.error) {
        case 'too_low': return fail(`${ERROR_TEXT.too_low} Au moins ${trades.minBid(res.trade)} JP$.`);
        case 'self': return fail(ERROR_TEXT.self_bid);
        case 'balance': return fail(`${ERROR_TEXT.balance} (${credits.getBalance(userId)} JP$)`);
        case 'blocked': { const reason = trades.blockReason(userId, now); return fail(reason ? ERROR_TEXT[reason] : ERROR_TEXT.blocked); }
        case 'already_best': return fail(ERROR_TEXT.already_best);
        default: return fail(ERROR_TEXT.ended);
      }
    }
    await ack();
    const { trade, outbid } = res;
    console.log(`🔨 ${trade.id} : <@${userId}> enchérit ${bestOf(trade).jp} JP$${outbid ? ` (dépasse <@${outbid}>)` : ''}`);
    if (outbid) await safeDM(client, outbid, buildOutbidDM(trade, outbid));
    await updateAuctionDMs(client, trade);
    await refreshAll(client, [userId, outbid, trade.seller]);
  });
}

module.exports.SELLER_DM_BUILDERS = SELLER_DM_BUILDERS;
module.exports.buildAuctionModal = buildAuctionModal;
module.exports.buildAuctionDM = buildAuctionDM;
module.exports.buildBidModal = buildBidModal;
module.exports.recordDone = recordDone;
module.exports.runTick = runTick;
