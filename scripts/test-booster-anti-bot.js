#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test v3.2 « Octobre Rose sans triche » (src/app.js avec un faux Slack)
//
//  Dans une COPIE temporaire du projet (aucune donnée réelle touchée),
//  avec une horloge simulée :
//    • bouton Octobre Rose caché tant qu'il n'est pas achetable, et
//      tous les Accueils ouverts republiés à l'arrivée du stock
//    • achat refusé hors Accueil (vieux DM boutique), boutique DM sans Octobre Rose
//    • 👑 Offrir un booster : hors stock du jour et hors limite par personne
//    • 👑 Sanction booster : 7 jours sans Octobre Rose, levée à 0 jour
//    • clic automatique (cadence de machine) : bloqué + alerte aux admins
//    • chaque clic Octobre Rose gardé en base (événement booster_click)
//
//  Usage : node scripts/test-booster-anti-bot.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-antibot-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

// ⏰ Horloge simulée (Date.now ET new Date()) : jeudi 15/10 à 8h (Paris), avant l'arrivée du stock
const RealDate = Date;
let NOW = RealDate.parse('2026-10-15T06:00:00Z');
global.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(NOW); }
  static now() { return NOW; }
};

process.env.WEB_PUBLIC_URL = '';
process.env.WEB_PORT = '3196';
process.env.TARGET_EMOJI = 'jeanpip';
process.env.SLACK_BOT_TOKEN = 'xoxb-fake';
process.env.SLACK_SIGNING_SECRET = 'fake';
process.env.SLACK_APP_TOKEN = 'xapp-fake';
process.env.JEANPIP_ADMINS = 'UADMIN';

