#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Boutique web (src/boutiqueWeb.js via web.js, v4.0)
//  Vrai serveur dans une COPIE temporaire du projet, horloge simulée
//  (jeudi 15/10 10h30 à Paris, stock Octobre Rose arrivé) :
//    • 403 sans jeton, avec un faux jeton, avec le jeton d'un autre jeu ;
//    • état : solde, boosters (prix, libellé, stock), jeton d'achat ;
//    • 429 au-delà d'une interrogation par seconde ;
//    • achat sans jeton d'achat, trop rapide, rejoué, expiré ;
//    • achat valide → openUrl « open/… », hook appelé une fois ;
//    • congés (pauseFor) → refus avec le texte de pause, rien débité.
//  Usage : node scripts/test-boutique-web.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-boutique-web-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

const RealDate = Date;
let NOW = RealDate.parse('2026-10-15T08:30:00Z');
global.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(NOW); }
  static now() { return NOW; }
};

process.env.WEB_PUBLIC_URL = 'http://jeanpip.test';
process.env.WEB_SECRET = 'test-secret';
process.env.SLACK_SIGNING_SECRET = 'fake';
let PORT = 0;

const req = (m) => require(path.join(TMP, 'src', m));
const origLog = console.log;
console.log = () => {};
const web = req('web.js');
const villeToken = req('villeToken.js');
const credits = req('credits.js');
const boosters = req('boosters.js');
const leave = req('leave.js');
const purchaseNonce = req('purchaseNonce.js');
console.log = origLog;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const quiet = { info: () => {}, warn: () => {}, error: (...a) => console.error(...a) };
const hookCalls = [];
const hooks = { onBoosterBought: (userId, result) => { hookCalls.push({ userId, result }); } };

