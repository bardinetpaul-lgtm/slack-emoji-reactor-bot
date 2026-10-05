#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test des routes web de l'Arène (src/game/arenaWeb.js via web.js)
//
//  Vrai serveur HTTP, vrais flux SSE, vraies requêtes POST, dans une
//  COPIE temporaire du projet : préparation → « Prêt » des deux joueurs
//  → combat (setup allégé, clés courtes) → pose → abandon → fin réglée.
//  + liens signés, refus, page et API « Mon deck ».
//
//  Usage : node scripts/test-arena-web.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-arena-web-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

process.env.WEB_PUBLIC_URL = 'http://jeanpip.test';
process.env.WEB_SECRET = 'test-secret';
let PORT = 0;   // port libre attribué par le système (évite les collisions)

const origLog = console.log;
console.log = () => {};
const web = require(path.join(TMP, 'src', 'web.js'));
const arenaWeb = require(path.join(TMP, 'src', 'game', 'arenaWeb.js'));
const matches = require(path.join(TMP, 'src', 'game', 'matches.js'));
const collections = require(path.join(TMP, 'src', 'collections.js'));
const credits = require(path.join(TMP, 'src', 'credits.js'));
const media = require(path.join(TMP, 'src', 'media.js'));
const wire = require(path.join(TMP, 'public', 'arena-wire.js'));
console.log = origLog;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const quiet = { info: () => {}, warn: () => {}, error: (...a) => console.error(...a) };
const client = { users: { info: async ({ user }) => ({ user: { profile: { display_name: user === 'UA' ? 'Paul' : 'Julie', image_72: `https://avatars.test/${user}.png` } } }) } };

// ─── Outils HTTP ───
function request(method, pathQ, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: `/${pathQ}`, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* HTML */ }
        resolve({ status: res.statusCode, headers: res.headers, body: data, json });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/** Ouvre un flux SSE ; accumule les événements { event, data }. */
function openStream(pathQ) {
  const events = [];
  const decoder = wire.createDecoder();   // comme la page : états différentiels
  let resolveHead;
  const head = new Promise((r) => { resolveHead = r; });
  const req = http.get({ host: '127.0.0.1', port: PORT, path: `/${pathQ}` }, (res) => {
    resolveHead(res);
    let buf = '';
    res.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(block);
        const data = /^data: (.+)$/m.exec(block);
        if (!ev || !data) continue;
        if (ev[1] === 'setup') decoder.reset();
        const parsed = JSON.parse(data[1]);
        events.push({ event: ev[1], data: ev[1] === 'state' ? decoder.decode(parsed) : parsed, raw: data[1].length });
      }
    });
  });
  req.on('error', () => {});
  return { events, head, close: () => req.destroy() };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await wait(50);
  }
  return false;
}
const lastState = (s) => [...s.events].reverse().find((e) => e.event === 'state');
const pathOf = (url) => url.replace('http://jeanpip.test/', '');

