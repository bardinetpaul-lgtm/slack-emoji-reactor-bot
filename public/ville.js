// ═══════════════════════════════════════════════════════════
//  🏙️ VILLE JEANPIP — point d'entrée (module ES)
//
//  1. lit l'état (/api/ville?t=) puis le direct (SSE /api/ville/stream) ;
//  2. construit la scène Three.js : décor, bâtiments du jeu, maisons, vie ;
//  3. étiquettes HTML au-dessus des bâtiments, survol, clic → page ou
//     panneau (Arène, Mairie, carte de visite, Salle des ventes) ;
//  4. jour et nuit à l'heure de Paris, qualité adaptative, repli sans WebGL.
//
//  Les liens sortants ajoutent v=<jeton ville> (lien « ← Retour à la ville »).
//  Les modules de ville-scene/ sont chargés avec la même version (?v=)
//  que ce fichier, pour passer le cache du proxy après une livraison.
// ═══════════════════════════════════════════════════════════
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

window.__villeStarted = true;
const L = window.VilleLogic;
const VERSION = new URL(import.meta.url).search; // « ?v=… » (ou vide)
const params = new URLSearchParams(location.search);
const TOKEN = params.get('t') || '';
// 🔒 Lien de retour des autres pages : le jeton reste dans la mémoire de l'onglet, pas dans l'adresse
try { if (TOKEN) sessionStorage.setItem('jeanpip.ville', TOKEN); } catch { /* navigation privée stricte */ }
const HOUR_OVERRIDE = params.has('hour') ? Number(params.get('hour')) : null;
const FORCE_LOW = params.get('quality') === 'low';
const FORCE_NO_GL = params.get('webgl') === '0'; // essai du repli sans 3D
const MAX_WALKERS = 15;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = (p) => `${p}${p.includes('?') ? '&' : '?'}t=${encodeURIComponent(TOKEN)}`;
const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');

let state = null;
let clockOffset = 0;   // heure serveur − heure locale

// ── 🧑 Petites briques HTML ─────────────────────────────────
function avatarHtml(person, cls = '') {
  const color = `#${L.hashColor(person.userId || person.name || '?').toString(16).padStart(6, '0')}`;
  const ini = esc(((person.name || '?').trim().charAt(0) || '?').toUpperCase());
  if (person.avatar) return `<img class="${cls}" src="${esc(person.avatar)}" alt="" loading="lazy" data-ini="${ini}" data-color="${color}">`;
  return `<span class="ini ${cls}" style="background:${color}">${ini}</span>`;
}
// photo introuvable → initiales (sans gestionnaire en ligne)
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!img || img.tagName !== 'IMG' || !img.dataset.ini) return;
  const span = document.createElement('span');
  span.className = `ini ${img.className}`;
  span.style.background = img.dataset.color;
  span.textContent = img.dataset.ini;
  img.replaceWith(span);
}, true);

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

function go(href) {
  const url = L.withVille(href, TOKEN);
  if (!url) { toast('Cette page n’est pas disponible pour l’instant.'); return; }
  location.href = url; // même onglet
}

