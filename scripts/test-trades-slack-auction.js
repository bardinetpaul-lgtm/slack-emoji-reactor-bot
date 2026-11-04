#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test v3.9 « Enchères » côté Slack (src/tradesSlack.js + src/app.js)
//
//  Dans une COPIE temporaire du projet (aucune donnée réelle touchée),
//  avec un faux Slack et une horloge simulée (mardi 3/11 à 10h, Paris) :
//    • lancer une enchère : DM avec image à chaque inscrit sauf le vendeur,
//      aucun DM à un non-inscrit ;
//    • enchérir : plancher, « déjà le meilleur », DM au précédent meilleur
//      enchérisseur quand il est dépassé, DM d'annonce mis à jour ;
//    • runTick après la fin : DM au vendeur et au gagnant, la carte change
//      de main, événement trade_done ; relancé, il ne fait rien ;
//    • carte disparue : enchère annulée, enchérisseur remboursé et prévenu ;
//    • enchère qui finirait pendant le week-end : refusée dès la modale.
//
//  Usage : npx -y -p node@20 node scripts/test-trades-slack-auction.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-trades-auction-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

// ⏰ Horloge simulée : mardi 3/11 à 10h (Paris, UTC+1)
const RealDate = Date;
let NOW = RealDate.parse('2026-11-03T09:00:00Z');
global.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(NOW); }
  static now() { return NOW; }
};
const at = (iso) => { NOW = RealDate.parse(iso); };

process.env.WEB_PUBLIC_URL = '';
process.env.WEB_PORT = '3196';
process.env.TARGET_EMOJI = 'jeanpip';
process.env.SLACK_BOT_TOKEN = 'xoxb-fake';
process.env.SLACK_SIGNING_SECRET = 'fake';
process.env.SLACK_APP_TOKEN = 'xapp-fake';

const posted = [];
const updated = [];
const opened = [];
const published = [];
const ephemerals = [];
const fakeClient = {
  conversations: { open: async ({ users }) => ({ channel: { id: `D_${users}` } }) },
  chat: {
    postMessage: async (m) => { posted.push(m); return { ok: true, channel: m.channel, ts: String(1000 + posted.length) }; },
    postEphemeral: async (m) => { ephemerals.push(m); return { ok: true }; },
    update: async (m) => { updated.push(m); return { ok: true }; },
  },
  users: { info: async ({ user }) => ({ user: { id: user, is_bot: false, real_name: `Nom ${user}`, name: user } }) },
  auth: { test: async () => ({ user_id: 'B_BOT', user: 'jeanpip' }) },
  views: {
    publish: async (v) => { published.push(v); return { ok: true }; },
    open: async (v) => { opened.push(v); return { ok: true }; },
    update: async () => ({ ok: true }),
  },
  files: { info: async () => { throw new Error('fake'); } },
};
const actions = [];
const views = [];
const events = [];
class FakeApp {
  constructor() { this.client = fakeClient; }
  message() {} error() {} command() {}
  event(id, fn) { events.push({ id, fn }); }
  view(id, fn) { views.push({ id, fn }); }
  action(id, fn) { actions.push({ id, fn }); }
  async start() {}
}
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@slack/bolt') return { App: FakeApp, LogLevel: { INFO: 'info', DEBUG: 'debug' } };
  if (req === 'dotenv') return { config() {} };
  return origLoad.call(this, req, ...rest);
};

const origLog = console.log;
console.log = () => {};
console.info = () => {};
console.warn = () => {};
const logger = { info() {}, warn() {}, error: (...a) => origLog('ERR', ...a) };
process.on('unhandledRejection', (e) => { origLog('❌ unhandledRejection', e); process.exit(1); });

