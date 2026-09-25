// ═══════════════════════════════════════════════════════════
//  🏟️ RENDU DU TERRAIN DE L'ARÈNE (navigateur + Node)
//  D'après la DA « Arènes » (Claude Design) : plan 360×640, trois
//  couloirs (x = 60 / 180 / 300), une rivière, trois ponts, une tour
//  par couloir et une tour principale (le QG) par camp. Seuls le sol
//  et le décor changent : Le jardin · Le port · La salle serveur.
//
//  Chaque joueur voit SON camp en bas (bleu), l'adversaire en haut
//  (orange). Personnages et tours sont cernés d'encre, le décor reste
//  en aplat pour que les unités passent toujours devant.
//
//  Node : require('public/arena-board.js') (tests, aperçus).
//  Navigateur : window.ArenaBoard (+ ArenaBoard.createRenderer).
// ═══════════════════════════════════════════════════════════
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArenaBoard = api;
}(typeof self !== 'undefined' ? self : this, function () {
  const INK = '#1A201D', I8 = '#242B28', I7 = '#2F3733', WHITE = '#FFFFFF', CREAM = '#F3EFED', C3 = '#E5E0DD',
    GREY = '#6B716E', PINK = '#FF73C0', BLUE = '#1C72F1', ORANGE = '#FF6229';
  const W = 360, H = 640;
  const LANE_X = [60, 180, 300];

  // ─────────────────────────────────────────────
  // 📐 Axe du moteur (0 = camp A … 100 = camp B) → plan (vu de mon camp)
  //    Points d'ancrage calés sur la DA : QG 592 · tours ≈ 504 ·
  //    rivière 320 · tours adverses ≈ 146 · QG adverse 56.
  // ─────────────────────────────────────────────
  const ANCHORS = [[0, 622], [5, 592], [15, 504], [50, 320], [85, 146], [95, 56], [100, 26]];

  function mapY(y) {
    for (let i = 1; i < ANCHORS.length; i += 1) {
      const [y0, b0] = ANCHORS[i - 1];
      const [y1, b1] = ANCHORS[i];
      if (y <= y1 || i === ANCHORS.length - 1) return b0 + ((Math.min(Math.max(y, 0), 100) - y0) * (b1 - b0)) / (y1 - y0);
    }
    return 320;
  }

  /** Position d'un élément du moteur sur le plan, vu par `viewer` ('A' | 'B'). */
  function toBoard(lane, y, viewer) {
    const mine = viewer === 'B' ? 100 - y : y;
    const l = lane === null || lane === undefined ? 1 : lane;
    const x = viewer === 'B' ? W - LANE_X[l] : LANE_X[l];
    return { x, y: mapY(mine) };
  }

  // ─────────────────────────────────────────────
  // ✏️ Primitives (identiques à la DA)
  // ─────────────────────────────────────────────
  const C = (x, y, r) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
  const R = (x, y, w, h, r) => `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
  const F = (d, fill, st = 'none', sw = 0, da = 'none') => ({ d, fill, st, sw, da });
  const lines = (x0, x1, y0, y1, step, col, sw = 1, vert = false) => {
    let d = '';
    if (vert) for (let x = x0; x <= x1; x += step) d += `M${x} ${y0}V${y1}`;
    else for (let y = y0; y <= y1; y += step) d += `M${x0} ${y}H${x1}`;
    return F(d, 'none', col, sw);
  };
  const tree = (x, y) => [F(R(x - 2, y + 6, 4, 9, 2), GREY), F(C(x - 7, y + 3, 8), C3), F(C(x + 7, y + 3, 8), C3), F(C(x, y - 2, 11), C3), F(C(x - 4, y - 6, 4), WHITE)];
  const bush = (x, y) => [F(C(x - 9, y + 3, 9), C3), F(C(x + 9, y + 3, 9), C3), F(C(x, y - 5, 10), C3), F(C(x - 3, y - 8, 3.5), WHITE), F(C(x + 10, y + 1, 2), PINK)];
  const rock = (x, y) => [F(`M${x - 10} ${y + 6}L${x - 10} ${y - 6}A12 12 0 0 1 ${x + 2} ${y + 6}Z`, GREY), F(`M${x + 3} ${y + 6}A5 5 0 0 1 ${x + 13} ${y + 6}Z`, GREY)];
  const flowers = (x, y) => [F(C(x, y, 2.2), PINK), F(C(x + 5, y - 3, 1.8), PINK), F(C(x + 4, y + 4, 2), PINK)];
  const pad = (x, y, r) => [F(`M${x} ${y}L${x + r} ${y}A${r} ${r} 0 1 1 ${x} ${y - r}Z`, I7), F(C(x - 1, y + 1, 1.8), PINK)];
  const container = (x, y, w, h, fill) => {
    let d = '';
    for (let i = 6; i < w - 3; i += 6) d += `M${x + i} ${y + 4}V${y + h - 4}`;
    return [F(R(x, y, w, h, 3), fill, INK, 1.4), F(d, 'none', INK, 0.8)];
  };
  const crate = (x, y) => [F(R(x, y, 14, 14, 2), C3, INK, 1.2), F(`M${x + 2} ${y + 2}L${x + 12} ${y + 12}M${x + 12} ${y + 2}L${x + 2} ${y + 12}`, 'none', INK, 1)];
  const buoy = (x, y) => [F(C(x, y, 5), WHITE, INK, 1.2), F(R(x - 5, y - 1.5, 10, 3, 1.5), PINK)];
  const rack = (x, y, a, b) => [F(R(x, y, 22, 40, 4), I8, GREY, 1), F(`M${x + 4} ${y + 12}H${x + 14}M${x + 4} ${y + 20}H${x + 14}M${x + 4} ${y + 28}H${x + 14}`, 'none', GREY, 1), F(C(x + 17, y + 8, 1.6), a), F(C(x + 17, y + 20, 1.6), b), F(C(x + 17, y + 32, 1.6), a)];
  const LX = [40, 160, 280];

  function base(ground, lane, river, bridge) {
    const g = [F(R(0, 0, W, H, 0), ground)];
    LX.forEach((x) => g.push(F(R(x, -10, 40, 660, 20), lane)));
    g.push(F(R(0, 300, W, 40, 0), river));
    LX.forEach((x) => g.push(F(R(x - 6, 294, 52, 52, 10), bridge)));
    g.push(F(C(0, 640, 54), BLUE), F(C(360, 0, 54), ORANGE));
    return g;
  }

  // ─────────────────────────────────────────────
  // 🏞️ Les trois arènes
  // ─────────────────────────────────────────────
  function jardin() {
    const g = base(CREAM, C3, I8, C3);
    LX.forEach((x) => g.push(lines(x - 2, x + 42, 302, 338, 8, WHITE, 2)));
    [[16, 298, 6], [26, 303, 3.5], [100, 298, 5], [134, 341, 5], [226, 342, 6], [250, 298, 4], [344, 340, 6]].forEach(([x, y, r]) => g.push(F(C(x, y, r), C3)));
    g.push(...pad(120, 320, 8), ...pad(242, 318, 7), ...pad(342, 322, 6));
    [[116, 34], [244, 98], [18, 420], [340, 612], [240, 266], [20, 560]].forEach(([x, y]) => g.push(...tree(x, y)));
    [[20, 160], [340, 240], [120, 236], [340, 466], [240, 392]].forEach(([x, y]) => g.push(...bush(x, y)));
    [[226, 198], [96, 560], [232, 612]].forEach(([x, y]) => g.push(...rock(x, y)));
    [[132, 180], [16, 256], [236, 488], [120, 616], [340, 560]].forEach(([x, y]) => g.push(...flowers(x, y)));
    return g;
  }

  function port() {
    const g = [F(R(0, 0, W, H, 0), CREAM), F(R(0, 276, W, 88, 0), I8)];
    let w = '';
    for (let y = 290; y < 360; y += 16) for (let x = ((y / 16) % 2) * 10; x < 360; x += 26) w += `M${x} ${y}a4 4 0 0 1 8 0`;
    g.push(F(w, 'none', GREY, 1.4));
    LX.forEach((x) => g.push(F(R(x, -10, 40, 296, 6), WHITE), F(R(x, 354, 40, 296, 6), WHITE), lines(x + 2, x + 38, 0, 640, 12, C3, 1.5)));
    LX.forEach((x) => g.push(F(R(x - 8, 268, 56, 104, 8), C3, INK, 1.4), lines(x - 4, x + 44, 278, 364, 10, GREY, 1)));
    LX.forEach((x) => [[x - 4, 272], [x + 44, 272], [x - 4, 368], [x + 44, 368]].forEach(([a, b]) => g.push(F(C(a, b, 3.5), INK))));
    g.push(F('M206 314L270 314Q264 334 250 334L226 334Q210 334 206 314Z', WHITE, INK, 1.4), F(R(224, 300, 22, 14, 3), PINK, INK, 1.4), F(R(206, 314, 64, 4, 2), PINK));
    g.push(...buoy(18, 300), ...buoy(344, 340), ...buoy(120, 296));
    [[0, 188, 34, 22, PINK], [0, 212, 34, 22, C3], [326, 158, 34, 22, WHITE], [326, 182, 34, 22, 'url(#dg)'], [0, 396, 34, 22, WHITE], [326, 418, 34, 22, PINK], [326, 442, 34, 22, I7], [98, 200, 40, 20, C3], [216, 560, 40, 20, PINK]].forEach((a) => g.push(...container(...a)));
    [[100, 120], [222, 236], [96, 420], [232, 470], [14, 120], [334, 570], [104, 560]].forEach(([x, y]) => g.push(...crate(x, y)));
    g.push(F(C(0, 640, 54), BLUE), F(C(360, 0, 54), ORANGE));
    return g;
  }

  function serveurs() {
    const g = [F(R(0, 0, W, H, 0), INK), lines(0, 360, 0, 640, 40, I8, 1), lines(0, 360, 0, 640, 40, I8, 1, true)];
    LX.forEach((x) => g.push(F(R(x, -10, 40, 660, 8), I7)));
    g.push(F('M60 0V640M180 0V640M300 0V640', 'none', GREY, 1.2, '6 10'), F(R(0, 300, W, 40, 0), I8));
    g.push(F('M0 309Q90 318 180 308T360 311', 'none', PINK, 3), F('M0 322Q90 312 180 324T360 320', 'none', BLUE, 3), F('M0 332Q120 328 200 334T360 330', 'none', WHITE, 1.5));
    LX.forEach((x) => g.push(F(R(x - 6, 294, 52, 52, 8), GREY, INK, 1.4), lines(x, x + 40, 302, 340, 6, I7, 1.2)));
    [[8, 160, PINK, BLUE], [330, 190, BLUE, PINK], [8, 400, BLUE, WHITE], [330, 440, PINK, BLUE], [98, 216, PINK, WHITE], [124, 216, BLUE, PINK], [212, 216, WHITE, PINK], [238, 216, PINK, BLUE], [8, 40, PINK, WHITE], [330, 560, BLUE, PINK], [98, 540, WHITE, BLUE], [238, 540, PINK, WHITE]].forEach((a) => g.push(...rack(...a)));
    g.push(F('M19 200Q24 250 40 296', 'none', GREY, 1.5), F('M341 230Q336 260 320 296', 'none', PINK, 1.5), F('M135 256Q150 280 160 296', 'none', BLUE, 1.5), F('M225 256Q210 280 200 296', 'none', GREY, 1.5));
    g.push(F(C(0, 640, 54), BLUE), F(C(360, 0, 54), ORANGE));
    return g;
  }

  const ARENAS = {
    jardin: { key: 'jardin', num: '01', name: 'Le jardin', dark: false, make: jardin },
    port: { key: 'port', num: '02', name: 'Le port', dark: false, make: port },
    serveurs: { key: 'serveurs', num: '03', name: 'La salle serveur', dark: true, make: serveurs },
  };
  const arenaOf = (key) => ARENAS[key] || ARENAS.jardin;

  function groundPaths(key) {
    return arenaOf(key).make();
  }

  const pathTag = (p) => `<path d="${p.d}" fill="${p.fill}" stroke="${p.st}" stroke-width="${p.sw}" stroke-dasharray="${p.da}" stroke-linecap="round" stroke-linejoin="round"/>`;

  // ─────────────────────────────────────────────
  // 🏰 Tours (symboles de la DA)
  // ─────────────────────────────────────────────
  const TOWER_SYMBOLS = `
<symbol id="t-lane" viewBox="-34 -46 68 80" overflow="visible"><g stroke="${INK}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">
<ellipse cx="0" cy="19" rx="23" ry="7" fill="currentColor" stroke-width="0"/><path d="M0 -26V-44" fill="none"/><path d="M0 -44L15 -40L0 -35Z" fill="currentColor"/>
<rect x="-11" y="-31" width="6" height="8" rx="2" fill="${C3}"/><rect x="5" y="-31" width="6" height="8" rx="2" fill="${C3}"/>
<path d="M-16 -14L-16 16A16 5 0 0 0 16 16L16 -14Z" fill="${CREAM}"/><path d="M-16 -9A16 5 0 0 0 16 -9L16 -4A16 5 0 0 1 -16 -4Z" fill="currentColor"/>
<path d="M-16 6A16 5 0 0 0 16 6" fill="none" stroke-width="1.2"/><path d="M-8 2V9M7 2V9M-12 12V18M0 13V20M12 12V18" fill="none" stroke-width="1.2"/>
<path d="M-5 20L-5 13A5 5 0 0 1 5 13L5 20.5Z" fill="${INK}"/><ellipse cx="0" cy="-15" rx="19" ry="6" fill="${WHITE}"/>
<rect x="-18.5" y="-24" width="7" height="10" rx="2" fill="${WHITE}"/><rect x="-3.5" y="-25" width="7" height="10" rx="2" fill="${WHITE}"/><rect x="11.5" y="-24" width="7" height="10" rx="2" fill="${WHITE}"/>
<rect x="-2" y="-6" width="4" height="6" rx="2" fill="${INK}"/></g></symbol>
<symbol id="t-king" viewBox="-34 -46 68 80" overflow="visible"><g stroke="${INK}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">
<ellipse cx="0" cy="23" rx="36" ry="10" fill="currentColor" stroke-width="0"/><path d="M0 -28V-54" fill="none"/><path d="M0 -54L20 -48.5L0 -42Z" fill="currentColor"/>
<path d="M-32 -20L-32 16A6 2.5 0 0 0 -20 16L-20 -20Z" fill="${CREAM}"/><path d="M20 -20L20 16A6 2.5 0 0 0 32 16L32 -20Z" fill="${CREAM}"/>
<path d="M-34 -19L-26 -36L-18 -19Z" fill="currentColor"/><path d="M18 -19L26 -36L34 -19Z" fill="currentColor"/>
<path d="M-24 -16L-24 20A24 7 0 0 0 24 20L24 -16Z" fill="${CREAM}"/><path d="M-24 -11A24 7 0 0 0 24 -11L24 -5A24 7 0 0 1 -24 -5Z" fill="currentColor"/>
<path d="M-24 8A24 7 0 0 0 24 8" fill="none" stroke-width="1.2"/><path d="M-14 4V12M14 4V12M-19 15V22M19 15V22" fill="none" stroke-width="1.2"/>
<path d="M-7 25L-7 15A7 7 0 0 1 7 15L7 25.5Z" fill="${INK}"/><path d="M-6 6L-6 0L-3 3L0 -1L3 3L6 0L6 6Z" fill="${PINK}" stroke-width="1.2"/>
<ellipse cx="0" cy="-17" rx="27" ry="8" fill="${WHITE}"/>
<rect x="-26" y="-27" width="7" height="10" rx="2" fill="${WHITE}"/><rect x="-14.5" y="-28.5" width="7" height="10" rx="2" fill="${WHITE}"/><rect x="-3.5" y="-29" width="7" height="10" rx="2" fill="${WHITE}"/><rect x="7.5" y="-28.5" width="7" height="10" rx="2" fill="${WHITE}"/><rect x="19" y="-27" width="7" height="10" rx="2" fill="${WHITE}"/>
</g></symbol>
<symbol id="t-ruine" viewBox="-34 -46 68 80" overflow="visible"><g stroke="${INK}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">
<ellipse cx="0" cy="19" rx="23" ry="7" fill="currentColor" stroke-width="0"/><path d="M-16 4L-10 -2L-5 5L2 -1L8 6L16 2L16 16A16 5 0 0 0 -16 16Z" fill="${CREAM}"/>
<path d="M-16 11A16 5 0 0 0 16 11" fill="none" stroke-width="1.2"/><rect x="-26" y="10" width="9" height="7" rx="2" fill="${C3}"/><rect x="18" y="12" width="8" height="6" rx="2" fill="${C3}"/>
<rect x="-8" y="-12" width="7" height="7" rx="2" fill="${WHITE}"/><path d="M6 12L24 -6" fill="none"/><path d="M24 -6L30 5L22 3Z" fill="currentColor"/></g></symbol>`;
  const GRADIENT_DEF = '<linearGradient id="dg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF6229"/><stop offset="1" stop-color="#FF74CC"/></linearGradient>';

  // Échelles des personnages sur le terrain (DA)
  const UNIT_SCALE = { tank: 0.62, guerrier: 0.52, tireur: 0.5, essaim: 0.55, pompe: 0.55 };
  const SWARM_OFFSETS = [[0, -10], [-9, 0], [9, 0]];

  const teamColor = (side, viewer) => (side === viewer ? BLUE : ORANGE);
  const bar = (x, y, w, ratio, color) => pathTag(F(R(x - w / 2, y, w, 5, 2.5), I7)) + pathTag(F(R(x - w / 2, y, Math.max(5, w * ratio), 5, 2.5), color));

  // ─────────────────────────────────────────────
  // 🧱 Calques dynamiques (tours, unités, effets)
  //    view = engine.publicState(...) ; sprites = { url: symbolId }
  //    fx = [{ type: 'spell', x, y, age }] ; chips = [{ x, y, txt, age, accent? }]
  // ─────────────────────────────────────────────
  function renderDynamic(view, { arena = 'jardin', sprites = {}, fx = [], chips = [] } = {}) {
    const viewer = view.you;
    const dark = arenaOf(arena).dark;
    const out = [];
    const under = [];

    // ⏳ Poses en train d'apparaître : cercle pointillé au point d'apparition
    for (const p of view.pending || []) {
      if (p.archetype === 'sort') continue;   // un Sort frappe, il n'apparaît pas
      const at = toBoard(p.lane, p.side === 'A' ? (p.forward ? 60 : 20) : (p.forward ? 40 : 80), viewer);
      under.push(pathTag(F(C(at.x, at.y - 6, 16), 'none', teamColor(p.side, viewer), 1.5, '3 5')));
    }
    // 💥 Sorts : cercle rose + pointillé (sous les unités)
    for (const f of fx) {
      if (f.type === 'ring') {
        const k = Math.min(1, f.age / 800);
        under.push(`<g opacity="${(1 - k).toFixed(2)}">${pathTag(F(C(f.x, f.y, 10 + k * 18), 'none', f.color || BLUE, 2))}</g>`);
        continue;
      }
      if (f.type !== 'spell') continue;
      const o = Math.max(0, 1 - f.age / 700).toFixed(2);
      under.push(`<g opacity="${o}">${pathTag(F(C(f.x, f.y, 30), 'none', PINK, 3))}${pathTag(F(C(f.x, f.y, 22), 'none', f.color || BLUE, 1.5, '3 5'))}</g>`);
    }

    // Tours et unités triées par profondeur (plus bas = devant)
    const items = [];
    for (const b of view.buildings || []) {
      const at = toBoard(b.lane, b.y, viewer);
      const color = teamColor(b.side, viewer);
      if (b.kind === 'pompe') {
        if (b.alive && sprites[b.url]) items.push({ y: at.y, svg: `<use href="#${sprites[b.url]}" x="-45" y="-85" width="90" height="95" transform="translate(${at.x} ${at.y}) scale(${UNIT_SCALE.pompe})" style="color:${color}"/>` + (b.hp < b.maxHp ? bar(at.x, at.y - 52, 22, b.hp / b.maxHp, color) : '') });
        continue;
      }
      const king = b.kind === 'qg';
      const pos = king ? { x: W / 2, y: at.y } : { x: at.x, y: at.y + (b.lane === 1 ? -4 : 4) * (b.side === viewer ? 1 : -1) };
      const href = b.alive ? (king ? '#t-king' : '#t-lane') : '#t-ruine';
      let svg = `<use href="${href}" x="-34" y="-46" width="68" height="80" transform="translate(${pos.x} ${pos.y})" style="color:${color}"/>`;
      if (b.alive) {
        const ratio = b.hp / b.maxHp;
        if (ratio < 0.5) svg += pathTag(F(`M${pos.x - 9} ${pos.y - 2}l4 5l-3 5M${pos.x + 10} ${pos.y + 4}l-3 4l3 4`, 'none', INK, 1.4));
        svg += bar(pos.x, pos.y + (king ? -54 : -40), king ? 56 : 36, ratio, color);
      }
      items.push({ y: pos.y, svg });
    }
    for (const u of view.units || []) {
      const id = sprites[u.url];
      if (!id) continue;
      const at = toBoard(u.lane, u.y, viewer);
      const color = teamColor(u.side, viewer);
      const s = UNIT_SCALE[u.archetype] || 0.52;
      let svg;
      if (u.archetype === 'essaim') {
        // les 3 abeilles d'un essaim sont 3 unités du moteur : chacune garde sa place dans le trio
        const k = (u.id % 3 + 3) % 3;
        const [dx, dy] = SWARM_OFFSETS[k];
        svg = `<use href="#${id}" x="-45" y="-85" width="90" height="95" transform="translate(${at.x + dx} ${at.y + dy}) scale(${(s * 0.62).toFixed(3)})" style="color:${color}"/>`;
      } else {
        svg = `<use href="#${id}" x="-45" y="-85" width="90" height="95" transform="translate(${at.x} ${at.y}) scale(${s})" style="color:${color}"/>`;
      }
      if (u.hp < u.maxHp) svg += bar(at.x, at.y - (u.archetype === 'essaim' ? 36 : 54 * s + 6), u.archetype === 'essaim' ? 14 : 22, u.hp / u.maxHp, color);
      items.push({ y: at.y, svg });
    }
    items.sort((a, b) => a.y - b.y);
    out.push(...under, ...items.map((i) => i.svg));

    // 🏷️ Chips de dégâts (−210, ×1,5) comme dans la DA
    for (const c of chips) {
      const o = Math.max(0, 1 - c.age / 900).toFixed(2);
      const rise = Math.min(14, c.age / 60);
      const bg = dark ? CREAM : INK;
      const fg = c.accent ? ORANGE : (dark ? INK : CREAM);
      const w = 12 + String(c.txt).length * 7;
      out.push(`<g opacity="${o}" transform="translate(${c.x} ${c.y - rise})"><rect x="${-w / 2}" y="-10" width="${w}" height="20" rx="10" fill="${bg}"/><text x="0" y="4" text-anchor="middle" font-family="'Inter Tight',sans-serif" font-size="12" font-weight="600" fill="${fg}">${c.txt}</text></g>`);
    }
    return out.join('');
  }

  // ─────────────────────────────────────────────
  // 👆 Menu de pose : zones autorisées + point touché → couloir
  //    Ma moitié (sous la rivière) partout ; chez l'adversaire, seulement
  //    dans un couloir dont la tour adverse est tombée (pose avancée).
  // ─────────────────────────────────────────────
  const HOME_ZONE = { x: 6, y: 348, w: 348, h: 288 };
  const FORWARD_Y = [176, 296];
  const LANE_SPAN = [[6, 124], [121, 239], [236, 354]];   // bandes de pose, vues de mon camp

  // Couloir du moteur affiché à l'écran en position `screen` (0 = gauche)
  const laneAt = (screen, viewer) => (viewer === 'B' ? 2 - screen : screen);

  function breaches(view) {
    const foe = view.you === 'A' ? 'B' : 'A';
    return [0, 1, 2].filter((lane) => (view.buildings || []).some((b) => b.side === foe && b.kind === 'tower' && b.lane === lane && !b.alive));
  }

  /** Point du plan (x, y) → { ok, lane, forward } ou { ok: false, reason: 'zone' } */
  function pointToDeploy(x, y, view) {
    let screen = 0;
    for (let i = 1; i < 3; i += 1) if (Math.abs(LANE_X[i] - x) < Math.abs(LANE_X[screen] - x)) screen = i;
    const lane = laneAt(screen, view.you);
    if (y >= HOME_ZONE.y && y <= HOME_ZONE.y + HOME_ZONE.h) return { ok: true, lane, forward: false };
    if (y >= FORWARD_Y[0] && y <= FORWARD_Y[1] && x >= LANE_SPAN[screen][0] && x <= LANE_SPAN[screen][1] && breaches(view).includes(lane)) {
      return { ok: true, lane, forward: true };
    }
    return { ok: false, reason: 'zone' };
  }

  function renderZones(view) {
    const zone = (x, y, w, h) => pathTag(F(R(x, y, w, h, 14), 'none', BLUE, 1.8, '6 5'));
    const out = [zone(HOME_ZONE.x, HOME_ZONE.y, HOME_ZONE.w, HOME_ZONE.h)];
    for (const lane of breaches(view)) {
      const screen = laneAt(lane, view.you);
      const [x0, x1] = LANE_SPAN[screen];
      out.push(zone(x0, FORWARD_Y[0], x1 - x0, FORWARD_Y[1] - FORWARD_Y[0]));
    }
    return out.join('');
  }

  function renderGround(arena) {
    return groundPaths(arena).map(pathTag).join('');
  }

  /** Scène complète autonome (tests, aperçus). symbols = <symbol> des personnages. */
  function renderScene(view, opts = {}) {
    const { arena = 'jardin', symbols = '' } = opts;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><defs>${GRADIENT_DEF}${TOWER_SYMBOLS}${symbols}</defs>`
      + `<g>${renderGround(arena)}</g><g>${renderDynamic(view, opts)}</g></svg>`;
  }

  // ─────────────────────────────────────────────
  // 🎞️ Rendu animé (navigateur) : reçoit les états 10 Hz du serveur,
  //    interpole les positions à 60 images/s, gère Sorts et chips.
  // ─────────────────────────────────────────────
  function createRenderer(svgEl, { arena = 'jardin', symbols = '', sprites = {} } = {}) {
    let prev = null;
    let curr = null;
    let currAt = 0;
    let fx = [];
    let chips = [];
    let raf = null;
    let showZones = false;
    const lastHp = new Map();
    const STEP = 100;

    svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svgEl.innerHTML = `<defs>${GRADIENT_DEF}${TOWER_SYMBOLS}${symbols}</defs><g data-ground>${renderGround(arena)}</g><g data-live></g>`;
    const live = svgEl.querySelector('[data-live]');

    function setArena(key) {
      arena = key;
      svgEl.querySelector('[data-ground]').innerHTML = renderGround(key);
    }

    function push(view) {
      const now = performance.now();
      prev = curr;
      curr = view;
      currAt = now;
      for (const e of view.events || []) {
        if (e.type === 'deploy' && e.archetype !== 'sort') {
          const spawnY = e.side === 'A' ? (e.forward ? 60 : 20) : (e.forward ? 40 : 80);
          const at = toBoard(e.lane, spawnY, view.you);
          fx.push({ type: 'ring', x: at.x, y: at.y - 6, born: now, color: e.side === view.you ? BLUE : ORANGE });
        }
        if (e.type === 'spell') {
          const at = toBoard(e.lane, e.y, view.you);
          fx.push({ type: 'spell', x: at.x, y: at.y - 10, born: now, color: e.side === view.you ? BLUE : ORANGE });
        }
      }
      // Chips de dégâts sur les tours (cumul par tour, une chip par 700 ms)
      for (const b of view.buildings || []) {
        if (b.kind === 'pompe') continue;
        const before = lastHp.get(b.id);
        if (before !== undefined && b.hp < before.hp) {
          before.pending += before.hp - b.hp;
        }
        const entry = before || { hp: b.hp, pending: 0, at: 0 };
        entry.hp = b.hp;
        if (entry.pending >= 1 && now - entry.at > 700) {
          const at = toBoard(b.lane, b.y, view.you);
          chips.push({ x: b.kind === 'qg' ? W / 2 : at.x, y: at.y - (b.kind === 'qg' ? 70 : 56), txt: `−${Math.round(entry.pending)}`, born: now });
          entry.pending = 0;
          entry.at = now;
        }
        lastHp.set(b.id, entry);
      }
    }

    function frame() {
      raf = requestAnimationFrame(frame);
      if (!curr) return;
      const now = performance.now();
      const t = Math.min(1, (now - currAt) / STEP);
      let view = curr;
      if (prev && curr.units) {
        const before = new Map((prev.units || []).map((u) => [u.id, u]));
        view = { ...curr, units: curr.units.map((u) => {
          const p = before.get(u.id);
          return p ? { ...u, y: p.y + (u.y - p.y) * t } : u;
        }) };
      }
      fx = fx.filter((f) => now - f.born < (f.type === 'ring' ? 800 : 700));
      chips = chips.filter((c) => now - c.born < 900);
      live.innerHTML = (showZones ? renderZones(view) : '') + renderDynamic(view, {
        arena,
        sprites,
        fx: fx.map((f) => ({ ...f, age: now - f.born })),
        chips: chips.map((c) => ({ ...c, age: now - c.born })),
      });
    }

    /** Affiche / masque les zones de pose (carte sélectionnée). */
    function setZones(on) { showZones = Boolean(on); }
    const current = () => curr;

    function start() { if (!raf) raf = requestAnimationFrame(frame); }
    function stop() { if (raf) cancelAnimationFrame(raf); raf = null; }
    start();
    return { push, setArena, setZones, current, start, stop };
  }

  return {
    W, H, LANE_X, ARENAS, COLORS: { INK, CREAM, PINK, BLUE, ORANGE, I7, I8 },
    TOWER_SYMBOLS, GRADIENT_DEF,
    toBoard, groundPaths, renderGround, renderDynamic, renderScene, createRenderer,
    pointToDeploy, renderZones,
  };
}));
