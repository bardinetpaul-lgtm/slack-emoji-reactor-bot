// ═══════════════════════════════════════════════════════════
//  🎨 MODULE LOOKS (Arène)
//  Ce que le personnage d'une carte reprend de SA photo.
//
//  • Analyse du CONTENU par Claude Haiku 4.5 (lookAnalyzer.js), si une
//    clé est configurée : couvre-chef, coupe, lunettes, moustache, pipe,
//    chaîne…, couleurs, arme adaptée au rôle.
//  • Sinon : traits analysés d'avance pour les cartes d'origine
//    (src/game/card-traits.json), couleurs lues dans les pixels (PNG /
//    JPEG), et à défaut un tirage STABLE à partir de l'URL.
//
//  Cycle de vie :
//    • à l'upload d'une carte (/jeanpip-addmedia) → ensureLook()
//    • au démarrage du bot → backfill() des cartes sans look (en fond)
//    • après un merge : node scripts/generate-looks.js [--force]
//  Stockage runtime : data/card-looks.json (non versionné)
//    { "<clé>": { rules, source: 'haiku' | 'pixels' | 'none', traits?, colors?, at } }
//  RULES_VERSION change quand la lecture des couleurs change : les
//  looks d'une version plus ancienne sont refaits.
//
//  Le DESSIN (silhouette par rôle, animations) vit dans characters.js :
//  il suit toujours les règles du code en vigueur.
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJsonAtomic } = require('../storage');

const LOOKS_PATH = path.join(__dirname, '..', '..', 'data', 'card-looks.json');
const TRAITS = require('./card-traits.json');

const RULES_VERSION = 2;

const { VOCAB } = require('./lookAnalyzer');
const HEADS = VOCAB.head;
const COLOR_KEYS = ['skin', 'hair', 'hatColor', 'outfit', 'outfit2', 'accent'];

// ─────────────────────────────────────────────
// 🔑 Clé d'une carte (FILEID Slack, sinon l'URL)
// ─────────────────────────────────────────────

function keyOf(card) {
  const m = /^https:\/\/slack-files\.com\/T[A-Z0-9]+-(F[A-Z0-9]+)-/i.exec((card && card.url) || '');
  return m ? m[1] : String((card && card.url) || '');
}

// ─────────────────────────────────────────────
// 💾 Stockage
// ─────────────────────────────────────────────

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = readJson(LOOKS_PATH, {}) || {}; // abîmé → mis de côté (.corrupt-*), jamais écrasé
  } catch (e) {
    console.error('[looks] card-looks.json illisible:', e.message);
    cache = {};
  }
  return cache;
}

function save(data) {
  writeJsonAtomic(LOOKS_PATH, data, 1);
  cache = data;
}

// ─────────────────────────────────────────────
// 🌈 Couleurs (HSL)
// ─────────────────────────────────────────────

function toHsl([r, g, b]) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return [h * 60, s, l];
}

const hex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const isSkin = ([h, s, l]) => (h <= 45 || h >= 345) && s >= 0.18 && s <= 0.8 && l >= 0.42 && l <= 0.88;

// ─────────────────────────────────────────────
// 🖼️ Pixels d'une image (PNG, JPEG) → { width, height, data RGBA }
// ─────────────────────────────────────────────

function decode(buffer, mime) {
  return require('../imageResize').decode(buffer, mime);   // GIF, WebP : null (repli sur le tirage stable)
}

/** Grille de pixels échantillonnés (N × N) : [[rgb, fx, fy], …] (fx, fy ∈ [0, 1]). */
function sample(img, N = 96) {
  const { width: W, height: H, data } = img;
  const out = [];
  for (let gy = 0; gy < N; gy += 1) {
    for (let gx = 0; gx < N; gx += 1) {
      const fx = (gx + 0.5) / N;
      const fy = (gy + 0.5) / N;
      const i = (Math.floor(fy * H) * W + Math.floor(fx * W)) * 4;
      if (data[i + 3] >= 128) out.push([[data[i], data[i + 1], data[i + 2]], fx, fy]);
    }
  }
  return out;
}

