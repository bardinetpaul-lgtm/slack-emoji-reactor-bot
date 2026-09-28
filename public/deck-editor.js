// ═══════════════════════════════════════════════════════════
//  🃏 Éditeur de deck de l'Arène (DA « Editeur de deck »)
//
//  À gauche : 3 decks enregistrés (onglets), les 8 emplacements du
//  deck actif (vraies images des cartes), 🎖 Capitaine (9e carte, choisie
//  dans la collection, EN PLUS des 8 : jamais posée), coût moyen,
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
  const RARITIES = { common: 'Commune', rare: 'Rare', epic: 'Épique', legendary: 'Légendaire' };
  const RARITY_ORDER = { legendary: 0, epic: 1, rare: 2, common: 3 };

  // Rôle de chaque archétype (miroir de src/game/cards.js : ARCHETYPES + COUNTERS).
  // `vs` décrit les dégâts RÉELS : l'attaquant fait ×1,5 à ce qu'il contre et
  // ×0,67 à ce qui le contre. Le Tank ne frappant jamais les troupes, son
  // « contre » ne joue que dans un sens : il encaisse mal l'Essaim, bien les Guerriers.
  const ROLES = {
    tank:     { emoji: '🛡', label: 'Tank',     role: '2 chars d’assaut (700 PV) qui ignorent les troupes et foncent sur les tours.', vs: 'Encaisse bien les ⚔️ Guerriers (ils ne lui font que ×0,67). L’🐝 Essaim le fait fondre (×1,5).' },
    guerrier: { emoji: '⚔️', label: 'Guerrier', role: '3 combattants qui frappent au contact, polyvalents.', vs: 'Écrase les 🏹 Tireurs (×1,5). Tape mal sur les 🛡 Tanks (×0,67) : laisse plutôt l’Essaim s’en charger.' },
    tireur:   { emoji: '🏹', label: 'Tireur',   role: '3 archers qui tirent de loin, fragiles : à protéger derrière un Tank.', vs: 'Nettoie l’🐝 Essaim (×1,5). Tape mal sur les ⚔️ Guerriers (×0,67), qui l’écrasent en retour.' },
    essaim:   { emoji: '🐝', label: 'Essaim',   role: '6 petits volants très rapides.', vs: 'Fait fondre les 🛡 Tanks (×1,5). Tape mal sur les 🏹 Tireurs (×0,67), qui le nettoient. Craint les 💥 Sorts.' },
    sort:     { emoji: '💥', label: 'Sort',     role: 'Explose au point visé (zone). Seulement 40 % des dégâts sur les bâtiments.', vs: 'Écrase l’🐝 Essaim (×1,5).' },
    pompe:    { emoji: '⚗️', label: 'Pompe',    role: 'Bâtiment : +1 élixir toutes les 7 s pendant 45 s. Une seule à la fois.', vs: '' },
  };
  const roleText = (k) => (ROLES[k] ? `${ROLES[k].role} ${ROLES[k].vs}`.trim() : '');

  /** Cadre de rareté + étiquettes rareté / rôle sur une carte (bouton). */
  function decorate(b, card, { compact = false } = {}) {
    const rarity = RARITIES[card.rarity] ? card.rarity : 'common';
    const r = ROLES[card.archetype];
    b.classList.add(`r-${rarity}`);
    if (rarity !== 'common') b.append(el('span', 'de-rarity', compact ? RARITIES[rarity].slice(0, 3) + '.' : RARITIES[rarity]));
    if (r) b.append(el('span', 'de-role', compact ? r.emoji : `${r.emoji} ${r.label}`));
    b.title = `${card.title || 'Carte'} · ${RARITIES[rarity]} · ${r ? r.label : ''}\n${roleText(card.archetype)}`;
  }

  /** Encart « Comment les cartes s'affrontent ». */
  function guide() {
    const box = el('details', 'de-guide');
    box.append(el('summary', null, '❓ Comment les cartes s’affrontent'));
    const list = el('div', 'de-guide-list');
    for (const k of Object.keys(ROLES)) {
      const row = el('div', 'de-guide-row');
      row.append(el('span', 'de-guide-name', `${ROLES[k].emoji} ${ROLES[k].label}`), el('span', null, roleText(k)));
      list.append(row);
    }
    const rules = el('ul', 'de-guide-rules');
    [
      'Qui frappe fort qui : ⚔️ Guerrier > 🏹 Tireur > 🐝 Essaim > 🛡 Tank, et 💥 Sort > 🐝 Essaim (×1,5). Dans l’autre sens, les coups ne font que ×0,67 (un Tireur qui tape un Guerrier, un Guerrier qui tape un Tank…).',
      'Le 🛡 Tank ne frappe jamais les troupes : il sert de bouclier. Pendant que les ennemis s’acharnent sur lui, tes Tireurs et Guerriers derrière font le travail.',
      'Chaque groupe va vers la cible LA PLUS PROCHE : un ennemi repéré, sinon la tour ennemie la plus proche (le 🛡 Tank, lui, ne vise que les bâtiments). À pied, on traverse la rivière par un des 2 ponts ; l’🐝 Essaim vole.',
      'Les poses adverses s’affichent sur le terrain (🏹 Tireur…) et dans le bandeau en haut du terrain.',
      'Tu poses où tu veux dans ta moitié, et autour d’une tour adverse détruite. Tes 8 cartes sont en main dès le début.',
      'La rareté (cadre coloré) renforce les PV : Rare +6 %, Épique +11 %, Légendaire +16 %. Les Épiques et Légendaires ont en plus une spécialité ✨.',
      'Une pose apparaît 0,5 s après avoir été jouée.',
    ].forEach((t) => rules.append(el('li', null, t)));
    box.append(list, rules);
    return box;
  }
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
    // une carte non possédée n'apparaît nulle part (le serveur ne les envoie déjà plus)
    opts = { ...opts, catalogue: (opts.catalogue || []).filter((c) => c.copies > 0) };
    const byUrl = Object.fromEntries(opts.catalogue.map((c) => [c.url, c]));
    const captains = opts.captains || {};
    const specs = opts.specialties || {};
    const shop = opts.shop || null;
    const state = {
      decks: opts.decks.map((d) => {
        const used = {};
        // garde un emplacement tant qu'il reste un exemplaire pour le couvrir
        const cards = d.cards.filter((u) => byUrl[u] && (used[u] = (used[u] || 0) + 1) <= byUrl[u].copies);
        return { name: d.name, cards, captain: d.captain && byUrl[d.captain] ? d.captain : null };
      }),
      active: opts.active || 0,
      filter: 'all',
      sort: 'cost',
      ready: false,
      pickCaptain: false,   // 🎖 « Choisir un Capitaine » : la prochaine carte touchée dans la collection
    };
    let saveTimer = null;

    const current = () => state.decks[state.active];
    const inDeck = (d, url) => d.cards.filter((u) => u === url).length;
    // 🎖 le Capitaine occupe un exemplaire, en plus de ceux du deck
    const captainOk = (d, url) => Boolean(byUrl[url]) && byUrl[url].copies >= inDeck(d, url) + 1;
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
      if (d.captain && !captainOk(d, d.captain)) d.captain = null;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => opts.onSave && opts.onSave({ decks: state.decks, active: state.active }), 400);
      render();
    }

    // ── Panneau deck ──
    const deckPanel = el('section', 'de-panel de-deck');
    const collPanel = el('section', 'de-panel de-collection');
    const guideBox = guide();   // créé une fois : reste ouvert/fermé entre deux rendus
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

      // 8 emplacements (une carte mystère reste cachée)
      const slots = el('div', 'de-slots');
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
          b.append(cardArt(c), el('span', 'de-cost', String(c.cost)));
          decorate(b, c, { compact: true });
          const sb = specBadge(c);
          if (sb) b.append(sb);
          b.setAttribute('aria-label', `Retirer ${c.title}`);
          b.addEventListener('click', () => {
            d.cards = d.cards.filter((_, j) => j !== i);
            changed();
          });
          wrap.append(b);
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
      Object.entries(counts).forEach(([k, v]) => mix.append(el('span', null, `${ROLES[k].emoji} ${ARCH_LABELS[k]} ×${v}`)));
      mixBox.append(el('span', 'de-stat-label', 'Archétypes'), mix);
      stats.append(avgBox, mixBox);

      // 🎖 Capitaine : 9e carte, en plus des 8 (choisie dans la collection)
      const capBox = el('div', `de-captain${state.pickCaptain ? ' picking' : ''}`);
      const cap = d.captain && byUrl[d.captain];
      const capInfo = cap && captains[cap.archetype];
      const capRow = el('div', 'de-cap-row');
      const capCard = el('button', 'de-card de-cap-card');
      capCard.type = 'button';
      if (cap) {
        capCard.append(cardArt(cap));
        decorate(capCard, cap, { compact: true });
        capCard.title = `${cap.title} — toucher pour retirer le Capitaine`;
        capCard.setAttribute('aria-label', `Retirer le Capitaine ${cap.title}`);
        capCard.addEventListener('click', () => { d.captain = null; state.pickCaptain = false; changed(); });
      } else {
        capCard.classList.add('empty');
        capCard.append(el('span', 'de-plus', '🎖'));
        capCard.setAttribute('aria-label', 'Choisir un Capitaine');
        capCard.addEventListener('click', () => { state.pickCaptain = !state.pickCaptain; render(); });
      }
      const capText = el('div', 'de-cap-text');
      if (capInfo) {
        capText.append(
          el('span', 'de-stat-label', `🎖 Capitaine · ${capInfo.style}`),
          el('span', 'de-cap-line', capInfo.passive),
          el('span', 'de-cap-line', `Pouvoir (1× par combat) — ${capInfo.power.label} : ${capInfo.power.desc}`),
        );
      } else {
        capText.append(el('span', 'de-stat-label', '🎖 Capitaine'), el('span', 'de-cap-line', 'Un style de jeu : un bonus permanent + un pouvoir à utiliser une fois par combat.'));
      }
      const pick = el('button', 'de-btn ghost de-cap-pick', state.pickCaptain ? 'Annuler' : cap ? 'Changer de Capitaine' : 'Choisir un Capitaine');
      pick.type = 'button';
      pick.setAttribute('aria-pressed', String(state.pickCaptain));
      pick.addEventListener('click', () => { state.pickCaptain = !state.pickCaptain; render(); });
      capText.append(pick);
      capRow.append(capCard, capText);
      capBox.append(capRow, el('span', 'de-cap-note', state.pickCaptain
        ? '👉 Touche une carte de ta collection pour en faire ton Capitaine.'
        : 'Il vient EN PLUS de tes 8 cartes : jamais posé, donc jamais risqué.'));

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
      clear.addEventListener('click', () => { d.cards = []; changed(); });
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
      const owned = opts.catalogue.length;

      const head = el('div', 'de-coll-head');
      head.append(el('h2', null, 'Votre collection'), el('span', 'de-muted', `${owned} carte${owned > 1 ? 's' : ''} dans ta collection`));

      const bar = el('div', 'de-filters');
      [['all', 'Toutes'], ...Object.entries(ARCH_LABELS).map(([k, l]) => [k, `${ROLES[k].emoji} ${l}`])].forEach(([k, l]) => {
        const b = el('button', `de-filter${state.filter === k ? ' on' : ''}`, l);
        b.type = 'button';
        if (ROLES[k]) b.title = roleText(k);
        b.addEventListener('click', () => { state.filter = k; render(); });
        bar.append(b);
      });
      bar.append(el('span', 'de-spacer'));
      const SORTS = { cost: 'coût', rarity: 'rareté', name: 'nom' };
      const sort = el('button', 'de-filter', `Tri : ${SORTS[state.sort]}`);
      sort.type = 'button';
      sort.addEventListener('click', () => {
        const keys = Object.keys(SORTS);
        state.sort = keys[(keys.indexOf(state.sort) + 1) % keys.length];
        render();
      });
      bar.append(sort);

      let list = opts.catalogue.filter((c) => state.filter === 'all' || c.archetype === state.filter);
      const rank = (c) => (RARITY_ORDER[c.rarity] === undefined ? 3 : RARITY_ORDER[c.rarity]);
      list = [...list].sort((a, b) => (state.sort === 'cost' ? a.cost - b.cost : 0)
        || (state.sort === 'rarity' ? rank(a) - rank(b) : 0)
        || String(a.title).localeCompare(String(b.title), 'fr', { numeric: true }));

      const grid = el('div', 'de-grid');
      list.forEach((c) => {
        const n = inDeckCount[c.url] || 0;
        const on = n > 0;
        const isCap = d.captain === c.url;
        const can = n + (isCap ? 1 : 0) < c.copies && !deckFull;
        const canCap = !isCap && c.copies >= n + 1;
        const picking = state.pickCaptain;
        const b = el('button', `de-card${on ? ' in-deck' : ''}${isCap ? ' captain' : ''}${picking && canCap ? ' pickable' : ''}`);
        b.type = 'button';
        b.disabled = picking ? !canCap : !(can || on);
        b.setAttribute('aria-pressed', String(on));
        b.setAttribute('aria-label', `${c.title}, ${RARITIES[c.rarity] || RARITIES.common}, ${ARCH_LABELS[c.archetype]}, coût ${c.cost}, ${c.copies} exemplaire(s), ${n} dans le deck`);
        b.append(cardArt(c), el('span', 'de-cost', String(c.cost)), el('span', 'de-copies', `×${c.copies}`));
        decorate(b, c);
        if (can) b.title += '\n→ Ajouter un emplacement';
        else if (on) b.title += '\n→ Retirer un emplacement';
        const sb = specBadge(c);
        if (sb) b.append(sb);
        if (on) b.append(el('span', 'de-badge', n > 1 ? `Deck ×${n}` : 'Deck'));
        if (isCap) b.append(el('span', 'de-cap-badge', '🎖'));
        if (picking) b.title = canCap ? `${c.title}\n→ En faire mon Capitaine (${captains[c.archetype] ? captains[c.archetype].style : ''})` : `${c.title}\nTous ses exemplaires sont déjà dans le deck`;
        b.addEventListener('click', () => {
          if (state.pickCaptain) {                        // 🎖 choix du Capitaine
            if (!canCap) return;
            d.captain = c.url;
            state.pickCaptain = false;
            changed();
            return;
          }
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
      collPanel.replaceChildren(head, guideBox, bar, grid);
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

  root.DeckEditor = { mount, warningFor, ROLES, RARITIES, roleText, guide };
}(typeof self !== 'undefined' ? self : this));
