#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test anti-farm côté Slack (src/app.js) avec un faux Slack
//
//  Charge le vrai src/app.js en remplaçant @slack/bolt par un faux
//  client, dans une COPIE temporaire du projet (aucune donnée réelle
//  touchée). Un joueur dépasse la limite de Jeanpips de l'heure (v3.0.2) :
//    • il ne reçoit plus AUCUNE image : ni la sienne quand il réagit, ni
//      les Jeanpips des autres, ni l'auto-réaction, ni une Attaque ;
//    • ses Jeanpips n'arrivent plus aux autres pendant la pénalité ;
//    • un Jeanpip envoyé à un joueur sanctionné ne compte pas (aucun JP$)
//      mais son auteur reçoit quand même SON image ;
//    • à la fin de la pénalité, tout revient (envoi + réception).
//
//  Usage : node scripts/test-app-farm.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-farm-app-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

process.env.WEB_PUBLIC_URL = '';
process.env.TARGET_EMOJI = 'jeanpip';
process.env.SLACK_BOT_TOKEN = 'xoxb-fake';
process.env.SLACK_SIGNING_SECRET = 'fake';
process.env.SLACK_APP_TOKEN = 'xapp-fake';

const realSetTimeout = global.setTimeout;
const posted = [];
const authorOf = {};   // ts du message → auteur
const fakeClient = {
  conversations: {
    open: async ({ users }) => ({ channel: { id: `D_${users}` } }),
    history: async ({ latest }) => ({ messages: [{ user: authorOf[latest] }] }),
  },
  chat: {
    postMessage: async (m) => {
      posted.push(m);
      return { ok: true, channel: m.channel, ts: String(1000 + posted.length) };
    },
    update: async () => ({ ok: true }),
  },
  reactions: { add: async () => ({ ok: true }) },
  users: { info: async ({ user }) => ({ user: { name: user, real_name: user, profile: {} } }) },
  auth: { test: async () => ({ user_id: 'B_BOT', user: 'jeanpip' }) },
  views: { publish: async () => ({ ok: true }) },
  files: { info: async () => { throw new Error('fake'); } },
};
const events = {};
class FakeApp {
  constructor() { this.client = fakeClient; }
  event(name, fn) { events[name] = fn; }
  message() {} command() {} view() {} action() {} error() {}
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

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    origLog(`  ✅ ${name}`);
  } catch (e) {
    origLog(`  ❌ ${name}\n     ${e.message}`);
    process.exitCode = 1;
  }
}
const wait = (ms) => new Promise((r) => realSetTimeout(r, ms));

(async () => {
  require(path.join(TMP, 'src', 'app.js'));
  await wait(300);
  const broadcast = require(path.join(TMP, 'src', 'broadcast.js'));
  const settings = require(path.join(TMP, 'src', 'settings.js'));
  const farm = require(path.join(TMP, 'src', 'farm.js'));
  for (const u of ['U_FARMER', 'U_AUTEUR', 'U_AUTRE']) broadcast.subscribe(u);
  const MAX = settings.getFarmMaxPerHour();

  let n = 0;
  /** `user` réagit à un nouveau message de `author` → DMs postés pendant cette réaction. */
  const react = async (user, author) => {
    n += 1;
    const ts = `${n}.000`;
    authorOf[ts] = author;
    const before = posted.length;
    await events.reaction_added({ event: { reaction: 'jeanpip', user, item: { channel: 'C1', ts } }, client: fakeClient, logger });
    return posted.slice(before);
  };
  const dmsTo = (list, user) => list.filter((m) => m.channel === `D_${user}`);

  origLog(`\n🧪 Anti-farm (limite ${MAX} Jeanpips / h)\n`);

  await test(`sous la limite : le réacteur et l'auteur reçoivent chacun une image`, async () => {
    const out = await react('U_FARMER', 'U_AUTEUR');
    assert.strictEqual(dmsTo(out, 'U_FARMER').length, 1, 'réacteur');
    assert.strictEqual(dmsTo(out, 'U_AUTEUR').length, 1, 'auteur');
  });

  await test(`dépasser la limite → pénalité`, async () => {
    for (let i = 1; i < MAX; i += 1) await react('U_FARMER', 'U_AUTEUR');
    const out = await react('U_FARMER', 'U_AUTEUR');
    assert.ok(dmsTo(out, 'U_FARMER').some((m) => /anti-farm/i.test(m.text)), 'DM d\'alerte');
    assert.ok(farm.getPenaltyRemaining('U_FARMER') > 0, 'pénalité active');
  });

  await test(`sous pénalité : le réacteur ne reçoit plus SON image`, async () => {
    const out = await react('U_FARMER', 'U_AUTEUR');
    assert.strictEqual(dmsTo(out, 'U_FARMER').length, 0, `DMs au réacteur : ${JSON.stringify(dmsTo(out, 'U_FARMER').map((m) => m.text))}`);
  });

  await test(`sous pénalité : son Jeanpip n'arrive pas à l'auteur`, async () => {
    const out = await react('U_FARMER', 'U_AUTEUR');
    assert.strictEqual(dmsTo(out, 'U_AUTEUR').length, 0);
  });

  await test(`sous pénalité : il ne reçoit plus les Jeanpips des autres`, async () => {
    const credits = require(path.join(TMP, 'src', 'credits.js'));
    const before = credits.getBalance('U_AUTRE');
    const out = await react('U_AUTRE', 'U_FARMER');
    assert.strictEqual(dmsTo(out, 'U_FARMER').length, 0, 'le bridé ne doit rien recevoir');
    assert.strictEqual(dmsTo(out, 'U_AUTRE').length, 1, 'l\'autre reçoit quand même son image');
    assert.strictEqual(credits.getBalance('U_AUTRE'), before, 'Jeanpip non délivré → aucun JP$');
  });

  await test(`sous pénalité : la carte n'entre pas dans sa collection`, async () => {
    const collections = require(path.join(TMP, 'src', 'collections.js'));
    const before = collections.getCollection('U_FARMER').reduce((s, c) => s + c.count, 0);
    await react('U_FARMER', 'U_AUTEUR');
    await react('U_AUTRE', 'U_FARMER');
    assert.strictEqual(collections.getCollection('U_FARMER').reduce((s, c) => s + c.count, 0), before);
  });

  await test(`fin de pénalité : il peut de nouveau envoyer`, async () => {
    farm.clear('U_FARMER');
    const out = await react('U_FARMER', 'U_AUTEUR');
    assert.strictEqual(dmsTo(out, 'U_FARMER').length, 1, 'réacteur');
    assert.strictEqual(dmsTo(out, 'U_AUTEUR').length, 1, 'auteur');
  });

  const errors = logs.filter((l) => l.startsWith('ERR'));
  await test('aucune erreur dans le flux', () => assert.deepStrictEqual(errors, []));

  try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows */ }
  origLog(process.exitCode ? '\n❌ Échec' : `\n✅ Tout est bon (${passed})`);
  process.exit(process.exitCode || 0);
})().catch((e) => { origLog(e); process.exit(1); });
