#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test de « 🃏 Donner une carte » (panneau Admin, src/app.js) avec un faux Slack
//
//  Charge le vrai src/app.js en remplaçant @slack/bolt par un faux
//  client, dans une COPIE temporaire du projet (aucune donnée réelle
//  touchée). Joue : bouton réservé aux admins, modale (légendaires en
//  premier), don d'une carte, doublon, refus, DM au joueur et à l'admin.
//
//  Usage : node scripts/test-app-give-card.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-give-card-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

process.env.WEB_PUBLIC_URL = '';
process.env.WEB_PORT = '3198';
process.env.TARGET_EMOJI = 'jeanpip';
process.env.SLACK_BOT_TOKEN = 'xoxb-fake';
process.env.SLACK_SIGNING_SECRET = 'fake';
process.env.SLACK_APP_TOKEN = 'xapp-fake';
process.env.JEANPIP_ADMINS = 'UADMIN';

const posted = [];
const opened = [];
const fakeClient = {
  conversations: { open: async ({ users }) => ({ channel: { id: `D_${users}` } }) },
  chat: {
    postMessage: async (m) => { posted.push(m); return { ok: true, channel: m.channel, ts: String(1000 + posted.length) }; },
    update: async () => ({ ok: true }),
  },
  users: { info: async () => ({ user: { is_bot: false } }) },
  auth: { test: async () => ({ user_id: 'B_BOT', user: 'jeanpip' }) },
  views: { publish: async () => ({ ok: true }), open: async (v) => { opened.push(v); return { ok: true }; } },
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
  const collections = require(path.join(TMP, 'src', 'collections.js'));
  const home = require(path.join(TMP, 'src', 'home.js'));
  const { getAllMedia } = require(path.join(TMP, 'src', 'media.js'));
  const { buildAlbum } = require(path.join(TMP, 'src', 'album.js'));
  const check = (ok, msg) => { origLog(`  ${ok ? '✅' : '❌'} ${msg}`); if (!ok) process.exitCode = 1; };
  const ack = async () => {};

  origLog('\n🧪 app.js — donner une carte (admin)');

  // 👑 Bouton : seulement dans le panneau admin
  const ctx = { attackPrice: 50, creditsPerJeanpipLabel: '0,5', targetEmoji: 'jeanpip', farmRemainingMs: 0, farmQuota: { used: 0, max: 10, nextFreeMs: 0 }, formatRemaining: String };
  check(JSON.stringify(home.buildHomeView('UADMIN', { ...ctx, isAdmin: true })).includes('admin_give_card_open'), 'Accueil admin : bouton « Donner une carte »');
  check(!JSON.stringify(home.buildHomeView('U1', { ...ctx, isAdmin: false })).includes('admin_give_card_open'), 'Accueil joueur : pas de bouton');

  // 🪟 Modale : réservée aux admins, légendaires en premier, limites Slack
  await actions.admin_give_card_open({ ack, body: { user: { id: 'U1' }, trigger_id: 't' }, client: fakeClient, logger });
  check(opened.length === 0, 'non-admin : la modale ne s\'ouvre pas');
  await actions.admin_give_card_open({ ack, body: { user: { id: 'UADMIN' }, trigger_id: 't' }, client: fakeClient, logger });
  const modal = opened.at(-1) && opened.at(-1).view;
  check(modal && modal.callback_id === 'admin_give_card_submit', 'admin : modale « Donner une carte »');
  const groups = modal.blocks.find((b) => b.block_id === 'card').element.option_groups;
  check(groups[0].label.text.includes('Légendaire'), 'légendaires en premier');
  check(groups.length <= 100 && groups.every((g) => g.options.length <= 100 && g.options.every((o) => o.text.text.length <= 75 && o.value.length <= 150)), 'limites Slack (100 groupes, 100 options, 75 / 150 caractères)');

  // 🃏 Don
  const legendary = getAllMedia().find((m) => m.rarity === 'legendary');
  const value = groups[0].options.find((o) => o.value === legendary.url || home.cardFromValue(o.value) === legendary).value;
  const submit = async (who, user, cardValue, count) => {
    let acked;
    await views.admin_give_card_submit({
      ack: async (r) => { acked = r; },
      body: { user: { id: who } },
      view: { state: { values: { user: { value: { selected_user: user } }, card: { value: { selected_option: cardValue ? { value: cardValue } : null } }, count: { value: { value: String(count) } } } } },
      client: fakeClient,
      logger,
    });
    return acked;
  };
  check((await submit('U1', 'U2', value, 1)).errors.card.includes('admins'), 'non-admin : refusé');
  check(collections.getCount('U2', legendary.url) === 0, 'non-admin : rien donné');
  check((await submit('UADMIN', 'U2', null, 1)).errors.card, 'carte manquante : erreur dans la modale');
  check((await submit('UADMIN', 'U2', value, 9)).errors.count, 'trop d\'exemplaires : erreur dans la modale');

  const before = posted.length;
  check((await submit('UADMIN', 'U2', value, 1)) === undefined, 'don d\'une légendaire à U2 : modale fermée');
  check(collections.getCount('U2', legendary.url) === 1, 'U2 possède la carte');
  const album = buildAlbum('U2');
  check(album.stats.owned === 1 && album.stats.byRarity.legendary.owned === 1, 'elle apparaît dans son classeur (légendaire)');
  const dms = posted.slice(before);
  check(dms.some((m) => m.channel === 'D_U2' && m.text.includes('Un admin t\'a donné une carte') && m.text.includes(legendary.title)), 'DM au joueur');
  check(dms.some((m) => m.channel === 'D_UADMIN' && m.text.includes('Carte donnée')), 'DM de confirmation à l\'admin');

  await submit('UADMIN', 'U2', value, 2);
  check(collections.getCount('U2', legendary.url) === 3, '2 exemplaires de plus : U2 en a 3');
  check(buildAlbum('U2').stats.owned === 1, 'toujours 1 carte distincte au classeur');
  check(logs.some((l) => l.includes('a donné') && l.includes('<@U2>')), 'don tracé dans les logs');
  check(!logs.some((l) => l.startsWith('ERR')), 'aucune erreur loguée');

  try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }   // Windows : fichier ouvert = non supprimable
  fs.rmSync(TMP, { recursive: true, force: true });
  origLog(process.exitCode ? '\n❌ ÉCHECS ci-dessus\n' : '\n🎉 Donner une carte OK\n');
  process.exit(process.exitCode || 0);
})();
