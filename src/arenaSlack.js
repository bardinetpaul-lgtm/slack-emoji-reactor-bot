// ═══════════════════════════════════════════════════════════
//  ⚔️ MODULE ARÈNE ↔ SLACK
//  Tout ce qui lance un combat depuis Slack et en rend compte :
//    • Accueil : bloc « ⚔️ Arène » (état, boutons Défier / Combat rapide)
//    • Défi : modale (adversaire + arène) → DM à la cible avec
//      Accepter / Refuser, 60 s pour répondre
//    • Combat rapide : file de 60 s, association automatique
//    • Combat trouvé : DM à chacun avec SON lien vers la page de combat
//    • Fin : DM récap privé (résultat, cartes perdues, butin, booster)
//  Les règles (défis, file, combats, règlement) vivent dans src/game/ ;
//  ici on ne fait que des messages et des boutons.
//
//  Les constructeurs de messages (build*) sont purs → testés par
//  scripts/test-arena-slack.js ; register(app, ctx) branche les actions.
// ═══════════════════════════════════════════════════════════

const matchmaking = require('./game/matchmaking');
const matches = require('./game/matches');
const arenaStore = require('./game/arenaStore');
const dailyStreak = require('./game/dailyStreak');
const arenas = require('./game/arenas');
const deckRules = require('./game/deck');
const collections = require('./collections');

const OFFICE_NOTE = '🏢 _L\'Arène s\'ouvre depuis le bureau de Lorient ou d\'Asnières (page web)._';
const SWEEP_MS = 5000;

const REASONS = {
  self: 'Tu ne peux pas te défier toi-même.',
  busy_from: 'Tu as déjà un combat, un défi ou une recherche en cours.',
  busy_to: 'Cette personne est déjà en combat (ou cherche un adversaire).',
  busy: 'Tu as déjà un combat ou un défi en cours.',
  cards_from: 'Il te faut au moins 8 cartes dans ta collection pour combattre.',
  cards_to: 'Cette personne n\'a pas encore 8 cartes : elle ne peut pas combattre.',
  cards: 'Il te faut au moins 8 cartes dans ta collection pour combattre.',
  arena_locked: 'Cette arène n\'est pas encore débloquée pour toi.',
  not_found: 'Ce défi a expiré ou a déjà été traité.',
  not_target: 'Ce défi ne t\'est pas adressé.',
  bot: 'Impossible de défier un bot.',
};
const reasonText = (r) => REASONS[r] || 'Impossible pour le moment.';

const arenaName = (key) => (arenas.byKey(key) || arenas.ARENAS[0]).name;

const section = (text, accessory) => ({ type: 'section', text: { type: 'mrkdwn', text }, ...(accessory ? { accessory } : {}) });
const button = (text, actionId, extra = {}) => ({ type: 'button', text: { type: 'plain_text', text, emoji: true }, action_id: actionId, ...extra });
const context = (text) => ({ type: 'context', elements: [{ type: 'mrkdwn', text }] });

// ─────────────────────────────────────────────
// 🏠 Accueil : état d'un joueur pour le bloc « ⚔️ Arène »
// ─────────────────────────────────────────────

/**
 * → { userId, stats, streak, ranking, cards, next, match: { status, url } | null, inQueue, outgoing, incoming, deckUrl }
 * `links` = { arena(matchId, userId), deck(userId) } (web.js ; null si page web désactivée).
 */
function homeState(userId, links, now = Date.now()) {
  const stats = arenaStore.getStats(userId);
  const m = matches.getMatchOf(userId);
  const status = matchmaking.statusOf(userId, now);
  return {
    userId,
    stats,
    streak: dailyStreak.preview(arenaStore.getStreak(userId), now),
    ranking: arenaStore.ranking({ userId }),
    cards: deckRules.totalCopies(collections.getCollection(userId)),
    next: arenas.nextUnlock(stats.wins),
    match: m ? { status: m.status, url: links.arena(m.id, userId) } : null,
    inQueue: status.inQueue,
    outgoing: status.outgoing,
    incoming: status.incoming,
    deckUrl: links.deck(userId),
    web: Boolean(links.deck(userId)),
  };
}

