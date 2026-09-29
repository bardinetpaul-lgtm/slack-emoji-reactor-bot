#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test de l'API /stats (jeton admin signé, expiration, routes)
//  Usage : node scripts/test-stats-web.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-stats-web-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

process.env.WEB_PUBLIC_URL = 'https://example.test/jeanpip';
process.env.WEB_SECRET = 'secret-de-test';
process.env.JEANPIP_ADMINS = 'UADMIN';

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}
const origLog = console.log;
console.log = () => {};
const web = require(path.join(TMP, 'src', 'web.js'));
const statsWeb = require(path.join(TMP, 'src', 'stats', 'web.js'));
console.log = origLog;
const quiet = { info() {}, warn() {}, error() {} };

const get = (port, p) => new Promise((resolve) => {
  http.get({ host: '127.0.0.1', port, path: p }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  });
});

(async () => {
  const fakeClient = { users: { info: async ({ user }) => ({ user: { profile: { display_name: `nom-${user}` } } }) } };
  const server = web.startWebServer({ client: fakeClient, logger: quiet, port: 3197, force: true });
  await new Promise((r) => server.on('listening', r));

  const url = web.buildStatsUrl('UADMIN');
  check('lien admin construit', /^https:\/\/example\.test\/jeanpip\/stats\?t=UADMIN\.\d+\.[a-f0-9]{64}$/.test(decodeURIComponent(url)));
  check('pas de lien pour un non-admin', web.buildStatsUrl('UJOE') === null);
  const t = new URL(url).searchParams.get('t');
  const q = (block, extra = '') => get(3197, `/api/stats/${block}?t=${encodeURIComponent(t)}${extra}`);

  const page = await get(3197, '/stats');
  check('page /stats servie', page.status === 200 && page.body.includes('<canvas'));
  for (const b of ['economy', 'purchases', 'boosters', 'cards', 'arena', 'activity']) {
    const r = await q(b);
    const j = r.status === 200 && JSON.parse(r.body);
    check(`API ${b} : 200 + kpis`, j && j.ok && j.kpis && j.series && Array.isArray(j.series.labels));
  }
  const pl = await q('players');
  check('API players : 200', pl.status === 200 && JSON.parse(pl.body).ok);

  check('sans jeton → 403', (await get(3197, '/api/stats/economy')).status === 403);
  check('jeton falsifié → 403', (await get(3197, `/api/stats/economy?t=${encodeURIComponent(t.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')))}`)).status === 403);
  const expired = statsWeb.makeToken('UADMIN', Date.now() - statsWeb.TTL_MS - 1000);
  check('jeton expiré → 403', (await get(3197, `/api/stats/economy?t=${encodeURIComponent(expired)}`)).status === 403);
  const joe = statsWeb.makeToken('UJOE');
  check('jeton signé d’un non-admin → 403', (await get(3197, `/api/stats/economy?t=${encodeURIComponent(joe)}`)).status === 403);
  process.env.JEANPIP_ADMINS = 'UOTHER';
  check('admin retiré depuis → 403', (await q('economy')).status === 403);
  process.env.JEANPIP_ADMINS = 'UADMIN';

  check('from invalide → 400', (await q('economy', '&from=abc')).status === 400);
  check('grain invalide → 400', (await q('economy', '&grain=year')).status === 400);
  check('user invalide → 400', (await q('economy', `&user=${encodeURIComponent('<script>')}`)).status === 400);
  check('bloc inconnu → 404', (await q('nope')).status === 404);

  server.close();
  try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }   // Windows : fichier ouvert = non supprimable
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failures ? `\n❌ ${failures} échec(s)` : '\n🎉 API stats OK');
  process.exit(failures ? 1 : 0);
})();
