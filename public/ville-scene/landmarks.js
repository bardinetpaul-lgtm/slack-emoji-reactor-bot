// ═══════════════════════════════════════════════════════════
//  🏛️ Ville Jeanpip — les bâtiments du jeu, faits sur mesure en code
//    Locaux Dimsi (mairie) et sa place, Kiosque, Arène (projecteurs,
//    combattants), Musée, Banque, Boutique de boosters, Salle des ventes.
//  Chaque bâtiment a sa façade vers le sud (+z), vers la caméra.
//
//  create(K, L, models) → { list: [{ id, group, anchor, update? }],
//                           arena: { setLive(bool), update }, trees, benches }
// ═══════════════════════════════════════════════════════════
import * as THREE from 'three';

const FLOOR_Y = 0.22;

function place(group, lm) { group.position.set(lm.x, 0, lm.z); return group; }

function floor(K, b, color, size = 16.4) {
  b.box(K.mat(`floor-${color.toString(16)}`, { color }), size, 0.06, size, 0, 0.16, 0);
}

// ── 🏴 Drapeaux (canvas) ─────────────────────────────────────
function flagTexture(kind) {
  const c = document.createElement('canvas');
  c.width = 192; c.height = 120;
  const g = c.getContext('2d');
  if (kind === 'bzh') {
    // Gwenn-ha-du : 9 bandes noires et blanches, canton d'hermines
    for (let k = 0; k < 9; k += 1) { g.fillStyle = k % 2 ? '#ffffff' : '#111111'; g.fillRect(0, (k * 120) / 9, 192, 120 / 9 + 1); }
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 84, 120 * 5 / 9);
    g.fillStyle = '#111111';
    for (let r = 0; r < 3; r += 1) for (let q = 0; q < 3; q += 1) {
      const x = 14 + q * 28 + (r % 2) * 8; const y = 12 + r * 20;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - 5, y + 12); g.lineTo(x + 5, y + 12); g.fill();
      g.fillRect(x - 1.5, y - 5, 3, 5);
    }
  } else if (kind === 'fr') {
    ['#1e3a8a', '#ffffff', '#d7262b'].forEach((col, k) => { g.fillStyle = col; g.fillRect(k * 64, 0, 64, 120); });
  } else {
    g.fillStyle = '#1d2c4c'; g.fillRect(0, 0, 192, 120);
    g.fillStyle = '#f08a24'; g.font = '800 64px Inter, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('JP', 96, 62);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function flagpole(K, group, x, z, kind, h = 7.5) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, h, 6), K.mat('pole', { color: 0xdfe3e8, metalness: 0.4, roughness: 0.4 }));
  pole.position.set(x, h / 2 + FLOOR_Y, z);
  pole.castShadow = true;
  const geo = new THREE.PlaneGeometry(2.1, 1.3, 6, 1);
  geo.translate(1.05, 0, 0);
  const flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: flagTexture(kind), side: THREE.DoubleSide, roughness: 0.9 }));
  flag.position.set(x, h - 0.75 + FLOOR_Y, z);
  flag.castShadow = true;
  group.add(pole, flag);
  const base = geo.attributes.position.array.slice();
  return (t) => {
    const p = geo.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      const u = base[i] / 2.1;
      p[i + 2] = Math.sin(base[i] * 2.4 - t * 4 + x) * 0.18 * u;
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  };
}