/** Blocs « ⚔️ Arène » de l'Accueil. */
function buildHomeBlocks(a) {
  const s = a.stats;
  const record = `🏆 *${s.wins}* V · *${s.losses}* D · *${s.draws}* N${s.streak > 1 ? ` · 🔥 ${s.streak} victoires d'affilée` : ''}`;
  const next = a.next ? ` · 🔓 ${a.next.name} dans ${a.next.winsLeft} victoire${a.next.winsLeft > 1 ? 's' : ''}` : '';
  const streak = a.streak ? `\n${streakLine(a.streak)}` : '';
  const blocks = [section(`⚔️ *Arène* — duels de cartes en temps réel, 2 min, avec tes vraies cartes.\n${record}${next}${streak}`)];
  const deckBtn = a.deckUrl ? { ...button('🃏 Mon deck', 'open_deck_web'), url: a.deckUrl } : null;

  if (!a.web) {
    blocks.push(context('_L\'Arène n\'est pas disponible pour le moment (page web désactivée)._'));
    return blocks;
  }
  if (a.match && a.match.url) {
    const label = a.match.status === 'running' ? 'Ton combat est en cours !' : 'Ton combat t\'attend : prépare ton deck.';
    blocks.push(section(`▶️ *${label}*`, { ...button('▶️ Rejoindre mon combat', 'arena_enter_web', { style: 'primary' }), url: a.match.url }));
    return blocks;
  }
  for (const c of a.incoming) {
    blocks.push(section(`📨 <@${c.from}> te défie (${arenaName(c.arena)}) !`, button('✅ Accepter', 'arena_accept', { value: c.id, style: 'primary' })));
  }
  if (a.cards < deckRules.DECK_SIZE) {
    blocks.push(context(`_Il te faut au moins ${deckRules.DECK_SIZE} cartes pour combattre (tu en as ${a.cards}). Ouvre des boosters !_`));
    if (deckBtn) blocks.push({ type: 'actions', elements: [deckBtn] });
    return blocks;
  }
  if (a.inQueue) {
    blocks.push(section('⚡ *Recherche d\'un adversaire…* (60 s max)', button('✖️ Quitter la file', 'arena_queue_leave')));
    return blocks;
  }
  if (a.outgoing) {
    blocks.push(section(`⏳ *Défi envoyé à <@${a.outgoing.to}>* (${arenaName(a.outgoing.arena)}), en attente de sa réponse…`, button('✖️ Annuler', 'arena_challenge_cancel', { value: a.outgoing.id })));
    return blocks;
  }
  blocks.push({
    type: 'actions',
    block_id: 'home_arena',
    elements: [
      button('⚔️ Défier quelqu\'un', 'arena_challenge_open', { style: 'primary' }),
      button('⚡ Combat rapide', 'arena_queue_join'),
      ...(deckBtn ? [deckBtn] : []),
    ],
  });
  blocks.push(context('_Défi : tu choisis ton adversaire et l\'arène. Combat rapide : le premier joueur disponible (60 s). Les cartes posées sont en jeu !_'));
  return blocks;
}

/** 📅 « Série : jour 3/6 ✅ · reviens le prochain jour ouvré pour 10 JP$ » */
function streakLine(s) {
  const reached = s.step ? `jour *${s.step}/${dailyStreak.LENGTH}*${s.doneToday ? ' ✅' : ''}` : 'pas commencée';
  const gain = `*${dailyStreak.rewardText(s.next.reward)}*`;
  return s.doneToday
    ? `📅 Série : ${reached} · reviens le prochain jour ouvré pour ${gain}`
    : `📅 Série : ${reached} · ton 1er combat du jour rapporte ${gain}`;
}

const MEDALS = ['🥇', '🥈', '🥉'];
const rankLine = (r, me) => {
  const place = MEDALS[r.rank - 1] || `${r.rank}.`;
  const line = `${place} <@${r.userId}> · *${r.wins}* V · ${r.winRate} %`;
  return r.userId === me ? `*→* ${line} ← toi` : line;
};

