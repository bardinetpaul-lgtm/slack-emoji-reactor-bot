#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test Jeanpips du jour (v3.6, src/dailyJeanpips.js)
//
//  Charge le vrai src/app.js avec un faux Slack, dans une COPIE
//  temporaire du projet (aucune donnée réelle touchée) :
//    • premier démarrage : 20 Jeanpips par jour, 1 JP$ par Jeanpip (une fois) ;
//    • 20 Jeanpips comptent, le 21e ne donne plus rien (prévenu) ;
//    • compteur de l'Accueil, réglage admin, remise à zéro le lendemain ;
//    • Raid gratuit à 40 Jeanpips dans la semaine.
//
//  Usage : node scripts/test-daily-jeanpips.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-daily-'));
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
process.env.JEANPIP_ADMINS = 'U_ADMIN';

const realSetTimeout = global.setTimeout;
const posted = [];
const ephemerals = [];
const authorOf = {};
const fakeClient = {
  conversations: {
    open: async ({ users }) => ({ channel: { id: `D_${users}` } }),
    history: async ({ latest }) => ({ messages: [{ user: authorOf[latest] }] }),
  },
  chat: {
    postEphemeral: async (m) => { ephemerals.push(m); return { ok: true }; },
    postMessage: async (m) => { posted.push(m); return { ok: true, channel: m.channel, ts: String(1000 + posted.length) }; },
    update: async () => ({ ok: true }),
  },
  reactions: { add: async () => ({ ok: true }) },
  users: { info: async ({ user }) => ({ user: { name: user, real_name: user, profile: {} } }) },
  auth: { test: async () => ({ user_id: 'B_BOT', user: 'jeanpip' }) },
  views: { publish: async () => ({ ok: true }), open: async () => ({ ok: true }) },
  files: { info: async () => { throw new Error('fake'); } },
};
const events = {};
const views = {};
const actions = {};
class FakeApp {
  constructor() { this.client = fakeClient; }
  event(name, fn) { events[name] = fn; }
  view(id, fn) { views[id] = fn; }
  action(id, fn) { if (typeof id === 'string') actions[id] = fn; }
  message() {} command() {} error() {}
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
const req = (m) => require(path.join(TMP, 'src', m));

(async () => {
  // Réglages de prod avant la v3.6 : 0,5 JP$ par Jeanpip, pas de limite par jour
  fs.writeFileSync(path.join(TMP, 'data', 'settings.json'), JSON.stringify({ creditsPerJeanpip: 0.5, farmMaxPerHour: 100 }));
  require(path.join(TMP, 'src', 'app.js'));
  await wait(300);
  const settings = req('settings.js');
  const credits = req('credits.js');
  const scores = req('scores.js');
  const broadcast = req('broadcast.js');
  const dailyJeanpips = req('dailyJeanpips.js');
  const weekend = req('weekend.js');
  const home = req('home.js');
  for (const u of ['U_A', 'U_B', 'U_ADMIN']) broadcast.subscribe(u);

  origLog('\n🧪 Jeanpips du jour (v3.6)\n');

  await test('premier démarrage v3.6 : 20 Jeanpips par jour et 1 JP$ par Jeanpip, une seule fois', () => {
    assert.strictEqual(settings.getDailyJeanpipLimit(), 20);
    assert.strictEqual(settings.getCreditsPerJeanpip(), 1);
    assert.strictEqual(settings.getFarmMaxPerHour(), 100, 'les autres réglages ne bougent pas');
    settings.setCreditsPerJeanpip(2);
    assert.strictEqual(settings.applyV36Defaults(), false, 'déjà appliqué : les réglages admin priment');
    assert.strictEqual(settings.getCreditsPerJeanpip(), 2);
    settings.setCreditsPerJeanpip(1);
  });

  await test('Raid gratuit à 40 Jeanpips dans la semaine', () => assert.strictEqual(scores.ATTACK_THRESHOLD, 40));

  let n = 0;
  const react = async (user, author) => {
    n += 1;
    const ts = `${n}.000`;
    authorOf[ts] = author;
    const before = posted.length;
    const eph = ephemerals.length;
    await events.reaction_added({ event: { reaction: 'jeanpip', user, item: { channel: 'C1', ts } }, client: fakeClient, logger });
    return { dms: posted.slice(before).filter((m) => m.channel === `D_${user}`), notes: ephemerals.slice(eph) };
  };

  if (weekend.pauseFor('U_A')) {
    origLog('  ⏭️  pause en cours (week-end / fermeture) : tests de réaction sautés');
  } else {
    await test('20 Jeanpips : une image et 1 JP$ chacun', async () => {
      const before = credits.getBalance('U_A');
      for (let i = 0; i < 20; i += 1) {
        const out = await react('U_A', 'U_B');
        assert.strictEqual(out.dms.length, 1, `Jeanpip n°${i + 1}`);
      }
      assert.strictEqual(credits.getBalance('U_A'), before + 20);
      assert.strictEqual(dailyJeanpips.countToday('U_A'), 20);
    });

    await test('21e : rien (ni image, ni JP$, ni point), prévenu en éphémère', async () => {
      const before = credits.getBalance('U_A');
      const score = scores.getScore('U_A');
      const out = await react('U_A', 'U_B');
      assert.strictEqual(out.dms.length, 0);
      assert.strictEqual(credits.getBalance('U_A'), before);
      assert.strictEqual(scores.getScore('U_A'), score);
      assert.ok(out.notes.length === 1 && /20 Jeanpips du jour/.test(out.notes[0].text), JSON.stringify(out.notes));
    });

    await test('un autre joueur n\'est pas touché', async () => {
      assert.strictEqual((await react('U_B', 'U_A')).dms.length, 1);
    });

    await test('Accueil : compteur 20/20', () => {
      const ctx = { isAdmin: false, creditsPerJeanpipLabel: '1', targetEmoji: 'jeanpip', farmRemainingMs: 0, farmQuota: { used: 0, max: 100, nextFreeMs: 0 }, formatRemaining: () => '', dailyJeanpips: { used: 20, max: 20 } };
      const t = JSON.stringify(home.buildHomeView('U_A', ctx).blocks);
      assert.ok(t.includes('20/20 Jeanpips') && t.includes('20 par jour au maximum'));
    });

    const submit = async (id, user, values) => {
      let acked;
      await views[id]({ ack: async (r) => { acked = r; }, body: { user: { id: user } }, view: { state: { values } }, client: fakeClient, logger });
      return acked;
    };
    await test('admin : limite réglable (réservée aux admins, bornée), effet immédiat', async () => {
      assert.strictEqual((await submit('admin_daily_limit_submit', 'U_A', { value: { value: { value: '50' } } })).response_action, 'errors');
      assert.strictEqual((await submit('admin_daily_limit_submit', 'U_ADMIN', { value: { value: { value: '0' } } })).response_action, 'errors');
      assert.strictEqual(await submit('admin_daily_limit_submit', 'U_ADMIN', { value: { value: { value: '25' } } }), undefined);
      assert.strictEqual((await react('U_A', 'U_B')).dms.length, 1, 'le 21e passe avec une limite à 25');
    });
  }

  await test('le compteur repart à zéro le lendemain', () => {
    const tomorrow = Date.now() + 24 * 3600 * 1000;
    assert.strictEqual(dailyJeanpips.countToday('U_A', tomorrow), 0);
  });

  const errors = logs.filter((l) => l.startsWith('ERR'));
  await test('aucune erreur dans le flux', () => assert.deepStrictEqual(errors, []));

  try { req('db.js').close(); } catch { /* base jamais ouverte */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows */ }
  origLog(process.exitCode ? '\n❌ Échec' : `\n✅ Tout est bon (${passed})`);
  process.exit(process.exitCode || 0);
})().catch((e) => { origLog(e); process.exit(1); });
