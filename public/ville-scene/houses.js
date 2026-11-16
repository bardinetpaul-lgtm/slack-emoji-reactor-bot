// ═══════════════════════════════════════════════════════════
//  🏠 Ville Jeanpip — une maison par joueur inscrit
//    Modèles Kenney « City Kit Suburban », instanciés par (modèle, toit) :
//    quelques appels de dessin pour toutes les maisons. Devant chaque
//    maison : une allée et un panneau avec la photo Slack du joueur.
//
//  v4.4 : chaque maison a un niveau (h.level 1→5) et une ferme (h.farm
//  0→3), vus par tout le monde. Chaque niveau garde le décor d'avant :
//    2 Maison fleurie : clôture blanche, jardinières aux fenêtres, massif
//      de fleurs, boîte aux lettres ;
//    3 Grande maison : +8 %, arche fleurie au portail avec deux lanternes
//      (allumées la nuit), cheminée qui fume ;
//    4 Villa : +15 %, toit de tuiles neuf, grille en fer forgé à pointes
//      dorées, projecteurs sur la façade la nuit, drapeau doré ;
//    5 Château Jeanpip : la maison est REMPLACÉE par un château Renaissance
//      façon Chambord (buildPalace) : pierre claire, quatre tours rondes à
//      hauts toits d'ardoise, grand toit à cheminées et lucarnes, lanterne
//      centrale à coupole, bannières ;
//      tapis rouge, grille dorée, statue de Jeanpip en or, étoile dorée
//      qui tourne au-dessus du dôme avec des paillettes ;
//    ferme 1 : rangs de cultures (à la place de la haie) ;
//    ferme 2 : + petite serre ; ferme 3 : + silo rouge ;
//    chantier en cours (h.building) : cônes orange et barrière rayée.
//
//  create(K, L, models, houses, { meId }) →
//    { group, pickables, userAt(hit), info(userId), highlight(userId|null), update(t), dispose() }
// ═══════════════════════════════════════════════════════════
import * as THREE from 'three';

const MAX_LEVEL = 5;
// Taille qui monte avec le niveau : chaque niveau a ses modèles (rangés par
// hauteur mesurée) et son échelle ; le modèle change quand la maison monte.
//   1 : plain-pied bas (h, a) · 2 : maisons moyennes (c, j, l)
//   3 : plus hautes (o, u) · 4 : les plus grandes, plus profondes (f, t)
const LEVEL_TYPES = [null, ['h', 'a'], ['c', 'j', 'l'], ['o', 'u'], ['f', 't']];
const LEVEL_SCALE = [1, 3.5, 3.8, 4.05, 4.3];
const MAX_FOOTPRINT = 6.6; // la maison tient dans sa parcelle (7,6)
const ROOF_VILLA = 0xb4552f;   // tuiles neuves
const ROOF_PALAIS = 0xe0aa22;  // toit en or
const typeFor = (level, hash) => {
  const list = LEVEL_TYPES[Math.min(4, level)];
  return `suburban/building-type-${list[hash % list.length]}`;
};

const texCache = new Map();
function photoTexture(K, url, name, color) {
  const key = url || `initials:${name}:${color}`;
  if (texCache.has(key)) return texCache.get(key);
  // initiales en attendant la photo (ou s'il n'y en a pas)
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#fff';
  g.font = '800 64px Inter, Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText((name || '?').trim().charAt(0).toUpperCase() || '?', 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (url) {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { g.drawImage(img, 0, 0, 128, 128); tex.needsUpdate = true; };
    img.src = url;
  }
  K.markShared(tex); // cache : gardé d'une reconstruction à l'autre
  texCache.set(key, tex);
  return tex;
}

// ── 🏡 Décor des niveaux et de la ferme (v4.4) ─────────────
// Matériaux « nuit » : enregistrés une seule fois (sinon la liste grossit à chaque reconstruction)
const nightDone = new Set();
function nightMat(K, mat, night, day) {
  if (!nightDone.has(mat)) { nightDone.add(mat); K.registerNight(mat, night, day); }
  return mat;
}
const GOLD = { color: 0xe8b830, emissive: 0x7a5200, emissiveIntensity: 0.35, metalness: 0.6, roughness: 0.35 };