/**
 * Couleurs dominantes d'une zone : cases de 16 niveaux par canal, puis
 * regroupement des cases proches (±48) autour des plus peuplées.
 * → [{ rgb, w, hsl }] triés du plus présent au moins présent.
 */
function clusters(pixels, keep = () => true) {
  const buckets = new Map();
  for (const [rgb] of pixels) {
    if (!keep(rgb)) continue;
    const k = (rgb[0] >> 4) * 256 + (rgb[1] >> 4) * 16 + (rgb[2] >> 4);
    const b = buckets.get(k) || { w: 0, sum: [0, 0, 0] };
    b.w += 1;
    b.sum[0] += rgb[0];
    b.sum[1] += rgb[1];
    b.sum[2] += rgb[2];
    buckets.set(k, b);
  }
  const cells = [...buckets.values()].map((b) => ({ rgb: b.sum.map((v) => v / b.w), w: b.w })).sort((a, b) => b.w - a.w);
  const groups = [];
  for (const c of cells) {
    const g = groups.find((x) => dist(x.seed, c.rgb) <= 48);
    if (g) {
      g.sum = g.sum.map((v, i) => v + c.rgb[i] * c.w);
      g.w += c.w;
    } else {
      groups.push({ seed: c.rgb, sum: c.rgb.map((v) => v * c.w), w: c.w });
    }
  }
  return groups
    .map((g) => { const rgb = g.sum.map((v) => v / g.w); return { rgb, w: g.w, hsl: toHsl(rgb) }; })
    .sort((a, b) => b.w - a.w);
}

const inBox = (x0, x1, y0, y1) => (p) => p[1] >= x0 && p[1] <= x1 && p[2] >= y0 && p[2] <= y1;

/**
 * Palette d'une photo, en suivant le sujet (souvent un portrait centré) :
 *   1. skin : teinte « peau » dominante au centre-haut → le visage ;
 *   2. on repère le haut et le bas du visage (lignes riches en peau) ;
 *   3. hair / hatColor : au-dessus du visage ; outfit / outfit2 : dessous ;
 *   4. accent : la couleur la plus vive de toute la photo, assez présente.
 */
function extractColors(img) {
  const px = sample(img);
  if (!px.length) return null;

  // 1. Visage
  const faceZone = px.filter(inBox(0.3, 0.7, 0.12, 0.85));
  const skinGroup = clusters(faceZone, (rgb) => isSkin(toHsl(rgb)))[0];
  const skin = skinGroup ? skinGroup.rgb : [226, 178, 150];
  const skinLike = (rgb) => dist(rgb, skin) < 52 && isSkin(toHsl(rgb));

  // 2. Rangées de peau au centre : haut / bas du visage
  const rows = new Map();
  for (const p of faceZone) {
    if (p[1] < 0.38 || p[1] > 0.62) continue;
    const r = Math.round(p[2] * 48);
    const e = rows.get(r) || { n: 0, s: 0 };
    e.n += 1;
    if (skinLike(p[0])) e.s += 1;
    rows.set(r, e);
  }
  const skinRows = [...rows.entries()].filter(([, e]) => e.s / e.n > 0.18).map(([r]) => r / 48).sort((a, b) => a - b);
  const faceTop = skinRows.length ? skinRows[0] : 0.2;
  const faceBottom = skinRows.length ? Math.min(0.85, Math.max(faceTop + 0.12, skinRows[Math.floor(skinRows.length * 0.6)])) : 0.5;
  const faceH = Math.max(0.1, faceBottom - faceTop);

  // 3. Au-dessus du visage (cheveux / couvre-chef) et dessous (tenue)
  const above = clusters(px.filter(inBox(0.3, 0.7, Math.max(0, faceTop - faceH * 0.6), faceTop + faceH * 0.05)), (rgb) => !skinLike(rgb));
  const below = clusters(px.filter(inBox(0.25, 0.75, faceBottom + faceH * 0.15, 1)), (rgb) => !skinLike(rgb));
  const all = clusters(px);
  const total = px.length;

  const hatColor = (above[0] || all[0]).rgb;
  const hair = hatColor;   // sans analyse du contenu : cheveux et couvre-chef = la masse au-dessus du visage
  const outfit = (below[0] || all[0]).rgb;
  const outfit2 = ((below.find((c) => dist(c.rgb, outfit) > 70)) || all.find((c) => dist(c.rgb, outfit) > 70) || all[0]).rgb;
  const vivid = (c) => c.hsl[1] * (1 - Math.abs(c.hsl[2] - 0.5) * 1.4) * Math.sqrt(c.w);
  const accent = (all
    .filter((c) => c.w > total * 0.004 && c.hsl[1] > 0.35 && dist(c.rgb, outfit) > 60 && dist(c.rgb, skin) > 60)
    .sort((a, b) => vivid(b) - vivid(a))[0] || { rgb: outfit2 }).rgb;

  return { skin: hex(skin), hair: hex(hair), hatColor: hex(hatColor), outfit: hex(outfit), outfit2: hex(outfit2), accent: hex(accent) };
}

