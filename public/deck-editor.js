// ═══════════════════════════════════════════════════════════
//  🃏 Éditeur de deck de l'Arène (DA « Editeur de deck »)
//
//  À gauche : 3 decks enregistrés (onglets), les 8 emplacements du
//  deck actif (vraies images des cartes), coût moyen, archétypes,
//  alerte, « Vider » et « Prêt » (préparation) ou enregistrement auto.
//  À droite : toute la collection (vraies images), filtres par
//  archétype, tri coût / nom, exemplaires possédés, badge « Deck ×n ».
//  Une carte ×3 possédée peut occuper jusqu'à 3 emplacements ; chaque
//  emplacement se joue UNE fois par combat.
//
//  DeckEditor.mount(root, {
//    catalogue: [{ url, title, rarity, archetype, cost, copies, image }],
//    decks: [{ name, cards: [url] }] × 3, active,
//    mode: 'prep' | 'standalone',
//    onSave({ decks, active }),     // enregistrement (débouncé)
//    onReady(ready, urls),          // mode prep : « Prêt » / « Prêt · annuler »
//  }) → { setStatus({ ready: { you, opponent }, opponentName }) }
// ═══════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  const ARCH_LABELS = { tank: 'Tank', guerrier: 'Guerrier', tireur: 'Tireur', essaim: 'Essaim', sort: 'Sort', pompe: 'Pompe' };
  const DECK_SIZE = 8;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  const fmt = (n) => n.toFixed(1).replace('.', ',');
  const avgCost = (cards) => (cards.length ? fmt(cards.reduce((a, c) => a + c.cost, 0) / cards.length) : '–');

  /** Alerte de la DA, dans l'ordre de priorité. */
  function warningFor(cards) {
    if (cards.length < DECK_SIZE) {
      const n = DECK_SIZE - cards.length;
      return `Encore ${n} carte${n > 1 ? 's' : ''} à ajouter pour pouvoir combattre.`;
    }
    if (!cards.some((c) => c.archetype === 'tank' || c.archetype === 'guerrier')) return 'Aucune unité de mêlée ni Tank : vos tours seront difficiles à défendre.';
    if (cards.reduce((a, c) => a + c.cost, 0) / cards.length > 4.2) return 'Coût moyen élevé : votre main risque de rester bloquée en début de combat.';
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
    const state = {
      decks: opts.decks.map((d) => {
        const used = {};
        // garde un emplacement tant qu'il reste un exemplaire pour le couvrir
        return { name: d.name, cards: d.cards.filter((u) => byUrl[u] && (used[u] = (used[u] || 0) + 1) <= byUrl[u].copies) };
      }),
      active: opts.active || 0,
      filter: 'all',
      sort: 'cost',
      ready: false,
      opponentReady: false,
    };
    let saveTimer = null;

    const deckCards = () => state.decks[state.active].cards.map((u) => byUrl[u]).filter(Boolean);

    function changed() {
      if (state.ready && opts.onReady) {
        state.ready = false;
        opts.onReady(false, null);
      }
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => opts.onSave && opts.onSave({ decks: state.decks, active: state.active }), 400);
      render();
    }

    // ── Panneau deck ──
    const deckPanel = el('section', 'de-panel de-deck');
    const collPanel = el('section', 'de-panel de-collection');
    rootEl.replaceChildren(deckPanel, collPanel);

    function renderDeck() {
      const cards = deckCards();
      const tabs = el('div', 'de-tabs');
      state.decks.forEach((d, i) => {
        const b = el('button', `de-tab${i === state.active ? ' on' : ''}`);
        b.type = 'button';
        const cs = d.cards.map((u) => byUrl[u]).filter(Boolean);
        b.append(el('span', 'de-tab-name', d.name), el('span', 'de-tab-meta', `${cs.length}/8 · coût ${avgCost(cs)}`));
        b.title = 'Double-clic pour renommer';
        b.addEventListener('click', () => { if (state.active !== i) { state.active = i; changed(); } });
        b.addEventListener('dblclick', () => {
          const name = window.prompt('Nom du deck', d.name);
          if (name && name.trim()) { d.name = name.trim().slice(0, 24); changed(); }
        });
        tabs.append(b);
      });

      const head = el('div', 'de-deck-head');
      head.append(el('h2', null, state.decks[state.active].name), el('span', 'de-count', `${cards.length}/8 cartes`));

      const slots = el('div', 'de-slots');
      for (let i = 0; i < DECK_SIZE; i += 1) {
        const c = cards[i];
        const b = el('button', `de-card${c ? '' : ' empty'}`);
        b.type = 'button';
        if (c) {
          b.append(cardArt(c), el('span', 'de-cost', String(c.cost)));
          b.setAttribute('aria-label', `Retirer ${c.title}`);
          b.addEventListener('click', () => {
            state.decks[state.active].cards = state.decks[state.active].cards.filter((_, j) => j !== i);
            changed();
          });
        } else {
          b.append(el('span', 'de-plus', '+'));
          b.setAttribute('aria-label', 'Emplacement vide');
          b.disabled = true;
        }
        slots.append(b);
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

      const parts = [el('div', 'de-kicker', 'Vos decks'), tabs, head, slots, stats];
      const warn = warningFor(cards);
      if (warn) {
        const w = el('div', 'de-warn');
        w.append(el('span', 'de-warn-dot'), el('span', null, warn));
        parts.push(w);
      }

      const actions = el('div', 'de-actions');
      const clear = el('button', 'de-btn ghost', 'Vider');
      clear.type = 'button';
      clear.addEventListener('click', () => { state.decks[state.active].cards = []; changed(); });
      actions.append(clear);
      const full = cards.length === DECK_SIZE;
      if (opts.mode === 'prep') {
        const ready = el('button', `de-btn primary${state.ready ? ' ready' : ''}`, !full ? '8 cartes requises' : state.ready ? 'Prêt · annuler' : 'Prêt');
        ready.type = 'button';
        ready.disabled = !full;
        ready.addEventListener('click', () => {
          state.ready = !state.ready;
          if (opts.onReady) opts.onReady(state.ready, state.decks[state.active].cards.slice());
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
      const inDeckCount = {};
      state.decks[state.active].cards.forEach((u) => { inDeckCount[u] = (inDeckCount[u] || 0) + 1; });
      const deckFull = state.decks[state.active].cards.length >= DECK_SIZE;
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
        if (on) b.append(el('span', 'de-badge', n > 1 ? `Deck ×${n}` : 'Deck'));
        b.addEventListener('click', () => {
          const cards = state.decks[state.active].cards;
          if (can) state.decks[state.active].cards = [...cards, c.url];          // un emplacement de plus
          else if (on) {                                                          // plus d'exemplaire libre : on en retire un
            const i = cards.lastIndexOf(c.url);
            state.decks[state.active].cards = cards.filter((_, j) => j !== i);
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
      activeCards: () => state.decks[state.active].cards.slice(),
    };
  }

  root.DeckEditor = { mount, warningFor };
}(typeof self !== 'undefined' ? self : this));