function fence(b, m, inf, fz, { tips = null } = {}) {
  for (const side of [-1, 1]) {
    const x0 = inf.x + side * 0.85; const x1 = inf.x + side * 3.75;
    b.box(m, Math.abs(x1 - x0), 0.08, 0.06, (x0 + x1) / 2, 0.55, fz);
    b.box(m, Math.abs(x1 - x0), 0.08, 0.06, (x0 + x1) / 2, 0.85, fz);
    for (let i = 0; i <= 6; i += 1) {
      const px = x0 + ((x1 - x0) * i) / 6;
      b.box(m, 0.09, 0.95, 0.09, px, 0.22, fz);
      if (tips) b.cyl(tips, 0, 0.09, 0.22, 4, px, 1.17, fz);
    }
  }
}

/** 🏗️ Grue à tour d'un chantier : mât en treillis, flèche qui pivote au-dessus de la maison. */
function addCrane(K, inf, dir, group, anims) {
  const yellow = K.mat('craneYellow', { color: 0xf2b705 });
  const dark = K.mat('craneDark', { color: 0x2d3440 });
  const H = inf.top + 3.2;                 // hauteur du mât
  const mx = inf.x + 3.45; const mz = inf.front.z - dir * 0.9;
  const crane = new THREE.Group();
  crane.position.set(mx, 0.22, mz);
  // mât en treillis : 4 montants et des barreaux
  const mb = new K.Builder();
  for (const [ox, oz] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) mb.box(yellow, 0.07, H, 0.07, ox, 0, oz);
  for (let y = 0.5; y < H; y += 0.6) {
    mb.box(yellow, 0.5, 0.05, 0.05, 0, y, -0.22); mb.box(yellow, 0.5, 0.05, 0.05, 0, y, 0.22);
    mb.box(yellow, 0.05, 0.05, 0.5, -0.22, y, 0); mb.box(yellow, 0.05, 0.05, 0.5, 0.22, y, 0);
  }
  mb.box(dark, 0.9, 0.25, 0.9, 0, 0, 0); // lest au pied
  crane.add(mb.build('mât'));
  // partie tournante : cabine, flèche, contre-flèche, contrepoids, chariot, câble, charge
  const jib = new THREE.Group();
  jib.position.y = H;
  const jb = new K.Builder();
  jb.box(K.mat('craneCab', { color: 0xffffff }), 0.55, 0.5, 0.55, 0.25, -0.05, 0.3);
  jb.box(yellow, 6.2, 0.22, 0.3, -2.9, 0.1, 0);     // flèche (vers la maison)
  jb.box(yellow, 2.0, 0.22, 0.3, 1.0, 0.1, 0);      // contre-flèche
  jb.box(dark, 0.6, 0.5, 0.45, 1.75, -0.2, 0);      // contrepoids
  jb.box(yellow, 0.1, 1.0, 0.1, 0, 0.3, 0);         // pointe
  jib.add(jb.build('flèche'));
  const trolley = new THREE.Group();
  trolley.add(new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.35), dark));
  const cable = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1, 0.03), dark);
  cable.geometry.translate(0, -0.5, 0);
  const load = new THREE.Group();
  const pallet = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.6), K.mat('pallet', { color: 0x9b6b3d }));
  const bricks = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.5), K.mat('bricks', { color: 0xb5523b }));
  bricks.position.y = 0.22;
  load.add(pallet, bricks);
  trolley.add(cable, load);
  jib.add(trolley);
  crane.add(jib);
  crane.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  group.add(crane);
  // la flèche pivote autour d'un axe qui pointe vers la maison
  jib.userData = { kind: 'crane', base: Math.PI * 0.05 * dir, trolley, cable, load, drop: H - 1.2, phase: (inf.color % 101) / 16 };
  anims.push(jib);
}

