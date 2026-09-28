// ═══════════════════════════════════════════════════════════
//  🎭 MODULE PERSONNAGES (Arène)
//  Un personnage SVG par carte Jeanpip, d'après la DA
//  « Personnages - 125 cartes » (Claude Design).
//
//  • Graine = URL du média : chaque Jeanpip, actuel ou futur, a
//    automatiquement SON personnage, toujours le même. Rien à stocker.
//  • L'archétype (src/game/cards.js) fixe la silhouette :
//      tank → Tank · guerrier → Mêlée · tireur → Distance
//      essaim → Essaim (×3 à 60 %) · pompe → bâtiment · sort → disque
//  • La graine choisit couvre-chef, arme, tenue, peau, emblème,
//    cape, bouclier, robe et deux accents.
//  • Le camp ne change QUE le disque au sol (currentColor).
//  • Retouche calque par calque dans data/card-overrides.json :
//      { "<url>": { "character": { "head": "couronne", "weapon": "poings",
//        "body": "#2F3733", "skin": "#FFFFFF", "accent": "#1C72F1",
//        "accent2": "#FF6229", "emblem": 0..4, "cape": true, "shield": false,
//        "robe": true, "roof": 0..2, "window": 0..2, "glyph": 0..4 } } }
//    Un calque hors de la silhouette (marteau pour un Tireur) est ignoré.
// ═══════════════════════════════════════════════════════════

const { getCardStats, getOverride, ARCHETYPES } = require('./cards');

const VIEWBOX = '-45 -85 90 95';
const TEAM_COLORS = { you: '#1C72F1', enemy: '#FF6229' };

// ─────────────────────────────────────────────
// 🎨 Palette DA (Dimsi)
// ─────────────────────────────────────────────

const INK = '#1A201D';
const WHITE = '#FFFFFF';
const CREAM = '#F3EFED';
const PINK = '#FF73C0';
const ACC = ['#FF73C0', '#1C72F1', '#FF6229', 'url(#dg)', '#FFFFFF', '#6B716E'];
const BODY = ['#1A201D', '#2F3733', '#F3EFED', '#FFFFFF', '#6B716E'];
const SKIN = ['#F3EFED', '#FFFFFF', '#E5E0DD'];
const GRADIENT_DEF = '<linearGradient id="dg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF6229"/><stop offset="1" stop-color="#FF74CC"/></linearGradient>';

// archétype du moteur → silhouette de la DA
const SILHOUETTE = { tank: 'tank', guerrier: 'melee', tireur: 'distance', essaim: 'essaim', pompe: 'pompe', sort: 'sort' };

// ─────────────────────────────────────────────
// ✏️ Primitives de tracé
// ─────────────────────────────────────────────

