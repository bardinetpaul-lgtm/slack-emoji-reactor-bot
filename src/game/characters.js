// ═══════════════════════════════════════════════════════════
//  🎭 MODULE PERSONNAGES (Arène)
//  Un personnage SVG par carte Jeanpip : une DA GLOBALE par rôle,
//  habillée par le CONTENU de la carte (src/game/looks.js).
//
//  DA par rôle (règles en vigueur) :
//    ⚔️ Guerrier : fantassin en tunique, épaulières de métal, arme de
//                  mêlée (frappe au contact), bouclier parfois
//    🏹 Tireur   : archer, cape + carquois de flèches, TOUJOURS un arc
//    🐝 Essaim   : mini-personnages AILÉS qui volent (ombre au sol)
//    🛡 Tank     : un vrai CHAR à chenilles, le personnage sort de la
//                  tourelle ; les chenilles roulent
//    ⚗️ Pompe    : bâtiment · 💥 Sort : disque
//  Ce que la carte apporte (look) : couvre-chef, coupe de cheveux,
//  lunettes, moustache / barbe, accessoires (pipe, chaîne, cravate…),
//  couleurs (peau, cheveux, couvre-chef, tenue ×2, accent), arme.
//
//  • Le camp ne change QUE le disque au sol (currentColor).
//  • Retouche à la main dans data/card-overrides.json :
//      { "<url>": { "character": { "head": "couronne", "hairStyle": "bol",
//        "glasses": "soleil", "facial": "guidon", "accessories": ["pipe"],
//        "weapon": "hache", "outfit": "#1C72F1", "accent": "#FF6229", … } } }
//    Une valeur hors vocabulaire est ignorée.
// ═══════════════════════════════════════════════════════════

const { getCardStats, getOverride, ARCHETYPES } = require('./cards');
const looks = require('./looks');
const { VOCAB } = require('./lookAnalyzer');

const VIEWBOX = '-45 -85 90 95';
const TEAM_COLORS = { you: '#1C72F1', enemy: '#FF6229' };

// ─────────────────────────────────────────────
// 🎨 Palette DA (Dimsi) + réglage des couleurs de la photo
// ─────────────────────────────────────────────

const INK = '#1A201D';
const WHITE = '#FFFFFF';
const PINK = '#FF73C0';
const METAL = '#D9DCDA';
const WOOD = '#8A5A2B';
const GOLD = '#FFC83D';
const WING = 'rgba(255,255,255,0.85)';
const GRADIENT_DEF = '<linearGradient id="dg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF6229"/><stop offset="1" stop-color="#FF74CC"/></linearGradient>';

// 🗼 Vigie (v2.3) : silhouette d'archer (dessinée sur sa tour par le plateau)
const SILHOUETTE = { tank: 'tank', guerrier: 'melee', tireur: 'distance', essaim: 'essaim', vigie: 'distance', pompe: 'pompe', sort: 'sort' };
const WALK = { tank: 'roll', melee: 'step', distance: 'step', essaim: 'fly', pompe: 'none', sort: 'none' };