/** Décor fixe (fusionné par matériau) ; les parties animées vont dans `anims`. */
function decorate(K, b, inf, dir, group, anims) {
  const fz = inf.front.z - dir * 0.55; // ligne de clôture, côté rue
  const yz = inf.front.z - dir * 1.6;  // milieu du jardin de devant
  const face = inf.door.z - dir * 0.4; // façade avant
  const lv = inf.level;
  if (lv >= 2) {
    // clôture : blanche, puis fer forgé à pointes dorées (Villa), puis or (Château)
    if (lv >= 5) fence(b, K.mat('goldFence', GOLD), inf, fz, { tips: K.mat('goldFence', GOLD) });
    else if (lv >= 4) fence(b, K.mat('ironFence', { color: 0x23262d, metalness: 0.4, roughness: 0.5 }), inf, fz, { tips: K.mat('goldTip', GOLD) });
    else fence(b, K.mat('fence', { color: 0xf7f5ef }), inf, fz);
    // jardinières de fleurs sous les fenêtres (pas au château)
    const box = K.mat('planter', { color: 0x8a5a36 });
    const petals = [0xe84a6f, 0xf2c14e, 0xb05de0, 0xff8fb1];
    for (const side of lv >= 5 ? [] : [-1, 1]) {
      const px = inf.x + side * 1.85;
      b.box(box, 1.1, 0.22, 0.3, px, 1.15, face + dir * 0.15);
      for (let i = 0; i < 4; i += 1) b.box(K.mat(`flower-${i}`, { color: petals[i] }), 0.2, 0.2, 0.2, px - 0.4 + i * 0.27, 1.37, face + dir * 0.15);
    }
    // massif de fleurs (remplacé par la statue au Château)
    if (lv < 5) petals.forEach((c, i) => b.box(K.mat(`flower-${i}`, { color: c }), 0.35, 0.35, 0.35, inf.x + 1.1 + i * 0.32, 0.22, yz + dir * (i % 2 ? 0.3 : -0.3)));
    // boîte aux lettres rouge
    b.box(K.mat('post'), 0.08, 0.8, 0.08, inf.x - 1.45, 0.22, fz - dir * 0.3);
    b.box(K.mat('mailbox', { color: 0xd23b2f }), 0.32, 0.26, 0.45, inf.x - 1.45, 1.02, fz - dir * 0.3);
  }
  if (lv >= 3) {
    // arche fleurie au portail, deux lanternes allumées la nuit
    const arch = lv >= 5 ? K.mat('marble', { color: 0xfbfaf6, roughness: 0.4 }) : K.mat('archWood', { color: 0xf4efe4 });
    for (const side of [-1, 1]) b.box(arch, 0.14, 2.3, 0.14, inf.x + side * 0.8, 0.22, fz);
    b.box(arch, 1.9, 0.16, 0.22, inf.x, 2.52, fz);
    for (let i = 0; i < 6; i += 1) b.box(K.mat(`flower-${i % 4}`), 0.24, 0.24, 0.24, inf.x - 0.75 + i * 0.3, 2.66, fz + (i % 2 ? 0.08 : -0.08));
    b.box(K.mat('leaf', { color: 0x4f8a3e }), 1.8, 0.12, 0.3, inf.x, 2.68, fz);
    const lantern = nightMat(K, K.mat('lantern', { color: 0xfff1b8, emissive: 0xffc94a, emissiveIntensity: 0.1 }), 1.6, 0.1);
    for (const side of [-1, 1]) b.box(lantern, 0.26, 0.32, 0.26, inf.x + side * 0.8, 2.52, fz - dir * 0.22);
    // cheminée qui fume (bouffées animées) — pas au château
    const smoke = K.mat('smoke', { color: 0xe9edf2, transparent: true, opacity: 0.55, depthWrite: false });
    const geo = new THREE.IcosahedronGeometry(0.35, 0);
    for (let i = 0; i < (lv >= 5 ? 0 : 4); i += 1) {
      const puff = new THREE.Mesh(geo, smoke);
      puff.userData = { kind: 'smoke', x: inf.x + 1.4, y: inf.top + 0.4, z: inf.z, phase: i / 4 + (inf.color % 97) / 97 };
      group.add(puff);
      anims.push(puff);
    }
  }
  if (lv >= 4) {
    // projecteurs qui éclairent la façade la nuit
    const spot = nightMat(K, K.mat('spot', { color: 0xfff6d8, emissive: 0xfff0b0, emissiveIntensity: 0 }), 2.2, 0);
    for (const side of [-1, 1]) b.cyl(spot, 0.12, 0.2, 0.28, 8, inf.x + side * 2.9, 0.22, face + dir * 0.5);
    if (lv === 4) {
      b.cyl(K.mat('flagPole', { color: 0xdedede }), 0.05, 0.05, 2.6, 6, inf.x, inf.top, inf.z);
      b.box(K.mat('goldFlag', GOLD), 1.2, 0.7, 0.05, inf.x + 0.62, inf.top + 1.8, inf.z);
    }
  }
  if (lv >= 5) {
    // tapis rouge du perron jusqu'à la grille
    const z0 = inf.door.z - dir * 0.2; const z1 = fz;
    b.box(K.mat('carpet', { color: 0xb3172f }), 1.0, 0.06, Math.abs(z1 - z0), inf.x, 0.25, (z0 + z1) / 2);
    // statue de Jeanpip en or sur son socle
    b.box(K.mat('plinth', { color: 0x3a3f4b }), 0.95, 0.9, 0.95, inf.x - 1.75, 0.22, yz);
    b.box(K.mat('marble', { color: 0xfbfaf6, roughness: 0.4 }), 1.1, 0.12, 1.1, inf.x - 1.75, 1.12, yz);
    const statue = K.makeFigure(0xe8b830, { pants: 0xd4a017, hair: 0xc8941a, skin: 0xf0c040 });
    statue.group.position.set(inf.x - 1.75, 1.24, yz); // à gauche : le panneau photo est à droite
    statue.group.rotation.y = inf.rot;
    statue.armR.rotation.x = -2.6; // bras levé : « Jeanpip ! »
    statue.group.scale.setScalar(1.05);
    group.add(statue.group);
    // étoile dorée qui tourne au-dessus du toit, et ses paillettes
    const star = new THREE.Mesh(K.markShared(starGeometry()), K.mat('goldStar', { ...GOLD, emissiveIntensity: 0.7 }));
    star.userData = { kind: 'star', y: inf.top + 2.6 };
    star.position.set(inf.x, inf.top + 2.6, inf.z);
    star.castShadow = true;
    group.add(star);
    anims.push(star);
    const glitter = K.mat('glitter', { color: 0xfff6c0, emissive: 0xffe066, emissiveIntensity: 1.2 });
    const gGeo = new THREE.OctahedronGeometry(0.12, 0);
    for (let i = 0; i < 8; i += 1) {
      const g = new THREE.Mesh(gGeo, glitter);
      g.userData = { kind: 'glitter', cx: inf.x, cy: inf.top + 2.6, cz: inf.z, phase: (i / 8) * Math.PI * 2 };
      group.add(g);
      anims.push(g);
    }
  }
  if (inf.building) {
    const cone = K.mat('cone', { color: 0xff7a1a });
    const stripe = K.mat('barrier', { color: 0xf2f2f2 });
    const red = K.mat('barrierRed', { color: 0xd83a2e });
    const bz = inf.front.z - dir * 1.0;
    for (const dx of [-2.6, -1.2, 1.2, 2.6]) b.cyl(cone, 0.04, 0.22, 0.6, 8, inf.x + dx, 0.22, bz);
    b.box(stripe, 1.4, 0.18, 0.08, inf.x + 1.9, 0.75, bz - dir * 0.3);
    b.box(red, 1.4, 0.08, 0.09, inf.x + 1.9, 0.79, bz - dir * 0.3);
    for (const dx of [1.25, 2.55]) b.box(stripe, 0.08, 0.75, 0.08, inf.x + dx, 0.22, bz - dir * 0.3);
    addCrane(K, inf, dir, group, anims);
  }
  if (inf.farm >= 1) {
    const soil = K.mat('soil', { color: 0x6b4a2f });
    const crop = K.mat('crop', { color: 0x9bc53d });
    const cx = inf.x - 3.0;
    b.box(soil, 1.6, 0.08, 2.2, cx, 0.22, yz);
    for (let i = 0; i < 3; i += 1) b.box(crop, 0.32, 0.45, 2.0, cx - 0.55 + i * 0.55, 0.3, yz);
  }
  if (inf.farm >= 2) {
    // serre tunnel (bâche translucide sur arceaux blancs) par-dessus les cultures
    const film = K.mat('greenhouse', { color: 0xeaf6ff, transparent: true, opacity: 0.72, roughness: 0.2, side: THREE.DoubleSide });
    const hoop = K.mat('hoop', { color: 0xffffff });
    const cx = inf.x - 3.0; const len = 2.4;
    b.add(new THREE.CylinderGeometry(0.95, 0.95, len, 16, 1, true, -Math.PI / 2, Math.PI), film, { x: cx, y: 0.24, z: yz, rx: -Math.PI / 2 }); // demi-cylindre au-dessus du sol
    for (let i = 0; i <= 3; i += 1) {
      b.add(new THREE.TorusGeometry(0.97, 0.05, 6, 16, Math.PI), hoop, { x: cx, y: 0.24, z: yz - len / 2 + (i * len) / 3 });
    }
    b.box(K.mat('greenDoor', { color: 0x2e7d4f }), 0.6, 0.75, 0.04, cx, 0.24, yz + dir * (len / 2 + 0.01));
  }
  if (inf.farm >= 3) {
    b.cyl(K.mat('silo', { color: 0xb8402e }), 0.55, 0.55, 3.2, 10, inf.x - 4.1, 0.22, inf.front.z - dir * 0.9);
    b.cyl(K.mat('siloTop', { color: 0xd9d9d9 }), 0.05, 0.6, 0.6, 10, inf.x - 4.1, 3.42, inf.front.z - dir * 0.9);
  }
}

