#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test v3.3 « Le week-end, on souffle » (src/app.js avec un faux Slack)
//
//  Dans une COPIE temporaire du projet (aucune donnée réelle touchée),
//  avec une horloge simulée, du samedi 0h au lundi 0h (heure de Paris) :
//    • réaction :jeanpip: → rien (ni image, ni JP$, ni score) + rappel éphémère
//    • auto-react des cibles coupé, Attaque refusée (slash, bouton, modale)
//    • boosters : ni achat ni ouverture (le booster attend lundi)
//    • tickets à gratter et nouveaux combats d'Arène refusés
//    • cadeaux admin refusés (ils notifieraient), correction de JP$ possible
//    • Accueil : bandeau « en pause », plus aucun bouton de jeu
//    • vendredi 23h59 et lundi 0h : tout remarche
//
//  Usage : node scripts/test-weekend.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-weekend-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

// ⏰ Horloge simulée : vendredi 23/10 à 23h59 (Paris, heure d'été = UTC+2)
const RealDate = Date;
let NOW = RealDate.parse('2026-10-23T21:59:00Z');
global.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(NOW); }
  static now() { return NOW; }
};
const at = (iso) => { NOW = RealDate.parse(iso); };
const FRIDAY_2359 = '2026-10-23T21:59:00Z';
const SATURDAY_0000 = '2026-10-23T22:00:00Z';
const SUNDAY_2359 = '2026-10-25T22:59:00Z';   // passage à l'heure d'hiver le 25/10 : UTC+1
const MONDAY_0000 = '2026-10-25T23:00:00Z';

process.env.WEB_PUBLIC_URL = '';
process.env.WEB_PORT = '3195';
process.env.TARGET_EMOJI = 'jeanpip';
process.env.SLACK_BOT_TOKEN = 'xoxb-fake';
process.env.SLACK_SIGNING_SECRET = 'fake';
process.env.SLACK_APP_TOKEN = 'xapp-fake';
process.env.JEANPIP_ADMINS = 'UADMIN';