function hexToHsl(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex([h, s, l]) {
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/** Couleur de la photo ramenée dans le style DA (lisible, ni terne ni criarde). */
function tune(hex, { lMin = 0.14, lMax = 0.85, sMin = 0, sMax = 0.85 } = {}, fallback = '#6B716E') {
  if (!isHex(hex)) return fallback;
  const [h, s, l] = hexToHsl(hex);
  const sat = s < 0.06 ? s : Math.min(sMax, Math.max(sMin, s));   // un gris reste gris
  return hslToHex([h, sat, Math.min(lMax, Math.max(lMin, l))]);
}
const shade = (hex, dl) => { const [h, s, l] = hexToHsl(hex); return hslToHex([h, s, Math.min(0.95, Math.max(0.05, l + dl))]); };
const far = (a, b) => { const x = hexToHsl(a); const y = hexToHsl(b); return Math.abs(x[2] - y[2]) > 0.12 || Math.min(Math.abs(x[0] - y[0]), 360 - Math.abs(x[0] - y[0])) > 40; };

/** Palette du personnage à partir du look de la carte. */
function paletteOf(look) {
  const outfit = tune(look.outfit, { lMin: 0.14, lMax: 0.78 });
  let outfit2 = tune(look.outfit2, { lMin: 0.18, lMax: 0.9 });
  if (!far(outfit, outfit2)) outfit2 = shade(outfit, hexToHsl(outfit)[2] > 0.5 ? -0.3 : 0.35);
  let accent = tune(look.accent, { lMin: 0.4, lMax: 0.7, sMin: 0.5 }, PINK);
  if (!far(accent, outfit)) accent = hexToHsl(outfit)[2] > 0.5 ? INK : GOLD;
  return {
    skin: tune(look.skin, { lMin: 0.55, lMax: 0.88, sMax: 0.6 }, '#E8B89A'),
    hair: tune(look.hair, { lMin: 0.1, lMax: 0.9 }, '#3B2A1E'),
    hat: tune(look.hatColor, { lMin: 0.14, lMax: 0.88 }, outfit),
    outfit,
    outfit2,
    accent,
  };
}

// ─────────────────────────────────────────────
// ✏️ Primitives de tracé
// ─────────────────────────────────────────────

const C = (x, y, r) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
const E = (x, y, rx, ry) => `M${x - rx} ${y}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
const R = (x, y, w, h, r) => `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
const P = (d, fill, sw = 1.8, extra = {}) => ({ d, fill, sw, ...extra });

function emblem(k, x, y, f) {
  return P([
    C(x, y, 3),
    R(x - 3, y - 3, 6, 6, 1.4),
    `M${x - 3.5} ${y + 3.5}L${x - 3.5} ${y - 3.5}A7 7 0 0 1 ${x + 3.5} ${y + 3.5}Z`,
    `M${x - 4} ${y + 2}A4 4 0 0 1 ${x + 4} ${y + 2}Z`,
    `M${x} ${y - 4.5}Q${x} ${y} ${x + 4.5} ${y}Q${x} ${y} ${x} ${y + 4.5}Q${x} ${y} ${x - 4.5} ${y}Q${x} ${y} ${x} ${y - 4.5}Z`,
  ][k % 5], f, 1.1);
}

// ─────────────────────────────────────────────
// 🙂 Tête (repère local : visage de rayon 11 centré en 0,0)
//    → tracés placés en (cx, cy) à l'échelle k
// ─────────────────────────────────────────────

const HAIR_BACK = {
  long: 'M-12 -2Q-14 -15 0 -15Q14 -15 12 -2L13 13Q9 16 6 11L6 0Q0 -5 -6 0L-6 11Q-9 16 -13 13Z',
  queue: 'M8 -8Q19 -6 17 7Q13 1 9 -2Z',
};
const HAIR_TOP = {
  court: 'M-11 -1Q-12 -13 0 -13Q12 -13 11 -1Q7 -8 0 -7Q-7 -8 -11 -1Z',
  long: 'M-11 -1Q-12 -13 0 -13Q12 -13 11 -1Q7 -8 0 -7Q-7 -8 -11 -1Z',
  queue: 'M-11 -1Q-12 -13 0 -13Q12 -13 11 -1Q7 -8 0 -7Q-7 -8 -11 -1Z',
  bol: 'M-13 1Q-14 -15 0 -15Q14 -15 13 1Q6 -2 0 -1Q-6 -2 -13 1Z',
  crete: 'M-4 -9L-3 -21L0 -15L1.5 -23L3.5 -14L5.5 -20L5 -9Z',
  boucles: [C(-8, -8, 4), C(-3, -11, 4.5), C(3, -11, 4.5), C(8, -8, 4), C(-11, -2, 3.2), C(11, -2, 3.2)],
  meches: 'M-11 -1Q-12 -13 0 -13Q12 -13 11 -1L8 -5L5 1L2 -5L-2 1L-5 -5L-8 0Z',
  chauve: null,
};
const FACIAL = {
  moustache: 'M-7 8.5Q-4 5.5 0 7.5Q4 5.5 7 8.5Q4 10 0 8.8Q-4 10 -7 8.5Z',
  guidon: 'M-9 5Q-9 9 -5 7.5Q-2 5.5 0 7.3Q2 5.5 5 7.5Q9 9 9 5Q10 10.5 5 9.6Q2 9 0 8.8Q-2 9 -5 9.6Q-10 10.5 -9 5Z',
  barbe: 'M-10.5 2Q-11 15 0 16Q11 15 10.5 2Q8 9 0 9.5Q-8 9 -10.5 2Z',
  bouc: 'M-3 10Q0 16.5 3 10Q0 11.5 -3 10Z',
};

function headParts(look, pal, { cx = 0, cy = -46, k = 1, emblemKey = 0 } = {}) {
  const tf = `translate(${cx} ${cy}) scale(${k})`;
  const sw = (v) => +(v / k).toFixed(2);   // trait constant quelle que soit l'échelle
  const H = (d, fill, w = 1.8, extra = {}) => P(d, fill, sw(w), { tf, ...extra });
  const out = [];
  const hat = look.head;
  const hairDark = hexToHsl(pal.hair)[2] > 0.75 ? shade(pal.hair, -0.25) : pal.hair;

  // derrière le visage
  if (HAIR_BACK[look.hairStyle]) out.push(H(HAIR_BACK[look.hairStyle], pal.hair));
  if (look.accessories.includes('casque_audio')) out.push(H('M-13.5 1Q-15 -18 0 -18Q15 -18 13.5 1', 'none', 2.6));
  // visage
  out.push(H(C(0, 0, 11), pal.skin));
  out.push(H(C(-4, 3, 1.6), INK, 0), H(C(4, 3, 1.6), INK, 0));
  // cheveux (sous le couvre-chef)
  const top = HAIR_TOP[look.hairStyle];
  if (top) for (const d of [].concat(top)) out.push(H(d, pal.hair, 1.5));
  // lunettes
  if (look.glasses === 'soleil') {
    out.push(H(R(-10.5, 0, 9.5, 6, 2.5), INK, 1.2), H(R(1, 0, 9.5, 6, 2.5), INK, 1.2), H(R(-1.5, 1.5, 3, 1.4, 0.6), INK, 0), H(R(-9, 1, 3, 1.4, 0.6), WHITE, 0));
  } else if (look.glasses === 'lunettes') {
    out.push(H(C(-4.5, 3, 3.6), 'rgba(255,255,255,0.35)', 1.3), H(C(4.5, 3, 3.6), 'rgba(255,255,255,0.35)', 1.3), H('M-1 2.5Q0 1.5 1 2.5', 'none', 1.1));
  }
  // pilosité / bouche
  if (look.facial === 'barbe') out.push(H(FACIAL.barbe, hairDark, 1.4), H(FACIAL.moustache, hairDark, 1.2));
  else if (look.facial === 'bouc') out.push(H(FACIAL.bouc, hairDark, 1.2), H(FACIAL.moustache, hairDark, 1.2));
  else if (FACIAL[look.facial]) out.push(H(FACIAL[look.facial], hairDark, 1.2));
  else out.push(H('M-3 8.5Q0 10.5 3 8.5', 'none', 1.1));
  // accessoires du visage
  if (look.accessories.includes('pipe')) out.push(H('M3 9L10.5 10.2L10.5 11.8L3 10.6Z', INK, 1), H(R(9.5, 5.5, 5.5, 7, 1.6), WOOD, 1.2));
  if (look.accessories.includes('cigare')) out.push(H(R(3, 8.4, 10, 2.8, 1.3), WOOD, 1), H(C(13.6, 9.8, 1.4), '#FF6229', 0.8));
  if (look.accessories.includes('boucle_oreille')) out.push(H(C(-11.6, 6.5, 1.7), GOLD, 1));
  if (look.accessories.includes('casque_audio')) out.push(H(R(-15.5, -2, 5, 8.5, 2), pal.accent, 1.3), H(R(10.5, -2, 5, 8.5, 2), pal.accent, 1.3));
  // couvre-chef
  const HC = pal.hat;
  const A = pal.accent;
  switch (hat) {
    case 'casquette': out.push(H('M-11.5 -2Q-12 -14 0 -14Q12 -14 11.5 -2Z', HC), H('M6 -3.5L19 -2.5Q19 0 6 -0.5Z', shade(HC, -0.12)), H(C(0, -14, 1.4), A, 1)); break;
    case 'bonnet': out.push(H('M-11.5 -1Q-12.5 -17 0 -17Q12.5 -17 11.5 -1Z', HC), H(R(-12.5, -4, 25, 5, 2.5), pal.outfit2, 1.4), H(C(0, -18, 3.5), A)); break;
    case 'chapeau': out.push(H(R(-8, -19, 16, 14, 3), HC), H('M-17 -4Q0 -10 17 -4Q0 1 -17 -4Z', HC), H(R(-8, -9, 16, 3, 1.5), A, 1.2)); break;
    case 'couronne': out.push(H('M-9 -9L-9 -18L-4.5 -13L0 -20L4.5 -13L9 -18L9 -9Z', hexToHsl(HC)[1] > 0.25 ? HC : GOLD), H(C(0, -12.5, 1.6), A, 1)); break;
    case 'casque': out.push(H('M-12.5 1A12.5 12.5 0 0 1 12.5 1Z', HC), H(R(-12.5, -3, 25, 3.5, 1.7), A, 1.2), emblem(emblemKey, 0, -8, A)); out[out.length - 1].tf = tf; break;
    case 'capuche': out.push(H('M-15 12Q-18 -19 0 -19Q18 -19 15 12Q12 -8 0 -8Q-12 -8 -15 12Z', HC)); break;
    case 'bandeau': out.push(H(R(-12, -8, 24, 4.5, 2), HC, 1.4), H('M10 -7L17 -2L18 -8Z', HC, 1.4)); break;
    case 'cornes': out.push(H('M-8 -9Q-18 -12 -15 -22Q-12 -14 -4 -12Z', WHITE), H('M8 -9Q18 -12 15 -22Q12 -14 4 -12Z', WHITE)); break;
    case 'pointu': out.push(H('M-9 -7L2 -33L9 -8Z', HC), H('M-15 -7Q0 -12 15 -7Q0 -3 -15 -7Z', HC), H(C(3, -21, 1.8), A, 1)); break;
    case 'beret': out.push(H('M-12 -5Q-10 -16 2 -15Q15 -14 13 -5Q0 -8 -12 -5Z', HC), H(C(3, -16, 2), A, 1.2)); break;
    case 'oreilles': out.push(H('M-10 -6L-13 -21L-3 -11Z', HC), H('M10 -6L13 -21L3 -11Z', HC), H('M-9.5 -9L-11.5 -17L-5.5 -11Z', A, 1), H('M9.5 -9L11.5 -17L5.5 -11Z', A, 1)); break;
    case 'aureole': out.push(H(E(0, -19, 9, 3), GOLD, 1.4), H(E(0, -19, 5.5, 1.5), 'none', 1)); break;
    default: break;
  }
  return out;
}

/** Accessoires portés au cou / sur le torse (repère du corps : cou en 0,-35). */
function neckParts(look, pal) {
  const out = [];
  const has = (a) => look.accessories.includes(a);
  if (has('echarpe')) out.push(P(R(-9, -37.5, 18, 5, 2.5), pal.accent, 1.4), P(R(3, -35, 4.5, 11, 2), pal.accent, 1.4));
  if (has('cravate')) out.push(P('M-1.6 -34L1.6 -34L2.6 -22L0 -18L-2.6 -22Z', pal.accent, 1.2));
  if (has('noeud_papillon')) out.push(P('M0 -33L-5.5 -36L-5.5 -30Z', pal.accent, 1.2), P('M0 -33L5.5 -36L5.5 -30Z', pal.accent, 1.2), P(C(0, -33, 1.4), pal.accent, 1));
  if (has('chaine')) out.push(P('M-6.5 -34.5Q0 -23 6.5 -34.5', 'none', 2.4, { st: GOLD }), P(C(0, -25.5, 2), GOLD, 1));
  if (has('medaille')) out.push(P('M-2 -34.5L0 -29L2 -34.5', 'none', 1.2), P(C(0, -26.5, 2.6), GOLD, 1.2));
  return out;
}

// ─────────────────────────────────────────────
// 🗡️ Armes de mêlée (main droite en 16,-22 : pivot de la frappe)
// ─────────────────────────────────────────────

const WEAP = {
  epee: (a) => [P('M16 -26L28 -58L32 -57L20 -25Z', WHITE), P('M11 -24L24 -30L25 -27L12 -21Z', a), P(C(16, -21, 3), INK)],
  hache: (a) => [P('M15 -16L27 -56L30 -55L18 -15Z', WOOD), P('M24 -54Q42 -57 37 -38Q31 -46 22 -44Z', WHITE), P(C(17, -21, 2.6), a, 1.2)],
  lance: (a) => [P('M14 -10L30 -66L33 -65L17 -9Z', WOOD), P('M29 -63L37 -80L37 -61Z', WHITE), P('M31 -58L43 -54L32 -52Z', a)],
  dagues: (a) => [P('M16 -22L22 -40L25 -39L19 -21Z', WHITE), P(C(17, -21, 2.5), a)],
  masse: (a) => [P('M16 -14L24 -50L28 -49L20 -13Z', WOOD), P(C(27, -55, 8.5), METAL), P(C(27, -55, 3.2), a, 1.2)],
  marteau: (a) => [P('M16 -14L24 -52L28 -51L20 -13Z', WOOD), P(R(12, -64, 26, 13, 3), METAL), P(R(23, -64, 5, 13, 1.5), a, 1.2)],
  poings: (a) => [P(C(19, -22, 6.5), a)],
};

// ─────────────────────────────────────────────
// 🧱 Assemblage par rôle
// ─────────────────────────────────────────────

const tag = (layer, parts) => parts.map((p) => ({ ...p, layer }));
const GROUND = (rx) => P(E(0, 2, rx, rx * 0.35), 'currentColor', 0);

function buildMelee(look, pal, x) {
  const parts = tag('ground', [GROUND(20)]);
  if (x.cape) parts.push(...tag('back', [P('M-12 -34L-19 -3Q0 3 19 -3L12 -34Z', pal.outfit2)]));
  parts.push(...tag('legs', [P(R(-9, -15, 7, 15, 3), INK), P(R(2, -15, 7, 15, 3), INK)]));
  const front = [
    P('M-13 -13L-11 -34Q0 -39 11 -34L13 -13Q0 -9 -13 -13Z', pal.outfit),
    P(R(-12.5, -19.5, 25, 4, 2), INK, 1.2),
    P(R(-2.2, -20, 4.4, 5, 1), pal.accent, 1),
    emblem(x.emblem, 0, -27, pal.accent),
    P(C(-12, -33, 5.5), METAL), P(C(12, -33, 5.5), METAL),   // épaulières : la marque du Guerrier
    ...neckParts(look, pal),
  ];
  if (x.shield && look.weapon !== 'dagues' && look.weapon !== 'poings') front.push(P(C(-18, -24, 8), pal.outfit2), P(C(-18, -24, 3), pal.accent, 1.2));
  if (look.weapon === 'dagues') front.push(P('M-16 -22L-22 -40L-25 -39L-19 -21Z', WHITE), P(C(-17, -21, 2.5), pal.accent));
  if (look.weapon === 'poings') front.push(P(C(-19, -22, 6.5), pal.accent));
  front.push(...headParts(look, pal, { emblemKey: x.emblem }));
  parts.push(...tag('front', front));
  parts.push(...tag('weapon', WEAP[look.weapon] ? WEAP[look.weapon](pal.accent) : WEAP.epee(pal.accent)));
  return parts;
}

function buildArcher(look, pal) {
  const parts = tag('ground', [GROUND(20)]);
  parts.push(...tag('back', [
    P('M-12 -34L-18 -4Q0 1 18 -4L12 -34Z', pal.outfit2),
    P(R(-19, -48, 7.5, 25, 3), WOOD),                                  // carquois
    P('M-16.5 -48L-17 -55', 'none', 1.2), P('M-13.5 -48L-13 -56', 'none', 1.2),
    P('M-17 -59L-20 -53L-15 -54Z', pal.accent, 1.1), P('M-13 -60L-15.5 -54L-10.5 -55Z', pal.accent, 1.1),
  ]));
  parts.push(...tag('legs', [P(R(-9, -15, 7, 15, 3), INK), P(R(2, -15, 7, 15, 3), INK)]));
  parts.push(...tag('front', [
    P('M-12 -13L-10 -34Q0 -38 10 -34L12 -13Q0 -9 -12 -13Z', pal.outfit),
    P('M-10 -33L9 -15L9 -12L-10 -30Z', WOOD, 1.2),                     // sangle du carquois
    P(R(-11.5, -19.5, 23, 4, 2), INK, 1.2),
    ...neckParts(look, pal),
    ...headParts(look, pal),
  ]));
  parts.push(...tag('weapon', [                                          // l'arc, toujours
    P('M21 -58Q41 -33 21 -8Q33 -33 21 -58Z', WOOD),
    P('M21 -57L21 -9', 'none', 1),
    P('M9 -33L31 -33', 'none', 1.6),
    P('M31 -35.5L37 -33L31 -30.5Z', WHITE, 1.2),
    P('M9 -33L6 -36.5L11.5 -35Z', pal.accent, 1),
  ]));
  return parts;
}

function buildFlyer(look, pal) {
  const parts = tag('ground', [P(E(0, 2, 11, 3.8), 'currentColor', 0)]);   // ombre au sol
  parts.push(...tag('wings', [
    P('M-4 -33Q-29 -52 -25 -29Q-17 -23 -4 -29Z', WING, 1.4),
    P('M4 -33Q29 -52 25 -29Q17 -23 4 -29Z', WING, 1.4),
    P('M-6 -31Q-16 -38 -21 -34', 'none', 0.8), P('M6 -31Q16 -38 21 -34', 'none', 0.8),
  ]));
  parts.push(...tag('front', [
    P(C(0, -22, 11), pal.outfit),
    P(R(-10.6, -25.5, 21.2, 4, 2), pal.outfit2, 1.2),
    P(R(-9, -18.5, 18, 3.6, 1.8), pal.outfit2, 1.2),
    P('M-3 -12L0 -4.5L3 -12Z', pal.accent, 1.2),                       // dard
    ...headParts(look, pal, { cx: 0, cy: -40, k: 0.82 }),
  ]));
  return parts;
}

function buildTank(look, pal, x) {
  const parts = tag('ground', [GROUND(32)]);
  const wheels = [-22, -7.5, 7.5, 22];
  parts.push(...tag('treads', [
    P(R(-32, -15, 64, 15, 7.5), INK),
    ...wheels.map((wx) => P(C(wx, -7.5, 4.5), '#6B716E', 1.4)),
    ...wheels.map((wx) => P(C(wx, -7.5, 1.5), INK, 0)),
  ]));
  const front = [
    P('M-30 -15L-25 -30L24 -30L31 -15Z', pal.outfit),
    P(R(-24, -26, 47, 3.6, 1.8), pal.accent, 1.2),
    P('M-17 -30Q-16 -45 -3 -45Q10 -45 11 -30Z', pal.outfit2),
    P(R(8, -41, 30, 6, 3), pal.outfit2, 1.6),                           // canon
    P(R(36, -42.5, 5, 9, 2), INK, 1.4),
    emblem(x.emblem, -4, -36.5, pal.accent),
  ];
  if (x.flag) front.push(P('M-15 -41L-15 -63', 'none', 1.2), P('M-15 -63L-4 -59.5L-15 -56Z', pal.accent, 1.2));
  front.push(...headParts(look, pal, { cx: -3, cy: -54, k: 0.74 }));   // le personnage sort de la tourelle
  front.push(P(R(-13, -47.5, 20, 5, 2.5), INK, 1.4));                  // bord de l'écoutille
  parts.push(...tag('front', front));
  return parts;
}

function buildPompe(pal, x) {
  return [
    P('M-22 2A22 7 0 1 0 22 2A22 7 0 1 0 -22 2Z', 'currentColor', 0),
    P(R(9, -54, 7, 22, 2), INK),
    P(R(-17, -28, 34, 28, 6), pal.outfit),
    P(['M-20 -27L0 -45L20 -27Z', 'M-19 -27A19 19 0 0 1 19 -27Z', R(-20, -34, 40, 8, 4)][x.roof], pal.accent),
    P([C(0, -14, 6), R(-6, -20, 12, 12, 3), 'M-7 -8L-7 -16A7 7 0 0 1 7 -16L7 -8Z'][x.window], WHITE),
    P('M12.5 -68Q17 -61 12.5 -57Q8 -61 12.5 -68Z', PINK, 1.2),
    P(R(-17, -6, 34, 4, 2), pal.outfit2, 1.2),
  ];
}

function buildSort(pal, x) {
  const glyph = [
    'M2 -46L-9 -26L0 -26L-5 -8L10 -32L1 -32Z',
    'M0 -46Q0 -28 18 -28Q0 -28 0 -10Q0 -28 -18 -28Q0 -28 0 -46Z',
    C(0, -28, 9),
    'M0 -8Q-14 -18 -8 -34Q-4 -26 0 -28Q-2 -40 6 -48Q4 -34 12 -26Q14 -14 0 -8Z',
    R(-9, -37, 18, 18, 4),
  ][x.glyph];
  const accent = far(pal.accent, PINK) ? pal.accent : INK;
  return [P(C(0, -28, 24), PINK), P(C(0, -28, 24), 'none', 3.5), P(glyph, accent)];
}

// ─────────────────────────────────────────────
// 🎲 Détails stables (hors photo) : cape, bouclier, emblème, drapeau…
// ─────────────────────────────────────────────

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function extrasOf(url) {
  const h = hash(String(url));
  return { cape: (h & 3) === 0, shield: ((h >>> 2) & 1) === 1, emblem: (h >>> 3) % 5, flag: ((h >>> 6) & 1) === 1, roof: (h >>> 7) % 3, window: (h >>> 9) % 3, glyph: (h >>> 11) % 5 };
}

// ✍️ Retouche à la main (data/card-overrides.json → character)
function applyOverrides(look, custom) {
  if (!custom || typeof custom !== 'object') return look;
  const out = { ...look };
  for (const key of ['head', 'hairStyle', 'glasses', 'facial', 'weapon']) if (VOCAB[key].includes(custom[key])) out[key] = custom[key];
  if (Array.isArray(custom.accessories)) out.accessories = custom.accessories.filter((a) => VOCAB.accessories.includes(a)).slice(0, 3);
  for (const key of ['skin', 'hair', 'hatColor', 'outfit', 'outfit2', 'accent']) if (isHex(custom[key])) out[key] = custom[key];
  return out;
}

// ─────────────────────────────────────────────
// 🎭 Personnage d'une carte
//    card = { url, title, rarity } (média ou entrée de collection)
// ─────────────────────────────────────────────

function describeCharacter(card) {
  const { archetype } = getCardStats(card);
  const silhouette = SILHOUETTE[archetype];
  const override = getOverride(card.url);
  const look = applyOverrides(looks.getLook(card), override && override.character);
  const pal = paletteOf(look);
  const x = extrasOf(card.url);
  const build = { melee: () => buildMelee(look, pal, x), distance: () => buildArcher(look, pal), essaim: () => buildFlyer(look, pal), tank: () => buildTank(look, pal, x), pompe: () => buildPompe(pal, x), sort: () => buildSort(pal, x) };
  const parts = build[silhouette]();
  const kind = silhouette === 'pompe' || silhouette === 'sort' ? silhouette : 'fighter';
  return { archetype, silhouette, kind, swarm: silhouette === 'essaim', walk: WALK[silhouette], layers: { ...look, ...x, palette: pal }, parts };
}

// ─────────────────────────────────────────────
// 🖼️ Rendus SVG
// ─────────────────────────────────────────────

const pathTag = (p) => `<path d="${p.d}" fill="${p.fill}" stroke="${p.st || INK}" stroke-width="${p.sw}" stroke-linejoin="round" stroke-linecap="round"${p.tf ? ` transform="${p.tf}"` : ''}/>`;
const symbol = (id, parts) => `<symbol id="${id}" viewBox="${VIEWBOX}" overflow="visible">${parts.map(pathTag).join('')}</symbol>`;

/** <symbol> réutilisable via <use href="#id">, à poser dans un <defs> avec GRADIENT_DEF. */
function renderSymbol(card, id) {
  return symbol(id, describeCharacter(card).parts);
}

/**
 * Jeu de symboles pour animer le personnage sur le terrain :
 *   <id>    personnage complet (cartes, galerie)
 *   step (Guerrier, Tireur) : <id>-b dos · <id>-f avant · <id>-w arme
 *        (jambes dessinées par le terrain ; l'arme frappe / l'arc tire)
 *   fly  (Essaim)  : <id>-f corps + tête · <id>-w ailes (battent)
 *   roll (Tank)    : <id>-f caisse + tourelle (chenilles dessinées par le terrain)
 * → { svg, sprite: { id, walk } }
 */
function renderSpriteSet(card, id) {
  const c = describeCharacter(card);
  const of = (...layers) => c.parts.filter((p) => layers.includes(p.layer));
  let svg = symbol(id, c.parts);
  if (c.walk === 'step') svg += symbol(`${id}-b`, of('back')) + symbol(`${id}-f`, of('front')) + symbol(`${id}-w`, of('weapon'));
  else if (c.walk === 'fly') svg += symbol(`${id}-f`, of('front')) + symbol(`${id}-w`, of('wings'));
  else if (c.walk === 'roll') svg += symbol(`${id}-f`, of('front'));
  return { svg, sprite: { id, walk: c.walk } };
}

/** Les <use> d'un personnage (essaim = 3 exemplaires à 60 %), comme dans la DA. */
function renderUse(card, id, teamColor = TEAM_COLORS.you) {
  const { silhouette } = describeCharacter(card);
  const use = (tf) => `<use href="#${id}" x="-45" y="-85" width="90" height="95" transform="${tf}" style="color:${teamColor}"/>`;
  if (silhouette === 'essaim') return [use('translate(0 -20) scale(.62)'), use('translate(-17 0) scale(.62)'), use('translate(17 0) scale(.62)')].join('');
  return use(silhouette === 'tank' ? 'translate(-3 4) scale(.95)' : 'translate(0 4) scale(.9)');
}

/** SVG autonome d'un personnage. team : 'you' (bleu) | 'enemy' (orange). */
function renderSvg(card, { team = 'you', width = 90, height = 95 } = {}) {
  const color = TEAM_COLORS[team] || TEAM_COLORS.you;
  const id = `ch${hash(String(card.url)).toString(36)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${VIEWBOX}" overflow="visible">`
    + `<defs>${GRADIENT_DEF}${renderSymbol(card, id)}</defs>${renderUse(card, id, color)}</svg>`;
}

const LABELS = {
  head: { casquette: 'casquette', bonnet: 'bonnet', chapeau: 'chapeau', couronne: 'couronne', casque: 'casque', capuche: 'capuche', bandeau: 'bandeau', cornes: 'cornes', pointu: 'chapeau pointu', beret: 'béret', oreilles: 'oreilles', aureole: 'auréole' },
  hairStyle: { long: 'cheveux longs', bol: 'coupe au bol', crete: 'crête', boucles: 'boucles', chauve: 'crâne rasé', queue: 'queue de cheval', meches: 'mèches' },
  glasses: { lunettes: 'lunettes', soleil: 'lunettes de soleil' },
  facial: { moustache: 'moustache', guidon: 'moustache en guidon', barbe: 'barbe', bouc: 'bouc' },
  accessories: { pipe: 'pipe', cigare: 'cigare', chaine: 'chaîne', cravate: 'cravate', noeud_papillon: 'nœud papillon', echarpe: 'écharpe', casque_audio: 'casque audio', boucle_oreille: 'boucle d’oreille', medaille: 'médaille' },
  weapon: { epee: 'épée', hache: 'hache', lance: 'lance', dagues: 'dagues', masse: 'masse', marteau: 'marteau', poings: 'poings' },
};

/** Description courte (Slack ne sait pas afficher du SVG). */
function describeText(card) {
  const c = describeCharacter(card);
  const arch = ARCHETYPES[c.archetype];
  const head = `${arch.emoji} *${arch.label}*`;
  if (c.kind === 'pompe') return `${head} · bâtiment`;
  if (c.kind === 'sort') return `${head} · disque de sort`;
  const L = c.layers;
  const bits = [LABELS.head[L.head], LABELS.hairStyle[L.hairStyle], LABELS.glasses[L.glasses], LABELS.facial[L.facial], ...L.accessories.map((a) => LABELS.accessories[a])].filter(Boolean);
  if (c.silhouette === 'tank') bits.unshift('char d’assaut');
  if (c.silhouette === 'distance') bits.unshift('arc');
  if (c.silhouette === 'melee') bits.unshift(LABELS.weapon[L.weapon]);
  if (c.silhouette === 'essaim') bits.unshift('ailé');
  return `${head}${c.swarm ? ' ×3' : ''} · ${bits.join(', ')}`;
}

module.exports = {
  VIEWBOX,
  TEAM_COLORS,
  GRADIENT_DEF,
  VOCAB,
  describeCharacter,
  renderSymbol,
  renderSpriteSet,
  renderUse,
  renderSvg,
  describeText,
  paletteOf,
};
