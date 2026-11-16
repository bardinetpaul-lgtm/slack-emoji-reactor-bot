#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test v4.4 : maison qui s'agrandit et ferme à Jeanpips
//  (src/maison.js + routes POST de src/villeWeb.js)
//  Travaille dans une COPIE temporaire du projet (aucune donnée réelle).
//    • chantiers : le niveau arrive au bout de la durée des travaux,
//      un chantier à la fois (busy), la ferme produit à l'ancien niveau ;
//    • niveaux de maison : prix débité, niveau suivant seulement,
//      double clic (niveau déjà passé) → 'stale' sans débit, max → 'max' ;
//    • solde insuffisant → rien ne change ; pause du jeu → refus sans débit ;
//    • ferme : production à l'heure, silo plafonné, rien le week-end,
//      récolte des JP$ entiers (les centimes restent), silo vide → 'empty' ;
//    • web : jeton exigé, non-inscrit refusé, état public (niveau, ferme)
//      vu par les autres sans leur solde ni leur silo, 'house' update en direct.
//  Usage : node scripts/test-maison.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-maison-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

process.env.WEB_PUBLIC_URL = 'http://jeanpip.test';
process.env.WEB_SECRET = 'test-secret';

const origLog = console.log;
console.log = () => {};
const req = (rel) => require(path.join(TMP, 'src', rel));
const maison = req('maison.js');
const credits = req('credits.js');
const weekend = req('weekend.js');
const broadcast = req('broadcast.js');
const leave = req('leave.js');
const web = req('web.js');
const villeToken = req('villeToken.js');
const villeWeb = req('villeWeb.js');
const { getDb } = req('db.js');
console.log = origLog;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const H = 3600 * 1000;
const WED = Date.parse('2026-11-18T09:00:00Z'); // mercredi 10h à Paris
const SAT = Date.parse('2026-11-21T10:00:00Z');
const FRI_22H = Date.parse('2026-11-20T21:00:00Z'); // vendredi 22h à Paris
const MON_0H30 = Date.parse('2026-11-22T23:30:00Z'); // lundi 0h30 à Paris
const moves = (u, source) => getDb().prepare('SELECT amount FROM credit_moves WHERE user_id = ? AND source = ?').all(u, source);

// ── 🏠 Maison ──────────────────────────────────────────────
const look = (u, t) => JSON.stringify(maison.publicOf(u, t));
check('maison de départ : niveau 1, pas de ferme, pas de chantier', look('U1', WED) === '{"level":1,"farm":0,"building":false}');
credits.setBalance('U1', 1000);
let r = maison.upgradeHouse('U1', 3, WED);
check('sauter un niveau → stale, rien débité', !r.ok && r.reason === 'stale' && credits.getBalance('U1') === 1000);
r = maison.upgradeHouse('U1', 2, WED);
check('niveau 2 : 150 JP$ débités, chantier de 3 h', r.ok && r.level === 2 && r.price === 150 && r.endsAt === WED + 3 * H && credits.getBalance('U1') === 850);
check('… mouvement « house_upgrade » dans le grand livre', moves('U1', 'house_upgrade').length === 1 && moves('U1', 'house_upgrade')[0].amount === -150);
check('pendant le chantier : toujours niveau 1, chantier visible par tous', look('U1', WED + H) === '{"level":1,"farm":0,"building":true}'
  && maison.worksOf('U1', WED + H).house.name === 'Maison fleurie');
r = maison.upgradeHouse('U1', 2, WED + H);
check('double clic (niveau 2 redemandé) → stale, rien débité', !r.ok && r.reason === 'stale' && credits.getBalance('U1') === 850);
r = maison.upgradeHouse('U1', 3, WED + H);
check('autre travaux pendant le chantier → busy, rien débité', !r.ok && r.reason === 'busy' && credits.getBalance('U1') === 850);
check('fenêtre du propriétaire : pas de bouton suivant pendant le chantier', maison.ownerView('U1', WED + H).house.next === null
  && maison.ownerView('U1', WED + H).house.works.level === 2);
