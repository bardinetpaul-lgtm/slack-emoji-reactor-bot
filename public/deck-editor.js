// ═══════════════════════════════════════════════════════════
//  🃏 Éditeur de deck de l'Arène (DA « Editeur de deck »)
//
//  À gauche : 3 decks enregistrés (onglets), les 8 emplacements du
//  deck actif (vraies images des cartes), 🎖 Capitaine, coût moyen,
//  archétypes, alerte, 🛒 cartes mystère (préparation), « Vider » et
//  « Prêt » (préparation) ou enregistrement auto.
//  À droite : toute la collection (vraies images), filtres par
//  archétype, tri coût / nom, exemplaires possédés, badge « Deck ×n »,
//  ✨ spécialité des épiques / légendaires.
//  Une carte ×3 possédée peut occuper jusqu'à 3 emplacements ; chaque
//  emplacement se joue UNE fois par combat.
//
//  DeckEditor.mount(root, {
//    catalogue: [{ url, title, rarity, archetype, cost, copies, image, specialty }],
//    decks: [{ name, cards: [url], captain }] × 3, active,
//    captains, specialties,          // textes (serveur)
//    shop: { prices, max, credits }, // préparation : cartes mystère
//    mode: 'prep' | 'standalone',
//    onSave({ decks, active }),      // enregistrement (débouncé)
//    onReady(ready, urls, captain),  // mode prep : « Prêt » / « Prêt · annuler »
//  }) → { setStatus({ ready: { you } }), activeCards() }
// ═══════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  const ARCH_LABELS = { tank: 'Tank', guerrier: 'Guerrier', tireur: 'Tireur', essaim: 'Essaim', sort: 'Sort', pompe: 'Pompe' };
  const RARITY_LABELS = { epic: 'Épique', legendary: 'Légendaire' };
  const DECK_SIZE = 8;
  const isToken = (u) => typeof u === 'string' && u.startsWith('shop:');
  const tokenRarity = (u) => u.slice(5);

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  const fmt = (n) => n.toFixed(1).replace('.', ',');
  const avgCost = (cards) => (cards.length ? fmt(cards.reduce((a, c) => a + c.cost, 0) / cards.length) : '–');

  /** Alerte de la DA, dans l'ordre de priorité (les cartes mystère comptent comme cartes). */
  function warningFor(cards, total = cards.length) {
    if (total < DECK_SIZE) {
      const n = DECK_SIZE - total;
      return `Encore ${n} carte${n > 1 ? 's' : ''} à ajouter pour pouvoir combattre.`;
    }
    if (!cards.some((c) => c.archetype === 'tank' || c.archetype === 'guerrier')) return 'Aucune unité de mêlée ni Tank : vos tours seront difficiles à défendre.';
    if (cards.length && cards.reduce((a, c) => a + c.cost, 0) / cards.length > 4.2) return 'Coût moyen élevé : votre main risque de rester bloquée en début de combat.';
    if (!cards.some((c) => c.archetype === 'sort')) return 'Aucun sort dans ce deck.';
    return '';
  }

  function cardArt(card) {
    if (card.image) {
      const art = el('span', 'de-art');
      art.style.backgroundImage = `url("${String(card.image).replace(/"/g, '%22')}")`;
      return art;
    }
    const ph = el('span', 'de-placeholder');
    ph.append(el('span', null, card.title || 'Carte'), el('span', 'de-arch', ARCH_LABELS[card.archetype] || ''));
    return ph;
  }

  function mount(rootEl, opts) {
    const byUrl = Object.fromEntries(opts.catalogue.map((c) => [c.url, c]));
    const captains = opts.captains || {};
    const specs = opts.specialties || {};
    const shop = opts.shop || null;
    const state = {
      decks: opts.decks.map((d) => {
        const used = {};
        // garde un emplacement tant qu'il reste un exemplaire pour le couvrir
        const cards = d.cards.filter((u) => byUrl[u] && (used[u] = (used[u] || 0) + 1) <= byUrl[u].copies);
        return { name: d.name, cards, captain: d.captain && cards.includes(d.captain) ? d.captain : null };
      }),
      active: opts.active || 0,
      filter: 'all',
      sort: 'cost',
      ready: false,
    };
    let saveTimer = null;

    const current = () => state.decks[state.active];
    const realCards = () => current().cards.filter((u) => !isToken(u)).map((u) => byUrl[u]).filter(Boolean);
    const tokens = () => current().cards.filter(isToken);
    const shopCost = () => tokens().reduce((s, t) => s + ((shop && shop.prices[tokenRarity(t)]) || 0), 0);

    function specBadge(card) {
      const info = card.specialty && specs[card.specialty];
      if (!info) return null;
      const b = el('span', 'de-spec', info.emoji);
      b.title = `${info.label} : ${info.desc}`;
      return b;
    }

    function changed() {
      if (state.ready && opts.onReady) {
        state.ready = false;
        opts.onReady(false, null, null);
      }
      const d = current();
      if (d.captain && !d.cards.includes(d.captain)) d.captain = null;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => opts.onSave && opts.onSave({ decks: state.decks, active: state.active }), 400);
      render();
    }

    // ── Panneau deck ──
    const deckPanel = el('section', 'de-panel de-deck');
    const collPanel = el('section', 'de-panel de-collection');
    rootEl.replaceChildren(deckPanel, collPanel);

    function renderDeck() {
      const d = current();
      const cards = realCards();
      const tabs = el('div', 'de-tabs');
      state.decks.forEach((dk, i) => {
        const b = el('button', `de-tab${i === state.active ? ' on' : ''}`);
        b.type = 'button';
        const cs = dk.cards.filter((u) => !isToken(u)).map((u) => byUrl[u]).filter(Boolean);
        b.append(el('span', 'de-tab-name', dk.name), el('span', 'de-tab-meta', `${dk.cards.length}/8 · coût ${avgCost(cs)}`));
        b.title = 'Double-clic pour renommer';
        b.addEventListener('click', () => { if (state.active !== i) { state.active = i; changed(); } });
        b.addEventListener('dblclick', () => {
          const name = window.prompt('Nom du deck', dk.name);
          if (name && name.trim()) { dk.name = name.trim().slice(0, 24); changed(); }
        });
        tabs.append(b);
      });

      const head = el('div', 'de-deck-head');
      head.append(el('h2', null, d.name), el('span', 'de-count', `${d.cards.length}/8 cartes`));

      // 8 emplacements (le Capitaine est marqué ; une carte mystère reste cachée)
      const slots = el('div', 'de-slots');
      let captainMarked = false;
      for (let i = 0; i < DECK_SIZE; i += 1) {
        const u = d.cards[i];
        const wrap = el('div', 'de-slot');
        const b = el('button', 'de-card');
        b.type = 'button';
        if (!u) {
          b.classList.add('empty');
          b.append(el('span', 'de-plus', '+'));
          b.setAttribute('aria-label', 'Emplacement vide');
          b.disabled = true;
          wrap.append(b);
        } else if (isToken(u)) {
          const r = tokenRarity(u);
          b.classList.add('mystery', r);
          b.append(el('span', 'de-mystery-q', '?'), el('span', 'de-mystery-label', `${RARITY_LABELS[r]} mystère`), el('span', 'de-mystery-price', `${shop ? shop.prices[r] : ''} cr.`));
          b.setAttribute('aria-label', `Retirer la carte ${RARITY_LABELS[r]} mystère`);
          b.addEventListener('click', () => { d.cards = d.cards.filter((_, j) => j !== i); changed(); });
          wrap.append(b);
        } else {
          const c = byUrl[u];
          const isCap = !captainMarked && d.captain === u;
          if (isCap) captainMarked = true;
          if (isCap) b.classList.add('captain');
          b.append(cardArt(c), el('span', 'de-cost', String(c.cost)));
          const sb = specBadge(c);
          if (sb) b.append(sb);
          b.setAttribute('aria-label', `Retirer ${c.title}`);
          b.addEventListener('click', () => {
            d.cards = d.cards.filter((_, j) => j !== i);
            changed();
          });
          const star = el('button', `de-star${isCap ? ' on' : ''}`, '🎖');
          star.type = 'button';
          star.title = isCap ? 'Retirer le Capitaine' : `Choisir comme Capitaine (${captains[c.archetype] ? captains[c.archetype].style : ''})`;
          star.setAttribute('aria-pressed', String(isCap));
          star.addEventListener('click', (e) => {
            e.stopPropagation();
            d.captain = isCap ? null : u;
            changed();
          });
          wrap.append(b, star);
        }
        slots.append(wrap);
      }

      const counts = {};
      cards.forEach((c) => { counts[c.archetype] = (counts[c.archetype] || 0) + 1; });
      const stats = el('div', 'de-stats');
      const avgBox = el('div', 'de-stat');
      avgBox.append(el('span', 'de-stat-label', 'Coût moyen'), el('span', 'de-stat-value', avgCost(cards)));
      const mixBox = el('div', 'de-stat');
      const mix = el('div', 'de-mix');
      Object.entries(counts).forEach(([k, v]) => mix.append(el('span', null, `${ARCH_LABELS[k]} ×${v}`)));
      mixBox.append(el('span', 'de-stat-label', 'Archétypes'), mix);
      stats.append(avgBox, mixBox);

      // 🎖 Capitaine
      const capBox = el('div', 'de-captain');
      const cap = d.captain && byUrl[d.captain];
      const capInfo = cap && captains[cap.archetype];
      if (capInfo) {
        capBox.append(
          el('span', 'de-stat-label', `🎖 Capitaine · ${capInfo.style}`),
          el('span', 'de-cap-line', capInfo.passive),
          el('span', 'de-cap-line', `Pouvoir (1× par combat) — ${capInfo.power.label} : ${capInfo.power.desc}`),
          el('span', 'de-cap-note', 'Ton Capitaine n’est jamais posé : il ne risque rien, mais tu as une pose de moins.'),
        );
      } else {
        capBox.append(el('span', 'de-stat-label', '🎖 Capitaine'), el('span', 'de-cap-note', 'Touche 🎖 sur une carte du deck pour en faire ton Capitaine : un style de jeu, un pouvoir, et une carte jamais risquée.'));
      }

      const parts = [el('div', 'de-kicker', 'Vos decks'), tabs, head, slots, stats, capBox];

      // 🛒 Cartes mystère (préparation)
      if (opts.mode === 'prep' && shop) {
        const box = el('div', 'de-shop');
        const left = shop.credits - shopCost();
        box.append(el('span', 'de-stat-label', `🛒 Compléter avec une carte mystère · ${left} crédits disponibles`));
        const row = el('div', 'de-shop-row');
        for (const r of ['epic', 'legendary']) {
          const price = shop.prices[r];
          const btn = el('button', `de-btn shop ${r}`, `${r === 'epic' ? '🟣' : '🟡'} ${RARITY_LABELS[r]} mystère · ${price}`);
          btn.type = 'button';
          btn.disabled = d.cards.length >= DECK_SIZE || tokens().length >= shop.max || left < price;
          btn.addEventListener('click', () => { d.cards = [...d.cards, `shop:${r}`]; changed(); });
          row.append(btn);
        }
        box.append(row, el('span', 'de-cap-note', `Tirée au hasard, révélée en combat, valable pour ce combat seulement (jamais ajoutée à ta collection). ${shop.max} max. Débitée au lancement.`));
        parts.push(box);
      }

      const warn = warningFor(cards, d.cards.length);
      if (warn) {
        const w = el('div', 'de-warn');
        w.append(el('span', 'de-warn-dot'), el('span', null, warn));
        parts.push(w);
      }

      const actions = el('div', 'de-actions');
      const clear = el('button', 'de-btn ghost', 'Vider');
      clear.type = 'button';
      clear.addEventListener('click', () => { d.cards = []; d.captain = null; changed(); });
      actions.append(clear);
      const full = d.cards.length === DECK_SIZE;
      if (opts.mode === 'prep') {
        const cost = shopCost();
        const label = !full ? '8 cartes requises' : state.ready ? 'Prêt · annuler' : cost ? `Prêt · ${cost} crédits au lancement` : 'Prêt';
        const ready = el('button', `de-btn primary${state.ready ? ' ready' : ''}`, label);
        ready.type = 'button';
        ready.disabled = !full;
        ready.addEventListener('click', () => {
          state.ready = !state.ready;
          if (opts.onReady) opts.onReady(state.ready, d.cards.slice(), d.captain);
          render();
        });
        actions.append(ready);
        parts.push(actions, el('span', 'de-note', 'Sans action de votre part, le combat démarre à 0:00 avec le deck sélectionné, s’il compte 8 cartes.'));
      } else {
        actions.append(el('span', 'de-saved', full ? 'Enregistré · deck utilisé pour tes combats' : 'Enregistré automatiquement'));
        parts.push(actions);
      }
      deckPanel.replaceChildren(...parts);
    }

    // ── Panneau collection ──
    function renderCollection() {
      const d = current();
      const inDeckCount = {};
      d.cards.forEach((u) => { inDeckCount[u] = (inDeckCount[u] || 0) + 1; });
      const deckFull = d.cards.length >= DECK_SIZE;
      const owned = opts.catalogue.filter((c) => c.copies > 0).length;

      const head = el('div', 'de-coll-head');
      head.append(el('h2', null, 'Votre collection'), el('span', 'de-muted', `${owned} cartes possédées sur ${opts.catalogue.length}`));

      const bar = el('div', 'de-filters');
      [['all', 'Toutes'], ...Object.entries(ARCH_LABELS)].forEach(([k, l]) => {
        const b = el('button', `de-filter${state.filter === k ? ' on' : ''}`, l);
        b.type = 'button';
        b.addEventListener('click', () => { state.filter = k; render(); });
        bar.append(b);
      });
      bar.append(el('span', 'de-spacer'));
      const sort = el('button', 'de-filter', `Tri : ${state.sort === 'cost' ? 'coût' : 'nom'}`);
      sort.type = 'button';
      sort.addEventListener('click', () => { state.sort = state.sort === 'cost' ? 'name' : 'cost'; render(); });
      bar.append(sort);

      let list = opts.catalogue.filter((c) => state.filter === 'all' || c.archetype === state.filter);
      list = [...list].sort((a, b) => (b.copies > 0) - (a.copies > 0)
        || (state.sort === 'cost' ? a.cost - b.cost : 0)
        || String(a.title).localeCompare(String(b.title), 'fr', { numeric: true }));

      const grid = el('div', 'de-grid');
      list.forEach((c) => {
        const n = inDeckCount[c.url] || 0;
        const on = n > 0;
        const can = n < c.copies && !deckFull;
        const b = el('button', `de-card${on ? ' in-deck' : ''}${c.copies > 0 ? '' : ' unowned'}`);
        b.type = 'button';
        b.disabled = !(can || on);
        b.setAttribute('aria-pressed', String(on));
        b.setAttribute('aria-label', `${c.title}, ${ARCH_LABELS[c.archetype]}, coût ${c.cost}, ${c.copies} exemplaire(s), ${n} dans le deck`);
        b.title = can ? 'Ajouter un emplacement' : on ? 'Retirer un emplacement' : '';
        b.append(cardArt(c), el('span', 'de-cost', String(c.cost)), el('span', 'de-copies', c.copies > 0 ? `×${c.copies}` : '0'));
        const sb = specBadge(c);
        if (sb) b.append(sb);
        if (on) b.append(el('span', 'de-badge', n > 1 ? `Deck ×${n}` : 'Deck'));
        b.addEventListener('click', () => {
          const cards = d.cards;
          if (can) d.cards = [...cards, c.url];          // un emplacement de plus
          else if (on) {                                 // plus d'exemplaire libre : on en retire un
            const i = cards.lastIndexOf(c.url);
            d.cards = cards.filter((_, j) => j !== i);
          } else return;
          changed();
        });
        grid.append(b);
      });
      collPanel.replaceChildren(head, bar, grid);
    }

    function render() {
      renderDeck();
      renderCollection();
    }

    render();
    return {
      setStatus({ ready } = {}) {
        if (ready && typeof ready.you === 'boolean' && ready.you !== state.ready) {
          state.ready = ready.you;
          renderDeck();
        }
      },
      activeCards: () => current().cards.slice(),
    };
  }

  root.DeckEditor = { mount, warningFor };
}(typeof self !== 'undefined' ? self : this));