// ── 🏰 Le Château Jeanpip (niveau 5), façon Chambord ───────
//  Repère local : centre de la parcelle, façade vers +z, sol en y = 0.
//  Emprise 7,4 × 6,2 (parcelle 7,6) ; lanterne centrale à 7,6 de haut.
//  Pierre claire, quatre tours rondes à hauts toits d'ardoise, grand toit
//  hérissé de cheminées et de lucarnes, lanterne centrale à coupole.
const PALACE = { depth: 3.25, top: 7.6 };

function buildPalace(K) {
  const b = new K.Builder();
  const stone = K.mat('tuffeau', { color: 0xf3ecdb });
  const trim = K.mat('tuffeauTrim', { color: 0xdcd2bb });
  const slate = K.mat('slate', { color: 0x3b4456, roughness: 0.55 });
  const gold = K.mat('goldFence', GOLD);
  const doorM = K.mat('palaceDoor', { color: 0x5a3219 });
  const red = K.mat('palaceFlag', { color: 0x2a4fa0 }); // bannière bleu roi
  const ring = (y, r, x, z) => b.cyl(trim, r + 0.08, r + 0.08, 0.14, 16, x, y, z);
  // terrasse et perron
  b.box(trim, 7.4, 0.3, 5.9, 0, 0, -0.1);
  b.box(trim, 2.2, 0.2, 0.35, 0, 0, 2.97);
  b.box(trim, 2.2, 0.1, 0.35, 0, 0, 3.3);
  // corps central : deux étages, corniches, fenêtres sur les 4 faces
  b.box(stone, 4.6, 3.2, 3.2, 0, 0.3, -0.3);
  for (const y of [1.85, 3.4]) b.box(trim, 4.75, 0.12, 3.35, 0, y, -0.3);
  K.windows(b, { x: 0, z: -0.3, y0: 0.45, w: 4.6, d: 3.2, floors: 2, floorH: 1.5, step: 1.0, size: [0.5, 1.0], faces: 'nsew', lit: 0.85, rng: K.rand(5) });
  // porte d'honneur en arc, cadre doré
  b.box(gold, 1.05, 1.75, 0.05, 0, 0.3, 1.32);
  b.box(doorM, 0.85, 1.6, 0.08, 0, 0.3, 1.34);
  b.add(new THREE.CylinderGeometry(0.45, 0.45, 0.08, 12, 1, false, -Math.PI / 2, Math.PI), gold, { x: 0, y: 1.9, z: 1.34, rx: Math.PI / 2 });
  // grand toit d'ardoise, lucarnes et cheminées
  b.gable(slate, 4.6, 1.6, 3.2, 0, 3.5, -0.3);
  for (const dx of [-1.4, 1.4]) {
    b.box(stone, 0.6, 0.75, 0.5, dx, 3.5, 0.95);
    b.gable(slate, 0.7, 0.4, 0.6, dx, 4.25, 0.95, { ry: Math.PI / 2 });
    b.box(K.windowMat(), 0.32, 0.45, 0.06, dx, 3.65, 1.22);
  }
  for (const [cx, cz, h] of [[-1.9, -0.9, 1.9], [1.9, -0.9, 1.9], [-0.9, -1.2, 2.2], [0.9, -1.2, 2.2], [-1.9, 0.4, 1.6], [1.9, 0.4, 1.6]]) {
    b.box(stone, 0.32, h, 0.32, cx, 3.5, cz);
    b.box(trim, 0.42, 0.12, 0.42, cx, 3.5 + h, cz);
  }
  // lanterne centrale à coupole (la tour-lanterne de Chambord)
  b.cyl(stone, 0.6, 0.6, 1.4, 14, 0, 4.6, -0.3);
  ring(5.95, 0.6, 0, -0.3);
  b.cyl(stone, 0.42, 0.42, 0.8, 12, 0, 6.05, -0.3);
  b.add(new THREE.SphereGeometry(0.48, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), slate, { x: 0, y: 6.85, z: -0.3 });
  b.cyl(gold, 0.03, 0.09, 0.55, 6, 0, 7.25, -0.3);
  b.add(new THREE.OctahedronGeometry(0.16, 0), gold, { x: 0, y: 7.6, z: -0.3 });
  // quatre tours rondes à haut toit conique, lanternon doré et bannière
  for (const [tx, tz] of [[-2.75, 1.25], [2.75, 1.25], [-2.75, -1.85], [2.75, -1.85]]) {
    b.cyl(stone, 0.9, 0.95, 3.5, 18, tx, 0.3, tz);
    ring(1.85, 0.9, tx, tz);
    ring(3.65, 0.9, tx, tz);
    K.windows(b, { x: tx, z: tz, y0: 0.6, w: 0.8, d: 1.8, floors: 2, floorH: 1.5, step: 2, size: [0.4, 0.85], faces: tz > 0 ? 's' : 'n', lit: 1, rng: K.rand(9) });
    b.cyl(slate, 0.05, 1.05, 2.5, 18, tx, 3.8, tz);
    b.cyl(gold, 0.06, 0.06, 0.9, 6, tx, 6.25, tz);
    b.box(red, 0.6, 0.38, 0.04, tx + 0.33, 6.75, tz);
  }
  return b.build('château');
}

