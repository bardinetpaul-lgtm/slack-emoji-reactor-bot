#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test de l'API de la ville Jeanpip (src/villeWeb.js via web.js, v4.0)
//  Vrai serveur, vrai flux SSE, dans une COPIE temporaire du projet :
//  jeton (absent, faux, « tickets| »), état initial, maisons = inscrits
//  seulement avec parcelles stables, promeneurs (fromHouse), carte de
//  visite (solde privé), photo Slack (proxy + cache), combat à l'antenne
//  et refus de diffusion, événements « house », enchères en cours
//  (état + événement « auctions », v4.2), fermeture du flux.
//  Usage : node scripts/test-ville-web.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-ville-web-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

process.env.WEB_PUBLIC_URL = 'http://jeanpip.test';
process.env.WEB_SECRET = 'test-secret';
let PORT = 0;
let IMG_PORT = 0;

const origLog = console.log;
console.log = () => {};
const req = (rel) => require(path.join(TMP, 'src', rel));
const web = req('web.js');
const matches = req('game/matches.js');
const arenaStore = req('game/arenaStore.js');
const collections = req('collections.js');
const media = req('media.js');
const broadcast = req('broadcast.js');
const credits = req('credits.js');
const releases = req('releases.js');
const villeToken = req('villeToken.js');
const villeWeb = req('villeWeb.js');
const trades = req('trades.js');
const { bus } = req('cityBus.js');
console.log = origLog;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const quiet = { info: () => {}, warn: () => {}, error: (...a) => console.error(...a) };
const NAMES = { UA: 'Paul', UB: 'Julie', UC: 'Marc', UD: 'Léa' };
const infoCalls = [];
const client = {
  users: {
    info: async ({ user }) => (infoCalls.push(user), {
      user: { profile: { display_name: NAMES[user] || user, image_72: user === 'UD' ? undefined : `http://127.0.0.1:${IMG_PORT}/img/${user}.png` } },
    }),
  },
};

// Faux serveur d'images Slack (compte les téléchargements)
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const imgHits = {};
const imgServer = http.createServer((rq, rs) => {
  imgHits[rq.url] = (imgHits[rq.url] || 0) + 1;
  if (rq.url === '/img/UC.png') { // trop grosse, sans content-length : coupée en route
    rs.writeHead(200, { 'Content-Type': 'image/png', 'Transfer-Encoding': 'chunked' });
    const big = Buffer.alloc(64 * 1024);
    let sent = 0;
    const push = () => { while (sent < 40 && rs.write(big)) sent += 1; if (sent < 40) rs.once('drain', () => { sent += 1; push(); }); else rs.end(); };
    rs.on('error', () => {});
    push();
    return;
  }
  rs.writeHead(200, { 'Content-Type': 'image/png' });
  rs.end(PNG);
});

