// ═══════════════════════════════════════════════════════════
//  🧰 Ville Jeanpip — outils communs de la scène
//    • chargement des modèles Kenney (.glb) → géométrie fusionnée,
//      un matériau partagé par kit (une seule texture par kit) ;
//    • fenêtres qui s'allument la nuit (carte d'émission tirée de la
//      palette du kit) et toits recolorés (ardoise bretonne…) ;
//    • Builder : assemble des formes simples puis fusionne par matériau
//      (un appel de dessin par matériau et par bâtiment) ;
//    • panneaux texte (canvas) et matériaux « à facettes ».
//  Ce module n'importe que three et ses addons (cache des versions).
// ═══════════════════════════════════════════════════════════
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

THREE.Cache.enabled = true;

// ── ♻️ Ressources partagées et libération mémoire GPU ─────────
//  Les ressources en cache (modèles chargés, matériaux de kit, palette
//  K.mat, personnages, photos) servent à chaque reconstruction : elles
//  sont marquées « partagées » et ne sont jamais libérées par disposeGroup.
const sharedRes = new WeakSet();
export function markShared(...xs) {
  for (const x of xs) if (x) sharedRes.add(x);
  return xs[0];
}
export const isShared = (x) => sharedRes.has(x);

/**
 * Libère les géométries, matériaux et textures propres à `root` (et ses
 * enfants) : tout sauf les ressources partagées et celles de `keep`.
 * À appeler après avoir retiré `root` de la scène.
 */
export function disposeGroup(root, keep = null) {
  if (!root) return;
  const skip = (x) => !x || sharedRes.has(x) || (keep && keep.has(x));
  const geos = new Set(); const mats = new Set(); const texs = new Set();
  root.traverse((o) => {
    if (o.isInstancedMesh) o.dispose(); // tampons d'instances (instanceMatrix…)
    if (o.geometry && !skip(o.geometry)) geos.add(o.geometry);
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (skip(m)) continue;
      mats.add(m);
      for (const v of Object.values(m)) if (v && v.isTexture && !skip(v)) texs.add(v);
      if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u && u.value && u.value.isTexture && !skip(u.value)) texs.add(u.value);
    }
  });
  geos.forEach((g) => g.dispose());
  texs.forEach((t) => t.dispose());
  mats.forEach((m) => m.dispose());
  if (mats.size) {
    for (let i = nightMats.length - 1; i >= 0; i -= 1) if (mats.has(nightMats[i].mat)) nightMats.splice(i, 1);
  }
}

// ── 🌙 Matériaux qui réagissent à la nuit ───────────────────
//  { mat, day, night } : emissiveIntensity = lerp(day, night, niveau)
export const nightMats = [];
export function registerNight(mat, night = 1, day = 0) {
  nightMats.push({ mat, day, night });
  return mat;
}
export function applyNight(level) {
  for (const e of nightMats) e.mat.emissiveIntensity = e.day + (e.night - e.day) * level;
}

// ── 🎨 Palette « à facettes » ───────────────────────────────
const matCache = new Map();
export function mat(key, opts = {}) {
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.85, metalness: 0.0, ...opts });
  m.name = key;
  markShared(m);
  matCache.set(key, m);
  return m;
}

/** Fenêtre éclairée la nuit (verre sombre le jour). */
export function windowMat(key = 'win', color = 0x2c3e5c, glow = 0xffd27a, strength = 1.25) {
  if (matCache.has(key)) return matCache.get(key);
  const m = mat(key, { color, roughness: 0.25, metalness: 0.3, emissive: glow, emissiveIntensity: 0 });
  registerNight(m, strength, 0);
  return m;
}

// Palette du décor (couleurs nommées, réutilisées partout)
export const P = {
  grass: 0x7fb069, grassDark: 0x5f9150, lawn: 0x8cc277, sand: 0xe3d3a4,
  asphalt: 0x4a4f5a, sidewalk: 0xc9c3b6, curb: 0xa9a296, line: 0xf4f1e6,
  stone: 0xe8e0cf, stoneDark: 0xb8ad97, concrete: 0x9a9b95, concreteDark: 0x6f716c,
  slate: 0x4b5563, white: 0xf5f3ee, wood: 0x8a5a3b, woodDark: 0x5e3b25,
  red: 0xd7262b, blue: 0x2457a6, navy: 0x1d2c4c, gold: 0xe8b830, orange: 0xf08a24,
  pink: 0xe86aa6, purple: 0x7b4bb3, glass: 0x5d88b5, metal: 0x8e959e, dark: 0x2b2f36,
  skin: 0xf1c7a0, copper: 0x6fa59a, brick: 0xa4553a, water: 0x2f8fb8,
};

