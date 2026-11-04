#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test de la Banque web (src/banqueWeb.js via web.js, v4.0)
//  Vrai serveur, dans une COPIE temporaire du projet :
//    • page servie, lien « Retour à Jeanpip City » ;
//    • jeton absent, faux, d'un autre joueur ou d'une autre page → 403, rien ne bouge ;
//    • état : doublons revendables (même source que la fenêtre Slack), prix, semaine ;
//    • pause → 'pause', raid subi → 'raid', trop de cartes → 'too_many',
//      rien demandé → 'empty', plafond → 'cap' : texte exact de la fenêtre Slack,
//      cartes et JP$ inchangés ;
//    • revente valide → JP$ crédités, cartes retirées, hook onResold appelé une fois.
//  Usage : node scripts/test-banque-web.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-banque-web-'));
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
const req = (m) => require(path.join(TMP, 'src', m));
const web = req('web.js');
const villeToken = req('villeToken.js');
const collections = req('collections.js');
const credits = req('credits.js');
const arenaStore = req(path.join('game', 'arenaStore.js'));
const raid = req('raid.js');
const leave = req('leave.js');
const weekend = req('weekend.js');
const settings = req('settings.js');
const { parisDay } = req('octobreRose.js');
console.log = origLog;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const quiet = { info: () => {}, warn: () => {}, error: (...a) => console.error(...a) };
const client = { users: { info: async ({ user }) => ({ user: { profile: { display_name: user } } }) } };

