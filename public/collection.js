// ═══════════════════════════════════════════════════════════
//  📒 Jeanpip — classeur Panini (collection en direct)
//
//  Lecture seule : GET api/collection/<user>?t=<token> renvoie
//  { owner, sections, stats, version }. La page interroge le serveur
//  toutes les POLL_MS ; quand `version` change, les nouvelles cartes
//  viennent se coller dans leur pochette (+ notification).
//
//  Pages : 9 pochettes (3 × 3), rangées par rareté (intercalaires).
//  Grand écran : double page ; mobile : une page à la fois.
// ═══════════════════════════════════════════════════════════

(() => {
  'use strict';

  // ─────────────────────────────────────────────
  // 🧭 Contexte (page servie sur …/collection/<user>?t=<token>)
  // ─────────────────────────────────────────────

  const BASE = new URL('../', location.href);
  const userId = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
  const token = new URLSearchParams(location.search).get('t') || '';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const single = window.matchMedia('(max-width: 820px)');

  const POLL_MS = 8000;
  const MAX_BACKOFF_MS = 60000;
  const PER_PAGE = 9;

  const SECTION = {
    common:    { label: 'Communes',    short: 'COMMUNE' },
    rare:      { label: 'Rares',       short: 'RARE' },
    epic:      { label: 'Épiques',     short: 'ÉPIQUE' },
    legendary: { label: 'Légendaires', short: 'LÉGENDAIRE' },
    extra:     { label: 'Hors série',  short: 'HORS SÉRIE' },
  };
  const RARITY_LABEL = { common: 'Commune', rare: 'Rare', epic: 'Épique', legendary: 'Légendaire' };

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };
  const assetUrl = (u) => (u ? new URL(u, BASE).href : null);

  let data = null;       // dernière réponse du serveur
  let pages = [];        // [{ kind: 'cover' } | { kind: 'section', key, stickers, part, parts }]
  let view = 0;          // index de la vue affichée (1 ou 2 pages)
  let turning = false;
  const fresh = new Set();   // liens des cartes arrivées en direct (animation « collage »)
  const bumped = new Set();  // liens des cartes dont le nombre d'exemplaires a augmenté

  // ─────────────────────────────────────────────
  // 🗂️ Découpage en pages
  // ─────────────────────────────────────────────

  function buildPages() {
    const list = [{ kind: 'cover' }];
    for (const s of data.sections) {
      const parts = Math.max(1, Math.ceil(s.stickers.length / PER_PAGE));
      for (let p = 0; p < parts; p++) {
        list.push({ kind: 'section', key: s.key, stickers: s.stickers.slice(p * PER_PAGE, (p + 1) * PER_PAGE), part: p + 1, parts });
      }
    }
    return list;
  }

  const perView = () => (single.matches ? 1 : 2);
  const viewCount = () => Math.ceil(pages.length / perView());
  const pagesOf = (v) => Array.from({ length: perView() }, (_, i) => v * perView() + i);

  function pageOfLink(link) {
    return pages.findIndex((p) => p.kind === 'section' && p.stickers.some((st) => st.owned && st.link === link));
  }

  // ─────────────────────────────────────────────
  // 🌟 Stickers & pochettes
  // ─────────────────────────────────────────────

  function tilt(n) {
    return `${(((n * 37) % 7) - 3) * 0.45}deg`;
  }

  function stickerName(title) {
    return (title || 'Jeanpip').replace(/^[^\p{L}\p{N}#]+/u, '').replace(/^Surprise\s+#\d+\s*(—\s*)?/i, '').trim();
  }

  function buildSticker(st, { animate = true } = {}) {
    const node = el('button', `sticker r-${st.rarity}`);
    node.type = 'button';
    node.style.setProperty('--rot', tilt(st.n));
    node.setAttribute('aria-label', `${st.title} — ${RARITY_LABEL[st.rarity] || ''}${st.count > 1 ? `, ${st.count} exemplaires` : ''}`);

    const art = el('div', 'art');
    const mono = el('div', 'mono', 'J');
    art.appendChild(mono);
    const src = assetUrl(st.image);
    if (src) {
      const img = el('img');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = src;
      img.addEventListener('load', () => { mono.hidden = true; });
      img.addEventListener('error', () => img.remove());
      art.appendChild(img);
    }

    const band = el('div', 'band');
    band.appendChild(el('span', 'num', st.n ? `#${st.n}` : '★'));
    band.appendChild(el('span', 'name', stickerName(st.title) || RARITY_LABEL[st.rarity]));
    node.append(art, band);

    if (st.count > 1) {
      const dup = el('span', 'dup', `×${st.count}`);
      if (animate && bumped.has(st.link)) {
        dup.classList.add('is-bumped');
        bumped.delete(st.link);
      }
      node.appendChild(dup);
    }
    if (animate && fresh.has(st.link)) {
      node.classList.add('is-new');
      fresh.delete(st.link);
    }
    node.addEventListener('click', () => openLightbox(st));
    return node;
  }

  function buildPocket(st, opts) {
    const pocket = el('div', `pocket r-${st.rarity}`);
    if (st.owned) {
      pocket.appendChild(buildSticker(st, opts));
    } else {
      const slot = el('div', 'slot');
      slot.appendChild(el('b', null, String(st.n)));
      slot.appendChild(el('small', null, SECTION[st.rarity].short));
      slot.title = `N° ${st.n} — pas encore trouvée`;
      pocket.appendChild(slot);
    }
    return pocket;
  }

  // ─────────────────────────────────────────────
  // 📄 Pages
  // ─────────────────────────────────────────────

  function buildCover() {
    const page = el('div', 'page cover');
    const { stats } = data;
    const pct = stats.total ? Math.floor((stats.owned / stats.total) * 100) : 0;
    const name = data.owner && data.owner.name;

    page.appendChild(el('div', 'crest', 'J'));
    page.appendChild(el('p', 'cover-kicker', `ALBUM OFFICIEL · ${new Date().getFullYear()}`));
    page.appendChild(el('h1', 'cover-title', name ? `Le classeur de ${name}` : 'Mon classeur'));

    const big = el('div', 'cover-pct', `${pct} %`);
    big.appendChild(el('small', null, `${stats.owned} / ${stats.total} CARTES`));
    page.appendChild(big);

    const rows = el('div', 'cover-rows');
    for (const s of data.sections) {
      if (s.key === 'extra') continue;
      const r = stats.byRarity[s.key] || { owned: 0, total: 0 };
      const row = el('div', `cover-row r-${s.key}`);
      row.appendChild(el('span', null, SECTION[s.key].label));
      const bar = el('div', 'bar');
      const fill = el('i');
      fill.style.width = `${r.total ? (r.owned / r.total) * 100 : 0}%`;
      bar.appendChild(fill);
      row.appendChild(bar);
      row.appendChild(el('span', 'val', `${r.owned}/${r.total}`));
      rows.appendChild(row);
    }
    page.appendChild(rows);

    const foot = el('p', 'cover-foot');
    foot.append(el('b', null, String(stats.copies)), ` carte${stats.copies > 1 ? 's' : ''} au total · `,
      el('b', null, String(stats.doubles)), ` double${stats.doubles > 1 ? 's' : ''}`,
      el('br'), 'Mis à jour en direct : chaque carte gagnée vient se coller ici.');
    page.appendChild(foot);
    return page;
  }

  function buildPage(index, opts) {
    const desc = pages[index];
    if (!desc) return el('div', 'page is-blank');
    if (desc.kind === 'cover') return buildCover();

    const page = el('div', `page r-${desc.key}`);
    const head = el('div', 'page-head');
    head.appendChild(el('span', 'sec', SECTION[desc.key].label));
    if (desc.parts > 1) head.appendChild(el('span', 'sub', `${desc.part} / ${desc.parts}`));
    page.appendChild(head);

    const grid = el('div', 'pockets');
    desc.stickers.forEach((st) => grid.appendChild(buildPocket(st, opts)));
    for (let i = desc.stickers.length; i < PER_PAGE; i++) grid.appendChild(el('div', 'pocket is-empty'));
    page.appendChild(grid);

    page.appendChild(el('div', 'page-foot', `— ${index} —`));
    return page;
  }

  // ─────────────────────────────────────────────
  // 📖 Affichage d'une vue (+ page qui tourne)
  // ─────────────────────────────────────────────

  function renderChrome() {
    const [first] = pagesOf(view);
    const desc = pages[first] || pages[0];
    const activeKey = desc.kind === 'cover' ? 'cover' : desc.key;
    for (const tab of $('#tabs').children) tab.classList.toggle('is-active', tab.dataset.key === activeKey);

    $('#btn-prev').disabled = view <= 0;
    $('#btn-next').disabled = view >= viewCount() - 1;
    const shown = pagesOf(view).filter((i) => i < pages.length);
    $('#pager').textContent = shown.length > 1
      ? `PAGES ${shown[0] + 1}–${shown[shown.length - 1] + 1} / ${pages.length}`
      : `PAGE ${shown[0] + 1} / ${pages.length}`;
  }

  function render() {
    $('#spread').replaceChildren(...pagesOf(view).map((i) => buildPage(i)));
    renderChrome();
  }

  function goTo(target) {
    target = Math.max(0, Math.min(viewCount() - 1, target));
    if (target === view || turning) return;
    if (reducedMotion) {
      view = target;
      return render();
    }

    const next = target > view;
    const spread = $('#spread');
    const cur = pagesOf(view);
    const tgt = pagesOf(target);
    const leaf = el('div', `leaf ${next ? 'to-next' : 'to-prev'}${single.matches ? ' is-single' : ''}`);

    if (single.matches) {
      // Une page : la page actuelle s'envole, la cible est dessous
      spread.replaceChildren(buildPage(tgt[0]));
      leaf.append(buildPage(cur[0], { animate: false }), el('div', 'page is-blank'));
    } else if (next) {
      spread.replaceChildren(buildPage(cur[0], { animate: false }), buildPage(tgt[1]));
      leaf.append(buildPage(cur[1], { animate: false }), buildPage(tgt[0]));
    } else {
      spread.replaceChildren(buildPage(tgt[0]), buildPage(cur[1], { animate: false }));
      leaf.append(buildPage(cur[0], { animate: false }), buildPage(tgt[1]));
    }
    spread.appendChild(leaf);
    view = target;
    renderChrome();

    turning = true;
    void leaf.offsetWidth;
    leaf.classList.add('is-turning');
    const done = () => {
      if (!turning) return;
      turning = false;
      if (single.matches) {
        leaf.remove();
      } else {
        // La face arrière de la page tournée devient la vraie page
        const back = leaf.lastElementChild;
        back.style.transform = '';
        if (next) spread.replaceChild(back, spread.firstElementChild);
        else spread.replaceChild(back, spread.children[1]);
        leaf.remove();
      }
    };
    leaf.addEventListener('transitionend', (e) => { if (e.target === leaf) done(); });
    setTimeout(done, 1000); // filet de sécurité
  }

  function goToPage(index) {
    if (index < 0) return;
    goTo(Math.floor(index / perView()));
  }

  function renderTabs() {
    const tabs = [el('button', 'tab', 'Résumé')];
    tabs[0].dataset.key = 'cover';
    tabs[0].addEventListener('click', () => goToPage(0));
    for (const s of data.sections) {
      const tab = el('button', `tab r-${s.key}`, SECTION[s.key].label);
      tab.type = 'button';
      tab.dataset.key = s.key;
      const r = data.stats.byRarity[s.key];
      if (r) tab.appendChild(el('small', null, `${r.owned}/${r.total}`));
      tab.addEventListener('click', () => goToPage(pages.findIndex((p) => p.key === s.key)));
      tabs.push(tab);
    }
    tabs[0].type = 'button';
    $('#tabs').replaceChildren(...tabs);
  }

  function renderProgress() {
    const { owned, total } = data.stats;
    $('#progress').hidden = false;
    $('#progress-owned').textContent = owned;
    $('#progress-total').textContent = `${total} cartes`;
    $('#progress-fill').style.width = `${total ? (owned / total) * 100 : 0}%`;
  }

  // ─────────────────────────────────────────────
  // 🔍 Carte en grand
  // ─────────────────────────────────────────────

  let lastFocus = null;

  function openLightbox(st) {
    lastFocus = document.activeElement;
    const box = $('#lightbox');
    box.querySelector('.lightbox-card').className = `lightbox-card r-${st.rarity}`;
    const holder = $('#lb-sticker');
    const big = buildSticker(st, { animate: false });
    big.tabIndex = -1;
    holder.replaceChildren(big);

    $('#lb-num').textContent = `N° ${st.n || '★'} · ${(RARITY_LABEL[st.rarity] || '').toUpperCase()}`;
    $('#lb-title').textContent = stickerName(st.title) || st.title.replace(/^[^\p{L}\p{N}#]+/u, '');
    const meta = [`${st.count} exemplaire${st.count > 1 ? 's' : ''}`];
    if (st.firstAt) meta.push(`Obtenue le ${new Date(st.firstAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`);
    $('#lb-meta').textContent = meta.join(' · ');
    const link = $('#lb-link');
    link.hidden = !st.link;
    if (st.link) link.href = st.link;

    box.hidden = false;
    $('#lb-close').focus();
  }

  function closeLightbox() {
    $('#lightbox').hidden = true;
    if (lastFocus) lastFocus.focus();
  }

  // ─────────────────────────────────────────────
  // 🔔 Arrivées en direct
  // ─────────────────────────────────────────────

  function ownedMap(d) {
    const map = new Map();
    for (const s of d.sections) for (const st of s.stickers) if (st.owned) map.set(st.link, st);
    return map;
  }

  // parts : chaînes (texte brut) ou { b: '…' } (en gras)
  function toast(parts, target) {
    const node = el('div', 'toast');
    const p = el('p');
    p.append(...parts.map((x) => (typeof x === 'string' ? x : el('b', null, x.b))));
    node.appendChild(p);
    if (target) {
      const btn = el('button', 'pill-btn primary', 'Voir');
      btn.type = 'button';
      btn.addEventListener('click', () => { goToPage(pageOfLink(target)); dismiss(); });
      node.appendChild(btn);
    }
    const dismiss = () => {
      node.classList.add('is-leaving');
      setTimeout(() => node.remove(), 350);
    };
    $('#toasts').appendChild(node);
    setTimeout(dismiss, 7000);
    while ($('#toasts').children.length > 3) $('#toasts').firstElementChild.remove();
  }

  function announce(prev, next) {
    const before = ownedMap(prev);
    const added = [];
    const dups = [];
    for (const [link, st] of ownedMap(next)) {
      const old = before.get(link);
      if (!old) {
        added.push(st);
        fresh.add(link);
      } else if (st.count > old.count) {
        dups.push(st);
        bumped.add(link);
      }
    }
    if (!added.length && !dups.length) return;

    const label = (st) => `#${st.n} ${stickerName(st.title)}`;
    const first = added[0] || dups[0];
    if (added.length + dups.length === 1) {
      toast(added.length
        ? ['✨ ', { b: 'Nouvelle carte !' }, ` ${label(first)} rejoint ton classeur.`]
        : ['🔁 ', { b: 'Doublon' }, ` ${label(first)} — tu en as maintenant ${first.count}.`], first.link);
    } else {
      const parts = [];
      if (added.length) parts.push(`${added.length} nouvelle${added.length > 1 ? 's' : ''}`);
      if (dups.length) parts.push(`${dups.length} doublon${dups.length > 1 ? 's' : ''}`);
      toast(['🎁 ', { b: `${added.length + dups.length} cartes arrivées` }, ` — ${parts.join(', ')}.`], first.link);
    }
  }

  // ─────────────────────────────────────────────
  // 📡 Chargement + mises à jour en direct
  // ─────────────────────────────────────────────

  function setLive(state) {
    const live = $('#live');
    live.dataset.state = state;
    $('#live-text').textContent = { live: 'EN DIRECT', off: 'HORS LIGNE', connecting: 'CONNEXION…' }[state];
  }

  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('is-active', s.id === id));
  }

  function showError(kind) {
    const errors = {
      invalid: ['🔒', 'Lien invalide', "Ce lien de classeur n'est pas valide. Utilise le bouton « Mon classeur » de l'onglet Accueil Jeanpip dans Slack."],
      network: ['📡', 'Serveur injoignable', 'Impossible de joindre le serveur Jeanpip. Réessaie dans un instant.'],
    };
    const [emoji, title, text] = errors[kind] || errors.network;
    $('#error-emoji').textContent = emoji;
    $('#error-title').textContent = title;
    $('#error-text').textContent = text;
    show('screen-error');
  }

  async function fetchAlbum() {
    const url = new URL(`api/collection/${encodeURIComponent(userId)}`, BASE);
    url.searchParams.set('t', token);
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status === 403) {
      const err = new Error('invalid');
      err.fatal = true;
      throw err;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function apply(next) {
    const prev = data;
    data = next;
    if (prev) announce(prev, next);

    // On garde la page affichée (même premier numéro de page)
    const firstPage = view * perView();
    pages = buildPages();
    view = Math.min(Math.floor(firstPage / perView()), viewCount() - 1);

    renderTabs();
    renderProgress();
    document.title = next.owner && next.owner.name ? `Classeur de ${next.owner.name} · Jeanpip` : 'Mon classeur · Jeanpip';
    if (!turning) render();
  }

  let timer = null;
  let failures = 0;

  async function poll() {
    clearTimeout(timer);
    try {
      const next = await fetchAlbum();
      failures = 0;
      setLive('live');
      if (!data || next.version !== data.version) apply(next);
      if (!$('#screen-album').classList.contains('is-active')) show('screen-album');
    } catch (e) {
      if (e.fatal) return showError('invalid');
      failures += 1;
      setLive('off');
      if (!data) {
        showError('network');
      }
    }
    if (document.hidden) return; // reprise au retour sur l'onglet
    const delay = failures ? Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** failures) : POLL_MS;
    timer = setTimeout(poll, delay);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(timer);
    else poll();
  });

  // ─────────────────────────────────────────────
  // 🖱️ Interactions
  // ─────────────────────────────────────────────

  $('#btn-prev').addEventListener('click', () => goTo(view - 1));
  $('#btn-next').addEventListener('click', () => goTo(view + 1));

  addEventListener('keydown', (e) => {
    if (!$('#lightbox').hidden) {
      if (e.key === 'Escape') closeLightbox();
      return;
    }
    if (!data) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') goTo(view + 1);
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') goTo(view - 1);
  });

  // Glisser du doigt pour tourner les pages
  let swipe = null;
  $('#binder').addEventListener('pointerdown', (e) => { swipe = { x: e.clientX, y: e.clientY }; });
  $('#binder').addEventListener('pointerup', (e) => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) goTo(view + (dx < 0 ? 1 : -1));
  });

  $('#lb-close').addEventListener('click', closeLightbox);
  $('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') closeLightbox(); });

  single.addEventListener('change', () => {
    if (!data) return;
    const firstPage = view * (single.matches ? 2 : 1); // perView a déjà changé
    view = Math.floor(firstPage / perView());
    render();
  });

  // ─────────────────────────────────────────────
  // 🚀 Démarrage
  // ─────────────────────────────────────────────

  if (!userId || !/^[a-f0-9]{64}$/.test(token)) {
    showError('invalid');
  } else {
    poll();
  }
})();