const C = (x, y, r) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
const R = (x, y, w, h, r) => `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
const P = (d, fill, sw = 1.8) => ({ d, fill, sw });

function emblem(k, x, y, f) {
  return {
    d: [
      C(x, y, 3.5),
      R(x - 3.5, y - 3.5, 7, 7, 1.5),
      `M${x - 4} ${y + 4}L${x - 4} ${y - 4}A8 8 0 0 1 ${x + 4} ${y + 4}Z`,
      `M${x - 4.5} ${y + 2}A4.5 4.5 0 0 1 ${x + 4.5} ${y + 2}Z`,
      `M${x} ${y - 5}Q${x} ${y} ${x + 5} ${y}Q${x} ${y} ${x} ${y + 5}Q${x} ${y} ${x - 5} ${y}Q${x} ${y} ${x} ${y - 5}Z`,
    ][k],
    fill: f,
    sw: 1.2,
  };
}

const HEAD = {
  casque: (a) => [P('M-12 -45A12 12 0 0 1 12 -45Z', a)],
  plumet: (a, b) => [P('M-2 -57Q4 -72 16 -66Q8 -64 3 -56Z', b), P('M-12 -45A12 12 0 0 1 12 -45Z', a)],
  bandeau: (a) => [P('M11 -51L19 -45L20 -52Z', a), P(R(-12, -53, 24, 5, 2.5), a)],
  cornes: (a) => [P('M-10 -52Q-22 -55 -18 -68Q-15 -58 -6 -56Z', WHITE), P('M10 -52Q22 -55 18 -68Q15 -58 6 -56Z', WHITE), P('M-12 -45A12 12 0 0 1 12 -45Z', a)],
  cheveux: (a) => [P('M-12 -45Q-13 -60 0 -59Q13 -60 12 -45Q7 -53 0 -52Q-7 -53 -12 -45Z', a)],
  beret: (a, b) => [P('M-12 -51Q-10 -62 2 -61Q15 -60 13 -51Q0 -54 -12 -51Z', a), P(C(3, -62, 2.5), b)],
  capuche: (a) => [P('M-15 -36Q-17 -64 0 -64Q17 -64 15 -36Q12 -54 0 -54Q-12 -54 -15 -36Z', a)],
  pointu: (a, b) => [P('M-10 -52L3 -80L10 -53Z', a), P('M-17 -51Q0 -57 17 -51Q0 -46 -17 -51Z', a), P(R(-8, -56, 16, 3, 1.5), b, 1.2)],
  couronne: (a) => [P('M-9 -55L-9 -64L-4.5 -59L0 -66L4.5 -59L9 -64L9 -55Z', a)],
  lourd: (a) => [P('M-13 -43A13 13 0 0 1 13 -43L13 -36Q0 -32 -13 -36Z', a), P(R(-8, -45, 16, 3, 1.5), INK, 1)],
};

const WEAP = {
  epee: (a) => [P('M16 -26L28 -58L32 -57L20 -25Z', WHITE), P('M11 -24L24 -30L25 -27L12 -21Z', a), P(C(16, -21, 3), INK)],
  hache: () => [P('M15 -16L27 -56L30 -55L18 -15Z', INK), P('M24 -54Q42 -57 37 -38Q31 -46 22 -44Z', WHITE)],
  lance: (a) => [P('M14 -10L30 -66L33 -65L17 -9Z', INK), P('M29 -63L37 -80L37 -61Z', WHITE), P('M31 -58L43 -54L32 -52Z', a)],
  dagues: (a) => [P('M16 -22L22 -40L25 -39L19 -21Z', WHITE), P('M-16 -22L-22 -40L-25 -39L-19 -21Z', WHITE), P(C(17, -21, 2.5), a), P(C(-17, -21, 2.5), a)],
  arc: (a) => [P('M21 -54L21 -10', 'none', 1.2), P('M20 -56Q40 -32 20 -8Q32 -32 20 -56Z', a), P('M6 -33L30 -33L30 -31L6 -31Z', WHITE, 1.2)],
  baton: (a) => [P('M18 -6L22 -58L25 -58L21 -6Z', INK), P(C(23.5, -63, 6), a), P(C(22, -65, 2), WHITE, 0)],
  arbalete: (a) => [P('M28 -42Q37 -27 28 -12L30 -12Q40 -27 30 -42Z', INK), P(R(10, -30, 24, 6, 3), INK), P('M33 -29L40 -27L33 -25Z', a)],
  grimoire: (a) => [P(R(12, -34, 16, 19, 2), a), P('M16 -30L24 -30', 'none', 1.4), P(C(20, -40, 2.5), PINK, 1)],
  marteau: (a) => [P('M16 -14L24 -56L28 -55L20 -13Z', INK), P(R(12, -68, 26, 15, 3), WHITE), P(R(23, -68, 5, 15, 1.5), a)],
  masse: (a) => [P('M16 -14L24 -52L28 -51L20 -13Z', INK), P(C(27, -58, 10), WHITE), P(C(27, -58, 4), a)],
  espadon: (a) => [P('M16 -22L26 -74L32 -73L22 -21Z', WHITE), P('M8 -24L28 -29L29 -25L9 -20Z', a)],
  poings: (a) => [P(C(19, -22, 7), a), P(C(-19, -22, 7), a)],
};

const POOLS = {
  melee: { head: ['casque', 'plumet', 'bandeau', 'cornes', 'cheveux', 'beret'], weap: ['epee', 'hache', 'lance', 'dagues'] },
  distance: { head: ['capuche', 'pointu', 'cheveux', 'bandeau', 'couronne', 'beret'], weap: ['arc', 'baton', 'arbalete', 'grimoire'] },
  tank: { head: ['lourd', 'cornes', 'plumet', 'couronne', 'casque'], weap: ['marteau', 'masse', 'espadon', 'poings'] },
  essaim: { head: ['casque', 'bandeau', 'cheveux', 'cornes', 'capuche'], weap: ['dagues', 'lance', 'epee'] },
};

const LABELS = {
  head: { casque: 'casque', plumet: 'casque à plumet', bandeau: 'bandeau', cornes: 'cornes', cheveux: 'cheveux', beret: 'béret', capuche: 'capuche', pointu: 'chapeau pointu', couronne: 'couronne', lourd: 'casque lourd' },
  weapon: { epee: 'épée', hache: 'hache', lance: 'lance', dagues: 'dagues', arc: 'arc', baton: 'bâton', arbalete: 'arbalète', grimoire: 'grimoire', marteau: 'marteau', masse: 'masse', espadon: 'espadon', poings: 'poings' },
};

// ─────────────────────────────────────────────
// 🎲 Graine (FNV-1a) + aléa (mulberry32), comme la DA
// ─────────────────────────────────────────────

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length)];
function other(r, list, not) {
  let v;
  do { v = pick(r, list); } while (v === not);
  return v;
}

// ─────────────────────────────────────────────
// 🧮 Choix des calques (graine), puis surcharges manuelles
// ─────────────────────────────────────────────

function rollLayers(silhouette, r) {
  if (silhouette === 'pompe') {
    const accent = pick(r, ACC);
    return { accent, accent2: other(r, ACC, accent), body: pick(r, BODY), roof: Math.floor(r() * 3), window: Math.floor(r() * 3) };
  }
  if (silhouette === 'sort') {
    return { accent: pick(r, ACC.filter((c) => c !== PINK)), glyph: Math.floor(r() * 5) };
  }
  const pool = POOLS[silhouette];
  const tank = silhouette === 'tank';
  const accent = pick(r, ACC);
  const accent2 = other(r, ACC, accent);
  const body = pick(r, BODY);
  const skin = pick(r, SKIN);
  const robe = silhouette === 'distance' && r() < 0.55;
  const cape = !tank && r() < 0.4;
  const emblemKey = Math.floor(r() * 5);
  const shield = tank ? r() < 0.6 : silhouette === 'melee' && r() < 0.5;
  const weapon = pick(r, pool.weap);
  const head = pick(r, pool.head);
  return { accent, accent2, body, skin, robe, cape, emblem: emblemKey, shield, weapon, head };
}

const isColor = (v) => typeof v === 'string' && /^(#[0-9a-f]{3,8}|url\(#dg\))$/i.test(v);
const isIndex = (v, n) => Number.isInteger(v) && v >= 0 && v < n;

function applyOverrides(silhouette, layers, custom) {
  if (!custom || typeof custom !== 'object') return layers;
  const out = { ...layers };
  const pool = POOLS[silhouette];
  const valid = {
    accent: isColor, accent2: isColor, body: isColor, skin: isColor,
    head: (v) => pool && pool.head.includes(v),
    weapon: (v) => pool && pool.weap.includes(v),
    emblem: (v) => isIndex(v, 5),
    roof: (v) => isIndex(v, 3),
    window: (v) => isIndex(v, 3),
    glyph: (v) => isIndex(v, 5),
    cape: (v) => typeof v === 'boolean' && silhouette !== 'tank',
    shield: (v) => typeof v === 'boolean' && silhouette !== 'distance',
    robe: (v) => typeof v === 'boolean' && silhouette === 'distance',
  };
  for (const [key, value] of Object.entries(custom)) {
    if (key in out && valid[key] && valid[key](value)) out[key] = value;
  }
  if (out.accent === out.accent2) out.accent2 = ACC.find((c) => c !== out.accent);
  return out;
}

// ─────────────────────────────────────────────
// 🧱 Assemblage des calques en tracés
// ─────────────────────────────────────────────

function buildFighter(silhouette, L) {
  const light = L.body === CREAM || L.body === WHITE;
  const tank = silhouette === 'tank';
  const tag = (layer, ...ps) => ps.map((p) => ({ ...p, layer }));
  const parts = tag('ground', P('M-20 2A20 7 0 1 0 20 2A20 7 0 1 0 -20 2Z', 'currentColor', 0));
  if (L.cape) parts.push(...tag('back', P('M-12 -34L-19 -3Q0 3 19 -3L12 -34Z', L.accent2)));
  if (!L.robe) parts.push(...tag('legs', P(R(-9, -15, 7, 15, 3), INK), P(R(2, -15, 7, 15, 3), INK)));
  const front = parts.length;
  if (tank) parts.push(P('M-19 -13L-17 -37Q0 -43 17 -37L19 -13Q0 -8 -19 -13Z', L.body));
  else if (L.robe) parts.push(P('M-15 -1L-10 -34Q0 -38 10 -34L15 -1Q0 3 -15 -1Z', L.body));
  else parts.push(P('M-13 -13L-11 -34Q0 -39 11 -34L13 -13Q0 -9 -13 -13Z', L.body));
  parts.push(P(R(tank ? -17 : -12.5, -22, tank ? 34 : 25, 4, 2), light ? INK : L.accent2, 1.2));
  parts.push(emblem(L.emblem, 0, -29, L.accent));
  if (tank) parts.push(P(C(-17, -35, 7), L.accent), P(C(17, -35, 7), L.accent));
  if (L.shield && L.weapon !== 'dagues' && L.weapon !== 'poings') {
    if (tank) parts.push(P('M-31 -40L-13 -40L-13 -20Q-13 -8 -22 -4Q-31 -8 -31 -20Z', L.accent2), emblem(L.emblem, -22, -24, WHITE));
    else parts.push(P(C(-18, -25, 8), L.accent2), P(C(-18, -25, 3), WHITE, 1.2));
  }
  parts.push(P(C(0, -46, 11), L.skin), P(C(-4, -43, 1.7), INK, 0), P(C(4, -43, 1.7), INK, 0));
  parts.push(...HEAD[L.head](L.accent, L.accent2));
  parts.push(...WEAP[L.weapon](L.accent, L.accent2));
  for (let i = front; i < parts.length; i += 1) parts[i] = { ...parts[i], layer: 'front' };
  return parts;
}

function buildPompe(L) {
  return [
    P('M-22 2A22 7 0 1 0 22 2A22 7 0 1 0 -22 2Z', 'currentColor', 0),
    P(R(9, -54, 7, 22, 2), INK),
    P(R(-17, -28, 34, 28, 6), L.body),
    P(['M-20 -27L0 -45L20 -27Z', 'M-19 -27A19 19 0 0 1 19 -27Z', R(-20, -34, 40, 8, 4)][L.roof], L.accent),
    P([C(0, -14, 6), R(-6, -20, 12, 12, 3), 'M-7 -8L-7 -16A7 7 0 0 1 7 -16L7 -8Z'][L.window], WHITE),
    P('M12.5 -68Q17 -61 12.5 -57Q8 -61 12.5 -68Z', PINK, 1.2),
    P(R(-17, -6, 34, 4, 2), L.accent2, 1.2),
  ];
}

function buildSort(L) {
  const glyph = [
    'M2 -46L-9 -26L0 -26L-5 -8L10 -32L1 -32Z',
    'M0 -46Q0 -28 18 -28Q0 -28 0 -10Q0 -28 -18 -28Q0 -28 0 -46Z',
    C(0, -28, 9),
    'M0 -8Q-14 -18 -8 -34Q-4 -26 0 -28Q-2 -40 6 -48Q4 -34 12 -26Q14 -14 0 -8Z',
    R(-9, -37, 18, 18, 4),
  ][L.glyph];
  return [P(C(0, -28, 24), PINK), P(C(0, -28, 24), 'none', 3.5), P(glyph, L.accent)];
}

// ─────────────────────────────────────────────
// 🎭 Personnage d'une carte
//    card = { url, title, rarity } (média ou entrée de collection)
// ─────────────────────────────────────────────

function describeCharacter(card) {
  const { archetype } = getCardStats(card);
  const silhouette = SILHOUETTE[archetype];
  const override = getOverride(card.url);
  const layers = applyOverrides(silhouette, rollLayers(silhouette, rng(hash(String(card.url)))), override && override.character);
  const kind = silhouette === 'pompe' || silhouette === 'sort' ? silhouette : 'fighter';
  const parts = kind === 'pompe' ? buildPompe(layers) : kind === 'sort' ? buildSort(layers) : buildFighter(silhouette, layers);
  // Marche : pas visibles (jambes), sauf Tank (marche lourde, pas de pas
  // visible, DA) et robe longue (glisse) ; bâtiments et sorts immobiles.
  let walk = 'none';
  if (kind === 'fighter') walk = silhouette === 'tank' || layers.robe ? 'sway' : 'step';
  return { archetype, silhouette, kind, swarm: silhouette === 'essaim', walk, layers, parts };
}

// ─────────────────────────────────────────────
// 🖼️ Rendus SVG
// ─────────────────────────────────────────────

const pathTag = (p) => `<path d="${p.d}" fill="${p.fill}" stroke="${INK}" stroke-width="${p.sw}" stroke-linejoin="round" stroke-linecap="round"/>`;

/** <symbol> réutilisable via <use href="#id">, à poser dans un <defs> avec GRADIENT_DEF. */
function renderSymbol(card, id) {
  const { parts } = describeCharacter(card);
  return `<symbol id="${id}" viewBox="${VIEWBOX}" overflow="visible">${parts.map(pathTag).join('')}</symbol>`;
}

/**
 * Jeu de symboles pour l'animation de marche sur le terrain :
 *   <id>    personnage complet (cartes, galerie)
 *   <id>-b  dos (cape) · <id>-f  avant (corps, tête, arme) — marche « step »
 *   <id>-f  tout sauf le sol — marche « sway » (Tank, robe longue)
 * Le sol et les jambes sont dessinés par le terrain (public/arena-board.js).
 * → { svg, sprite: { id, walk } }
 */
function renderSpriteSet(card, id) {
  const c = describeCharacter(card);
  const sym = (sid, parts) => `<symbol id="${sid}" viewBox="${VIEWBOX}" overflow="visible">${parts.map(pathTag).join('')}</symbol>`;
  let svg = sym(id, c.parts);
  if (c.walk === 'step') {
    svg += sym(`${id}-b`, c.parts.filter((p) => p.layer === 'back'));
    svg += sym(`${id}-f`, c.parts.filter((p) => p.layer === 'front'));
  } else if (c.walk === 'sway') {
    svg += sym(`${id}-f`, c.parts.filter((p) => p.layer !== 'ground'));   // tout sauf le sol
  }
  return { svg, sprite: { id, walk: c.walk } };
}

/** Les <use> d'un personnage (essaim = 3 exemplaires à 60 %), comme dans la DA. */
function renderUse(card, id, teamColor = TEAM_COLORS.you) {
  const { silhouette } = describeCharacter(card);
  const use = (tf) => `<use href="#${id}" x="-45" y="-85" width="90" height="95" transform="${tf}" style="color:${teamColor}"/>`;
  if (silhouette === 'essaim') return [use('translate(0 -20) scale(.62)'), use('translate(-17 0) scale(.62)'), use('translate(17 0) scale(.62)')].join('');
  return use(silhouette === 'tank' ? 'translate(0 4) scale(1.08)' : 'translate(0 4) scale(.9)');
}

/** SVG autonome d'un personnage. team : 'you' (bleu) | 'enemy' (orange). */
function renderSvg(card, { team = 'you', width = 90, height = 95 } = {}) {
  const color = TEAM_COLORS[team] || TEAM_COLORS.you;
  const id = `ch${hash(String(card.url)).toString(36)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${VIEWBOX}" overflow="visible">`
    + `<defs>${GRADIENT_DEF}${renderSymbol(card, id)}</defs>${renderUse(card, id, color)}</svg>`;
}

/** Description courte (Slack ne sait pas afficher du SVG). */
function describeText(card) {
  const c = describeCharacter(card);
  const arch = ARCHETYPES[c.archetype];
  const head = `${arch.emoji} *${arch.label}*`;
  if (c.kind === 'pompe') return `${head} · bâtiment`;
  if (c.kind === 'sort') return `${head} · disque de sort`;
  const bits = [LABELS.head[c.layers.head], LABELS.weapon[c.layers.weapon]];
  if (c.layers.shield && c.layers.weapon !== 'dagues' && c.layers.weapon !== 'poings') bits.push('bouclier');
  if (c.layers.cape) bits.push('cape');
  if (c.layers.robe) bits.push('robe longue');
  return `${head}${c.swarm ? ' ×3' : ''} · ${bits.join(', ')}`;
}

module.exports = {
  VIEWBOX,
  TEAM_COLORS,
  GRADIENT_DEF,
  POOLS,
  describeCharacter,
  renderSymbol,
  renderSpriteSet,
  renderUse,
  renderSvg,
  describeText,
};