check('chantier fini au bout de 3 h : niveau 2', look('U1', WED + 3 * H) === '{"level":2,"farm":0,"building":false}');
r = maison.upgradeHouse('U1', 3, SAT);
check('le week-end → pause, rien débité', !r.ok && r.reason === 'pause' && credits.getBalance('U1') === 850 && maison.publicOf('U1', SAT).level === 2);
r = maison.upgradeHouse('U1', 3, WED + 4 * H);
check('niveau 3 : 400 JP$, chantier d\'1 jour', r.ok && credits.getBalance('U1') === 450 && r.endsAt === WED + 28 * H);
check('… pas encore fini après 23 h, fini après 24 h', maison.publicOf('U1', WED + 27 * H).level === 2 && maison.publicOf('U1', WED + 28 * H).level === 3);
const THU = WED + 29 * H;
r = maison.upgradeHouse('U1', 4, THU);
check('niveau 4 trop cher (900 JP$, solde 450) → insufficient, rien ne change', !r.ok && r.reason === 'insufficient' && r.price === 900
  && credits.getBalance('U1') === 450 && !maison.publicOf('U1', THU).building);
credits.setBalance('U1', 900);
r = maison.upgradeHouse('U1', 4, THU);
check('niveau 4 (Villa) : chantier de 3 jours', r.ok && r.name === 'Villa' && credits.getBalance('U1') === 0 && r.endsAt === THU + 72 * H);
check('… Villa au bout de 3 jours (week-end compris)', maison.publicOf('U1', THU + 72 * H).level === 4);
const MON = THU + 96 * H; // lundi
credits.setBalance('U1', 2000);
r = maison.upgradeHouse('U1', 5, MON);
check('niveau 5 (Château Jeanpip) : 2 000 JP$, chantier de 5 jours', r.ok && r.name === 'Château Jeanpip' && r.endsAt === MON + 120 * H && credits.getBalance('U1') === 0);
check('… Château au bout de 5 jours', maison.publicOf('U1', MON + 119 * H).level === 4 && maison.publicOf('U1', MON + 120 * H).level === 5);
check('au-delà du max → max', maison.upgradeHouse('U1', 6, MON + 168 * H).reason === 'max'); // lundi suivant

// 🏆 Concours de la plus belle maison
credits.setBalance('U5', 150);
maison.upgradeHouse('U5', 2, WED);
const podium = maison.contest(['U5', 'U1', 'U9'], MON + 168 * H);
check('concours : le Château 1er, la Maison fleurie 2e, la maison de départ non classée',
  podium.length === 2 && podium[0].userId === 'U1' && podium[0].rank === 1 && podium[0].name === 'Château Jeanpip' && podium[1].userId === 'U5' && podium[1].rank === 2);
credits.setBalance('U6', 150);
maison.upgradeHouse('U6', 2, WED + H);
const tie = maison.contest(['U6', 'U5'], MON + 168 * H);
check('concours, même niveau : le premier arrivé passe devant', tie[0].userId === 'U5' && tie[1].userId === 'U6');

// ── 🌾 Ferme ───────────────────────────────────────────────
check('pas de ferme → récolte refusée', maison.collect('U2', WED).reason === 'no_farm');
credits.setBalance('U2', 220);
r = maison.upgradeFarm('U2', 1, WED - 4 * H);
check('Potager acheté 220 JP$, chantier de 4 h', r.ok && r.level === 1 && credits.getBalance('U2') === 0 && r.endsAt === WED);
check('pendant le chantier : rien ne pousse, récolte refusée (building)', maison.ownerView('U2', WED - H).farm.stock === 0
  && maison.collect('U2', WED - H).reason === 'building');
let v = maison.ownerView('U2', WED + 30 * 60 * 1000);
check('après 30 min : 0,37 JP$ poussé (0,75/h), rien de récoltable', v.farm.stock === 0.37 && v.farm.ready === 0);
check('… récolte refusée (empty)', maison.collect('U2', WED + 30 * 60 * 1000).reason === 'empty');
v = maison.ownerView('U2', WED + 3.5 * H);
check('après 3 h 30 : 2,62 JP$ poussés, 2 récoltables', v.farm.ready === 2 && v.farm.stock === 2.62 && !v.farm.full);
r = maison.collect('U2', WED + 3.5 * H);
check('récolte : 2 JP$ crédités, les 0,62 restent dans le silo', r.ok && r.amount === 2 && credits.getBalance('U2') === 2
  && maison.ownerView('U2', WED + 3.5 * H).farm.stock === 0.62);
