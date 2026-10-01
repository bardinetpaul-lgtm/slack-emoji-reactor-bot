// ═══════════════════════════════════════════════════════════
//  🎓 Tuto de l'Arène Jeanpip
//  8 écrans illustrés : but, deck et rareté, élixir, pose, rôles,
//  qui attaque qui, atouts (Capitaine, Rappel, Rage), enjeux.
//  Montré à la première ouverture (Arène ou « Mon deck »), puis via
//  le bouton « ❓ Tuto ». Le « vu » est enregistré côté serveur.
//
//  ArenaTutorial.open({ onDone(completed) }) → { close() }
//    onDone(true)  : terminé ou passé (→ marquer comme vu)
//    onDone(false) : fermé de force (ex. le combat démarre)
//  Utilise DeckEditor.ROLES (deck-editor.js) pour les rôles.
// ═══════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /** Paragraphe avec des passages en gras : ['texte ', ['gras'], ' suite']. */
  function para(parts) {
    const p = el('p', 'tu-text');
    for (const part of parts) {
      if (Array.isArray(part)) p.append(el('b', null, part[0]));
      else p.append(document.createTextNode(part));
    }
    return p;
  }

  function bullets(items) {
    const ul = el('ul', 'tu-list');
    for (const it of items) {
      const li = el('li');
      if (Array.isArray(it)) { li.append(el('b', null, it[0]), document.createTextNode(` ${it[1]}`)); } else li.textContent = it;
      ul.append(li);
    }
    return ul;
  }

  // ─────────────────────────────────────────────
  // 🎨 Petites illustrations (SVG / HTML, aucune image externe)
  // ─────────────────────────────────────────────

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svg(markup, viewBox) {
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', viewBox);
    s.setAttribute('aria-hidden', 'true');
    s.classList.add('tu-svg');
    s.innerHTML = markup;
    return s;
  }

  const tower = (x, y, c) => `<rect x="${x - 7}" y="${y - 9}" width="14" height="18" rx="3" fill="#fff" stroke="${c}" stroke-width="2.5"/>`;
  const qg = (x, y, c) => `<rect x="${x - 13}" y="${y - 11}" width="26" height="22" rx="4" fill="#fff" stroke="${c}" stroke-width="3"/><text x="${x}" y="${y + 4}" font-size="10" text-anchor="middle" fill="${c}" font-weight="700">QG</text>`;
  const BLUE = '#1C72F1';
  const ORANGE = '#FF6229';

  function mapArt({ zone = false, arrows = false } = {}) {
    let m = '<rect x="0" y="0" width="180" height="220" rx="14" fill="#F3EFED"/>';
    if (zone) m += `<rect x="6" y="116" width="168" height="78" rx="8" fill="rgba(28,114,241,.14)" stroke="${BLUE}" stroke-width="1.5" stroke-dasharray="4 4"/>`;
    m += '<rect x="0" y="102" width="180" height="16" fill="#1A201D"/>';
    for (const x of [50, 130]) m += `<rect x="${x - 11}" y="100" width="22" height="20" rx="4" fill="#E5E0DD"/>`;   // 2 ponts
    for (const x of [40, 90, 140]) m += tower(x, 50, ORANGE) + tower(x, 172, BLUE);
    m += qg(90, 20, ORANGE) + qg(90, 202, BLUE);
    if (arrows) {
      m += `<path d="M115 150 L130 122 L130 98 L140 70" fill="none" stroke="${BLUE}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#tu-arrow)"/>`;
      m += `<defs><marker id="tu-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="${BLUE}"/></marker></defs>`;
      m += `<circle cx="115" cy="150" r="7" fill="${BLUE}"/>`;
    }
    return svg(m, '0 0 180 220');
  }

  function miniCard(rarity, label, { cost = 3, role = '⚔️', poor = false, fill = 0 } = {}) {
    const c = el('div', `tu-card r-${rarity}${poor ? ' poor' : ''}`);
    c.style.setProperty('--fill', `${Math.round(fill * 100)}%`);
    c.append(el('span', 'tu-cost', String(cost)), el('span', 'tu-card-role', role));
    if (rarity !== 'common') c.append(el('span', 'tu-card-rarity', label));
    if (poor) c.append(el('span', 'tu-card-need', '💧 3/5 · 6 s'));
    const wrap = el('div', 'tu-card-wrap');
    wrap.append(c, el('span', 'tu-card-caption', label));
    return wrap;
  }

  function row(...children) {
    const r = el('div', 'tu-row');
    r.append(...children);
    return r;
  }

  function elixirArt() {
    const bar = el('div', 'tu-elixir');
    bar.append(el('span', 'tu-badge', '3'));
    const segs = el('div', 'tu-segs');
    for (let i = 0; i < 10; i += 1) {
      const s = el('span', 'tu-seg');
      const f = el('i');
      f.style.width = i < 3 ? '100%' : i === 3 ? '60%' : '0%';
      s.append(f);
      segs.append(s);
    }
    bar.append(segs);
    const box = el('div', 'tu-stack');
    box.append(bar, row(miniCard('common', 'Jouable', { cost: 3 }), miniCard('common', 'En charge', { cost: 5, role: '🛡', poor: true, fill: 0.6 })));
    return box;
  }

  function rolesArt() {
    const roles = (root.DeckEditor && root.DeckEditor.ROLES) || {};
    const grid = el('div', 'tu-roles');
    for (const k of Object.keys(roles)) {
      const r = roles[k];
      const cell = el('div', 'tu-role');
      cell.append(el('span', 'tu-role-name', `${r.emoji} ${r.label}`), el('span', 'tu-role-text', `${r.role} ${r.vs}`.trim()));
      grid.append(cell);
    }
    return grid;
  }

  function cycleArt() {
    const c = el('div', 'tu-cycle');
    ['⚔️ Guerrier', '🏹 Tireur', '🐝 Essaim', '🛡 Tank'].forEach((t, i) => {
      if (i) c.append(el('span', 'tu-cycle-arrow', '→'));
      c.append(el('span', 'tu-chip', t));
    });
    const note = el('div', 'tu-cycle-note', '« → » = frappe fort (×1,5). Dans l’autre sens : ×0,67. Et 💥 Sort → 🐝 Essaim.');
    const box = el('div', 'tu-stack');
    box.append(c, note);
    return box;
  }

  function stakesArt() {
    const t = el('table', 'tu-table');
    const rows = [
      ['', 'Victoire', 'Défaite', 'Nul'],
      ['Carte posée détruite', 'perdue', 'perdue', 'perdue'],
      ['Carte posée survivante', 'revient', 'perdue', 'revient'],
      ['Récompense', '🎁 booster + 10 JP$ + 🃏 1 carte volée', '—', '—'],
    ];
    rows.forEach((r, i) => {
      const tr = el('tr');
      r.forEach((cell, j) => tr.append(el(i === 0 || j === 0 ? 'th' : 'td', cell === 'perdue' ? 'bad' : cell === 'revient' ? 'good' : null, cell)));
      t.append(tr);
    });
    return t;
  }

  // ─────────────────────────────────────────────
  // 📖 Les écrans
  // ─────────────────────────────────────────────

  const STEPS = [
    {
      kicker: 'Bienvenue',
      title: 'L’Arène Jeanpip',
      art: () => mapArt(),
      body: () => [
        para(['Un duel ', ['en temps réel'], ' de ', ['2 minutes'], ' contre un collègue, avec tes vraies cartes Jeanpip.']),
        para(['🎯 But : ', ['détruire le QG adverse'], '. Sinon, à la fin du temps, celui qui a détruit le plus de ', ['tours'], ' gagne (puis le QG le moins abîmé).']),
        para(['Chaque camp a ', ['3 tours et un QG'], '. Une ', ['rivière'], ' sépare les camps : on la traverse par ', ['2 ponts'], ' (l’🐝 Essaim, lui, vole). Toi en bas (bleu), l’adversaire en haut (orange).']),
      ],
    },
    {
      kicker: 'Avant le combat',
      title: 'Ton deck de 8 cartes',
      art: () => row(miniCard('common', 'Commune'), miniCard('rare', 'Rare'), miniCard('epic', 'Épique'), miniCard('legendary', 'Légendaire')),
      body: () => [
        para(['Ton deck compte ', ['8 cartes'], ', et ', ['chaque carte se joue une seule fois'], ' par combat. En combat, ', ['tes 8 cartes sont en main'], ' : tu poses celle que tu veux, quand tu as l’élixir.']),
        para(['Le ', ['cadre coloré'], ' indique la rareté : plus elle est haute, plus la carte a de PV. Les Épiques et Légendaires ont en plus une ', ['spécialité ✨'], '.']),
        para(['Tu as une carte en plusieurs exemplaires ? Tu peux la mettre plusieurs fois dans ton deck.']),
      ],
    },
    {
      kicker: 'La ressource',
      title: 'L’élixir 💧',
      art: elixirArt,
      body: () => [
        para(['Chaque carte coûte de l’élixir (la ', ['pastille rose'], '). Tu démarres à ', ['5'], ', tu gagnes ', ['+1 toutes les 2,8 s'], ', jusqu’à ', ['10'], '. Dernière minute : ', ['élixir ×2'], '.']),
        para(['Une carte ', ['grisée'], ' = pas encore assez d’élixir. Elle se remplit comme une jauge et indique ', ['combien il manque et dans combien de temps'], ' elle sera prête.']),
      ],
    },
    {
      kicker: 'Jouer une carte',
      title: 'Poser au bon endroit',
      art: () => mapArt({ zone: true, arrows: true }),
      body: () => [
        para(['👆 ', ['Touche une carte'], ' puis ', ['l’endroit du terrain'], ' (ou glisse-la directement). Un fantôme montre où ton groupe apparaîtra, en rouge si c’est interdit.']),
        para(['Tu poses ', ['où tu veux dans ta moitié'], ' (zone bleue). Quand une tour adverse tombe, tu peux aussi poser ', ['autour d’elle'], '. Un 💥 Sort se vise ', ['n’importe où'], ' et frappe tout de suite : touche le groupe ennemi, il le suit.']),
        para(['Le groupe apparaît ', ['0,5 s'], ' après. Raccourcis : touches ', ['1 à 4'], ', Échap pour annuler.']),
      ],
    },
    {
      kicker: 'Les cartes',
      title: 'Six rôles',
      art: rolesArt,
      body: () => [
        para(['Chaque carte a un ', ['rôle'], ', affiché en bas de la carte. Survole une carte pour le relire.']),
      ],
    },
    {
      kicker: 'Au combat',
      title: 'Qui attaque qui',
      art: cycleArt,
      body: () => [
        para(['Chaque groupe va vers ', ['la cible la plus proche'], ' : un ennemi repéré, sinon ', ['la tour ennemie la plus proche'], ' (ou le QG). À pied, il passe par le pont le plus court.']),
        para(['Le 🛡 ', ['Tank ignore les troupes'], ' et fonce sur les bâtiments : c’est ton bouclier. Pendant que l’ennemi tape dessus, tes troupes derrière font le travail.']),
        para(['Les ', ['tours'], ' et le ', ['QG'], ' tirent sur l’ennemi le plus proche à leur portée. Les poses adverses sont signalées ', ['en orange'], ', et les 4 dernières s’affichent en haut du terrain.']),
      ],
    },
    {
      kicker: 'Tes atouts',
      title: 'Capitaine, Rappel, Rage',
      art: () => row(el('span', 'tu-big', '🎖'), el('span', 'tu-big', '🏳'), el('span', 'tu-big', '🔥')),
      body: () => [
        bullets([
          ['🎖 Capitaine :', 'dans l’éditeur, « Choisir un Capitaine » puis une carte de ta collection. C’est une 9e carte, EN PLUS de tes 8 : jamais posée (donc jamais risquée), elle te donne un bonus permanent + un pouvoir à utiliser une fois par combat.'],
          ['🏳 Rappel :', 'sans carte choisie, touche un de tes groupes. Il fait demi-tour ; s’il rejoint ta tour, sa carte est sauvée, même si tu perds.'],
          ['🔥 Rage :', 'perdre une tour te donne +2 élixir et +10 % de dégâts pendant 10 s. Rien n’est joué d’avance.'],
        ]),
      ],
    },
    {
      kicker: 'Ce qui est en jeu',
      title: 'Engager une carte, c’est la risquer',
      art: stakesArt,
      body: () => [
        para(['Les cartes que tu poses peuvent être ', ['perdues pour de vrai'], ' (retirées de ta collection). Tes doublons sont tes munitions.']),
        para(['Pour limiter les risques : un ', ['Capitaine'], ' ne risque rien, et un ', ['Rappel'], ' sauve une carte. Un combat annulé ne coûte rien.']),
      ],
    },
  ];

  // ─────────────────────────────────────────────
  // 🪟 Fenêtre du tuto
  // ─────────────────────────────────────────────

  let current = null;

  function open({ onDone } = {}) {
    if (current) current.close(false);
    let index = 0;
    let done = false;
    const before = document.activeElement;

    const overlay = el('div', 'tu-overlay');
    const dialog = el('div', 'tu-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'tu-title');
    overlay.append(dialog);

    function finish(completed) {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      current = null;
      if (before && before.focus) before.focus();
      if (onDone) onDone(completed);
    }

    function render() {
      const step = STEPS[index];
      const last = index === STEPS.length - 1;
      const head = el('div', 'tu-head');
      head.append(el('span', 'tu-kicker', `${step.kicker} · ${index + 1}/${STEPS.length}`));
      const skip = el('button', 'tu-skip', 'Passer le tuto');
      skip.type = 'button';
      skip.addEventListener('click', () => finish(true));
      head.append(skip);

      const title = el('h2', 'tu-title', step.title);
      title.id = 'tu-title';
      const art = el('div', 'tu-art');
      art.append(step.art());
      const body = el('div', 'tu-body');
      body.append(...step.body());

      const dots = el('div', 'tu-dots');
      STEPS.forEach((_, i) => {
        const d = el('button', `tu-dot${i === index ? ' on' : ''}`);
        d.type = 'button';
        d.setAttribute('aria-label', `Écran ${i + 1}`);
        d.addEventListener('click', () => { index = i; render(); });
        dots.append(d);
      });

      const nav = el('div', 'tu-nav');
      const prev = el('button', 'tu-btn ghost', 'Précédent');
      prev.type = 'button';
      prev.disabled = index === 0;
      prev.addEventListener('click', () => { if (index > 0) { index -= 1; render(); } });
      const next = el('button', 'tu-btn primary', last ? 'C’est parti !' : 'Suivant');
      next.type = 'button';
      next.addEventListener('click', () => { if (last) finish(true); else { index += 1; render(); } });
      nav.append(prev, dots, next);

      dialog.replaceChildren(head, title, art, body, nav);
      next.focus();
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); finish(true); }
      if (e.key === 'ArrowRight' && index < STEPS.length - 1) { index += 1; render(); }
      if (e.key === 'ArrowLeft' && index > 0) { index -= 1; render(); }
      if (e.key === 'Tab') {   // le focus reste dans la fenêtre
        const f = [...dialog.querySelectorAll('button:not(:disabled)')];
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
      e.stopPropagation();
    }

    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    render();
    current = { close: finish };
    return current;
  }

  const isOpen = () => Boolean(current);
  const close = () => { if (current) current.close(false); };

  root.ArenaTutorial = { open, close, isOpen, STEPS };
}(typeof self !== 'undefined' ? self : this));