(async () => {
  // Deux joueurs avec 10 vraies cartes du catalogue chacun
  const bank = media.getAllMedia();
  collections.addCards('UA', bank.slice(0, 10));
  collections.addCards('UB', bank.slice(10, 20));

  const server = web.startWebServer({ client, logger: quiet, port: 0, force: true });
  await until(() => server.address());
  PORT = server.address().port;

  const m = matches.createMatchFor('UA', 'UB', Date.now(), { arena: 'port' });
  const urlA = arenaWeb.buildArenaUrl(m.id, 'UA');
  const urlB = arenaWeb.buildArenaUrl(m.id, 'UB');
  check('lien signé propre à chaque joueur', urlA && urlB && urlA !== urlB && urlA.startsWith('http://jeanpip.test/arena/'));

  // 📄 Page
  const page = await request('GET', pathOf(urlA));
  check('page de l\'arène servie', page.status === 200 && page.body.includes('arena.js?v='));
  check('assets versionnés (aucun __ASSET_VERSION__ restant)', !page.body.includes('__ASSET_VERSION__'));
  const [, v1] = /arena-board\.js\?v=([a-f0-9]+)/.exec(page.body) || [];
  const [, v2] = /arena\.js\?v=([a-f0-9]+)/.exec(page.body) || [];
  check('une seule version pour tous les fichiers de l\'arène', v1 && v1 === v2);

  // 🔐 Refus
  const t = new URL(urlA).searchParams.get('t');
  const forged = `UB.${t.split('.')[1]}`;
  check('jeton forgé (autre joueur) refusé', (await request('POST', `api/arena/${m.id}/action?t=${encodeURIComponent(forged)}`, { type: 'ready', ready: false })).status === 403);
  check('jeton d\'un autre combat refusé (403, sans dire si le combat existe)', (await request('POST', `api/arena/zzz/action?t=${encodeURIComponent(t)}`, { type: 'forfeit' })).status === 403);
  const tz = new URL(arenaWeb.buildArenaUrl('zzz', 'UA')).searchParams.get('t');
  check('combat inconnu (jeton valide) : 404', (await request('POST', `api/arena/zzz/action?t=${encodeURIComponent(tz)}`, { type: 'forfeit' })).status === 404);

  // 📡 Flux SSE — préparation
  const sA = openStream(`api/arena/${m.id}/stream?t=${encodeURIComponent(t)}`);
  const resA = await sA.head;
  check('flux SSE : en-têtes anti-tampon et anti-compression', resA.headers['content-type'].startsWith('text/event-stream')
    && /no-transform/.test(resA.headers['cache-control']) && resA.headers['x-accel-buffering'] === 'no');
  await until(() => lastState(sA));
  const setupPrep = sA.events.find((e) => e.event === 'setup');
  check('préparation : setup avec noms Slack + catalogue = mes cartes seulement', setupPrep && setupPrep.data.names.you === 'Paul' && setupPrep.data.names.opponent === 'Julie'
    && setupPrep.data.catalogue.length === 10 && setupPrep.data.catalogue.every((c) => c.copies > 0));
  const own = setupPrep.data.catalogue.filter((c) => c.copies > 0);
  check('catalogue : mes exemplaires + vraies images', own.length === 10 && own.every((c) => c.image === null || typeof c.image === 'string'));
  check('préparation : arène, decks et statut', lastState(sA).data.phase === 'preparing' && lastState(sA).data.arena === 'port' && lastState(sA).data.decks.length === 3);

  const sB = openStream(`api/arena/${m.id}/stream?t=${encodeURIComponent(new URL(urlB).searchParams.get('t'))}`);
  await until(() => lastState(sB));

  // 🃏 Decks + Prêt
  const tB = new URL(urlB).searchParams.get('t');
  const deckA = own.slice(0, 8).map((c) => c.url);
  const savedDecks = await request('POST', `api/arena/${m.id}/action?t=${encodeURIComponent(t)}`, { type: 'decks', active: 1, decks: [{ name: 'Rush', cards: [] }, { name: 'Test', cards: deckA }, { name: 'X', cards: [] }] });
  check('decks enregistrés depuis la préparation', savedDecks.json && savedDecks.json.ok);
  const bad = await request('POST', `api/arena/${m.id}/action?t=${encodeURIComponent(t)}`, { type: 'ready', ready: true, urls: deckA.slice(0, 7) });
  check('« Prêt » refusé avec 7 cartes', bad.json && bad.json.ok === false && bad.json.reason === 'size');
  await request('POST', `api/arena/${m.id}/action?t=${encodeURIComponent(t)}`, { type: 'ready', ready: true, urls: deckA });
  const readyB = await request('POST', `api/arena/${m.id}/action?t=${encodeURIComponent(tB)}`, { type: 'ready', ready: true, urls: bank.slice(10, 18).map((c) => c.url) });
  check('« Prêt » accepté avec 8 cartes', readyB.json && readyB.json.ok);

  // ⚔️ Combat
  const started = await until(() => lastState(sA) && lastState(sA).data.phase === 'running');
  check('les deux prêts : le combat démarre', started);
  const setupFight = [...sA.events].reverse().find((e) => e.event === 'setup');
  check('combat : setup envoyé une fois, avec les dessins des 16 cartes', setupFight && setupFight.data.symbols.includes('<symbol') && Object.keys(setupFight.data.sprites).length >= 16);
  const run = lastState(sA).data;
  check('combat : mon deck est celui choisi', run.players[run.you].hand.every((c) => deckA.includes(c.url)));
  check('allègement : main réduite à l\'utile', run.players[run.you].hand.every((c) => c.hp === undefined && typeof c.cost === 'number' && c.url));
  check('allègement : pas d\'URL longue pour les bâtiments', run.buildings.every((b) => !b.url || b.url.length <= 5));

  const hand = run.players[run.you].hand;
  const card = hand.find((c) => c.cost <= run.players[run.you].elixir && !['sort', 'pompe'].includes(c.archetype)) || hand[0];
  const before = sB.events.length;
  const dep = await request('POST', `api/arena/${m.id}/action?t=${encodeURIComponent(t)}`, { type: 'deploy', url: card.url, lane: 1 });
  check('pose acceptée', dep.json && dep.json.ok);
  await until(() => sB.events.slice(before).some((e) => e.event === 'state' && (e.data.events || []).some((x) => x.type === 'deploy')), 1500);
  const seen = sB.events.slice(before).find((e) => e.event === 'state' && (e.data.events || []).some((x) => x.type === 'deploy'));
  check('l\'adversaire voit la pose tout de suite', Boolean(seen));
  check('allègement : l\'événement de pose porte une clé courte', seen && seen.data.events.find((x) => x.type === 'deploy').url.length <= 5);
  await until(() => (lastState(sA).data.units || []).length > 0, 2500);
  const u = lastState(sA).data.units[0];
  check('unités : clé courte + chiffres arrondis', u && u.url.length <= 5 && String(u.y).split('.')[1] === undefined || String(u.y).split('.')[1].length <= 2);
  check('refus d\'une pose invalide avec la raison', (await request('POST', `api/arena/${m.id}/action?t=${encodeURIComponent(t)}`, { type: 'deploy', url: 'nope', lane: 0 })).json.reason === 'not_in_hand');

  const runRaw = sA.events.filter((e) => e.event === 'state' && e.data.phase === 'running').map((e) => e.raw);
  check(`débit : ~${Math.round(runRaw.reduce((a, b) => a + b, 0) / runRaw.length)} o par état (envoi différentiel)`, runRaw.length > 3 && runRaw.slice(2).every((n) => n < 2500));

  // 🏁 Abandon → fin réglée
  await request('POST', `api/arena/${m.id}/action?t=${encodeURIComponent(t)}`, { type: 'forfeit' });
  const ended = await until(() => lastState(sB).data.phase === 'ended');
  check('abandon : fin de combat poussée aux deux joueurs', ended && lastState(sA).data.phase === 'ended');
  // 10 JP$ de victoire + 1 JP$ du 1er jour de série
  check('fin : récapitulatif et récompense du vainqueur', lastState(sB).data.summary.you.credits === 10 && credits.getBalance('UB') === 11);
  check('fin : série du jour dans le récapitulatif', lastState(sB).data.summary.you.streak.step === 1 && lastState(sA).data.summary.you.streak.credits === 1);

  // 🔁 Un seul flux par joueur
  const sA2 = openStream(`api/arena/${m.id}/stream?t=${encodeURIComponent(t)}`);
  await until(() => sA2.events.length > 0);
  check('rouvrir le flux : le nouveau reçoit l\'état', sA2.events.some((e) => e.event === 'state'));

  // 🃏 « Mon deck » hors combat
  const deckUrl = arenaWeb.buildDeckUrl('UA');
  check('lien « Mon deck » signé', deckUrl && deckUrl.startsWith('http://jeanpip.test/deck?t='));
  const dt = new URL(deckUrl).searchParams.get('t');
  const deckPage = await request('GET', pathOf(deckUrl));
  check('page « Mon deck » servie', deckPage.status === 200 && deckPage.body.includes('deck-editor.js?v='));
  const dget = await request('GET', `api/deck?t=${encodeURIComponent(dt)}`);
  const ownedA = collections.getCollection('UA').filter((c) => c.count > 0).length;
  check('API deck : mes cartes seulement (aucune non possédée) + mes decks', dget.json && dget.json.catalogue.length === ownedA && dget.json.catalogue.every((c) => c.copies > 0) && dget.json.decks.length === 3 && dget.json.active === 1);
  const dpost = await request('POST', `api/deck?t=${encodeURIComponent(dt)}`, { active: 0, decks: [{ name: 'Nouveau', cards: deckA }, {}, {}] });
  check('API deck : enregistrement', dpost.json && dpost.json.ok);
  check('API deck : jeton refusé', (await request('GET', 'api/deck?t=UA.00')).status === 403);

  // 🏆 Classement (« Mon deck » et préparation) : UB a gagné le combat ci-dessus
  const rkDeck = await request('GET', `api/deck/ranking?t=${encodeURIComponent(dt)}`);
  const [first, second] = (rkDeck.json && rkDeck.json.top) || [];
  check('classement « Mon deck » : UB 1er (1 V), UA 2e', first && first.userId === 'UB' && first.rank === 1 && first.wins === 1 && second && second.userId === 'UA');
  check('classement : noms et photos Slack, « toi » repéré', first.name === 'Julie' && first.avatar === 'https://avatars.test/UB.png' && second.you === true && first.you === false);
  check('classement « Mon deck » : jeton refusé', (await request('GET', 'api/deck/ranking?t=UA.00')).status === 403);
  const rkArena = await request('GET', pathOf(arenaWeb.buildArenaUrl('m-any', 'UB')).replace(/^arena\/([\w-]+)\?/, 'api/arena/$1/ranking?'));
  check('classement de la préparation : même classement, « toi » = UB', rkArena.json && rkArena.json.top.length === 2 && rkArena.json.top[0].you === true);
  check('pages : le script du classement est servi', (await request('GET', 'arena-ranking.js')).status === 200);

  sA.close(); sB.close(); sA2.close();
  matches.stop();
  server.close();
  try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }   // Windows : fichier ouvert = non supprimable
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
