#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test v4.0 : bouton « 🏙️ Entrer dans Jeanpip City » de l'Accueil
//  et liens « ← Retour à Jeanpip City » des pages web.
//
//  Travaille dans une COPIE temporaire du projet (aucune donnée réelle
//  touchée). Vérifie : bouton juste sous le solde (lien direct), absent
//  sans villeUrl, rien d'autre retiré de l'Accueil, ≤ 100 blocs côté
//  admin, et calcul du lien de retour dans classeur / tickets / deck.
//
//  Usage : node scripts/test-home-ville.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-home-ville-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

const origLog = console.log;
console.log = () => {};
const home = require(path.join(TMP, 'src', 'home.js'));
console.log = origLog;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const VILLE = 'https://x/jeanpip/ville?t=U1.abc';
const ctx = (extra = {}) => ({
  isAdmin: false, attackPrice: 30, creditsPerJeanpipLabel: '1', targetEmoji: 'jeanpip',
  farmRemainingMs: 0, farmQuota: { used: 0, max: 10, nextFreeMs: 0 }, formatRemaining: String,
  dailyJeanpips: { used: 0, max: 20 }, autoTargets: [],
  collectionUrl: 'https://x/jeanpip/collection/U1?t=c', deckUrl: 'https://x/jeanpip/deck?t=d', ticketsUrl: 'https://x/jeanpip/tickets?t=k',
  ...extra,
});
const villeButtons = (view) => view.blocks.filter((b) => b.accessory && b.accessory.action_id === 'open_ville_web');

// 🏠 Bouton juste sous le solde
const view = home.buildHomeView('U1', ctx({ villeUrl: VILLE }));
const iBalance = view.blocks.findIndex((b) => b.type === 'section' && b.text.text.includes('Ton solde'));
const next = view.blocks[iBalance + 1];
check('le solde est affiché', iBalance >= 0);
check('juste sous le solde : une section', next && next.type === 'section');
check('… avec un bouton « 🏙️ Entrer dans Jeanpip City »', next && next.accessory && next.accessory.type === 'button' && next.accessory.text.text === '🏙️ Entrer dans Jeanpip City');
check('… qui est un lien direct vers la ville', next && next.accessory && next.accessory.url === VILLE && next.accessory.action_id === 'open_ville_web');
check('un seul bouton ville', villeButtons(view).length === 1);

// 🚫 Sans villeUrl (page web désactivée) : pas de bouton
const without = home.buildHomeView('U1', ctx({ villeUrl: null }));
check('sans villeUrl : aucun bouton ville', villeButtons(without).length === 0 && !JSON.stringify(without).includes('Entrer dans Jeanpip City'));

// 🧱 Rien d'autre n'est retiré : même Accueil, le bouton ville en plus
const strip = (v) => JSON.stringify(v.blocks.filter((b) => !(b.accessory && b.accessory.action_id === 'open_ville_web')));
check('rien d\'autre ne change dans l\'Accueil', strip(view) === strip(without) && view.blocks.length === without.blocks.length + 1);
for (const id of ['open_collection_web', 'open_deck_web', 'release_notes_open', 'broadcast_join']) {
  check(`toujours là : ${id}`, JSON.stringify(view).includes(id));
}

// 👑 Admin, Accueil chargé : ≤ 100 blocs (limite Slack)
const arena = {
  userId: 'ADM', stats: { wins: 5, losses: 3, draws: 1, streak: 2 }, streak: null,
  ranking: { top: Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, userId: `P${i}`, wins: 10 - i, winRate: 50 })), me: null },
  cards: 30, next: null, match: null, inQueue: false, outgoing: null,
  incoming: [{ from: 'P1', arena: 'lorient', id: 'c1' }, { from: 'P2', arena: 'lorient', id: 'c2' }],
  deckUrl: 'https://x/jeanpip/deck?t=d', web: true, pause: null,
};
const targets = Array.from({ length: 45 }, (_, i) => ({ id: `T${i}`, fixed: i < 2 }));
const admin = home.buildHomeView('ADM', ctx({ isAdmin: true, villeUrl: VILLE, statsUrl: 'https://x/stats', arena, autoTargets: targets }));
console.log(`   ℹ️ Accueil admin (Arène + 45 cibles auto-react, 0 bug) : ${admin.blocks.length} blocs`);
check('admin chargé : ≤ 100 blocs', admin.blocks.length <= 100);
check('admin : le bouton ville est là aussi', villeButtons(admin).length === 1);

// ← Liens de retour dans les pages web : on exécute chaque script avec un faux navigateur
function runPage(file, href) {
  const url = new URL(href);
  const nodes = {};
  const mk = (id) => {
    if (!nodes[id]) {
      nodes[id] = {
        id, hidden: true, href: '', textContent: '', checked: false, className: '', style: {}, dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        addEventListener() {}, removeEventListener() {}, setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k]; },
        appendChild() {}, append() {}, prepend() {}, replaceChildren() {}, remove() {}, querySelector: () => mk(`${id}>q`), querySelectorAll: () => [],
        getContext: () => null, getBoundingClientRect: () => ({ width: 0, height: 0 }),
      };
    }
    return nodes[id];
  };
  const document = {
    getElementById: mk,
    querySelector: (sel) => mk(sel.replace(/^#/, '')),
    querySelectorAll: () => [],
    createElement: (t) => mk(`new-${t}-${Math.random()}`),
    addEventListener() {}, body: mk('body'), documentElement: mk('html'), hidden: false,
  };
  const sandbox = {
    location: { href: url.href, search: url.search, pathname: url.pathname },
    document,
    URL, URLSearchParams, console: { log() {}, error() {}, warn() {} },
    fetch: () => new Promise(() => {}),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, addEventListener() {}, removeEventListener() {},
    sessionStorage: { getItem: (k) => (k === 'jeanpip.ville' ? V : null), setItem() {} },
    Image: function Image() {}, innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1,
    ArenaTutorial: { open() {} }, ArenaRanking: { open() {} }, DeckEditor: { mount() {} },
  };
  sandbox.window = sandbox;
  try {
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', file), 'utf8'), sandbox, { filename: file });
  } catch (e) {
    console.log(`   ⚠️ ${file} : ${e.message}`);
  }
  return nodes['back-ville'];
}
function htmlHasLink(file) {
  const html = fs.readFileSync(path.join(ROOT, 'public', file), 'utf8');
  return /id="back-ville"[^>]*hidden/.test(html) && html.includes('← Retour à Jeanpip City');
}

const V = 'U1.ab+c/d=';
const cases = [
  ['collection', 'https://x/jeanpip/collection/U1?t=c', '../ville?t='],
  ['tickets', 'https://x/jeanpip/tickets?t=k', 'ville?t='],
  ['deck', 'https://x/jeanpip/deck?t=d', 'ville?t='],
];
for (const [page, base, prefix] of cases) {
  check(`${page}.html : lien « ← Retour à Jeanpip City » caché par défaut`, htmlHasLink(`${page}.html`));
  const shown = runPage(`${page}.js`, `${base}&v=1`);
  check(`${page} avec v= : lien visible vers ${prefix}…`, shown && shown.hidden === false && shown.href === `${prefix}${encodeURIComponent(V)}`);
  const hidden = runPage(`${page}.js`, base);
  check(`${page} sans v= : lien caché`, !hidden || hidden.hidden !== false);
}

try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }   // Windows : fichier ouvert = non supprimable
fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)\n` : '\n🎉 Accueil ville et liens de retour OK\n');
process.exit(failures ? 1 : 0);