// ── 🏢 Locaux Dimsi + place ──────────────────────────────────
function dimsi(K, L, lm, out) {
  const b = new K.Builder();
  const P = K.P;
  const white = K.mat('dimsiWhite', { color: 0xf2f2ee });
  const grey = K.mat('dimsiGrey', { color: 0x9aa3ad });
  const navy = K.mat('dimsiNavy', { color: 0x1d2c4c });
  const orange = K.mat('dimsiOrange', { color: P.orange });
  const lobby = K.windowMat('lobby', 0x3d5a7a, 0xffe2a8, 1.4);
  const stone = K.mat('plaza', { color: 0xe2dccd });
  const stone2 = K.mat('plaza2', { color: 0xcfc6b2 });
  floor(K, b, 0xd8d1c0);
  // dallage : anneau sombre autour de la fontaine + allées
  b.cyl(stone2, 4.2, 4.2, 0.04, 16, 0, FLOOR_Y, 3.8);
  b.cyl(stone, 3.4, 3.4, 0.05, 16, 0, FLOOR_Y, 3.8);
  b.box(stone2, 2.2, 0.04, 6, 0, FLOOR_Y, 5.5);

  // bâtiment principal : 4 niveaux, bandeaux blancs et vitrages
  const x0 = 1.2; const z0 = -5.1; const w = 12.6; const d = 5.6; const fh = 3;
  b.box(lobby, w - 0.6, 3.0, d - 0.6, x0, FLOOR_Y, z0);                         // hall vitré
  for (let k = 0; k < 6; k += 1) b.box(white, 0.4, 3.0, 0.4, x0 - w / 2 + 0.6 + k * ((w - 1.2) / 5), FLOOR_Y, z0 + d / 2 - 0.2);
  b.box(grey, w - 0.3, 3 * fh, d - 0.3, x0, FLOOR_Y + 3, z0);
  for (let f = 0; f <= 3; f += 1) b.box(white, w + 0.4, 0.45, d + 0.4, x0, FLOOR_Y + 3 + f * fh - 0.22, z0);
  K.windows(b, { x: x0, z: z0, y0: FLOOR_Y + 3.2, w: w - 0.3, d: d - 0.3, floors: 3, floorH: fh, step: 1.5, size: [1.25, 1.9], faces: 'sew', lit: 0.8, rng: K.rand(11) });
  // aile-tour à l'ouest (plus haute) avec bandeau orange
  const tx = -5.6; const tz = -4.6; const tw = 4.6; const td = 6.4;
  b.box(navy, tw, 15.6, td, tx, FLOOR_Y, tz);
  K.windows(b, { x: tx, z: tz, y0: FLOOR_Y + 0.8, w: tw, d: td, floors: 5, floorH: 3, step: 1.4, size: [1.0, 2.0], faces: 'swe', lit: 0.75, rng: K.rand(12) });
  b.box(orange, tw + 0.2, 0.5, td + 0.2, tx, FLOOR_Y + 15.6, tz);
  b.box(white, tw - 1, 0.9, td - 1, tx, FLOOR_Y + 16.1, tz);                   // édicule technique
  // toit : acrotère + panneaux solaires
  b.box(white, w + 0.4, 0.6, 0.3, x0, FLOOR_Y + 12, z0 + d / 2 + 0.05);
  const solar = K.mat('solar', { color: 0x23344f, metalness: 0.5, roughness: 0.3 });
  for (let k = 0; k < 3; k += 1) b.box(solar, 2.2, 0.15, 1.4, x0 + 1 + k * 2.5, FLOOR_Y + 12.2, z0 - 1, { rx: -0.3 });
  // marquise d'entrée
  b.box(white, 5.2, 0.25, 2.4, x0 + 1, FLOOR_Y + 3.1, z0 + d / 2 + 1.1);
  for (const px of [-1.4, 3.4]) b.cyl(grey, 0.09, 0.09, 3.1, 6, x0 + px, FLOOR_Y, z0 + d / 2 + 2.1);
  // fontaine
  const fountain = K.mat('fountainStone', { color: 0xbdb39d });
  b.cyl(fountain, 2.7, 2.9, 0.7, 8, 0, FLOOR_Y, 3.8);
  b.cyl(fountain, 0.35, 0.45, 1.8, 6, 0, FLOOR_Y, 3.8);
  b.cyl(fountain, 1.0, 0.5, 0.35, 8, 0, FLOOR_Y + 1.8, 3.8);
  // jardinières
  for (const [px, pz] of [[-6.6, 6.6], [6.6, 1.0], [-6.6, 1.0]]) b.box(stone2, 1.6, 0.5, 1.6, px, FLOOR_Y, pz);
  const group = place(b.build('Locaux Dimsi'), lm);

  // eau de la fontaine (luit un peu la nuit)
  const waterM = new THREE.MeshStandardMaterial({ color: 0x5ec3e8, emissive: 0x3aa7d9, emissiveIntensity: 0.1, roughness: 0.2, flatShading: true });
  K.registerNight(waterM, 0.7, 0.1);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.45, 0.1, 8), waterM);
  water.position.set(0, FLOOR_Y + 0.62, 3.8);
  const jet = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.4, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xbfeeff, transparent: true, opacity: 0.55, depthWrite: false }));
  jet.position.set(0, FLOOR_Y + 2.7, 3.8);
  jet.rotation.x = Math.PI;
  group.add(water, jet);

  // enseigne DIMSI sur le toit (lumineuse la nuit)
  const sign = K.signMesh('DIMSI', 7.2, 1.6, { w: 512, h: 112, bg: '#1d2c4c', fg: '#ffffff', font: '900 84px Inter, Arial, sans-serif', glow: 1.2 });
  sign.position.set(x0 + 0.6, FLOOR_Y + 13.3, z0 + d / 2 + 0.25);
  const sign2 = K.signMesh('MAIRIE DU JEU', 3.5, 0.62, { w: 512, h: 90, bg: '#f08a24', fg: '#1d2c4c', font: '800 54px Inter, Arial, sans-serif', glow: 0.8 });
  sign2.position.set(tx, FLOOR_Y + 16.55, tz + (td - 1) / 2 + 0.03);
  group.add(sign, sign2);

  const waves = [flagpole(K, group, 4.4, 0.4, 'bzh'), flagpole(K, group, 5.7, 0.4, 'fr'), flagpole(K, group, 7.0, 0.4, 'jp')];
  out.trees.push({ x: lm.x - 6.6, z: lm.z + 6.6, kind: 'large', s: 0.8, y: 0.7 }, { x: lm.x + 6.6, z: lm.z + 1, kind: 'large', s: 0.8, y: 0.7 }, { x: lm.x - 6.6, z: lm.z + 1, kind: 'small', s: 0.9, y: 0.7 });
  out.benches.push({ x: lm.x - 3.9, z: lm.z + 3.8, ry: Math.PI / 2, y: FLOOR_Y }, { x: lm.x + 3.9, z: lm.z + 3.8, ry: -Math.PI / 2, y: FLOOR_Y }, { x: lm.x - 1.6, z: lm.z + 7.2, ry: Math.PI, y: FLOOR_Y });
  return {
    id: 'dimsi', group, anchor: new THREE.Vector3(lm.x - 2, 19.5, lm.z - 4),
    update(t) { waves.forEach((f) => f(t)); jet.scale.y = 1 + Math.sin(t * 6) * 0.08; jet.rotation.y = t; },
  };
}