check('… mouvement « farm » dans le grand livre', moves('U2', 'farm').length === 1 && moves('U2', 'farm')[0].amount === 2);
v = maison.ownerView('U2', WED + 40 * H);
check('silo plein : plafonné à 6 JP$', v.farm.ready === 6 && v.farm.full);
maison.collect('U2', WED + 40 * H);
credits.setBalance('U2', 450);
const T2 = Date.parse('2026-11-23T09:00:00Z'); // lundi 10h
maison.collect('U2', T2);
r = maison.upgradeFarm('U2', 2, T2);
check('Serre achetée : pendant son chantier d\'1 jour, la ferme produit encore à 0,75 JP$/h', r.ok && maison.ownerView('U2', T2 + 2 * H).farm.perHour === 0.75
  && maison.ownerView('U2', T2 + 2 * H).farm.stock === 1.5);
check('… puis Serre : 1,5 JP$/h, silo 12 (1 h après la fin : 6 + 1,5 = 7,5)', maison.ownerView('U2', T2 + 25 * H).farm.perHour === 1.5
  && maison.ownerView('U2', T2 + 25 * H).farm.silo === 12 && maison.ownerView('U2', T2 + 25 * H).farm.stock === 7.5);

// Week-end : vendredi 22h → lundi 0h30 = 2 h + 0 h 30 de production
credits.setBalance('U3', 220);
maison.upgradeFarm('U3', 1, FRI_22H - 4 * H); // chantier fini vendredi 22h
v = maison.ownerView('U3', MON_0H30);
check('rien ne pousse le week-end (ven 22h → lun 0h30 = 2 h 30 × 0,75 = 1,87 JP$)', v.farm.stock === 1.87 && v.farm.ready === 1);
check('le samedi, la ferme est marquée en pause', maison.ownerView('U3', SAT).farm.paused === true);
check('le samedi, pas de récolte (pause), le silo reste plein', maison.collect('U3', SAT).reason === 'pause' && maison.ownerView('U3', SAT).farm.stock === 1.5);

// 🌴 Congés du joueur : rien ne pousse, pas de récolte
check('congés déclarés (mer. 25 et jeu. 26)', leave.declareLeave('U4', '2026-11-25', '2026-11-26', WED).ok);
credits.setBalance('U4', 220);
maison.upgradeFarm('U4', 1, Date.parse('2026-11-24T15:00:00Z')); // mardi 16h, chantier fini à 20h
check('mardi 20h → jeudi 21h (congés mer. et jeu.) : seulement 3 JP$ (mardi 20h → minuit, 4 h × 0,75)',
  maison.ownerView('U4', Date.parse('2026-11-26T20:00:00Z')).farm.stock === 3);
check('… pendant ses congés : pas de récolte, ferme marquée en pause', maison.collect('U4', Date.parse('2026-11-26T20:00:00Z')).reason === 'pause'
  && maison.ownerView('U4', Date.parse('2026-11-26T20:00:00Z')).farm.paused === true);
check('… vendredi 3h, ça repousse (3 + 2,25 = 5,25) et la récolte marche', maison.ownerView('U4', Date.parse('2026-11-27T02:00:00Z')).farm.stock === 5.25
  && maison.collect('U4', Date.parse('2026-11-27T02:00:00Z')).amount === 5);
check('production : 0 sans ferme ou sans durée', maison._produced(0, WED, WED + H) === 0 && maison._produced(1, WED, WED) === 0);

// ── 🌐 Web ─────────────────────────────────────────────────
weekend.pauseFor = () => null; // le test web ne dépend pas du jour où il est lancé
weekend.isPaused = () => false;

function call(method, pathQ, body) {
  return new Promise((resolve, reject) => {
    const rq = http.request({ host: '127.0.0.1', port: PORT, path: `/${pathQ}`, method, headers: { 'Content-Type': 'application/json' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf-8')); } catch { /* pas du JSON */ }
        resolve({ status: res.statusCode, json });
      });
    });
    rq.on('error', reject);
    rq.end(body ? JSON.stringify(body) : undefined);
  });
}
function openStream(pathQ) {
  const s = { events: [] };
  const rq = http.get({ host: '127.0.0.1', port: PORT, path: `/${pathQ}` }, (res) => {
    let buf = '';
    res.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(block);
        const data = /^data: (.+)$/m.exec(block);
        if (ev && data) s.events.push({ event: ev[1], data: JSON.parse(data[1]) });
      }
    });
  });
  rq.on('error', () => {});
  s.close = () => rq.destroy();
  return s;
}
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await wait(50); }
  return false;
}
const q = (u) => villeToken.query(u);
let PORT = 0;
const quiet = { info: () => {}, warn: () => {}, error: (...a) => console.error(...a) };
const client = { users: { info: async ({ user }) => ({ user: { profile: { display_name: user } } }) } };