const posted = [];        // DM : channel = D_<userId>
const ephemerals = [];
const reactionsAdded = [];
const published = [];
const fakeClient = {
  conversations: {
    open: async ({ users }) => ({ channel: { id: `D_${users}` } }),
    history: async () => ({ messages: [{ user: 'UAUTHOR', ts: '1.1' }] }),
  },
  chat: {
    postMessage: async (m) => { posted.push(m); return { ok: true, channel: m.channel, ts: String(1000 + posted.length) }; },
    postEphemeral: async (m) => { ephemerals.push(m); return { ok: true }; },
    update: async () => ({ ok: true }),
  },
  reactions: { add: async (r) => { reactionsAdded.push(r); return { ok: true }; } },
  users: { info: async ({ user }) => ({ user: { id: user, is_bot: false, real_name: user, name: user } }) },
  auth: { test: async () => ({ user_id: 'B_BOT', user: 'jeanpip' }) },
  views: { publish: async (v) => { published.push(v); return { ok: true }; }, open: async () => ({ ok: true }) },
  files: { info: async () => { throw new Error('fake'); } },
};
const actions = [];
const views = [];
const commands = [];
const evts = [];
class FakeApp {
  constructor() { this.client = fakeClient; }
  message() {} error() {}
  event(id, fn) { evts.push({ id, fn }); }
  command(id, fn) { commands.push({ id, fn }); }
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
process.on('unhandledRejection', (e) => { origLog('❌ unhandledRejection', e); process.exitCode = 1; });

const check = (ok, msg) => { origLog(`  ${ok ? '✅' : '❌'} ${msg}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dmsTo = (u) => posted.filter((m) => m.channel === `D_${u}`);
const flat = (x) => JSON.stringify(x);

(async () => {
  require(path.join(TMP, 'src', 'app.js'));
  await wait(300);
  const req = (m) => require(path.join(TMP, 'src', m));
  const weekend = req('weekend.js');
  const boosters = req('boosters.js');
  const credits = req('credits.js');
  const scores = req('scores.js');
  const broadcast = req('broadcast.js');
  const targets = req('targets.js');
  const scratchTickets = req('scratchTickets.js');
  const matchmaking = req('game/matchmaking.js');
  const home = req('home.js');
  const find = (list, name) => list.find((a) => (a.id instanceof RegExp ? a.id.test(name) : a.id === name)).fn;
  const ack = async () => {};
  const homeOf = (u) => flat(home.buildHomeView(u, { isAdmin: false, attackPrice: 50, creditsPerJeanpipLabel: '0,5', targetEmoji: 'jeanpip', farmRemainingMs: 0, farmQuota: { used: 0, max: 10, nextFreeMs: 0 }, formatRemaining: String, ticketsUrl: 'https://example.test/tickets' }));
  const react = (u) => find(evts, 'reaction_added')({ event: { reaction: 'jeanpip', user: u, item: { channel: 'C1', ts: '1.1' } }, client: fakeClient, logger });
  const submit = async (callbackId, user, values) => {
    let response = null;
    await find(views, callbackId)({ ack: async (r) => { response = r || null; }, body: { user: { id: user } }, view: { state: { values } }, client: fakeClient, logger });
    return response;
  };

  origLog('\n🧪 v3.3 — Le week-end, on souffle');

  // ── Bornes (heure de Paris) ──
  check(!weekend.isWeekend(RealDate.parse(FRIDAY_2359)), 'vendredi 23h59 : pas le week-end');
  check(weekend.isWeekend(RealDate.parse(SATURDAY_0000)), 'samedi 0h : week-end');
  check(weekend.isWeekend(RealDate.parse(SUNDAY_2359)), 'dimanche 23h59 (heure d\'hiver) : week-end');
  check(!weekend.isWeekend(RealDate.parse(MONDAY_0000)), 'lundi 0h : fini');

  broadcast.subscribe('UAUTHOR');
  broadcast.subscribe('UR');
  check(broadcast.isSubscribed('UAUTHOR'), 'auteur inscrit à la liste de diffusion');
  for (const u of ['UR', 'UB', 'UADMIN']) credits.setBalance(u, 300);

  // ── Vendredi 23h59 : une réaction marche ──
  at(FRIDAY_2359);
  await react('UR');
  check(credits.getBalance('UR') > 300 && dmsTo('UR').length === 1 && dmsTo('UAUTHOR').length === 1, 'vendredi 23h59 : réaction → JP$ + image au réacteur et à l\'auteur');

  // ── Samedi : la réaction ne fait rien ──
  at(SATURDAY_0000);
  const balance = credits.getBalance('UR');
  const score = scores.getScore('UR');
  const dmCount = posted.length;
  await react('UR');
  check(credits.getBalance('UR') === balance && scores.getScore('UR') === score, 'samedi 0h : réaction → ni JP$ ni point de score');
  check(posted.length === dmCount, '… et aucun DM (ni au réacteur, ni à l\'auteur)');
  check(ephemerals.length === 1 && ephemerals[0].user === 'UR' && /Fous la paix à tes collègues le week-end/.test(ephemerals[0].text), 'rappel éphémère au réacteur : « Fous la paix à tes collègues le week-end ! »');

  // ── Auto-react des cibles ──
  targets.addTarget('UAUTHOR');
  await find(evts, 'message')({ event: { user: 'UAUTHOR', channel: 'C1', ts: '2.2' }, client: fakeClient, logger });
  check(targets.isTarget('UAUTHOR') && reactionsAdded.length === 0 && posted.length === dmCount, 'auto-react sur une cible : coupé le week-end (ni réaction, ni DM)');

  // ── Attaque ──
  await find(commands, '/jeanpip-attack')({ ack, command: { user_id: 'UADMIN', channel_id: 'C1', channel_name: 'general' }, client: fakeClient, logger });
  check(/Pas d'Attaque Jeanpip le week-end/.test(flat(dmsTo('UADMIN').at(-1))) && reactionsAdded.length === 0, '/jeanpip-attack (même admin) : refusée, réponse en DM');
  const before = credits.getBalance('UB');
  await find(actions, 'buy_attack')({ ack, body: { user: { id: 'UB' } }, action: { value: 'C1' }, client: fakeClient, logger });
  check(/Pas d'Attaque Jeanpip le week-end/.test(flat(dmsTo('UB').at(-1))) && credits.getBalance('UB') === before, 'bouton « Lancer l\'attaque (50 JP$) » : refusé, rien débité');
  const modal = await submit('home_attack_submit', 'UB', { channel: { value: { selected_conversation: 'C1' } } });
  check(modal && /week-end/.test(modal.errors.channel), 'modale d\'attaque de l\'Accueil : erreur « week-end »');

  // ── Boosters ──
  await find(actions, 'buy_booster_common')({ ack, body: { user: { id: 'UB' } }, action: { value: 'common' }, client: fakeClient, logger });
  check(/Pas de Booster ⚪ Commun le week-end/.test(dmsTo('UB').at(-1).text) && credits.getBalance('UB') === before && boosters.countPending('UB') === 0, 'achat d\'un booster Commun : refusé, rien débité');
  at(FRIDAY_2359);
  const id = boosters.createPending('UB', 'rare');
  at(SATURDAY_0000);
  await find(actions, 'open_booster')({ ack, body: { user: { id: 'UB' } }, action: { value: id }, client: fakeClient, logger });
  check(/Pas d'ouverture de booster le week-end/.test(flat(dmsTo('UB').at(-1))) && !boosters.getPending(id).opened, 'ouverture d\'un booster acheté vendredi : refusée, il reste fermé');
  check(homeOf('UB').includes('ouvre-les lundi'), 'Accueil : « ils t\'attendent, ouvre-les lundi »');

  // ── Tickets à gratter ──
  check(scratchTickets.purchaseBlock('UB') === 'weekend' && scratchTickets.buy('UB').reason === 'weekend' && credits.getBalance('UB') === before, 'ticket à gratter : achat refusé (« weekend »), rien débité');

  // ── Arène ──
  check(matchmaking.joinQueue('UB').reason === 'weekend', 'Arène : combat rapide refusé');
  check(matchmaking.createChallenge('UB', 'UR').reason === 'weekend', 'Arène : défi refusé');

  // ── Cadeaux admin ──
  check(/week-end/.test((await submit('admin_give_attack_submit', 'UADMIN', { user: { value: { selected_user: 'UB' } } })).errors.user), 'admin : « Offrir une attaque » refusé le week-end');
  check(/week-end/.test((await submit('admin_give_booster_submit', 'UADMIN', { user: { value: { selected_user: 'UB' } }, booster: { value: { selected_option: { value: 'rare' } } }, count: { value: { value: '1' } } })).errors.user), 'admin : « Offrir un booster » refusé le week-end');
  check(/week-end/.test((await submit('admin_credits_submit', 'UADMIN', { user: { value: { selected_user: 'UB' } }, amount: { value: { value: '20' } } })).errors.amount), 'admin : JP$ +20 (cadeau) refusé le week-end');
  check(await submit('admin_credits_submit', 'UADMIN', { user: { value: { selected_user: 'UB' } }, amount: { value: { value: '-20' } } }) === null, 'admin : JP$ -20 (correction, sans notification) accepté');
  await wait(50);

  // ── Accueil ──
  const h = homeOf('UB');
  check(h.includes('Jeanpip est en pause jusqu') && h.includes('on laisse les collègues tranquilles'), 'Accueil : bandeau « en pause jusqu\'à lundi 0h »');
  check(!h.includes('home_attack_open') && !h.includes('buy_booster_') && !h.includes('open_tickets_web'), 'Accueil : plus de bouton Attaque, booster ni ticket');
  check(h.includes("Pas d'Attaque le week-end") && h.includes('Kiosque est fermé le week-end'), 'Accueil : « pas d\'Attaque le week-end », « Kiosque fermé »');
  at(SUNDAY_2359);
  check(homeOf('UB').includes('en pause'), 'dimanche 23h59 : toujours en pause');

  // ── Lundi 0h : tout remarche ──
  at(MONDAY_0000);
  const hm = homeOf('UB');
  check(!hm.includes('en pause') && hm.includes('buy_booster_common') && hm.includes('open_tickets_web'), 'lundi 0h : Accueil normal (boosters, tickets)');
  await find(actions, 'open_booster')({ ack, body: { user: { id: 'UB' } }, action: { value: id }, client: fakeClient, logger });
  check(boosters.getPending(id).opened, 'lundi 0h : le booster de vendredi s\'ouvre');
  const eph = ephemerals.length;
  await react('UR');
  check(ephemerals.length === eph && credits.getBalance('UR') > balance, 'lundi 0h : les réactions rapportent de nouveau');
  check(scratchTickets.purchaseBlock('UB') !== 'weekend' && matchmaking.joinQueue('UB').reason !== 'weekend', 'lundi 0h : tickets et Arène rouverts');

  origLog(process.exitCode ? '\n❌ ÉCHECS ci-dessus\n' : '\n🎉 Week-end en pause OK\n');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* base SQLite encore ouverte (Windows) */ }
  process.exit(process.exitCode || 0);
})();