// ── 🎟️ Kiosque (sur la place) ────────────────────────────────
function kiosk(K, L) {
  const k = L.KIOSK;
  const b = new K.Builder();
  const green = K.mat('kioskGreen', { color: 0x1f5a3d });
  const red = K.mat('kioskRed', { color: K.P.red });
  const gold = K.mat('gold', { color: K.P.gold, metalness: 0.6, roughness: 0.35 });
  b.cyl(green, 1.25, 1.35, 2.5, 6, 0, FLOOR_Y, 0);
  b.cyl(red, 1.55, 1.55, 0.45, 6, 0, FLOOR_Y + 2.5, 0);
  b.add(new THREE.ConeGeometry(1.75, 1.3, 6), green, { y: FLOOR_Y + 3.6 });
  b.add(new THREE.SphereGeometry(0.22, 6, 4), gold, { y: FLOOR_Y + 4.35 });
  // affiches tout autour
  const poster = [K.mat('posterA', { color: 0xf4d35e }), K.mat('posterB', { color: 0xee6352 }), K.mat('posterC', { color: 0x59cd90 })];
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    b.box(poster[i % 3], 0.9, 1.2, 0.05, Math.sin(a) * 1.22, FLOOR_Y + 0.9, Math.cos(a) * 1.22, { ry: a });
  }
  const group = b.build('Kiosque');
  const sign = K.signMesh('ESSAI !', 1.6, 0.42, { w: 256, h: 68, bg: '#d7262b', fg: '#ffffff', font: '900 46px Inter, Arial, sans-serif' });
  sign.position.set(0, FLOOR_Y + 2.73, 1.36);
  group.add(sign);
  group.position.set(k.x, 0, k.z);
  return { id: 'kiosque', group, anchor: new THREE.Vector3(k.x, 6.4, k.z) };
}

