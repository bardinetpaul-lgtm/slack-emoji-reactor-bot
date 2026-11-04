#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test v3.9 « Échanges » côté Slack : demande générale et contre-offres
//  (src/tradesSlack.js, section « Demande générale et contre-offres »)
//
//  Dans une COPIE temporaire du projet (aucune donnée réelle touchée),
//  avec un faux Slack et une horloge simulée (mardi 3/11 à 10h, Paris) :
//    • demande générale : modale (tous les numéros), erreurs sur les champs,
//      DM seulement aux propriétaires inscrits ; B accepte → le DM de C
//      passe à « déjà conclue » ; Refuser = décliner pour soi seul
//    • contre-offre : modale du vendeur (numéros seulement), DM à l'acheteur
//      avec trade_counter_accept ; accepter (complément prélevé), refuser
//      (générale : la demande continue ; à une personne : close et remboursée),
//      solde insuffisant (rien ne bouge)
//    • samedi : les boutons répondent par le texte de pause
//
//  Usage : npx -y -p node@20 node scripts/test-trades-slack-general.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-trades-slack-general-'));
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
const actionIds = (x) => (flat(x).match(/"action_id":"trade_[a-z_]+"/g) || []);
const has = (x, id) => flat(x).includes(`"action_id":"${id}"`);

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
  const find = (list, name) => list.find((a) => (a.id instanceof RegExp ? a.id.test(name) : a.id === name)).fn;
  const ack = async () => {};

  const HW1 = cardIndex.byCode('HW1');
  const C1 = cardIndex.listCards().find((c) => c.rarity === 'common');

  for (const u of ['UA', 'UB', 'UC', 'UE', 'UF', 'UG']) broadcast.subscribe(u);   // UD : pas inscrit ; UE : inscrit sans HW1
  credits.addCredit('UA', 100, { source: 'test' });
  for (const u of ['UB', 'UC', 'UD', 'UF', 'UG']) collections.addCards(u, [{ ...HW1 }]);
  collections.addCards('UA', [{ ...C1 }]);
  for (const u of ['UA', 'UB', 'UC']) await find(events, 'app_home_opened')({ event: { tab: 'home', user: u }, client: fakeClient, logger });

  const click = (actionId, user, value) => find(actions, actionId)({
    ack,
    body: { user: { id: user }, trigger_id: 'T1', channel: { id: `D_${user}` }, message: { ts: 'dm-ts' } },
    action: { action_id: actionId, value },
    client: fakeClient, logger,
  });
  const submitView = async (callbackId, user, { code, jp, cards = [], meta = '' }) => {
    let response = null;
    const values = {
      jp: { value: { value: jp == null ? null : String(jp) } },
      cards: { value: { selected_options: cards.map((c) => ({ value: c })) } },
    };
    if (callbackId === 'trade_general_submit') values.card = { value: { selected_option: code ? { value: code } : null } };
    await find(views, callbackId)({
      ack: async (r) => { response = r || null; },
      body: { user: { id: user } },
      view: { private_metadata: meta, state: { values } },
      client: fakeClient, logger,
    });
    return response;
  };

  origLog('\n🧪 v3.9 — Échanges côté Slack (demande générale et contre-offres)');

  // ── Modale de demande générale ──
  await click('trade_general_open', 'UA');
  const gv = opened.at(-1).view;
  check(gv.callback_id === 'trade_general_submit', 'bouton « Demande générale » : vraie modale (plus de « bientôt »)');
  check(flat(gv).includes('option_groups') && flat(gv).includes('"value":"HW1"') && flat(gv).includes('"value":"HW2"'), 'modale : tous les numéros, groupés par rareté');
  check(flat(gv).includes('number_input') && flat(gv).includes('multi_static_select') && flat(gv).includes(`"value":"${C1.code}"`), 'modale : offre en JP$ + mes cartes cessibles');

  // ── Soumission ──
  const low = await submitView('trade_general_submit', 'UA', { code: 'HW1', jp: 5 });
  check(low && low.response_action === 'errors' && /10 JP\$/.test(low.errors.jp || ''), 'offre sous le plancher : erreur sur le champ JP$');
  const bad = await submitView('trade_general_submit', 'UA', { code: 'HW1', jp: 'abc' });
  check(bad && /nombre entier/.test(bad.errors.jp || ''), 'montant « abc » : Number() → erreur bad_amount sur le champ JP$');
  const none = await submitView('trade_general_submit', 'UA', { code: 'HW2', jp: 20 });
  check(none && /Personne/.test(none.errors.card || ''), 'carte que personne ne peut céder : erreur no_owner sur le choix de la carte');
  check(credits.getBalance('UA') === 100, 'rien débité');

  const before = posted.length;
  check(await submitView('trade_general_submit', 'UA', { code: 'HW1', jp: 12 }) === null, 'demande générale valide (12 JP$) : modale fermée');
  const g = trades.openTradesOf('UA')[0];
  check(g && g.kind === 'general' && credits.getBalance('UA') === 88, 'demande générale ouverte, 12 JP$ mis en réserve');
  const sent = posted.slice(before);
  const dmB = sent.find((m) => m.channel === 'D_UB');
  const dmC = sent.find((m) => m.channel === 'D_UC');
  check(dmB && dmC && ['trade_accept', 'trade_refuse', 'trade_counter_open'].every((id) => has(dmB, id) && has(dmC, id)), 'DM à B et C (propriétaires inscrits) avec Accepter / Refuser / Contre-offre');
  check(!sent.some((m) => m.channel === 'D_UD' || m.channel === 'D_UE'), 'aucun DM à D (pas inscrit) ni à E (n\'a pas la carte)');
  check(sent.some((m) => m.channel === 'D_UA' && /Demande générale envoyée/.test(flat(m))), 'DM de confirmation à A');
  const gDms = trades.getTrade(g.id).dms;
  check(gDms.UB && gDms.UC && gDms.UC.channel === 'D_UC', 'références des DM de B et C gardées (setDm)');

  // ── F décline AVANT toute contre-offre (et sa référence de DM a été perdue) ──
  const raw = trades._load();
  delete raw.trades[g.id].dms.UF;
  trades._save(raw);
  await click('trade_refuse', 'UF', g.id);
  const gF = trades.getTrade(g.id);
  check(gF.status === 'open' && gF.declined && gF.declined.UF, 'F décline : gardé dans trade.declined, la demande reste ouverte');
  check(gF.dms.UF && gF.dms.UF.channel === 'D_UF' && gF.dms.UF.ts === 'dm-ts', 'référence du DM cliqué enregistrée (trades.setDm)');
  const fDeclined = () => updated.filter((m) => m.channel === 'D_UF').at(-1);
  const fUpd0 = updated.filter((m) => m.channel === 'D_UF').length;
  check(/décliné/.test(flat(fDeclined())) && !actionIds(fDeclined()).length, 'DM de F : « décliné », sans boutons');

  // ── Contre-offre de C sur la demande générale ──
  await click('trade_counter_open', 'UC', `${g.id}|UC`);
  const cv = opened.at(-1).view;
  check(cv.callback_id === 'trade_counter_submit' && cv.private_metadata === `${g.id}|UC`, 'Contre-offre : modale du vendeur');
  check(flat(cv).includes('number_input') && flat(cv).includes('multi_static_select') && flat(cv).includes(`*${C1.code}*`) && flat(cv).includes('~HW2~'), 'modale : JP$ + cartes de l\'acheteur (disponibles en gras, autres barrées)');
  check(!flat(cv).includes(C1.url) && !flat(cv).includes('image_url'), 'le vendeur ne voit aucune image ni adresse de carte de l\'acheteur');
  const cBad = await submitView('trade_counter_submit', 'UC', { jp: 'x', meta: `${g.id}|UC` });
  check(cBad && /nombre entier/.test(cBad.errors.jp || ''), 'contre-offre « x » JP$ : erreur bad_amount');
  const updBefore = updated.length;
  check(await submitView('trade_counter_submit', 'UC', { jp: 15, meta: `${g.id}|UC` }) === null, 'contre-offre de C : 15 JP$');
  check(trades.getTrade(g.id).counters.UC.status === 'open', 'contre-offre enregistrée');
  const coDm = dmsTo('UA').at(-1);
  check(coDm && has(coDm, 'trade_counter_accept') && has(coDm, 'trade_counter_refuse') && flat(coDm).includes(`${g.id}|UC`), 'DM à A avec trade_counter_accept / trade_counter_refuse (valeur tradeId|vendeur)');
  check(trades.getTrade(g.id).dms.counter_UC, 'référence du DM de contre-offre gardée');
  const updC = updated.slice(updBefore).find((m) => m.channel === 'D_UC');
  check(updC && !has(updC, 'trade_counter_open') && has(updC, 'trade_accept'), 'DM de C mis à jour : plus de bouton Contre-offre');
  await click('trade_counter_open', 'UC', `${g.id}|UC`);
  check(/déjà fait une contre-offre/.test(flat(opened.at(-1).view)) && !opened.at(-1).view.submit, '2e contre-offre : refusée (une seule par personne)');

  // ── A refuse la contre-offre de C : la demande générale continue ──
  await click('trade_counter_refuse', 'UA', `${g.id}|UC`);
  check(trades.getTrade(g.id).status === 'open' && trades.getTrade(g.id).counters.UC.status === 'refused', 'A refuse la contre-offre : la demande générale reste ouverte');
  check(/refusé ta contre-offre/.test(flat(dmsTo('UC').at(-1))), 'C est prévenu du refus');
  check(credits.getBalance('UA') === 88, 'la réserve de A ne bouge pas');
  const fUpd1 = updated.filter((m) => m.channel === 'D_UF');
  check(fUpd1.length > fUpd0 && /décliné/.test(flat(fUpd1.at(-1))) && !actionIds(fUpd1.at(-1)).length, 'après le refus de la contre-offre, le DM de F est republié toujours sans boutons');

  // ── G contre-propose puis quitte /jeanpip : événement counter_cancelled → DM republiés ──
  check(await submitView('trade_counter_submit', 'UG', { jp: 20, meta: `${g.id}|UG` }) === null, 'contre-offre de G');
  const fUpd2 = updated.filter((m) => m.channel === 'D_UF').length;
  await find(actions, 'broadcast_leave')({ ack, body: { user: { id: 'UG' } }, action: { action_id: 'broadcast_leave' }, client: fakeClient, logger });
  check(trades.getTrade(g.id).counters.UG.status === 'cancelled' && trades.getTrade(g.id).status === 'open', 'G se désinscrit : sa contre-offre est annulée, la demande continue');
  const fUpd3 = updated.filter((m) => m.channel === 'D_UF');
  check(fUpd3.length > fUpd2 && /décliné/.test(flat(fUpd3.at(-1))) && !actionIds(fUpd3.at(-1)).length, 'après cet événement, le DM de F reste « décliné », sans boutons');
  await tradesSlack.runTick(fakeClient, logger);
  check(!/trade_accept/.test(flat(fDeclined())), 'après un passage de la minuterie : toujours aucun bouton pour F');

  // ── Refuser (décliner) une demande générale ──
  const updE = updated.length;
  await click('trade_refuse', 'UC', g.id);
  check(trades.getTrade(g.id).status === 'open', 'C refuse : la demande reste ouverte pour les autres');
  const declined = updated.slice(updE).find((m) => m.channel === 'D_UC');
  check(declined && /décliné/.test(flat(declined)) && !actionIds(declined).length, 'le DM de C passe à « décliné », sans boutons');

  // ── B accepte : C reçoit « déjà conclue » ──
  const updAcc = updated.length;
  const pubBefore = published.length;
  await click('trade_accept', 'UB', g.id);
  const gDone = trades.getTrade(g.id);
  check(gDone.status === 'done' && gDone.seller === 'UB' && collections.getCount('UA', HW1.url) === 1 && credits.getBalance('UB') === 12, 'B accepte : HW1 chez A, 12 JP$ chez B');
  const after = updated.slice(updAcc);
  const upB = after.find((m) => m.channel === 'D_UB');
  const upC = after.find((m) => m.channel === 'D_UC');
  check(upB && /Échange conclu/.test(flat(upB)) && !actionIds(upB).length, 'DM de B mis à jour : échange conclu');
  check(upC && /Déjà conclue/.test(flat(upC)) && !actionIds(upC).length, 'DM de C mis à jour : « déjà conclue », sans boutons');
  const upF = after.find((m) => m.channel === 'D_UF');
  check(upF && /Déjà conclue/.test(flat(upF)) && !actionIds(upF).length, 'DM de F (qui avait décliné) : « déjà conclue »');
  check(/accept/i.test(flat(dmsTo('UA').at(-1))), 'DM de résultat à A');
  check(published.slice(pubBefore).some((p) => p.user_id === 'UA') && published.slice(pubBefore).some((p) => p.user_id === 'UB'), 'Accueils de A et B rafraîchis');
  await click('trade_accept', 'UC', g.id);
  check(/déjà/i.test(ephemerals.at(-1).text) && collections.getCount('UC', HW1.url) === 1, 'C clique Accepter ensuite : « déjà conclue », rien ne bouge');

  // ── Contre-offre sur une demande à une personne : acceptée avec complément ──
  collections.addCards('UB', [{ ...HW1 }]);
  const d1 = trades.createDirect({ buyer: 'UA', seller: 'UB', code: 'HW1', jp: 12, now: Date.now() }).trade;
  trades.setDm(d1.id, 'UB', { channel: 'D_UB', ts: 'd1' });
  const balA = credits.getBalance('UA');
  const balB = credits.getBalance('UB');
  check(await submitView('trade_counter_submit', 'UB', { jp: 20, cards: [C1.code], meta: `${d1.id}|UB` }) === null, 'demande à une personne : B contre-propose 20 JP$ + ' + C1.code);
  check(has(dmsTo('UA').at(-1), 'trade_counter_accept') && /complément de \*8 JP\$/.test(flat(dmsTo('UA').at(-1))), 'DM à A : bouton d\'acceptation, complément de 8 JP$ annoncé');
  await click('trade_counter_accept', 'UA', `${d1.id}|UB`);
  const d1Done = trades.getTrade(d1.id);
  check(d1Done.status === 'done' && d1Done.reason === 'counter_accepted', 'A accepte la contre-offre : échange conclu');
  check(credits.getBalance('UA') === balA - 8 && credits.getBalance('UB') === balB + 20, 'complément de 8 JP$ prélevé, 20 JP$ versés à B');
  check(collections.getCount('UB', C1.url) === 1 && collections.getCount('UA', HW1.url) === 2, `${C1.code} chez B, HW1 chez A`);
  check(/accepté ta contre-offre/.test(flat(dmsTo('UB').at(-1))), 'B est prévenu');
  const upD1 = updated.filter((m) => m.ts === 'd1').at(-1);
  check(upD1 && /Échange conclu/.test(flat(upD1)) && flat(upD1).includes('20 JP$'), 'DM de demande de B mis à jour (ce qu\'il a reçu : la contre-offre)');

  // ── Contre-offre refusée sur une demande à une personne : close et remboursée ──
  collections.addCards('UB', [{ ...HW1 }]);
  const d2 = trades.createDirect({ buyer: 'UA', seller: 'UB', code: 'HW1', jp: 15, now: Date.now() }).trade;
  const balA2 = credits.getBalance('UA');
  await submitView('trade_counter_submit', 'UB', { jp: 30, meta: `${d2.id}|UB` });
  await click('trade_counter_refuse', 'UA', `${d2.id}|UB`);
  check(trades.getTrade(d2.id).status === 'refused' && credits.getBalance('UA') === balA2 + 15, 'A refuse : demande close, 15 JP$ rendus');
  check(/La demande est close/.test(flat(dmsTo('UB').at(-1))), 'B est prévenu, demande close');

  // ── Solde insuffisant pour le complément : rien ne bouge ──
  const d3 = trades.createDirect({ buyer: 'UA', seller: 'UB', code: 'HW1', jp: 10, now: Date.now() }).trade;
  await submitView('trade_counter_submit', 'UB', { jp: 5000, meta: `${d3.id}|UB` });
  const balA3 = credits.getBalance('UA');
  await click('trade_counter_accept', 'UA', `${d3.id}|UB`);
  check(/solde ne suffit pas/.test(ephemerals.at(-1).text), 'complément impossible : message clair');
  check(trades.getTrade(d3.id).status === 'open' && credits.getBalance('UA') === balA3 && collections.getCount('UB', HW1.url) === 1, 'rien n\'a bougé, la demande reste ouverte');

  // ── Cartes retirées de la banque : proposables (demande générale, contre-offre), mises aux enchères ──
  const RA = { url: 'https://x.test/retiree-a', title: 'Vieille carte #998', rarity: 'rare', type: 'image' };
  const RB = { url: 'https://x.test/retiree-b', title: 'Souvenir #997', rarity: 'epic', type: 'image' };
  collections.addCards('UA', [{ ...RA }]);
  collections.addCards('UB', [{ ...RB }]);
  await click('trade_general_open', 'UA');
  const gvR = opened.at(-1).view;
  check(flat(gvR).includes('"value":"#998"'), 'demande générale : ma carte retirée #998 proposable en échange');
  check(!flat(gvR.blocks.find((b) => b.block_id === 'card')).includes('#998'), 'demande générale : la carte recherchée reste un numéro de l\'index');
  check(await submitView('trade_general_submit', 'UA', { code: 'HW1', cards: ['#998'] }) === null, 'demande générale : HW1 contre la carte retirée #998');
  const gR = trades.openTradesOf('UA').find((t) => t.kind === 'general');
  check(gR && gR.offer.cards[0] === RA.url, 'carte retirée réservée dans l\'offre');
  check(/\*#998\*/.test(flat(dmsTo('UC').at(-1))), 'DM aux propriétaires : la carte retirée est nommée #998 (pas « ? »)');
  await click('trade_counter_open', 'UC', `${gR.id}|UC`);
  const cvR = opened.at(-1).view;
  check(flat(cvR).includes('"value":"#998"') && flat(cvR).includes('*#998*'), 'contre-offre : la carte retirée de l\'acheteur est listée et choisissable');
  check(await submitView('trade_counter_submit', 'UC', { jp: 0, cards: ['#998'], meta: `${gR.id}|UC` }) === null, 'contre-offre : la carte retirée #998 demandée (lue chez l\'acheteur)');
  check(trades.getTrade(gR.id).counters.UC.cards[0] === RA.url, 'contre-offre enregistrée avec la carte retirée');
  await click('trade_auction_open', 'UB');
  check(flat(opened.at(-1).view).includes('"value":"#997"'), 'enchères : ma carte retirée #997 peut être mise aux enchères');

  // ── Samedi : pause ──
  at('2026-11-06T23:10:00Z');   // samedi 0h10
  const satPosted = posted.length;
  await click('trade_counter_accept', 'UA', `${d3.id}|UB`);
  check(/week-end/.test(ephemerals.at(-1).text) && posted.length === satPosted, 'samedi : Accepter la contre-offre répond par le texte de pause');
  await click('trade_counter_open', 'UB', `${d3.id}|UB`);
  check(/week-end/.test(ephemerals.at(-1).text), 'samedi : Contre-offre répond par le texte de pause');
  await click('trade_general_open', 'UA');
  check(/week-end/.test(flat(opened.at(-1).view)) && !opened.at(-1).view.submit, 'samedi : « Demande générale » ouvre seulement le texte de pause');

  // ── Table des erreurs ──
  check(['no_owner', 'already_countered', 'not_buyer', 'no_counter', 'counter_closed'].every((c) => typeof tradesSlack.ERROR_TEXT[c] === 'string'), 'ERROR_TEXT : textes des erreurs de la demande générale et des contre-offres');

  origLog(process.exitCode ? '\n❌ ÉCHECS ci-dessus\n' : '\n🎉 Demande générale et contre-offres OK\n');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* base SQLite encore ouverte (Windows) */ }
  process.exit(process.exitCode || 0);
})();