function request(method, pathQ, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const r = http.request({
      host: '127.0.0.1', port: PORT, path: `/${pathQ}`, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {},
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* HTML */ }
        resolve({ status: res.statusCode, body: data, json });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}
const get = (p) => request('GET', p);
const post = (p, b) => request('POST', p, b);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Pause déterministe : seul U_PAUSE (en congés) est en pause, quel que soit le jour du test
const realPauseFor = weekend.pauseFor;
weekend.pauseFor = (userId, now) => (userId === 'U_PAUSE' ? realPauseFor(userId, now) : null);

const card = (url, rarity, n) => Array.from({ length: n }, () => ({ url, rarity, title: url, type: 'image' }));
const give = (u, ...cards) => collections.addCards(u, cards.flat());
const snapshot = (u) => JSON.stringify({ cards: collections.getCollection(u).map((c) => [c.url, c.count]), balance: credits.getBalance(u) });

(async () => {
  for (const u of ['U_A', 'U_PAUSE', 'U_RAID']) give(u, card(`${u}-c1`, 'common', 6), card(`${u}-r1`, 'rare', 3), card(`${u}-e1`, 'epic', 1));
  arenaStore.setDecks('U_A', { active: 0, decks: [{ cards: ['U_A-r1', 'U_A-r1', 'U_A-r1'] }, {}, {}] });
  leave.declareLeave('U_PAUSE', parisDay(Date.now()), parisDay(Date.now()));
  raid.create({ attacker: 'U_A', targets: ['U_RAID'], style: 'assaut' });

  const resold = [];
  const hooks = { onResold: (userId, result) => { resold.push({ userId, result }); } };
  const server = web.startWebServer({ client, logger: quiet, port: 0, force: true, hooks });
  while (!server.address()) await wait(20);
  PORT = server.address().port;

  const q = (u) => villeToken.query(u);
  const t = (u) => new URLSearchParams(q(u)).get('t');

  // ── Page ──
  const page = await get(`banque?${q('U_A')}`);
  check('page Banque servie, assets versionnés', page.status === 200 && /banque\.js\?v=[a-f0-9]{10}/.test(page.body) && /banque\.css\?v=[a-f0-9]{10}/.test(page.body));
  check('page Banque : lien « ← Retour à Jeanpip City » relatif', /Retour à Jeanpip City/.test(page.body) && !/href="\/(?!\/)/.test(page.body));
  check('page Banque : scripts servis', (await get('banque.js')).status === 200 && (await get('banque.css')).status === 200);

  // ── Jetons refusés ──
  const before = snapshot('U_A');
  check('état : jeton absent → 403', (await get('api/banque')).status === 403);
  check('état : faux jeton → 403', (await get(`api/banque?t=U_A.${'0'.repeat(64)}`)).status === 403);
  const otherSig = t('U_B').split('.')[1];
  check('état : signature d\'un autre joueur → 403', (await get(`api/banque?t=U_A.${otherSig}`)).status === 403);
  const ticketsSig = crypto.createHmac('sha256', 'test-secret').update('tickets|U_A').digest('hex');
  check('état : jeton du Kiosque → 403', (await get(`api/banque?t=U_A.${ticketsSig}`)).status === 403);
  const noTok = await post('api/banque/sell', { wanted: { common: 2 } });
  check('revente : jeton absent → 403 JSON', noTok.status === 403 && noTok.json && noTok.json.ok === false);
  check('revente : signature d\'un autre joueur → 403', (await post(`api/banque/sell?t=U_A.${otherSig}`, { wanted: { common: 2 } })).status === 403);
  check('jetons refusés : rien n\'a bougé, hook non appelé', snapshot('U_A') === before && resold.length === 0);
  check('revente : GET refusé (405)', (await get(`api/banque/sell?${q('U_A')}`)).status === 405);

  // ── État ──
  const st = (await get(`api/banque?${q('U_A')}`)).json;
  const resale = req('resale.js');
  check('état : ok, solde, ni pause ni raid', st && st.ok === true && st.balance === credits.getBalance('U_A') && st.pause === null && st.raided === false);
  check('état : doublons = même source que la fenêtre Slack', JSON.stringify(st.available) === JSON.stringify(resale.sellableCounts('U_A')) && st.available.common === 5 && st.available.rare === 0);
  check('état : ordre, libellés et prix', JSON.stringify(st.order) === JSON.stringify(resale.RARITY_ORDER) && st.prices.rare === 2 && st.labels.epic === resale.LABELS.epic);
  check('état : semaine (déjà touché, plafond, reste)', st.week && st.week.earned === 0 && st.week.cap === settings.getResaleWeeklyCap() && st.week.remaining === st.week.cap);

  const sp = (await get(`api/banque?${q('U_PAUSE')}`)).json;
  check('état : pause signalée avec son texte', sp.ok === true && sp.pause && /Pas de revente/.test(sp.pause.text));
  check('état : raid subi signalé', (await get(`api/banque?${q('U_RAID')}`)).json.raided === true);

  // ── Refus, texte exact de la fenêtre Slack, rien ne bouge ──
  const p0 = snapshot('U_PAUSE');
  const rp = (await post(`api/banque/sell?${q('U_PAUSE')}`, { wanted: { common: 1 } })).json;
  const pz = realPauseFor('U_PAUSE');
  check('pause → error « pause », texte de Slack', rp.ok === false && rp.error === 'pause' && rp.text === `${pz.icon} Pas de revente ${pz.short}.`);
  check('pause : cartes et JP$ inchangés', snapshot('U_PAUSE') === p0);

  const r0 = snapshot('U_RAID');
  const rr = (await post(`api/banque/sell?${q('U_RAID')}`, { wanted: { common: 1 } })).json;
  check('raid → error « raid », texte de Slack', rr.ok === false && rr.error === 'raid' && rr.text === '🚨 Tu subis un raid : pas de revente avant sa fin.');
  check('raid : cartes et JP$ inchangés', snapshot('U_RAID') === r0);

  const a0 = snapshot('U_A');
  const tm = (await post(`api/banque/sell?${q('U_A')}`, { wanted: { common: 6 } })).json;
  check('trop de cartes → « too_many », texte de Slack', tm.ok === false && tm.error === 'too_many' && tm.rarity === 'common' && tm.text === 'Tu n\'en as que 5 en double.');
  const deck = (await post(`api/banque/sell?${q('U_A')}`, { wanted: { rare: 1 } })).json;
  check('cartes du deck protégées → « too_many »', deck.error === 'too_many' && deck.text === 'Tu n\'en as que 0 en double.');
  const em = (await post(`api/banque/sell?${q('U_A')}`, { wanted: { common: 0, rare: -3 } })).json;
  check('rien demandé → « empty », texte de Slack', em.error === 'empty' && em.text === 'Indique combien de cartes revendre.');
  const junk = (await post(`api/banque/sell?${q('U_A')}`, 'pas du json')).json;
  check('corps invalide → « empty »', junk.ok === false && junk.error === 'empty');
  settings.setResaleWeeklyCap(2);
  const cap = (await post(`api/banque/sell?${q('U_A')}`, { wanted: { common: 5 } })).json;
  settings.setResaleWeeklyCap(30);
  check('plafond → « cap », texte de Slack', cap.error === 'cap' && cap.text === 'Ça dépasse ton plafond : tu peux encore toucher 2 JP$ cette semaine.');
  check('refus : cartes et JP$ inchangés, hook non appelé', snapshot('U_A') === a0 && resold.length === 0);

  // ── Revente valide ──
  const bal = credits.getBalance('U_A');
  const ok = await post(`api/banque/sell?${q('U_A')}`, { wanted: { common: 3 } });
  await wait(50);
  check('revente valide : réponse ok', ok.status === 200 && ok.json.ok === true && ok.json.gained === 1.5 && ok.json.sold.common === 3);
  check('revente valide : JP$ crédités', credits.getBalance('U_A') === bal + 1.5 && ok.json.balance === bal + 1.5 && ok.json.remaining === 30 - 1.5);
  check('revente valide : cartes retirées, dernier exemplaire et deck gardés', collections.getCount('U_A', 'U_A-c1') === 3 && collections.getCount('U_A', 'U_A-r1') === 3);
  check('revente valide : hook onResold appelé une fois', resold.length === 1 && resold[0].userId === 'U_A' && resold[0].result.gained === 1.5);
  const st2 = (await get(`api/banque?${q('U_A')}`)).json;
  check('état après revente : semaine et doublons à jour', st2.week.earned === 1.5 && st2.available.common === 2);

  server.close();
  try { req('game/matches.js').stop(); } catch { /* pas de boucle */ }
  try { req('db.js').close(); } catch { /* base jamais ouverte */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows */ }
  console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