// ─────────────────────────────────────────────
// 🎲 Traits tirés de façon stable (cartes sans analyse)
// ─────────────────────────────────────────────

function seeded(card) {
  const h = crypto.createHash('sha256').update(`look|${card.url}`).digest();
  const pick = (i, list) => list[h[i] % list.length];
  return {
    head: pick(0, ['none', 'none', 'none', 'casquette', 'bonnet', 'chapeau', 'couronne', 'casque', 'capuche', 'bandeau', 'cornes', 'pointu', 'beret', 'oreilles']),
    hairStyle: pick(9, ['court', 'court', 'long', 'bol', 'crete', 'boucles', 'chauve', 'meches']),
    glasses: pick(1, ['none', 'none', 'none', 'lunettes', 'soleil']),
    facial: pick(2, ['moustache', 'moustache', 'guidon', 'barbe', 'bouc', 'none']),
    accessories: h[11] % 3 === 0 ? [pick(10, ['pipe', 'chaine', 'cravate', 'noeud_papillon', 'echarpe', 'casque_audio', 'medaille'])] : [],
    weapon: pick(12, VOCAB.weapon),
    // repli si la photo n'est pas lisible : palette DA
    hair: pick(3, ['#3b2a1e', '#6b4a2b', '#c9a878', '#1a201d', '#8a8f8c']),
    skin: pick(4, ['#e8b89a', '#e0a896', '#d49a7a', '#f0c8aa']),
    outfit: pick(5, ['#1c72f1', '#2f3733', '#ff6229', '#6b716e', '#1a201d', '#ff73c0']),
    outfit2: pick(6, ['#f3efed', '#ffffff', '#e5e0dd', '#6b716e']),
    accent: pick(7, ['#ff73c0', '#1c72f1', '#ff6229', '#ffc83d']),
    hatColor: pick(8, ['#ff6229', '#1c72f1', '#1a201d', '#ff73c0', '#f3efed']),
    prop: 'none',
  };
}

// ─────────────────────────────────────────────
// 👁 Look d'une carte (synchrone : utilisé par le dessin)
//    priorité : traits analysés > couleurs des pixels > tirage stable
// ─────────────────────────────────────────────

/** Traits analysés d'avance (ancien format) → vocabulaire actuel. */
function fromBundled(t) {
  const out = { ...t };
  if (t.head === 'cheveux_longs') { out.head = 'none'; out.hairStyle = 'long'; }
  if (!out.hairStyle) out.hairStyle = t.head === 'chauve' ? 'chauve' : 'court';
  if (t.head === 'chauve') out.head = 'none';
  const PROP_TO_ACC = { pipe: 'pipe', cigare: 'cigare', chaine: 'chaine', cravate: 'cravate', echarpe: 'echarpe', medaille: 'medaille' };
  if (!out.accessories) out.accessories = PROP_TO_ACC[t.prop] ? [PROP_TO_ACC[t.prop]] : [];
  const PROP_TO_WEAPON = { epee: 'epee', sabre: 'epee', katana: 'epee', hache: 'hache', lance: 'lance', trident: 'lance', couteau: 'dagues', marteau: 'marteau', masse: 'masse' };
  if (!out.weapon && PROP_TO_WEAPON[t.prop]) out.weapon = PROP_TO_WEAPON[t.prop];
  return out;
}

