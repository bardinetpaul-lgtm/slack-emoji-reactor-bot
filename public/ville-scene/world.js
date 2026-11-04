// ═══════════════════════════════════════════════════════════
//  🌍 Ville Jeanpip — décor : ciel, sol, rues, rade et port,
//  base sous-marine de Keroman, rive de Port-Louis, lampadaires,
//  bancs, arbres, immeubles du centre-ville autour des quartiers.
//
//  create(K, L, models, { ring, freeLots, extraTrees, extraBenches })
//    K = module kit.js, L = VilleLogic. Rien d'autre n'est importé
//    (les versions des fichiers passent par ville.js).
// ═══════════════════════════════════════════════════════════
import * as THREE from 'three';

const BENCH_SCALE = 1;

function benchGeometry(K) {
  // banc : assise + dossier + pieds (une seule géométrie, deux matériaux fusionnés en un)
  const b = new K.Builder();
  const wood = K.mat('bench-wood', { color: K.P.wood });
  b.box(wood, 1.8, 0.1, 0.45, 0, 0.42, 0);
  b.box(wood, 1.8, 0.4, 0.08, 0, 0.55, -0.22, { rx: -0.12 });
  for (const x of [-0.75, 0.75]) b.box(wood, 0.1, 0.42, 0.42, x, 0, 0);
  const g = b.build('banc');
  const mesh = g.children[0];
  return { geometry: mesh.geometry, material: mesh.material };
}

/** Bancs instanciés : list = [{ x, z, ry }]. */
export function buildBenches(K, list) {
  if (!list.length) return null;
  const { geometry, material } = benchGeometry(K);
  const im = new THREE.InstancedMesh(geometry, material, list.length);
  const o = new THREE.Object3D();
  list.forEach((p, i) => {
    o.position.set(p.x, p.y || 0.16, p.z); o.rotation.set(0, p.ry || 0, 0); o.scale.setScalar(BENCH_SCALE);
    o.updateMatrix(); im.setMatrixAt(i, o.matrix);
  });
  im.castShadow = true; im.receiveShadow = true;
  im.computeBoundingSphere();
  return im;
}