// ── 🧱 Builder : formes simples fusionnées par matériau ─────
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export class Builder {
  constructor() { this.parts = new Map(); }

  /** Ajoute une géométrie (transformée) au lot du matériau `m`. */
  add(geom, m, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
    const g = geom.index ? geom.toNonIndexed() : geom.clone();
    geom.dispose();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    g.applyMatrix4(_m);
    const list = this.parts.get(m) || [];
    list.push(g);
    this.parts.set(m, list);
    return this;
  }

  /** Boîte posée : (x, z) = centre, y = bas. */
  box(m, w, h, d, x = 0, y = 0, z = 0, o = {}) {
    return this.add(new THREE.BoxGeometry(w, h, d), m, { x, y: y + h / 2, z, ...o });
  }

  cyl(m, rTop, rBot, h, seg, x = 0, y = 0, z = 0, o = {}) {
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, Boolean(o.open)), m, { x, y: y + h / 2, z, ...o });
  }

  /** Prisme triangulaire (toit à deux pentes) : longueur selon x. */
  gable(m, w, h, d, x = 0, y = 0, z = 0, o = {}) {
    const shape = new THREE.Shape();
    shape.moveTo(-d / 2, 0); shape.lineTo(d / 2, 0); shape.lineTo(0, h); shape.lineTo(-d / 2, 0);
    const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
    g.translate(0, 0, -w / 2);
    g.rotateY(Math.PI / 2);
    return this.add(g, m, { x, y, z, ...o });
  }

  /** → Group (une maille par matériau), ombres activées. */
  build(name = 'bâtiment', { cast = true, receive = true } = {}) {
    const group = new THREE.Group();
    group.name = name;
    for (const [m, list] of this.parts) {
      const g = mergeGeometries(list, false);
      list.forEach((x) => x.dispose());
      if (!g) continue;
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = cast && !m.transparent;
      mesh.receiveShadow = receive;
      group.add(mesh);
    }
    this.parts.clear();
    return group;
  }
}

/** Rangées de fenêtres sur les 4 faces d'un volume (x, z = centre ; y0 = bas). */
export function windows(b, { x, z, y0, w, d, floors, floorH, step = 2, size = [1.1, 1.3], faces = 'nsew', lit = 0.72, rng = Math.random, inset = 0.06 }) {
  const on = windowMat();
  const off = windowMat('winOff', 0x34465f, 0x000000, 0);
  const [ww, wh] = size;
  for (let f = 0; f < floors; f += 1) {
    const yy = y0 + f * floorH + (floorH - wh) / 2;
    const row = (len, place) => {
      const n = Math.max(1, Math.floor((len - 0.6) / step));
      for (let k = 0; k < n; k += 1) place(-len / 2 + (len - (n - 1) * step) / 2 + k * step, rng() < lit ? on : off);
    };
    if (faces.includes('s')) row(w, (u, m) => b.box(m, ww, wh, 0.12, x + u, yy, z + d / 2 + inset));
    if (faces.includes('n')) row(w, (u, m) => b.box(m, ww, wh, 0.12, x + u, yy, z - d / 2 - inset));
    if (faces.includes('e')) row(d, (u, m) => b.box(m, 0.12, wh, ww, x + w / 2 + inset, yy, z + u));
    if (faces.includes('w')) row(d, (u, m) => b.box(m, 0.12, wh, ww, x - w / 2 - inset, yy, z + u));
  }
}

// ── 🪧 Panneaux texte (canvas) ──────────────────────────────
export function textTexture(text, { w = 512, h = 128, bg = '#1d2c4c', fg = '#ffffff', font = '800 72px Inter, Arial, sans-serif', border = null, sub = null, subFont = '600 34px Inter, Arial, sans-serif' } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  if (border) { g.strokeStyle = border; g.lineWidth = Math.max(4, h * 0.06); g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth); }
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font;
  g.fillText(text, w / 2, sub ? h * 0.4 : h / 2, w * 0.92);
  if (sub) { g.font = subFont; g.fillText(sub, w / 2, h * 0.78, w * 0.92); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Enseigne : plan texturé, qui luit la nuit. Renvoie la maille (à placer). */
export function signMesh(text, width, height, opts = {}) {
  const tex = textTexture(text, opts);
  const m = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.05, roughness: 0.6 });
  registerNight(m, opts.glow != null ? opts.glow : 0.9, 0.05);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), m);
  return mesh;
}

// ── 📦 Modèles Kenney ───────────────────────────────────────
const loader = new GLTFLoader();
const kitMats = new Map();   // kit → { base: Material, emissiveMap }

function hsv(r, g, b) {
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max / 255 };
}

function imageData(image) {
  const c = document.createElement('canvas');
  c.width = image.width; c.height = image.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(image, 0, 0);
  return { c, g, data: g.getImageData(0, 0, c.width, c.height) };
}