// ── 🏟️ Arène ────────────────────────────────────────────────
function arena(K, L, lm, out) {
  const b = new K.Builder();
  const P = K.P;
  const SZ = 0.8;
  floor(K, b, 0x86b86f);
  const wallM = K.mat('arenaWall', { color: 0xc4553b, side: THREE.DoubleSide });
  const standA = K.mat('standA', { color: 0x2f5a9e, side: THREE.DoubleSide });
  const standB = K.mat('standB', { color: 0xe8e4da, side: THREE.DoubleSide });
  const pillar = K.mat('arenaPillar', { color: 0xe9e2d3 });
  const pitch = K.mat('pitch', { color: 0x4fa64a });
  const pitch2 = K.mat('pitch2', { color: 0x5cb556 });
  const white = K.mat('lineWhite', { color: 0xffffff });
  // enceinte (profil tourné), gradins en deux couleurs
  const lathe = (pts, m) => b.add(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 32), m, { y: FLOOR_Y, sz: SZ });
  lathe([[7.9, 0], [7.9, 4.6], [7.5, 4.8]], wallM);
  lathe([[7.5, 4.8], [6.3, 3.2]], standB);
  lathe([[6.3, 3.2], [5.0, 1.4], [4.95, 0.2]], standA);
  for (let k = 0; k < 20; k += 1) {
    const a = (k / 20) * Math.PI * 2;
    if (Math.abs(a - Math.PI / 2) < 0.2) continue;
    b.box(pillar, 0.55, 4.9, 0.4, Math.cos(a) * 8.0, FLOOR_Y, Math.sin(a) * 8.0 * SZ, { ry: -a + Math.PI / 2 });
  }
  // pelouse rayée + lignes
  b.add(new THREE.CircleGeometry(5, 32), pitch, { y: FLOOR_Y + 0.25, rx: -Math.PI / 2, sz: 1, sy: SZ });
  for (let k = -2; k <= 2; k += 2) b.box(pitch2, 1.6, 0.02, 7.6, k * 1.6, FLOOR_Y + 0.26, 0);
  b.box(white, 0.12, 0.02, 7.8, 0, FLOOR_Y + 0.28, 0);
  b.add(new THREE.RingGeometry(1.1, 1.25, 24), white, { y: FLOOR_Y + 0.29, rx: -Math.PI / 2 });
  // entrée monumentale côté place
  b.box(pillar, 4.4, 5.6, 1.2, 0, FLOOR_Y, 7.9 * SZ + 0.2);
  b.box(K.mat('arenaGate', { color: 0x2b2f36 }), 2.4, 3.2, 1.3, 0, FLOOR_Y, 7.9 * SZ + 0.25);
  // tableau d'affichage au nord
  b.box(K.mat('boardFrame', { color: P.dark }), 0.3, 5.5, 0.3, -1.8, FLOOR_Y, -7.6 * SZ - 0.6);
  b.box(K.mat('boardFrame', { color: P.dark }), 0.3, 5.5, 0.3, 1.8, FLOOR_Y, -7.6 * SZ - 0.6);
  const group = place(b.build('Arène'), lm);

  const gateSign = K.signMesh('ARÈNE', 3.8, 0.9, { w: 384, h: 90, bg: '#d7262b', fg: '#ffffff', font: '900 64px Inter, Arial, sans-serif' });
  gateSign.position.set(0, FLOOR_Y + 4.5, 7.9 * SZ + 0.82);
  group.add(gateSign);
  const boardTex = K.textTexture('⚔️ JEANPIP', { w: 512, h: 220, bg: '#111827', fg: '#f4d35e', font: '900 92px Inter, Arial, sans-serif', sub: 'combat en cours', subFont: '700 52px Inter, Arial, sans-serif' });
  const boardMat = new THREE.MeshStandardMaterial({ map: boardTex, emissive: 0xffffff, emissiveMap: boardTex, emissiveIntensity: 0 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.0, 0.25), [K.mat('boardFrame'), K.mat('boardFrame'), K.mat('boardFrame'), K.mat('boardFrame'), boardMat, K.mat('boardFrame')]);
  board.position.set(0, FLOOR_Y + 5.6, -7.6 * SZ - 0.6);
  group.add(board);

  // fanions rouges sur le haut des tribunes
  const pennant = new THREE.MeshStandardMaterial({ color: P.red, side: THREE.DoubleSide, flatShading: true });
  const pennants = [];
  for (let k = 0; k < 10; k += 1) {
    const a = (k / 10) * Math.PI * 2 + 0.3;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), pennant);
    p.position.set(Math.cos(a) * 7.8, FLOOR_Y + 5.6, Math.sin(a) * 7.8 * SZ);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 4), K.mat('pole'));
    pole.position.set(Math.cos(a) * 7.8 - 0.4, FLOOR_Y + 5.2, Math.sin(a) * 7.8 * SZ);
    group.add(p, pole);
    pennants.push(p);
  }

  // projecteurs : 4 mâts, têtes éclairées et cônes de lumière pendant un combat
  const mastM = K.mat('mast', { color: 0x7d8590, metalness: 0.5, roughness: 0.4 });
  const headOff = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, emissive: 0xfff6d8, emissiveIntensity: 0 });
  const coneMat = new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const cones = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const mx = sx * 8.3; const mz = sz * 7.3; const h = 11;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, h, 6), mastM);
    mast.position.set(mx, FLOOR_Y + h / 2, mz);
    mast.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.3, 0.35), headOff);
    head.position.set(mx, FLOOR_Y + h, mz);
    group.add(head);
    head.lookAt(lm.x, FLOOR_Y, lm.z);
    const from = new THREE.Vector3(mx, FLOOR_Y + h, mz);
    const to = new THREE.Vector3(-sx * 1.5, FLOOR_Y, -sz * 1.2);
    const len = from.distanceTo(to);
    const cg = new THREE.ConeGeometry(3.2, len, 16, 1, true);
    cg.translate(0, -len / 2, 0);
    const cone = new THREE.Mesh(cg, coneMat);
    cone.position.copy(from);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), to.clone().sub(from).normalize());
    cone.visible = false;
    group.add(mast, head, cone);
    cones.push(cone);
  }
  const fieldLight = new THREE.PointLight(0xfff1cc, 0, 24, 2);
  fieldLight.position.set(0, 9, 0);
  group.add(fieldLight);

  // deux combattants
  const red = K.makeFigure(0xd7262b, { pants: 0x5a1010 });
  const blue = K.makeFigure(0x2457a6, { pants: 0x10234a });
  const sword = () => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), K.mat('steel', { color: 0xdfe6ee, metalness: 0.8, roughness: 0.2 })); m.position.set(0, -0.6, 0.15); m.rotation.x = 1.2; return m; };
  red.armR.add(sword()); blue.armR.add(sword());
  for (const f of [red, blue]) { f.group.scale.setScalar(1.35); f.group.visible = false; group.add(f.group); }
  const spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
  spark.visible = false;
  group.add(spark);

  let live = false;
  let night = 0;
  function setLive(v) {
    live = Boolean(v);
    red.group.visible = live; blue.group.visible = live; spark.visible = false;
    cones.forEach((c) => { c.visible = live; });
    headOff.emissiveIntensity = live ? 2.2 : 0;
    boardMat.emissiveIntensity = live ? 1 : 0;
    fieldLight.intensity = live ? 25 + night * 45 : 0;
  }
  function setNight(level) {
    night = level;
    coneMat.opacity = 0.04 + level * 0.05;
    if (live) fieldLight.intensity = 25 + level * 45;
  }
  function update(t) {
    pennants.forEach((p, i) => { p.rotation.y = Math.sin(t * 3 + i) * 0.4; });
    if (!live) return;
    // ballet de combat : approche, échange de coups, recul
    const cyc = t % 4;
    const gap = cyc < 1 ? 3 - cyc * 1.8 : cyc < 2.6 ? 1.2 : 1.2 + (cyc - 2.6) * 1.3;
    const jump = Math.abs(Math.sin(t * 5)) * 0.2;
    red.group.position.set(-gap / 2 - 0.2, FLOOR_Y + 0.25 + jump, Math.sin(t * 0.7) * 0.8);
    blue.group.position.set(gap / 2 + 0.2, FLOOR_Y + 0.25 + Math.abs(Math.sin(t * 5 + 1)) * 0.2, Math.sin(t * 0.7) * 0.8);
    red.group.rotation.y = Math.PI / 2; blue.group.rotation.y = -Math.PI / 2;
    const strike = cyc >= 1 && cyc < 2.6;
    red.armR.rotation.x = strike ? -1.2 - Math.sin(t * 14) * 0.9 : -0.3;
    blue.armR.rotation.x = strike ? -1.2 - Math.sin(t * 14 + 2) * 0.9 : -0.3;
    K.animateWalk({ legL: red.legL, legR: red.legR, armL: red.armL, armR: { rotation: {} } }, t * 9, strike ? 0.2 : 0.5);
    K.animateWalk({ legL: blue.legL, legR: blue.legR, armL: blue.armL, armR: { rotation: {} } }, t * 9 + 1, strike ? 0.2 : 0.5);
    spark.visible = strike && Math.sin(t * 14) > 0.6;
    spark.position.set(0, FLOOR_Y + 2.4, red.group.position.z);
    spark.rotation.set(t * 5, t * 7, 0);
  }
  out.trees.push({ x: lm.x - 7.4, z: lm.z + 7.2, kind: 'small' }, { x: lm.x + 7.4, z: lm.z + 7.2, kind: 'small' });
  return { id: 'arene', group, anchor: new THREE.Vector3(lm.x, 14, lm.z), update, setLive, setNight };
}

