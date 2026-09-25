// ═══════════════════════════════════════════════════════════
//  🎬 Jeanpip — ouverture de booster « à la FIFA »
//
//  La page ne tire RIEN : elle appelle POST api/open/<id>?t=<token>,
//  le serveur tire les cartes, les met en collection, et renvoie
//  { status, booster, cards }. La page se contente du spectacle.
//
//  Déroulé : pack → ouverture → walkout (meilleure rareté)
//            → révélations une par une → récap.
// ═══════════════════════════════════════════════════════════

(() => {
  'use strict';

  // ─────────────────────────────────────────────
  // 🧭 Contexte (page servie sur …/open/<id>?t=<token>)
  // ─────────────────────────────────────────────

  const BASE = new URL('../', location.href);
  const boosterId = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
  const token = new URLSearchParams(location.search).get('t') || '';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const RARITY_RANK = { common: 0, rare: 1, epic: 2, legendary: 3 };
  const RARITY = {
    common:    { label: 'Commune',    plural: 'Communes',    emoji: '⚪', color: '#d7dde6' },
    rare:      { label: 'Rare',       plural: 'Rares',       emoji: '🔵', color: '#3d8bff' },
    epic:      { label: 'Épique',     plural: 'Épiques',     emoji: '🟣', color: '#b35cff' },
    legendary: { label: 'Légendaire', plural: 'Légendaires', emoji: '🟡', color: '#ffc83d' },
  };

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  // ─────────────────────────────────────────────
  // 🔊 Sons synthétisés (Web Audio, aucun fichier) — coupés par défaut
  // ─────────────────────────────────────────────

  const sound = (() => {
    let ctx = null;
    let enabled = false;
    try { enabled = localStorage.getItem('jeanpip-sound') === 'on'; } catch { /* stockage bloqué */ }

    function ensure() {
      if (!enabled) return null;
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }

    function tone(freq, dur, { type = 'sine', gain = 0.18, delay = 0, slideTo = null } = {}) {
      const c = ensure();
      if (!c) return;
      const t = c.currentTime + delay;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(c.destination);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }

    function noise(dur, { from = 400, to = 4000, gain = 0.25, q = 1.2, delay = 0 } = {}) {
      const c = ensure();
      if (!c) return;
      const t = c.currentTime + delay;
      const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource();
      src.buffer = buffer;
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = q;
      filter.frequency.setValueAtTime(from, t);
      filter.frequency.exponentialRampToValueAtTime(to, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(filter).connect(g).connect(c.destination);
      src.start(t);
    }

    const chord = (freqs, dur, opts) => freqs.forEach((f) => tone(f, dur, opts));

    return {
      get enabled() { return enabled; },
      toggle() {
        enabled = !enabled;
        try { localStorage.setItem('jeanpip-sound', enabled ? 'on' : 'off'); } catch { /* ignoré */ }
        if (enabled) this.flip();
        return enabled;
      },
      rumble() { tone(70, 0.6, { type: 'sawtooth', gain: 0.08, slideTo: 110 }); },
      tear() { noise(0.55, { from: 300, to: 6000, gain: 0.35 }); tone(180, 0.4, { type: 'triangle', gain: 0.12, slideTo: 520 }); },
      whoosh() { noise(0.4, { from: 1200, to: 300, gain: 0.18, q: 0.8 }); },
      flip() { noise(0.07, { from: 2500, to: 5000, gain: 0.22, q: 3 }); },
      tease(rank) { tone(110 + rank * 30, 0.5, { type: 'triangle', gain: 0.1, slideTo: 220 + rank * 60 }); },
      reveal(rarity) {
        const r = RARITY_RANK[rarity] || 0;
        if (r === 0) return tone(880, 0.18, { gain: 0.1 });
        const notes = [[523, 659, 784], [523, 659, 784, 1047], [392, 523, 659, 784, 1047, 1319]][r - 1];
        notes.forEach((f, i) => tone(f, 0.5, { type: 'triangle', gain: 0.13, delay: i * 0.07 }));
      },
      fanfare() {
        chord([262, 330, 392], 0.35, { type: 'sawtooth', gain: 0.05 });
        chord([294, 370, 440], 0.35, { type: 'sawtooth', gain: 0.05, delay: 0.32 });
        chord([392, 494, 587, 784], 1.4, { type: 'sawtooth', gain: 0.06, delay: 0.64 });
        chord([784, 988, 1175], 1.4, { type: 'sine', gain: 0.08, delay: 0.64 });
      },
    };
  })();

  // ─────────────────────────────────────────────
  // ✨ Particules (canvas)
  // ─────────────────────────────────────────────

  const fx = (() => {
    const canvas = $('#fx');
    const ctx = canvas.getContext('2d');
    const parts = [];
    let raining = null;
    let running = false;
    let dpr = 1;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
    }
    addEventListener('resize', resize);
    resize();

    function spawn(p) {
      parts.push(p);
      if (!running) { running = true; requestAnimationFrame(tick); }
    }

    function tick() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (raining && Math.random() < 0.9) {
        for (let k = 0; k < 3; k++) {
          spawn({
            x: Math.random() * innerWidth, y: -10, vx: (Math.random() - 0.5) * 1.2, vy: 2 + Math.random() * 3,
            g: 0.02, life: 0, max: 220, size: 2 + Math.random() * 4, color: raining, spin: Math.random() * 6, star: Math.random() < 0.3,
          });
        }
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life++;
        p.vy += p.g;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.spin += 0.1;
        const alpha = Math.max(0, 1 - p.life / p.max);
        if (alpha <= 0 || p.y > innerHeight + 20) { parts.splice(i, 1); continue; }
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x * dpr, p.y * dpr);
        ctx.rotate(p.spin);
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8 * dpr;
        const s = p.size * dpr;
        if (p.star) {
          ctx.beginPath();
          for (let k = 0; k < 4; k++) {
            ctx.rotate(Math.PI / 2);
            ctx.lineTo(0, -s * 1.6);
            ctx.lineTo(s * 0.35, -s * 0.35);
          }
          ctx.fill();
        } else {
          ctx.fillRect(-s / 2, -s / 2, s, s * 0.6);
        }
        ctx.restore();
      }
      if (parts.length || raining) requestAnimationFrame(tick);
      else { running = false; ctx.clearRect(0, 0, canvas.width, canvas.height); }
    }

    return {
      burst(x, y, color, n = 60, power = 9) {
        if (reducedMotion) return;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const v = power * (0.3 + Math.random() * 0.7);
          spawn({
            x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, g: 0.16, life: 0, max: 70 + Math.random() * 50,
            size: 2 + Math.random() * 5, color, spin: Math.random() * 6, star: Math.random() < 0.35,
          });
        }
      },
      rain(color) { if (!reducedMotion) { raining = color; if (!running) { running = true; requestAnimationFrame(tick); } } },
      stopRain() { raining = null; },
      clear() { parts.length = 0; raining = null; },
    };
  })();

  // ─────────────────────────────────────────────
  // ⏱️ Orchestration : chaque « run » peut être passé ou relancé
  // ─────────────────────────────────────────────

  let run = null;

  function newRun() {
    if (run) run.dead = true;
    run = { dead: false, wake: null };
    return run;
  }

  // Attente interruptible : un clic (nudge) ou « Passer » la raccourcit.
  function sleep(r, ms) {
    return new Promise((resolve) => {
      const id = setTimeout(done, reducedMotion ? Math.min(ms, 350) : ms);
      function done() { clearTimeout(id); r.wake = null; resolve(); }
      r.wake = done;
    });
  }
  const nudge = () => { if (run && run.wake) run.wake(); };

  function show(screenId) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('is-active', s.id === screenId));
  }

  function setGlow(rarity) {
    document.documentElement.style.setProperty('--glow', RARITY[rarity].color);
  }

  function flash(rarity) {
    setGlow(rarity);
    const f = $('.flash');
    f.classList.remove('go');
    void f.offsetWidth; // relance l'animation
    f.classList.add('go');
  }

  function atmosphere({ dark = false, beams = false, focus = false } = {}) {
    document.body.classList.toggle('is-dark', dark);
    document.body.classList.toggle('has-beams', beams);
    document.body.classList.toggle('is-focus', focus);
  }

  // ─────────────────────────────────────────────
  // 🃏 Construction d'une carte
  // ─────────────────────────────────────────────

  function assetUrl(u) {
    return u ? new URL(u, BASE).href : null;
  }

  function cardNumber(title) {
    const m = /#(\d+)/.exec(title || '');
    return m ? `#${m[1]}` : '★';
  }

  function cardName(title) {
    return (title || 'Jeanpip').replace(/^[^\p{L}\p{N}#]+/u, '').trim();
  }

  function buildCard(card, { flipped = false } = {}) {
    const rarity = RARITY[card.rarity] ? card.rarity : 'common';
    const root = el('div', `card r-${rarity}${flipped ? ' is-flipped' : ''}`);
    const inner = el('div', 'card-inner');

    const back = el('div', 'card-back');
    back.appendChild(el('span', null, 'J'));

    const front = el('div', 'card-front');
    const art = el('div', 'card-art');
    const fallback = el('div', 'card-fallback', 'J');
    art.appendChild(fallback);
    const src = assetUrl(card.image);
    if (src) {
      const img = el('img');
      img.alt = card.title;
      img.decoding = 'async';
      img.src = src;
      img.addEventListener('load', () => { fallback.hidden = true; });
      img.addEventListener('error', () => img.remove());
      art.appendChild(img);
    }
    if (card.type === 'video') art.appendChild(el('div', 'card-play', '▶'));

    const num = el('div', 'card-num', cardNumber(card.title));
    num.appendChild(el('small', null, RARITY[rarity].label.slice(0, 3).toUpperCase()));

    const info = el('div', 'card-info');
    info.appendChild(el('div', 'card-name', cardName(card.title)));
    info.appendChild(el('div', 'card-rarity', RARITY[rarity].label));

    front.append(art, num, info);
    if (card.count === 1) front.appendChild(el('div', 'card-badge', 'NOUVELLE'));
    else if (card.count > 1) front.appendChild(el('div', 'card-badge dup', `×${card.count}`));

    inner.append(back, front);
    root.appendChild(inner);
    root.title = card.title;
    return root;
  }

  // ─────────────────────────────────────────────
  // 🎁 Séquence complète
  // ─────────────────────────────────────────────

  let state = null; // { booster, cards, replay }

  function bestRarity(cards) {
    return cards.reduce((best, c) => (RARITY_RANK[c.rarity] > RARITY_RANK[best] ? c.rarity : best), 'common');
  }

  function preparePack() {
    const pack = $('#pack');
    pack.className = 'pack';
    pack.dataset.type = state.booster.type;
    const label = `BOOSTER\n${(state.booster.label || '').toUpperCase()}`;
    pack.querySelectorAll('.pack-face').forEach((f) => { f.dataset.label = label; });
    $('.replay-tag').hidden = !state.replay;
    atmosphere();
    fx.clear();
    $('#btn-skip').hidden = true;
    show('screen-pack');
  }

  async function openPack() {
    const r = newRun();
    const pack = $('#pack');
    $('#btn-skip').hidden = false;
    sound.rumble();
    pack.classList.add('is-shaking');
    await sleep(r, 650);
    if (r.dead) return;

    sound.tear();
    pack.classList.remove('is-shaking');
    pack.classList.add('is-torn');
    flash('common');
    const rect = pack.getBoundingClientRect();
    fx.burst(rect.left + rect.width / 2, rect.top + rect.height * 0.18, '#ffffff', 40, 7);
    await sleep(r, 700);
    if (r.dead) return;

    await walkout(r);
    if (r.dead) return;
    await reveal(r);
    if (r.dead) return;
    showRecap();
  }

  async function walkout(r) {
    const best = bestRarity(state.cards);
    const text = $('#walkout-text');
    text.classList.remove('go');
    show('screen-walkout');
    setGlow(best);

    if (best === 'legendary') {
      atmosphere({ dark: true });
      await sleep(r, 900); // silence… suspense
      if (r.dead) return;
      atmosphere({ dark: true, beams: true });
      sound.fanfare();
      flash('legendary');
      fx.rain(RARITY.legendary.color);
      text.textContent = 'LÉGENDAIRE';
      void text.offsetWidth;
      text.classList.add('go');
      await sleep(r, 3000);
      fx.stopRain();
    } else if (best === 'epic') {
      atmosphere({ dark: true, beams: true });
      sound.reveal('epic');
      flash('epic');
      fx.burst(innerWidth / 2, innerHeight / 2, RARITY.epic.color, 90, 11);
      text.textContent = 'ÉPIQUE';
      void text.offsetWidth;
      text.classList.add('go');
      await sleep(r, 2400);
    } else {
      sound.whoosh();
      flash(best);
      if (best === 'rare') fx.burst(innerWidth / 2, innerHeight / 2, RARITY.rare.color, 50, 8);
      await sleep(r, best === 'rare' ? 1000 : 600);
    }
  }

  async function reveal(r) {
    const spot = $('#spotlight');
    const grid = $('#mini-grid');
    const counter = $('#reveal-counter');
    spot.replaceChildren();
    grid.replaceChildren(...state.cards.map((c) => buildCard(c)));
    atmosphere({ focus: true });
    show('screen-reveal');
    await sleep(r, 450);

    for (let i = 0; i < state.cards.length; i++) {
      if (r.dead) return;
      const card = state.cards[i];
      const rank = RARITY_RANK[card.rarity] || 0;
      const late = i >= 5; // les 3 slots « à rareté »
      counter.textContent = `CARTE ${i + 1} / ${state.cards.length}`;
      setGlow(card.rarity);

      const big = buildCard(card);
      if (rank === 3) {
        atmosphere({ dark: true, beams: true });
        big.classList.add('is-descending');
      }
      spot.replaceChildren(big);
      sound.whoosh();

      // Teasing : plus la carte est rare, plus le dos pulse longtemps
      if (rank > 0 || late) {
        await sleep(r, rank === 3 ? 1600 : 350);
        if (r.dead) return;
        big.classList.add('is-teasing');
        sound.tease(rank);
        await sleep(r, [700, 1000, 1400, 1800][rank]);
      } else {
        await sleep(r, 220);
      }
      if (r.dead) return;

      big.classList.remove('is-teasing');
      big.classList.add('is-flipped');
      sound.flip();
      if (rank > 0) {
        await sleep(r, 260);
        if (r.dead) return;
        const b = big.getBoundingClientRect();
        fx.burst(b.left + b.width / 2, b.top + b.height / 2, RARITY[card.rarity].color, 30 + rank * 30, 6 + rank * 2);
        sound.reveal(card.rarity);
        if (rank === 3) fx.rain(RARITY.legendary.color);
      }
      grid.children[i].classList.add('is-flipped');

      await sleep(r, rank === 0 && !late ? 650 : 1200 + rank * 450);
      fx.stopRain();
      if (r.dead) return;

      big.classList.add('is-leaving');
      if (rank === 3) atmosphere({ focus: true });
      await sleep(r, 250);
    }
  }

  function showRecap() {
    if (run) run.dead = true;
    fx.stopRain();
    atmosphere({ focus: true });
    $('#btn-skip').hidden = true;

    const best = bestRarity(state.cards);
    const titles = {
      legendary: 'PACK LÉGENDAIRE ! 🏆',
      epic: 'QUEL PACK ! 🔥',
      rare: 'PAS MAL DU TOUT ! 👌',
      common: 'BOOSTER OUVERT ✅',
    };
    $('#recap-title').textContent = titles[best];

    const byRarity = {};
    state.cards.forEach((c) => { byRarity[c.rarity] = (byRarity[c.rarity] || 0) + 1; });
    const parts = Object.keys(RARITY)
      .filter((k) => byRarity[k])
      .map((k) => `${RARITY[k].emoji} ${byRarity[k]} ${byRarity[k] > 1 ? RARITY[k].plural : RARITY[k].label}`);
    const fresh = state.cards.filter((c) => c.count === 1).length;
    const stats = $('#recap-stats');
    stats.replaceChildren(document.createTextNode(`${parts.join(' · ')} — `));
    stats.appendChild(el('b', null, `${fresh} nouvelle${fresh > 1 ? 's' : ''} carte${fresh > 1 ? 's' : ''}`));
    stats.appendChild(document.createTextNode(' dans ta collection'));

    const grid = $('#recap-grid');
    grid.replaceChildren(...state.cards.map((c, i) => {
      const node = buildCard(c, { flipped: true });
      node.style.animationDelay = `${i * 60}ms`;
      node.tabIndex = 0;
      node.setAttribute('role', 'link');
      const open = () => window.open(c.link, '_blank', 'noopener');
      node.addEventListener('click', open);
      node.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
      return node;
    }));

    show('screen-recap');
    if (RARITY_RANK[best] >= 2) {
      setTimeout(() => fx.burst(innerWidth / 2, innerHeight * 0.2, RARITY[best].color, 70, 10), 300);
    }
  }

  // ─────────────────────────────────────────────
  // ⚠️ Erreurs
  // ─────────────────────────────────────────────

  function showError(kind) {
    const errors = {
      invalid:   ['🔒', 'Lien invalide', "Ce lien d'ouverture n'est pas valide. Utilise le bouton « Ouverture FIFA » reçu dans Slack."],
      not_found: ['🕵️', 'Booster introuvable', "Ce booster n'existe pas (ou plus). Vérifie ton DM Jeanpip dans Slack."],
      slack:     ['💬', 'Déjà ouvert dans Slack', 'Ce booster a déjà été ouvert dans Slack : tes cartes sont déjà dans ta collection !'],
      network:   ['📡', 'Serveur injoignable', "Impossible de joindre le serveur Jeanpip. Réessaie dans un instant, ou ouvre ton booster directement dans Slack."],
    };
    const [emoji, title, text] = errors[kind] || errors.network;
    $('#error-emoji').textContent = emoji;
    $('#error-title').textContent = title;
    $('#error-text').textContent = text;
    show('screen-error');
  }

  // ─────────────────────────────────────────────
  // 🚀 Démarrage
  // ─────────────────────────────────────────────

  function preload(cards) {
    const urls = cards.map((c) => assetUrl(c.image)).filter(Boolean);
    const all = urls.map((u) => new Promise((resolve) => {
      const img = new Image();
      img.onload = img.onerror = resolve;
      img.src = u;
    }));
    // On n'attend jamais plus de 4 s : le visuel de repli prend le relais
    return Promise.race([Promise.all(all), new Promise((r) => setTimeout(r, 4000))]);
  }

  async function start() {
    if (!boosterId || !/^[a-f0-9]{64}$/.test(token)) return showError('invalid');

    let data;
    try {
      const url = new URL(`api/open/${encodeURIComponent(boosterId)}`, BASE);
      url.searchParams.set('t', token);
      const res = await fetch(url, { method: 'POST' });
      if (res.status === 403) return showError('invalid');
      if (res.status === 404) return showError('not_found');
      if (!res.ok) return showError('network');
      data = await res.json();
    } catch {
      return showError('network');
    }

    if (data.status === 'already_slack') return showError('slack');
    if (!Array.isArray(data.cards) || data.cards.length === 0) return showError('network');

    state = { booster: data.booster, cards: data.cards, replay: data.status === 'replay' };
    await preload(state.cards);
    preparePack();
  }

  // ─────────────────────────────────────────────
  // 🖱️ Interactions
  // ─────────────────────────────────────────────

  const pack = $('#pack');
  pack.addEventListener('click', () => { if (!pack.classList.contains('is-torn')) openPack(); });

  // Inclinaison 3D du pack qui suit la souris / le doigt
  addEventListener('pointermove', (e) => {
    if (reducedMotion || !$('#screen-pack').classList.contains('is-active')) return;
    const x = e.clientX / innerWidth - 0.5;
    const y = e.clientY / innerHeight - 0.5;
    pack.style.setProperty('--tilt-y', `${x * 24}deg`);
    pack.style.setProperty('--tilt-x', `${-y * 18}deg`);
  });

  $('#spotlight').addEventListener('click', nudge);
  addEventListener('keydown', (e) => {
    if (!$('#screen-reveal').classList.contains('is-active')) return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); nudge(); }
    if (e.key === 'Escape') showRecap();
  });

  $('#btn-skip').addEventListener('click', showRecap);
  $('#btn-replay').addEventListener('click', () => { state.replay = true; preparePack(); });

  const soundBtn = $('#btn-sound');
  const renderSound = () => {
    soundBtn.textContent = sound.enabled ? '🔊' : '🔇';
    soundBtn.setAttribute('aria-pressed', String(sound.enabled));
    soundBtn.title = sound.enabled ? 'Couper le son' : 'Activer le son';
  };
  soundBtn.addEventListener('click', () => { sound.toggle(); renderSound(); });
  renderSound();

  start();
})();
