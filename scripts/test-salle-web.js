#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test de la Salle des ventes web (src/salleWeb.js via web.js, v4.2)
//  Vrai serveur, dans une COPIE temporaire du projet, horloge simulée
//  (mercredi 4/11/2026 à 10h, Paris) :
//    • page servie ; jeton absent ou faux → 403 ; mauvaise méthode → 405 ;
//      interrogation trop rapprochée → 429 ;
//    • état : solde, inscrit, enchères en cours (vendeur, meilleure offre,
//      minimum, mine / leading, avatar relatif), cartes cessibles (même
//      source que la modale Slack, plancher par rareté) ;
//    • non-inscrit → « blocked », ses POST refusés, rien ne bouge ;
//    • enchère trop basse, sur sa propre carte, solde insuffisant, pendant
//      une pause → ok:false avec le texte exact de la modale Slack, rien ne bouge ;
//    • enchère valide → JP$ mis de côté, ancien meilleur remboursé, hook onBid
//      appelé une seule fois (même s'il lève) ;
//    • mise en vente sous le plancher → refusée ; valide → enchère créée,
//      hook onAuctionCreated appelé une seule fois ;
//    • « recent » : au plus 10 ventes, les plus récentes en premier.
//  Usage : npx -y -p node@20 node scripts/test-salle-web.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-salle-web-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

// ⏰ Horloge simulée : mercredi 4/11/2026 à 10h (Paris, UTC+1)
const RealDate = Date;
let NOW = RealDate.parse('2026-11-04T09:00:00Z');
global.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(NOW); }
  static now() { return NOW; }
};
const advance = (ms) => { NOW += ms; };

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
const broadcast = req('broadcast.js');
const cardIndex = req('cardIndex.js');
const trades = req('trades.js');
const tradesSlack = req('tradesSlack.js');
const leave = req('leave.js');
const weekend = req('weekend.js');
const { cardImageUrl, cardThumbUrl } = req('cardImages.js');
const { parisDay } = req('octobreRose.js');