// ── 🏛️ Musée ────────────────────────────────────────────────
function museum(K, L, lm, out) {
  const b = new K.Builder();
  const stone = K.mat('museumStone', { color: 0xeee7d6 });
  const stoneD = K.mat('museumStoneD', { color: 0xcfc5ae });
  const copper = K.mat('copper', { color: K.P.copper });
  const bronze = K.mat('bronze', { color: 0x5b4632, metalness: 0.4 });
  floor(K, b, 0xd3cab6);
  // marches
  for (let k = 0; k < 3; k += 1) b.box(stoneD, 13 - k * 0.6, 0.3, 11 - k * 0.8, 0, FLOOR_Y + k * 0.3, -0.6 - k * 0.2);
  const y0 = FLOOR_Y + 0.9;
  b.box(stone, 11, 5.8, 6.8, 0, y0, -2.2);
  b.box(stoneD, 11.6, 0.4, 7.4, 0, y0 + 5.8, -2.2);
  // colonnade
  for (let k = 0; k < 6; k += 1) {
    const x = -5 + k * 2;
    b.box(stoneD, 0.95, 0.3, 0.95, x, y0, 2.6);
    b.cyl(stone, 0.36, 0.42, 4.6, 10, x, y0 + 0.3, 2.6);
    b.box(stoneD, 0.95, 0.3, 0.95, x, y0 + 4.9, 2.6);
  }
  b.box(stone, 11.6, 0.9, 1.6, 0, y0 + 5.2, 2.6);                      // entablement
  b.gable(stone, 1.6, 2.0, 11.6, 0, y0 + 6.1, 2.6, { ry: Math.PI / 2 }); // fronton
  b.box(stone, 11.6, 0.9, 5, 0, y0 + 5.2, 0);
  // toit et dôme vert-de-gris
  b.gable(stoneD, 10.8, 1.6, 6.8, 0, y0 + 6.2, -2.4);
  b.cyl(stone, 2.6, 2.6, 1.0, 12, 0, y0 + 7.0, -2.4);
  b.add(new THREE.SphereGeometry(2.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), copper, { x: 0, y: y0 + 8.0, z: -2.4 });
  b.add(new THREE.SphereGeometry(0.25, 6, 4), K.mat('gold'), { x: 0, y: y0 + 10.6, z: -2.4 });
  // porte et hautes fenêtres latérales
  b.box(bronze, 2.2, 3.4, 0.2, 0, y0, 1.15);
  K.windows(b, { x: 0, z: -2.2, y0: y0 + 1, w: 11, d: 6.8, floors: 1, floorH: 4, step: 2, size: [0.9, 2.8], faces: 'ew', lit: 0.9, rng: K.rand(21) });
  const group = place(b.build('Musée'), lm);
  // frise + bannières « cartes »
  const frieze = K.signMesh('MUSÉE', 4.4, 0.75, { w: 512, h: 88, bg: '#eee7d6', fg: '#5b4632', font: '800 66px Georgia, serif', glow: 0.4 });
  frieze.position.set(0, y0 + 5.65, 3.42);
  group.add(frieze);
  const banner = (x) => {
    const m = K.signMesh('🃏', 1.2, 2.6, { w: 128, h: 280, bg: '#7b4bb3', fg: '#f4d35e', font: '900 90px Inter, Arial, sans-serif', border: '#f4d35e', glow: 0.5 });
    m.position.set(x, y0 + 2.6, 0.97);
    group.add(m);
  };
  banner(-3.2); banner(3.2);
  out.trees.push({ x: lm.x - 7, z: lm.z + 6.8, kind: 'large', s: 0.7 }, { x: lm.x + 7, z: lm.z + 6.8, kind: 'large', s: 0.7 });
  return { id: 'musee', group, anchor: new THREE.Vector3(lm.x, 14.5, lm.z - 1) };
}