/** 🏆 Classement général de l'Arène (Accueil) : top 10 + sa propre place. */
function buildRankingBlocks(ranking, userId) {
  if (!ranking || !ranking.top.length) {
    return [section('🏆 *Classement de l\'Arène*\n_Personne n\'a encore combattu : la première place est libre !_')];
  }
  const lines = ranking.top.map((r) => rankLine(r, userId));
  const inTop = ranking.top.some((r) => r.userId === userId);
  if (ranking.me && !inTop) lines.push('…', rankLine(ranking.me, userId));
  const blocks = [section(`🏆 *Classement de l'Arène*\n${lines.join('\n')}`)];
  blocks.push(context(ranking.me || inTop
    ? '_Victoires depuis le début, puis % de victoire, puis combats joués. Mis à jour à chaque fin de combat._'
    : '_Victoires depuis le début, puis % de victoire. Termine un combat pour entrer au classement !_'));
  return blocks;
}

// ─────────────────────────────────────────────
// 🪟 Modale « Défier quelqu'un »
// ─────────────────────────────────────────────

function buildChallengeModal(userId) {
  const wins = arenaStore.getStats(userId).wins;
  const open = arenas.unlocked(wins);
  const best = arenas.levelOf(wins).key;
  const option = (key) => ({ text: { type: 'plain_text', text: `🏟️ ${arenaName(key)}`, emoji: true }, value: key });
  return {
    type: 'modal',
    callback_id: 'arena_challenge_submit',
    title: { type: 'plain_text', text: 'Défier quelqu\'un' },
    submit: { type: 'plain_text', text: '⚔️ Défier' },
    close: { type: 'plain_text', text: 'Annuler' },
    blocks: [
      { type: 'input', block_id: 'foe', label: { type: 'plain_text', text: 'Ton adversaire' }, element: { type: 'users_select', action_id: 'value', placeholder: { type: 'plain_text', text: 'Choisis un collègue' } } },
      { type: 'input', block_id: 'arena', label: { type: 'plain_text', text: 'Arène' }, element: { type: 'static_select', action_id: 'value', options: open.map(option), initial_option: option(best) } },
      context('_Il a 60 s pour accepter. Chacun se bat avec son deck actif (🃏 Mon deck). Les cartes posées sont en jeu : le perdant perd ses poses, le vainqueur en gagne une._'),
    ],
  };
}

// ─────────────────────────────────────────────
// 💬 Messages privés
// ─────────────────────────────────────────────

function buildChallengeDM(c) {
  return {
    text: `⚔️ <@${c.from}> te défie à l'Arène !`,
    blocks: [
      section(`⚔️ *<@${c.from}> te défie à l'Arène !*\n🏟️ ${arenaName(c.arena)} · tu as *60 s* pour répondre.`),
      { type: 'actions', elements: [button('✅ Accepter', 'arena_accept', { value: c.id, style: 'primary' }), button('✖️ Refuser', 'arena_refuse', { value: c.id })] },
      context('_Tu te bats avec ton deck actif. Les cartes posées sont en jeu !_'),
    ],
  };
}

/** Message qui remplace le défi une fois traité (accepté, refusé, expiré, annulé). */
function buildClosedDM(text) {
  return { text, blocks: [section(text)] };
}

function buildMatchDM({ opponent, arena, url }) {
  const blocks = [section(`⚔️ *Combat contre <@${opponent}>* — 🏟️ ${arenaName(arena)}\nPrépare ton deck puis clique « Prêt » : le combat démarre au plus tard dans *60 s*.`)];
  if (url) blocks.push({ type: 'actions', elements: [{ ...button('▶️ Entrer dans l\'Arène', 'arena_enter_web', { style: 'primary' }), url }] });
  else blocks.push(context('_La page de combat est indisponible pour le moment._'));
  blocks.push(context(`${OFFICE_NOTE} Si tu ne viens pas, le combat est annulé sans rien perdre.`));
  return { text: `⚔️ Combat contre <@${opponent}> : entre dans l'Arène !`, blocks };
}

const END_REASONS = { qg: 'Tour principale détruite', towers: 'Plus de tours détruites', qg_hp: 'Tour principale plus solide', forfeit: 'Abandon', disconnect: 'Déconnexion', draw: 'Égalité parfaite' };
const cardList = (list) => list.map((c) => c.title).join(', ');

/**
 * Récap privé de fin de combat pour `userId`.
 * match = état de src/game/matches.js ; summary = résultat de settle.js ;
 * links.openBooster(boosterId, userId) → URL d'ouverture animée (ou null).
 */