const check = (ok, msg) => { origLog(`  ${ok ? '✅' : '❌'} ${msg}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dmsTo = (u) => posted.filter((m) => m.channel === `D_${u}`);
const flat = (x) => JSON.stringify(x);
const hasImage = (m) => (m.blocks || []).some((b) => b.type === 'image' && /^https?:\/\//.test(b.image_url));

(async () => {
  require(path.join(TMP, 'src', 'app.js'));
  await wait(300);
  // Après le démarrage (le serveur web reste éteint) : adresse publique des images
  process.env.WEB_PUBLIC_URL = 'https://jeanpip.test';
  const req = (m) => require(path.join(TMP, 'src', m));
  const trades = req('trades.js');
  const tradesSlack = req('tradesSlack.js');
  const credits = req('credits.js');
  const broadcast = req('broadcast.js');
  const collections = req('collections.js');
  const cardIndex = req('cardIndex.js');
  const home = req('home.js');
  const db = req('db.js');
  const find = (list, name) => list.find((a) => (a.id instanceof RegExp ? a.id.test(name) : a.id === name)).fn;
  const ack = async () => {};
  const homeOf = (u) => home.buildHomeView(u, { isAdmin: false, creditsPerJeanpipLabel: '0,5', targetEmoji: 'jeanpip', farmRemainingMs: 0, farmQuota: { used: 0, max: 10, nextFreeMs: 0 }, formatRemaining: String });
  const tradeEvents = () => db.getDb().prepare("SELECT * FROM events WHERE type = 'trade_done' ORDER BY id").all();

  const HW1 = cardIndex.byCode('HW1');
  const C1 = cardIndex.listCards().find((c) => c.rarity === 'common');

  for (const u of ['UA', 'UB', 'UC']) broadcast.subscribe(u);
  credits.addCredit('UB', 100, { source: 'test' });
  credits.addCredit('UC', 100, { source: 'test' });
  collections.addCards('UA', [{ ...HW1 }, { ...C1 }]);
  for (const u of ['UA', 'UB', 'UC']) await find(events, 'app_home_opened')({ event: { tab: 'home', user: u }, client: fakeClient, logger });

  const auctionOpen = (user) => find(actions, 'trade_auction_open')({ ack, body: { user: { id: user }, trigger_id: 'T1' }, action: { action_id: 'trade_auction_open' }, client: fakeClient, logger });
  const submitAuction = async (user, code, price) => {
    let response = null;
    await find(views, 'trade_auction_submit')({
      ack: async (r) => { response = r || null; },
      body: { user: { id: user } },
      view: { private_metadata: '', state: { values: { card: { value: { selected_option: code ? { value: code } : null } }, price: { value: { value: price == null ? null : String(price) } } } } },
      client: fakeClient, logger,
    });
    return response;
  };
  const bidOpen = (user, tradeId) => find(actions, 'trade_bid_open')({
    ack, body: { user: { id: user }, trigger_id: 'T2', channel: { id: `D_${user}` }, message: { ts: 'dm' } }, action: { action_id: 'trade_bid_open', value: tradeId }, client: fakeClient, logger,
  });
  const submitBid = async (user, tradeId, jp) => {
    let response = null;
    await find(views, 'trade_bid_submit')({
      ack: async (r) => { response = r || null; },
      body: { user: { id: user } },
      view: { private_metadata: tradeId, state: { values: { jp: { value: { value: jp == null ? null : String(jp) } } } } },
      client: fakeClient, logger,
    });
    return response;
  };

  origLog('\n🧪 v3.9 — Enchères côté Slack');

  // ── Modale ──
  await auctionOpen('UA');
  const mv = opened.at(-1).view;
  check(mv.callback_id === 'trade_auction_submit' && flat(mv).includes('"value":"HW1"') && flat(mv).includes('number_input'), 'bouton « Mettre aux enchères » : modale avec mes cartes cessibles et le prix de départ');
  check(/mercredi/.test(flat(mv)) && /10h00/.test(flat(mv)), 'modale : fin calculée affichée (lancée mardi 10h → mercredi 10h00, la nuit est sautée)');
  await auctionOpen('UZ');
  check(!opened.at(-1).view.submit && flat(opened.at(-1).view).includes('/jeanpip'), 'non-inscrit : modale d\'information seulement (inscris-toi à /jeanpip)');

  // ── Lancement ──
  const low = await submitAuction('UA', 'HW1', 5);
  check(low && low.response_action === 'errors' && /10 JP\$/.test(low.errors.price || ''), 'prix de départ sous le plancher (5 < 10) : erreur sur le champ prix');
  const before = posted.length;
  check(await submitAuction('UA', 'HW1', 12) === null, 'prix de départ 12 JP$ : modale fermée');
  const auction = trades.openTradesOf('UA').find((t) => t.kind === 'auction');
  check(auction && auction.startPrice === 12, 'enchère ouverte à 12 JP$');
  const news = posted.slice(before);
  const annB = news.find((m) => m.channel === 'D_UB');
  const annC = news.find((m) => m.channel === 'D_UC');
  check(annB && annC && hasImage(annB) && hasImage(annC), 'DM d\'annonce avec image à B et C (inscrits)');
  check(flat(annB).includes('"action_id":"trade_bid_open"') && /12 JP\$/.test(flat(annB)), 'annonce : bouton Enchérir et prix actuel (12 JP$)');
  check(!news.some((m) => m.channel === 'D_UZ'), 'aucun DM au non-inscrit');
  check(!news.some((m) => m.channel === 'D_UA' && flat(m).includes('trade_bid_open')), 'le vendeur ne reçoit pas de bouton Enchérir');
  const stored = trades.getTrade(auction.id).dms;
  check(stored.UB && stored.UC && stored.UB.channel === 'D_UB', 'références des DM d\'annonce gardées (setDm)');
  check(/enchère/i.test(flat(homeOf('UA'))) && !/01h00/.test(flat(homeOf('UA'))), 'Accueil du vendeur : l\'enchère en cours, avec sa fin');

  // ── Enchères ──
  await bidOpen('UB', auction.id);
  const bv = opened.at(-1).view;
  check(bv.callback_id === 'trade_bid_submit' && bv.private_metadata === auction.id && flat(bv).includes('"min_value":"12"'), 'bouton Enchérir : modale avec un minimum de 12 JP$');
  const tooLow = await submitBid('UB', auction.id, 11);
  check(tooLow && tooLow.response_action === 'errors' && /12 JP\$/.test(tooLow.errors.jp || ''), 'enchère de 11 < 12 : refusée sur le champ');
  check(await submitBid('UB', auction.id, 12) === null && credits.getBalance('UB') === 88, 'B enchérit 12 JP$ : mis de côté (100 → 88)');
  const again = await submitBid('UB', auction.id, 15);
  check(again && again.response_action === 'errors' && /déjà/i.test(again.errors.jp || ''), 'B surenchérit sur lui-même : « déjà le meilleur »');
  const selfBid = await submitBid('UA', auction.id, 30);
  check(selfBid && selfBid.response_action === 'errors', 'le vendeur ne peut pas enchérir sur sa propre enchère');
  const updBefore = updated.length;
  const postBefore = posted.length;
  check(await submitBid('UC', auction.id, 20) === null && credits.getBalance('UC') === 80, 'C enchérit 20 JP$ (100 → 80)');
  const outbid = posted.slice(postBefore).find((m) => m.channel === 'D_UB');
  check(outbid && /dépass/i.test(flat(outbid)) && /20 JP\$/.test(flat(outbid)) && credits.getBalance('UB') === 100, 'B dépassé : DM « dépassé » et ses 12 JP$ rendus');
  const upd = updated.slice(updBefore);
  check(upd.some((m) => m.channel === 'D_UB') && upd.some((m) => m.channel === 'D_UC') && upd.every((m) => /20 JP\$/.test(flat(m))), 'DM d\'annonce mis à jour avec le prix actuel (20 JP$)');

  // ── Minuterie ──
  let p = posted.length;
  await tradesSlack.runTick(fakeClient, logger);
  check(posted.length === p && trades.getTrade(auction.id).status === 'open', 'runTick avant la fin : rien ne bouge');
  at('2026-11-04T09:01:00Z');   // mercredi 10h01
  p = posted.length;
  const u0 = updated.length;
  await tradesSlack.runTick(fakeClient, logger);
  const done = trades.getTrade(auction.id);
  check(done.status === 'done' && collections.getCount('UC', HW1.url) === 1 && collections.getCount('UA', HW1.url) === 0, 'runTick après la fin : HW1 passe de A à C');
  check(credits.getBalance('UA') === 20 && credits.getBalance('UC') === 80, 'A reçoit les 20 JP$ du gagnant');
  const endDMs = posted.slice(p);
  check(endDMs.some((m) => m.channel === 'D_UA' && /vendu/i.test(flat(m))) && endDMs.some((m) => m.channel === 'D_UC' && /remport/i.test(flat(m))), 'DM au vendeur (vendue) et au gagnant (remportée)');
  check(updated.slice(u0).some((m) => m.channel === 'D_UB') && !updated.slice(u0).some((m) => flat(m).includes('trade_bid_open')), 'DM d\'annonce mis à jour sans bouton Enchérir');
  const ev = tradeEvents().at(-1);
  const evData = ev && JSON.parse(ev.data);
  check(ev && ev.user_id === 'UC' && evData.tradeId === auction.id && evData.kind === 'auction' && evData.jp === 20 && evData.seller === 'UA', 'événement trade_done (acheteur C, 20 JP$, vendeur A)');
  p = posted.length;
  const nEv = tradeEvents().length;
  await tradesSlack.runTick(fakeClient, logger);
  check(posted.length === p && tradeEvents().length === nEv && credits.getBalance('UA') === 20, 'runTick relancé : ne fait rien');

  // ── Carte disparue pendant l'enchère ──
  check(await submitAuction('UA', C1.code, 1) === null, 'nouvelle enchère sur une commune (1 JP$)');
  const a2 = trades.openTradesOf('UA').find((t) => t.kind === 'auction');
  check(await submitBid('UB', a2.id, 3) === null && credits.getBalance('UB') === 97, 'B enchérit 3 JP$');
  collections.removeCards('UA', [C1.url]);
  p = posted.length;
  await tradesSlack.runTick(fakeClient, logger);
  check(trades.getTrade(a2.id).status === 'cancelled' && credits.getBalance('UB') === 100, 'carte partie : enchère annulée, B remboursé');
  const cancelDMs = posted.slice(p);
  check(cancelDMs.some((m) => m.channel === 'D_UA' && /annul/i.test(flat(m))) && cancelDMs.some((m) => m.channel === 'D_UB' && /annul/i.test(flat(m)) && /rendu/i.test(flat(m))), 'DM « annulée » au vendeur et à l\'enchérisseur (JP$ rendus)');

  // ── Demande à une personne acceptée : trade_done aussi ──
  collections.addCards('UA', [{ ...C1 }]);
  const direct = trades.createDirect({ buyer: 'UB', seller: 'UA', code: C1.code, jp: 4, now: Date.now() });
  await find(actions, 'trade_accept')({ ack, body: { user: { id: 'UA' }, channel: { id: 'D_UA' }, message: { ts: 'x' } }, action: { action_id: 'trade_accept', value: direct.trade.id }, client: fakeClient, logger });
  const ev2 = tradeEvents().at(-1);
  check(ev2 && ev2.user_id === 'UB' && JSON.parse(ev2.data).kind === 'direct' && JSON.parse(ev2.data).jp === 4, 'demande acceptée : événement trade_done (direct, 4 JP$)');

  // ── Intégration avec la demande générale et les contre-offres ──
  const clickDM = (actionId, user, value) => find(actions, actionId)({
    ack, body: { user: { id: user }, trigger_id: 'T3', channel: { id: `D_${user}` }, message: { ts: 'dm' } }, action: { action_id: actionId, value }, client: fakeClient, logger,
  });
  const submitOffer = async (callbackId, user, { code, jp, meta = '' }) => {
    let response = null;
    const values = { jp: { value: { value: jp == null ? null : String(jp) } }, cards: { value: { selected_options: [] } } };
    if (code) values.card = { value: { selected_option: { value: code } } };
    await find(views, callbackId)({ ack: async (r) => { response = r || null; }, body: { user: { id: user } }, view: { private_metadata: meta, state: { values } }, client: fakeClient, logger });
    return response;
  };
  const noButton = (m, id) => m && !flat(m).includes(`"action_id":"${id}"`);
  // HW1 est chez C (enchère gagnée) ; B a 96 JP$, C 80 JP$
  check(await submitOffer('trade_general_submit', 'UB', { code: 'HW1', jp: 12 }) === null, 'B lance une demande générale pour HW1 (12 JP$)');
  const g1 = trades.openTradesOf('UB').find((t) => t.kind === 'general');
  await clickDM('trade_accept', 'UC', g1.id);
  const evG = tradeEvents().at(-1);
  const dG = evG && JSON.parse(evG.data);
  check(trades.getTrade(g1.id).status === 'done' && evG.user_id === 'UB' && dG.kind === 'general' && dG.jp === 12 && dG.seller === 'UC', 'demande générale acceptée : événement trade_done (général, 12 JP$, vendeur C)');

  // HW1 est chez B : C demande à tous, B fait une contre-offre à 15, C l'accepte
  check(await submitOffer('trade_general_submit', 'UC', { code: 'HW1', jp: 12 }) === null, 'C lance une demande générale pour HW1 (12 JP$)');
  const g2 = trades.openTradesOf('UC').find((t) => t.kind === 'general');
  check(await submitOffer('trade_counter_submit', 'UB', { jp: 15, meta: `${g2.id}|UB` }) === null, 'B fait une contre-offre à 15 JP$');
  await clickDM('trade_counter_accept', 'UC', `${g2.id}|UB`);
  const evC = tradeEvents().at(-1);
  const dC = evC && JSON.parse(evC.data);
  check(trades.getTrade(g2.id).status === 'done' && evC.user_id === 'UC' && dC.jp === 15 && dC.seller === 'UB' && dC.tradeId === g2.id, 'contre-offre acceptée : trade_done avec les 15 JP$ de la contre-offre');

  // HW1 est chez C : B demande à tous, C contre-propose, tout expire → la minuterie ferme les DM
  check(await submitOffer('trade_general_submit', 'UB', { code: 'HW1', jp: 12 }) === null, 'B relance une demande générale pour HW1');
  const g3 = trades.openTradesOf('UB').find((t) => t.kind === 'general');
  at('2026-11-04T09:31:00Z');
  check(await submitOffer('trade_counter_submit', 'UC', { jp: 20, meta: `${g3.id}|UC` }) === null, 'C fait une contre-offre à 20 JP$');
  at('2026-11-04T10:35:00Z');   // contre-offre et demande dépassées
  const u1 = updated.length;
  await tradesSlack.runTick(fakeClient, logger);
  const st3 = trades.getTrade(g3.id);
  check(st3.status === 'expired' && st3.counters.UC.status === 'expired', 'runTick : contre-offre puis demande générale expirées');
  const updOwner = updated.slice(u1).filter((m) => m.channel === 'D_UC');
  const updBuyer = updated.slice(u1).filter((m) => m.channel === 'D_UB');
  check(updOwner.length && updOwner.every((m) => noButton(m, 'trade_accept')), 'DM de demande générale de C mis à jour, sans boutons (SELLER_DM_BUILDERS.general)');
  check(updBuyer.length && updBuyer.every((m) => noButton(m, 'trade_counter_accept')), 'DM de contre-offre reçu par B mis à jour, sans boutons');
  check(!updated.slice(u1).some((m) => /te demande ta carte/.test(flat(m)) && m.channel === 'D_UB'), 'le DM de contre-offre de B n\'est pas remplacé par un DM de vendeur');

  // Demande à une personne avec contre-offre, puis le vendeur accepte l'offre d'origine
  const d2 = trades.createDirect({ buyer: 'UB', seller: 'UC', code: 'HW1', jp: 12, now: Date.now() });
  check(d2.ok && await submitOffer('trade_counter_submit', 'UC', { jp: 25, meta: `${d2.trade.id}|UC` }) === null, 'B demande HW1 à C, C fait une contre-offre à 25 JP$');
  const u2 = updated.length;
  await clickDM('trade_accept', 'UC', d2.trade.id);
  const coUpd = updated.slice(u2).find((m) => m.channel === 'D_UB');
  check(trades.getTrade(d2.trade.id).status === 'done' && noButton(coUpd, 'trade_counter_accept') && /offre d'origine/.test(flat(coUpd)), 'C accepte l\'offre d\'origine : le DM de contre-offre de B perd ses boutons');

  // Désinscription d'un propriétaire : DM de demande générale fermé, contre-offre annulée
  collections.addCards('UA', [{ ...HW1 }]);
  check(await submitOffer('trade_general_submit', 'UC', { code: 'HW1', jp: 12 }) === null, 'C demande HW1 à tous (A et B l\'ont)');
  const g4 = trades.openTradesOf('UC').find((t) => t.kind === 'general');
  check(await submitOffer('trade_counter_submit', 'UB', { jp: 30, meta: `${g4.id}|UB` }) === null, 'B fait une contre-offre à 30 JP$');
  const u3 = updated.length;
  await find(actions, 'broadcast_leave')({ ack, body: { user: { id: 'UC' } }, action: { action_id: 'broadcast_leave' }, client: fakeClient, logger });
  const u3s = updated.slice(u3);
  check(trades.getTrade(g4.id).status === 'cancelled', 'C quitte /jeanpip : sa demande générale est annulée');
  check(u3s.some((m) => m.channel === 'D_UA') && u3s.filter((m) => m.channel === 'D_UA' || m.channel === 'D_UB').every((m) => noButton(m, 'trade_accept')), 'DM de demande générale de A et B fermés (SELLER_DM_BUILDERS.general)');
  check(u3s.some((m) => m.channel === 'D_UC') && u3s.filter((m) => m.channel === 'D_UC').every((m) => noButton(m, 'trade_counter_accept') && /te fait une contre-offre/.test(flat(m))), 'DM de contre-offre reçu par C fermé, sans boutons (toujours un DM de contre-offre)');
  broadcast.subscribe('UC');

  // ── Fin pendant le week-end ──
  at('2026-11-06T14:00:00Z');   // vendredi 15h → fin samedi
  await auctionOpen('UA');
  check(!opened.at(-1).view.submit && /week-end|pause/i.test(flat(opened.at(-1).view)), 'vendredi 15h : enchère refusée (elle finirait pendant le week-end)');

  // ── Textes d'erreur ──
  const codes = ['ends_in_pause', 'too_low', 'already_best', 'ended', 'blocked', 'card_lost'];
  check(codes.every((c) => typeof tradesSlack.ERROR_TEXT[c] === 'string'), 'ERROR_TEXT : textes des enchères');

  origLog(process.exitCode ? '\n❌ ÉCHECS ci-dessus\n' : '\n🎉 Enchères Slack OK\n');
  try { db.getDb().close(); fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows */ }
  process.exit(process.exitCode || 0);
})();