// ── 🏦 Banque ───────────────────────────────────────────────
function bank(K, L, lm, out) {
  const b = new K.Builder();
  const sand = K.mat('bankStone', { color: 0xdcc9a0 });
  const sandD = K.mat('bankStoneD', { color: 0xb59f74 });
  const navy = K.mat('bankNavy', { color: 0x1d2c4c });
  const bronze = K.mat('bronze');
  const gold = K.mat('gold');
  floor(K, b, 0xcfc4ad);
  for (let k = 0; k < 2; k += 1) b.box(sandD, 7 - k * 0.8, 0.3, 2.2 - k * 0.6, 0, FLOOR_Y + k * 0.3, 4.6 - k * 0.3);
  const w = 12; const d = 8.4; const z0 = -0.6;
  b.box(sandD, w + 0.4, 2.4, d + 0.4, 0, FLOOR_Y, z0);                // soubassement à bossages
  for (let k = 0; k < 5; k += 1) b.box(sand, w + 0.5, 0.08, d + 0.5, 0, FLOOR_Y + 0.45 * (k + 1), z0);
  b.box(sand, w, 5.6, d, 0, FLOOR_Y + 2.4, z0);
  b.box(sandD, w + 0.8, 0.5, d + 0.8, 0, FLOOR_Y + 8, z0);             // corniche
  b.box(sand, w + 0.2, 1.0, d + 0.2, 0, FLOOR_Y + 8.5, z0);            // attique
  for (let k = 0; k < 5; k += 1) b.box(sandD, 0.7, 5.6, 0.3, -4.8 + k * 2.4, FLOOR_Y + 2.4, z0 + d / 2 + 0.1); // pilastres
  b.box(bronze, 2.4, 3.6, 0.3, 0, FLOOR_Y + 0.6, z0 + d / 2 + 0.15);   // grande porte
  b.box(gold, 2.8, 0.2, 0.35, 0, FLOOR_Y + 4.2, z0 + d / 2 + 0.15);
  b.box(navy, 7.4, 1.1, 0.25, 0, FLOOR_Y + 6.6, z0 + d / 2 + 0.2);    // bandeau d'enseigne
  K.windows(b, { x: 0, z: z0, y0: FLOOR_Y + 2.6, w, d, floors: 1, floorH: 3.6, step: 2.4, size: [1.3, 2.6], faces: 'sew', lit: 0.85, rng: K.rand(31) });
  K.windows(b, { x: 0, z: z0, y0: FLOOR_Y + 0.4, w, d, floors: 1, floorH: 2, step: 3, size: [1.0, 1.2], faces: 'ew', lit: 0.5, rng: K.rand(32) });
  const group = place(b.build('Banque'), lm);
  const sign = K.signMesh('BANQUE', 6.8, 0.9, { w: 512, h: 72, bg: '#1d2c4c', fg: '#e8b830', font: '800 58px Georgia, serif', glow: 1 });
  sign.position.set(0, FLOOR_Y + 7.15, z0 + d / 2 + 0.34);
  group.add(sign);
  // horloge
  const clockTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#f7f1e1'; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill();
    g.strokeStyle = '#1d2c4c'; g.lineWidth = 6; g.stroke();
    g.lineWidth = 4;
    for (let k = 0; k < 12; k += 1) { const a = (k / 12) * Math.PI * 2; g.beginPath(); g.moveTo(64 + Math.cos(a) * 50, 64 + Math.sin(a) * 50); g.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const clock = new THREE.Mesh(new THREE.CircleGeometry(0.75, 16), new THREE.MeshStandardMaterial({ map: clockTex }));
  clock.position.set(0, FLOOR_Y + 8.95, z0 + d / 2 + 0.12);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.02), K.mat('dimsiNavy'));
  hand.geometry.translate(0, 0.22, 0);
  hand.position.set(0, FLOOR_Y + 8.95, z0 + d / 2 + 0.15);
  const hand2 = hand.clone(); hand2.scale.set(1.2, 0.7, 1);
  group.add(clock, hand, hand2);
  // pièce JP$ géante qui tourne sur le toit
  const coinTex = K.textTexture('JP$', { w: 256, h: 256, bg: '#e8b830', fg: '#8a5a00', font: '900 104px Inter, Arial, sans-serif', border: '#c99511' });
  const face = new THREE.MeshStandardMaterial({ map: coinTex, metalness: 0.5, roughness: 0.35, emissive: 0xe8b830, emissiveIntensity: 0.05 });
  K.registerNight(face, 0.5, 0.05);
  const coin = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.35, 20), [K.mat('gold'), face, face]);
  coin.rotation.x = Math.PI / 2;
  const coinPivot = new THREE.Group();
  coinPivot.position.set(0, FLOOR_Y + 11.4, z0);
  coinPivot.add(coin);
  coin.castShadow = true;
  group.add(coinPivot);
  out.trees.push({ x: lm.x - 7, z: lm.z + 6.6, kind: 'small' }, { x: lm.x + 7, z: lm.z + 6.6, kind: 'small' });
  return {
    id: 'banque', group, anchor: new THREE.Vector3(lm.x, 15.5, lm.z),
    update(t, now) {
      coinPivot.rotation.y = t * 0.9;
      const d0 = new Date(now || Date.now());
      hand.rotation.z = -((d0.getMinutes() / 60) * Math.PI * 2);
      hand2.rotation.z = -(((d0.getHours() % 12) / 12) * Math.PI * 2);
    },
  };
}