function getLook(card) {
  const key = keyOf(card);
  const base = seeded(card);
  const stored = load()[key];
  const look = { ...base, source: 'seed' };
  if (stored && stored.colors) Object.assign(look, stored.colors, { source: 'pixels' });
  if (TRAITS[key]) Object.assign(look, fromBundled(TRAITS[key]), { source: 'traits' });
  if (stored && stored.traits) Object.assign(look, stored.traits, { source: 'haiku' });
  if (!HEADS.includes(look.head)) look.head = base.head;
  if (!VOCAB.hairStyle.includes(look.hairStyle)) look.hairStyle = base.hairStyle;
  if (!VOCAB.facial.includes(look.facial)) look.facial = base.facial;
  if (!VOCAB.weapon.includes(look.weapon)) look.weapon = base.weapon;
  if (!Array.isArray(look.accessories)) look.accessories = [];
  return look;
}

/** Le look est-il à (re)faire ? (règles changées, ou analyse Haiku devenue possible) */
function needsLook(card, { force = false } = {}) {
  if (force) return true;
  const stored = load()[keyOf(card)];
  if (!stored || stored.rules !== RULES_VERSION) return true;
  return require('./lookAnalyzer').enabled() && stored.source !== 'haiku';
}

// ─────────────────────────────────────────────
// ⬇️ Photo d'une carte → { buffer, mime } | null
// ─────────────────────────────────────────────

async function loadImage(card, { client, logger = console } = {}) {
  const { getCardImage, slackFileId, cardImageUrl } = require('../cardImages');
  const fileId = slackFileId(card.url);
  if (fileId) {
    const found = await getCardImage(client, fileId, logger);
    return found ? { buffer: fs.readFileSync(found.file), mime: found.mime } : null;
  }
  const url = cardImageUrl(card);   // miniature YouTube, hébergeur public
  if (!url || !/^https?:/.test(url)) return null;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) return null;
  return { buffer: Buffer.from(await res.arrayBuffer()), mime: (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() };
}

/**
 * Crée (ou refait) le look d'une carte à partir de sa photo.
 * N'échoue jamais : sans photo lisible, la carte garde son tirage stable.
 * → { key, source: 'pixels' | 'none', colors? }
 */
async function ensureLook(card, { client = null, logger = console, force = false } = {}) {
  const key = keyOf(card);
  if (!needsLook(card, { force })) return { key, ...load()[key], skipped: true };
  let entry = { rules: RULES_VERSION, source: 'none', at: new Date().toISOString() };
  try {
    const img = await loadImage(card, { client, logger });
    const pixels = img && decode(img.buffer, img.mime);
    const colors = pixels && extractColors(pixels);
    if (colors) entry = { ...entry, source: 'pixels', colors };
    // 🔎 Contenu de la photo (Haiku 4.5), si une clé est configurée
    const analyzer = require('./lookAnalyzer');
    if (pixels && analyzer.enabled()) {
      const { getCardStats } = require('./cards');
      const traits = await analyzer.analyze(pixels, { role: getCardStats(card).archetype, title: card.title || key, logger, fallbackColors: colors || {} });
      if (traits) entry = { ...entry, source: 'haiku', model: analyzer.MODEL, traits };
    }
  } catch (e) {
    logger.warn(`[looks] ${key} : ${e.message}`);
  }
  const data = { ...load(), [key]: entry };
  save(data);
  return { key, ...entry };
}

/** Applique les règles à toutes les cartes (celles sans look, ou toutes avec force). */
async function backfill(cards, { client = null, logger = console, force = false, onCard, concurrency = 1 } = {}) {
  const out = { done: 0, haiku: 0, pixels: 0, none: 0, skipped: 0 };
  const queue = cards.slice();
  const worker = async () => {
    while (queue.length) {
      const card = queue.shift();
      const r = await ensureLook(card, { client, logger, force });
      if (r.skipped) out.skipped += 1;
      else {
        out.done += 1;
        out[r.source] = (out[r.source] || 0) + 1;
      }
      if (onCard) onCard(card, r);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return out;
}

const reload = () => { cache = null; };

module.exports = {
  RULES_VERSION,
  HEADS,
  COLOR_KEYS,
  keyOf,
  getLook,
  needsLook,
  ensureLook,
  backfill,
  extractColors,
  decode,
  reload,
};