/** Arbres instanciés (deux modèles Kenney, ou cônes faits en code si absents). */
export function buildTrees(K, models, list) {
  const g = new THREE.Group();
  g.name = 'arbres';
  const big = list.filter((t, i) => (t.kind ? t.kind === 'large' : i % 3 !== 0));
  const small = list.filter((t, i) => (t.kind ? t.kind === 'small' : i % 3 === 0));
  const a = K.instanced(models, 'suburban/tree-large', big, 7);
  const b = K.instanced(models, 'suburban/tree-small', small, 7);
  if (a) g.add(a);
  if (b) g.add(b);
  if (!a && !b && list.length) {
    // repli : sapins à facettes
    const bl = new K.Builder();
    const leaf = K.mat('leaf', { color: K.P.grassDark });
    const trunk = K.mat('trunk', { color: K.P.woodDark });
    bl.cyl(trunk, 0.2, 0.25, 1.2, 5);
    bl.add(new THREE.ConeGeometry(1.4, 3.2, 6), leaf, { y: 2.6 });
    const t = bl.build('sapin');
    t.children.forEach((m) => {
      const im = new THREE.InstancedMesh(m.geometry, m.material, list.length);
      const o = new THREE.Object3D();
      list.forEach((p, i) => { o.position.set(p.x, p.y || 0.2, p.z); o.scale.setScalar(p.s || 1); o.rotation.y = i; o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
      im.castShadow = true;
      g.add(im);
    });
  }
  return g;
}

export function create(K, L, models, opts = {}) {
  const ring = Math.max(2, opts.ring || 2);
  const R1 = ring + 1;   // immeubles du centre-ville
  const R2 = ring + 2;   // immeubles lointains
  const rng = K.rand(4242);
  const root = new THREE.Group();
  root.name = 'décor';
  const details = [];   // objets masqués en qualité réduite
  const nightOnly = []; // objets visibles seulement la nuit
  const updaters = [];
  const B = L.BLOCK;
  const bounds = L.boundsForRing(R2);
  const trees = [];
  const benches = [];
  const P = K.P;

  // ── ☁️ Ciel (dôme à dégradé) + étoiles ─────────────────────
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x3d8fe0) }, bottom: { value: new THREE.Color(0xbfe3ff) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.1,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, h),1.0); }',
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 24, 12), skyMat);
  sky.renderOrder = -10;
  root.add(sky);
  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for (let i = 0; i < 700; i += 1) {
    const th = rng() * Math.PI * 2; const ph = Math.acos(1 - rng() * 0.9);
    starPos.push(1300 * Math.sin(ph) * Math.cos(th), 1300 * Math.cos(ph), 1300 * Math.sin(ph) * Math.sin(th));
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  const stars = new THREE.Points(starGeo, starMat);
  root.add(stars);

  // ── 🌱 Sol ─────────────────────────────────────────────────
  const groundMat = K.mat('ground', { color: P.grass });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3200, 1600), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, L.QUAY_Z - 800);
  ground.receiveShadow = true;
  root.add(ground);

  // ── 🛣️ Rues, trottoirs, îlots ──────────────────────────────
  const stat = new K.Builder();
  const asphalt = K.mat('asphalt', { color: P.asphalt, roughness: 0.95 });
  const walk = K.mat('sidewalk', { color: P.sidewalk });
  const lawn = K.mat('lawn', { color: P.lawn });
  const lawnDark = K.mat('lawn2', { color: 0x79b264 });
  const paving = K.mat('paving', { color: 0xd9d1bf });
  const { xs, zs } = L.roadLines(R2);
  const zTop = zs[0]; const zBot = zs[zs.length - 1];
  const xL = xs[0]; const xR = xs[xs.length - 1];
  for (const x of xs) stat.box(asphalt, L.ROAD_HALF * 2, 0.06, zBot - zTop + L.ROAD_HALF * 2, x, 0, (zTop + zBot) / 2);
  for (const z of zs) stat.box(asphalt, xR - xL + L.ROAD_HALF * 2, 0.06, L.ROAD_HALF * 2, (xL + xR) / 2, 0.001, z);

  const blocks = [];
  for (let i = -R2; i <= R2; i += 1) {
    for (let j = -R2; j <= L.MAX_ROAD_J; j += 1) {
      const x = i * B; const z = j * B;
      const r = Math.max(Math.abs(i), Math.abs(j));
      blocks.push({ i, j, x, z, r, core: L.isCore(i, j) });
      stat.box(walk, B - L.ROAD_HALF * 2, 0.16, B - L.ROAD_HALF * 2, x, 0, z);
      if (!L.isCore(i, j)) stat.box(r <= ring ? lawn : (r === R1 ? paving : lawnDark), L.INTERIOR, 0.06, L.INTERIOR, x, 0.16, z);
    }
  }
  // promenade du quai (côté rade de la rue z = 36)
  const quayLine = zBot;
  stat.box(paving, xR - xL + 60, 0.16, L.QUAY_Z - (quayLine + L.ROAD_HALF), (xL + xR) / 2, 0, (quayLine + L.ROAD_HALF + L.QUAY_Z) / 2);
  // mur du quai (pierre) + bordure
  const quayStone = K.mat('quay', { color: 0x8c8577 });
  const quayTop = K.mat('quayTop', { color: 0xb5ac9a });
  stat.box(quayStone, xR - xL + 60, 3.4, 1.0, (xL + xR) / 2, -3.2, L.QUAY_Z + 0.5);
  stat.box(quayTop, xR - xL + 60, 0.22, 1.1, (xL + xR) / 2, 0.0, L.QUAY_Z + 0.45);
  // bittes d'amarrage
  const bollard = K.mat('bollard', { color: P.dark, roughness: 0.5 });
  for (let x = xL; x <= xR; x += 6) stat.cyl(bollard, 0.22, 0.28, 0.55, 6, x + 1.5, 0.2, L.QUAY_Z + 0.4);
  root.add(stat.build('rues', { cast: false }));

  // pointillés au centre des rues + passages piétons autour du centre
  const dashes = [];
  const zebra = [];
  for (const x of xs) for (let k = 0; k < zs.length - 1; k += 1) {
    const z0 = zs[k]; const z1 = zs[k + 1];
    for (let z = z0 + 5; z <= z1 - 5; z += 3.2) dashes.push({ x, z, ry: 0 });
  }
  for (const z of zs) for (let k = 0; k < xs.length - 1; k += 1) {
    const x0 = xs[k]; const x1 = xs[k + 1];
    for (let x = x0 + 5; x <= x1 - 5; x += 3.2) dashes.push({ x, z, ry: Math.PI / 2 });
  }
  for (const x of xs) for (const z of zs) {
    if (Math.abs(x) > 40 || z < -40) continue;
    for (let s = -1.6; s <= 1.6; s += 0.8) {
      zebra.push({ x: x + s, z: z + 3.2, ry: 0 }, { x: x + s, z: z - 3.2, ry: 0 });
      zebra.push({ x: x + 3.2, z: z + s, ry: Math.PI / 2 }, { x: x - 3.2, z: z + s, ry: Math.PI / 2 });
    }
  }
  const lineMat = K.mat('roadLine', { color: P.line, roughness: 0.6 });
  const mkStrips = (list, w, l, name) => {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(w, 0.02, l), lineMat, list.length);
    const o = new THREE.Object3D();
    list.forEach((p, i) => { o.position.set(p.x, 0.07, p.z); o.rotation.set(0, p.ry, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
    im.receiveShadow = true;
    im.name = name;
    return im;
  };
  root.add(mkStrips(dashes, 0.16, 1.4, 'pointillés'));
  if (zebra.length) root.add(mkStrips(zebra, 0.45, 1.5, 'passages'));

  // ── 🌊 La rade ─────────────────────────────────────────────
  const waterMat = new THREE.MeshStandardMaterial({ color: P.water, roughness: 0.35, metalness: 0.05, flatShading: true });
  const waterUniforms = { uTime: { value: 0 } };
  waterMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = waterUniforms.uTime;
    sh.vertexShader = `uniform float uTime;\n${sh.vertexShader}`.replace('#include <begin_vertex>', `
      vec3 transformed = vec3(position);
      transformed.z += sin(position.x * 0.09 + uTime * 0.9) * 0.28 + cos(position.y * 0.13 + uTime * 1.2) * 0.22
                     + sin((position.x + position.y) * 0.05 + uTime * 0.5) * 0.25;`);
  };
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2600, 1300, 130, 60), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -1.1, L.QUAY_Z + 640);
  water.receiveShadow = true;
  root.add(water);
  updaters.push((t) => { waterUniforms.uTime.value = t; });

  // pontons en bois, avec catways
  const pont = new K.Builder();
  const plank = K.mat('plank', { color: 0x9b7653 });
  const post = K.mat('post', { color: P.woodDark });
  const moorings = [];
  for (const px of [-34, 6, 44]) {
    pont.box(plank, 2.2, 0.18, 24, px, -0.15, L.QUAY_Z + 12.5);
    for (let k = 0; k < 4; k += 1) {
      const z = L.QUAY_Z + 4 + k * 5.5;
      pont.box(plank, 7, 0.14, 0.9, px - 4.6, -0.15, z);
      pont.box(plank, 7, 0.14, 0.9, px + 4.6, -0.15, z);
      moorings.push({ x: px - 4.4, z: z + 2.6, ry: Math.PI / 2 }, { x: px + 4.4, z: z + 2.6, ry: -Math.PI / 2 });
    }
    for (let z = L.QUAY_Z + 1; z < L.QUAY_Z + 25; z += 3) {
      pont.cyl(post, 0.15, 0.15, 2.4, 5, px - 1.2, -2.0, z);
      pont.cyl(post, 0.15, 0.15, 2.4, 5, px + 1.2, -2.0, z);
    }
  }
  root.add(pont.build('pontons'));

  // ── ⚓ Base sous-marine de Keroman (K1, K2, K3) + la Flore ──
  const ker = new K.Builder();
  const KR = L.KEROMAN;
  const conc = K.mat('concrete', { color: P.concrete, roughness: 1 });
  const concD = K.mat('concreteDark', { color: P.concreteDark, roughness: 1 });
  const bay = K.mat('bay', { color: 0x1d2024, roughness: 1 });
  const rust = K.mat('rust', { color: 0x8a5a3c });
  // terre-plein
  ker.box(K.mat('platform', { color: 0xa7a59c }), KR.w + 8, 3.3, KR.d + 4, KR.x, -3.15, KR.z + 1);
  // K3 : le grand bloc, alvéoles face à la rade
  const k3x = KR.x + 4; const k3z = KR.z + 3; const k3w = 34; const k3d = 16; const k3h = 9;
  ker.box(conc, k3w, k3h, k3d, k3x, 0.1, k3z);
  ker.box(concD, k3w + 1.4, 1.6, k3d + 1.4, k3x, k3h, k3z);           // dalle de toit épaisse
  ker.box(conc, k3w + 0.6, 0.8, k3d + 0.6, k3x, k3h + 1.6, k3z);
  for (let k = 0; k < 7; k += 1) {
    const bx = k3x - k3w / 2 + 2.6 + k * 4.8;
    ker.box(bay, 3.4, 6.4, 1.2, bx, 0.1, k3z + k3d / 2 - 0.5);       // alvéoles
    ker.box(concD, 0.5, k3h, 0.6, bx + 2.4, 0.1, k3z + k3d / 2 + 0.2); // piles
  }
  // taches de vieillissement (bandes sombres)
  for (let k = 0; k < 5; k += 1) ker.box(concD, 0.6, 4 + rng() * 3, 0.05, k3x - 14 + k * 7 + rng() * 2, 2, k3z + k3d / 2 + 0.52);
  // K1 et K2 : blocs plus bas, à l'ouest
  ker.box(conc, 11, 7, 9, KR.x - 18, 0.1, KR.z - 5);
  ker.box(concD, 12, 1.2, 10, KR.x - 18, 7, KR.z - 5);
  ker.box(bay, 4, 4.6, 0.4, KR.x - 18, 0.1, KR.z - 0.4);
  ker.box(conc, 9, 6, 8, KR.x + 26, 0.1, KR.z - 7);
  ker.box(concD, 10, 1, 9, KR.x + 26, 6, KR.z - 7);
  // grue de quai
  ker.box(rust, 0.6, 10, 0.6, KR.x + 24, 0.1, KR.z + 9);
  ker.box(rust, 12, 0.6, 0.6, KR.x + 20, 10, KR.z + 9);
  ker.box(rust, 0.5, 3, 0.5, KR.x + 15, 7, KR.z + 9);
  // la Flore (sous-marin musée) le long du quai
  const hull = K.mat('sub', { color: 0x3b4148, roughness: 0.6 });
  ker.add(new THREE.CapsuleGeometry(1.1, 12, 4, 10), hull, { x: KR.x - 6, y: -0.7, z: KR.z + KR.d / 2 + 4, rz: Math.PI / 2 });
  ker.box(hull, 2.6, 1.8, 1.0, KR.x - 6, 0.2, KR.z + KR.d / 2 + 4);
  ker.box(hull, 0.15, 1.2, 0.15, KR.x - 5.6, 2.0, KR.z + KR.d / 2 + 4);
  const keroman = ker.build('Keroman');
  root.add(keroman);

  // ── 🏰 L'autre rive : Port-Louis et sa citadelle ───────────
  const shore = new K.Builder();
  const hill = K.mat('hill', { color: 0x6f9a58 });
  const hill2 = K.mat('hill2', { color: 0x86a866 });
  const sandM = K.mat('sand', { color: P.sand });
  const farZ = 230;
  shore.box(sandM, 900, 1.5, 30, 0, -1.6, farZ - 10);
  for (let k = 0; k < 16; k += 1) {
    const x = -420 + k * 56 + rng() * 20;
    shore.add(new THREE.IcosahedronGeometry(30 + rng() * 25, 0), k % 2 ? hill : hill2, { x, y: -12, z: farZ + 30 + rng() * 20, sy: 0.55 + rng() * 0.3 });
  }
  // citadelle (remparts en étoile)
  const wall = K.mat('rampart', { color: 0xc9bfa5 });
  const cx = 60; const cz = farZ - 6;
  for (let k = 0; k < 5; k += 1) {
    const a = (k / 5) * Math.PI * 2;
    shore.box(wall, 14, 4, 2, cx + Math.cos(a) * 9, -0.5, cz + Math.sin(a) * 5, { ry: -a + Math.PI / 2 });
    shore.cyl(wall, 2.4, 2.8, 4.6, 5, cx + Math.cos(a + 0.63) * 11, -0.5, cz + Math.sin(a + 0.63) * 6.5);
  }
  const roofR = K.mat('farRoof', { color: 0x4f5866 });
  for (let k = 0; k < 26; k += 1) {
    const x = -150 + k * 9 + rng() * 4; const z = farZ + 2 + rng() * 10;
    if (Math.abs(x - cx) < 18) continue;
    shore.box(K.mat('farWall', { color: 0xf3efe6 }), 3, 2.4, 3, x, -0.3, z);
    shore.gable(roofR, 3.2, 1.4, 3.2, x, 2.1, z);
  }
  root.add(shore.build('Port-Louis', { cast: false }));

  // ── 🏙️ Centre-ville autour des quartiers (immeubles) ───────
  const commercial = ['building-a', 'building-b', 'building-c', 'building-d', 'building-e', 'building-f', 'building-g', 'building-h'].map((n) => `commercial/${n}`);
  const fill = new Map();
  const put = (key, item) => { const l = fill.get(key) || []; l.push(item); fill.set(key, l); };
  const facing = (ox, oz) => (Math.abs(oz) >= Math.abs(ox) ? (oz > 0 ? 0 : Math.PI) : (ox > 0 ? Math.PI / 2 : -Math.PI / 2));
  const kerFoot = L.footprints().find((f) => f.id === 'keroman');
  for (const blk of blocks) {
    if (blk.core || blk.r <= ring) continue;
    if (L.lotOverlaps({ x: blk.x, z: blk.z }, { ...kerFoot, w: kerFoot.w + L.INTERIOR, d: kerFoot.d + L.INTERIOR })) continue;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = blk.x + sx * L.LOT_OFF; const z = blk.z + sz * L.LOT_OFF;
      if (blk.r === R1) {
        put(commercial[Math.floor(rng() * commercial.length)], { x, z, ry: facing(0, sz) });
      } else {
        // ceinture verte autour du centre-ville (parcs, bosquets)
        trees.push({ x: x + (rng() - 0.5) * 4, z: z + (rng() - 0.5) * 4, s: 0.8 + rng() * 0.5, y: 0.2 });
        if (rng() < 0.6) trees.push({ x: x + (rng() - 0.5) * 5, z: z + (rng() - 0.5) * 5, kind: 'small', y: 0.2 });
      }
    }
  }
  const town = new THREE.Group();
  town.name = 'centre-ville';
  for (const [key, list] of fill) {
    const im = K.instanced(models, key, list, 8.2);
    if (im) town.add(im);
  }
  root.add(town);

  // ── 🏘️ Quartier du port (îlots j = 1 du centre) ────────────
  const port = [];
  // îlot ouest : la criée (halle) et des conteneurs
  port.push(['industrial/building-g', { x: -24 - 2, z: 24 + 1, ry: 0 }, 6.5]);
  port.push(['industrial/building-h', { x: -24 + 4.5, z: 24 - 4.5, ry: Math.PI / 2 }, 5.5]);
  const cont = ['industrial/shipping-container-a', 'industrial/shipping-container-b', 'industrial/shipping-container-c'];
  for (let k = 0; k < 4; k += 1) port.push([cont[k % 3], { x: -24 - 6 + k * 2.4, z: 24 + 6.2, ry: 0 }, 1.6]);
  port.push([cont[1], { x: -24 - 4.8, z: 24 + 6.2, y: 2.1, ry: 0 }, 1.6]);
  // îlot central et est : façades sur le quai
  port.push(['commercial/building-a', { x: -4.2, z: 28.2, ry: 0 }, 8.2]);
  port.push(['commercial/building-c', { x: 4.2, z: 28.2, ry: 0 }, 8.2]);
  port.push(['commercial/building-h', { x: -4.2, z: 19.8, ry: Math.PI }, 8.2]);
  port.push(['commercial/building-b', { x: 4.2, z: 19.8, ry: Math.PI }, 8.2]);
  port.push(['commercial/building-e', { x: 24, z: 28.4, ry: 0 }, 8.2]);
  port.push(['commercial/building-d', { x: 24 + 4.2, z: 19.8, ry: Math.PI }, 8.2]);
  const portGroup = new THREE.Group();
  portGroup.name = 'port';
  for (const [key, it, s] of port) {
    const mesh = K.modelMesh(models, key, s);
    if (!mesh) continue;
    const m = models.get(key);
    mesh.position.set(it.x, (it.y || 0) + 0.2 - m.minY * s, it.z);
    mesh.rotation.y = it.ry;
    portGroup.add(mesh);
  }
  root.add(portGroup);
  // jardin (îlot est, côté nord-ouest)
  for (let k = 0; k < 5; k += 1) trees.push({ x: 24 - 6 + rng() * 6, z: 24 - 6 + rng() * 5, kind: 'large' });
  benches.push({ x: 20, z: 22, ry: Math.PI / 2 });
  // parasols de terrasse sur la promenade
  const paras = [];
  for (let x = -8; x <= 8; x += 4) paras.push({ x, z: L.QUAY_Z - 1.6, ry: 0, y: 0.16 });
  const pa = K.instanced(models, 'commercial/detail-parasol-a', paras, 6);
  if (pa) { root.add(pa); details.push(pa); }

  // ── 💡 Lampadaires (instanciés) + halos la nuit ────────────
  const lamps = [];
  for (const blk of blocks) {
    if (blk.r > R1) continue;
    const off = B / 2 - 3.5;
    lamps.push({ x: blk.x, z: blk.z + off, ry: Math.PI });
    lamps.push({ x: blk.x, z: blk.z - off, ry: 0 });
    lamps.push({ x: blk.x + off, z: blk.z, ry: -Math.PI / 2 });
    lamps.push({ x: blk.x - off, z: blk.z, ry: Math.PI / 2 });
  }
  for (let x = xL + 6; x < xR; x += 12) lamps.push({ x, z: L.QUAY_Z - 0.9, ry: Math.PI, quay: true });
  const LAMP_S = 6.5;
  const lampIm = K.instanced(models, 'roads/light-curved', lamps, LAMP_S, { cast: false });
  if (lampIm) root.add(lampIm);
  // têtes lumineuses et flaques de lumière (nuit)
  const headGeo = new THREE.SphereGeometry(0.32, 6, 4);
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff1c4 });
  const heads = new THREE.InstancedMesh(headGeo, headMat, lamps.length);
  // flaque douce : dégradé radial (un disque plein donnait des taches grises nettes)
  const poolCanvas = document.createElement('canvas');
  poolCanvas.width = poolCanvas.height = 64;
  const pg = poolCanvas.getContext('2d');
  const grad = pg.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  pg.fillStyle = grad;
  pg.fillRect(0, 0, 64, 64);
  const poolTex = new THREE.CanvasTexture(poolCanvas);
  poolTex.colorSpace = THREE.SRGBColorSpace;
  const poolMat = new THREE.MeshBasicMaterial({ color: 0xffb347, map: poolTex, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false });
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(4, 4), poolMat, lamps.length);
  const o = new THREE.Object3D();
  lamps.forEach((p, i) => {
    // bout du bras (modèle : bras vers -z, ~0,62 de haut, ~0,18 de long)
    const lx = -Math.sin(p.ry) * 0.18 * LAMP_S; const lz = -Math.cos(p.ry) * 0.18 * LAMP_S;
    o.position.set(p.x + lx, 0.6 * LAMP_S, p.z + lz); o.rotation.set(0, 0, 0); o.scale.setScalar(1); o.updateMatrix();
    heads.setMatrixAt(i, o.matrix);
    o.position.set(p.x + lx, 0.2, p.z + lz); o.rotation.set(-Math.PI / 2, 0, 0); o.updateMatrix();
    pools.setMatrixAt(i, o.matrix);
  });
  pools.renderOrder = 2;
  heads.visible = false; pools.visible = false;
  root.add(heads, pools);
  nightOnly.push(heads, pools);


  // bancs sur la promenade, face à la rade
  for (let x = xL + 12; x < xR - 6; x += 12) if (Math.abs(x) > 12) benches.push({ x, z: L.QUAY_Z - 1.2, ry: 0 });

  // ── 🌳 Campagne autour de la ville ─────────────────────────
  const b = L.boundsForRing(R2);
  for (let k = 0; k < 260; k += 1) {
    const side = Math.floor(rng() * 3);
    let x; let z;
    if (side === 0) { x = b.minX - 6 - rng() * 70; z = b.minZ - 60 + rng() * (L.QUAY_Z - b.minZ + 50); }
    else if (side === 1) { x = b.maxX + 6 + rng() * 70; z = b.minZ - 60 + rng() * (L.QUAY_Z - b.minZ + 50); }
    else { x = b.minX - 60 + rng() * (b.maxX - b.minX + 120); z = b.minZ - 6 - rng() * 70; }
    if (z > L.QUAY_Z - 4) continue;
    if (kerFoot && Math.abs(x - kerFoot.x) < kerFoot.w / 2 + 6 && z > kerFoot.z - kerFoot.d / 2 - 6) continue;
    trees.push({ x, z, s: 0.8 + rng() * 0.6 });
  }
  // arbres d'alignement le long du quai
  for (let x = xL + 3; x < xR; x += 12) trees.push({ x, z: L.QUAY_Z - 2.4, kind: 'large', s: 0.9 });

  function setLight(light) {
    skyMat.uniforms.top.value.setHex(light.skyTop);
    skyMat.uniforms.bottom.value.setHex(light.skyBottom);
    starMat.opacity = light.stars * 0.9;
    stars.visible = light.stars > 0.02;
    waterMat.color.setHex(light.water);
    poolMat.opacity = 0.24 * light.windows;
    for (const n of nightOnly) n.visible = light.lamps;
  }

  function update(t) { for (const u of updaters) u(t); }

  return {
    group: root, bounds, ring, R1, R2, xs, zs, moorings, trees, benches, details,
    keroman: { x: KR.x + 4, y: 14, z: KR.z + 3 },
    setLight, update, sky,
  };
}
