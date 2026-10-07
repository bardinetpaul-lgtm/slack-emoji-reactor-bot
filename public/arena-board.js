// ═══════════════════════════════════════════════════════════
//  🏟️ RENDU DU TERRAIN DE L'ARÈNE (navigateur + Node)
//  D'après la DA « Arènes » (Claude Design) : plan 360×640, terrain
//  OUVERT (2026-09-28 : plus de couloirs), une rivière et DEUX ponts
//  (x = 100 / 260), trois tours (x = 60 / 180 / 300) et le QG par camp.
//  Seuls le sol et le décor changent : Le jardin · Le port · La salle serveur.
//  Moteur → plan : x absolu 0–100 (x 17 / 50 / 83 = les tours) → 0–360.
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
    GREY = '#6B716E', PINK = '#FF73C0', BLUE = '#1C72F1', ORANGE = '#FF6229', GOLD = '#FFC83D';
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

  /** Inverse de mapY : ordonnée du plan → profondeur vue de mon camp (0 = ma base). */
  function unmapY(by) {
    for (let i = 1; i < ANCHORS.length; i += 1) {
      const [y0, b0] = ANCHORS[i - 1];
      const [y1, b1] = ANCHORS[i];
      if (by >= b1 || i === ANCHORS.length - 1) return y0 + ((by - b0) * (y1 - y0)) / (b1 - b0);
    }
    return 50;
  }

  // x du moteur (0–100, absolu) ⇄ x du plan vu du camp A (tours en 60 / 180 / 300)
  const PX = 240 / 66;
  const planX = (x) => x * PX - 1.8;
  const engineX = (px) => (px + 1.8) / PX;
  const XK = 0.6;                     // distances du moteur : hypot((dx) × 0,6, dy)
  const BRIDGE_X = [100, 260];        // ponts (x 28 et 72 du moteur)

  /** Position d'un élément du moteur (x absolu, y) sur le plan, vu par `viewer` ('A' | 'B'). */
  function toBoard(x, y, viewer) {
    const mine = viewer === 'B' ? 100 - y : y;
    const px = planX(typeof x === 'number' ? x : 50);
    return { x: viewer === 'B' ? W - px : px, y: mapY(mine) };
  }

  // ─────────────────────────────────────────────
  // ✏️ Primitives (identiques à la DA)
  // ─────────────────────────────────────────────
  const C = (x, y, r) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
  const R = (x, y, w, h, r) => `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
  const E = (x, y, rx, ry) => `M${x - rx} ${y}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
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
  const LX = BRIDGE_X.map((x) => x - 20);   // bord gauche des deux ponts

  function base(ground, lane, river, bridge) {
    const g = [F(R(0, 0, W, H, 0), ground)];
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
    LX.forEach((x) => g.push(F(R(x - 8, 268, 56, 104, 8), C3, INK, 1.4), lines(x - 4, x + 44, 278, 364, 10, GREY, 1)));
    LX.forEach((x) => [[x - 4, 272], [x + 44, 272], [x - 4, 368], [x + 44, 368]].forEach(([a, b]) => g.push(F(C(a, b, 3.5), INK))));
    g.push(F('M146 314L210 314Q204 334 190 334L166 334Q150 334 146 314Z', WHITE, INK, 1.4), F(R(164, 300, 22, 14, 3), PINK, INK, 1.4), F(R(146, 314, 64, 4, 2), PINK));
    g.push(...buoy(18, 300), ...buoy(344, 340), ...buoy(120, 296));
    [[0, 188, 34, 22, PINK], [0, 212, 34, 22, C3], [326, 158, 34, 22, WHITE], [326, 182, 34, 22, 'url(#dg)'], [0, 396, 34, 22, WHITE], [326, 418, 34, 22, PINK], [326, 442, 34, 22, I7], [98, 200, 40, 20, C3], [216, 560, 40, 20, PINK]].forEach((a) => g.push(...container(...a)));
    [[100, 120], [222, 236], [96, 420], [232, 470], [14, 120], [334, 570], [104, 560]].forEach(([x, y]) => g.push(...crate(x, y)));
    g.push(F(C(0, 640, 54), BLUE), F(C(360, 0, 54), ORANGE));
    return g;
  }

  function serveurs() {
    const g = [F(R(0, 0, W, H, 0), INK), lines(0, 360, 0, 640, 40, I8, 1), lines(0, 360, 0, 640, 40, I8, 1, true)];
    g.push(F(R(0, 300, W, 40, 0), I8));
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

  // ─────────────────────────────────────────────
  // 👥 Groupes et 🚶 marche
  //    Une carte = un groupe de personnages en formation. Chaque
  //    personnage a son sol fixe ; le corps se balance, les jambes
  //    alternent en marchant (« step »), le Tank et les robes longues
  //    se dandinent sans pas visible (« sway »), respiration à l'arrêt.
  //    sprites[url] = 'id' (personnage figé) ou { id, walk }.
  // ─────────────────────────────────────────────
  const GOLD_ALARM = '#FFB020';
  const UNIT_SCALE = { tank: 0.42, guerrier: 0.42, tireur: 0.4, essaim: 0.32, vigie: 0.3 };
  const FORMATIONS = {
    1: [[0, 0]],
    2: [[-9, -2], [9, 2]],
    3: [[0, -8], [-11, 4], [11, 4]],
    6: [[-12, -9], [0, -11], [12, -9], [-12, 3], [0, 1], [12, 3]],
  };
  const STEP_HZ = { tank: 0.9, guerrier: 1.8, tireur: 1.7, essaim: 2.6 };
  const GROUND = 'M-20 2A20 7 0 1 0 20 2A20 7 0 1 0 -20 2Z';
  const spriteOf = (raw) => (!raw ? null : typeof raw === 'string' ? { id: raw, walk: 'none' } : raw);

  function formationOffset(u) {
    if (u.archetype === 'tank' && u.packSize === 2) return [[-13, -4], [13, 4]][(u.slot || 0) % 2];   // deux chars côte à côte
    const f = FORMATIONS[u.packSize] || FORMATIONS[1];
    return f[(u.slot || 0) % f.length] || [0, 0];
  }

  function renderUnit(u, at, color, sprite, time) {
    const s = UNIT_SCALE[u.archetype] || 0.42;
    const [dx, dy] = formationOffset(u);
    const x = +(at.x + dx).toFixed(2);
    const y = +(at.y + dy).toFixed(2);
    const phase = (time / 1000) * (STEP_HZ[u.archetype] || 1.8) * 2 * Math.PI + u.id * 1.7;
    const sin = Math.sin(phase);
    const walking = Boolean(u.moving) && sprite.walk !== 'none' && !u.frozen;
    const bob = walking ? -Math.abs(sin) * 2.4 : -Math.abs(Math.sin(phase * 0.3)) * 0.8;
    const tilt = walking ? sin * (sprite.walk === 'sway' ? 5 : 3) : 0;
    const use = (href) => `<use href="#${href}" x="-45" y="-85" width="90" height="95"/>`;
    const hpBar = u.hp < u.maxHp ? bar(x, y - 95 * s, 14, u.hp / u.maxHp, color) : '';
    // ✨ états : gel, ralenti, bouclier ; 🏳 retraite = estompé
    let marks = '';
    if (u.frozen) marks += `<g data-fx="frozen">${pathTag(F(C(x, y - 40 * s, 44 * s), 'none', BLUE, 2.5))}</g>`;
    else if (u.slowed) marks += `<g data-fx="slowed">${pathTag(F(C(x, y - 40 * s, 44 * s), 'none', BLUE, 1.5, '3 3'))}</g>`;
    if (u.shield) marks += `<g data-fx="shield">${pathTag(F(C(x, y - 40 * s, 50 * s), 'none', WHITE, 2))}</g>`;
    const fade = u.recalling ? ' opacity="0.55"' : '';

    const attacking = typeof u.atk === 'number' && !u.frozen;
    const sec = time / 1000;
    let body;
    if (sprite.walk === 'fly') {
      // 🐝 Essaim : vole au-dessus de son ombre, ailes qui battent, pique en attaquant
      const hover = -10 + Math.sin(sec * 2 * Math.PI * 1.6 + u.id) * 2.5;
      const flap = (0.25 + 0.75 * Math.abs(Math.sin(sec * 2 * Math.PI * 7 + u.id))).toFixed(2);
      const dive = attacking ? Math.max(0, Math.sin(sec * 2 * Math.PI * 2 + u.id)) * 5 : 0;
      return `<g${fade} transform="translate(${x} ${y}) scale(${s})" style="color:${color}">`
        + `<path d="${E(0, 2, 11 + hover * 0.25, 3.8)}" fill="${color}" opacity="0.55"/>`
        + `<g transform="translate(${dive.toFixed(1)} ${(hover + dive).toFixed(1)})"><g transform="translate(0 -31) scale(1 ${flap}) translate(0 31)">${use(`${sprite.id}-w`)}</g>${use(`${sprite.id}-f`)}</g></g>${marks}${hpBar}`;
    }
    if (sprite.walk === 'roll') {
      // 🛡 Tank : chenilles qui défilent, roues qui tournent, recul du canon au tir
      const rolling = walking;
      const turn = rolling ? (sec * 400) % 360 : 0;
      const dash = rolling ? -((sec * 40) % 8) : 0;
      const wheels = [-22, -7.5, 7.5, 22].map((wx) => `<g transform="translate(${wx} -7.5) rotate(${turn.toFixed(1)})">${pathTag(F(C(0, 0, 4.5), '#6B716E', INK, 1.4))}${pathTag(F('M-4 0H4M0 -4V4', 'none', INK, 1.2))}</g>`).join('');
      const treads = pathTag(F(R(-32, -15, 64, 15, 7.5), INK, INK, 1.8)) + wheels
        + `<path d="M-26 -15H26M-26 0H26" fill="none" stroke="#6B716E" stroke-width="1.6" stroke-dasharray="3 5" stroke-dashoffset="${dash.toFixed(1)}"/>`;
      const recoil = attacking ? -Math.max(0, Math.sin(sec * 2 * Math.PI * 0.9 + u.id)) * 2.5 : 0;
      const shake = rolling ? Math.sin(sec * 60) * 0.5 : 0;
      return `<g${fade} transform="translate(${x} ${y}) scale(${s})" style="color:${color}">`
        + `<path d="${E(0, 2, 32, 11)}" fill="${color}"/>${treads}`
        + `<g transform="translate(${recoil.toFixed(1)} ${shake.toFixed(2)})">${use(`${sprite.id}-f`)}</g></g>${marks}${hpBar}`;
    }
    if (sprite.walk === 'step') {
      const lift = (v) => (walking ? Math.max(0, v) * 4 : 0);
      const leg = (lx, up, shift) => pathTag(F(R(lx + shift, -15 - up, 7, 15, 3), INK, INK, 1.8));
      // ⚔️ Guerrier : l'arme s'abat au contact · 🏹 Tireur : l'arc se tend puis tire
      let weapon = '';
      if (attacking && u.archetype === 'guerrier') weapon = `rotate(${(-40 + 80 * Math.max(0, Math.sin(sec * 2 * Math.PI * 2.2 + u.id))).toFixed(1)} 16 -22)`;
      if (attacking && u.archetype === 'tireur') weapon = `translate(${(-2.5 * Math.max(0, Math.sin(sec * 2 * Math.PI * 1.3 + u.id))).toFixed(1)} 0)`;
      body = use(`${sprite.id}-b`)
        + leg(-9, lift(sin), walking ? sin * 1.2 : 0)
        + leg(2, lift(-sin), walking ? -sin * 1.2 : 0)
        + use(`${sprite.id}-f`)
        + `<g transform="${weapon}">${use(`${sprite.id}-w`)}</g>`;
    } else if (sprite.walk === 'sway') {
      body = use(`${sprite.id}-f`);
    } else {
      // personnage figé (symbole complet, son sol compris)
      return `<g${fade} transform="translate(${x} ${y}) scale(${s})" style="color:${color}">${use(sprite.id)}</g>${marks}${hpBar}`;
    }
    return `<g${fade} transform="translate(${x} ${y}) scale(${s})" style="color:${color}">`
      + `<path d="${GROUND}" fill="${color}"/>`
      + `<g transform="translate(0 ${bob.toFixed(2)}) rotate(${tilt.toFixed(2)} 0 0)">${body}</g></g>${marks}${hpBar}`;
  }

  // 👁 rôles des poses adverses (même vocabulaire que l'éditeur de deck)
  const ROLE_ICONS = { tank: '🛡', guerrier: '⚔️', tireur: '🏹', essaim: '🐝', sort: '💥', vigie: '🗼' };
  const ROLE_TAGS = { tank: '🛡 Tank', guerrier: '⚔️ Guerrier', tireur: '🏹 Tireur', essaim: '🐝 Essaim', sort: '💥 Sort', vigie: '🗼 Vigie' };
  const RARITY_TAGS = { rare: 'Rare', epic: 'Épique', legendary: 'Légendaire', rose: 'Octobre Rose' };
  const teamColor = (side, viewer) => (side === viewer ? BLUE : ORANGE);
  const bar = (x, y, w, ratio, color) => pathTag(F(R(x - w / 2, y, w, 5, 2.5), I7)) + pathTag(F(R(x - w / 2, y, Math.max(5, w * ratio), 5, 2.5), color));

  /**
   * 🗼 Vigie en poste sur une tour : halo à la couleur du camp, le personnage
   * de la carte debout sur les créneaux, un petit étendard doré, et la barre
   * de garde (dorée) au-dessus de la barre de PV.
   * pos = pied de la tour sur le plan · barY = hauteur de la barre de PV.
   */
  function renderVigie(v, pos, color, sprites, barY) {
    const halo = `<circle cx="${pos.x}" cy="${pos.y - 8}" r="34" fill="${color}" fill-opacity="0.14"/>`
      + pathTag(F(C(pos.x, pos.y - 8, 34), 'none', color, 2.5));
    const sprite = spriteOf(sprites[v.url]);
    const s = UNIT_SCALE.vigie;
    const figure = sprite
      ? `<use href="#${sprite.id}" x="-45" y="-85" width="90" height="95" transform="translate(${pos.x - 4} ${pos.y - 18}) scale(${s})" style="color:${color}"/>`
      : '';
    const flag = `<g data-fx="vigie-flag">${pathTag(F(`M${pos.x + 13} ${pos.y - 18}V${pos.y - 40}`, 'none', INK, 1.4))}`
      + `${pathTag(F(`M${pos.x + 13} ${pos.y - 40}L${pos.x + 23} ${pos.y - 36.5}L${pos.x + 13} ${pos.y - 33}Z`, GOLD, INK, 1.2))}</g>`;
    const ratio = v.guardMax > 0 ? Math.max(0, Math.min(1, v.guard / v.guardMax)) : 0;
    const gy = barY - 7;
    const guard = `<g data-fx="guard">${pathTag(F(R(pos.x - 18, gy, 36, 5, 2.5), I7))}`
      + (ratio > 0 ? pathTag(F(R(pos.x - 18, gy, Math.max(5, 36 * ratio), 5, 2.5), GOLD)) : '') + '</g>';
    return `<g data-fx="vigie">${halo}${figure}${flag}</g>${guard}`;
  }

  // ─────────────────────────────────────────────
  // 🧱 Calques dynamiques (tours, unités, effets)
  //    view = engine.publicState(...) ; sprites = { url: symbolId }
  //    fx = [{ type: 'spell', x, y, age }] ; chips = [{ x, y, txt, age, accent? }]
  // ─────────────────────────────────────────────
  function renderDynamic(view, { arena = 'jardin', sprites = {}, fx = [], chips = [], time = 0 } = {}) {
    const viewer = view.you;
    const dark = arenaOf(arena).dark;
    const out = [];
    const under = [];
    const over = [];

    // ⏳ Poses en train d'apparaître : cercle pointillé au point d'apparition
    for (const p of view.pending || []) {
      if (p.archetype === 'sort') continue;   // un Sort frappe, il n'apparaît pas
      const at = toBoard(p.x, p.y, viewer);
      under.push(pathTag(F(C(at.x, at.y - 6, 16), 'none', teamColor(p.side, viewer), 1.5, '3 5')));
    }
    // 💥 Sorts : cercle rose + pointillé (sous les unités)
    for (const f of fx) {
      if (f.type === 'lane') {
        // 🎖 pouvoir : la zone touchée s'illumine
        const o = Math.max(0, 0.35 * (1 - f.age / 900)).toFixed(2);
        under.push(`<g opacity="${o}" data-fx="lane">${pathTag(F(E(f.x, f.y, 97, 80), f.color || PINK))}</g>`);
        continue;
      }
      if (f.type === 'ring') {
        const k = Math.min(1, f.age / 800);
        under.push(`<g opacity="${(1 - k).toFixed(2)}">${pathTag(F(C(f.x, f.y, 10 + k * 18), 'none', f.color || BLUE, 2))}</g>`);
        continue;
      }
      if (f.type === 'arrow' || f.type === 'shell') {
        const k = Math.min(1, f.age / f.dur);
        const arc = Math.sin(k * Math.PI) * (f.type === 'arrow' ? 9 : 5);
        const px = f.x0 + (f.x1 - f.x0) * k;
        const py = f.y0 + (f.y1 - f.y0) * k - arc;
        if (f.type === 'shell') { over.push(pathTag(F(C(px, py, 2.6), INK, INK, 1))); continue; }
        const dy = (f.y1 - f.y0) - Math.cos(k * Math.PI) * Math.PI * 9;
        const deg = (Math.atan2(dy, f.x1 - f.x0) * 180) / Math.PI;
        over.push(`<g data-fx="arrow" transform="translate(${px.toFixed(1)} ${py.toFixed(1)}) rotate(${deg.toFixed(1)})">`
          + `${pathTag(F('M-8 0H5', 'none', INK, 1.6))}${pathTag(F('M5 -2.6L9.5 0L5 2.6Z', WHITE, INK, 1))}${pathTag(F('M-8 0L-11 -2.8M-8 0L-11 2.8', 'none', f.color, 1.5))}</g>`);
        continue;
      }
      if (f.type === 'hit') {
        const o = Math.max(0, 1 - f.age / 260).toFixed(2);
        const r = 3 + f.age / 40;
        over.push(`<g data-fx="hit" opacity="${o}">${pathTag(F(`M${f.x - r} ${f.y}H${f.x + r}M${f.x} ${f.y - r}V${f.y + r}M${f.x - r * 0.7} ${f.y - r * 0.7}L${f.x + r * 0.7} ${f.y + r * 0.7}M${f.x + r * 0.7} ${f.y - r * 0.7}L${f.x - r * 0.7} ${f.y + r * 0.7}`, 'none', f.color || WHITE, 2))}</g>`);
        continue;
      }
      if (f.type !== 'spell') continue;
      // 💥 explosion du Sort, AU-DESSUS des unités : flash, onde, éclats
      const k = Math.min(1, f.age / 700);
      const o = (1 - k).toFixed(2);
      const r = 14 + k * 22;
      let rays = '';
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2;
        rays += `M${(f.x + Math.cos(a) * r * 0.6).toFixed(1)} ${(f.y + Math.sin(a) * r * 0.6).toFixed(1)}L${(f.x + Math.cos(a) * r).toFixed(1)} ${(f.y + Math.sin(a) * r).toFixed(1)}`;
      }
      over.push(`<g data-fx="spell" opacity="${o}">${pathTag(F(C(f.x, f.y, r), k < 0.25 ? 'rgba(255,115,192,.45)' : 'none', PINK, 3))}${pathTag(F(rays, 'none', f.color || BLUE, 2.2))}${pathTag(F(C(f.x, f.y, r * 0.55), 'none', WHITE, 1.5, '3 5'))}</g>`);
    }

    // Tours et unités triées par profondeur (plus bas = devant)
    const items = [];
    for (const b of view.buildings || []) {
      const at = toBoard(b.x, b.y, viewer);
      const color = teamColor(b.side, viewer);
      const king = b.kind === 'qg';
      const pos = king ? { x: W / 2, y: at.y } : { x: at.x, y: at.y + (b.lane === 1 ? -4 : 4) * (b.side === viewer ? 1 : -1) };
      const href = b.alive ? (king ? '#t-king' : '#t-lane') : '#t-ruine';
      let svg = `<use href="${href}" x="-34" y="-46" width="68" height="80" transform="translate(${pos.x} ${pos.y})" style="color:${color}"/>`;
      // 🗼 Vigie en poste : les barres montent pour laisser la place au personnage
      const vigie = b.alive && !king && b.vigie ? b.vigie : null;
      const barY = pos.y + (king ? -54 : vigie ? -52 : -40);
      // 🎖 Rempart : halo + cercle à la couleur de l'équipe et 🛡 (un cercle blanc disparaissait sur le sol crème)
      if (b.alive && b.shielded) {
        svg += `<g data-fx="rempart"><circle cx="${pos.x}" cy="${pos.y - 8}" r="36" fill="${color}" fill-opacity="0.18"/>`
          + pathTag(F(C(pos.x, pos.y - 8, 36), 'none', color, 4, '7 5'))
          + `<text x="${pos.x}" y="${vigie ? barY - 12 : pos.y - 50}" text-anchor="middle" font-size="22">🛡</text></g>`;
      }
      // 🔔 Alarme (Garnison) : anneau doré pulsé + 🔔 sur les tours vivantes du camp qui l'a lancée
      if (b.alive && !king && view.players && view.players[b.side] && view.players[b.side].alarm) {
        svg += `<g data-fx="alarme"><circle cx="${pos.x}" cy="${pos.y - 8}" r="40" fill="${GOLD_ALARM}" fill-opacity="0.16">`
          + `<animate attributeName="fill-opacity" values="0.1;0.32;0.1" dur="0.8s" repeatCount="indefinite"/></circle>`
          + pathTag(F(C(pos.x, pos.y - 8, 40), 'none', GOLD_ALARM, 3, '4 4'))
          + `<text x="${pos.x + 24}" y="${pos.y - 44}" text-anchor="middle" font-size="18">🔔</text></g>`;
      }
      if (vigie) svg += renderVigie(vigie, pos, color, sprites, barY);
      if (b.alive) {
        const ratio = b.hp / b.maxHp;
        if (ratio < 0.5) svg += pathTag(F(`M${pos.x - 9} ${pos.y - 2}l4 5l-3 5M${pos.x + 10} ${pos.y + 4}l-3 4l3 4`, 'none', INK, 1.4));
        svg += bar(pos.x, barY, king ? 56 : 36, ratio, color);
      }
      items.push({ y: pos.y, svg });
    }
    for (const u of view.units || []) {
      const sprite = spriteOf(sprites[u.url]);
      if (!sprite) continue;
      const at = toBoard(u.x, u.y, viewer);
      let svg = renderUnit(u, at, teamColor(u.side, viewer), sprite, time);
      // 👁 groupe adverse : son rôle au-dessus du chef de file
      if (u.side !== viewer && u.slot === 0 && ROLE_ICONS[u.archetype]) {
        const s = UNIT_SCALE[u.archetype] || 0.42;
        const [dx, dy] = formationOffset(u);
        const ix = +(at.x + dx).toFixed(1);
        const iy = +(at.y + dy - 95 * s - 12).toFixed(1);
        svg += `<g data-fx="role" transform="translate(${ix} ${iy})"><circle r="8" fill="${ORANGE}"/><text y="3.5" text-anchor="middle" font-size="10">${ROLE_ICONS[u.archetype]}</text></g>`;
      }
      items.push({ y: at.y, svg });
    }
    items.sort((a, b) => a.y - b.y);
    out.push(...under, ...items.map((i) => i.svg), ...over);

    // 🏷️ Chips de dégâts (−210, ×1,5) comme dans la DA
    for (const c of chips) {
      const life = c.life || 900;
      const o = Math.max(0, Math.min(1, (life - c.age) / 300)).toFixed(2);   // bien lisible, puis s'efface
      const rise = c.life ? 0 : Math.min(14, c.age / 60);
      const bg = dark ? CREAM : INK;
      const fg = c.accent ? ORANGE : (dark ? INK : CREAM);
      const w = 12 + String(c.txt).length * 7;
      out.push(`<g opacity="${o}" transform="translate(${c.x} ${c.y - rise})"><rect x="${-w / 2}" y="-10" width="${w}" height="20" rx="10" fill="${bg}"/><text x="0" y="4" text-anchor="middle" font-family="'Inter Tight',sans-serif" font-size="12" font-weight="600" fill="${fg}">${c.txt}</text></g>`);
    }
    return out.join('');
  }

  // ─────────────────────────────────────────────
  // 👆 Menu de pose : zones autorisées + point touché → point du moteur
  //    Ma moitié (sous la rivière), n'importe où ; chez l'adversaire,
  //    seulement autour d'une de ses tours détruites (pose avancée).
  // ─────────────────────────────────────────────
  // Règles de placement (identiques au moteur, en profondeur vue de mon camp)
  const ZONE = { homeMin: 8, homeMax: 45, foeMin: 55, foeMax: 92, spellMin: 3, spellMax: 97, xMin: 4, xMax: 96 };
  const BREACH_RADIUS = 20;
  const HOME_ZONE = { x: planX(ZONE.xMin), y: mapY(ZONE.homeMax), w: planX(ZONE.xMax) - planX(ZONE.xMin), h: mapY(ZONE.homeMin) - mapY(ZONE.homeMax) };

  /** Tours adverses détruites (repère du moteur). */
  function breaches(view) {
    const foe = view.you === 'A' ? 'B' : 'A';
    return (view.buildings || []).filter((b) => b.side === foe && b.kind === 'tower' && !b.alive);
  }

  /** Point du plan (vu de mon camp) → { x absolu, depth, y } du moteur. */
  function planToEngine(px, py, view) {
    const x = engineX(view.you === 'B' ? W - px : px);
    const depth = unmapY(py);
    return { x, depth, y: view.you === 'B' ? 100 - depth : depth };
  }

  /**
   * Point du plan (x, y) → { ok, x, depth, forward } (ou { ok: false, reason, x, depth }).
   * x = position absolue du moteur, depth = profondeur vue de mon camp (0 = ma base).
   * { spell: true } : un Sort se vise n'importe où, et « colle » au groupe
   * ennemi touché (on vise le corps, pas le sol).
   */
  function pointToDeploy(px, py, view, { spell = false } = {}) {
    let p = planToEngine(px, py, view);
    if (spell) {
      let best = null;
      let bestD = 34;
      for (const u of view.units || []) {
        if (u.side === view.you) continue;
        const at = toBoard(u.x, u.y, view.you);
        const d = Math.min(Math.hypot(at.x - px, at.y - py), Math.hypot(at.x - px, at.y - 16 - py));
        if (d < bestD) { best = u; bestD = d; }
      }
      if (best) p = { x: best.x, y: best.y, depth: view.you === 'B' ? 100 - best.y : best.y };
    }
    const r1 = (v) => Math.round(v * 10) / 10;
    const base = { x: r1(p.x), depth: r1(p.depth) };
    const out = (ok, reason) => (ok ? { ok: true, ...base, forward: p.depth >= ZONE.foeMin } : { ok: false, reason, ...base });
    if (spell) return out(p.depth >= ZONE.spellMin && p.depth <= ZONE.spellMax && p.x >= 3 && p.x <= 97, 'zone');
    if (p.x < ZONE.xMin || p.x > ZONE.xMax) return out(false, 'zone');
    if (p.depth >= ZONE.homeMin && p.depth <= ZONE.homeMax) return out(true);
    if (p.depth >= ZONE.foeMin && p.depth <= ZONE.foeMax) {
      const near = breaches(view).some((t) => Math.hypot((t.x - p.x) * XK, t.y - p.y) <= BREACH_RADIUS);
      return near ? out(true) : out(false, 'no_breach');
    }
    return out(false, 'zone');
  }

  /**
   * 👻 Fantôme de placement : où le groupe va apparaître (ou zone d'impact d'un Sort).
   * { x, y, ok, archetype, sprite }  (rouge si interdit)
   */
  function renderGhost(g) {
    if (!g) return '';
    const color = g.ok ? WHITE : ORANGE;
    if (g.archetype === 'sort') {
      return `<g data-fx="ghost-spell" opacity="0.9">${pathTag(F(C(g.x, g.y, 32), g.ok ? 'rgba(255,115,192,.18)' : 'rgba(255,98,41,.18)', g.ok ? PINK : ORANGE, 2.5, '5 4'))}${pathTag(F(C(g.x, g.y, 3), g.ok ? PINK : ORANGE))}</g>`;
    }
    const s = UNIT_SCALE[g.archetype] || 0.42;
    const figure = g.sprite
      ? `<g opacity="0.55" transform="translate(${g.x} ${g.y}) scale(${s})" style="color:${g.ok ? BLUE : ORANGE}"><use href="#${g.sprite}" x="-45" y="-85" width="90" height="95"/></g>`
      : '';
    return `<g data-fx="ghost">${pathTag(F(C(g.x, g.y - 8, 20), 'none', color, 2, '4 4'))}${figure}</g>`;
  }

  /**
   * 🗼 Tour qui recevra une Vigie posée au point (px, py) du plan : même règle que
   * le moteur (ma tour vivante la plus proche, sans Vigie ni Vigie en cours de pose).
   * → le bâtiment, ou null (aucune tour libre). Pas de zone de pose : tout le terrain compte.
   */
  function vigieTower(px, py, view) {
    const p = planToEngine(px, py, view);
    const me = view.you;
    const taken = (t) => (view.pending || []).some((q) => q.side === me && q.archetype === 'vigie' && Math.abs(q.x - t.x) < 0.01 && Math.abs(q.y - t.y) < 0.01);
    let best = null;
    let bestD = Infinity;
    for (const t of view.buildings || []) {
      if (t.side !== me || t.kind !== 'tower' || !t.alive || t.vigie || taken(t)) continue;
      const d = Math.hypot((t.x - p.x) * XK, t.y - p.y);
      if (d < bestD) { best = t; bestD = d; }
    }
    return best;
  }

  /** 🎖 Pouvoir : point du moteur touché → { x, depth }. */
  function pointToPower(px, py, view) {
    const p = planToEngine(px, py, view);
    return { x: Math.round(p.x * 10) / 10, depth: Math.round(p.depth * 10) / 10 };
  }
  /** Rétro-compatibilité : colonne de tour la plus proche du point. */
  function laneAtPoint(px, view) {
    const x = planToEngine(px, 320, view).x;
    return [17, 50, 83].reduce((best, cx, i, a) => (Math.abs(cx - x) < Math.abs(a[best] - x) ? i : best), 0);
  }

  /** 🏳 Rappel : mon unité la plus proche du point touché (≤ 22 px), hors retraite. */
  function unitAtPoint(x, y, view, viewer) {
    let best = null;
    let bestD = 22;
    for (const u of view.units || []) {
      if (u.side !== viewer || u.recalling || u.poseId === null || u.poseId === undefined) continue;
      const at = toBoard(u.x, u.y, viewer);
      const [dx, dy] = formationOffset(u);
      const d = Math.hypot(at.x + dx - x, at.y + dy - 12 - y);
      if (d < bestD) { best = u; bestD = d; }
    }
    return best;
  }

  function renderZones(view) {
    const zone = (x, y, w, h) => pathTag(F(R(x, y, w, h, 14), 'none', BLUE, 1.8, '6 5'));
    const out = [zone(HOME_ZONE.x, HOME_ZONE.y, HOME_ZONE.w, HOME_ZONE.h)];
    for (const t of breaches(view)) {
      const at = toBoard(t.x, t.y, view.you);
      out.push(pathTag(F(E(at.x, at.y + 14, (BREACH_RADIUS / XK) * PX * 0.92, 92), 'rgba(28,114,241,.08)', BLUE, 1.8, '6 5')));
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
  //    interpole les positions à 60 images/s (option step : 5 Hz sur JP TV), gère Sorts et chips.
  // ─────────────────────────────────────────────
  function createRenderer(svgEl, { arena = 'jardin', symbols = '', sprites = {}, step = 100 } = {}) {
    let prev = null;
    let curr = null;
    let currAt = 0;
    let fx = [];
    let chips = [];
    let raf = null;
    let showZones = false;
    let ghost = null;
    const lastHp = new Map();
    const lastShot = new Map();   // unité → dernier tir montré
    const SHOT_EVERY = { tireur: 750, tank: 1100, guerrier: 650, essaim: 520 };
    const STEP = step;   // ms entre deux états (100 en jeu, 200 sur JP TV)

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
        if (e.type === 'deploy') {
          const at = toBoard(e.x, e.y, view.you);
          if (e.archetype !== 'sort') fx.push({ type: 'ring', x: at.x, y: at.y - 6, born: now, color: e.side === view.you ? BLUE : ORANGE });
          // 👁 pose adverse : étiquette « 🏹 Tireur · Légendaire » au point d'arrivée
          if (e.side !== view.you && ROLE_TAGS[e.archetype]) {
            const rare = RARITY_TAGS[e.rarity] ? ` · ${RARITY_TAGS[e.rarity]}` : '';
            chips.push({ x: at.x, y: at.y - 34, txt: ROLE_TAGS[e.archetype] + rare, accent: true, born: now, life: 2200 });
          }
        }
        if (e.type === 'power' && typeof e.x === 'number') {
          const at = toBoard(e.x, e.y, view.you);
          fx.push({ type: 'lane', x: at.x, y: at.y, born: now, color: e.power === 'gel' ? BLUE : e.side === view.you ? PINK : ORANGE });
        }
        if (e.type === 'explosion') {
          const at = toBoard(e.x, e.y, view.you);
          fx.push({ type: 'ring', x: at.x, y: at.y - 8, born: now, color: ORANGE });
        }
        if (e.type === 'spell') {
          const at = toBoard(e.x, e.y, view.you);
          fx.push({ type: 'spell', x: at.x, y: at.y - 10, born: now, color: e.side === view.you ? BLUE : ORANGE });
        }
      }
      // ⚔️ Attaques en cours (u.atk = y de la cible) → flèches, obus, impacts
      for (const u of view.units || []) {
        const every = SHOT_EVERY[u.archetype];
        if (typeof u.atk !== 'number' || !every || u.frozen) continue;
        if (lastShot.has(u.id) && now - lastShot.get(u.id) < every) continue;
        lastShot.set(u.id, now);
        const s = UNIT_SCALE[u.archetype] || 0.42;
        const [dx, dy] = formationOffset(u);
        const at = toBoard(u.x, u.y, view.you);
        const tg = toBoard(typeof u.atkX === 'number' ? u.atkX : u.x, u.atk, view.you);
        const x0 = at.x + dx;
        const y0 = at.y + dy;
        const mine = u.side === view.you;
        if (u.archetype === 'tireur') fx.push({ type: 'arrow', x0: x0 + 22 * s, y0: y0 - 33 * s, x1: tg.x + dx * 0.5, y1: tg.y - 12, born: now, dur: 260, color: mine ? BLUE : ORANGE });
        else if (u.archetype === 'tank') {
          fx.push({ type: 'shell', x0: x0 + 40 * s, y0: y0 - 39 * s, x1: tg.x, y1: tg.y - 14, born: now, dur: 200 });
          fx.push({ type: 'ring', x: x0 + 40 * s, y: y0 - 39 * s, born: now, color: ORANGE });
        } else fx.push({ type: 'hit', x: (x0 + tg.x + dx) / 2, y: tg.y - 10, born: now, color: WHITE });
      }
      if (lastShot.size > 400) for (const id of [...lastShot.keys()].slice(0, 200)) lastShot.delete(id);

      // Chips de dégâts sur les tours (cumul par tour, une chip par 700 ms)
      for (const b of view.buildings || []) {
        const before = lastHp.get(b.id);
        if (before !== undefined && b.hp < before.hp) {
          before.pending += before.hp - b.hp;
        }
        const entry = before || { hp: b.hp, pending: 0, at: 0 };
        entry.hp = b.hp;
        if (entry.pending >= 1 && now - entry.at > 700) {
          const at = toBoard(b.x, b.y, view.you);
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
          return p ? { ...u, y: p.y + (u.y - p.y) * t, moving: Math.abs(u.y - p.y) > 0.001 } : u;
        }) };
      }
      fx = fx.filter((f) => now - f.born < (f.dur || (f.type === 'ring' ? 800 : f.type === 'lane' ? 900 : f.type === 'hit' ? 260 : 700)));
      chips = chips.filter((c) => now - c.born < (c.life || 900));
      live.innerHTML = (showZones ? renderZones(view) : '') + renderGhost(ghost) + renderDynamic(view, {
        arena,
        sprites,
        fx: fx.map((f) => ({ ...f, age: now - f.born })),
        chips: chips.map((c) => ({ ...c, age: now - c.born })),
        time: now,
      });
    }

    /** Affiche / masque les zones de pose (carte sélectionnée). */
    function setZones(on) { showZones = Boolean(on); }
    /** Fantôme de placement (null pour l'effacer). */
    function setGhost(g) { ghost = g; }
    const current = () => curr;

    function start() { if (!raf) raf = requestAnimationFrame(frame); }
    function stop() { if (raf) cancelAnimationFrame(raf); raf = null; }
    start();
    return { push, setArena, setZones, setGhost, current, start, stop };
  }

  return {
    W, H, LANE_X, ARENAS, COLORS: { INK, CREAM, PINK, BLUE, ORANGE, I7, I8 },
    TOWER_SYMBOLS, GRADIENT_DEF,
    toBoard, groundPaths, renderGround, renderDynamic, renderScene, createRenderer,
    pointToDeploy, pointToPower, vigieTower, renderZones, renderGhost, laneAtPoint, unitAtPoint, unmapY, planX, engineX, BRIDGE_X,
  };
}));
