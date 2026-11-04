#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test v3.9 « Échanges » côté Slack (src/tradesSlack.js + src/app.js)
//
//  Dans une COPIE temporaire du projet (aucune donnée réelle touchée),
//  avec un faux Slack et une horloge simulée (mardi 3/11 à 10h, Paris) :
//    • Accueil : non inscrit = invitation /jeanpip seulement ; inscrit = 3 boutons
//    • modale de demande : codes disponibles en gras, indisponibles barrés
//    • soumission : erreur de plancher sur le champ, demande valide = DM au vendeur
//    • Accepter / Refuser : DM de résultat à l'acheteur, DM du vendeur mis à jour,
//      Accueils rafraîchis
//    • samedi : aucun DM, les boutons répondent par le texte de pause
//
//  Usage : npx -y -p node@20 node scripts/test-trades-slack.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-trades-slack-'));
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
process.env.WEB_PORT = '3195';
process.env.TARGET_EMOJI = 'jeanpip';
process.env.SLACK_BOT_TOKEN = 'xoxb-fake';
process.env.SLACK_SIGNING_SECRET = 'fake';
process.env.SLACK_APP_TOKEN = 'xapp-fake';

const posted = [];
const updated = [];
const opened = [];
const viewUpdates = [];
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
    update: async (v) => { viewUpdates.push(v); return { ok: true }; },
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
const actionIds = (x) => (flat(x).match(/"action_id":"trade_[a-z_]+"/g) || []);