/** Étoile à 5 branches en volume (≈ 1,6 de large). */
let starGeo = null;
function starGeometry() {
  if (starGeo) return starGeo;
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 ? 0.34 : 0.8;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i) sh.lineTo(Math.cos(a) * r, Math.sin(a) * r); else sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  starGeo = new THREE.ExtrudeGeometry(sh, { depth: 0.22, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1 });
  starGeo.center();
  return starGeo; // partagée : marquée « shared » au premier create()
}

export function create(K, L, models, houses, { meId = null } = {}) {
  const group = new THREE.Group();
  group.name = 'maisons';
  const byKey = new Map();
  const infos = new Map();
  const o = new THREE.Object3D();

  for (const h of houses) {
    const p = L.plotPosition(Number(h.plot));
    if (!p) continue;
    const hash = L.hashStr(h.userId);
    const level = Math.min(MAX_LEVEL, Math.max(1, Number(h.level) || 1));
    const type = typeFor(level, hash);
    const m = models.get(type);
    // toit : couleur du joueur, tuiles neuves à la Villa (le château a son propre toit)
    const roof = level >= 5 ? ROOF_PALAIS : level >= 4 ? ROOF_VILLA : K.ROOFS[(hash >>> 8) % K.ROOFS.length];
    const farm = Math.min(3, Math.max(0, Number(h.farm) || 0));
    const scale = m ? Math.min(LEVEL_SCALE[Math.min(4, level)], MAX_FOOTPRINT / Math.max(m.size.x, m.size.z)) : 1;
    const back = 0.6; // un peu en retrait de la rue
    const dir = p.rot === 0 ? 1 : -1;
    const x = p.x; const z = p.z - dir * back;
    const palace = level >= 5;
    if (!palace) {
      const key = `${type}|${roof}`;
      const l = byKey.get(key) || [];
      l.push({ userId: h.userId, x, z, rot: p.rot, scale, minY: m ? m.minY : 0 });
      byKey.set(key, l);
    }
    const depth = palace ? PALACE.depth : m ? (m.size.z * scale) / 2 : 2.5;
    infos.set(h.userId, {
      ...h, level, farm, building: Boolean(h.building), pos: p, x, z, rot: p.rot, color: L.hashColor(h.userId),
      door: { x, z: z + dir * (depth + 0.4) }, front: p.front,
      top: palace ? PALACE.top : m ? m.size.y * scale : 4,
    });
  }

  const pickables = [];
  const instanceOwner = new Map(); // InstancedMesh → [userId]
  const palaces = new Map();       // userId → Group du château
  for (const inf of infos.values()) {
    if (inf.level < 5) continue;
    const pal = buildPalace(K);
    pal.position.set(inf.x, 0.22, inf.z);
    pal.rotation.y = inf.rot;
    pal.traverse((o) => { if (o.isMesh) { o.userData.kind = 'house'; o.userData.owner = inf.userId; pickables.push(o); } });
    group.add(pal);
    palaces.set(inf.userId, pal);
  }
  for (const [key, list] of byKey) {
    const [type, roof] = key.split('|');
    const m = models.get(type);
    if (!m) continue;
    const im = new THREE.InstancedMesh(m.geometry, K.kitMaterial('suburban', Number(roof)) || m.material, list.length);
    list.forEach((it, i) => {
      o.position.set(it.x, 0.22 - it.minY * it.scale, it.z);
      o.rotation.set(0, it.rot, 0);
      o.scale.setScalar(it.scale);
      o.updateMatrix();
      im.setMatrixAt(i, o.matrix);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    im.userData.kind = 'house';
    group.add(im);
    pickables.push(im);
    instanceOwner.set(im, list.map((it) => it.userId));
  }

  // allées, boîtes aux lettres et panneaux-photo
  const path = K.mat('housePath', { color: 0xd6cfc0 });
  const postM = K.mat('post');
  const b = new K.Builder();
  const anims = []; // étoiles, paillettes, fumées (animées par update)
  for (const inf of infos.values()) {
    const dir = inf.rot === 0 ? 1 : -1;
    const z0 = inf.door.z; const z1 = inf.front.z - dir * 0.7;
    b.box(path, 1.3, 0.04, Math.abs(z1 - z0), inf.x, 0.22, (z0 + z1) / 2);
    const px = inf.x + 2.4; const pz = inf.front.z - dir * 1.4;
    b.box(postM, 0.12, 1.5, 0.12, px, 0.22, pz);
    if (!inf.farm) {
      // haie basse à gauche de l'allée
      b.box(K.mat('hedge', { color: 0x4f8a3e }), 0.6, 0.7, 2.4, inf.x - 3.4, 0.22, inf.front.z - dir * 1.6);
    }
    decorate(K, b, inf, dir, group, anims);
  }
  if (b.parts.size) group.add(b.build('allées'));
  const boardGeo = new THREE.PlaneGeometry(1.15, 1.15);
  const frameGeo = new THREE.BoxGeometry(1.35, 1.35, 0.08);
  for (const inf of infos.values()) {
    const dir = inf.rot === 0 ? 1 : -1;
    const px = inf.x + 2.4; const pz = inf.front.z - dir * 1.4;
    const frame = new THREE.Mesh(frameGeo, K.mat(`frame-${inf.userId === meId ? 'me' : 'p'}`, { color: inf.userId === meId ? 0xe8b830 : 0xf5f3ee }));
    frame.position.set(px, 2.25, pz);
    frame.rotation.y = inf.rot === 0 ? 0 : Math.PI;
    const board = new THREE.Mesh(boardGeo, new THREE.MeshBasicMaterial({ map: photoTexture(K, inf.avatar, inf.name, inf.color) }));
    board.position.set(0, 0, 0.05);
    frame.add(board);
    frame.castShadow = true;
    group.add(frame);
    inf.board = frame;
  }

  // survol : la maison passe en surbrillance (copie légèrement agrandie)
  const hlMat = new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffc94a, emissiveIntensity: 0.55, transparent: true, opacity: 0.55, depthWrite: false });
  let hl = null;
  function highlight(userId) {
    if (hl) { group.remove(hl); hl = null; }
    if (!userId) return;
    const pal = palaces.get(userId);
    if (pal) {
      hl = pal.clone();
      hl.traverse((o) => { if (o.isMesh) { o.material = hlMat; o.renderOrder = 3; } });
      hl.scale.multiplyScalar(1.03);
      group.add(hl);
      return;
    }
    for (const [im, owners] of instanceOwner) {
      const i = owners.indexOf(userId);
      if (i < 0) continue;
      hl = new THREE.Mesh(im.geometry, hlMat);
      im.getMatrixAt(i, hl.matrix);
      hl.matrix.decompose(hl.position, hl.quaternion, hl.scale);
      hl.scale.multiplyScalar(1.04);
      hl.renderOrder = 3;
      group.add(hl);
      return;
    }
  }

  function userAt(hit) {
    if (hit && hit.object && hit.object.userData.owner) return hit.object.userData.owner; // château
    if (!hit || hit.instanceId == null) return null;
    const owners = instanceOwner.get(hit.object);
    return owners ? owners[hit.instanceId] || null : null;
  }

  function dispose() {
    if (hl) { group.remove(hl); hl = null; }
    K.disposeGroup(group); // géométries des modèles, matériaux du kit, photos : partagés, gardés
    hlMat.dispose();
  }

  /** Animations : étoile qui tourne, paillettes qui tournent autour, fumée qui monte. */
  function update(t) {
    for (const a of anims) {
      const u = a.userData;
      if (u.kind === 'star') {
        a.rotation.y = t * 1.2;
        a.position.y = u.y + Math.sin(t * 1.6) * 0.18;
      } else if (u.kind === 'glitter') {
        const ang = t * 0.9 + u.phase;
        a.position.set(u.cx + Math.cos(ang) * 1.3, u.cy + Math.sin(t * 2 + u.phase * 3) * 0.5, u.cz + Math.sin(ang) * 1.3);
        a.rotation.y = t * 3;
      } else if (u.kind === 'crane') {
        const k = t * 0.35 + u.phase;
        a.rotation.y = u.base + Math.sin(k) * 0.75;                           // la flèche pivote
        u.trolley.position.x = -(1.6 + (Math.sin(k * 1.7) * 0.5 + 0.5) * 3.6); // le chariot va et vient
        const len = 0.8 + (Math.sin(k * 2.3 + 1) * 0.5 + 0.5) * (u.drop - 0.8); // la charge monte et descend
        u.cable.scale.y = len;
        u.load.position.y = -len - 0.06;
      } else if (u.kind === 'smoke') {
        const k = (t * 0.25 + u.phase) % 1;
        a.position.set(u.x + k * 0.6, u.y + k * 2.6, u.z);
        a.scale.setScalar(0.5 + k * 1.3);
        a.visible = k < 0.95;
      }
    }
  }

  return { group, pickables, userAt, info: (id) => infos.get(id) || null, all: () => [...infos.values()], highlight, update, dispose };
}
