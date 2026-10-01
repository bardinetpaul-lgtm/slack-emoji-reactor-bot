// ═══════════════════════════════════════════════════════════
//  ⚔️ Arène Jeanpip — client de l'écran de combat
//  DA « Combat - Menu de pose » : toucher une carte (elle monte de
//  10 px, cernée de crème, zones de pose en pointillé bleu), puis le
//  point EXACT où poser le groupe (ou glisser la carte sur le terrain).
//  Un fantôme montre où il apparaîtra (rouge si interdit) ; un Sort se
//  vise n'importe où. Refus → pastille explicative.
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
    no_breach: 'Chez l’adversaire, seulement autour d’une tour détruite',
    lane: 'Hors de votre zone de pose',
    pump_active: 'Une seule Pompe à la fois',
    not_in_hand: 'Cette carte n’est plus en main',
    not_running: 'Le combat est terminé',
    network: 'Connexion perdue, réessaie',
    recall: '🏳 Rappel ! Le groupe fait demi-tour',
    not_recallable: 'Ce groupe ne peut pas être rappelé',
    already: 'Déjà en retraite',
    power_used: 'Pouvoir déjà utilisé',
    no_captain: 'Pas de Capitaine dans ce deck',
  };

  let setup = null;
  let renderer = null;
  let view = null;
  let selected = null;      // { index, url } de l'emplacement choisi en main
  let powerArmed = false;   // 🎖 pouvoir en attente d'un point
  let handKey = '';
  let pillTimer = null;
  let editor = null;
  const decoder = ArenaWire.createDecoder();   // états différentiels (public/arena-wire.js)
  $('phase-running').append(DeckEditor.guide());   // ❓ rappel des règles pendant le combat
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
      i.draggable = false;   // sinon le navigateur lance son propre glisser d'image et la pose n'arrive jamais
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
    const text = REFUSALS[reason] || reason;
    pill.textContent = text;
    pill.style.top = `${Math.min(92, Math.max(8, yPct))}%`;
    pill.hidden = false;
    clearTimeout(pillTimer);
    pillTimer = setTimeout(() => { pill.hidden = true; }, Math.max(1400, text.length * 45));   // le temps de lire
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

  // ⏳ Pourquoi une carte n'est pas jouable (et dans combien de temps elle le sera)
  const ELIXIR_REGEN_MS = 2800;
  function pumpActive(v) {
    return (v.buildings || []).some((b) => b.side === v.you && b.kind === 'pompe' && b.alive)
      || (v.pending || []).some((p) => p.side === v.you && p.archetype === 'pompe');
  }
  function blockOf(c, v) {
    const me = v.players[v.you];
    if (c.archetype === 'pompe' && pumpActive(v)) return { reason: 'pump_active' };
    if (c.cost <= me.elixir) return null;
    let regen = ELIXIR_REGEN_MS / (v.doubleElixir ? 2 : 1) / (me.overheat ? 2 : 1);
    if (me.captain && me.captain.archetype === 'pompe') regen /= 1.1;   // 🎖 Économie
    const secs = Math.max(1, Math.ceil(((c.cost - me.elixir) * regen) / 1000));
    return { reason: 'elixir', have: Math.floor(me.elixir), secs, fill: Math.max(0, Math.min(1, me.elixir / c.cost)) };
  }
  const blockText = (b, c) => (b.reason === 'elixir'
    ? `Pas assez d’élixir : ${b.have}/${c.cost} · prête dans ≈ ${b.secs} s`
    : REFUSALS[b.reason]);

  /** Met à jour la jauge des cartes en charge sans reconstruire la main. */
  function updateCharge(v) {
    const hand = v.players[v.you].hand || [];
    [...$('hand').children].forEach((b, i) => {
      const c = hand[i];
      const blk = c && blockOf(c, v);
      if (!blk || blk.reason !== 'elixir') return;
      b.style.setProperty('--fill', `${Math.round(blk.fill * 100)}%`);
      const need = b.querySelector('.need');
      if (need) {
        need.firstChild.textContent = `💧 ${blk.have}/${c.cost}`;
        need.lastChild.textContent = `≈ ${blk.secs} s`;
      }
    });
  }

  function renderHand(v) {
    const me = v.players[v.you];
    const hand = me.hand || [];
    if (selected && (!hand[selected.index] || hand[selected.index].url !== selected.url)) selectCard(null);
    const key = JSON.stringify([hand.map((c) => [c.url, c.copies, (blockOf(c, v) || {}).reason || null, c.echo]), selected]);
    if (key === handKey) { updateCharge(v); return; }
    handKey = key;

    const box = $('hand');
    box.replaceChildren(...hand.map((c, index) => {
      const b = el('button', 'card');
      b.type = 'button';
      const on = Boolean(selected) && selected.index === index;
      const blk = blockOf(c, v);
      if (blk && blk.reason === 'elixir') {
        b.classList.add('poor');   // en charge : jauge + ce qu'il manque
        const need = el('span', 'need');
        need.append(document.createTextNode(''), el('small'));
        b.append(el('span', 'charge'), need);
      } else if (blk) {
        b.classList.add('blocked');
        b.append(el('span', 'tag', '1 Pompe max'));
      }
      if (on) b.classList.add('selected');
      b.setAttribute('aria-pressed', String(on));
      b.append(cardFace(c), costBadge(c.cost), el('span', 'key', String(index + 1)));   // ⌨️ touche (affichée sur ordinateur)
      // 💎 rareté (cadre + étiquette) · 🎭 rôle
      const rarity = DeckEditor.RARITIES[c.rarity] ? c.rarity : 'common';
      const role = DeckEditor.ROLES[c.archetype];
      b.classList.add(`r-${rarity}`);
      if (rarity !== 'common') b.append(el('span', 'rarity', DeckEditor.RARITIES[rarity]));
      if (role) b.append(el('span', 'role', `${role.emoji} ${role.label}`));
      b.title = `${c.title || 'Carte'} · ${DeckEditor.RARITIES[rarity]}\n${DeckEditor.roleText(c.archetype)}`;
      b.setAttribute('aria-label', `${c.title || 'Carte'}, ${DeckEditor.RARITIES[rarity]}, ${role ? role.label : ''}, coût ${c.cost}, ${c.copies} pose(s) restante(s)`);
      if (c.copies > 1) b.append(el('span', 'copies', `×${c.copies}`));
      const spec = c.specialty && setup && setup.specialties && setup.specialties[c.specialty];
      if (spec) { const sp = el('span', 'spec', spec.emoji); sp.title = `${spec.label} : ${spec.desc}`; b.append(sp); }
      if (c.echo) b.append(el('span', 'tag', 'Écho'));
      else if (c.rented) b.append(el('span', 'tag rented', 'Achetée'));
      // clavier (Entrée / Espace) ; à la souris et au doigt, c'est le « pointerup » de la main qui choisit
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (swallowClick) return;
        tapCard(index);
      });
      return b;
    }));

    updateCharge(v);
  }

  /** Toucher une carte de la main : la choisit (ou la repose si elle l'était déjà). */
  function tapCard(index) {
    const c = view && (view.players[view.you].hand || [])[index];
    if (!c) return;
    const why = blockOf(c, view);
    if (why) flash(blockText(why, c), 88);   // on dit pourquoi, tout de suite
    if (why && why.reason === 'pump_active') return;
    const on = Boolean(selected) && selected.index === index;
    selectCard(on ? null : { index, url: c.url });
  }

  function selectCard(slot) {
    selected = slot;
    if (slot) armPower(false);
    if (!slot && renderer) renderer.setGhost(null);
    handKey = '';
    $('board-wrap').classList.toggle('selecting', Boolean(slot));
    if (renderer) renderer.setZones(Boolean(slot));
    if (view && view.phase === 'running') renderHand(view);
  }

  // ─────────────────────────────────────────────
  // 👁 Dernières cartes posées par l'adversaire (bandeau en haut du terrain)
  // ─────────────────────────────────────────────

  const FEED_MAX = 4;

  function renderOppFeed(v) {
    const box = $('opp-feed');
    for (const e of v.events || []) {
      if (e.type !== 'deploy' || e.side === v.you) continue;
      const rarity = DeckEditor.RARITIES[e.rarity] ? e.rarity : 'common';
      const role = DeckEditor.ROLES[e.archetype];
      const c = el('div', `feed-card r-${rarity}`);
      const img = e.image || (setup && setup.images && setup.images[e.url]);
      if (img) {
        const i = el('img');
        i.src = img;
        i.alt = '';
        i.onerror = () => i.replaceWith(characterFace({ url: e.url }));
        c.append(i);
      } else {
        c.append(characterFace({ url: e.url }));
      }
      if (role) c.append(el('span', 'feed-role', role.emoji));
      c.title = `${e.title || 'Carte'} · ${DeckEditor.RARITIES[rarity]} · ${role ? role.label : ''}
${DeckEditor.roleText(e.archetype)}`;
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', `L'adversaire pose ${e.title || 'une carte'}, ${role ? role.label : ''}, ${DeckEditor.RARITIES[rarity]}`);
      box.prepend(c);
      while (box.children.length > FEED_MAX) box.lastChild.remove();
      box.hidden = false;
    }
  }

  function renderElixir(v) {
    const elixir = v.players[v.you].elixir;
    const max = v.players[v.you].elixirMax || 10;   // 🎖 Économie : jusqu'à 12
    $('elixir-count').textContent = String(Math.floor(elixir));
    const segs = $('elixir-segs');
    segs.style.gridTemplateColumns = `repeat(${max}, 1fr)`;
    if (segs.children.length !== max) {
      segs.replaceChildren();
      for (let i = 0; i < max; i += 1) {
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

  // 🎖 Pouvoir du Capitaine · 🔥 Rage
  function renderPower(v) {
    const me = v.players[v.you];
    const foe = v.players[v.you === 'A' ? 'B' : 'A'];
    const texts = (setup && setup.captains) || {};
    const btn = $('power');
    const cap = me.captain;
    if (cap && texts[cap.archetype]) {
      const def = texts[cap.archetype].power;
      btn.hidden = false;
      btn.disabled = cap.used;
      btn.textContent = cap.used ? `🎖 ${def.label} · utilisé` : powerArmed ? `🎖 ${def.label} · touche le terrain` : `🎖 ${def.label}`;
      btn.title = `${texts[cap.archetype].style} — ${def.desc}`;
      btn.classList.toggle('armed', powerArmed);
    } else {
      btn.hidden = true;
    }
    $('opp-cap').textContent = foe.captain && texts[foe.captain.archetype] ? `🎖 ${texts[foe.captain.archetype].style}` : '';
    $('rage').hidden = !me.rage;
    $('opp-rage').hidden = !foe.rage;
  }

  function armPower(on) {
    powerArmed = on;
    if (view && view.phase === 'running') renderPower(view);
  }

  $('power').addEventListener('click', async () => {
    if (!view || view.phase !== 'running') return;
    const cap = view.players[view.you].captain;
    const texts = (setup && setup.captains) || {};
    if (!cap || cap.used || !texts[cap.archetype]) return;
    if (!texts[cap.archetype].power.lane) {
      const res = await send({ type: 'power' });
      if (!res.ok) flash(res.reason);
      return;
    }
    selectCard(null);
    armPower(!powerArmed);
  });

  function renderClock(ms) {
    const s = Math.ceil(ms / 1000);
    $('clock').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // ─────────────────────────────────────────────
  // 👆 Pose : point touché sur le terrain
  // ─────────────────────────────────────────────

  $('board').addEventListener('click', async (e) => {
    if (!view || view.phase !== 'running') return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * ArenaBoard.W;
    const y = ((e.clientY - r.top) / r.height) * ArenaBoard.H;
    const yPct = (y / ArenaBoard.H) * 100;
    const live = (renderer && renderer.current()) || view;

    // 🎖 Pouvoir armé : au point touché
    if (powerArmed) {
      const at = ArenaBoard.pointToPower(x, y, live);
      armPower(false);
      const res = await send({ type: 'power', x: at.x, depth: at.depth });
      if (!res.ok) flash(res.reason, yPct);
      return undefined;
    }

    // 🏳 Aucune carte choisie : toucher un de mes groupes le rappelle
    if (!selected) {
      const unit = ArenaBoard.unitAtPoint(x, y, live, live.you);
      if (!unit) return undefined;
      const res = await send({ type: 'recall', poseId: unit.poseId });
      flash(res.ok ? 'recall' : res.reason, yPct);
      return undefined;
    }
    const me = view.players[view.you];
    const card = selected && (me.hand || [])[selected.index];
    if (!card || card.url !== selected.url) return selectCard(null);

    return deployAt(x, y);
  });

  /** Pose la carte choisie au point (x, y) du plan (point exact du moteur). */
  async function deployAt(x, y) {
    const yPct = (y / ArenaBoard.H) * 100;
    const live = (renderer && renderer.current()) || view;
    const me = view.players[view.you];
    const card = selected && (me.hand || [])[selected.index];
    if (!card || card.url !== selected.url) return selectCard(null);
    const spot = ArenaBoard.pointToDeploy(x, y, live, { spell: card.archetype === 'sort' });
    if (!spot.ok) return flash(spot.reason, yPct);
    const why = blockOf(card, view);
    if (why) return flash(blockText(why, card), yPct);

    const { url } = selected;
    selectCard(null);
    const res = await send({ type: 'deploy', url, x: spot.x, depth: spot.depth });
    if (!res.ok) flash(res.reason, yPct);
    return undefined;
  }

  // ─────────────────────────────────────────────
  // 👻 Fantôme de placement + ✋ glisser-déposer depuis la main
  // ─────────────────────────────────────────────

  function boardPoint(clientX, clientY) {
    const r = $('board').getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
    return { x: ((clientX - r.left) / r.width) * ArenaBoard.W, y: ((clientY - r.top) / r.height) * ArenaBoard.H };
  }

  function showGhost(pt) {
    if (!renderer) return;
    const me = view && view.players[view.you];
    const card = selected && me && (me.hand || [])[selected.index];
    if (!pt || !card) { renderer.setGhost(null); return; }
    const live = renderer.current() || view;
    const spot = ArenaBoard.pointToDeploy(pt.x, pt.y, live, { spell: card.archetype === 'sort' });
    // le groupe apparaît au point exact (un Sort « colle » au groupe ennemi visé)
    const at = ArenaBoard.toBoard(spot.x, view.you === 'B' ? 100 - spot.depth : spot.depth, view.you);
    const sprite = setup && setup.sprites && setup.sprites[card.url];
    renderer.setGhost({
      x: at.x, y: at.y, ok: spot.ok && card.cost <= me.elixir, archetype: card.archetype,
      sprite: sprite && (typeof sprite === 'string' ? sprite : sprite.id),
    });
  }

  $('board').addEventListener('pointermove', (e) => { if (selected && !drag) showGhost(boardPoint(e.clientX, e.clientY)); });
  $('board').addEventListener('pointerleave', () => { if (!drag && renderer) renderer.setGhost(null); });

  let drag = null;           // { index, url, x0, y0, moved }
  let swallowClick = false;  // le « click » qui suit un glisser ne sélectionne rien

  // ✋ aucun glisser natif (images) dans la main : c'est notre glisser-déposer qui compte
  $('hand').addEventListener('dragstart', (e) => e.preventDefault());
  // glisser interrompu (appel, geste système…) : on repart de zéro
  document.addEventListener('pointercancel', () => { if (drag) { drag = null; if (renderer) renderer.setGhost(null); } });

  $('hand').addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.card');
    if (!btn || !view || view.phase !== 'running') return;
    const index = [...$('hand').children].indexOf(btn);
    const card = (view.players[view.you].hand || [])[index];
    if (!card) return;
    drag = { index, url: card.url, x0: e.clientX, y0: e.clientY, moved: false };
  });

  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 8) {
      drag.moved = true;
      selectCard({ index: drag.index, url: drag.url });
    }
    if (drag.moved) showGhost(boardPoint(e.clientX, e.clientY));
  });

  document.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    swallowClick = true;   // le « click » qui suit (s'il arrive) ne compte pas une 2e fois
    setTimeout(() => { swallowClick = false; }, 0);
    // Simple toucher : choisi ICI, pas dans le « click » de la carte. La main est reconstruite
    // à chaque changement d'état : si elle l'est entre l'appui et le relâché, ce « click » n'arrive jamais.
    if (!d.moved) {
      const hand = (view && view.players[view.you].hand) || [];
      if (hand[d.index] && hand[d.index].url === d.url) tapCard(d.index);
      return;
    }
    const pt = boardPoint(e.clientX, e.clientY);
    if (renderer) renderer.setGhost(null);
    if (pt) { deployAt(pt.x, pt.y); return; }
    // Relâché sur la main : un clic qui a bougé de quelques pixels (pavé tactile), pas un glisser raté.
    // La carte reste choisie, il n'y a plus qu'à toucher le terrain.
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if (!(under && under.closest('#hand'))) selectCard(null);
  });

  document.addEventListener('keydown', (e) => {
    if (!view || view.phase !== 'running') return;
    const hand = view.players[view.you].hand || [];
    const n = Number(e.key);
    if (n >= 1 && n <= hand.length) selectCard({ index: n - 1, url: hand[n - 1].url });
    if (e.key === 'Escape') { selectCard(null); armPower(false); }
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
        captains: setup.captains,
        specialties: setup.specialties,
        shop: v.shop,
        mode: 'prep',
        onSave: (value) => send({ type: 'decks', ...value }),
        onReady: async (ready, urls, captain) => {
          const res = await send({ type: 'ready', ready, urls, captain });
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
    $('result-sub').textContent = (r.outOfCards ? 'Toutes les cartes ont été jouées. ' : '')
      + (({ qg: 'Tour principale détruite.', towers: 'Plus de tours détruites.', qg_hp: 'Tour principale plus solide.', forfeit: 'Abandon.', disconnect: 'Déconnexion.', draw: 'Égalité parfaite.' })[r.reason] || '');
    const s = v.summary && v.summary.you;
    if (!s) return;
    if (s.lost.length) line('Cartes perdues', s.lost.map((c) => c.title).join(', '));
    else line('Cartes perdues', 'aucune');
    if (s.kept.length) line('Cartes revenues', s.kept.map((c) => c.title).join(', '));
    const rec = ((v.result && v.result.poses) || []).filter((p) => p.side === v.you && p.status === 'recalled');
    if (rec.length) line('Sauvées par Rappel', rec.map((c) => c.title).join(', '));
    if (v.rented && v.rented.length) line('Achetées pour ce combat', v.rented.map((c) => `${c.title} (${c.price} JP$)`).join(', '));
    if (s.loot) line('Butin', `${s.loot.title} rejoint ta collection`);
    if (s.stolen) line('Volée', `${s.stolen.title} part chez ton adversaire`);
    if (s.boosterId) line('Récompense', `1 booster Commun + ${s.credits} JP$`);
  }

  // ─────────────────────────────────────────────
  // 📡 Flux SSE
  // ─────────────────────────────────────────────

  // 🎓 Tuto : d'office à la première ouverture (préparation), puis via « ❓ Tuto »
  let tutorialOffered = false;
  function openTutorial() {
    ArenaTutorial.open({ onDone: (completed) => { if (completed) send({ type: 'tutorial' }); } });
  }
  $('tuto-btn').addEventListener('click', openTutorial);

  function showPhase(phase) {
    const p = phase === 'cancelled' ? 'ended' : phase;
    // le combat démarre : le tuto s'efface (il reviendra à la prochaine ouverture s'il n'était pas fini)
    if (p !== 'preparing' && ArenaTutorial.isOpen()) {
      ArenaTutorial.close();
      if (p === 'running') setTimeout(() => flash('Le combat commence ! Le tuto reviendra à ta prochaine préparation.', 30), 50);
    }
    document.body.classList.toggle('wide', p === 'preparing');
    document.body.classList.toggle('fight', p === 'running');   // 🖥️ sur ordinateur : terrain + panneau côte à côte
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
      renderPower(v);
      renderOppFeed(v);
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
    if (setup.tutorialSeen === false && !tutorialOffered) {
      tutorialOffered = true;
      openTutorial();
    }
    editor = null;
    decoder.reset();
    $('opponent').textContent = setup.names && setup.names.opponent ? setup.names.opponent : 'Adversaire';
    if (renderer) renderer.stop();
    handKey = '';
    $('opp-feed').replaceChildren();
    $('opp-feed').hidden = true;
    renderer = ArenaBoard.createRenderer($('board'), { arena: setup.arena, symbols: setup.symbols, sprites: setup.sprites });
  });
  es.addEventListener('state', (e) => onState(decoder.decode(JSON.parse(e.data))));
  es.onerror = () => {
    if (!view || (view.phase !== 'ended' && view.phase !== 'cancelled')) {
      $('status').hidden = false;
      $('status').textContent = 'Connexion perdue… reconnexion en cours.';
    }
  };
}());
