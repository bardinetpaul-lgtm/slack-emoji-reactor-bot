// ═══════════════════════════════════════════════════════════
//  📺 JP TV — page de diffusion de l'Arène (TV du hall, v2.3)
//    GET ../api/tv/stream?k=  (SSE)
//      idle  → écran d'attente
//      setup → alerte « PRIORITÉ AU DIRECT » (4 s) puis le combat
//      state → terrain (5 Hz, interpolé), chrono, tours détruites
//      ended → écran de fin (le serveur le garde 10 s, puis idle)
//      also  → bandeau « Aussi en direct »
//  Lecture seule : aucune action possible, ni main ni élixir affichés.
// ═══════════════════════════════════════════════════════════
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // 🖥️ v3.0.4 : la page est dessinée en 1920×1080 puis mise à l'échelle de l'écran,
  //    centrée, sans rien couper (le navigateur de la TV a un écran logique plus petit).
  const STAGE = { w: 1920, h: 1080 };
  function fitStage() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const s = Math.min(vw / STAGE.w, vh / STAGE.h);
    $('stage').style.transform = `translate(${(vw - STAGE.w * s) / 2}px, ${(vh - STAGE.h * s) / 2}px) scale(${s})`;
  }
  fitStage();
  window.addEventListener('resize', fitStage);

  const k = new URLSearchParams(location.search).get('k') || '';
  const decoder = ArenaWire.createDecoder();
  const ALERT_MS = 4000;
  const REASONS = { qg: 'QG détruit', towers: 'plus de tours détruites', qg_hp: 'QG le plus solide', forfeit: 'par abandon', disconnect: 'par déconnexion' };
  const RECONNECT_MS = 3000;
  let renderer = null;
  let names = { A: 'Joueur A', B: 'Joueur B' };
  let alertTimer = null;

  function show(id) {
    for (const s of ['idle', 'live', 'ended']) $(s).hidden = s !== id;
  }
  function clock(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  const towersText = (n) => `${n} tour${n > 1 ? 's' : ''} détruite${n > 1 ? 's' : ''}`;

  // 🂠 v3.0.4 : cartes restantes de chaque joueur, face cachée (le nombre seulement, jamais les cartes)
  const handShown = { a: null, b: null };
  function renderHand(slot, n) {
    if (typeof n !== 'number' || handShown[slot] === n) return;
    handShown[slot] = n;
    const box = $(`hand-${slot}`);
    const backs = document.createElement('span');
    backs.className = 'backs';
    for (let i = 0; i < n; i += 1) {
      const b = document.createElement('i');
      b.className = 'card-back';
      backs.append(b);
    }
    const label = document.createElement('span');
    label.className = 'hand-count';
    label.textContent = n ? `${n} carte${n > 1 ? 's' : ''} restante${n > 1 ? 's' : ''}` : 'plus aucune carte';
    box.replaceChildren(backs, label);
  }

  function stopRenderer() {
    if (renderer) renderer.stop();
    renderer = null;
  }

  let current = null;
  function connect() {
    const es = new EventSource(`../api/tv/stream?k=${encodeURIComponent(k)}`);
    current = es;
    bind(es);
    // Un statut HTTP non-200 (403, 502…) ferme le flux pour de bon : on le recrée
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED && current === es) setTimeout(connect, RECONNECT_MS);
    };
  }

  function bind(es) {
  es.addEventListener('idle', () => {
    stopRenderer();
    $('alert').hidden = true;
    $('clock').textContent = '';
    show('idle');
  });

  es.addEventListener('setup', (e) => {
    const s = JSON.parse(e.data);
    decoder.reset();
    names = s.names || names;
    $('name-a').textContent = names.A;
    $('name-b').textContent = names.B;
    $('towers-a').textContent = towersText(0);
    $('towers-b').textContent = towersText(0);
    handShown.a = null;
    handShown.b = null;
    $('hand-a').replaceChildren();
    $('hand-b').replaceChildren();
    $('x2').hidden = true;
    stopRenderer();
    renderer = ArenaBoard.createRenderer($('board'), { arena: s.arena, symbols: s.symbols, sprites: s.sprites, step: 200 });
    show('live');
    // ⚠️ Priorité au direct : alerte plein écran avant le combat
    $('alert-names').textContent = `${names.A} 🆚 ${names.B}`;
    $('alert').hidden = false;
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => { $('alert').hidden = true; }, ALERT_MS);
  });

  es.addEventListener('state', (e) => {
    const v = decoder.decode(JSON.parse(e.data));
    if (renderer) renderer.push(v);
    $('clock').textContent = clock(v.remainingMs);
    $('towers-a').textContent = towersText(v.players.A.towersDestroyed);
    $('towers-b').textContent = towersText(v.players.B.towersDestroyed);
    renderHand('a', v.players.A.handCount);
    renderHand('b', v.players.B.handCount);
    $('x2').hidden = !v.doubleElixir;
  });

  es.addEventListener('ended', (e) => {
    const v = JSON.parse(e.data);
    const n = v.names || names;
    stopRenderer();
    $('alert').hidden = true;
    if (v.phase === 'cancelled' || !v.result) {
      $('ended-title').textContent = 'Combat annulé';
      $('ended-sub').textContent = `${n.A} 🆚 ${n.B}`;
    } else if (!v.result.winner) {
      $('ended-title').textContent = '🤝 Match nul';
      $('ended-sub').textContent = `${n.A} 🆚 ${n.B}`;
    } else {
      const w = v.result.winner;
      const l = w === 'A' ? 'B' : 'A';
      const t = v.result.towers;
      const score = t ? ` · ${t[w]}–${t[l]} tours` : '';
      const reason = REASONS[v.result.reason];
      $('ended-title').textContent = `🏆 ${n[w]}`;
      $('ended-sub').textContent = `bat ${n[l]}${reason ? ` · ${reason}` : ''}${score}`;
    }
    show('ended');
  });

  es.addEventListener('also', (e) => {
    const list = JSON.parse(e.data);
    $('also').hidden = !list.length;
    $('also').textContent = list.length ? `Aussi en direct : ${list.map((m) => `${m.a} 🆚 ${m.b}`).join(' · ')}` : '';
  });
  }

  connect();
}());
