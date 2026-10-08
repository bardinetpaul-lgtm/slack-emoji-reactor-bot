#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test des routes JP TV (src/game/tvWeb.js via web.js)
//  Vrai serveur, vrai flux SSE, dans une COPIE temporaire du projet :
//  clé TV, JSON vide, combat lancé → alerte (setup) + états sans main
//  ni élixir, « Aussi en direct », fin → écran de fin, derniers combats.
//  Usage : node scripts/test-tv-web.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-tv-web-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

process.env.WEB_PUBLIC_URL = 'http://jeanpip.test';
process.env.WEB_SECRET = 'test-secret';
let PORT = 0;

const origLog = console.log;
console.log = () => {};
const web = require(path.join(TMP, 'src', 'web.js'));
const matches = require(path.join(TMP, 'src', 'game', 'matches.js'));
const arenaStore = require(path.join(TMP, 'src', 'game', 'arenaStore.js'));
const collections = require(path.join(TMP, 'src', 'collections.js'));
const media = require(path.join(TMP, 'src', 'media.js'));
const wire = require(path.join(TMP, 'public', 'arena-wire.js'));
console.log = origLog;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const quiet = { info: () => {}, warn: () => {}, error: (...a) => console.error(...a) };
const NAMES = { UA: 'Paul', UB: 'Julie', UC: 'Marc', UD: 'Léa' };
const client = { users: { info: async ({ user }) => ({ user: { profile: { display_name: NAMES[user] || user } } }) } };

function request(pathQ) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: `/${pathQ}` }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* HTML */ }
        resolve({ status: res.statusCode, body: data, json });
      });
    }).on('error', reject);
  });
}

function openStream(pathQ) {
  const events = [];
  const decoder = wire.createDecoder();
  const req = http.get({ host: '127.0.0.1', port: PORT, path: `/${pathQ}` }, (res) => {
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
        events.push({ event: ev[1], data: ev[1] === 'state' ? decoder.decode(parsed) : parsed });
      }
    });
  });
  req.on('error', () => {});
  return { events, close: () => req.destroy() };
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
  return m.id;
};