const posted = [];      // DM envoyés : channel = D_<userId>
const published = [];   // Accueils publiés : { user_id, view }
const fakeClient = {
  conversations: { open: async ({ users }) => ({ channel: { id: `D_${users}` } }) },
  chat: {
    postMessage: async (m) => { posted.push(m); return { ok: true, channel: m.channel, ts: String(1000 + posted.length) }; },
    update: async () => ({ ok: true }),
  },
  users: { info: async () => ({ user: { is_bot: false } }) },
  auth: { test: async () => ({ user_id: 'B_BOT', user: 'jeanpip' }) },
  views: { publish: async (v) => { published.push(v); return { ok: true }; }, open: async () => ({ ok: true }) },
  files: { info: async () => { throw new Error('fake'); } },
};
const actions = [];
const views = [];
const commands = [];
class FakeApp {
  constructor() { this.client = fakeClient; }
  event() {} message() {} error() {}
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
const at = (iso) => { NOW = RealDate.parse(iso); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dmsTo = (u) => posted.filter((m) => m.channel === `D_${u}`);
const lastHome = (u) => JSON.stringify((published.filter((p) => p.user_id === u).at(-1) || {}).view || {});
const ROSE_BTN = 'buy_booster_octobre_rose';

(async () => {
  require(path.join(TMP, 'src', 'app.js'));
  await wait(300);
  const req = (m) => require(path.join(TMP, 'src', m));
  const boosters = req('boosters.js');
  const octobreRose = req('octobreRose.js');
  const credits = req('credits.js');
  const boosterBans = req('boosterBans.js');
  const home = req('home.js');
  const db = req('db.js').getDb();
  const find = (list, name) => list.find((a) => (a.id instanceof RegExp ? a.id.test(name) : a.id === name)).fn;
  const ack = async () => {};
  const buy = (u, { fromHome = true } = {}) => find(actions, ROSE_BTN)({
    ack, body: { user: { id: u }, ...(fromHome ? { view: { type: 'home' } } : {}) }, action: { value: 'octobre_rose' }, client: fakeClient, logger,
  });
  const homeOf = (u, isAdmin = false) => JSON.stringify(home.buildHomeView(u, { isAdmin, attackPrice: 50, creditsPerJeanpipLabel: '0,5', targetEmoji: 'jeanpip', farmRemainingMs: 0, farmQuota: { used: 0, max: 10, nextFreeMs: 0 }, formatRemaining: String }));
  const submit = async (callbackId, user, values) => {
    let response = null;
    await find(views, callbackId)({ ack: async (r) => { response = r || null; }, body: { user: { id: user } }, view: { state: { values } }, client: fakeClient, logger });
    return response;
  };
  const sel = (v) => ({ value: { selected_option: v === null ? null : { value: v } } });
  const usr = (u) => ({ value: { selected_user: u } });
  const txt = (v) => ({ value: { value: v } });
  const rose = boosters.getBooster('octobre_rose');
  const drop = RealDate.parse('2026-10-15T07:00:00Z') + (octobreRose.dropMinute('2026-10-15') - 540) * 60000;

  origLog('\n🧪 v3.2 — Octobre Rose sans triche');

  // ── 🙈 Bouton caché avant l'arrivée du stock ──
  for (const u of ['UA', 'UB', 'UC', 'UBOT', 'UZ']) credits.setBalance(u, 500);
  let h = homeOf('UA');
  check(!h.includes(ROSE_BTN) && h.includes("Le bouton d'achat apparaîtra ici"), 'avant l\'arrivée du stock : pas de bouton, « le bouton apparaîtra ici »');
  check(h.includes('buy_booster_common') && h.includes('buy_booster_epic'), '… les boosters classiques restent achetables');

  // Accueils déjà ouverts (UA, UB) : republiés tout seuls à l'arrivée du stock
  await find(actions, 'buy_booster_common')({ ack, body: { user: { id: 'UA' } }, action: { value: 'common' }, client: fakeClient, logger });
  await find(actions, 'buy_booster_common')({ ack, body: { user: { id: 'UB' } }, action: { value: 'common' }, client: fakeClient, logger });
  check(!lastHome('UA').includes(ROSE_BTN), 'Accueil ouvert de UA : pas encore de bouton Octobre Rose');
  NOW = drop - 1000;
  await wait(2300);
  check(!lastHome('UA').includes(ROSE_BTN), '1 s avant l\'arrivée : toujours rien');
  const before = published.length;
  NOW = drop;
  await wait(2300);   // le contrôle tourne toutes les 2 s
  const pushed = published.slice(before).map((p) => p.user_id).sort().join();
  check(pushed === 'UA,UB', `à l'arrivée du stock : les Accueils ouverts sont republiés d'un coup (${pushed})`);
  check(lastHome('UA').includes(ROSE_BTN) && lastHome('UB').includes(ROSE_BTN), '… avec le bouton Octobre Rose');
  const again = published.length;
  await wait(2300);
  check(published.length === again, 'une seule fois par jour');

  // ── Achat hors Accueil (vieux DM boutique) ──
  await buy('UC', { fromHome: false });
  check(/uniquement depuis l'onglet Accueil/.test(dmsTo('UC').at(-1).text) && credits.getBalance('UC') === 500 && boosters.stockLeft(rose) === 3, 'clic depuis un vieux DM boutique : refusé, rien débité, stock intact');
  await find(commands, '/jeanpip-booster')({ ack, command: { user_id: 'UC' }, client: fakeClient, logger });
  const shop = JSON.stringify(dmsTo('UC').at(-1));
  check(!shop.includes(ROSE_BTN) && shop.includes('buy_booster_common') && shop.includes("uniquement dans l'onglet *Accueil*"), 'boutique /jeanpip-booster : plus de bouton Octobre Rose, renvoi vers l\'Accueil');

  // ── 👑 Sanction booster ──
  check(await submit('admin_booster_ban_submit', 'UA', { user: usr('UZ'), booster: sel('octobre_rose'), days: txt('7'), reason: txt('x'), notify: { value: { selected_options: [] } } }) !== null
    && !boosterBans.activeBan('UZ', 'octobre_rose'), 'sanction : refusée pour un non-admin');
  const banAt = NOW;
  const r = await submit('admin_booster_ban_submit', 'UADMIN', { user: usr('UZ'), booster: sel('octobre_rose'), days: txt('7'), reason: txt('clics automatiques'), notify: { value: { selected_options: [{ value: 'dm' }] } } });
  const ban = boosterBans.activeBan('UZ', 'octobre_rose');
  check(r === null && ban && ban.until === banAt + 7 * 24 * 3600 * 1000 && ban.by === 'UADMIN', 'admin : UZ privé d\'Octobre Rose pendant 7 jours');
  check(/Tu ne peux plus acheter le 🎀 Booster Octobre Rose jusqu'au jeudi 22 octobre/.test(JSON.stringify(dmsTo('UZ').at(-1))) && /clics automatiques/.test(JSON.stringify(dmsTo('UZ').at(-1))), 'UZ prévenu par DM : jusqu\'au jeudi 22 octobre, avec la raison');
  check(/Sanction enregistrée/.test(dmsTo('UADMIN').at(-1).text), 'l\'admin reçoit la confirmation');
  h = homeOf('UZ');
  check(!h.includes(ROSE_BTN) && h.includes("Booster interdit jusqu'au jeudi 22 octobre") && h.includes('buy_booster_common'), 'Accueil de UZ : pas de bouton Octobre Rose, « interdit jusqu\'au … », les autres boosters restent');
  await buy('UZ');
  check(/Tu ne peux pas acheter de Booster/.test(dmsTo('UZ').at(-1).text) && credits.getBalance('UZ') === 500 && boosters.stockLeft(rose) === 3, 'UZ clique quand même (Accueil pas à jour) : refusé, rien débité');
  check(boosters.purchaseBlock(boosters.getBooster('common'), NOW, 'UZ') === null, 'UZ peut toujours acheter un booster Commun');
  check(homeOf('UADMIN', true).includes('Sanctions boosters en cours (1)') && homeOf('UADMIN', true).includes('<@UZ>'), 'panneau admin : sanction listée');
  check(boosters.purchaseBlock(rose, banAt + 7 * 24 * 3600 * 1000 + 1000, 'UZ') !== 'banned', '7 jours plus tard : sanction terminée');
  check((await submit('admin_booster_ban_submit', 'UADMIN', { user: usr('UC'), booster: sel('octobre_rose'), days: txt('0'), reason: txt(''), notify: { value: { selected_options: [] } } })).errors.days, 'lever une sanction qui n\'existe pas : erreur dans la modale');

  // ── 👑 Offrir un booster (hors stock, hors limite par personne) ──
  const dmBefore = dmsTo('UB').length;
  check(await submit('admin_give_booster_submit', 'UA', { user: usr('UB'), booster: sel('octobre_rose'), count: txt('2') }) !== null && boosters.countPending('UB') === 1, 'offrir : refusé pour un non-admin');
  check(await submit('admin_give_booster_submit', 'UADMIN', { user: usr('UB'), booster: sel('octobre_rose'), count: txt('2') }) === null, 'admin : offre 2 Octobre Rose à UB');
  const gifts = dmsTo('UB').slice(dmBefore);
  check(gifts.length === 2 && gifts.every((m) => /Un admin t'offre un 🎀 Booster Octobre Rose/.test(JSON.stringify(m)) && JSON.stringify(m).includes('open_booster')), 'UB reçoit 2 DM « Un admin t\'offre … » avec le bouton d\'ouverture');
  check(boosters.countPending('UB') === 3 && credits.getBalance('UB') === 480, 'boosters en main, rien débité (le Commun acheté plus tôt mis à part)');
  check(boosters.stockLeft(rose) === 3 && boosters.boughtToday(rose, 'UB') === 0, 'stock du jour intact (3/3), UB peut encore acheter le sien');
  const granted = db.prepare("SELECT data FROM events WHERE type = 'booster_granted' AND user_id = 'UB'").all().map((e) => JSON.parse(e.data));
  check(granted.length === 2 && granted.every((g) => g.reason === 'admin' && g.by === 'UADMIN'), 'événements booster_granted (raison admin, par UADMIN)');
  check(homeOf('UADMIN', true).includes('admin_give_booster_open') && homeOf('UADMIN', true).includes('admin_booster_ban_open') && !homeOf('UA').includes('admin_give_booster_open'), 'boutons 🎁 Offrir un booster et 🚫 Sanction booster : panneau admin seulement');

  // ── 🤖 Clic automatique : bloqué + admins prévenus ──
  await buy('UBOT');   // achète le sien
  check(boosters.boughtToday(rose, 'UBOT') === 1, 'UBOT achète son booster');
  const adminDMs = dmsTo('UADMIN').length;
  for (let i = 1; i <= 5; i += 1) { NOW += 6000; await buy('UBOT'); }   // son script continue toutes les 6 s
  await wait(100);
  check(/Clics automatiques détectés/.test(dmsTo('UBOT').at(-1).text) && /bloqué 2 min/.test(dmsTo('UBOT').at(-1).text), 'UBOT : « clics automatiques détectés », bouton bloqué 2 min');
  const alert = dmsTo('UADMIN').slice(adminDMs).find((m) => /Clics automatiques/.test(JSON.stringify(m)));
  check(alert && JSON.stringify(alert).includes('<@UBOT>') && /6\.00 s/.test(JSON.stringify(alert)), 'les admins reçoivent l\'alerte avec <@UBOT> et les écarts (6.00 s)');
  const clicks = db.prepare("SELECT data FROM events WHERE type = 'booster_click' AND user_id = 'UBOT'").all().map((e) => JSON.parse(e.data));
  check(clicks.length === 6 && clicks[0].verdict === 'process' && clicks.at(-1).verdict === 'lock' && clicks.at(-1).reason === 'bot', `chaque clic gardé en base (${clicks.length} booster_click, le dernier = lock/bot)`);

  // ── Stock épuisé : le bouton disparaît des Accueils ouverts ──
  await buy('UA');
  NOW += 5000;
  const beforeSoldOut = published.length;
  await buy('UB');
  check(boosters.stockLeft(rose) === 0, 'les 3 du jour sont partis (UBOT, UA, UB)');
  const refreshed = new Set(published.slice(beforeSoldOut).map((p) => p.user_id));
  check(['UA', 'UB', 'UBOT'].every((u) => refreshed.has(u)), `dernier booster parti : Accueils ouverts republiés (${[...refreshed].sort().join(', ')})`);
  check(!lastHome('UC').includes(ROSE_BTN) && !lastHome('UA').includes(ROSE_BTN), '… sans bouton Octobre Rose');
  check(homeOf('UC').includes("Épuisé pour aujourd'hui") && !homeOf('UC').includes(ROSE_BTN), 'Accueil de UC (pas servi) : « épuisé », pas de bouton');
  check(homeOf('UA').includes("déjà eu le tien") && !homeOf('UA').includes(ROSE_BTN), 'Accueil de UA (servi) : « déjà eu le tien », pas de bouton');

  // ── Week-end : rien ──
  at('2026-10-17T09:30:00Z');
  check(!homeOf('UC').includes(ROSE_BTN) && homeOf('UC').includes('week-end'), 'samedi : pas de bouton, « pas de booster le week-end »');

  origLog(process.exitCode ? '\n❌ ÉCHECS ci-dessus\n' : '\n🎉 Octobre Rose sans triche OK\n');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* base SQLite encore ouverte (Windows) */ }
  process.exit(process.exitCode || 0);
})();