(async () => {
  require(path.join(TMP, 'src', 'app.js'));
  await wait(300);
  const req = (m) => require(path.join(TMP, 'src', m));
  const trades = req('trades.js');
  const tradesSlack = req('tradesSlack.js');
  const credits = req('credits.js');
  const broadcast = req('broadcast.js');
  const collections = req('collections.js');
  const cardIndex = req('cardIndex.js');
  const home = req('home.js');
  const find = (list, name) => list.find((a) => (a.id instanceof RegExp ? a.id.test(name) : a.id === name)).fn;
  const ack = async () => {};
  const homeOf = (u) => home.buildHomeView(u, { isAdmin: false, creditsPerJeanpipLabel: '0,5', targetEmoji: 'jeanpip', farmRemainingMs: 0, farmQuota: { used: 0, max: 10, nextFreeMs: 0 }, formatRemaining: String });

  const HW1 = cardIndex.byCode('HW1');
  const HW2 = cardIndex.byCode('HW2');
  const C1 = cardIndex.listCards().find((c) => c.rarity === 'common');

  for (const u of ['UA', 'UB']) broadcast.subscribe(u);
  credits.addCredit('UA', 100, { source: 'test' });
  collections.addCards('UB', [{ ...HW1 }]);
  collections.addCards('UA', [{ ...C1 }]);
  // Accueils « déjà ouverts » : refreshHome ne republie que ceux-là
  for (const u of ['UA', 'UB']) await find(events, 'app_home_opened')({ event: { tab: 'home', user: u }, client: fakeClient, logger });

  const directOpen = (user) => find(actions, 'trade_direct_open')({ ack, body: { user: { id: user }, trigger_id: 'T1' }, action: { action_id: 'trade_direct_open' }, client: fakeClient, logger });
  const pickSeller = (user, seller) => find(actions, 'trade_direct_seller')({
    ack,
    body: { user: { id: user }, view: { id: 'V1', hash: 'h1', private_metadata: '' } },
    action: { action_id: 'trade_direct_seller', selected_user: seller },
    client: fakeClient, logger,
  });
  const submit = async (user, { seller, code, jp, cards = [] }) => {
    let response = null;
    await find(views, 'trade_direct_submit')({
      ack: async (r) => { response = r || null; },
      body: { user: { id: user } },
      view: {
        private_metadata: '',
        state: {
          values: {
            seller: { trade_direct_seller: { selected_user: seller } },
            card: { value: { selected_option: code ? { value: code } : null } },
            jp: { value: { value: jp == null ? null : String(jp) } },
            cards: { value: { selected_options: cards.map((c) => ({ value: c })) } },
          },
        },
      },
      client: fakeClient, logger,
    });
    return response;
  };
  const click = (actionId, user, value) => find(actions, actionId)({
    ack,
    body: { user: { id: user }, channel: { id: `D_${user}` }, message: { ts: 'dm-ts' } },
    action: { action_id: actionId, value },
    client: fakeClient, logger,
  });

  origLog('\n🧪 v3.9 — Échanges côté Slack (demande à une personne)');

  // ── Accueil ──
  const homeZ = homeOf('UZ');
  check(actionIds(homeZ).length === 0 && flat(homeZ).includes('/jeanpip'), 'Accueil d\'un non-inscrit : aucun bouton trade_*, invitation à taper /jeanpip');
  const homeA = homeOf('UA');
  const ids = actionIds(homeA);
  check(ids.length === 3 && ['trade_direct_open', 'trade_general_open', 'trade_auction_open'].every((id) => ids.includes(`"action_id":"${id}"`)), 'Accueil d\'un inscrit : les 3 boutons Demander / Demande générale / Enchères');

  // ── Modale de demande ──
  await directOpen('UA');
  const v0 = opened.at(-1).view;
  check(v0.callback_id === 'trade_direct_submit' && flat(v0).includes('users_select') && flat(v0).includes('trade_direct_seller'), 'bouton « Demander une carte » : modale avec le choix du joueur');
  await pickSeller('UA', 'UB');
  const v1 = viewUpdates.at(-1);
  check(v1 && v1.view_id === 'V1' && v1.view.callback_id === 'trade_direct_submit', 'choix de B : la modale est mise à jour (views.update)');
  const text1 = flat(v1.view);
  check(text1.includes('*HW1*') && text1.includes('~HW2~') && !text1.includes('*HW2*'), 'liste des numéros : HW1 disponible (gras), HW2 barré');
  check(text1.includes('static_select') && text1.includes('option_groups') && text1.includes('"value":"HW1"') && !text1.includes('"value":"HW2"'), 'menu : seulement les codes disponibles, groupés par rareté');
  check(text1.includes('number_input') && text1.includes('multi_static_select') && text1.includes(`"value":"${C1.code}"`), 'offre : JP$ (number_input) + mes cartes cessibles (multi_static_select)');

  // ── Soumission ──
  const low = await submit('UA', { seller: 'UB', code: 'HW1', jp: 5 });
  check(low && low.response_action === 'errors' && /10 JP\$/.test(low.errors.jp || ''), 'offre sous le plancher (5 < 10 JP$) : erreur sur le champ JP$');
  check(credits.getBalance('UA') === 100, 'rien débité');
  const self = await submit('UA', { seller: 'UA', code: 'HW1', jp: 12 });
  check(self && self.errors.seller, 'demande à soi-même : erreur sur le choix du joueur');
  const before = posted.length;
  check(await submit('UA', { seller: 'UB', code: 'HW1', jp: 12 }) === null, 'offre valide de 12 JP$ : modale fermée');
  const trade = trades.openTradesOf('UA')[0];
  check(trade && trade.card.code === 'HW1' && credits.getBalance('UA') === 88, 'échange ouvert, 12 JP$ mis en réserve (100 → 88)');
  const dmB = posted.slice(before).find((m) => m.channel === 'D_UB');
  check(dmB && ['trade_accept', 'trade_refuse', 'trade_counter_open'].every((id) => flat(dmB).includes(`"action_id":"${id}"`)), 'DM à B avec 3 boutons : Accepter, Refuser, Contre-offre');
  check(trades.getTrade(trade.id).dms.UB && trades.getTrade(trade.id).dms.UB.channel === 'D_UB', 'référence du DM de B gardée (setDm)');
  check(flat(homeOf('UA')).includes('HW1') && flat(homeOf('UB')).includes('HW1'), 'Accueils : l\'échange apparaît dans « mes échanges en cours »');

  // ── Accepter ──
  const pubBefore = published.length;
  const updBefore = updated.length;
  await click('trade_accept', 'UB', trade.id);
  check(trades.getTrade(trade.id).status === 'done' && collections.getCount('UA', HW1.url) === 1 && credits.getBalance('UB') === 12, 'B accepte : HW1 chez A, 12 JP$ chez B');
  const resultA = dmsTo('UA').at(-1);
  check(resultA && /accept/i.test(flat(resultA)) && flat(resultA).includes('HW1'), 'DM de résultat à A (acceptée)');
  const upd = updated.slice(updBefore).find((m) => m.channel === 'D_UB');
  check(upd && !actionIds(upd).length, 'le DM de B est mis à jour (chat.update), sans boutons');
  const pubs = published.slice(pubBefore).map((p) => p.user_id);
  check(pubs.includes('UA') && pubs.includes('UB'), 'Accueils de A et B rafraîchis');
  await click('trade_accept', 'UB', trade.id);
  check(/déjà/i.test(ephemerals.at(-1).text), '2e clic sur Accepter : « déjà » conclue, rien ne bouge');

  // ── Refuser ──
  collections.addCards('UB', [{ ...HW1 }]);
  check(await submit('UA', { seller: 'UB', code: 'HW1', jp: 15 }) === null, 'nouvelle demande de 15 JP$');
  const t2 = trades.openTradesOf('UA')[0];
  await click('trade_refuse', 'UB', t2.id);
  check(trades.getTrade(t2.id).status === 'refused' && credits.getBalance('UA') === 88, 'B refuse : A est remboursé (88 JP$)');
  check(/refus/i.test(flat(dmsTo('UA').at(-1))), 'DM de résultat à A (refusée)');

  // ── Samedi : pause ──
  at('2026-11-06T22:30:00Z');   // vendredi 23h30
  check(await submit('UA', { seller: 'UB', code: 'HW1', jp: 20 }) === null, 'vendredi 23h30 : demande envoyée');
  const t3 = trades.openTradesOf('UA')[0];
  at('2026-11-06T23:10:00Z');   // samedi 0h10
  const satPosted = posted.length;
  await click('trade_accept', 'UB', t3.id);
  check(posted.length === satPosted, 'samedi : Accepter n\'envoie aucun DM');
  check(/week-end/.test(ephemerals.at(-1).text), 'samedi : le bouton répond par le texte de pause');
  check(trades.getTrade(t3.id).status === 'open', 'samedi : rien n\'est conclu');
  await click('trade_refuse', 'UB', t3.id);
  check(posted.length === satPosted && /week-end/.test(ephemerals.at(-1).text), 'samedi : Refuser répond aussi par le texte de pause');
  await directOpen('UA');
  check(/week-end/.test(flat(opened.at(-1).view)) && !opened.at(-1).view.submit, 'samedi : « Demander une carte » ouvre seulement le texte de pause');
  const sat = await submit('UA', { seller: 'UB', code: 'HW1', jp: 20 });
  check(sat && sat.response_action === 'errors' && posted.length === satPosted, 'samedi : une modale restée ouverte est refusée, aucun DM');
  check(actionIds(homeOf('UA')).length === 0, 'samedi : pas de bouton d\'échange dans l\'Accueil');

  // ── Désinscription ──
  at('2026-11-10T09:00:00Z');   // mardi suivant
  await find(actions, 'broadcast_leave')({ ack, body: { user: { id: 'UB' } }, action: { action_id: 'broadcast_leave' }, client: fakeClient, logger });
  check(!broadcast.isSubscribed('UB'), 'B se désinscrit sans erreur (hook onUnsubscribe)');

  // ── Table des erreurs ──
  const codes = ['self', 'blocked_buyer', 'blocked_seller', 'unavailable', 'cards_unavailable', 'floor', 'empty', 'balance', 'bad_amount', 'expired', 'closed', 'not_seller', 'not_subscribed', 'pause', 'raid', 'farm'];
  check(codes.every((c) => typeof tradesSlack.ERROR_TEXT[c] === 'string' && tradesSlack.ERROR_TEXT[c].length > 5), 'ERROR_TEXT : un texte pour chaque code d\'erreur');

  origLog(process.exitCode ? '\n❌ ÉCHECS ci-dessus\n' : '\n🎉 Échanges Slack OK\n');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* base SQLite encore ouverte (Windows) */ }
  process.exit(process.exitCode || 0);
})();
