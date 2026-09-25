#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test des boosters côté Slack (src/app.js) avec un faux Slack
//
//  Charge le vrai src/app.js en remplaçant @slack/bolt par un faux
//  client, dans une COPIE temporaire du projet (aucune donnée réelle
//  touchée). Joue : démarrage, achat, DM à 2 boutons, ouverture Slack
//  (rythme 2 s), double clic, intrus, booster inconnu, ancien booster.
//  Lancé 2 fois : page FIFA activée puis désactivée (WEB_PUBLIC_URL vide).
//
//  Usage : node scripts/test-app-booster.js   (~30 s)
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

// Sans argument : relance ce script dans les 2 modes (process séparés)
if (!process.argv[2]) {
  const { spawnSync } = require('child_process');
  const codes = ['web', 'noweb'].map((m) => spawnSync(process.execPath, [__filename, m], { stdio: 'inherit' }).status);
  const ok = codes.every((c) => c === 0);
  console.log(ok ? '\n🎉 Boosters Slack OK dans les 2 modes\n' : '\n❌ ÉCHECS ci-dessus\n');
  process.exit(ok ? 0 : 1);
}

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-smoke-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

const MODE = process.argv[2]; // 'web' = WEB_PUBLIC_URL défini, 'noweb' = vide
process.env.WEB_PUBLIC_URL = MODE === 'web' ? 'https://example.test/jeanpip' : '';
process.env.WEB_PORT = MODE === 'web' ? '3199' : '3198';
process.env.TARGET_EMOJI = 'jeanpip';
process.env.SLACK_BOT_TOKEN = 'xoxb-fake';
process.env.SLACK_SIGNING_SECRET = 'fake';
process.env.SLACK_APP_TOKEN = 'xapp-fake';

const posted = [];
const updated = [];
const fakeClient = {
  conversations: { open: async () => ({ channel: { id: 'D_TEST' } }) },
  chat: {
    postMessage: async (m) => { posted.push(m); return { ok: true, channel: m.channel, ts: String(1000 + posted.length) }; },
    update: async (m) => { updated.push(m); return { ok: true }; },
  },
  auth: { test: async () => ({ user_id: 'B_BOT', user: 'jeanpip' }) },
  views: { publish: async () => ({ ok: true }) }, // onglet Accueil rafraîchi après achat
  files: { info: async () => { throw new Error('fake'); } },
};
const actions = [];
class FakeApp {
  constructor() { this.client = fakeClient; }
  event() {} message() {} command() {} view() {}
  action(id, fn) { actions.push({ id, fn }); }
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
const logger = { info: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => { logs.push('ERR ' + a.join(' ')); } };

process.on('unhandledRejection', (e) => { origLog('❌ unhandledRejection', e); process.exitCode = 1; });

(async () => {
  require(path.join(TMP, 'src', 'app.js'));
  await new Promise((r) => setTimeout(r, 300));
  const credits = require(path.join(TMP, 'src', 'credits.js'));
  const boosters = require(path.join(TMP, 'src', 'boosters.js'));
  const find = (name) => actions.find((a) => (a.id instanceof RegExp ? a.id.test(name) : a.id === name)).fn;
  const ack = async () => {};
  const check = (ok, msg) => { origLog(`  ${ok ? '✅' : '❌'} ${msg}`); if (!ok) process.exitCode = 1; };

  origLog(`\n🧪 app.js (mode ${MODE})`);
  check(logs.some((l) => l.includes('Bot lancé')), 'le bot démarre');

  // Achat sans crédits
  await find('buy_booster_epic')({ ack, body: { user: { id: 'U1' } }, action: { value: 'epic' }, client: fakeClient, logger });
  check(posted.at(-1).text.includes('manque'), 'achat refusé sans crédits');

  // Achat avec crédits
  credits.setBalance('U1', 100);
  const buyMsg = await (async () => {
    await find('buy_booster_epic')({ ack, body: { user: { id: 'U1' } }, action: { value: 'epic' }, client: fakeClient, logger });
    return posted.at(-1);
  })();
  const btns = buyMsg.blocks.find((b) => b.type === 'actions').elements;
  check(buyMsg.text.includes('acheté'), 'achat OK');
  if (MODE === 'web') {
    check(btns.length === 2 && /\/open\/b_.+\?t=[a-f0-9]{64}$/.test(btns[0].url), 'DM : bouton FIFA (lien signé) + bouton Slack');
  } else {
    check(btns.length === 1 && btns[0].action_id === 'open_booster', 'DM : seulement le bouton Slack (web désactivé)');
  }
  const id = btns.find((b) => b.action_id === 'open_booster').value;
  check(boosters.getPending(id).message.ts === String(1000 + posted.length), 'ts du message mémorisé');
  check(boosters.getPending(id).message && boosters.getPending(id).message.channel === 'D_TEST', 'message.channel = D_TEST');

  // Ack du bouton-lien
  if (MODE === 'web') await find('open_booster_web')({ ack });

  // Ouverture Slack
  const before = posted.length;
  const t0 = Date.now();
  await find('open_booster')({ ack, body: { user: { id: 'U1' }, channel: { id: 'D_TEST' }, message: { ts: boosters.getPending(id).message.ts } }, action: { value: id }, client: fakeClient, logger });
  const dt = Date.now() - t0;
  check(posted.length - before === 8, '8 cartes révélées dans Slack');
  check(dt > 13000 && dt < 16000, `rythme 2 s (${(dt / 1000).toFixed(1)} s pour 7 intervalles)`);
  check(updated.length >= 1, 'bouton désactivé (chat.update)');

  // Double clic
  const before2 = posted.length;
  await find('open_booster')({ ack, body: { user: { id: 'U1' }, channel: { id: 'D_TEST' }, message: { ts: boosters.getPending(id).message.ts } }, action: { value: id }, client: fakeClient, logger });
  check(posted.length === before2, 'double clic ignoré');

  // Intrus
  const before4 = posted.length;
  await find('open_booster')({ ack, body: { user: { id: 'U_INTRUS' }, channel: { id: 'D_TEST' } }, action: { value: id }, client: fakeClient, logger });
  check(posted.length === before4, "clic d'un intrus ignoré");

  // Booster inconnu
  await find('open_booster')({ ack, body: { user: { id: 'U1' }, channel: { id: 'D_TEST' } }, action: { value: 'b_nope' }, client: fakeClient, logger });
  check(posted.at(-1).text.includes('introuvable'), 'booster inconnu → message introuvable');

  // Ancien booster (format d'avant la PR, sans message/cards)
  const store = path.join(TMP, 'data', 'boosters.json');
  const data = JSON.parse(fs.readFileSync(store, 'utf-8'));
  data.boosters.b_old = { owner: 'U1', type: 'common', opened: false, createdAt: '2026-09-01T00:00:00.000Z' };
  fs.writeFileSync(store, JSON.stringify(data));
  const before3 = posted.length;
  await find('open_booster')({ ack, body: { user: { id: 'U1' }, channel: { id: 'D_TEST' }, message: { ts: '1' } }, action: { value: 'b_old' }, client: fakeClient, logger });
  check(posted.length - before3 === 8, 'ancien booster (acheté avant la mise à jour) s\'ouvre normalement');

  const errs = logs.filter((l) => l.startsWith('ERR'));
  check(errs.length === 0, `aucune erreur loguée${errs.length ? ' : ' + errs.join(' | ') : ''}`);

  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
})();