// ── 🎁 Boutique de boosters ─────────────────────────────────
function shop(K, L, lm, out, models) {
  const b = new K.Builder();
  const pink = K.mat('shopPink', { color: 0xe86aa6 });
  const trim = K.mat('shopTrim', { color: 0xfdf6ee });
  const purple = K.mat('shopPurple', { color: 0x6b3fa0 });
  const red = K.mat('awnRed', { color: K.P.red });
  const white = K.mat('awnWhite', { color: 0xffffff });
  const inside = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffcf8a, emissiveIntensity: 0.25, flatShading: true });
  K.registerNight(inside, 1.2, 0.25);
  floor(K, b, 0xd9cfe0);
  const w = 12.4; const d = 8; const z0 = -1.4;
  b.box(pink, w, 7.2, d, 0, FLOOR_Y, z0);
  b.box(trim, w + 0.4, 0.4, d + 0.4, 0, FLOOR_Y + 7.2, z0);
  b.box(trim, w + 0.2, 0.3, 0.4, 0, FLOOR_Y + 3.4, z0 + d / 2 + 0.1);
  // vitrines : fond éclairé, boosters exposés
  b.box(inside, 4.2, 2.6, 0.3, -3.6, FLOOR_Y + 0.5, z0 + d / 2 - 0.05);
  b.box(inside, 4.2, 2.6, 0.3, 3.6, FLOOR_Y + 0.5, z0 + d / 2 - 0.05);
  b.box(K.mat('shopDoor', { color: 0x3a2350 }), 1.6, 2.9, 0.3, 0, FLOOR_Y, z0 + d / 2);
  const packCols = [0xf4d35e, 0x59cd90, 0x3fa7d6, 0xee6352, 0xfac05e, 0xe86aa6];
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < 5; k += 1) {
      const m = K.mat(`pack${k}`, { color: packCols[(k + (side > 0 ? 2 : 0)) % packCols.length] });
      b.box(m, 0.55, 0.85, 0.12, side * 3.6 - 1.6 + k * 0.8, FLOOR_Y + 0.8 + (k % 2) * 0.4, z0 + d / 2 + 0.16, { rz: (k - 2) * 0.08 });
    }
  }
  // auvent rayé
  for (let k = 0; k < 12; k += 1) b.box(k % 2 ? white : red, w / 12, 0.12, 1.8, -w / 2 + w / 24 + (k * w) / 12, FLOOR_Y + 3.3, z0 + d / 2 + 0.9, { rx: 0.38 });
  K.windows(b, { x: 0, z: z0, y0: FLOOR_Y + 3.8, w, d, floors: 1, floorH: 3.2, step: 2.4, size: [1.3, 1.6], faces: 'sew', lit: 0.8, rng: K.rand(41) });
  b.box(purple, 1.6, 0.6, 1.6, 0, FLOOR_Y + 7.6, z0); // socle du booster géant
  const group = place(b.build('Boutique'), lm);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.6), new THREE.MeshStandardMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0.2, depthWrite: false }));
  const glass2 = glass.clone();
  glass.position.set(-3.6, FLOOR_Y + 1.8, z0 + d / 2 + 0.28); glass2.position.set(3.6, FLOOR_Y + 1.8, z0 + d / 2 + 0.28);
  const sign = K.signMesh('BOOSTERS', 6.4, 1.1, { w: 512, h: 88, bg: '#6b3fa0', fg: '#f4d35e', font: '900 66px Inter, Arial, sans-serif', glow: 1.3 });
  sign.position.set(0, FLOOR_Y + 6.4, z0 + d / 2 + 0.06);
  group.add(glass, glass2, sign);
  // booster géant (pochette) qui tourne
  const packTex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 352;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 256, 352); gr.addColorStop(0, '#f4d35e'); gr.addColorStop(0.5, '#ee6352'); gr.addColorStop(1, '#6b3fa0');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 352);
    g.fillStyle = 'rgba(255,255,255,.85)';
    for (let y = 0; y < 352; y += 22) g.fillRect(0, y, 256, 3);
    g.fillStyle = '#1d2c4c'; g.fillRect(0, 0, 256, 30); g.fillRect(0, 322, 256, 30);
    g.fillStyle = '#fff'; g.font = '900 56px Inter, Arial, sans-serif'; g.textAlign = 'center';
    g.fillText('JEAN', 128, 150); g.fillText('PIP', 128, 210);
    g.font = '800 30px Inter, Arial, sans-serif'; g.fillText('BOOSTER', 128, 270);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const packFace = new THREE.MeshStandardMaterial({ map: packTex, emissive: 0xffffff, emissiveMap: packTex, emissiveIntensity: 0.05, roughness: 0.4, metalness: 0.2 });
  K.registerNight(packFace, 0.75, 0.05);
  const edge = K.mat('packEdge', { color: 0x1d2c4c });
  const pack = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.6, 0.4), [edge, edge, edge, edge, packFace, packFace]);
  pack.castShadow = true;
  const pivot = new THREE.Group();
  pivot.position.set(0, FLOOR_Y + 10.3, z0);
  pivot.add(pack);
  group.add(pivot);
  // camionnette de livraison garée sur le côté
  const van = K.modelMesh(models, 'cars/delivery', 0.95);
  if (van) { const m = models.get('cars/delivery'); van.position.set(7.0, FLOOR_Y - m.minY * 0.95, 2.5); van.rotation.y = 0; group.add(van); }
  out.trees.push({ x: lm.x - 7.2, z: lm.z + 6.8, kind: 'small' });
  return {
    id: 'boutique', group, anchor: new THREE.Vector3(lm.x, 15.8, lm.z - 1),
    update(t) { pivot.rotation.y = t * 0.8; pivot.position.y = FLOOR_Y + 10.3 + Math.sin(t * 1.6) * 0.25; },
  };
}