function canvasTex(c, like) {
  const t = new THREE.CanvasTexture(c);
  t.flipY = like.flipY;
  t.colorSpace = like.colorSpace;
  t.magFilter = like.magFilter; t.minFilter = like.minFilter;
  t.wrapS = like.wrapS; t.wrapT = like.wrapT;
  return t;
}

/** Carte d'émission : pixels « vitre » (bleu clair) → jaune chaud. */
function windowEmission(tex) {
  const { c, g, data } = imageData(tex.image);
  const d = data.data;
  const W = c.width; const H = c.height;
  for (let i = 0; i < d.length; i += 4) {
    // palette Kenney : les vitres sont les deux cases bleues (colonnes 5-6, 2e rangée)
    const px = (i / 4) % W; const py = Math.floor(i / 4 / W);
    const u = px / W; const v0 = py / H;
    const { h, s } = hsv(d[i], d[i + 1], d[i + 2]);
    const win = u >= 0.5 && u < 0.75 && v0 >= 0.25 && v0 < 0.5 && h >= 195 && h <= 240 && s > 0.1;
    d[i] = win ? 255 : 0; d[i + 1] = win ? 205 : 0; d[i + 2] = win ? 130 : 0; d[i + 3] = 255;
  }
  g.putImageData(data, 0, 0);
  return canvasTex(c, tex);
}

/** Variante de palette : la teinte verte des toits devient `toColor`. */
function recolor(tex, toColor) {
  const { c, g, data } = imageData(tex.image);
  const d = data.data;
  const tr = (toColor >> 16) & 255; const tg = (toColor >> 8) & 255; const tb = toColor & 255;
  for (let i = 0; i < d.length; i += 4) {
    const { h, s, v } = hsv(d[i], d[i + 1], d[i + 2]);
    if (h >= 100 && h <= 175 && s > 0.3) {
      const k = Math.min(1.25, v / 0.75);
      d[i] = Math.min(255, tr * k); d[i + 1] = Math.min(255, tg * k); d[i + 2] = Math.min(255, tb * k);
    }
  }
  g.putImageData(data, 0, 0);
  return canvasTex(c, tex);
}

/** Toits des maisons : ardoise bretonne surtout, quelques couleurs. */
export const ROOFS = [0x4f5866, 0x3f4855, 0x5a6372, 0xa5523a, 0x2f5a87, 0x3e7d5a];

const variantCache = new Map();
/** Matériau du kit dans la palette `roof` (null = palette d'origine). */
export function kitMaterial(kit, roof = null) {
  const k = kitMats.get(kit);
  if (!k) return null;
  if (roof == null) return k.base;
  const key = `${kit}|${roof}`;
  if (variantCache.has(key)) return variantCache.get(key);
  const m = k.base.clone();
  m.map = recolor(k.base.map, roof);
  registerNight(m, 1.1, 0);
  markShared(m, m.map);
  variantCache.set(key, m);
  return m;
}

function flatten(scene) {
  scene.updateMatrixWorld(true);
  const byMat = new Map();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const key = mats[0].name || 'm';
    const l = byMat.get(key) || { mat: mats[0], list: [] };
    l.list.push(g.index ? g.toNonIndexed() : g);
    byMat.set(key, l);
  });
  const parts = [];
  for (const [, { mat: m, list }] of byMat) {
    const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (g) parts.push({ geometry: g, srcMat: m });
  }
  return parts;
}

/**
 * Charge une liste de modèles : { kit: [noms] } depuis base/<kit>/<nom>.glb.
 * → Map « kit/nom » → { geometry, material, size: Vector3, minY }
 *   (une seule géométrie par modèle, le matériau partagé du kit).
 * Les fenêtres des kits `lit` s'allument la nuit.
 */
export async function loadModels(base, wanted, { lit = [], onProgress = null } = {}) {
  const out = new Map();
  const jobs = [];
  let done = 0;
  const total = Object.values(wanted).reduce((s, l) => s + l.length, 0);
  for (const [kit, names] of Object.entries(wanted)) {
    for (const name of names) {
      jobs.push(loader.loadAsync(`${base}/${kit}/${name}.glb`).then((gltf) => {
        const parts = flatten(gltf.scene);
        if (!parts.length) return;
        let k = kitMats.get(kit);
        if (!k) {
          const src = parts[0].srcMat;
          const base0 = new THREE.MeshStandardMaterial({ map: src.map, roughness: 0.8, metalness: 0, flatShading: false });
          base0.name = `kit-${kit}`;
          if (lit.includes(kit) && src.map && src.map.image) {
            base0.emissive = new THREE.Color(0xffffff);
            base0.emissiveMap = windowEmission(src.map);
            base0.emissiveIntensity = 0;
            registerNight(base0, 1.1, 0);
          }
          markShared(base0, base0.map, base0.emissiveMap);
          k = { base: base0 };
          kitMats.set(kit, k);
        }
        // une seule maille par modèle : on fusionne les sous-matériaux
        const geos = parts.map((p) => p.geometry);
        const geometry = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        markShared(geometry);
        const size = new THREE.Vector3();
        geometry.boundingBox.getSize(size);
        out.set(`${kit}/${name}`, { geometry, material: k.base, size, minY: geometry.boundingBox.min.y, kit, name });
        // textures d'origine devenues inutiles (sauf celle gardée par le kit)
        gltf.scene.traverse((o) => {
          if (o.isMesh) {
            (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map && m.map !== k.base.map) m.map.dispose(); m.dispose(); });
            o.geometry.dispose();
          }
        });
      }).catch((e) => { console.warn('[ville] modèle absent', kit, name, e && e.message); })
        .finally(() => { done += 1; if (onProgress) onProgress(done / total); }));
    }
  }
  await Promise.all(jobs);
  return out;
}