function request(method, pathQ, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const r = http.request({ host: '127.0.0.1', port: PORT, path: `/${pathQ}`, method, headers: data ? { 'Content-Type': 'application/json' } : {} }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(out); } catch { /* HTML */ }
        resolve({ status: res.statusCode, body: out, json });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (u) => villeToken.query(u);
const state = (u) => request('GET', `api/boutique?${q(u)}`);
const buy = (u, body) => request('POST', `api/boutique/buy?${q(u)}`, body);

(async () => {
  const server = web.startWebServer({ client: null, logger: quiet, port: 0, force: true, hooks });
  for (let i = 0; i < 100 && !server.address(); i += 1) await wait(20);
  PORT = server.address().port;

  // ── Jetons ──
  const page = await request('GET', `boutique?${q('UA')}`);
  check('GET /boutique → la page HTML', page.status === 200 && /<html/i.test(page.body));
  check('page : lien « Retour à Jeanpip City » et chemins relatifs', /Retour à Jeanpip City/.test(page.body) && !/(src|href)="\//.test(page.body));
  check('API sans jeton → 403', (await request('GET', 'api/boutique')).status === 403);
  check('API avec un faux jeton → 403', (await request('GET', `api/boutique?t=UA.${'0'.repeat(64)}`)).status === 403);
  const ticketsHmac = crypto.createHmac('sha256', 'test-secret').update('tickets|UA').digest('hex');
  check('API avec un jeton du Kiosque → 403', (await request('GET', `api/boutique?t=UA.${ticketsHmac}`)).status === 403);
  const forged = await request('POST', `api/boutique/buy?t=UB.${villeToken.sign('UA')}`, { type: 'common', nonce: 'x' });
  check('achat avec le jeton d\'un autre joueur → 403, rien débité', forged.status === 403 && forged.json && forged.json.ok === false);

  // ── État ──
  credits.setBalance('UA', 500);
  const s = await state('UA');
  const rose = (s.json.boosters || []).find((b) => b.type === 'octobre_rose');
  const common = (s.json.boosters || []).find((b) => b.type === 'common');
  check('état : solde, pas de pause, jeton d\'achat', s.status === 200 && s.json.ok && s.json.balance === 500 && s.json.pause === null && typeof s.json.nonce === 'string' && s.json.nonce.length >= 16);
  check('état : boosters classiques + Octobre Rose avec prix et libellé Slack', common && common.price === boosters.getBooster('common').price && rose && rose.buttonLabel === boosters.buttonLabel(boosters.getBooster('octobre_rose')) && rose.stockLeft === 3 && common.stockLeft === null && rose.block === null);
  check('2e interrogation dans la seconde → 429 slow_down', (await state('UA')).status === 429);
  NOW += 1100;
  check('… une seconde plus tard → 200', (await state('UA')).status === 200);

  // ── Jeton d'achat ──
  const noNonce = await buy('UA', { type: 'common' });
  check('achat sans jeton d\'achat → invalid, rien débité', noNonce.json.ok === false && noNonce.json.reason === 'invalid' && credits.getBalance('UA') === 500);
  NOW += 1100;
  const s2 = await state('UA');
  NOW += 300;
  const tooFast = await buy('UA', { type: 'common', nonce: s2.json.nonce });
  check('jeton utilisé moins d\'1 s après → too_fast, rien débité', tooFast.json.ok === false && tooFast.json.reason === 'too_fast' && credits.getBalance('UA') === 500);
  const replay = await buy('UA', { type: 'common', nonce: s2.json.nonce });
  check('jeton rejoué → invalid', replay.json.ok === false && replay.json.reason === 'invalid');
  NOW += 1100;
  const s3 = await state('UA');
  NOW += 121000;
  const expired = await buy('UA', { type: 'common', nonce: s3.json.nonce });
  check('jeton de plus de 2 min → expired', expired.json.ok === false && expired.json.reason === 'expired' && credits.getBalance('UA') === 500);
  check('purchaseNonce : constantes 120 s / 1 s', purchaseNonce.TTL_MS === 120000 && purchaseNonce.MIN_DELAY_MS === 1000);
  const other = purchaseNonce.issue('UB', NOW);
  check('purchaseNonce : jeton lié au joueur', purchaseNonce.consume('UA', other.value, NOW + 2000) === 'invalid');

  // ── Achat valide ──
  NOW += 1100;
  const s4 = await state('UA');
  NOW += 1500;
  const ok = await buy('UA', { type: 'octobre_rose', nonce: s4.json.nonce });
  check('achat valide → ok, openUrl relatif « open/… »', ok.json.ok === true && /^open\/b_[\w-]+\?t=[a-f0-9]{64}$/.test(ok.json.openUrl || ''));
  check('… solde renvoyé et débité', ok.json.balance === 500 - boosters.getBooster('octobre_rose').price && credits.getBalance('UA') === ok.json.balance);
  await wait(50);
  check('… hook onBoosterBought appelé une fois', hookCalls.length === 1 && hookCalls[0].userId === 'UA' && hookCalls[0].result.status === 'bought');
  const openPage = await request('GET', ok.json.openUrl);
  check('… openUrl ouvre bien la page d\'ouverture', openPage.status === 200);

  // ── Inconnu ──
  NOW += 1100;
  const s5 = await state('UA');
  NOW += 1500;
  const unknown = await buy('UA', { type: 'nope', nonce: s5.json.nonce });
  check('booster inconnu → ok:false unknown', unknown.json.ok === false && unknown.json.reason === 'unknown');

  // ── Jeton périmé : émis avant l'arrivée du stock (anti-script qui interroge en boucle) ──
  check('état à 10h30 (stock arrivé) : pas de rafraîchissement rapide', s.json.fastRefresh === false);
  const octobreRose = req('octobreRose.js');
  const boosterSpam = req('boosterSpam.js');
  const dropMin = octobreRose.dropMinute('2026-10-16');
  const DROP_AT = RealDate.parse('2026-10-15T22:00:00Z') + dropMin * 60000;   // vendredi 16/10, heure de Paris (UTC+2)
  credits.setBalance('UD', 500);
  NOW = DROP_AT - 30000;
  const before = await state('UD');
  const roseBefore = before.json.boosters.find((b) => b.type === 'octobre_rose');
  check('avant l\'arrivée : Octobre Rose not_yet, rafraîchissement rapide (fenêtre 9h-10h)', roseBefore.block === 'not_yet' && before.json.fastRefresh === true);
  NOW += 2000;
  const before2 = await state('UD');
  NOW = DROP_AT + 10000;
  const stale = await buy('UD', { type: 'octobre_rose', nonce: before.json.nonce });
  check('jeton émis avant l\'arrivée, achat après → stale, rien débité', stale.json.ok === false && stale.json.reason === 'stale' && credits.getBalance('UD') === 500);
  check('… pas compté comme spam (aucun blocage)', !boosterSpam.lockedUntil('UD', NOW));
  NOW += 500;
  const regular = await buy('UD', { type: 'common', nonce: before2.json.nonce });
  check('booster classique avec un jeton d\'avant l\'arrivée → acheté (pas de règle stale)', regular.json.ok === true);
  const afterCommon = credits.getBalance('UD');
  NOW += 1100;
  const fresh = await state('UD');
  check('nouvel état après l\'arrivée : Octobre Rose achetable', fresh.json.boosters.find((b) => b.type === 'octobre_rose').block === null);
  NOW += 1100;
  const okRose = await buy('UD', { type: 'octobre_rose', nonce: fresh.json.nonce });
  check('jeton frais, achat 1,1 s plus tard → acheté', okRose.json.ok === true && credits.getBalance('UD') === afterCommon - boosters.getBooster('octobre_rose', NOW).price);
  const staleUnit = purchaseNonce.issue('UE', NOW, { purchasable: ['common'] });
  check('purchaseNonce : type exigé absent des achetables → stale', purchaseNonce.consume('UE', staleUnit.value, NOW + 2000, { requirePurchasable: 'octobre_rose' }) === 'stale');
  const okUnit = purchaseNonce.issue('UE', NOW, { purchasable: ['octobre_rose'] });
  check('purchaseNonce : type exigé présent → ok', purchaseNonce.consume('UE', okUnit.value, NOW + 2000, { requirePurchasable: 'octobre_rose' }) === 'ok');
  NOW = RealDate.parse('2026-10-15T08:30:00Z') + 200000;   // retour le jeudi pour la suite

  const hooksBefore = hookCalls.length;

  // ── Pause (congés) ──
  credits.setBalance('UC', 500);
  const decl = leave.declareLeave('UC', '2026-10-15', '2026-10-16', NOW);
  check('congés déclarés pour UC', decl.ok);
  const sp = await state('UC');
  check('état pendant une pause : pause renseignée', sp.json.pause && /congés/.test(sp.json.pause.title));
  NOW += 1500;
  const paused = await buy('UC', { type: 'common', nonce: sp.json.nonce });
  check('achat pendant une pause → ok:false avec le texte de pause', paused.json.ok === false && /Jeanpip est en pause/.test(paused.json.text || '') && /congés/.test(paused.json.text || ''));
  check('… rien débité, hook pas rappelé', credits.getBalance('UC') === 500 && hookCalls.length === hooksBefore);

  server.close();
  try { req('db.js').close(); } catch { /* base jamais ouverte */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows */ }
  console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
