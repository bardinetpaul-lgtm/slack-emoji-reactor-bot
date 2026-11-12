// ═══════════════════════════════════════════════════════════
//  🏙️ VILLE JEANPIP — logique pure (sans Three.js, sans DOM)
//
//    • heure de Paris → lumière (aube, jour, crépuscule, nuit) ;
//    • plan de la ville : îlots de 24 unités, bâtiments au centre,
//      rade au sud, parcelle n → position stable d'une maison ;
//    • file des promeneurs (15 au plus, un seul par joueur) ;
//    • chemins des promeneurs sur les trottoirs (aller puis retour) ;
//    • liens avec le jeton de retour (v=) et liste de repli sans WebGL.
//
//  Node : require('public/ville-logic.js') · Navigateur : window.VilleLogic
// ═══════════════════════════════════════════════════════════
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VilleLogic = api;
}(typeof self !== 'undefined' ? self : this, function () {
  // ── 📐 Plan ───────────────────────────────────────────────
  //  Îlot (i, j) centré en (24·i, 24·j). Les rues passent en x = 24·i + 12
  //  et en z = 24·j + 12 (j ≤ 1 : la rue z = 36 est le quai). Au sud du
  //  quai (z > QUAY_Z) : la rade.
  const BLOCK = 24;
  const ROAD_HALF = 2.4;        // demi-largeur de la chaussée
  const SIDEWALK_OUT = 3.8;     // bord extérieur du trottoir (depuis l'axe)
  const WALK_OFF = 3.1;         // ligne de marche des promeneurs
  const LOT = 7.6;              // côté d'une parcelle
  const LOT_OFF = 4.1;          // décalage d'une parcelle depuis le centre de l'îlot
  const QUAY_Z = 40;            // bord du quai
  const MAX_ROAD_J = 1;         // dernière rangée d'îlots (la rue suivante est le quai)
  const INTERIOR = BLOCK - 2 * SIDEWALK_OUT; // 16,4 : l'intérieur d'un îlot

  // Bâtiments du jeu (îlots du centre) et repères
  const LANDMARKS = [
    { id: 'dimsi', i: 0, j: 0, emoji: '🏢', label: 'Locaux Dimsi', sub: 'Mairie du jeu' },
    { id: 'arene', i: 0, j: -1, emoji: '🏟️', label: 'Arène' },
    { id: 'musee', i: -1, j: 0, emoji: '🏛️', label: 'Musée', sub: 'Ton classeur' },
    { id: 'banque', i: 1, j: 0, emoji: '🏦', label: 'Banque', sub: 'Revente des doublons' },
    { id: 'boutique', i: -1, j: -1, emoji: '🎁', label: 'Boutique de boosters' },
    { id: 'ventes', i: 1, j: -1, emoji: '🔨', label: 'Salle des ventes', sub: 'Enchères de cartes' },
    { id: 'port-w', i: -1, j: 1, emoji: '', label: '' },
    { id: 'port-c', i: 0, j: 1, emoji: '', label: '' },
    { id: 'port-e', i: 1, j: 1, emoji: '', label: '' },
  ].map((l) => ({ ...l, x: l.i * BLOCK, z: l.j * BLOCK }));
  // Le kiosque est sur la place Dimsi (coin sud-est)
  const KIOSK = { id: 'kiosque', x: 6.2, z: 5.6, emoji: '🎟️', label: 'Kiosque', sub: 'Tickets ESSAI !' };
  // Base sous-marine de Keroman : terre-plein au sud-ouest, sur la rade
  const KEROMAN = { id: 'keroman', x: -78, z: 54, w: 52, d: 28 };
  // Départ des promeneurs sans maison : trottoir devant la place Dimsi
  const DIMSI_START = { x: 0, z: BLOCK / 2 - WALK_OFF };

  const isCore = (i, j) => Math.abs(i) <= 1 && j >= -1 && j <= 1;

  function footprints() {
    const list = LANDMARKS.map((l) => ({ id: l.id, x: l.x, z: l.z, w: INTERIOR, d: INTERIOR }));
    list.push({ id: KEROMAN.id, x: KEROMAN.x, z: KEROMAN.z, w: KEROMAN.w, d: KEROMAN.d });
    list.push({ id: 'rade', x: 0, z: QUAY_Z + 5000, w: 1e6, d: 10000 });
    return list;
  }

  function lotOverlaps(p, f) {
    const h = LOT / 2;
    return Math.abs(p.x - f.x) < h + f.w / 2 && Math.abs(p.z - f.z) < h + f.d / 2;
  }

  // Distance à l'axe de la rue la plus proche (x et z séparément)
  const nearestLine = (v) => Math.round((v - BLOCK / 2) / BLOCK) * BLOCK + BLOCK / 2;
  function distX(x) { return Math.abs(x - nearestLine(x)); }
  function distZ(z) {
    const line = Math.min(nearestLine(z), MAX_ROAD_J * BLOCK + BLOCK / 2);
    return Math.abs(z - line);
  }

  /** Le rectangle centré (x, z) de demi-côté `margin` touche-t-il une chaussée ou un trottoir ? */
  function onRoad(x, z, margin = 0) {
    return distX(x) < SIDEWALK_OUT + margin || distZ(z) < SIDEWALK_OUT + margin;
  }

  function onSidewalk(x, z) {
    const eps = 1e-6;
    const dx = distX(x);
    const dz = distZ(z);
    return (dx >= ROAD_HALF - eps && dx <= SIDEWALK_OUT + eps) || (dz >= ROAD_HALF - eps && dz <= SIDEWALK_OUT + eps);
  }

  // ── 🏠 Parcelles ──────────────────────────────────────────
  //  Îlots résidentiels rangés par anneau (distance au centre), puis par
  //  distance et par angle. 4 parcelles par îlot. Stable : n → toujours
  //  la même place, quelle que soit la taille de la ville.
  const ringBlocks = [];   // cache : anneau r → îlots triés
  function blocksOfRing(r) {
    if (ringBlocks[r]) return ringBlocks[r];
    const list = [];
    for (let i = -r; i <= r; i += 1) {
      for (let j = -r; j <= MAX_ROAD_J; j += 1) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r || isCore(i, j)) continue;
        const x = i * BLOCK;
        const z = j * BLOCK;
        if (footprints().some((f) => f.id === KEROMAN.id && lotOverlaps({ x, z }, { ...f, w: f.w + INTERIOR, d: f.d + INTERIOR }))) continue;
        list.push({ i, j, x, z, dist: Math.hypot(x, z), ang: Math.atan2(z, x) });
      }
    }
    list.sort((a, b) => a.dist - b.dist || a.ang - b.ang);
    ringBlocks[r] = list;
    return list;
  }

  const LOTS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

  function plotPosition(n) {
    if (!Number.isInteger(n) || n < 0) return null;
    let b = Math.floor(n / 4);
    let r = 1;
    while (r < 500) {
      const ring = blocksOfRing(r);
      if (b < ring.length) {
        const blk = ring[b];
        const lots = LOTS.map(([sx, sz]) => ({ sx, sz, x: blk.x + sx * LOT_OFF, z: blk.z + sz * LOT_OFF }))
          .sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z) || Math.atan2(p.z, p.x) - Math.atan2(q.z, q.x));
        const lot = lots[n % 4];
        // la maison regarde la rue nord ou sud de l'îlot (côté de sa parcelle)
        const frontZ = blk.z + lot.sz * (BLOCK / 2 - WALK_OFF);
        return {
          n, ring: r, block: [blk.i, blk.j], x: lot.x, z: lot.z,
          rot: lot.sz > 0 ? 0 : Math.PI, // le devant du modèle regarde +z
          front: { x: lot.x, z: frontZ },
        };
      }
      b -= ring.length;
      r += 1;
    }
    return null;
  }

  function ringFor(n) {
    const p = plotPosition(n);
    return p ? p.ring : 1;
  }

  /** Limites de la ville bâtie jusqu'à l'anneau R (lignes de marche comprises). */
  function boundsForRing(R) {
    const r = Math.max(2, R);
    return {
      ring: r,
      minX: -r * BLOCK - BLOCK / 2 - WALK_OFF,
      maxX: r * BLOCK + BLOCK / 2 + WALK_OFF,
      minZ: -r * BLOCK - BLOCK / 2 - WALK_OFF,
      maxZ: MAX_ROAD_J * BLOCK + BLOCK / 2 + WALK_OFF,
    };
  }

  /** Axes des rues jusqu'à l'anneau R. */
  function roadLines(R) {
    const r = Math.max(2, R);
    const xs = [];
    const zs = [];
    for (let i = -r - 1; i <= r; i += 1) xs.push(i * BLOCK + BLOCK / 2);
    for (let j = -r - 1; j <= MAX_ROAD_J; j += 1) zs.push(j * BLOCK + BLOCK / 2);
    return { xs, zs };
  }

  // ── 🚶 Chemins sur les trottoirs ──────────────────────────
  //  Nœud = coin de trottoir (X + sx·3,1 ; Z + sz·3,1) autour d'un carrefour.
  const nodePos = (nd) => ({ x: nd.ix * BLOCK + BLOCK / 2 + nd.sx * WALK_OFF, z: nd.jz * BLOCK + BLOCK / 2 + nd.sz * WALK_OFF });
  const inBounds = (p, b) => p.x >= b.minX - 1e-6 && p.x <= b.maxX + 1e-6 && p.z >= b.minZ - 1e-6 && p.z <= b.maxZ + 1e-6;

  function neighbors(nd) {
    const { ix, jz, sx, sz } = nd;
    return [
      { ix: ix + (sx > 0 ? 1 : -1), jz, sx: -sx, sz, along: true },   // le long du trottoir (x)
      { ix, jz: jz + (sz > 0 ? 1 : -1), sx, sz: -sz, along: true },   // le long du trottoir (z)
      { ix, jz, sx: -sx, sz, along: false },                          // traverser la rue X
      { ix, jz, sx, sz: -sz, along: false },                          // traverser la rue Z
    ];
  }

  /** Coin de trottoir le plus proche, sur la même ligne que le point p. */
  function nodeNear(p) {
    const cands = [];
    const Xl = Math.floor((p.x - BLOCK / 2) / BLOCK);
    const Zl = Math.floor((p.z - BLOCK / 2) / BLOCK);
    for (const ix of [Xl, Xl + 1]) for (const jz of [Zl, Zl + 1]) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const nd = { ix, jz, sx, sz };
      const q = nodePos(nd);
      if (Math.abs(q.x - p.x) < 1e-6 || Math.abs(q.z - p.z) < 1e-6) cands.push({ nd, d: Math.hypot(q.x - p.x, q.z - p.z) });
    }
    cands.sort((a, b) => a.d - b.d);
    return cands.length ? cands[0].nd : null;
  }

  /**
   * Promenade : du point de départ (sur un trottoir) jusqu'à un coin, puis
   * de coin en coin au hasard, et retour par le même chemin.
   * → liste de points { x, z } (le premier et le dernier = départ).
   */
  function planWalk(start, durationMs, rng = Math.random, bounds = boundsForRing(3), speed = 2) {
    const half = (speed * durationMs) / 1000 / 2;
    const out = [{ x: start.x, z: start.z }];
    let cur = nodeNear(start);
    if (!cur || !inBounds(nodePos(cur), bounds)) return [out[0], { x: start.x, z: start.z }];
    let prev = null;
    let dist = Math.hypot(nodePos(cur).x - start.x, nodePos(cur).z - start.z);
    out.push(nodePos(cur));
    let guard = 0;
    while (dist < half && guard < 200) {
      guard += 1;
      const opts = neighbors(cur).filter((nb) => inBounds(nodePos(nb), bounds)
        && !(prev && nb.ix === prev.ix && nb.jz === prev.jz && nb.sx === prev.sx && nb.sz === prev.sz));
      if (!opts.length) break;
      // surtout le long des trottoirs, parfois une traversée
      const along = opts.filter((o) => o.along);
      const pool = along.length && rng() < 0.78 ? along : opts;
      const next = pool[Math.floor(rng() * pool.length) % pool.length];
      const a = nodePos(cur);
      const b = nodePos(next);
      dist += Math.hypot(b.x - a.x, b.z - a.z);
      out.push(b);
      prev = cur;
      cur = next;
    }
    const back = out.slice(0, -1).reverse();
    return out.concat(back);
  }

  // ── 🕰️ Heure de Paris et lumière ──────────────────────────
  let fmt = null;
  function parisParts(ms) {
    if (!fmt) {
      fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    }
    const o = {};
    for (const p of fmt.formatToParts(new Date(ms))) o[p.type] = p.value;
    return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
  }

  function parisHour(ms) {
    const p = parisParts(ms);
    return p.h + p.mi / 60 + p.s / 3600;
  }

  /** Lever et coucher du soleil à Lorient (approximation), en heure de Paris. */
  function sunTimes(ms) {
    const p = parisParts(ms);
    const utcH = new Date(ms).getUTCHours() + new Date(ms).getUTCMinutes() / 60;
    let offset = Math.round(((p.h + p.mi / 60) - utcH + 24) % 24);
    if (offset > 12) offset -= 24;
    const doy = (Date.UTC(p.y, p.mo - 1, p.d) - Date.UTC(p.y, 0, 0)) / 86400000;
    const len = 12 + 3.9 * Math.sin((2 * Math.PI * (doy - 80)) / 365);
    const noon = 12.22 + offset;
    return { rise: noon - len / 2, set: noon + len / 2 };
  }

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  function mix(c1, c2, t) {
    const r = Math.round(lerp((c1 >> 16) & 255, (c2 >> 16) & 255, t));
    const g = Math.round(lerp((c1 >> 8) & 255, (c2 >> 8) & 255, t));
    const b = Math.round(lerp(c1 & 255, c2 & 255, t));
    return (r << 16) | (g << 8) | b;
  }

  /**
   * Lumière à l'heure h (heure de Paris, décimale).
   * opts = { rise, set } (heures de lever/coucher ; défaut 7 h / 19 h).
   */
  function lightAt(hour, opts = {}) {
    const rise = opts.rise != null ? opts.rise : 7;
    const set = opts.set != null ? opts.set : 19;
    const h = ((Number(hour) % 24) + 24) % 24;
    const isDay = h >= rise && h < set;
    let t;
    let elev;
    if (isDay) {
      t = (h - rise) / (set - rise);
      elev = Math.sin(Math.PI * t);
    } else {
      const nightLen = 24 - (set - rise);
      t = (((h - set) + 24) % 24) / nightLen;
      elev = -Math.sin(Math.PI * t);
    }
    // direction de l'astre : se lève à l'est (+x), passe au sud (+z, côté rade)
    const ang = Math.PI * t;
    const sx = Math.cos(ang) * 0.75 * (isDay ? 1 : -1);
    const sy = Math.max(0.18, Math.abs(Math.sin(ang)));
    const sz = 0.45;
    const n = Math.hypot(sx, sy, sz);
    const day = smooth(-0.1, 0.3, elev);       // 0 nuit → 1 plein jour
    const golden = clamp01(1 - Math.abs(elev - 0.08) / 0.3) * (isDay || elev > -0.15 ? 1 : 0);
    const windows = 1 - smooth(-0.1, 0.12, elev);
    let phase = 'jour';
    if (elev < -0.12) phase = 'nuit';
    else if (elev < 0.2) phase = h < (rise + set) / 2 ? 'aube' : 'crépuscule';

    const sunCol = mix(mix(0x8fa6d8, 0xffffff, day), 0xffa060, golden * 0.8);
    return {
      hour: h, phase, night: elev < -0.12, sunBelow: elev < 0,
      day, windows, lamps: windows > 0.35,
      sun: { x: sx / n, y: sy / n, z: sz / n },
      sunIntensity: lerp(0.6, 2.6, day),
      sunColor: sunCol,
      hemiIntensity: lerp(0.75, 0.9, day),
      hemiSky: mix(0x4a5f9a, 0xcfe6ff, day),
      hemiGround: mix(0x262b3d, 0x6d7a5a, day),
      skyTop: mix(mix(0x070b1e, 0x3d8fe0, day), 0x5a4a8a, golden * 0.5),
      skyBottom: mix(mix(0x1a2240, 0xbfe3ff, day), 0xffb37a, golden * 0.85),
      fog: mix(mix(0x141a33, 0xcfe4f5, day), 0xe8b08a, golden * 0.6),
      water: mix(0x1a4670, 0x2f8fb8, day),
      stars: 1 - smooth(-0.25, 0.02, elev),
    };
  }

  // ── 🚶 File des promeneurs ────────────────────────────────
  class WalkerQueue {
    constructor({ max = 15, rng = Math.random, minMs = 30000, maxMs = 60000, extendMs = 15000 } = {}) {
      this.max = max;
      this.rng = rng;
      this.minMs = minMs;
      this.maxMs = maxMs;
      this.extendMs = extendMs;
      this.items = [];
      this.seq = 0;
    }

    /** → { action: 'add'|'update'|'ignore', walker, evicted: [walker] } */
    add(ev, now = Date.now()) {
      if (!ev || !ev.userId) return { action: 'ignore', walker: null, evicted: [] };
      const amount = Number(ev.amount) || 0;
      const found = this.items.find((w) => w.userId === ev.userId);
      if (found) {
        found.amount += amount;
        if (ev.name) found.name = ev.name;
        if (ev.avatar !== undefined) found.avatar = ev.avatar;
        found.until = Math.max(found.until, now + this.extendMs);
        found.bumpedAt = now;
        return { action: 'update', walker: found, evicted: [] };
      }
      const dur = this.minMs + Math.floor(this.rng() * (this.maxMs - this.minMs + 1));
      const walker = {
        id: ++this.seq, userId: ev.userId, name: ev.name || 'Joueur', avatar: ev.avatar || null,
        amount, fromHouse: Boolean(ev.fromHouse), since: now, until: now + dur, bumpedAt: now,
      };
      this.items.push(walker);
      const evicted = [];
      while (this.items.length > this.max) evicted.push(this.items.shift()); // le plus ancien rentre
      return { action: 'add', walker, evicted };
    }

    /** Retire les promenades finies → liste des promeneurs qui rentrent. */
    expire(now = Date.now()) {
      const gone = this.items.filter((w) => w.until <= now);
      if (gone.length) this.items = this.items.filter((w) => w.until > now);
      return gone;
    }

    remove(userId) {
      const w = this.items.find((x) => x.userId === userId);
      this.items = this.items.filter((x) => x.userId !== userId);
      return w || null;
    }

    list() {
      return this.items.slice();
    }
  }

  // ── 🔗 Liens ──────────────────────────────────────────────
  /** Ajoute v=<jeton ville> à un lien (pour le « ← Retour à la ville »). */
  function withVille(href, token) {
    if (!href || typeof href !== 'string') return null;
    if (/^slack:/i.test(href) || !token) return href;
    const hashAt = href.indexOf('#');
    const base = hashAt >= 0 ? href.slice(0, hashAt) : href;
    const hash = hashAt >= 0 ? href.slice(hashAt) : '';
    // 🔒 le jeton (qui permet d'acheter) ne passe jamais dans l'adresse : « v=1 » suffit,
    //    la page d'arrivée le lit dans sessionStorage (rangé par ville.js).
    return `${base}${base.includes('?') ? '&' : '?'}v=1${hash}`;
  }

  /** Texte du panneau de la Salle des ventes : « Aucune enchère », « 1 enchère en cours », « 3 enchères en cours ». */
  function auctionText(open) {
    const n = Math.max(0, Math.floor(Number(open) || 0));
    if (!n) return 'Aucune enchère';
    return `${n} enchère${n > 1 ? 's' : ''} en cours`;
  }

  /** Liste simple de destinations (navigateur sans 3D). */
  function fallbackLinks(state, token) {
    const s = state || {};
    const links = s.links || {};
    const arena = s.arena || {};
    const out = [];
    const add = (emoji, label, href) => { const h = withVille(href, token); if (h) out.push({ emoji, label, href: h }); };
    if (arena.myMatchUrl) add('⚔️', 'Mon combat en cours', arena.myMatchUrl);
    add('🎁', 'Boutique de boosters', links.boutique);
    add('🏦', 'Banque (revente des doublons)', links.banque);
    add('🎟️', 'Kiosque (tickets ESSAI !)', links.kiosk);
    add('🏛️', 'Musée (ton classeur)', links.museum);
    add('🔨', `Salle des ventes (${auctionText(s.auctions && s.auctions.open).toLowerCase()})`, links.salle);
    add('🃏', 'Arène : mon deck', links.deck);
    if (arena.tvUrl) add('📺', 'Regarder le combat (JP TV)', arena.tvUrl);
    out.push({ emoji: '💬', label: 'Retour à l\'Accueil Slack', href: 'slack://open' });
    return out;
  }

  // ── 🎲 Divers ─────────────────────────────────────────────
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < String(s).length; i += 1) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /** Couleur stable par joueur (entier 0xRRGGBB). */
  function hashColor(userId) {
    const h = hashStr(userId);
    const hue = (h % 360) / 360;
    const s = 0.55 + ((h >> 9) % 30) / 100;
    const l = 0.45 + ((h >> 15) % 15) / 100;
    const f = (n) => {
      const k = (n + hue * 12) % 12;
      const a = s * Math.min(l, 1 - l);
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return (f(0) << 16) | (f(8) << 8) | f(4);
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Moyenne glissante d'images/s → niveau de qualité (2 = complet, 1 = réduit, 0 = minimal). */
  class QualityMeter {
    constructor({ threshold = 30, holdMs = 5000 } = {}) {
      this.threshold = threshold;
      this.holdMs = holdMs;
      this.level = 2;
      this.lowSince = null;
      this.frames = [];
    }

    /** Appelé à chaque image ; → nouveau niveau si on doit baisser, sinon null. */
    tick(now) {
      this.frames.push(now);
      while (this.frames.length && now - this.frames[0] > 1000) this.frames.shift();
      if (this.frames.length < 2 || now - this.frames[0] < 900) return null;
      const fps = (this.frames.length - 1) / ((now - this.frames[0]) / 1000);
      this.fps = fps;
      if (fps >= this.threshold) { this.lowSince = null; return null; }
      if (this.lowSince == null) this.lowSince = now;
      if (now - this.lowSince >= this.holdMs && this.level > 0) {
        this.level -= 1;
        this.lowSince = null;
        this.frames = [];
        return this.level;
      }
      return null;
    }

    /** L'onglet était caché : on repart de zéro (pas de fausse alerte). */
    reset() { this.frames = []; this.lowSince = null; }
  }

  return {
    BLOCK, ROAD_HALF, SIDEWALK_OUT, WALK_OFF, LOT, LOT_OFF, QUAY_Z, MAX_ROAD_J, INTERIOR,
    LANDMARKS, KIOSK, KEROMAN, DIMSI_START,
    footprints, lotOverlaps, onRoad, onSidewalk, isCore,
    plotPosition, ringFor, boundsForRing, roadLines, blocksOfRing,
    nodeNear, nodePos, neighbors, planWalk,
    parisParts, parisHour, sunTimes, lightAt,
    WalkerQueue, QualityMeter,
    withVille, fallbackLinks, auctionText, hashColor, hashStr, mulberry32,
  };
}));