/** Maille simple d'un modèle chargé, mise à l'échelle (et posée au sol). */
export function modelMesh(models, key, scale = 1, { cast = true, receive = true, material = null } = {}) {
  const m = models.get(key);
  if (!m) return null;
  const mesh = new THREE.Mesh(m.geometry, material || m.material);
  mesh.scale.setScalar(scale);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

/**
 * Instances d'un modèle : items = [{ x, y?, z, ry?, s? }].
 * → InstancedMesh (null si le modèle manque ou la liste est vide).
 */
export function instanced(models, key, items, scale = 1, { cast = true, receive = true, material = null, lift = true } = {}) {
  const m = models.get(key);
  if (!m || !items.length) return null;
  const im = new THREE.InstancedMesh(m.geometry, material || m.material, items.length);
  const o = new THREE.Object3D();
  items.forEach((it, i) => {
    const s = scale * (it.s || 1);
    o.position.set(it.x, (it.y || 0) - (lift ? m.minY * s : 0), it.z);
    o.rotation.set(0, it.ry || 0, 0);
    o.scale.setScalar(s);
    o.updateMatrix();
    im.setMatrixAt(i, o.matrix);
  });
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = cast;
  im.receiveShadow = receive;
  im.computeBoundingSphere();
  return im;
}

// ── 🧍 Petit personnage à facettes (promeneurs, combattants) ─
const figGeo = {};
function fg(name, make) { if (!figGeo[name]) figGeo[name] = markShared(make()); return figGeo[name]; }
const figMats = new Map();
function figMat(color) {
  if (!figMats.has(color)) figMats.set(color, markShared(new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8 })));
  return figMats.get(color);
}

/** → { group, legL, legR, armL, armR, body } ; pieds en y = 0, ~1,8 de haut. */
export function makeFigure(color, { pants = 0x2b3a55, hair = 0x3b2a1e, skin = P.skin } = {}) {
  const group = new THREE.Group();
  const limb = fg('limb', () => { const g = new THREE.BoxGeometry(0.22, 0.75, 0.22); g.translate(0, -0.375, 0); return g; });
  const arm = fg('arm', () => { const g = new THREE.BoxGeometry(0.18, 0.62, 0.18); g.translate(0, -0.31, 0); return g; });
  const torso = fg('torso', () => new THREE.BoxGeometry(0.62, 0.72, 0.36));
  const head = fg('head', () => new THREE.IcosahedronGeometry(0.27, 0));
  const hairG = fg('hair', () => { const g = new THREE.IcosahedronGeometry(0.29, 0); g.scale(1, 0.55, 1); return g; });
  const legL = new THREE.Mesh(limb, figMat(pants)); legL.position.set(-0.15, 0.78, 0);
  const legR = new THREE.Mesh(limb, figMat(pants)); legR.position.set(0.15, 0.78, 0);
  const body = new THREE.Mesh(torso, figMat(color)); body.position.y = 1.14;
  const armL = new THREE.Mesh(arm, figMat(color)); armL.position.set(-0.42, 1.46, 0);
  const armR = new THREE.Mesh(arm, figMat(color)); armR.position.set(0.42, 1.46, 0);
  const h = new THREE.Mesh(head, figMat(skin)); h.position.y = 1.78;
  const hr = new THREE.Mesh(hairG, figMat(hair)); hr.position.y = 1.9;
  group.add(legL, legR, body, armL, armR, h, hr);
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group, legL, legR, armL, armR, body };
}

/** Animation de marche (phase en radians). */
export function animateWalk(f, phase, amp = 0.7) {
  const s = Math.sin(phase) * amp;
  f.legL.rotation.x = s; f.legR.rotation.x = -s;
  f.armL.rotation.x = -s * 0.8; f.armR.rotation.x = s * 0.8;
}

/** Petite fonction de hasard reproductible. */
export function rand(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