// ── 🪟 Panneau ──────────────────────────────────────────────
let lastFocus = null;
function openPanel(title, html) {
  lastFocus = document.activeElement;
  $('panel-title').textContent = title;
  $('panel-body').innerHTML = html;
  $('panel-wrap').hidden = false;
  $('panel-close').focus();
  $('panel-body').querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', (e) => { e.preventDefault(); go(el.getAttribute('data-go')); }));
}
function closePanel() {
  $('panel-wrap').hidden = true;
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
$('panel-close').addEventListener('click', closePanel);
$('panel-wrap').addEventListener('click', (e) => { if (e.target === $('panel-wrap')) closePanel(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('panel-wrap').hidden) closePanel(); });

function arenaPanel() {
  const a = state.arena || {};
  if (a.myMatchUrl) { go(a.myMatchUrl); return; }
  const tv = a.tvUrl;
  openPanel('🏟️ Arène', `
    <p>${tv ? '⚔️ Un combat est en cours en ce moment. Tu peux le regarder en direct sur JP TV.' : 'Aucun combat à l’antenne pour l’instant.'}</p>
    <div class="actions">
      ${tv ? `<a class="btn red" href="#" data-go="${esc(tv)}">📺 Regarder le combat</a>` : ''}
      <a class="btn" href="#" data-go="${esc(state.links.deck || '')}">🃏 Mon deck</a>
    </div>`);
}

function mairiePanel() {
  const m = state.mairie || {};
  const r = m.release || {};
  const ranking = Array.isArray(m.ranking) ? m.ranking : [];
  const meId = state.me && state.me.userId;
  const date = r.date ? new Date(`${r.date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  openPanel('🏢 Locaux Dimsi · Mairie du jeu', `
    <section class="release">
      <h3>📰 Nouveautés${r.version ? ` · version ${esc(r.version)}` : ''}</h3>
      ${r.title ? `<p><b>${esc(r.title)}</b>${date ? ` <span class="muted">(${esc(date)})</span>` : ''}</p>` : ''}
      <ul>${(r.changes || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
    </section>
    <h3>🏆 Classement de l’Arène</h3>
    ${ranking.length ? `<ol class="rank">${ranking.map((p) => `
      <li class="${p.userId === meId ? 'me' : ''}"><span class="pos">${p.rank <= 3 ? ['🥇', '🥈', '🥉'][p.rank - 1] : esc(p.rank)}</span>
        ${avatarHtml(p)} <span>${esc(p.name)}</span>
        <span class="rec">${fmt(p.wins)} V · ${fmt(p.losses)} D</span></li>`).join('')}</ol>`
    : '<p class="muted">Personne n’a encore combattu cette saison.</p>'}
    <div class="actions"><a class="btn gold" href="slack://open">💬 Retour à l’Accueil Slack</a></div>`);
}

async function cardPanel(userId) {
  const mine = state.me && state.me.userId === userId;
  openPanel(mine ? '🏠 Ta maison' : '🏠 Carte de visite', '<p class="muted">Chargement…</p>');
  try {
    const r = await fetch(api(`api/ville/card/${encodeURIComponent(userId)}`));
    const c = await r.json();
    if (!c.ok) throw new Error(c.reason || 'ko');
    $('panel-body').innerHTML = `
      <div class="card-head">${avatarHtml(c)}<div><div class="name">${esc(c.name)}</div>
        <div class="muted">${mine ? 'C’est toi !' : 'Un collègue de Dimsi'}</div></div></div>
      <div class="stats">
        <div class="stat"><b>${c.rank ? `#${esc(c.rank)}` : '—'}</b><span>Rang à l’Arène</span></div>
        <div class="stat"><b>${esc(c.streak || 0)} 🔥</b><span>Série en cours</span></div>
        <div class="stat"><b>${fmt(c.distinctCards)}</b><span>Cartes différentes</span></div>
        <div class="stat"><b>${fmt(c.legendaries)}</b><span>Légendaires</span></div>
        ${c.balance != null ? `<div class="stat gold" style="grid-column:1/-1"><b>${fmt(c.balance)} JP$</b><span>Ton solde (toi seul le vois)</span></div>` : ''}
      </div>
      ${mine && state.links.museum ? `<div class="actions"><a class="btn" href="#" data-go="${esc(state.links.museum)}">🏛️ Ouvrir mon classeur</a></div>` : ''}`;
    $('panel-body').querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', (e) => { e.preventDefault(); go(el.getAttribute('data-go')); }));
  } catch {
    $('panel-body').innerHTML = '<p>La carte de visite ne répond pas. Réessaie dans un instant.</p>';
  }
}

/** Clic sur une destination (bâtiment, étiquette, menu). */
function activate(id, userId) {
  const links = state.links || {};
  switch (id) {
    case 'arene': return arenaPanel();
    case 'boutique': return go(links.boutique);
    case 'banque': return go(links.banque);
    case 'kiosque': return go(links.kiosk);
    case 'musee': return go(links.museum);
    case 'ventes': return go(links.salle);
    case 'dimsi': return mairiePanel();
    case 'house': return cardPanel(userId);
    default: return undefined;
  }
}

/** Sous-titre d'une destination (la Salle des ventes affiche ses enchères en cours). */
function destSub(d) {
  return d.id === 'ventes' ? L.auctionText(state.auctions && state.auctions.open) : d.sub;
}

const DESTS = [
  { id: 'arene', emoji: '🏟️', label: 'Arène', sub: 'Combats, ton deck' },
  { id: 'boutique', emoji: '🎁', label: 'Boutique de boosters', sub: 'Acheter des boosters' },
  { id: 'banque', emoji: '🏦', label: 'Banque', sub: 'Revendre tes doublons' },
  { id: 'kiosque', emoji: '🎟️', label: 'Kiosque', sub: 'Tickets ESSAI !' },
  { id: 'musee', emoji: '🏛️', label: 'Musée', sub: 'Ton classeur' },
  { id: 'ventes', emoji: '🔨', label: 'Salle des ventes', sub: 'Enchères de cartes' },
  { id: 'dimsi', emoji: '🏢', label: 'Locaux Dimsi', sub: 'Mairie : nouveautés, classement' },
];

// ── 📋 Interface hors 3D ────────────────────────────────────
function renderChrome() {
  if (state.me) {
    $('wallet').hidden = false;
    $('balance').textContent = fmt(state.me.balance);
  }
  const p = state.pause;
  $('pause').hidden = !p;
  if (p) $('pause').textContent = `${p.icon || '⏸️'} ${p.title || 'Pause'} : Jeanpip City reste ouverte, mais la Boutique, la Banque et le Kiosque attendent la reprise.`;
  const ul = $('menu-list');
  ul.innerHTML = DESTS.map((d) => `<li><button type="button" data-id="${d.id}"><span>${d.emoji}</span><span>${esc(d.label)}<small>${esc(destSub(d))}</small></span></button></li>`).join('')
    + '<li><button type="button" data-id="slack"><span>💬</span><span>Retour à l’Accueil Slack<small>Ouvre Slack</small></span></button></li>';
  ul.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    ul.hidden = true; $('menu-toggle').setAttribute('aria-expanded', 'false');
    if (b.dataset.id === 'slack') { location.href = 'slack://open'; return; }
    activate(b.dataset.id);
  }));
}
$('menu-toggle').addEventListener('click', () => {
  const ul = $('menu-list');
  ul.hidden = !ul.hidden;
  $('menu-toggle').setAttribute('aria-expanded', String(!ul.hidden));
});

function pushFeed(ev) {
  const li = document.createElement('li');
  li.innerHTML = `${avatarHtml(ev)} <span>${esc(ev.name)}</span> <b>+${fmt(ev.amount)} JP$</b>`;
  const feed = $('feed');
  feed.prepend(li);
  while (feed.children.length > 4) feed.lastChild.remove();
  setTimeout(() => li.remove(), 20000);
}

function nowServer() { return Date.now() + clockOffset; }
function parisHourNow() { return HOUR_OVERRIDE != null && Number.isFinite(HOUR_OVERRIDE) ? HOUR_OVERRIDE : L.parisHour(nowServer()); }
function tickClock() {
  const h = parisHourNow();
  const hh = Math.floor(h); const mm = Math.floor((h - hh) * 60);
  const lt = L.lightAt(h, L.sunTimes(nowServer()));
  const icon = { nuit: '🌙', aube: '🌅', jour: '☀️', 'crépuscule': '🌇' }[lt.phase] || '☀️';
  $('clock').textContent = `${icon} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} à Lorient`;
}

// ── 🚀 Démarrage ────────────────────────────────────────────
async function loadState() {
  const r = await fetch(api('api/ville'), { cache: 'no-store' });
  const s = await r.json().catch(() => null);
  if (!r.ok || !s || !s.ok) {
    const err = new Error(r.status === 403 ? 'forbidden' : 'down');
    err.status = r.status;
    throw err;
  }
  return s;
}

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return Boolean(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

function progress(f, msg) {
  $('loading-bar').style.width = `${Math.round(4 + f * 96)}%`;
  if (msg) $('loading-msg').textContent = msg;
}

async function main() {
  try {
    state = await loadState();
  } catch (e) {
    $('loading').hidden = true;
    window.__villeFallback(e.status === 403
      ? 'Ce lien n’est plus valable : rouvre Jeanpip City depuis l’Accueil Slack.'
      : 'Jeanpip City ne répond pas pour l’instant. Réessaie dans un instant.', { links: {}, arena: {} });
    return;
  }
  clockOffset = Number(state.serverTime) ? Number(state.serverTime) - Date.now() : 0;
  renderChrome();
  tickClock();
  setInterval(tickClock, 15000);
  if (FORCE_NO_GL || !hasWebGL()) {
    window.__villeFallback('Ton navigateur ne sait pas afficher Jeanpip City en 3D (WebGL absent). Voici tous ses bâtiments :', state);
    return;
  }
  try {
    await start3d();
  } catch (e) {
    console.error('[ville] 3D', e);
    window.__villeFallback('Jeanpip City n’a pas pu démarrer en 3D sur cet ordinateur. Voici tous ses bâtiments :', state);
  }
}

// ═══════════════════════════════════════════════════════════
//  🧱 La scène
// ═══════════════════════════════════════════════════════════
async function start3d() {
  progress(0.02, 'Chargement des plans de Jeanpip City');
  const [K, World, Landmarks, Houses, Life] = await Promise.all([
    import(`./ville-scene/kit.js${VERSION}`),
    import(`./ville-scene/world.js${VERSION}`),
    import(`./ville-scene/landmarks.js${VERSION}`),
    import(`./ville-scene/houses.js${VERSION}`),
    import(`./ville-scene/life.js${VERSION}`),
  ]);

  const WANT = {
    suburban: ['building-type-a', 'building-type-b', 'building-type-c', 'building-type-d', 'building-type-f', 'building-type-h', 'building-type-j', 'building-type-l', 'building-type-o', 'building-type-t', 'building-type-u', 'tree-large', 'tree-small'],
    commercial: ['building-a', 'building-b', 'building-c', 'building-d', 'building-e', 'building-f', 'building-g', 'building-h', 'detail-parasol-a'],
    industrial: ['building-g', 'building-h', 'shipping-container-a', 'shipping-container-b', 'shipping-container-c'],
    roads: ['light-curved'],
    cars: ['sedan', 'taxi', 'van', 'hatchback-sports', 'suv', 'police', 'delivery'],
    watercraft: ['boat-fishing-small', 'boat-sail-a', 'boat-sail-b', 'boat-tug-a', 'boat-tug-b', 'boat-row-small', 'buoy', 'buoy-flag', 'ship-cargo-b'],
  };
  const models = await K.loadModels('assets/ville', WANT, {
    lit: ['suburban', 'commercial', 'industrial'],
    onProgress: (f) => progress(0.05 + f * 0.8, 'Livraison des maisons, des voitures et des bateaux'),
  });
  progress(0.88, 'Pose des pavés de la place Dimsi');

  // ── Rendu ─────────────────────────────────────────────────
  const host = $('scene');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, FORCE_LOW ? 1 : 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = !FORCE_LOW;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);
  renderer.domElement.tabIndex = -1;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xcfe4f5, 280, 1100);
  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 1, 4000);

  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x6d7a5a, 0.9);
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -120; sc.right = 120; sc.top = 120; sc.bottom = -120; sc.near = 10; sc.far = 600;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(hemi, sun, sun.target);

  // ── Ville ─────────────────────────────────────────────────
  const meId = state.me && state.me.userId;
  let houses = (state.houses || []).slice();
  const ringOf = (list) => Math.max(2, ...list.map((h) => L.ringFor(Number(h.plot))));
  let ring = ringOf(houses);
  let world = null;
  let lm = null;
  let houseSet = null;
  let trees = null;
  let benches = null;
  const cityRoot = new THREE.Group();
  scene.add(cityRoot);

  lm = Landmarks.create(K, L, models);
  lm.list.forEach((b) => { b.group.traverse((o) => { o.userData.landmark = b.id; }); cityRoot.add(b.group); });

  function freeLotTrees() {
    const used = new Set(houses.map((h) => Number(h.plot)));
    const list = [];
    const rng = K.rand(99);
    for (let n = 0; ; n += 1) {
      const p = L.plotPosition(n);
      if (!p || p.ring > ring) break;
      if (used.has(n)) continue;
      list.push({ x: p.x + (rng() - 0.5) * 2, z: p.z + (rng() - 0.5) * 2, kind: rng() < 0.6 ? 'large' : 'small', y: 0.2 });
      if (rng() < 0.5) list.push({ x: p.x + (rng() - 0.5) * 4, z: p.z + (rng() - 0.5) * 4, kind: 'small', y: 0.2, s: 0.8 });
    }
    return list;
  }

  function buildDistricts() {
    // le survol vise peut-être une maison de l'ancien lot : on l'efface
    if (houseSet) setHover(null);
    // anciens décors retirés puis libérés (GPU) ; les ressources partagées
    // (modèles, matériaux du kit, palette K.mat, photos) sont gardées
    if (world) { cityRoot.remove(world.group); K.disposeGroup(world.group); }
    if (trees) { cityRoot.remove(trees); K.disposeGroup(trees); }
    if (benches) { cityRoot.remove(benches); K.disposeGroup(benches); }
    if (houseSet) { cityRoot.remove(houseSet.group); houseSet.dispose(); }
    world = World.create(K, L, models, { ring });
    cityRoot.add(world.group);
    houseSet = Houses.create(K, L, models, houses, { meId });
    cityRoot.add(houseSet.group);
    trees = World.buildTrees(K, models, [...world.trees, ...lm.trees, ...freeLotTrees()]);
    cityRoot.add(trees);
    benches = World.buildBenches(K, [...world.benches, ...lm.benches]);
    if (benches) cityRoot.add(benches);
    refreshHouseLabels();
    applyQuality();
    if (light) { world.setLight(light); K.applyNight(light.windows); } // nouveaux matériaux : même heure
  }

  const life = { current: null };
  let light = null; // lumière courante (heure de Paris)
  function buildLife() {
    if (life.current) { scene.remove(life.current.group); K.disposeGroup(life.current.group); }
    life.current = Life.create(K, L, models, world);
    scene.add(life.current.group);
  }

  // ── Caméra et commandes ──────────────────────────────────
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 22;
  controls.maxPolarAngle = 1.22;   // jamais au ras du sol
  controls.minPolarAngle = 0.12;
  controls.screenSpacePanning = false;
  controls.zoomSpeed = 0.9;
  controls.listenToKeyEvents(window);
  controls.keyPanSpeed = 14;
  const HOME_TARGET = new THREE.Vector3(-16, 0, 6);
  function homeView() {
    const d = 150 + (ring - 2) * 26;
    return { target: HOME_TARGET.clone(), pos: HOME_TARGET.clone().add(new THREE.Vector3(14, d * 0.86, d * 0.74)) };
  }
  let fly = null;
  function flyTo(target, pos, ms = 1100) {
    fly = { t0: performance.now(), ms, fromT: controls.target.clone(), fromP: camera.position.clone(), toT: target, toP: pos };
  }
  const hv = homeView();
  camera.position.copy(hv.pos);
  controls.target.copy(hv.target);
  $('btn-center').addEventListener('click', () => { const v = homeView(); flyTo(v.target, v.pos); });
  if (meId && houses.some((h) => h.userId === meId)) {
    $('btn-home').hidden = false;
    $('btn-home').addEventListener('click', () => {
      const inf = houseSet && houseSet.info(meId);
      if (!inf) return;
      const t = new THREE.Vector3(inf.x, 0, inf.z);
      flyTo(t, t.clone().add(new THREE.Vector3(10, 24, 26)));
    });
  }

  // ── Étiquettes HTML ──────────────────────────────────────
  const labelsEl = $('labels');
  const labels = new Set(); // { el, pos: Vector3, maxDist, minDist, follow?: () => Vector3 }
  function addLabel(el, pos, opts = {}) {
    labelsEl.appendChild(el);
    const l = { el, pos, ...opts };
    labels.add(l);
    return l;
  }
  function removeLabel(l) { if (!l) return; l.el.remove(); labels.delete(l); }

  const bLabels = new Map();
  for (const b of lm.list) {
    const d = DESTS.find((x) => x.id === b.id);
    if (!d) continue;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'lbl lbl-building';
    el.dataset.id = b.id;
    el.innerHTML = `<span class="em">${d.emoji}</span><span><span class="t">${esc(d.label)}</span><small>${esc(destSub(d))}</small></span>`;
    el.addEventListener('click', () => activate(b.id));
    el.addEventListener('pointerenter', () => setHover({ kind: 'landmark', id: b.id }));
    el.addEventListener('pointerleave', () => setHover(null));
    bLabels.set(b.id, addLabel(el, b.anchor, { maxDist: 700 }));
  }
  const decor = (text, pos, maxDist = 600) => { const el = document.createElement('div'); el.className = 'lbl lbl-decor'; el.textContent = text; addLabel(el, pos, { maxDist }); };
  decor('⚓ Base de Keroman', new THREE.Vector3(L.KEROMAN.x + 4, 15, L.KEROMAN.z + 3));
  decor('🌊 La rade de Lorient', new THREE.Vector3(10, 4, 110));
  decor('🏰 Port-Louis', new THREE.Vector3(60, 10, 224), 900);

  let houseLabels = [];
  function refreshHouseLabels() {
    houseLabels.forEach(removeLabel);
    houseLabels = [];
    if (!houseSet) return;
    for (const inf of houseSet.all()) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `lbl lbl-house${inf.userId === meId ? ' me' : ''}`;
      el.innerHTML = `${avatarHtml(inf)}<span>${inf.userId === meId ? 'Ta maison' : esc(inf.name)}</span>`;
      el.addEventListener('click', () => activate('house', inf.userId));
      el.addEventListener('pointerenter', () => setHover({ kind: 'house', userId: inf.userId }));
      el.addEventListener('pointerleave', () => setHover(null));
      houseLabels.push(addLabel(el, new THREE.Vector3(inf.x, inf.top + 1.6, inf.z), { maxDist: inf.userId === meId ? 700 : 150, house: inf.userId }));
    }
  }

  // ── Arène en direct ──────────────────────────────────────
  // 🔨 enchères en cours : tableau 3D + sous-titre de l'étiquette
  function applyAuctions() {
    const open = state.auctions ? state.auctions.open : 0;
    if (lm.ventes && lm.ventes.setOpen) lm.ventes.setOpen(open);
    const l = bLabels.get('ventes');
    const small = l && l.el.querySelector('small');
    if (small) small.textContent = L.auctionText(open);
  }

  function applyArena() {
    const live = Boolean(state.arena && state.arena.live);
    lm.arena.setLive(live);
    const l = bLabels.get('arene');
    if (l) {
      l.el.classList.toggle('live', live);
      l.el.querySelector('small').textContent = live ? '⚔️ combat en cours' : 'Combats, ton deck';
    }
  }

  // ── Survol et clic (rayon) ───────────────────────────────
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerIn = false;
  let pointerDirty = false;
  let hover = null;
  const hlCache = new WeakMap();
  const swapped = [];
  const hoverRing = new THREE.Mesh(new THREE.RingGeometry(9.4, 10.2, 48), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.85, depthWrite: false }));
  hoverRing.rotation.x = -Math.PI / 2;
  hoverRing.visible = false;
  scene.add(hoverRing);

  function hlMaterial(m) {
    if (!m || !m.isMeshStandardMaterial) return m;
    if (hlCache.has(m)) return hlCache.get(m);
    const c = m.clone();
    c.emissive = new THREE.Color(0xffb347);
    c.emissiveMap = null;
    c.emissiveIntensity = 0.32;
    hlCache.set(m, c);
    return c;
  }
  function setHover(h) {
    const same = (a, b) => (a && b && a.kind === b.kind && a.id === b.id && a.userId === b.userId) || (!a && !b);
    if (same(h, hover)) return;
    // défaire l'ancien
    while (swapped.length) { const [mesh, m] = swapped.pop(); mesh.material = m; }
    if (houseSet) houseSet.highlight(null);
    labels.forEach((l) => l.el.classList.remove('hot'));
    hoverRing.visible = false;
    hover = h;
    host.classList.toggle('hovering', Boolean(h));
    if (!h) return;
    if (h.kind === 'landmark') {
      const b = lm.list.find((x) => x.id === h.id);
      if (b) {
        b.group.traverse((o) => {
          if (o.isMesh && !Array.isArray(o.material) && o.material.isMeshStandardMaterial && !o.material.transparent) {
            swapped.push([o, o.material]); o.material = hlMaterial(o.material);
          }
        });
        const p = b.group.position;
        const small = h.id === 'kiosque';
        hoverRing.scale.setScalar(small ? 0.25 : 1);
        hoverRing.position.set(p.x, 0.3, p.z);
        hoverRing.visible = true;
      }
      const l = bLabels.get(h.id);
      if (l) l.el.classList.add('hot');
    } else if (h.kind === 'house') {
      houseSet.highlight(h.userId);
      const l = houseLabels.find((x) => x.house === h.userId);
      if (l) l.el.classList.add('hot');
      const inf = houseSet.info(h.userId);
      if (inf) { hoverRing.scale.setScalar(0.42); hoverRing.position.set(inf.x, 0.3, inf.z); hoverRing.visible = true; }
    }
  }
  function pick() {
    ray.setFromCamera(pointer, camera);
    const targets = [...lm.list.map((b) => b.group), ...(houseSet ? houseSet.pickables : [])];
    const hits = ray.intersectObjects(targets, true);
    for (const hit of hits) {
      if (hit.object.userData.kind === 'house') {
        const userId = houseSet.userAt(hit);
        if (userId) return { kind: 'house', userId };
      }
      if (hit.object.userData.landmark) return { kind: 'landmark', id: hit.object.userData.landmark };
    }
    return null;
  }
  const canvas = renderer.domElement;
  canvas.addEventListener('pointermove', (e) => {
    pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    pointerIn = true; pointerDirty = true;
  });
  canvas.addEventListener('pointerleave', () => { pointerIn = false; setHover(null); });
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now(), b: e.button }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || down.b !== 0) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 600;
    down = null;
    if (moved > 7 || !quick) return;
    pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    const h = pick();
    if (h) activate(h.kind === 'house' ? 'house' : h.id, h.userId);
  });

  // ── 🚶 Promeneurs ─────────────────────────────────────────
  const queue = new L.WalkerQueue({ max: MAX_WALKERS });
  const walkerLabels = new Map(); // walker.id → label
  function walkStart(w) {
    const inf = w.fromHouse && houseSet ? houseSet.info(w.userId) : null;
    if (inf) return { start: inf.front, door: inf.door };
    return { start: L.DIMSI_START, door: { x: L.DIMSI_START.x, z: L.DIMSI_START.z - 2.2 } };
  }
  function planFor(w, ms) {
    const { start, door } = walkStart(w);
    const path = L.planWalk(start, ms, Math.random, world.bounds);
    return [door, ...path, door];
  }
  function spawnWalker(w) {
    const ms = Math.max(8000, w.until - Date.now());
    life.current.walkers.add(w, planFor(w, ms));
    const el = document.createElement('div');
    el.className = 'lbl lbl-walker';
    el.innerHTML = `<span class="bubble">+${fmt(w.amount)} JP$</span><span class="who">${avatarHtml(w)}<span>${esc(w.name)}</span></span>`;
    const pos = new THREE.Vector3();
    walkerLabels.set(w.id, addLabel(el, pos, { maxDist: 420, follow: () => {
      const p = life.current.walkers.positionOf(w.id);
      return p ? pos.set(p.x, 3.3, p.z) : null;
    } }));
  }
  function retireWalker(w) {
    life.current.walkers.remove(w.id);
    removeLabel(walkerLabels.get(w.id));
    walkerLabels.delete(w.id);
  }
  function onJp(ev) {
    if (!ev || !ev.userId) return;
    pushFeed(ev);
    if (state.me && ev.userId === state.me.userId) {
      state.me.balance = Number(state.me.balance || 0) + Number(ev.amount || 0);
      $('balance').textContent = fmt(state.me.balance);
    }
    if (document.hidden) return; // onglet caché : pas de promeneur fantôme
    const r = queue.add({ ...ev, fromHouse: ev.fromHouse && houseSet && Boolean(houseSet.info(ev.userId)) }, Date.now());
    r.evicted.forEach(retireWalker);
    if (r.action === 'add') spawnWalker(r.walker);
    else if (r.action === 'update') {
      const l = walkerLabels.get(r.walker.id);
      if (l) {
        const b = l.el.querySelector('.bubble');
        b.textContent = `+${fmt(r.walker.amount)} JP$`;
        b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
      }
    }
  }

  // ── 🔴 Direct (SSE) ──────────────────────────────────────
  let refetchTimer = null;
  function refreshState() {
    clearTimeout(refetchTimer);
    refetchTimer = setTimeout(async () => {
      try {
        const s = await loadState();
        state = { ...s, me: { ...s.me } };
        renderChrome();
        applyArena();
        applyAuctions();
      } catch { /* on garde l'état courant */ }
    }, 400);
  }
  function showReplaced() {
    if ($('replaced')) return;
    const box = document.createElement('div');
    box.id = 'replaced';
    box.className = 'pause';
    box.setAttribute('role', 'status');
    box.style.cssText = 'top:auto;bottom:64px;z-index:44;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap';
    const msg = document.createElement('span');
    msg.textContent = 'Jeanpip City est ouverte dans un autre onglet : cette page n’est plus en direct.';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pill-btn';
    btn.textContent = 'Reprendre le direct ici';
    btn.addEventListener('click', () => window.location.reload());
    box.append(msg, btn);
    document.body.appendChild(box);
  }
  function connect() {
    let es;
    try { es = new EventSource(api('api/ville/stream')); } catch { return; }
    es.addEventListener('jp', (e) => { try { onJp(JSON.parse(e.data)); } catch { /* ignoré */ } });
    es.addEventListener('arena', (e) => {
      try {
        const a = JSON.parse(e.data);
        const changed = !state.arena || a.live !== state.arena.live || a.tvUrl !== state.arena.tvUrl;
        state.arena = { ...state.arena, live: Boolean(a.live), tvUrl: a.tvUrl || null };
        applyArena();
        if (changed) refreshState(); // mon lien de combat a pu changer
      } catch { /* ignoré */ }
    });
    es.addEventListener('auctions', (e) => {
      try {
        const a = JSON.parse(e.data);
        const open = Math.max(0, Math.floor(Number(a && a.open) || 0));
        state.auctions = { ...state.auctions, open };
        applyAuctions();
        renderChrome(); // sous-titre du menu « Aller à… »
      } catch { /* ignoré */ }
    });
    // ouverte dans trop d'onglets : le serveur coupe ce flux (le plus ancien).
    // On ne se reconnecte pas (sinon on couperait l'autre onglet) : la ville
    // reste affichée, figée, avec un petit avis pour reprendre le direct ici.
    es.addEventListener('replaced', () => {
      es.close();
      showReplaced();
    });
    es.addEventListener('house', (e) => {
      try {
        const { action, house } = JSON.parse(e.data);
        if (!house || !house.userId) return;
        houses = houses.filter((h) => h.userId !== house.userId);
        if (action === 'add') houses.push(house);
        const r = ringOf(houses);
        const rebuildLife = r !== ring;
        ring = r;
        buildDistricts();
        if (rebuildLife) {
          // la ville change de taille : les promeneurs repartent de zéro
          queue.list().forEach((w) => { queue.remove(w.userId); retireWalker(w); });
          buildLife();
        }
        if (meId && house.userId === meId) $('btn-home').hidden = action !== 'add';
      } catch (err) { console.warn('[ville] maison', err); }
    });
  }

  // ── 🌗 Jour et nuit ──────────────────────────────────────
  function applyLight() {
    light = L.lightAt(parisHourNow(), L.sunTimes(nowServer()));
    hemi.color.setHex(light.hemiSky);
    hemi.groundColor.setHex(light.hemiGround);
    hemi.intensity = light.hemiIntensity;
    sun.color.setHex(light.sunColor);
    sun.intensity = light.sunIntensity;
    sun.position.set(light.sun.x * 260, light.sun.y * 260, light.sun.z * 260).add(controls.target);
    sun.target.position.copy(controls.target);
    scene.fog.color.setHex(light.fog);
    renderer.toneMappingExposure = 0.9 + light.day * 0.15;
    K.applyNight(light.windows);
    world.setLight(light);
    lm.arena.setNight(light.windows);
  }

  // ── ⚙️ Qualité adaptative ────────────────────────────────
  const meter = new L.QualityMeter({ threshold: 30, holdMs: 5000 });
  let quality = FORCE_LOW ? 0 : 2;
  function applyQuality() {
    const shadows = quality >= 2;
    if (renderer.shadowMap.enabled !== shadows) {
      renderer.shadowMap.enabled = shadows;
      sun.castShadow = shadows;
      scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
    }
    if (quality <= 1) renderer.setPixelRatio(1);
    if (world) world.details.forEach((d) => { d.visible = quality >= 1; });
    if (life.current) life.current.setDetail(quality);
  }
  document.addEventListener('visibilitychange', () => meter.reset());

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ── Construction ─────────────────────────────────────────
  buildDistricts();
  buildLife();
  applyArena();
  applyAuctions();
  applyLight();
  setInterval(applyLight, 20000);
  connect();
  progress(1, 'Bienvenue à Jeanpip City !');
  setTimeout(() => { $('loading').hidden = true; }, 250);
  window.__ville = { scene, camera, renderer, controls, get quality() { return quality; }, queue, onJp }; // pour le débogage

  // ── Boucle ───────────────────────────────────────────────
  const clock = new THREE.Clock();
  const v = new THREE.Vector3();
  let t = 0;
  let pickAcc = 0;
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    t += dt;
    const now = performance.now();
    if (!document.hidden) {
      const lvl = meter.tick(now);
      if (lvl != null && lvl < quality) {
        quality = lvl;
        applyQuality();
        console.info(`[ville] qualité réduite → ${quality} (${Math.round(meter.fps || 0)} images/s)`);
      }
    }
    if (fly) {
      const k = Math.min(1, (now - fly.t0) / fly.ms);
      const e = k * k * (3 - 2 * k);
      controls.target.lerpVectors(fly.fromT, fly.toT, e);
      camera.position.lerpVectors(fly.fromP, fly.toP, e);
      if (k >= 1) fly = null;
    }
    controls.maxDistance = 200 + ring * 40;
    controls.update();
    // la caméra reste au-dessus de la ville (et pas sous le sol)
    const b = world.bounds;
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, b.minX, b.maxX);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, b.minZ, 120);
    controls.target.y = 0;
    if (camera.position.y < 6) camera.position.y = 6;

    world.update(t);
    lm.list.forEach((x) => x.update && x.update(t, nowServer()));
    life.current.update(dt, t);
    const finished = life.current.walkers.update(dt);
    const nowMs = Date.now();
    for (const id of finished) {
      const w = queue.list().find((x) => x.id === id);
      if (!w) continue;
      if (w.until - nowMs > 8000) life.current.walkers.replan(id, planFor(w, w.until - nowMs)); // gain en route : un tour de plus
      else { queue.remove(w.userId); retireWalker(w); }
    }
    queue.expire(nowMs).forEach(retireWalker);
    hoverRing.material.opacity = 0.55 + Math.sin(t * 5) * 0.3;

    pickAcc += dt;
    if (pointerIn && pointerDirty && pickAcc > 0.06 && !fly) { pickAcc = 0; pointerDirty = false; setHover(pick()); }

    renderer.render(scene, camera);

    // étiquettes
    const w = window.innerWidth; const h = window.innerHeight;
    const camDist = camera.position.distanceTo(controls.target);
    labelsEl.classList.toggle('far', camDist > 150);
    for (const l of labels) {
      const p = l.follow ? l.follow() : l.pos;
      if (!p) { l.el.hidden = true; continue; }
      v.copy(p).project(camera);
      const dist = camera.position.distanceTo(p);
      const tooFar = (l.maxDist && dist > l.maxDist) || (l.house && camDist > l.maxDist);
      if (v.z > 1 || v.z < -1 || tooFar || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) { l.el.hidden = true; continue; }
      l.el.hidden = false;
      l.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
      l.el.style.zIndex = String(10000 - Math.round(dist));
    }
  }
  frame();
}

main();
