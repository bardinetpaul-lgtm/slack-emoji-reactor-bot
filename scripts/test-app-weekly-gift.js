#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test des crédits du vendredi côté Slack (src/app.js) avec un faux Slack
//
//  Charge le vrai src/app.js en remplaçant @slack/bolt par un faux
//  client, dans une COPIE temporaire du projet (aucune donnée réelle
//  touchée). Joue : distribution au démarrage (semaine en retard),
//  DM du vendredi, section Accueil, modale, don, refus, DM au bénéficiaire.
//
//  Usage : node scripts/test-app-weekly-gift.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-smoke-gift-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

// 📦 2 inscrits + une semaine déjà ancienne → distribution dès le démarrage
fs.writeFileSync(path.join(TMP, 'data', 'subscribers.json'), JSON.stringify({ users: ['U1', 'U2'] }));
fs.writeFileSync(path.join(TMP, 'data', 'weekly-gift.json'), JSON.stringify({ week_start: '2020-01-03T08:00:00.000Z', users: { U1: 3 } }));

process.env.WEB_PUBLIC_URL = '';
process.env.WEB_PORT = '3197';
process.env.TARGET_EMOJI = 'jeanpip';
process.env.SLACK_BOT_TOKEN = 'xoxb-fake';
process.env.SLACK_SIGNING_SECRET = 'fake';
process.env.SLACK_APP_TOKEN = 'xapp-fake';

const posted = [];
const published = [];
const opened = [];
const dmChannels = {};
const fakeClient = {
  conversations: { open: async ({ users }) => ({ channel: { id: (dmChannels[users] = `D_${users}`) } }) },
  chat: {
    postMessage: async (m) => { posted.push(m); return { ok: true, channel: m.channel, ts: String(1000 + posted.length) }; },
    update: async () => ({ ok: true }),
  },
  users: { info: async () => ({ user: { is_bot: false } }) },
  auth: { test: async () => ({ user_id: 'B_BOT', user: 'jeanpip' }) },
  views: {
    publish: async (v) => { published.push(v); return { ok: true }; },
    open: async (v) => { opened.push(v); return { ok: true }; },
  },
  files: { info: async () => { throw new Error('fake'); } },
};
const actions = {};
const views = {};
class FakeApp {
  constructor() { this.client = fakeClient; }
  event() {} message() {} command() {}
  view(id, fn) { views[id] = fn; }
  action(id, fn) { if (typeof id === 'string') actions[id] = fn; }
  error() {}
  async start() {}
}
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@slack/bolt') return { App: FakeApp, LogLevel: { INFO: 'info', DEBUG: 'debug' } };
  if (req === 'dotenv') return { config() {} };
  return origLoad.call(this, req, ...rest);
};

const logs = [];
const origLog = console.log;
console.log = (...a) => logs.push(a.join(' '));
const logger = { info: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push('ERR ' + a.join(' ')) };

process.on('unhandledRejection', (e) => { origLog('❌ unhandledRejection', e); process.exitCode = 1; });

(async () => {
  require(path.join(TMP, 'src', 'app.js'));
  await new Promise((r) => setTimeout(r, 300));
  const credits = require(path.join(TMP, 'src', 'credits.js'));
  const weeklyGift = require(path.join(TMP, 'src', 'weeklyGift.js'));
  const check = (ok, msg) => { origLog(`  ${ok ? '✅' : '❌'} ${msg}`); if (!ok) process.exitCode = 1; };

  origLog('\n🧪 app.js — crédits du vendredi');
  check(logs.some((l) => l.includes('Bot lancé')), 'le bot démarre');

  // 🎁 Distribution au démarrage
  const fridayDMs = posted.filter((m) => m.text && m.text.includes('JeanPip vous donne 20 crédits'));
  check(fridayDMs.length === 2, `DM du vendredi envoyé aux 2 inscrits (${fridayDMs.length})`);
  check(fridayDMs[0] && fridayDMs[0].text.includes('aux personnes de votre choix'), 'texte : « aux personnes de votre choix »');
  check(weeklyGift.getAllowance('U1') === 20, 'U1 : 20 à offrir (les 3 de la semaine passée sont perdus)');

  // 🏠 Accueil : section + bouton
  const ack = async () => {};
  await actions.weekly_gift_open({ ack, body: { user: { id: 'U1' }, trigger_id: 't' }, client: fakeClient, logger });
  const modalView = opened.at(-1) && opened.at(-1).view;
  check(modalView && modalView.callback_id === 'weekly_gift_submit', 'bouton → modale « Offrir des crédits »');
  const home = require(path.join(TMP, 'src', 'home.js'));
  const homeView = home.buildHomeView('U1', { isAdmin: false, attackPrice: 50, creditsPerJeanpipLabel: '0,5', targetEmoji: 'jeanpip', farmRemainingMs: 0, farmQuota: { used: 0, max: 10, nextFreeMs: 0 }, formatRemaining: String });
  check(JSON.stringify(homeView).includes('weekly_gift_open'), 'Accueil : bouton « Offrir des crédits » affiché');

  // 💸 Soumission
  const submit = async (user, amount) => {
    let acked;
    await views.weekly_gift_submit({
      ack: async (r) => { acked = r; },
      body: { user: { id: 'U1' } },
      view: { state: { values: { user: { value: { selected_user: user } }, amount: { value: { value: String(amount) } } } } },
      client: fakeClient,
      logger,
    });
    return acked;
  };
  check((await submit('U1', 5)).errors.user, 'don à soi-même : erreur dans la modale');
  check((await submit('U9', 5)).errors.user, 'non-inscrit : erreur dans la modale');
  check((await submit('U2', 25)).errors.amount.includes('20'), 'trop : « il ne te reste que 20 »');
  check((await submit('U2', 8)) === undefined, 'don de 8 à U2 : modale fermée');
  check(credits.getBalance('U2') === 8 && weeklyGift.getAllowance('U1') === 12, 'U2 +8 au porte-monnaie, U1 reste 12');
  check(posted.at(-1).channel === 'D_U2' && posted.at(-1).text.includes('<@U1> t\'a offert 8'), 'DM au bénéficiaire');
  check(published.some((p) => p.user_id === 'U1'), 'Accueil du donneur rafraîchi');

  await submit('U2', 12);
  const homeAfter = home.buildHomeView('U1', { isAdmin: false, attackPrice: 50, creditsPerJeanpipLabel: '0,5', targetEmoji: 'jeanpip', farmRemainingMs: 0, farmQuota: { used: 0, max: 10, nextFreeMs: 0 }, formatRemaining: String });
  check(!JSON.stringify(homeAfter).includes('weekly_gift_open'), 'plus rien à offrir : section masquée');
  check(!logs.some((l) => l.startsWith('ERR')), 'aucune erreur loguée');

  fs.rmSync(TMP, { recursive: true, force: true });
  origLog(process.exitCode ? '\n❌ ÉCHECS ci-dessus\n' : '\n🎉 Crédits du vendredi côté Slack OK\n');
  process.exit(process.exitCode || 0);
})();
