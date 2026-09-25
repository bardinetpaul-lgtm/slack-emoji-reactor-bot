#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test de l'attribution des médias (auteur crédité selon la rareté)
//
//  Charge le vrai src/app.js avec un faux Slack, dans une COPIE
//  temporaire du projet (aucune donnée réelle touchée). Joue la modale
//  « Ajouter un média » et /jeanpip-addmedia, avec et sans @auteur.
//
//  Usage : node scripts/test-media-author.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs'), os = require('os'), path = require('path'), Module = require('module');
const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-author-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));
Object.assign(process.env, { WEB_PUBLIC_URL: '', WEB_PORT: '3197', TARGET_EMOJI: 'jeanpip', SLACK_BOT_TOKEN: 'x', SLACK_SIGNING_SECRET: 'x', SLACK_APP_TOKEN: 'x', JEANPIP_ADMINS: 'UADMIN' });
const posted = [];
const fakeClient = {
  conversations: { open: async ({ users }) => ({ channel: { id: 'D_' + users } }) },
  chat: { postMessage: async (m) => { posted.push(m); return { ok: true, ts: '1' }; }, update: async () => ({ ok: true }) },
  users: { info: async ({ user }) => ({ user: { is_bot: user === 'UBOT' } }) },
  auth: { test: async () => ({ user_id: 'B_BOT', user: 'jeanpip' }) },
  views: { publish: async () => ({ ok: true }) },
  files: { info: async () => { throw new Error('fake'); } },
};
const cmds = {}, views = {};
class FakeApp { constructor() { this.client = fakeClient; } event() {} message() {} action() {} error() {} async start() {}
  command(n, fn) { cmds[n] = fn; } view(n, fn) { views[n] = fn; } }
const orig = Module._load;
Module._load = function (r, ...rest) { if (r === '@slack/bolt') return { App: FakeApp, LogLevel: { INFO: 'info', DEBUG: 'debug' } }; if (r === 'dotenv') return { config() {} }; return orig.call(this, r, ...rest); };
const logs = []; const oLog = console.log; console.log = (...a) => logs.push(a.join(' '));
const logger = { info: (...a) => logs.push(a.join(' ')), warn: () => {}, error: (...a) => logs.push('ERR ' + a.join(' ')) };
const check = (ok, msg) => { oLog(`  ${ok ? '✅' : '❌'} ${msg}`); if (!ok) process.exitCode = 1; };
(async () => {
  require(path.join(TMP, 'src', 'app.js'));
  await new Promise((r) => setTimeout(r, 300));
  const credits = require(path.join(TMP, 'src', 'credits.js'));
  const bank = () => JSON.parse(fs.readFileSync(path.join(TMP, 'data', 'media-bank-custom.json'), 'utf-8'));
  const vals = (o) => ({ url: { value: { value: o.url } }, rarity: { value: { selected_option: { value: o.rarity } } }, title: { value: { value: '' } }, author: { value: { selected_user: o.author || null } } });
  const submit = async (o, user = 'UADMIN') => { let acked; await views.admin_addmedia_submit({ ack: async (x) => { acked = x; }, body: { user: { id: user } }, view: { state: { values: vals(o) } }, client: fakeClient, logger }); return acked; };

  oLog('\n🧪 Attribution des médias');
  let a = await submit({ url: 'https://x.test/1.gif', rarity: 'legendary', author: 'UAUTH' });
  check(a === undefined, 'modale : ack sans erreur');
  check(credits.getBalance('UAUTH') === 30, 'légendaire → +30 crédits');
  check(posted.some((m) => m.channel === 'D_UAUTH' && m.text.includes('+30')), 'auteur notifié en DM');
  check(posted.some((m) => m.channel === 'D_UADMIN' && m.blocks[0].text.text.includes('Attribué à <@UAUTH>')), 'admin voit l’attribution');
  check(bank().at(-1).author === 'UAUTH', 'auteur enregistré sur le média');

  a = await submit({ url: 'https://x.test/2.gif', rarity: 'rare', author: 'UBOT' });
  check(a && a.errors && a.errors.author, 'bot refusé (erreur sur le champ auteur)');
  check(bank().length === 1, 'rien ajouté pour un bot');

  const n = posted.length;
  a = await submit({ url: 'https://x.test/3.gif', rarity: 'common' });
  check(a === undefined && bank().length === 2 && !bank().at(-1).author, 'sans auteur : ajout normal, pas d’auteur');
  check(!posted.slice(n).some((m) => m.channel !== 'D_UADMIN'), 'sans auteur : seul l’admin reçoit un DM');

  await cmds['/jeanpip-addmedia']({ ack: async () => {}, command: { user_id: 'UADMIN', text: 'https://x.test/4.gif epique <@UAUTH|paul> Super titre' }, client: fakeClient, logger });
  check(credits.getBalance('UAUTH') === 50, 'slash : épique → +20 (total 50)');
  check(/Super titre$/.test(bank().at(-1).title) && bank().at(-1).author === 'UAUTH', 'slash : titre conservé, auteur enregistré');
  await cmds['/jeanpip-addmedia']({ ack: async () => {}, command: { user_id: 'UADMIN', text: 'https://x.test/5.gif commun Juste un titre' }, client: fakeClient, logger });
  check(/Juste un titre$/.test(bank().at(-1).title) && !bank().at(-1).author, 'slash sans @auteur : inchangé');
  await cmds['/jeanpip-addmedia']({ ack: async () => {}, command: { user_id: 'UADMIN', text: 'https://x.test/6.gif rare <@UAUTH>' }, client: fakeClient, logger });
  check(credits.getBalance('UAUTH') === 65, 'slash : rare → +15 (total 65)');
  check(!logs.some((l) => l.startsWith('ERR')), 'aucune erreur loguée');
  process.exit(process.exitCode || 0);
})();