function buildResultDM(match, summary, userId, links = {}) {
  const side = match.players.A.userId === userId ? 'A' : 'B';
  const foeSide = side === 'A' ? 'B' : 'A';
  const opponent = match.players[foeSide].userId;
  const me = (summary && summary[side]) || { lost: [], kept: [], loot: null, stolen: null, boosterId: null, credits: 0 };

  if (match.status === 'cancelled') {
    const text = `⚪ Combat contre <@${opponent}> annulé : rien n'est perdu.`;
    return { text, blocks: [section(`⚪ *Combat contre <@${opponent}> annulé* : rien n'est perdu, rien n'est gagné.`)] };
  }
  const result = match.engine && match.engine.result;
  const winner = result ? result.winner : null;
  const why = result ? `${result.outOfCards ? 'Toutes les cartes jouées · ' : ''}${END_REASONS[result.reason] || ''}` : '';
  const title = winner === side ? `🏆 *Victoire contre <@${opponent}> !*` : winner ? `💥 *Défaite contre <@${opponent}>*` : `🤝 *Match nul contre <@${opponent}>*`;
  const lines = [`${title}${why ? ` _(${why})_` : ''}`];
  if (me.lost.length) lines.push(`➖ Cartes perdues : ${cardList(me.lost)}`);
  if (me.kept.length) lines.push(`➕ Cartes revenues : ${cardList(me.kept)}`);
  if (me.loot) lines.push(`🃏 Butin : *${me.loot.title}* rejoint ta collection !`);
  if (me.stolen) lines.push(`🃏 *${me.stolen.title}* part chez <@${opponent}>.`);
  if (me.boosterId) lines.push(`🎁 Récompense : *1 booster Commun* + *${me.credits} JP$* !`);
  if (me.streak) {
    const gain = me.streak.boosterId ? '*1 booster Rare*' : `*+${me.streak.credits} JP$*`;
    const last = me.streak.step >= dailyStreak.LENGTH ? ' Série complète : elle repart au jour 1 au prochain combat.' : '';
    lines.push(`📅 Série, jour ${me.streak.step}/${dailyStreak.LENGTH} : ${gain} !${last}`);
  }
  const blocks = [section(lines.join('\n'))];
  // 🎁 Un jeu de boutons par booster gagné (victoire, série)
  const boosterButtons = (boosterId, label) => {
    const openUrl = links.openBooster ? links.openBooster(boosterId, userId) : null;
    return {
      type: 'actions',
      elements: [
        ...(openUrl ? [{ ...button(`🎬 Ouvrir le ${label}`, 'open_booster_web', { style: 'primary' }), url: openUrl }] : []),
        button(openUrl ? '💬 Ouvrir dans Slack' : `🎁 Ouvrir le ${label}`, 'open_booster', { value: boosterId, ...(openUrl ? {} : { style: 'primary' }) }),
      ],
    };
  };
  if (me.boosterId) blocks.push(boosterButtons(me.boosterId, 'booster Commun'));
  if (me.streak && me.streak.boosterId) blocks.push(boosterButtons(me.streak.boosterId, 'booster Rare'));
  const text = `${winner === side ? '🏆 Victoire' : winner ? '💥 Défaite' : '🤝 Match nul'} contre <@${opponent}>`;
  return { text, blocks };
}

// ─────────────────────────────────────────────
// 🔌 Branchement Slack
//    ctx = { sendDM(client, userId, msg) → { channel, ts }, isBot(client, userId),
//            openModal(client, body, view, logger), refreshHome(client, userId, logger),
//            homeViewers() → [userId] (Accueils déjà ouverts, optionnel),
//            links: { arena, deck, openBooster } }
// ─────────────────────────────────────────────