(async () => {
  broadcast.subscribe('UA');
  broadcast.subscribe('UB');
  const server = web.startWebServer({ client, logger: quiet, port: 0, force: true });
  await until(() => server.address());
  PORT = server.address().port;

  check('POST sans jeton → 403', (await call('POST', 'api/ville/maison/house', { to: 2 })).status === 403);
  check('GET sur une route de travaux → 405', (await call('GET', `api/ville/maison/house?${q('UA')}`)).status === 405);
  check('action inconnue → 404', (await call('POST', `api/ville/maison/piscine?${q('UA')}`, {})).status === 404);
  const out = await call('POST', `api/ville/maison/house?${q('UZ')}`, { to: 2 });
  check('non-inscrit (pas de maison) → no_house', out.json && out.json.ok === false && out.json.reason === 'no_house' && out.json.text);

  const s = openStream(`api/ville/stream?${q('UB')}`);
  await until(() => villeWeb._clientCount() === 1);
  credits.setBalance('UA', 500);
  r = (await call('POST', `api/ville/maison/house?${q('UA')}`, { to: 2 })).json;
  check('web : chantier niveau 2 lancé, solde renvoyé', r.ok && r.level === 2 && r.endsAt > Date.now() && r.balance === 350 && r.owner.house.works.level === 2);
  check('direct : UB voit le chantier chez UA (house update, building)', await until(() => s.events.some((e) => e.event === 'house'
    && e.data.action === 'update' && e.data.house.userId === 'UA' && e.data.house.building === true && e.data.house.level === 1 && Number.isInteger(e.data.house.plot))));
  r = (await call('POST', `api/ville/maison/house?${q('UA')}`, { to: 2 })).json;
  check('web : double clic → stale, texte, rien débité', !r.ok && r.reason === 'stale' && r.text && credits.getBalance('UA') === 350);
  r = (await call('POST', `api/ville/maison/house?${q('UA')}`, { to: 3 })).json;
  check('web : autres travaux pendant le chantier → busy + texte', !r.ok && r.reason === 'busy' && r.text && credits.getBalance('UA') === 350);
  r = (await call('POST', `api/ville/maison/farm?${q('UA')}`, { to: 1 })).json;
  check('web : chantier de ferme lancé en même temps (un par bâtiment)', r.ok && r.level === 1 && credits.getBalance('UA') === 130);
  r = (await call('POST', `api/ville/maison/collect?${q('UA')}`)).json;
  check('web : récolte pendant le chantier → building + texte', !r.ok && r.reason === 'building' && r.text);

  const st = (await call('GET', `api/ville?${q('UB')}`)).json;
  const a = st.houses.find((h) => h.userId === 'UA');
  check('état de la ville : la maison de UA est en chantier (vu par UB)', a && a.level === 1 && a.farm === 0 && a.building === true);
  const cardB = (await call('GET', `api/ville/card/UA?${q('UB')}`)).json;
  check('carte de UA vue par UB : chantiers visibles, ni solde ni silo', cardB.maison.works.house.name === 'Maison fleurie'
    && cardB.maison.works.farm.name === 'Potager à Jeanpips' && !('owner' in cardB) && !('balance' in cardB));
  const cardA = (await call('GET', `api/ville/card/UA?${q('UA')}`)).json;
  check('sa propre carte : chantiers en cours, pas de bouton suivant', cardA.owner && cardA.owner.house.next === null && cardA.owner.farm.works.level === 1);
  check('Mairie : palmarès des plus belles maisons présent (vide : personne n\'a fini de travaux)', Array.isArray(st.mairie.contest) && st.mairie.contest.length === 0);

  s.close();
  await until(() => villeWeb._clientCount() === 0);
  server.close();
  try { req('db.js').close(); } catch { /* déjà fermée */ }
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