// ── 🔨 Salle des ventes (bientôt) ───────────────────────────
function auction(K, L, lm, out, models) {
  const b = new K.Builder();
  const brick = K.mat('brick', { color: K.P.brick });
  const brickD = K.mat('brickD', { color: 0x7d3e2a });
  const slate = K.mat('slate', { color: K.P.slate });
  const wood = K.mat('doorWood', { color: 0x5e3b25 });
  const scaffold = K.mat('scaffold', { color: 0xb8bec6, metalness: 0.4 });
  const plank = K.mat('plank');
  floor(K, b, 0xc9c0ae);
  const w = 12; const d = 8; const z0 = -1.6; const h = 5.6;
  b.box(brick, w, h, d, 0, FLOOR_Y, z0);
  b.box(brickD, w + 0.3, 0.5, d + 0.3, 0, FLOOR_Y, z0);
  b.box(brickD, w + 0.3, 0.3, d + 0.3, 0, FLOOR_Y + h - 0.3, z0);
  b.gable(slate, w + 0.6, 3.2, d + 1, 0, FLOOR_Y + h, z0);
  for (const x of [-3, 3]) {
    b.box(wood, 2.2, 3.6, 0.25, x, FLOOR_Y, z0 + d / 2 + 0.05);
    b.cyl(wood, 1.1, 1.1, 0.25, 10, x, FLOOR_Y + 3.6, z0 + d / 2 + 0.05, { rx: Math.PI / 2, sy: 1 });
  }
  K.windows(b, { x: 0, z: z0, y0: FLOOR_Y + 1.2, w, d, floors: 1, floorH: 3, step: 2.4, size: [1.0, 2.0], faces: 'ew', lit: 0.3, rng: K.rand(51) });
  // échafaudage sur le côté est
  for (let k = 0; k < 4; k += 1) for (const dz of [0, 1.4]) b.cyl(scaffold, 0.06, 0.06, 7.5, 4, w / 2 + 0.8 + dz * 0, FLOOR_Y, z0 - d / 2 + 0.6 + k * 2.3 + dz);
  for (let y = 2; y <= 7; y += 2.5) b.box(plank, 1.6, 0.12, d + 0.5, w / 2 + 1.4, FLOOR_Y + y, z0);
  // panneau suspendu en forme de marteau
  b.box(K.mat('gavel', { color: 0x6b4a2b }), 0.14, 0.14, 1.6, -w / 2 - 0.1, FLOOR_Y + 4.2, z0 + d / 2 + 0.8);
  b.cyl(K.mat('gavel'), 0.32, 0.32, 1.0, 8, -w / 2 - 0.1, FLOOR_Y + 3.5, z0 + d / 2 + 1.5, { rz: Math.PI / 2 });
  const group = place(b.build('Salle des ventes'), lm);
  const sign = K.signMesh('SALLE DES VENTES', 7, 0.8, { w: 640, h: 72, bg: '#2b2f36', fg: '#f4ead2', font: '800 48px Georgia, serif', glow: 0.5 });
  sign.position.set(0, FLOOR_Y + 4.55, z0 + d / 2 + 0.06);
  const soon = K.signMesh('BIENTÔT', 3.6, 0.9, { w: 384, h: 96, bg: '#f4d35e', fg: '#2b2f36', font: '900 66px Inter, Arial, sans-serif', border: '#2b2f36', glow: 0.6 });
  soon.position.set(0, FLOOR_Y + 1.0, z0 + d / 2 + 2.6);
  soon.rotation.z = -0.06;
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2, 0.12), K.mat('post'));
  board.position.set(0, FLOOR_Y + 0.3, z0 + d / 2 + 2.55);
  group.add(sign, soon, board);
  // cônes et barrières de chantier (Kenney)
  const props = [['roads/construction-cone', -4, 5.6, 0], ['roads/construction-cone', 4.2, 5.4, 0], ['roads/construction-barrier', -2.2, 5.8, Math.PI / 2], ['roads/construction-barrier', 2.2, 5.8, Math.PI / 2]];
  for (const [key, x, z, ry] of props) {
    const m = K.modelMesh(models, key, 10);
    if (!m) continue;
    m.position.set(x, FLOOR_Y, z); m.rotation.y = ry;
    group.add(m);
  }
  return { id: 'ventes', group, anchor: new THREE.Vector3(lm.x, 13.5, lm.z - 1) };
}

export function create(K, L, models) {
  const out = { trees: [], benches: [] };
  const byId = Object.fromEntries(L.LANDMARKS.map((l) => [l.id, l]));
  const list = [
    dimsi(K, L, byId.dimsi, out),
    kiosk(K, L),
    arena(K, L, byId.arene, out),
    museum(K, L, byId.musee, out),
    bank(K, L, byId.banque, out),
    shop(K, L, byId.boutique, out, models),
    auction(K, L, byId.ventes, out, models),
  ];
  return { list, arena: list.find((x) => x.id === 'arene'), trees: out.trees, benches: out.benches };
}