function register(app, ctx) {
  matchmaking.configure({
    isBusy: (u) => matches.isBusy(u),
    cardCount: (u) => deckRules.totalCopies(collections.getCollection(u)),
    winsOf: (u) => arenaStore.getStats(u).wins,
  });

  const challengeMsgs = new Map();   // défi → { to: {channel, ts}, from: {channel, ts} }
  const queueMsgs = new Map();       // joueur → {channel, ts}
  let client = null;

  const safe = (what, fn) => fn().catch((e) => console.error(`❌ Arène (${what}) :`, e.data ? e.data.error : e.message));
  const dm = async (userId, msg) => { try { return await ctx.sendDM(client, userId, msg); } catch (e) { console.error(`❌ Arène DM <@${userId}> :`, e.data ? e.data.error : e.message); return null; } };
  const edit = async (ref, msg) => { if (ref) { try { await client.chat.update({ channel: ref.channel, ts: ref.ts, text: msg.text, blocks: msg.blocks }); } catch { /* message introuvable : tant pis */ } } };
  const refresh = (...users) => Promise.all(users.map((u) => ctx.refreshHome(client, u, console)));

  /** Combat créé : un DM avec son propre lien à chacun. */
  async function announceMatch(match) {
    const a = match.players.A.userId;
    const b = match.players.B.userId;
    await dm(a, buildMatchDM({ opponent: b, arena: match.arena, url: ctx.links.arena(match.id, a) }));
    await dm(b, buildMatchDM({ opponent: a, arena: match.arena, url: ctx.links.arena(match.id, b) }));
    await refresh(a, b);
  }

  async function startMatch(userA, userB, arena) {
    const res = matches.createMatchFor(userA, userB, Date.now(), { arena });
    if (!res.ok) {
      const msg = buildClosedDM(`⚠️ Le combat n'a pas pu démarrer : ${reasonText(res.reason)}`);
      await dm(userA, msg);
      await dm(userB, msg);
      await refresh(userA, userB);
      return null;
    }
    await announceMatch(res.match);
    return res.match;
  }

  // ── Défier quelqu'un ──
  app.action('arena_challenge_open', async ({ ack, body, client: c }) => {
    await ack();
    client = c;
    await ctx.openModal(c, body, buildChallengeModal(body.user.id), console);
  });

  app.view('arena_challenge_submit', async ({ ack, body, view, client: c }) => {
    client = c;
    const from = body.user.id;
    const values = view.state.values;
    const to = values.foe.value.selected_user;
    const arena = values.arena.value.selected_option && values.arena.value.selected_option.value;
    if (!to) return ack({ response_action: 'errors', errors: { foe: 'Choisis ton adversaire.' } });
    if (await ctx.isBot(c, to)) return ack({ response_action: 'errors', errors: { foe: reasonText('bot') } });
    const res = matchmaking.createChallenge(from, to, Date.now(), { arena });
    if (!res.ok) return ack({ response_action: 'errors', errors: { [res.reason === 'arena_locked' ? 'arena' : 'foe']: reasonText(res.reason) } });
    await ack();
    return safe('défi', async () => {
      const toRef = await dm(to, buildChallengeDM(res));
      const fromRef = await dm(from, buildClosedDM(`⏳ Défi envoyé à <@${to}> (🏟️ ${arenaName(res.arena)}) : il a 60 s pour répondre.`));
      challengeMsgs.set(res.id, { to: toRef, from: fromRef });
      await refresh(from, to);
    });
  });

  // ── Répondre à un défi ──
  app.action('arena_accept', async ({ ack, body, action, client: c }) => {
    await ack();
    client = c;
    const userId = body.user.id;
    const res = matchmaking.acceptChallenge(action.value, userId);
    const refs = challengeMsgs.get(action.value) || {};
    challengeMsgs.delete(action.value);
    if (!res.ok) {
      await dm(userId, buildClosedDM(`⚠️ ${reasonText(res.reason)}`));
      return refresh(userId);
    }
    for (const x of res.cancelled) {   // les autres défis de ces deux joueurs tombent
      const r = challengeMsgs.get(x.id) || {};
      challengeMsgs.delete(x.id);
      await edit(r.to, buildClosedDM(`✖️ Défi de <@${x.from}> annulé : un autre combat a commencé.`));
      await edit(r.from, buildClosedDM(`✖️ Défi à <@${x.to}> annulé : un autre combat a commencé.`));
    }
    for (const u of [res.from, res.to]) {
      if (queueMsgs.has(u)) { await edit(queueMsgs.get(u), buildClosedDM('✖️ Recherche arrêtée : un combat a commencé.')); queueMsgs.delete(u); }
    }
    await edit(refs.to, buildClosedDM(`✅ Défi de <@${res.from}> accepté !`));
    await edit(refs.from, buildClosedDM(`✅ <@${res.to}> a accepté ton défi !`));
    return startMatch(res.from, res.to, res.arena);
  });

  const closeChallenge = (actionId, byTarget) => app.action(actionId, async ({ ack, body, action, client: c }) => {
    await ack();
    client = c;
    const res = matchmaking.refuseChallenge(action.value, body.user.id);
    const refs = challengeMsgs.get(action.value) || {};
    challengeMsgs.delete(action.value);
    if (!res.ok) return refresh(body.user.id);
    if (byTarget) {
      await edit(refs.to, buildClosedDM(`✖️ Tu as refusé le défi de <@${res.from}>.`));
      await edit(refs.from, buildClosedDM(`✖️ <@${res.to}> a refusé ton défi.`));
    } else {
      await edit(refs.to, buildClosedDM(`✖️ <@${res.from}> a annulé son défi.`));
      await edit(refs.from, buildClosedDM(`✖️ Défi à <@${res.to}> annulé.`));
    }
    return refresh(res.from, res.to);
  });
  closeChallenge('arena_refuse', true);
  closeChallenge('arena_challenge_cancel', false);

  // ── Combat rapide ──
  app.action('arena_queue_join', async ({ ack, body, client: c }) => {
    await ack();
    client = c;
    const userId = body.user.id;
    const res = matchmaking.joinQueue(userId);
    if (!res.ok) {
      await dm(userId, buildClosedDM(`⚠️ ${reasonText(res.reason)}`));
      return refresh(userId);
    }
    if (res.matched) {
      if (queueMsgs.has(res.matched)) { await edit(queueMsgs.get(res.matched), buildClosedDM(`⚡ Adversaire trouvé : <@${userId}> !`)); queueMsgs.delete(res.matched); }
      return startMatch(res.matched, userId, res.arena);
    }
    if (!queueMsgs.has(userId)) queueMsgs.set(userId, await dm(userId, buildClosedDM('⚡ Recherche d\'un adversaire… (60 s max). Tu peux quitter la file depuis l\'Accueil.')));
    return refresh(userId);
  });

  app.action('arena_queue_leave', async ({ ack, body, client: c }) => {
    await ack();
    client = c;
    matchmaking.leaveQueue(body.user.id);
    if (queueMsgs.has(body.user.id)) { await edit(queueMsgs.get(body.user.id), buildClosedDM('✖️ Recherche arrêtée.')); queueMsgs.delete(body.user.id); }
    return refresh(body.user.id);
  });

  // Boutons-liens (la page s'ouvre dans le navigateur) : rien à faire
  app.action('arena_enter_web', async ({ ack }) => { await ack(); });

  // ── Expirations (défis sans réponse, file sans adversaire) ──
  setInterval(() => safe('expirations', async () => {
    if (!client) return;
    const { expiredChallenges, expiredQueue } = matchmaking.sweep(Date.now());
    for (const x of expiredChallenges) {
      const r = challengeMsgs.get(x.id) || {};
      challengeMsgs.delete(x.id);
      await edit(r.to, buildClosedDM(`⌛ Défi de <@${x.from}> expiré.`));
      await edit(r.from, buildClosedDM(`⌛ <@${x.to}> n'a pas répondu à ton défi à temps.`));
      await refresh(x.from, x.to);
    }
    for (const u of expiredQueue) {
      await edit(queueMsgs.get(u), buildClosedDM('⌛ Personne de disponible pour le moment : réessaie un peu plus tard.'));
      queueMsgs.delete(u);
      await refresh(u);
    }
  }), SWEEP_MS).unref();

  // ── Fin de combat : récap privé à chacun ──
  matches.onEnd((match, summary) => safe('récap', async () => {
    if (!client) return;
    for (const side of ['A', 'B']) {
      const userId = match.players[side].userId;
      await dm(userId, buildResultDM(match, summary, userId, ctx.links));
    }
    const fighters = [match.players.A.userId, match.players.B.userId];
    await refresh(...fighters);
    // 🏆 Le classement a bougé : les autres Accueils déjà ouverts aussi (un par un, combat allé au bout seulement)
    if (match.status !== 'cancelled' && ctx.homeViewers) {
      for (const u of ctx.homeViewers()) if (!fighters.includes(u)) await ctx.refreshHome(client, u, console);
    }
  }));

  return { setClient: (c) => { client = c; } };
}

module.exports = { homeState, buildHomeBlocks, buildRankingBlocks, streakLine, buildChallengeModal, buildChallengeDM, buildMatchDM, buildResultDM, buildClosedDM, reasonText, register };
