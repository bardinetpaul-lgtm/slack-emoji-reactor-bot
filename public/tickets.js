// ═══════════════════════════════════════════════════════════
//  🎟️ Kiosque des tickets à gratter « ESSAI ! »
//  Le lot est tiré par le serveur à l'achat et versé quand le ticket est
//  entièrement gratté : ici on ne fait que le révéler. Grattage = <canvas> par zone (souris / doigt),
//  une zone grattée à ~55 % se découvre entièrement.
// ═══════════════════════════════════════════════════════════
(() => {
  const token = new URLSearchParams(location.search).get('t') || '';
  const api = (p = '') => `api/tickets${p}?t=${encodeURIComponent(token)}`;
  const $ = (id) => document.getElementById(id);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 📐 Zones du design (pixels de l'image 784 × 1168)
  const W = 784;
  const H = 1168;
  const COLS = [205, 387, 561];
  const ROWS = [620, 737, 855];
  const LAYOUT = {
    ball: { w: 118, h: 76 },
    name: { w: 80, h: 34, dy: 57 },
    price: [648, 102, 120, 78],
    brand: [652, 200, 116, 73],
    legend: { y: 1060, h: 20, boxes: { ball: 25, jersey: 118, boot: 210, whistle: 302, trophy: 394, posts: 486 }, w: 85 },
    scoreUs: [606, 1000, 144, 31],
    scoreThem: [606, 1062, 144, 31],
    strip: [195, 1097, 372, 53],
  };
  const SCRATCH_DONE = 0.55;

  // ✏️ Symboles au trait (même style que la légende du ticket)
  const S = 'fill="none" stroke="#111" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"';
  const ICONS = {
    trophy: `<svg viewBox="0 0 100 100"><path ${S} d="M30 18h40v22a20 20 0 0 1-40 0zM30 26H18a12 12 0 0 0 12 18M70 26h12a12 12 0 0 1-12 18M50 60v14M36 86h28l-4-12H40z"/></svg>`,
    posts: `<svg viewBox="0 0 100 100"><path ${S} d="M30 10v80M70 10v80M30 58h40"/><path fill="#111" d="M26 90h8v4h-8zM66 90h8v4h-8z"/></svg>`,
    ball: `<svg viewBox="0 0 100 100"><ellipse ${S} cx="50" cy="50" rx="40" ry="26" transform="rotate(-30 50 50)"/><path ${S} d="M28 64C44 52 56 46 72 36M42 50l6 6M50 44l6 6M58 38l6 6"/></svg>`,
    jersey: `<svg viewBox="0 0 100 100"><path ${S} d="M36 14l-22 12 8 18 10-5v47h36V39l10 5 8-18-22-12c-2 7-7 11-14 11s-12-4-14-11z"/></svg>`,
    boot: `<svg viewBox="0 0 100 100"><path ${S} d="M12 58V30h22l6 14c14 2 30 4 42 12 6 4 6 10 0 12H16c-3 0-4-4-4-10zM24 70v8M40 70v8M56 70v8M72 70v8"/></svg>`,
    whistle: `<svg viewBox="0 0 100 100"><path ${S} d="M50 40h38v14H66a22 22 0 1 1-16-14z"/><circle ${S} cx="44" cy="62" r="8"/><path ${S} d="M28 30l-8-8"/></svg>`,
    card: `<svg viewBox="0 0 100 100"><rect x="30" y="16" width="40" height="62" rx="5" fill="#ffd400" stroke="#111" stroke-width="5" transform="rotate(12 50 47)"/></svg>`,
  };

  let state = null;        // dernier état renvoyé par l'API
  let ticket = null;       // ticket en cours de grattage
  let revealed = new Set();
  let busy = false;
  let bgImage = null;      // image du ticket chargée (texture des ballons)

  // ─────────────────────────────────────────────
  // 🧭 Placement en % du design
  // ─────────────────────────────────────────────

  function place(el, x, y, w, h) {
    el.style.left = `${(x / W) * 100}%`;
    el.style.top = `${(y / H) * 100}%`;
    el.style.width = `${(w / W) * 100}%`;
    el.style.height = `${(h / H) * 100}%`;
    return el;
  }
  const div = (cls, text = '') => Object.assign(document.createElement('div'), { className: cls, textContent: text });
  /** Icône d'un symbole (SVG statique de ICONS, jamais de donnée du serveur). */
  function icon(cls, symbol) {
    const el = div(cls);
    if (ICONS[symbol]) el.innerHTML = ICONS[symbol];
    return el;
  }

  // ─────────────────────────────────────────────
  // 🪙 Couche à gratter
  // ─────────────────────────────────────────────

  /**
   * Pose un canvas argenté sur `host` ; `crop` = zone de l'image du ticket à
   * reprendre (ballon du design) sinon texture argentée générée.
   */
  function scratchLayer(host, { crop, ellipse = false, onDone }) {
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let total = 0;
    let done = false;
    let last = null;

    function paint() {
      const r = host.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      const { width: cw, height: ch } = canvas;
      ctx.save();
      if (ellipse) { ctx.beginPath(); ctx.ellipse(cw / 2, ch / 2, cw / 2, ch / 2, 0, 0, Math.PI * 2); ctx.clip(); }
      if (crop && bgImage && bgImage.naturalWidth) {
        const k = bgImage.naturalWidth / W;
        ctx.drawImage(bgImage, crop[0] * k, crop[1] * k, crop[2] * k, crop[3] * k, 0, 0, cw, ch);
      } else {
        const g = ctx.createLinearGradient(0, 0, cw, ch);
        g.addColorStop(0, '#d9dde3'); g.addColorStop(0.45, '#a9b0ba'); g.addColorStop(0.55, '#eef1f4'); g.addColorStop(1, '#9aa2ad');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, cw, ch);
        for (let i = 0; i < (cw * ch) / 60; i++) {   // grain
          ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.25})`;
          ctx.fillRect(Math.random() * cw, Math.random() * ch, 1.5, 1.5);
        }
      }
      ctx.restore();
      total = countOpaque();
    }

    function countOpaque() {
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 16) if (d[i] > 40) n++;
      return n;
    }

    function scratchAt(x, y) {
      const r = canvas.getBoundingClientRect();
      const k = canvas.width / r.width;
      const px = (x - r.left) * k;
      const py = (y - r.top) * k;
      const radius = Math.max(10, canvas.width * 0.13);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineCap = 'round';
      ctx.lineWidth = radius * 2;
      ctx.beginPath();
      ctx.moveTo(last ? last.x : px, last ? last.y : py);
      ctx.lineTo(px, py);
      ctx.stroke();
      for (let i = 0; i < 3; i++) {   // bord irrégulier
        ctx.beginPath();
        ctx.arc(px + (Math.random() - 0.5) * radius * 1.6, py + (Math.random() - 0.5) * radius * 1.6, radius * (0.3 + Math.random() * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      last = { x: px, y: py };
    }

    let checkPending = false;
    function check() {
      if (checkPending || done) return;
      checkPending = true;
      requestAnimationFrame(() => {
        checkPending = false;
        if (total && 1 - countOpaque() / total >= SCRATCH_DONE) finish();
      });
    }

    function finish() {
      if (done) return;
      done = true;
      canvas.classList.add('gone');
      setTimeout(() => canvas.remove(), reduced ? 0 : 400);
      onDone();
    }

    let drawing = false;
    canvas.addEventListener('pointerdown', (e) => {
      if (done) return;
      drawing = true; last = null;
      canvas.setPointerCapture(e.pointerId);
      scratchAt(e.clientX, e.clientY); check();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing || done) return;
      for (const ev of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) scratchAt(ev.clientX, ev.clientY);
      check();
    });
    const stop = () => { drawing = false; last = null; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);

    paint();
    return { finish, repaint: () => { if (!done) paint(); } };
  }

  // ─────────────────────────────────────────────
  // 🎟️ Rendu du ticket
  // ─────────────────────────────────────────────

  const layers = [];

  // 🎨 Décor du ticket quand l'image du design n'est pas (encore) là
  const DECOR = [
    ['d-kicker', 'TICKET À GRATTER', [120, 60, 544, 40]],
    ['d-title', 'ESSAI !', [100, 100, 584, 125]],
    ['d-edition', 'JEANPIP EDITION', [150, 228, 484, 40]],
    ['d-heading', '3 SYMBOLES IDENTIQUES = LE GAIN', [20, 946, 560, 36]],
  ];
  const POSTS_ART = '<svg viewBox="0 0 100 100"><path fill="none" stroke="#fff" stroke-width="4" d="M30 4v92M70 4v92M30 62h40"/><ellipse fill="none" stroke="#fff" stroke-width="3" cx="50" cy="36" rx="12" ry="7" transform="rotate(-30 50 36)"/></svg>';

  function buildDecor() {
    const decor = $('decor');
    for (const [cls, text, box] of DECOR) decor.appendChild(place(div(`decor-zone ${cls}`, text), ...box));
    const art = place(div('decor-zone d-art'), 240, 280, 304, 290);
    art.innerHTML = POSTS_ART;   // SVG statique
    decor.appendChild(art);
    const { boxes, w } = LAYOUT.legend;
    for (const [symbol, x] of Object.entries(boxes)) decor.appendChild(place(icon('decor-zone d-legend-box', symbol), x, 993, w, 82));
    const score = place(div('decor-zone d-score'), 592, 938, 173, 167);
    const title = Object.assign(document.createElement('b'), { textContent: 'SCORE' });
    const us = div('d-score-label', 'Votre score');
    const them = div('d-score-label', 'Score adverse');
    us.style.marginTop = '8%';
    them.style.marginTop = '22%';
    score.append(title, us, them);
    decor.appendChild(score);
  }

  function buildStatic() {
    place($('price-box'), ...LAYOUT.price);
    place($('ticket').querySelector('.badge-brand'), ...LAYOUT.brand);
    place($('score-us'), ...LAYOUT.scoreUs);
    place($('score-them'), ...LAYOUT.scoreThem);
    place($('result-strip'), ...LAYOUT.strip);
  }

  function renderLegend() {
    const legend = $('legend');
    legend.innerHTML = '';
    const { boxes, w, y, h } = LAYOUT.legend;
    for (const prize of state.prizes) {
      const x = boxes[prize.symbol];
      if (x === undefined) continue;
      const isJackpot = prize.symbol === 'posts';
      const label = prize.kind === 'legendary' ? 'LÉGENDAIRE' : `${fmt(prize.amount)} JP$`;
      const pill = place(div(`legend-amount${prize.kind === 'legendary' ? ' legendary' : ''}${isJackpot ? ' jackpot' : ''}`, label), x + 4, y, w - 8, h);
      pill.dataset.symbol = prize.symbol;
      legend.appendChild(pill);
    }
  }

  /** Ticket « en vitrine » avant l'achat : ballons et score argentés, pas encore grattables. */
  function renderBlank() {
    layers.length = 0;
    const cells = $('cells');
    cells.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const cx = COLS[i % 3];
      const cy = ROWS[Math.floor(i / 3)];
      const { w, h } = LAYOUT.ball;
      const crop = [cx - w / 2, cy - h / 2, w, h];
      const cell = place(div('cell locked'), ...crop);
      cells.appendChild(cell);
      cells.appendChild(place(div('name-box'), cx - LAYOUT.name.w / 2, cy + LAYOUT.name.dy - LAYOUT.name.h / 2, LAYOUT.name.w, LAYOUT.name.h));
      scratchLayer(cell, { crop, ellipse: true, onDone: () => {} });
    }
    for (const id of ['score-us', 'score-them']) {
      const slot = $(id);
      slot.className = `score-slot ${id} locked`;
      slot.textContent = '';
      scratchLayer(slot, { onDone: () => {} });
    }
  }

  function renderTicket(t) {
    ticket = t;
    revealed = new Set();
    layers.length = 0;
    const cells = $('cells');
    cells.innerHTML = '';
    $('result-strip').className = 'result-strip';
    $('result-strip').textContent = '……………………';

    t.grid.forEach((symbol, i) => {
      const cx = COLS[i % 3];
      const cy = ROWS[Math.floor(i / 3)];
      const { w, h } = LAYOUT.ball;
      const crop = [cx - w / 2, cy - h / 2, w, h];
      const cell = place(div('cell'), ...crop);
      cell.dataset.symbol = symbol;
      cell.appendChild(icon('under', symbol));
      cells.appendChild(cell);
      const name = place(div('name-box', state.symbols[symbol] ? state.symbols[symbol].label : ''), cx - LAYOUT.name.w / 2, cy + LAYOUT.name.dy - LAYOUT.name.h / 2, LAYOUT.name.w, LAYOUT.name.h);
      cells.appendChild(name);
      layers.push(scratchLayer(cell, { crop, ellipse: true, onDone: () => onReveal(`c${i}`, cell, name) }));
    });

    for (const [key, id] of [['us', 'score-us'], ['them', 'score-them']]) {
      const slot = $(id);
      slot.className = `score-slot score-${key}`;
      slot.textContent = t.score ? t.score[key] : '';
      layers.push(scratchLayer(slot, { onDone: () => onReveal(`s_${key}`) }));
    }
    $('veil').hidden = true;
    $('reveal-all').hidden = false;
    $('buy').hidden = true;
    setMsg('Gratte les ballons et le score ! 3 symboles identiques = le gain.');
  }

  function onReveal(key, cell, name) {
    revealed.add(key);
    if (name) name.classList.add('on');
    if (cell) highlightPairs();
    if (revealed.size === layers.length) finishTicket();
  }

  function highlightPairs() {
    const shown = [...document.querySelectorAll('.cell')].filter((c, i) => revealed.has(`c${i}`));
    const bySymbol = {};
    for (const c of shown) (bySymbol[c.dataset.symbol] = bySymbol[c.dataset.symbol] || []).push(c);
    for (const c of shown) {
      const n = bySymbol[c.dataset.symbol].length;
      c.classList.toggle('pair', n === 2 && c.dataset.symbol !== 'card');
      c.classList.toggle('triple', n >= 3);
    }
    // 🎉 3 identiques : on le montre tout de suite (légende + bandeau), sans attendre la fin du grattage
    const trio = Object.keys(bySymbol).find((s) => bySymbol[s].length >= 3);
    if (trio && !document.querySelector(`.legend-amount.hit[data-symbol="${trio}"]`)) {
      const pill = document.querySelector(`.legend-amount[data-symbol="${trio}"]`);
      if (pill) pill.classList.add('hit');
      const prize = state.prizes.find((p) => p.symbol === trio);
      const strip = $('result-strip');
      strip.className = 'result-strip teaser';
      strip.textContent = prize && prize.kind === 'legendary' ? '3 COUPES : CARTE LÉGENDAIRE !' : `3 IDENTIQUES : ${prize ? fmt(prize.amount) : ''} JP$ !`;
      if (!reduced && prize && (prize.kind === 'legendary' || prize.symbol === 'posts')) confetti(80);
    }
  }

  // ─────────────────────────────────────────────
  // 🏁 Fin du grattage → le serveur révèle le lot
  // ─────────────────────────────────────────────

  async function finishTicket() {
    if (!ticket || busy) return;
    busy = true;
    $('reveal-all').hidden = true;
    const id = ticket.id;
    try {
      const data = await call(api(`/${encodeURIComponent(id)}/scratched`), 'POST');
      showResult(data.result);
      applyState(data, { keepTicket: true });
    } catch {
      setMsg('Connexion perdue : recharge la page pour finir ton ticket.');
    } finally {
      busy = false;
    }
  }

  function showResult(result) {
    ticket = null;
    const cells = [...document.querySelectorAll('.cell')];
    const strip = $('result-strip');
    const us = $('score-us');
    const them = $('score-them');
    if (result.kind === 'lose') {
      strip.className = 'result-strip lose';
      strip.textContent = 'PERDU… PAS CETTE FOIS !';
      us.classList.add('lost');
      setMsg('Le prochain sera le bon ?');
      return;
    }
    us.classList.add('won');
    for (const c of cells) {
      c.classList.remove('pair');
      c.classList.add(c.dataset.symbol === result.symbol ? 'win' : 'dim');
    }
    if (result.kind === 'legendary') {
      strip.className = 'result-strip big';
      strip.textContent = '🏆 CARTE LÉGENDAIRE !';
      confetti(260);
      setTimeout(() => showCard(result.card), reduced ? 0 : 900);
      setMsg('La carte est déjà dans ton classeur.');
      return;
    }
    const big = result.symbol === 'posts' || result.symbol === 'ball';
    strip.className = `result-strip ${big ? 'big' : 'win'}`;
    strip.textContent = result.amount === state.price ? `MISE REMBOURSÉE : ${fmt(result.amount)} JP$` : `GAGNÉ : ${fmt(result.amount)} JP$ !`;
    flyAmount(`+${fmt(result.amount)} JP$`);
    if (big) confetti(big && result.symbol === 'posts' ? 300 : 140);
    setMsg(result.amount === state.price ? 'Remboursé ! Tu retentes ta chance ?' : 'Bien joué ! Les JP$ sont sur ton compte.');
  }

  function showCard(card) {
    if (!card) return;
    $('card-img').src = card.image || '';
    $('card-name').textContent = card.title || '';
    $('card-count').textContent = card.count > 1 ? `Tu l'as maintenant en ${card.count} exemplaires.` : '✨ Nouvelle carte dans ta collection !';
    $('card-overlay').hidden = false;
  }
  $('card-close').addEventListener('click', () => { $('card-overlay').hidden = true; });

  // ─────────────────────────────────────────────
  // 💰 Achat + état
  // ─────────────────────────────────────────────

  const BLOCK_TEXT = {
    penalty: '🚜 Pénalité anti-farm en cours : pas de ticket pour l\'instant.',
    limit: '✅ Tu as joué tous tes tickets du jour. Reviens demain !',
    balance: '💸 Pas assez de JP$ pour un ticket.',
    error: '⚠️ Souci technique : ton ticket a été remboursé, réessaie.',
  };

  function applyState(data, { keepTicket = false } = {}) {
    state = data;
    $('balance').textContent = fmt(data.balance);
    $('price').textContent = `${fmt(data.price)} JP$`;
    $('today').textContent = `${data.boughtToday}/${data.limit} ticket${data.limit > 1 ? 's' : ''} aujourd'hui`;
    renderLegend();

    if (data.ticket && !keepTicket && (!ticket || ticket.id !== data.ticket.id)) renderTicket(data.ticket);

    const canBuy = !data.block;
    const label = `${ticket || keepTicket ? 'Rejouer' : 'Acheter un ticket'} (${fmt(data.price)} JP$)`;
    $('buy').textContent = label;
    $('buy').disabled = !canBuy;
    $('veil-buy').textContent = `Acheter un ticket (${fmt(data.price)} JP$)`;
    $('veil-buy').disabled = !canBuy;
    $('veil-msg').textContent = BLOCK_TEXT[data.block] || '3 symboles identiques sous les ballons = le gain !';
    $('howto-price').textContent = `(${fmt(data.price)} JP$)`;

    if (!data.ticket && !ticket) {
      if (keepTicket) {
        $('buy').hidden = false;
        if (data.block) setMsg(BLOCK_TEXT[data.block] || '', true);
      } else {
        renderBlank();
        $('veil').hidden = false;
        $('buy').hidden = true;
        setMsg('');
      }
    }
  }

  async function buy() {
    if (busy) return;
    busy = true;
    $('buy').disabled = true;
    $('veil-buy').disabled = true;
    try {
      const data = await call(api('/buy'), 'POST');
      if (!data.bought && data.reason !== 'pending') setMsg(BLOCK_TEXT[data.reason] || 'Achat impossible.');
      ticket = null;
      applyState(data);
      if (data.bought) flyAmount(`-${fmt(data.price)} JP$`, true);
    } catch {
      setMsg('Connexion perdue, réessaie.');
      $('buy').disabled = false;
      $('veil-buy').disabled = false;
    } finally {
      busy = false;
    }
  }
  $('buy').addEventListener('click', buy);
  $('veil-buy').addEventListener('click', buy);
  $('reveal-all').addEventListener('click', () => { for (const l of layers) l.finish(); });

  async function call(url, method = 'GET') {
    const res = await fetch(url, { method, cache: 'no-store' });
    if (res.status === 403) {
      setMsg('Lien invalide : rouvre le Kiosque depuis l\'Accueil Jeanpip.');
      throw new Error('invalid');
    }
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  // ─────────────────────────────────────────────
  // ✨ Petits effets
  // ─────────────────────────────────────────────

  const fmt = (n) => String(n).replace('.', ',');
  function setMsg(text) { $('msg').textContent = text; }

  function flyAmount(text, down = false) {
    const target = $('balance').getBoundingClientRect();
    const strip = $('result-strip').getBoundingClientRect();
    const el = Object.assign(document.createElement('div'), { className: 'fly', textContent: text });
    if (down) el.style.color = '#ff6b6b';
    document.body.appendChild(el);
    const from = down ? target : strip;
    const to = down ? strip : target;
    el.style.left = `${from.left + from.width / 2 - 40}px`;
    el.style.top = `${from.top}px`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transform = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${down ? 0.8 : 1.2})`;
      el.style.opacity = '0';
    }));
    setTimeout(() => el.remove(), 1100);
  }

  function confetti(count) {
    if (reduced) return;
    const canvas = $('confetti');
    const ctx = canvas.getContext('2d');
    canvas.width = innerWidth; canvas.height = innerHeight;
    const colors = ['#ffd23f', '#d7262b', '#ffffff', '#1d3f8f', '#c9a24a'];
    const parts = Array.from({ length: count }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 120, y: innerHeight * 0.55,
      vx: (Math.random() - 0.5) * 16, vy: -8 - Math.random() * 14,
      r: 4 + Math.random() * 5, c: colors[Math.floor(Math.random() * colors.length)], a: Math.random() * 6,
    }));
    const t0 = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of parts) {
        p.vy += 0.45; p.x += p.vx; p.y += p.vy; p.a += 0.2;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
        ctx.fillStyle = p.c; ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
        ctx.restore();
      }
      if (t - t0 < 3200) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    })(t0);
  }

  // ─────────────────────────────────────────────
  // 🚀 Démarrage
  // ─────────────────────────────────────────────

  window.addEventListener('resize', () => { for (const l of layers) l.repaint(); });

  async function start() {
    buildStatic();
    const img = $('ticket-bg');
    await new Promise((resolve) => {
      if (img.complete) resolve();
      else { img.onload = resolve; img.onerror = resolve; }
    });
    bgImage = img.naturalWidth ? img : null;
    if (!bgImage) {   // pas encore d'image : ticket dessiné en CSS
      img.remove();
      $('ticket').classList.add('no-art');
      buildDecor();
    }
    try {
      applyState(await call(api()));
    } catch {
      if (!$('msg').textContent) setMsg('Impossible de charger le Kiosque, réessaie dans un instant.');
    }
  }
  start();
})();
