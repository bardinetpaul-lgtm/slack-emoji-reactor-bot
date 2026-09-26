// ═══════════════════════════════════════════════════════════
//  ⚔️ Arène Jeanpip — client de l'écran de combat
//  DA « Combat - Menu de pose » : toucher une carte (elle monte de
//  10 px, cernée de crème, zones de pose en pointillé bleu), puis un
//  point de sa moitié d'arène. Refus → pastille explicative.
//
//  Contrat serveur (chemins relatifs, page servie sur …/arena/<id>?t=) :
//    GET  ../api/arena/<id>/stream?t=  (SSE)
//         event « setup » : { arena, names: { you, opponent }, symbols, sprites, images,
//                             catalogue: [{ url, title, rarity, archetype, cost, copies, image }] }
//         event « state » : vue du joueur (src/game/matches.js view) + events
//    POST ../api/arena/<id>/action?t=  { type: 'deploy', url, lane, forward }
//         | { type: 'decks', decks, active } | { type: 'ready', ready, urls }
//         | { type: 'forfeit' }  → { ok, reason? }
// ═══════════════════════════════════════════════════════════
(function () {
  'use strict';

  const matchId = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
  const token = new URLSearchParams(location.search).get('t') || '';
  const api = (what) => `../api/arena/${encodeURIComponent(matchId)}/${what}?t=${encodeURIComponent(token)}`;

  const $ = (id) => document.getElementById(id);
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const REFUSALS = {
    elixir: 'Pas assez d’élixir',
    zone: 'Hors de votre zone de pose',
    no_breach: 'Hors de votre zone de pose',
    lane: 'Hors de votre zone de pose',
    pump_active: 'Une seule Pompe à la fois',
    not_in_hand: 'Cette carte n’est plus en main',
    not_running: 'Le combat est terminé',
    network: 'Connexion perdue, réessaie',
  };

  let setup = null;
  let renderer = null;
  let view = null;
  let selected = null;      // url de la carte choisie
  let handKey = '';
  let pillTimer = null;
  let editor = null;
  let shownPhase = null;
  const ARENA_NAMES = { jardin: 'Arène 01 · Le jardin', port: 'Arène 02 · Le port', serveurs: 'Arène 03 · La salle serveur' };

  // ─────────────────────────────────────────────
  // 🧱 Petits constructeurs DOM (aucun innerHTML sur du texte)
  // ─────────────────────────────────────────────

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /** Face d'une carte : image du Jeanpip, sinon son personnage. */
  function cardFace(card) {
    const img = setup && setup.images && setup.images[card.url];
    if (img) {
      const i = el('img');
      i.src = img;
      i.alt = card.title || '';
      i.loading = 'lazy';
      i.onerror = () => i.replaceWith(characterFace(card));
      return i;
    }
    return characterFace(card);
  }

  function characterFace(card) {
    const wrap = el('span', 'face');
    const sprite = setup && setup.sprites && setup.sprites[card.url];
    const id = sprite && (typeof sprite === 'string' ? sprite : sprite.id);
    if (!id) return wrap;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '-45 -85 90 95');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#${id}`);
    for (const [k, v] of [['x', -45], ['y', -85], ['width', 90], ['height', 95]]) use.setAttribute(k, String(v));
    use.setAttribute('style', 'color:#1C72F1');
    svg.appendChild(use);
    wrap.appendChild(svg);
    return wrap;
  }

  function costBadge(cost) {
    return el('span', 'cost', String(cost));
  }

  // ─────────────────────────────────────────────
  // 💬 Pastille de refus / d'info sur le terrain
  // ─────────────────────────────────────────────

  function flash(reason, yPct = 50) {
    const pill = $('pill');
    pill.textContent = REFUSALS[reason] || reason;
    pill.style.top = `${Math.min(92, Math.max(8, yPct))}%`;
    pill.hidden = false;
    clearTimeout(pillTimer);
    pillTimer = setTimeout(() => { pill.hidden = true; }, 1400);
  }

  // ─────────────────────────────────────────────
  // 📡 Actions
  // ─────────────────────────────────────────────

  async function send(action) {
    try {
      const res = await fetch(api('action'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      });
      return await res.json();
    } catch {
      return { ok: false, reason: 'network' };
    }
  }

  // ─────────────────────────────────────────────
  // 🃏 Main, carte suivante, élixir
  // ─────────────────────────────────────────────

  function renderHand(v) {
    const me = v.players[v.you];
    const hand = me.hand || [];
    if (selected && !hand.some((c) => c.url === selected)) selectCard(null);
    const key = JSON.stringify([hand.map((c) => [c.url, c.copies, c.cost <= me.elixir]), selected, me.next && me.next.url]);
    if (key === handKey) return;
    handKey = key;

    const box = $('hand');
    box.replaceChildren(...hand.map((c) => {
      const b = el('button', 'card');
      b.type = 'button';
      if (c.cost > me.elixir) b.classList.add('poor');
      if (c.url === selected) b.classList.add('selected');
      b.setAttribute('aria-pressed', String(c.url === selected));
      b.setAttribute('aria-label', `${c.title || 'Carte'}, coût ${c.cost}, ${c.copies} exemplaire(s)`);
      b.append(cardFace(c), costBadge(c.cost));
      if (c.copies > 1) b.append(el('span', 'copies', `×${c.copies}`));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        selectCard(selected === c.url ? null : c.url);
      });
      return b;
    }));

    const next = $('next-card');
    next.replaceChildren();
    if (me.next) next.append(cardFace(me.next), costBadge(me.next.cost));
  }

  function selectCard(url) {
    selected = url;
    handKey = '';
    $('board-wrap').classList.toggle('selecting', Boolean(url));
    if (renderer) renderer.setZones(Boolean(url));
    if (view && view.phase === 'running') renderHand(view);
  }

  function renderElixir(v) {
    const elixir = v.players[v.you].elixir;
    $('elixir-count').textContent = String(Math.floor(elixir));
    const segs = $('elixir-segs');
    if (!segs.children.length) {
      for (let i = 0; i < 10; i += 1) {
        const s = el('span', 'seg');
        s.append(el('i'));
        segs.append(s);
      }
    }
    [...segs.children].forEach((s, i) => {
      const fill = Math.max(0, Math.min(1, elixir - i));
      s.classList.toggle('full', fill >= 1);
      s.firstChild.style.width = `${fill * 100}%`;
    });
  }

  function renderClock(ms) {
    const s = Math.ceil(ms / 1000);
    $('clock').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // ─────────────────────────────────────────────
  // 👆 Pose : point touché sur le terrain
  // ─────────────────────────────────────────────

  $('board').addEventListener('click', async (e) => {
    if (!selected || !view || view.phase !== 'running') return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * ArenaBoard.W;
    const y = ((e.clientY - r.top) / r.height) * ArenaBoard.H;
    const yPct = (y / ArenaBoard.H) * 100;
    const me = view.players[view.you];
    const card = (me.hand || []).find((c) => c.url === selected);
    if (!card) return selectCard(null);

    const spot = ArenaBoard.pointToDeploy(x, y, renderer.current() || view);
    if (!spot.ok) return flash(spot.reason, yPct);
    if (card.cost > me.elixir) return flash('elixir', yPct);

    const url = selected;
    selectCard(null);
    const res = await send({ type: 'deploy', url, lane: spot.lane, forward: spot.forward });
    if (!res.ok) flash(res.reason, yPct);
    return undefined;
  });

  document.addEventListener('keydown', (e) => {
    if (!view || view.phase !== 'running') return;
    const hand = view.players[view.you].hand || [];
    const n = Number(e.key);
    if (n >= 1 && n <= hand.length) selectCard(hand[n - 1].url);
    if (e.key === 'Escape') selectCard(null);
  });

  // ─────────────────────────────────────────────
  // ⏳ Préparation · 🏁 Fin
  // ─────────────────────────────────────────────

  function renderPreparing(v) {
    const names = (setup && setup.names) || {};
    $('prep-me').textContent = names.you || 'Vous';
    $('prep-opp').textContent = names.opponent || 'Adversaire';
    $('prep-arena').textContent = ARENA_NAMES[v.arena] || '';
    const chip = (id, who, ready) => {
      $(id).classList.toggle('ready', ready);
      $(id).lastChild.textContent = `${who} · ${ready ? 'prêt' : 'en préparation'}`;
    };
    chip('chip-me', 'Vous', v.ready.you);
    chip('chip-opp', names.opponent || 'Adversaire', v.ready.opponent);
    const left = Math.max(0, Math.ceil((v.deadline - Date.now()) / 1000));
    $('prep-clock').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

    if (!editor && setup && setup.catalogue) {
      editor = DeckEditor.mount($('editor'), {
        catalogue: setup.catalogue,
        decks: v.decks,
        active: v.activeDeck,
        mode: 'prep',
        onSave: (value) => send({ type: 'decks', ...value }),
        onReady: async (ready, urls) => {
          const res = await send({ type: 'ready', ready, urls });
          if (!res.ok) editor.setStatus({ ready: { you: false } });
        },
      });
    }
    if (editor) editor.setStatus({ ready: v.ready });
  }

  function renderEnded(v) {
    const box = $('result');
    box.replaceChildren();
    const line = (label, text) => {
      const p = el('div', 'line');
      const b = el('b', null, label);
      p.append(b, document.createTextNode(` ${text}`));
      box.append(p);
    };
    if (v.phase === 'cancelled') {
      $('result-title').textContent = 'Combat annulé';
      $('result-sub').textContent = 'Personne ne perd rien.';
      return;
    }
    const r = v.result || {};
    const won = r.winner === v.you;
    $('result-title').textContent = r.winner === null ? 'Match nul' : won ? 'Victoire !' : 'Défaite';
    $('result-sub').textContent = ({ qg: 'Tour principale détruite.', towers: 'Plus de tours détruites.', qg_hp: 'Tour principale plus solide.', forfeit: 'Abandon.', disconnect: 'Déconnexion.', draw: 'Égalité parfaite.' })[r.reason] || '';
    const s = v.summary && v.summary.you;
    if (!s) return;
    if (s.lost.length) line('Cartes perdues', s.lost.map((c) => c.title).join(', '));
    else line('Cartes perdues', 'aucune');
    if (s.kept.length) line('Cartes revenues', s.kept.map((c) => c.title).join(', '));
    if (s.loot) line('Butin', `${s.loot.title} rejoint ta collection`);
    if (s.stolen) line('Volée', `${s.stolen.title} part chez ton adversaire`);
    if (s.boosterId) line('Récompense', `1 booster Commun + ${s.credits} crédits`);
    else if (won) line('Récompense', 'plafond du jour atteint : pas de pack ni de crédits, le butin compte quand même');
  }

  // ─────────────────────────────────────────────
  // 📡 Flux SSE
  // ─────────────────────────────────────────────

  function showPhase(phase) {
    const p = phase === 'cancelled' ? 'ended' : phase;
    document.body.classList.toggle('wide', p === 'preparing');
    if (p !== shownPhase) {
      shownPhase = p;
      window.scrollTo(0, 0);
    }
    for (const k of ['preparing', 'running', 'ended']) $(`phase-${k}`).hidden = k !== p;
  }

  function onState(v) {
    view = v;
    $('status').hidden = true;
    showPhase(v.phase);
    if (v.phase === 'preparing') return renderPreparing(v);
    if (v.phase === 'running') {
      if (renderer) renderer.push(v);
      renderClock(v.remainingMs);
      renderElixir(v);
      renderHand(v);
      $('x2').hidden = !v.doubleElixir;
      return undefined;
    }
    if (renderer) renderer.stop();
    return renderEnded(v);
  }

  // Le décompte de préparation avance entre deux états du serveur
  setInterval(() => { if (view && view.phase === 'preparing') renderPreparing(view); }, 1000);

  const es = new EventSource(api('stream'));
  es.addEventListener('setup', (e) => {
    setup = JSON.parse(e.data);
    editor = null;
    $('opponent').textContent = setup.names && setup.names.opponent ? setup.names.opponent : 'Adversaire';
    if (renderer) renderer.stop();
    handKey = '';
    renderer = ArenaBoard.createRenderer($('board'), { arena: setup.arena, symbols: setup.symbols, sprites: setup.sprites });
  });
  es.addEventListener('state', (e) => onState(JSON.parse(e.data)));
  es.onerror = () => {
    if (!view || (view.phase !== 'ended' && view.phase !== 'cancelled')) {
      $('status').hidden = false;
      $('status').textContent = 'Connexion perdue… reconnexion en cours.';
    }
  };
}());