let failures = 0;
function check(label, cond) {
  origLog(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const errors = [];
const quiet = { info: () => {}, warn: () => {}, error: (...a) => { errors.push(a.join(' ')); } };
// Faux Slack : nom = « Nom <id> », photo pour tout le monde sauf U_NOPIC
const client = {
  users: {
    info: async ({ user }) => ({ user: { profile: { display_name: `Nom ${user}`, image_72: user === 'U_NOPIC' ? undefined : `https://slack.test/${user}.png` } } }),
  },
};

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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (u) => villeToken.query(u);
/** GET de l'état (avance l'horloge d'1,1 s avant : pas de 429). */
const state = async (u) => { advance(1100); return (await request('GET', `api/salle?${q(u)}`)).json; };
const bid = (u, body) => request('POST', `api/salle/bid?${q(u)}`, body);
const sell = (u, body) => request('POST', `api/salle/sell?${q(u)}`, body);

const snapshot = (...users) => JSON.stringify({
  users: users.map((u) => [u, credits.getBalance(u), collections.getCollection(u).map((c) => [c.url, c.count])]),
  trades: trades._load(),
});

(async () => {
  const cards = cardIndex.listCards();
  const COMMON = cards.filter((c) => c.rarity === 'common');
  const C1 = COMMON[0];
  const C2 = COMMON[1];
  const HW1 = cardIndex.byCode('HW1');
  const give = (u, c, n = 1) => collections.addCards(u, Array.from({ length: n }, () => ({ url: c.url, title: c.title, rarity: c.rarity, type: c.type })));

  for (const u of ['U_S', 'U_B1', 'U_B2', 'U_PAUSE', 'U_NOPIC', 'U_POOR']) broadcast.subscribe(u);
  for (const u of ['U_B1', 'U_B2', 'U_PAUSE', 'U_OUT']) credits.addCredit(u, 100, { source: 'test' });
  credits.addCredit('U_POOR', 3, { source: 'test' });
  give('U_S', HW1, 2);
  give('U_S', C1, 1);
  give('U_OUT', C2, 1);
  give('U_PAUSE', C2, 1);
  leave.declareLeave('U_PAUSE', parisDay(Date.now()), parisDay(Date.now()));
  check('préparation : U_PAUSE en congés, les autres non', Boolean(weekend.pauseFor('U_PAUSE')) && !weekend.pauseFor('U_S'));

  // Une enchère de U_S sur HW1, déjà ouverte (lancée « depuis Slack »)
  const a1 = trades.createAuction({ seller: 'U_S', code: 'HW1', startPrice: 12 });
  check('préparation : enchère HW1 ouverte à 12 JP$', a1.ok && a1.trade.startPrice === 12);
  const A1 = a1.trade.id;

  const created = [];
  const bidsSeen = [];
  const hooks = {
    onAuctionCreated: (res) => { created.push(res); throw new Error('hook en panne (voulu)'); },
    onBid: async (res, userId) => { bidsSeen.push({ res, userId }); throw new Error('hook en panne (voulu)'); },
  };
  const server = web.startWebServer({ client, logger: quiet, port: 0, force: true, hooks });
  while (!server.address()) await wait(20);
  PORT = server.address().port;
  console.log = origLog;

  // ── Page ──
  const page = await request('GET', `salle?${q('U_S')}`);
  const hasPage = fs.existsSync(path.join(ROOT, 'public', 'salle.html'));
  check(hasPage ? 'page Salle des ventes servie' : 'page Salle des ventes : 404 tant que public/salle.html n\'existe pas (Tâche B)',
    hasPage ? page.status === 200 && /<html/i.test(page.body) : page.status === 404);

  // ── Jetons, méthodes, rythme ──
  const before = snapshot('U_S', 'U_B1');
  check('état : jeton absent → 403 JSON', (await request('GET', 'api/salle')).status === 403);
  const fake = await request('GET', `api/salle?t=U_S.${'0'.repeat(64)}`);
  check('état : faux jeton → 403 JSON', fake.status === 403 && fake.json && fake.json.ok === false);
  check('enchère : jeton absent → 403', (await request('POST', 'api/salle/bid', { tradeId: A1, jp: 50 })).status === 403);
  check('mise en vente : faux jeton → 403', (await request('POST', `api/salle/sell?t=U_S.${'0'.repeat(64)}`, { code: 'HW1' })).status === 403);
  check('état : POST refusé (405)', (await request('POST', `api/salle?${q('U_S')}`, {})).status === 405);
  check('enchère : GET refusé (405)', (await request('GET', `api/salle/bid?${q('U_B1')}`)).status === 405);
  check('mise en vente : GET refusé (405)', (await request('GET', `api/salle/sell?${q('U_S')}`)).status === 405);
  check('jetons et méthodes refusés : rien n\'a bougé, aucun hook', snapshot('U_S', 'U_B1') === before && !created.length && !bidsSeen.length);
  const first = await request('GET', `api/salle?${q('U_B2')}`);
  const second = await request('GET', `api/salle?${q('U_B2')}`);
  check('état : 2ᵉ interrogation dans la seconde → 429', first.status === 200 && second.status === 429 && second.json.ok === false);

  // ── État ──
  const sb = await state('U_B1');
  check('état : ok, serverTime, me', sb.ok === true && sb.serverTime === NOW && sb.me.userId === 'U_B1' && sb.me.balance === 100 && sb.me.subscribed === true);
  check('état : ni pause ni blocage', sb.pause === null && sb.blocked === null);
  const au = sb.auctions.find((a) => a.id === A1);
  check('état : l\'enchère en cours est listée', sb.auctions.length === 1 && Boolean(au));
  check('enchère : carte (code, titre, rareté, image du bot)', au.card.code === 'HW1' && au.card.title === HW1.title && au.card.rarity === 'halloween'
    && au.card.image === cardImageUrl({ url: HW1.url, type: HW1.type }));
  check('enchère : vendeur avec nom et avatar relatif', au.seller.userId === 'U_S' && au.seller.name === 'Nom U_S'
    && au.seller.avatar === `api/ville/avatar/U_S?${q('U_B1')}`);
  check('enchère : prix de départ, pas de meilleure offre, minimum = départ', au.startPrice === 12 && au.best === null && au.minBid === 12);
  check('enchère : fin = trades.auctionEnd, ni mine ni leading', au.endsAt === a1.trade.endsAt && au.mine === false && au.leading === false);
  const ss = await state('U_S');
  check('état du vendeur : mine = true', ss.auctions[0].mine === true && ss.auctions[0].leading === false);
  const free = trades.cessible('U_S');
  const expected = cardIndex.listCardsFor('U_S').filter((c) => free.has(c.url));
  check('cessibles : même source que la modale Slack (HW1 : 1 sur 2, l\'autre est réservée ; C1 : 1)',
    ss.sellable.length === expected.length && ss.sellable.length === 2
    && ss.sellable.find((c) => c.code === 'HW1').count === 1 && ss.sellable.find((c) => c.code === C1.code).count === 1);
  const sHW = ss.sellable.find((c) => c.code === 'HW1');
  check('cessibles : plancher par rareté et miniature', sHW.floor === trades.floor('halloween') && sHW.rarity === 'halloween'
    && sHW.title === HW1.title && sHW.image === cardThumbUrl({ url: HW1.url, type: HW1.type }));
  check('aucune vente terminée : recent vide', Array.isArray(ss.recent) && ss.recent.length === 0);

  // ── Non-inscrit ──
  const so = await state('U_OUT');
  check('non-inscrit : subscribed false et « blocked » = texte Slack', so.ok === true && so.me.subscribed === false
    && so.blocked === tradesSlack.ERROR_TEXT.not_subscribed);
  const o0 = snapshot('U_OUT', 'U_S');
  const ob = (await bid('U_OUT', { tradeId: A1, jp: 20 })).json;
  check('non-inscrit : enchère refusée avec le texte « inscris-toi »', ob.ok === false && ob.text === tradesSlack.ERROR_TEXT.not_subscribed);
  const os_ = (await sell('U_OUT', { code: C2.code, startPrice: null })).json;
  check('non-inscrit : mise en vente refusée avec le texte « inscris-toi »', os_.ok === false && os_.text === tradesSlack.ERROR_TEXT.not_subscribed);
  check('non-inscrit : rien n\'a bougé, aucun hook', snapshot('U_OUT', 'U_S') === o0 && !created.length && !bidsSeen.length);

  // ── Pause ──
  const pz = weekend.pauseFor('U_PAUSE');
  const pauseText = `${pz.icon} Pas d'échange ${pz.short} : ça reprend ${pz.back}.`;
  const sp = await state('U_PAUSE');
  check('en congés : pause { title } sans mrkdwn et « blocked » = texte Slack', sp.pause && sp.pause.title === pz.title.replace(/\*/g, '')
    && sp.blocked === pauseText);
  const p0 = snapshot('U_PAUSE', 'U_S');
  const pb = (await bid('U_PAUSE', { tradeId: A1, jp: 20 })).json;
  check('en congés : enchère refusée, texte exact de la modale Slack', pb.ok === false && pb.error === 'pause' && pb.text === pauseText);
  const ps = (await sell('U_PAUSE', { code: C2.code })).json;
  check('en congés : mise en vente refusée, texte exact de la modale Slack', ps.ok === false && ps.error === 'pause' && ps.text === pauseText);
  check('en congés : rien n\'a bougé', snapshot('U_PAUSE', 'U_S') === p0);

  // ── Enchères refusées ──
  const b0 = snapshot('U_S', 'U_B1', 'U_POOR');
  const low = (await bid('U_B1', { tradeId: A1, jp: 11 })).json;
  check('trop basse : texte exact de la modale', low.ok === false && low.error === 'too_low' && low.text === 'Enchère trop basse. Au moins 12 JP$.');
  const own = (await bid('U_S', { tradeId: A1, jp: 30 })).json;
  check('sur sa propre carte : texte exact de la modale', own.ok === false && own.error === 'self' && own.text === tradesSlack.ERROR_TEXT.self_bid);
  const poor = (await bid('U_POOR', { tradeId: A1, jp: 12 })).json;
  check('solde insuffisant : texte exact de la modale (avec le solde)', poor.ok === false && poor.error === 'balance'
    && poor.text === `${tradesSlack.ERROR_TEXT.balance} (3 JP$)`);
  const empty = (await bid('U_B1', { tradeId: A1 })).json;
  check('montant absent : « Indique ton enchère en JP$. »', empty.ok === false && empty.text === 'Indique ton enchère en JP$.');
  const ghost = (await bid('U_B1', { tradeId: 'T999-x', jp: 20 })).json;
  check('enchère inconnue : « terminée »', ghost.ok === false && ghost.text === tradesSlack.ERROR_TEXT.ended);
  const junk = (await request('POST', `api/salle/bid?${q('U_B1')}`, 'pas du json')).json;
  check('corps invalide : refus propre', junk && junk.ok === false && typeof junk.text === 'string');
  check('refus : JP$, cartes et enchères inchangés, aucun hook', snapshot('U_S', 'U_B1', 'U_POOR') === b0 && !bidsSeen.length);
  check('textes = bidErrorText (même fonction que la modale)', low.text === tradesSlack.bidErrorText({ ok: false, error: 'too_low', trade: trades.getTrade(A1) }, 'U_B1')
    && pb.text === tradesSlack.bidErrorText({ ok: false, error: 'pause' }, 'U_PAUSE'));

  // ── Enchères valides ──
  const r1 = await bid('U_B1', { tradeId: A1, jp: 12 });
  await wait(50);
  check('B1 enchérit 12 : ok, JP$ mis de côté (100 → 88)', r1.status === 200 && r1.json.ok === true && credits.getBalance('U_B1') === 88);
  check('réponse : l\'état à jour (leading, solde, minimum 13)', r1.json.me.balance === 88 && r1.json.auctions[0].leading === true
    && r1.json.auctions[0].minBid === 13 && r1.json.auctions[0].best.userId === 'U_B1' && r1.json.auctions[0].best.name === 'Nom U_B1' && r1.json.auctions[0].best.jp === 12);
  check('hook onBid appelé une fois (res, userId), même s\'il lève', bidsSeen.length === 1 && bidsSeen[0].userId === 'U_B1'
    && bidsSeen[0].res.ok === true && bidsSeen[0].res.outbid === null && bidsSeen[0].res.trade.id === A1);
  const already = (await bid('U_B1', { tradeId: A1, jp: 20 })).json;
  check('B1 surenchérit sur lui-même : texte de la modale', already.ok === false && already.text === tradesSlack.ERROR_TEXT.already_best && bidsSeen.length === 1);
  const r2 = await bid('U_B2', { tradeId: A1, jp: '20' });
  await wait(50);
  check('B2 enchérit 20 : 100 → 80, B1 remboursé (88 → 100)', r2.json.ok === true && credits.getBalance('U_B2') === 80 && credits.getBalance('U_B1') === 100);
  check('hook onBid : 2ᵉ appel, outbid = B1', bidsSeen.length === 2 && bidsSeen[1].userId === 'U_B2' && bidsSeen[1].res.outbid === 'U_B1');
  const s1 = await state('U_B1');
  check('état de B1 après dépassement : leading false, meilleure offre B2 à 20, minimum 21',
    s1.auctions[0].leading === false && s1.auctions[0].best.userId === 'U_B2' && s1.auctions[0].minBid === 21);
  check('hooks en panne : erreurs seulement journalisées', errors.length === 2 && errors.every((e) => /hook en panne/.test(e)));

  // ── Mise en vente ──
  const v0 = snapshot('U_S');
  const under = (await sell('U_S', { code: 'HW1', startPrice: 5 })).json;
  check('sous le plancher : refus, texte exact de la modale', under.ok === false && under.error === 'floor'
    && under.text === `Prix de départ trop bas : ${trades.floor('halloween')} JP$ minimum pour cette carte.`);
  const dec = (await sell('U_S', { code: 'HW1', startPrice: 12.5 })).json;
  check('prix non entier : texte de la modale', dec.ok === false && dec.text === tradesSlack.ERROR_TEXT.bad_amount);
  const unknown = (await sell('U_S', { code: 'ZZ999' })).json;
  check('numéro inconnu : texte de la modale', unknown.ok === false && unknown.text === 'Numéro inconnu : ZZ999.');
  const none = (await sell('U_S', {})).json;
  check('aucune carte : « Choisis une carte. »', none.ok === false && none.text === 'Choisis une carte.');
  const notMine = (await sell('U_S', { code: C2.code })).json;
  check('carte que je n\'ai pas : texte de la modale', notMine.ok === false && notMine.text === tradesSlack.ERROR_TEXT.unavailable);
  check('refus : rien n\'a bougé, aucun hook', snapshot('U_S') === v0 && !created.length
    && under.text === tradesSlack.auctionErrorText({ ok: false, error: 'floor' }, HW1, 'U_S'));

  const ok = await sell('U_S', { code: 'hw1', startPrice: null });
  await wait(50);
  const t2 = ok.json && trades.getTrade(ok.json.tradeId);
  check('mise en vente valide : ok, tradeId, endsAt', ok.status === 200 && ok.json.ok === true && t2 && t2.kind === 'auction' && t2.status === 'open'
    && ok.json.endsAt === t2.endsAt && t2.startPrice === trades.floor('halloween'));
  check('mise en vente : 2ᵉ exemplaire de HW1 réservé (plus cessible)', !ok.json.sellable.some((c) => c.code === 'HW1') && ok.json.auctions.length === 2);
  check('hook onAuctionCreated appelé une fois, avec les inscrits à prévenir', created.length === 1 && created[0].trade.id === t2.id
    && created[0].recipients.includes('U_B1') && !created[0].recipients.includes('U_S') && !created[0].recipients.includes('U_OUT'));
  const tooSoon = await sell('U_S', { code: 'HW1' });
  check('2ᵉ mise en vente en moins de 5 s : 429 « Doucement », hook non rappelé', tooSoon.status === 429 && tooSoon.json.reason === 'slow_down' && created.length === 1);
  advance(6000);
  const again = (await sell('U_S', { code: 'HW1' })).json;
  check('plus d\'exemplaire libre : refus, hook non rappelé', again.ok === false && again.text === tradesSlack.ERROR_TEXT.unavailable && created.length === 1);

  // ── Photo absente ──
  const n1 = trades.createAuction({ seller: 'U_NOPIC', code: C1.code });   // U_NOPIC n'a pas la carte
  check('préparation : U_NOPIC sans la carte → unavailable', !n1.ok && n1.error === 'unavailable');
  give('U_NOPIC', C1, 1);
  const n2 = trades.createAuction({ seller: 'U_NOPIC', code: C1.code });
  const sn = await state('U_B1');
  check('vendeur sans photo Slack : avatar null', n2.ok && sn.auctions.find((a) => a.id === n2.trade.id).seller.avatar === null);

  // ── Dernières ventes ──
  NOW = a1.trade.endsAt + 60000;   // jeudi 10h01 : A1 terminée
  const settled = trades.settleAuction(A1);
  check('préparation : A1 adjugée à B2 pour 20 JP$', settled.ok && settled.outcome === 'sold');
  const sr = await state('U_B1');
  check('recent : la vente réelle (carte, vendeur, gagnant, prix, date)', sr.recent.length === 1 && sr.recent[0].card.code === 'HW1'
    && sr.recent[0].seller.name === 'Nom U_S' && sr.recent[0].winner.name === 'Nom U_B2' && sr.recent[0].jp === 20 && sr.recent[0].at === settled.trade.closedAt
    && sr.recent[0].card.image === cardThumbUrl({ url: HW1.url, type: HW1.type }));
  check('A1 n\'est plus dans les enchères en cours', !sr.auctions.some((a) => a.id === A1));

  // 12 ventes fictives + 1 enchère sans enchérisseur + 1 demande conclue
  const data = trades._load();
  const base = NOW - 100 * 3600000;
  for (let i = 0; i < 12; i += 1) {
    data.trades[`F${i}`] = {
      id: `F${i}`, kind: 'auction', buyer: 'U_B1', seller: 'U_S', status: 'done', reason: 'sold',
      card: { url: C1.url, title: C1.title, rarity: C1.rarity, code: C1.code }, offer: { jp: 0, cards: [] },
      startPrice: 1, held: {}, createdAt: base, endsAt: base, closedAt: base + i * 60000, bids: [{ userId: 'U_B1', jp: 100 + i, at: base }], dms: {}, counters: {},
    };
  }
  data.trades.FX = { ...data.trades.F0, id: 'FX', status: 'expired', reason: 'no_bid', bids: [], closedAt: NOW };
  data.trades.FD = { ...data.trades.F0, id: 'FD', kind: 'direct', closedAt: NOW, reason: 'accepted' };
  trades._save(data);
  const s10 = await state('U_B2');
  const at = s10.recent.map((r) => r.at);
  check('recent : 10 ventes au plus', s10.recent.length === 10);
  check('recent : la plus récente en premier', at.every((v, i) => i === 0 || at[i - 1] >= v) && at[0] === settled.trade.closedAt && s10.recent[1].jp === 111);
  check('recent : ni enchère sans enchérisseur ni demande', !s10.recent.some((r) => r.at === NOW && r.jp !== 20));

  server.close();
  try { req('game/matches.js').stop(); } catch { /* pas de boucle */ }
  try { req('db.js').close(); } catch { /* base jamais ouverte */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows */ }
  console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