(async () => {
  const bank = media.getAllMedia();
  collections.addCards('UA', bank.slice(0, 10));
  collections.addCards('UB', bank.slice(10, 20));
  collections.addCards('UC', bank.slice(20, 30));
  collections.addCards('UD', bank.slice(30, 40));

  const server = web.startWebServer({ client, logger: quiet, port: 0, force: true });
  await until(() => server.address());
  PORT = server.address().port;

  const urls = web.buildTvUrls();
  check('liens JP TV construits avec la clé', urls && /^http:\/\/jeanpip\.test\/tv\/arena\?k=[a-f0-9]{32}$/.test(urls.page) && urls.api.startsWith('http://jeanpip.test/api/tv/arena?k='));
  const k = new URL(urls.page).searchParams.get('k');
  const page = await request(`tv/arena?k=${k}`);
  check('page JP TV servie, assets versionnés', page.status === 200 && /tv\.js\?v=[a-f0-9]{10}/.test(page.body) && page.body.includes('PRIORITÉ AU DIRECT'));
  check('page JP TV : scripts servis', (await request('tv.js')).status === 200 && (await request('tv.css')).status === 200);

  check('JSON : clé absente refusée', (await request('api/tv/arena')).status === 403);
  check('JSON : mauvaise clé refusée', (await request('api/tv/arena?k=0123456789abcdef0123456789abcdef')).status === 403);
  check('flux : mauvaise clé refusée', (await request('api/tv/stream?k=nope')).status === 403);
  const empty = (await request(`api/tv/arena?k=${k}`)).json;
  check('JSON : rien à l\'antenne au départ', empty.status === 'ok' && empty.onAir === false && empty.live.length === 0 && empty.recent.length === 0);

  const tv = openStream(`api/tv/stream?k=${k}`);
  check('flux : « idle » tant qu\'aucun combat', await until(() => tv.events.some((e) => e.event === 'idle')));

  // Combat 1 (UA/UB) puis combat 2 (UC/UD), lancé après
  const id1 = launch('UA', 'UB');
  matches.step(Date.now());
  await wait(30);   // le 2e combat démarre forcément après le 1er
  const id2 = launch('UC', 'UD');
  matches.step(Date.now());

  check('flux : setup du 1er combat (alerte « Priorité au direct »)', await until(() => tv.events.some((e) => e.event === 'setup' && e.data.matchId === id1)));
  const setup = tv.events.find((e) => e.event === 'setup');
  const m1 = matches.getMatch(id1);
  check('flux : vrais noms des deux camps', setup.data.names.A === NAMES[m1.players.A.userId] && setup.data.names.B === NAMES[m1.players.B.userId]);
  check('flux : dessins des cartes fournis', typeof setup.data.symbols === 'string' && setup.data.symbols.length > 0);
  check('flux : états reçus', await until(() => tv.events.some((e) => e.event === 'state')));
  const st = tv.events.filter((e) => e.event === 'state').pop().data;
  check('flux : ni main ni élixir', ['A', 'B'].every((s) => !st.players[s].hand && (st.players[s].elixir === null || st.players[s].elixir === undefined)));
  check('flux : nombre de cartes restantes de chaque joueur (v3.0.4)', ['A', 'B'].every((s) => st.players[s].handCount === 8 && st.players[s].next === undefined));
  const tvPage = await request(`tv/arena?k=${k}`);
  check('page JP TV : zones « cartes restantes » des deux joueurs', /id="hand-a"/.test(tvPage.body) && /id="hand-b"/.test(tvPage.body));
  check('flux : « Aussi en direct » = 2e combat', await until(() => tv.events.some((e) => e.event === 'also' && e.data.length === 1 && e.data[0].a && e.data[0].b)));

  const live = (await request(`api/tv/arena?k=${k}`)).json;
  check('JSON : à l\'antenne, 2 combats en direct, le 1er lancé en tête', live.onAir === true && live.live.length === 2 && live.live[0].matchId === id1 && live.live[0].a === NAMES[m1.players.A.userId]);

  // Fin du 1er combat → écran de fin, puis derniers combats + classement
  matches.action(id1, m1.players.A.userId, { type: 'forfeit' });
  matches.step(Date.now());
  check('flux : écran de fin du 1er combat', await until(() => tv.events.some((e) => e.event === 'ended' && e.data.matchId === id1 && e.data.result && e.data.result.reason === 'forfeit')));
  const iEnd = tv.events.findIndex((e) => e.event === 'ended' && e.data.matchId === id1);
  const before = tv.events[iEnd - 1];
  check('flux : dernier état (événement de fin) envoyé avant la fin', before && before.event === 'state' && Array.isArray(before.data.events) && before.data.events.some((e) => e.type === 'end'));
  const after = (await request(`api/tv/arena?k=${k}`)).json;
  check('JSON : dernier combat avec noms, vainqueur et tours', after.recent.length === 1 && after.recent[0].winner === NAMES[m1.players.B.userId] && Array.isArray(after.recent[0].towers) && after.recent[0].draw === false);
  check('JSON : classement avec vrais noms', after.ranking.length === 2 && after.ranking[0].name === NAMES[m1.players.B.userId] && after.ranking[0].wins === 1);
  check('JSON : toujours à l\'antenne (2e combat en cours)', after.onAir === true);

  // Refus de diffusion : combat non diffusé mais classé
  matches.action(id2, 'UC', { type: 'forfeit' });
  matches.step(Date.now());
  arenaStore.setTvOptOut('UA', true);
  const id3 = launch('UA', 'UB');
  matches.step(Date.now());
  const hidden = (await request(`api/tv/arena?k=${k}`)).json;
  check('refus de diffusion : combat absent du direct', !hidden.live.some((m) => m.matchId === id3));

  tv.close();
  matches.stop();
  server.close();
  try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
