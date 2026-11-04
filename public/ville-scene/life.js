// ═══════════════════════════════════════════════════════════
//  🚗 Ville Jeanpip — la vie : voitures, bateaux, mouettes, promeneurs
//
//  create(K, L, models, world) → {
//    group, update(dt, t), setNight(level), setDetail(level),
//    walkers: { add(walker, path), bump(id), remove(id), update(dt) → [ids finis], positionOf(id) }
//  }
// ═══════════════════════════════════════════════════════════
import * as THREE from 'three';

const CAR_KEYS = ['cars/sedan', 'cars/taxi', 'cars/van', 'cars/hatchback-sports', 'cars/suv', 'cars/police', 'cars/sedan', 'cars/van'];
const LANE = 1.15;
const CAR_S = 0.95;

function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function create(K, L, models, world) {
  const group = new THREE.Group();
  group.name = 'vie';
  const rng = K.rand(77);

  // ── 🚗 Voitures ────────────────────────────────────────────
  //  Graphe des carrefours (xs × zs) jusqu'à l'anneau R1, conduite à droite.
  const ringCars = world.R1;
  const { xs, zs } = L.roadLines(ringCars);
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff6d0, emissive: 0xfff1b0, emissiveIntensity: 0 });
  K.registerNight(lightMat, 2.4, 0);
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x8a1010, emissive: 0xff2020, emissiveIntensity: 0 });
  K.registerNight(tailMat, 1.6, 0);
  const cars = [];
  function makeCar(key) {
    const m = models.get(key);
    let mesh;
    if (m) {
      mesh = new THREE.Mesh(m.geometry, m.material);
      mesh.position.y = -m.minY;
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 2.5), K.mat('carFallback', { color: 0xd7262b }));
      mesh.position.y = 0.55;
    }
    mesh.castShadow = true;
    const g = new THREE.Group();
    g.add(mesh);
    for (const sx of [-0.45, 0.45]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.05), lightMat);
      hl.position.set(sx, 0.55, 1.3);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.05), tailMat);
      tl.position.set(sx, 0.6, -1.28);
      g.add(hl, tl);
    }
    g.scale.setScalar(CAR_S);
    return g;
  }
  const NCARS = 12;
  for (let k = 0; k < NCARS; k += 1) {
    const g = makeCar(CAR_KEYS[k % CAR_KEYS.length]);
    const car = { g, a: Math.floor(rng() * xs.length), b: Math.floor(rng() * zs.length), dir: null, t: rng(), speed: 5 + rng() * 3, heading: 0, low: k >= 6 };
    car.dir = pickDir(car, null);
    group.add(g);
    cars.push(car);
  }
  function validDirs(car) {
    const d = [];
    if (car.a + 1 < xs.length) d.push([1, 0]);
    if (car.a - 1 >= 0) d.push([-1, 0]);
    if (car.b + 1 < zs.length) d.push([0, 1]);
    if (car.b - 1 >= 0) d.push([0, -1]);
    return d;
  }
  function pickDir(car, prev) {
    const all = validDirs(car);
    let opts = prev ? all.filter(([dx, dz]) => !(dx === -prev[0] && dz === -prev[1])) : all;
    if (!opts.length) opts = all;
    if (prev && rng() < 0.55) {
      const straight = opts.find(([dx, dz]) => dx === prev[0] && dz === prev[1]);
      if (straight) return straight;
    }
    return opts[Math.floor(rng() * opts.length)];
  }
  function updateCars(dt) {
    for (const car of cars) {
      if (!car.g.visible) continue;
      const [dx, dz] = car.dir;
      const x0 = xs[car.a]; const z0 = zs[car.b];
      const x1 = xs[car.a + dx]; const z1 = zs[car.b + dz];
      const len = Math.hypot(x1 - x0, z1 - z0) || 1;
      car.t += (car.speed * dt) / len;
      if (car.t >= 1) {
        car.a += dx; car.b += dz; car.t = 0;
        car.dir = pickDir(car, car.dir);
        continue;
      }
      const x = x0 + (x1 - x0) * car.t; const z = z0 + (z1 - z0) * car.t;
      // à droite : vecteur (-dz, dx)
      car.g.position.set(x - dz * LANE, 0.06, z + dx * LANE);
      const target = Math.atan2(dx, dz);
      car.heading = angleLerp(car.heading, target, Math.min(1, dt * 8));
      car.g.rotation.y = car.heading;
    }
  }

  // ── ⛵ Bateaux ─────────────────────────────────────────────
  const boats = [];
  const moored = ['watercraft/boat-fishing-small', 'watercraft/boat-tug-b', 'watercraft/boat-fishing-small', 'watercraft/boat-row-small', 'watercraft/boat-tug-a', 'watercraft/boat-fishing-small'];
  world.moorings.forEach((mo, i) => {
    if (i % 4 === 3) return; // quelques places libres
    const key = moored[i % moored.length];
    const mesh = K.modelMesh(models, key, key.includes('row') ? 1.3 : 1.55);
    if (!mesh) return;
    mesh.position.set(mo.x, -1.05, mo.z);
    mesh.rotation.y = mo.ry + (rng() - 0.5) * 0.1;
    group.add(mesh);
    boats.push({ mesh, kind: 'moored', ph: rng() * 6, y0: -1.05 });
  });
  const sails = ['watercraft/boat-sail-a', 'watercraft/boat-sail-b'];
  for (let k = 0; k < 6; k += 1) {
    const mesh = K.modelMesh(models, sails[k % 2], 1.7);
    if (!mesh) continue;
    group.add(mesh);
    boats.push({ mesh, kind: 'sail', cx: -120 + k * 48 + rng() * 20, cz: 95 + rng() * 60, rx: 22 + rng() * 25, rz: 10 + rng() * 14, w: (0.02 + rng() * 0.02) * (k % 2 ? 1 : -1), ph: rng() * 6, low: k >= 3 });
  }
  // chalutier qui rentre au port et en ressort
  const trawler = K.modelMesh(models, 'watercraft/boat-tug-a', 1.7);
  if (trawler) { group.add(trawler); boats.push({ mesh: trawler, kind: 'trawler', ph: 0 }); }
  const cargo = K.modelMesh(models, 'watercraft/ship-cargo-b', 2.6);
  if (cargo) { group.add(cargo); boats.push({ mesh: cargo, kind: 'cargo', ph: 0 }); }
  const buoys = [];
  for (let k = 0; k < 6; k += 1) {
    const mesh = K.modelMesh(models, k % 2 ? 'watercraft/buoy' : 'watercraft/buoy-flag', 1.2);
    if (!mesh) continue;
    mesh.position.set(-60 + k * 26, -1.0, 74 + (k % 3) * 8);
    group.add(mesh);
    buoys.push({ mesh, ph: rng() * 6 });
  }
  function updateBoats(t) {
    for (const b of boats) {
      const m = b.mesh;
      if (!m.visible) continue;
      if (b.kind === 'moored') {
        m.position.y = b.y0 + Math.sin(t * 1.3 + b.ph) * 0.08;
        m.rotation.z = Math.sin(t * 1.1 + b.ph) * 0.04;
      } else if (b.kind === 'sail') {
        const a = t * b.w + b.ph;
        m.position.set(b.cx + Math.cos(a) * b.rx, -1.0 + Math.sin(t * 1.5 + b.ph) * 0.1, b.cz + Math.sin(a) * b.rz);
        const vx = -Math.sin(a) * b.rx * b.w; const vz = Math.cos(a) * b.rz * b.w;
        m.rotation.y = Math.atan2(vx, vz);
        m.rotation.z = Math.sin(t * 0.9 + b.ph) * 0.07 + 0.08 * Math.sign(b.w);
      } else if (b.kind === 'trawler') {
        // aller-retour entre le large et le ponton central (cycle de 120 s)
        const c = (t % 120) / 120;
        const u = c < 0.5 ? c * 2 : 2 - c * 2;
        const e = u * u * (3 - 2 * u);
        m.position.set(20 + Math.sin(e * 3) * 6, -1.0 + Math.sin(t * 1.4) * 0.08, 64 + (1 - e) * 120);
        m.rotation.y = c < 0.5 ? Math.PI : 0;
      } else if (b.kind === 'cargo') {
        m.position.set(-300 + ((t * 2.2) % 600), -1.1, 175);
        m.rotation.y = Math.PI / 2;
      }
    }
    for (const b of buoys) { b.mesh.position.y = -1.0 + Math.sin(t * 1.6 + b.ph) * 0.12; b.mesh.rotation.z = Math.sin(t + b.ph) * 0.1; }
  }

  // ── 🐦 Mouettes ────────────────────────────────────────────
  const gulls = [];
  const gullBody = new THREE.OctahedronGeometry(0.35, 0);
  gullBody.scale(0.8, 0.7, 1.8);
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.35, 1.5, 0, 0, 0, 0, -0.35], 3));
  wingGeo.computeVertexNormals();
  const gullMat = new THREE.MeshStandardMaterial({ color: 0xf8f8f8, flatShading: true, side: THREE.DoubleSide });
  const tipMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, flatShading: true, side: THREE.DoubleSide });
  for (let k = 0; k < 12; k += 1) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(gullBody, gullMat);
    const wl = new THREE.Mesh(wingGeo, k % 3 ? gullMat : tipMat);
    const wr = new THREE.Mesh(wingGeo, k % 3 ? gullMat : tipMat);
    wr.scale.x = -1;
    g.add(body, wl, wr);
    const overCity = k >= 8;
    g.scale.setScalar(1.3);
    group.add(g);
    gulls.push({ g, wl, wr, cx: overCity ? (rng() - 0.5) * 30 : -60 + rng() * 120, cz: overCity ? (rng() - 0.5) * 30 : 50 + rng() * 40, r: 8 + rng() * 18, h: 12 + rng() * 8, w: (0.25 + rng() * 0.3) * (rng() < 0.5 ? -1 : 1), ph: rng() * 6, low: k >= 6 });
  }
  function updateGulls(t) {
    for (const s of gulls) {
      if (!s.g.visible) continue;
      const a = t * s.w + s.ph;
      s.g.position.set(s.cx + Math.cos(a) * s.r, s.h + Math.sin(t * 0.7 + s.ph) * 1.5, s.cz + Math.sin(a) * s.r);
      s.g.rotation.y = Math.atan2(-Math.sin(a) * s.w, Math.cos(a) * s.w);
      s.g.rotation.z = -Math.sign(s.w) * 0.35;
      const flap = Math.sin(t * 7 + s.ph) * 0.55;
      s.wl.rotation.z = flap; s.wr.rotation.z = -flap;
    }
  }

  // ── 🚶 Promeneurs ──────────────────────────────────────────
  const SPEED = 2;
  const live = new Map(); // id → { fig, path, seg, u, done, fade }
  const walkers = {
    add(w, path) {
      const fig = K.makeFigure(L.hashColor(w.userId), { pants: 0x2b3a55, hair: [0x3b2a1e, 0x7a4b25, 0xd9b26a, 0x1b1b1b, 0xa03a1c][L.hashStr(w.userId) % 5] });
      fig.group.scale.setScalar(1.25);
      fig.group.position.set(path[0].x, 0.16, path[0].z);
      group.add(fig.group);
      live.set(w.id, { fig, path, seg: 0, u: 0, done: false, fade: 0, ph: rng() * 6, grow: 0 });
    },
    replan(id, path) {
      const s = live.get(id);
      if (!s) return;
      s.path = path; s.seg = 0; s.u = 0; s.done = false;
    },
    remove(id) {
      const s = live.get(id);
      if (s) s.fade = s.fade || 0.0001; // rétrécit puis disparaît
    },
    has: (id) => live.has(id),
    positionOf(id) {
      const s = live.get(id);
      return s ? s.fig.group.position : null;
    },
    /** → ids arrivés au bout de leur chemin (à la maison). */
    update(dt) {
      const finished = [];
      for (const [id, s] of live) {
        const g = s.fig.group;
        if (s.fade) {
          s.fade += dt * 2.5;
          g.scale.setScalar(1.25 * Math.max(0, 1 - s.fade));
          if (s.fade >= 1) { group.remove(g); live.delete(id); }
          continue;
        }
        if (s.grow < 1) { s.grow = Math.min(1, s.grow + dt * 2.5); g.scale.setScalar(1.25 * s.grow); }
        if (s.done) continue;
        let move = SPEED * dt;
        while (move > 0 && s.seg < s.path.length - 1) {
          const a = s.path[s.seg]; const b = s.path[s.seg + 1];
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          const left = len * (1 - s.u);
          if (len < 1e-6 || move >= left) { move -= left; s.seg += 1; s.u = 0; continue; }
          s.u += move / len; move = 0;
          g.position.set(a.x + (b.x - a.x) * s.u, 0.16, a.z + (b.z - a.z) * s.u);
          g.rotation.y = angleLerp(g.rotation.y, Math.atan2(b.x - a.x, b.z - a.z), Math.min(1, dt * 10));
        }
        s.ph += dt * 9;
        K.animateWalk(s.fig, s.ph, 0.6);
        if (s.seg >= s.path.length - 1) { s.done = true; K.animateWalk(s.fig, 0, 0); finished.push(id); }
      }
      return finished;
    },
  };

  function setDetail(level) {
    cars.forEach((c) => { c.g.visible = level >= 2 || !c.low; });
    boats.forEach((b) => { if (b.kind === 'sail') b.mesh.visible = level >= 2 || !b.low; });
    gulls.forEach((s) => { s.g.visible = level >= 1 && (level >= 2 || !s.low); });
  }

  function update(dt, t) {
    updateCars(dt);
    updateBoats(t);
    updateGulls(t);
  }

  return { group, update, setDetail, walkers };
}
