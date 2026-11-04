// ═══════════════════════════════════════════════════════════
//  🏠 Ville Jeanpip — une maison par joueur inscrit
//    Modèles Kenney « City Kit Suburban », instanciés par (modèle, toit) :
//    quelques appels de dessin pour toutes les maisons. Devant chaque
//    maison : une allée et un panneau avec la photo Slack du joueur.
//
//  create(K, L, models, houses, { meId }) →
//    { group, pickables, userAt(hit), info(userId), highlight(userId|null), dispose() }
// ═══════════════════════════════════════════════════════════
import * as THREE from 'three';

const TYPES = ['a', 'b', 'c', 'd', 'f', 'h', 'j', 'l', 'o', 't', 'u'].map((t) => `suburban/building-type-${t}`);

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
    const type = TYPES[hash % TYPES.length];
    const roof = K.ROOFS[(hash >>> 8) % K.ROOFS.length];
    const m = models.get(type);
    const scale = m ? Math.min(4.6, 6.4 / Math.max(m.size.x, m.size.z)) : 1;
    const back = 0.6; // un peu en retrait de la rue
    const dir = p.rot === 0 ? 1 : -1;
    const x = p.x; const z = p.z - dir * back;
    const key = `${type}|${roof}`;
    const l = byKey.get(key) || [];
    l.push({ userId: h.userId, x, z, rot: p.rot, scale, minY: m ? m.minY : 0 });
    byKey.set(key, l);
    const depth = m ? (m.size.z * scale) / 2 : 2.5;
    infos.set(h.userId, {
      ...h, pos: p, x, z, rot: p.rot, color: L.hashColor(h.userId),
      door: { x, z: z + dir * (depth + 0.4) }, front: p.front,
      top: m ? m.size.y * scale : 4,
    });
  }

  const pickables = [];
  const instanceOwner = new Map(); // InstancedMesh → [userId]
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
  for (const inf of infos.values()) {
    const dir = inf.rot === 0 ? 1 : -1;
    const z0 = inf.door.z; const z1 = inf.front.z - dir * 0.7;
    b.box(path, 1.3, 0.04, Math.abs(z1 - z0), inf.x, 0.22, (z0 + z1) / 2);
    const px = inf.x + 2.4; const pz = inf.front.z - dir * 1.4;
    b.box(postM, 0.12, 1.5, 0.12, px, 0.22, pz);
    // haies basses de chaque côté
    b.box(K.mat('hedge', { color: 0x4f8a3e }), 0.6, 0.7, 2.4, inf.x - 3.4, 0.22, inf.front.z - dir * 1.6);
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
    if (!hit || hit.instanceId == null) return null;
    const owners = instanceOwner.get(hit.object);
    return owners ? owners[hit.instanceId] || null : null;
  }

  function dispose() {
    if (hl) { group.remove(hl); hl = null; }
    K.disposeGroup(group); // géométries des modèles, matériaux du kit, photos : partagés, gardés
    hlMat.dispose();
  }

  return { group, pickables, userAt, info: (id) => infos.get(id) || null, all: () => [...infos.values()], highlight, dispose };
}