function request(pathQ) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: `/${pathQ}` }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString('utf-8')); } catch { /* pas du JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, body: buf.toString('utf-8'), buf, json });
      });
    }).on('error', reject);
  });
}

function openStream(pathQ) {
  const events = [];
  const s = { events, headers: null, status: null, raw: '', ended: false };
  const rq = http.get({ host: '127.0.0.1', port: PORT, path: `/${pathQ}` }, (res) => {
    s.status = res.statusCode;
    s.headers = res.headers;
    res.on('end', () => { s.ended = true; });
    res.on('close', () => { s.ended = true; });
    let buf = '';
    res.on('data', (c) => {
      buf += c;
      s.raw += c;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(block);
        const data = /^data: (.+)$/m.exec(block);
        if (ev && data) events.push({ event: ev[1], data: JSON.parse(data[1]) });
      }
    });
  });
  rq.on('error', () => {});
  s.close = () => rq.destroy();
  return s;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await wait(50);
  }
  return false;
}
const launch = (a, b) => {
  const m = matches.createMatchFor(a, b, Date.now());
  for (const u of [a, b]) {
    matches.connect(m.id, u, Date.now());
    matches.setReady(m.id, u);
  }
  matches.step(Date.now());
  return m.id;
};
const q = (u) => villeToken.query(u);
// Enchères posées directement dans data/trades.json (seuls kind, status et endsAt comptent ici)
function setTrades(list) {
  const data = { seq: list.length, trades: {} };
  list.forEach((t, i) => { data.trades[`T${i + 1}`] = { id: `T${i + 1}`, seller: 'UB', card: { url: 'x', title: 'x', rarity: 'common', code: '1' }, bids: [], ...t }; });
  trades._save(data);
}

(async () => {
  const bank = media.getAllMedia();
  collections.addCards('UA', bank.slice(0, 10));
  collections.addCards('UB', bank.slice(10, 20));
  collections.addCards('UC', bank.slice(20, 30));
  collections.addCards('UD', bank.slice(30, 40));
  broadcast.subscribe('UA');
  broadcast.subscribe('UB');

  imgServer.listen(0, '127.0.0.1');
  await until(() => imgServer.address());
  IMG_PORT = imgServer.address().port;
  const server = web.startWebServer({ client, logger: quiet, port: 0, force: true });
  await until(() => server.address());
  PORT = server.address().port;

  // ── 🔐 Jeton ──
  const ticketsQ = new URL(web.buildTicketsUrl('UA')).search.slice(1);
  for (const p of ['api/ville', 'api/ville/stream', 'api/ville/card/UB', 'api/ville/avatar/UA']) {
    const none = await request(p);
    const tickets = await request(`${p}?${ticketsQ}`);
    const forged = await request(`${p}?t=UA.${'0'.repeat(64)}`);
    check(`${p} : sans jeton / jeton « tickets| » / faux jeton → 403 JSON`,
      [none, tickets, forged].every((r) => r.status === 403 && r.json && r.json.ok === false));
  }
  const page = await request(`ville?${q('UA')}`);
  check('GET /ville traité par la ville (page ou 404 si pas encore écrite)', page.status === 200 || (page.status === 404 && page.body === 'Not found'));
  check('POST /api/ville refusé (405)', await new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: `/api/ville?${q('UA')}`, method: 'POST' }, (res) => { res.resume(); resolve(res.statusCode === 405); });
    r.end();
  }));

  // ── 🏙️ État initial ──
  const st = (await request(`api/ville?${q('UA')}`)).json;
  check('état : ok + heure du serveur', st && st.ok === true && typeof st.serverTime === 'number' && Math.abs(st.serverTime - Date.now()) < 5000);
  check('état : me = joueur du jeton, avec nom, photo et solde', st.me.userId === 'UA' && st.me.name === 'Paul'
    && st.me.balance === credits.getBalance('UA') && /^api\/ville\/avatar\/UA\?t=/.test(st.me.avatar));
  check('état : pause null ou { title }', st.pause === null || typeof st.pause.title === 'string');
  check('état : maisons = inscrits seulement (UA, UB)', st.houses.map((h) => h.userId).sort().join() === 'UA,UB');
  check('état : maisons avec nom, photo et parcelles distinctes', st.houses.every((h) => h.name === NAMES[h.userId] && h.avatar && Number.isInteger(h.plot))
    && new Set(st.houses.map((h) => h.plot)).size === st.houses.length);
  check('état : rien à l\'antenne, pas de combat', st.arena.live === false && st.arena.tvUrl === null && st.arena.myMatchUrl === null);
  check('état : liens relatifs (musée, kiosque, deck, boutique, banque)', ['museum', 'kiosk', 'deck', 'boutique', 'banque'].every((k) => typeof st.links[k] === 'string' && !/^https?:|^\//.test(st.links[k]))
    && st.links.boutique.startsWith('boutique?t='));
  const rel = releases.current();
  check('état : mairie = version en cours + classement', st.mairie.release.version === rel.version && st.mairie.release.title === rel.title
    && st.mairie.release.date === rel.date && Array.isArray(st.mairie.release.changes) && Array.isArray(st.mairie.ranking));
  check('état : aucun solde d\'un autre joueur', !st.houses.some((h) => 'balance' in h));
  check('état : lien relatif vers la Salle des ventes', typeof st.links.salle === 'string' && st.links.salle.startsWith('salle?t='));
  check('état : aucune enchère au départ (auctions.open = 0)', st.auctions && st.auctions.open === 0);
  const H = 3600000;
  setTrades([
    { kind: 'auction', status: 'open', endsAt: Date.now() + 5 * H },
    { kind: 'auction', status: 'open', endsAt: Date.now() + 2 * H },
    { kind: 'auction', status: 'open', endsAt: Date.now() - 1000 }, // terminée, pas encore réglée
    { kind: 'auction', status: 'done', endsAt: Date.now() - H },
    { kind: 'auction', status: 'cancelled', endsAt: Date.now() + H },
    { kind: 'direct', status: 'open', expiresAt: Date.now() + H },
    { kind: 'general', status: 'open', expiresAt: Date.now() + H },
  ]);
  const stA = (await request(`api/ville?${q('UA')}`)).json;
  check('état : auctions.open ne compte que les enchères ouvertes et pas terminées (2)', stA.auctions.open === 2);

  // ── 🏠 Parcelles stables ──
  const plotsBefore = Object.fromEntries(st.houses.map((h) => [h.userId, h.plot]));
  const plotsPath = path.join(TMP, 'src', 'villePlots.js');
  delete require.cache[require.resolve(plotsPath)];
  const plots2 = require(plotsPath);
  check('parcelles stables après redémarrage du module', plots2.plotOf('UA') === plotsBefore.UA && plots2.plotOf('UB') === plotsBefore.UB);
  broadcast.unsubscribe('UB');
  broadcast.subscribe('UC');
  const st2 = (await request(`api/ville?${q('UA')}`)).json;
  const plotC = st2.houses.find((h) => h.userId === 'UC');
  check('désinscrit : sa maison disparaît, le nouvel inscrit a une parcelle neuve', !st2.houses.some((h) => h.userId === 'UB')
    && plotC && plotC.plot !== plotsBefore.UA && plotC.plot !== plotsBefore.UB);
  broadcast.subscribe('UB');
  const st3 = (await request(`api/ville?${q('UA')}`)).json;
  check('réinscrit : il retrouve sa parcelle', st3.houses.find((h) => h.userId === 'UB').plot === plotsBefore.UB);

  // ── 🚶 Promeneurs (flux) ──
  const s = openStream(`api/ville/stream?${q('UA')}`);
  check('flux : ouvert avec les en-têtes du direct', await until(() => s.headers)
    && s.status === 200 && /text\/event-stream/.test(s.headers['content-type'])
    && /no-transform/.test(s.headers['cache-control']) && s.headers['x-accel-buffering'] === 'no');
  check('flux : « auctions » envoyé à l\'ouverture avec le nombre en cours (2)', await until(() => s.events.some((e) => e.event === 'auctions'))
    && s.events.find((e) => e.event === 'auctions').data.open === 2);
  check('flux : un seul écouteur « jp » sur le bus', await until(() => villeWeb._clientCount() === 1) && bus.listenerCount('jp') === 1);
  const s2 = openStream(`api/ville/stream?${q('UB')}`);
  check('flux : deux villes ouvertes, toujours un seul écouteur', await until(() => villeWeb._clientCount() === 2) && bus.listenerCount('jp') === 1);
  bus.emit('jp', { userId: 'UA', amount: 1, at: Date.now() });
  check('jp d\'un inscrit → fromHouse:true, nom et montant', await until(() => s.events.some((e) => e.event === 'jp' && e.data.userId === 'UA')));
  const jpA = s.events.find((e) => e.event === 'jp' && e.data.userId === 'UA').data;
  check('jp : contenu attendu', jpA.fromHouse === true && jpA.name === 'Paul' && jpA.amount === 1 && /^api\/ville\/avatar\/UA\?t=/.test(jpA.avatar));
  check('jp : reçu aussi par l\'autre ville, avec son propre jeton', await until(() => s2.events.some((e) => e.event === 'jp' && e.data.userId === 'UA'))
    && s2.events.find((e) => e.event === 'jp').data.avatar.endsWith(q('UB').slice(2)));
  bus.emit('jp', { userId: 'UD', amount: 3, at: Date.now() });
  check('jp d\'un non-inscrit → fromHouse:false', await until(() => s.events.some((e) => e.event === 'jp' && e.data.userId === 'UD')));
  check('jp non-inscrit : contenu attendu', (() => { const d = s.events.find((e) => e.event === 'jp' && e.data.userId === 'UD').data; return d.fromHouse === false && d.amount === 3 && d.name === 'Léa'; })());
  const st4 = (await request(`api/ville?${q('UA')}`)).json;
  const plotFile = JSON.parse(fs.readFileSync(path.join(TMP, 'data', 'ville.json'), 'utf-8'));
  check('non-inscrit : aucune maison créée', !st4.houses.some((h) => h.userId === 'UD') && !('UD' in plotFile.plots));
  bus.emit('jp', { userId: 'U<script>', amount: 1 });
  bus.emit('jp', null);
  await wait(200);
  check('jp invalide ignoré sans planter', !s.events.some((e) => e.event === 'jp' && e.data.userId === 'U<script>'));

  // ── 🪪 Carte de visite ──
  const cardB = (await request(`api/ville/card/UB?${q('UA')}`)).json;
  check('carte d\'un collègue : sans solde', cardB.ok === true && cardB.userId === 'UB' && cardB.name === 'Julie' && !('balance' in cardB));
  check('carte : cartes différentes, légendaires, série, rang', cardB.distinctCards === collections.getCollection('UB').length
    && cardB.legendaries === collections.getCollection('UB').filter((c) => c.rarity === 'legendary').length
    && cardB.streak === 0 && cardB.rank === null && /^api\/ville\/avatar\/UB\?t=/.test(cardB.avatar));
  const cardA = (await request(`api/ville/card/UA?${q('UA')}`)).json;
  check('sa propre carte : avec son solde', cardA.ok === true && cardA.balance === credits.getBalance('UA'));
  check('carte : identifiant invalide → 404', (await request(`api/ville/card/..%2Fx?${q('UA')}`)).status === 404);
  const callsBefore = infoCalls.length;
  const unkCard = await request(`api/ville/card/UZZZ999?${q('UA')}`);
  const unkAv = await request(`api/ville/avatar/UZZZ998?${q('UA')}`);
  check('carte / photo d’un inconnu → 404 sans appel Slack', unkCard.status === 404 && unkAv.status === 404
    && !infoCalls.slice(callsBefore).some((u) => u === 'UZZZ999' || u === 'UZZZ998'));
  bus.emit('jp', { userId: 'UWALK', amount: 2, at: Date.now() });
  await until(() => s.events.some((e) => e.event === 'jp' && e.data.userId === 'UWALK'));
  const walkCard = await request(`api/ville/card/UWALK?${q('UA')}`);
  check('carte d’un promeneur (vu dans un jp) → 200', walkCard.status === 200 && walkCard.json && walkCard.json.userId === 'UWALK');

  // ── 🖼️ Photo Slack ──
  const av1 = await request(`api/ville/avatar/UA?${q('UA')}`);
  const av2 = await request(`api/ville/avatar/UA?${q('UB')}`);
  check('photo : servie en image/png', av1.status === 200 && av1.headers['content-type'] === 'image/png' && av1.buf.equals(PNG));
  check('photo : gardée en mémoire (un seul téléchargement)', av2.status === 200 && imgHits['/img/UA.png'] === 1);
  check('photo : absente → 404', (await request(`api/ville/avatar/UD?${q('UA')}`)).status === 404);
  check('photo : plus de 512 Ko → 404 (téléchargement coupé)', (await request(`api/ville/avatar/UC?${q('UA')}`)).status === 404);

  // ── ⚔️ Combat à l'antenne ──
  const id1 = launch('UA', 'UB');
  const live = (await request(`api/ville?${q('UA')}`)).json;
  check('combat diffusable lancé → live:true + lien JP TV', live.arena.live === true && /^tv\/arena\?k=[a-f0-9]{32}$/.test(live.arena.tvUrl));
  check('combattant : lien vers son combat', typeof live.arena.myMatchUrl === 'string' && live.arena.myMatchUrl.startsWith(`arena/${encodeURIComponent(id1)}?t=`));
  const liveC = (await request(`api/ville?${q('UC')}`)).json;
  check('non-combattant : pas de lien de combat, mais la TV', liveC.arena.myMatchUrl === null && liveC.arena.live === true);
  check('flux : événement arena live:true', await until(() => s.events.some((e) => e.event === 'arena' && e.data.live === true && e.data.tvUrl)));
  matches.action(id1, 'UA', { type: 'forfeit' });
  matches.step(Date.now());
  check('flux : événement arena live:false à la fin', await until(() => {
    const a = s.events.filter((e) => e.event === 'arena');
    return a.length && a[a.length - 1].data.live === false && a[a.length - 1].data.tvUrl === null;
  }));
  const arenaCount = s.events.filter((e) => e.event === 'arena').length;
  await wait(2500);
  check('flux : pas de nouvel événement arena sans changement', s.events.filter((e) => e.event === 'arena').length === arenaCount);

  arenaStore.setTvOptOut('UC', true);
  launch('UC', 'UD');
  const hidden = (await request(`api/ville?${q('UA')}`)).json;
  check('joueur « pas de JP TV » en combat → live reste false', hidden.arena.live === false && hidden.arena.tvUrl === null);
  const hiddenC = (await request(`api/ville?${q('UC')}`)).json;
  check('… mais il a quand même le lien de son propre combat', typeof hiddenC.arena.myMatchUrl === 'string');

  // ── 🏠 Événements house ──
  broadcast.unsubscribe('UB');
  broadcast.subscribe('UD');
  await villeWeb._checkHouses();
  check('flux : house add (nouvel inscrit)', await until(() => s.events.some((e) => e.event === 'house' && e.data.action === 'add' && e.data.house.userId === 'UD'
    && Number.isInteger(e.data.house.plot) && e.data.house.name === 'Léa')));
  check('flux : house remove (désinscrit)', s.events.some((e) => e.event === 'house' && e.data.action === 'remove' && e.data.house.userId === 'UB'
    && e.data.house.plot === plotsBefore.UB));

  // ── 🔨 Enchères en cours (contrôle de la boucle) ──
  const auctionsOf = (x) => x.events.filter((e) => e.event === 'auctions');
  const nA = auctionsOf(s).length;
  villeWeb._checkAuctions();
  await wait(200);
  check('flux : pas de nouvel « auctions » sans changement', auctionsOf(s).length === nA);
  setTrades([
    { kind: 'auction', status: 'open', endsAt: Date.now() + 5 * H },
    { kind: 'auction', status: 'open', endsAt: Date.now() + 2 * H },
    { kind: 'auction', status: 'open', endsAt: Date.now() + 3 * H },
  ]);
  villeWeb._checkAuctions();
  check('flux : « auctions » { open:3 } après une nouvelle enchère, reçu par chaque ville', await until(() => auctionsOf(s).length === nA + 1 && auctionsOf(s2).some((e) => e.data.open === 3))
    && auctionsOf(s)[nA].data.open === 3);
  setTrades([]);
  villeWeb._checkAuctions();
  check('flux : « auctions » { open:0 } quand il n\'y en a plus', await until(() => auctionsOf(s).length === nA + 2) && auctionsOf(s)[nA + 1].data.open === 0);

  // ── 🚦 Trois flux au plus par joueur ──
  const sc = [];
  for (let i = 0; i < 3; i += 1) {
    sc.push(openStream(`api/ville/stream?${q('UC')}`));
    await until(() => villeWeb._clientCount() === 3 + i);
  }
  sc.push(openStream(`api/ville/stream?${q('UC')}`));
  check('4e flux du même joueur : le plus ancien est fermé', await until(() => sc[0].ended)
    && await until(() => sc[3].status === 200));
  check('… et il a reçu « replaced » avant la fermeture', sc[0].events.some((e) => e.event === 'replaced')
    && !sc[3].events.some((e) => e.event === 'replaced'));
  await wait(200);
  check('… il en reste 3 pour ce joueur (+ 2 autres villes)', villeWeb._clientCount() === 5 && !sc[1].ended && !sc[2].ended && !sc[3].ended);
  check('… les autres joueurs ne sont pas touchés', !s.ended && !s2.ended);
  for (const x of sc) x.close();
  await until(() => villeWeb._clientCount() === 2);

  // ── 🔌 Fermeture ──
  s.close();
  s2.close();
  check('flux fermés : clients et écouteur retirés', await until(() => villeWeb._clientCount() === 0) && bus.listenerCount('jp') === 0);

  matches.stop();
  server.close();
  imgServer.close();
  try { req('db.js').close(); } catch { /* base jamais ouverte */ }
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
