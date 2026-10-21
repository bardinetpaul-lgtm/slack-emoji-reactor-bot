#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test revente des doublons (v3.6, src/resale.js)
//
//  Charge le vrai src/app.js avec un faux Slack, dans une COPIE
//  temporaire du projet (aucune donnée réelle touchée) :
//    • on garde toujours 1 exemplaire, et ceux des 3 decks (Capitaine compris) ;
//    • prix par rareté, cartes troll non revendables ;
//    • plafond de la semaine (réglable), remis à zéro le lundi ;
//    • rien pendant ses congés ni pendant un raid subi ;
//    • modale joueur (erreurs, DM, JP$) et réglage admin.
//
//  Usage : node scripts/test-resale.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-resale-'));
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

const WED = Date.parse('2026-11-04T10:00:00Z');   // mercredi 4 novembre, 11h à Paris

(async () => {
  require(path.join(TMP, 'src', 'app.js'));
  await wait(300);
  const resale = req('resale.js');
  const collections = req('collections.js');
  const credits = req('credits.js');
  const settings = req('settings.js');
  const arenaStore = req(path.join('game', 'arenaStore.js'));
  const leave = req('leave.js');
  const raid = req('raid.js');
  const home = req('home.js');
  const weekend = req('weekend.js');
  const { parisDay } = req('octobreRose.js');

  const card = (url, rarity, n) => Array.from({ length: n }, () => ({ url, rarity, title: url, type: 'image' }));
  const give = (u, ...cards) => collections.addCards(u, cards.flat());
  const count = (u, url) => collections.getCount(u, url);
  give('U_A', card('c1', 'common', 10), card('c2', 'common', 4), card('c3', 'common', 1), card('r1', 'rare', 3),
    card('e1', 'epic', 2), card('l1', 'legendary', 2), card('s1', 'spam', 5), card('p1', 'rose', 1));
  // Deck 1 : c2 ×3 ; deck 2 : r1 ×2 + Capitaine e1
  arenaStore.setDecks('U_A', { active: 0, decks: [{ cards: ['c2', 'c2', 'c2'] }, { cards: ['r1', 'r1'], captain: 'e1' }, {}] });

  origLog('\n🧪 Revente des doublons (v3.6)\n');

  await test('revendables : dernier exemplaire et cartes des decks protégés, troll exclues', () => {
    assert.deepStrictEqual(resale.sellableCounts('U_A'), { common: 9 + 1, rare: 1, epic: 1, rose: 0, legendary: 1 });
    assert.strictEqual(resale.sellable('U_A').common[0].url, 'c1', 'la plus fournie d\'abord');
  });

  await test('vente : cartes retirées, JP$ crédités au bon prix', () => {
    const before = credits.getBalance('U_A');
    const r = resale.sell('U_A', { common: 4, rare: 1 }, WED);
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(r.gained, 4 * 0.5 + 2);
    assert.strictEqual(credits.getBalance('U_A'), before + 4);
    assert.strictEqual(count('U_A', 'c1'), 6, 'pris sur la plus fournie');
    assert.strictEqual(count('U_A', 'c2'), 4, 'deck intact');
    assert.strictEqual(count('U_A', 'r1'), 2, 'les 2 du deck restent');
    assert.strictEqual(r.remaining, 30 - 4);
  });

  await test('vente répartie : on prend sur la carte qui a le plus d\'exemplaires en trop', () => {
    give('U_B', card('x', 'common', 5), card('y', 'common', 3));
    resale.sell('U_B', { common: 3 }, WED);
    assert.strictEqual(count('U_B', 'x'), 2);
    assert.strictEqual(count('U_B', 'y'), 3);
  });

  await test('refus : trop de cartes, rien demandé, plafond dépassé', () => {
    assert.strictEqual(resale.sell('U_A', { epic: 2 }, WED).error, 'too_many');
    assert.strictEqual(resale.sell('U_A', {}, WED).error, 'empty');
    assert.strictEqual(resale.sell('U_A', { legendary: 1, epic: 1, common: 4 }, WED).error, 'cap', '20 + 5 + 2 = 27 > 26');
  });

  await test('plafond : atteint dans la semaine, remis à zéro le lundi, réglable', () => {
    assert.strictEqual(resale.remainingThisWeek('U_A', WED), 26);
    assert.ok(resale.sell('U_A', { legendary: 1 }, WED).ok);
    assert.strictEqual(resale.remainingThisWeek('U_A', WED), 6);
    assert.strictEqual(resale.sell('U_A', { epic: 1, common: 4 }, WED).error, 'cap');
    const nextMonday = Date.parse('2026-11-09T08:00:00Z');
    assert.strictEqual(resale.remainingThisWeek('U_A', nextMonday), 30);
    settings.setResaleWeeklyCap(10);
    assert.strictEqual(resale.remainingThisWeek('U_A', nextMonday), 10, 'réglage admin pris en compte');
    settings.setResaleWeeklyCap(30);
  });

  // ── Modale + Accueil (aujourd'hui, pour de vrai) ──
  const submit = async (id, user, values) => {
    let acked;
    await views[id]({ ack: async (r) => { acked = r; }, body: { user: { id: user } }, view: { state: { values } }, client: fakeClient, logger });
    return acked;
  };
  const qty = (o) => Object.fromEntries(Object.entries(o).map(([r, n]) => [`sell_${r}`, { value: { value: String(n) } }]));
  const paused = Boolean(weekend.pauseFor('U_C'));
  give('U_C', card('k', 'common', 6), card('q', 'rare', 2));

  await test('modale : erreur sous le champ si on en demande trop', async () => {
    const r = await submit('resale_submit', 'U_C', qty({ rare: 3 }));
    assert.strictEqual(r.response_action, 'errors');
    if (!paused) assert.ok(r.errors.sell_rare, JSON.stringify(r.errors));
  });

  if (!paused) {
    await test('modale : revente faite, DM envoyé, JP$ crédités', async () => {
      const before = credits.getBalance('U_C');
      const dms = posted.length;
      const r = await submit('resale_submit', 'U_C', qty({ common: 2, rare: 1 }));
      assert.strictEqual(r, undefined);
      assert.strictEqual(credits.getBalance('U_C'), before + 3);
      assert.ok(posted.slice(dms).some((m) => /Revente faite/.test(m.text)));
    });

    await test('Accueil : bouton « Revendre » et compteur de la semaine', () => {
      const ctx = { isAdmin: false, creditsPerJeanpipLabel: '1', targetEmoji: 'jeanpip', farmRemainingMs: 0, farmQuota: { used: 0, max: 30, nextFreeMs: 0 }, formatRemaining: () => '' };
      const t = JSON.stringify(home.buildHomeView('U_C', ctx).blocks);
      assert.ok(t.includes('resale_open') && t.includes('3/30 JP$'), 'bouton + 3/30');
    });

    await test('modale : se construit avec un champ par rareté revendable', () => {
      const m = home.buildResaleModal('U_C');
      assert.strictEqual(m.callback_id, 'resale_submit');
      assert.deepStrictEqual(m.blocks.filter((b) => b.type === 'input').map((b) => b.block_id), ['sell_common']);
    });
  }

  await test('raid subi : pas de revente', async () => {
    raid.create({ attacker: 'U_A', targets: ['U_C'], style: 'assaut' });
    assert.ok(/raid/.test(JSON.stringify(home.buildResaleModal('U_C'))));
    const r = await submit('resale_submit', 'U_C', qty({ common: 1 }));
    assert.strictEqual(r.response_action, 'errors');
  });

  await test('congés : pas de revente', async () => {
    leave.declareLeave('U_B', parisDay(Date.now()), parisDay(Date.now()));
    assert.ok(/congés|week-end|fermeture/.test(JSON.stringify(home.buildResaleModal('U_B'))));
    const r = await submit('resale_submit', 'U_B', qty({ common: 1 }));
    assert.strictEqual(r.response_action, 'errors');
  });

  await test('admin : plafond réglable, refusé aux joueurs et hors bornes', async () => {
    assert.strictEqual((await submit('admin_resale_cap_submit', 'U_B', { value: { value: { value: '50' } } })).response_action, 'errors');
    assert.strictEqual((await submit('admin_resale_cap_submit', 'U_ADMIN', { value: { value: { value: '9999' } } })).response_action, 'errors');
    assert.strictEqual(await submit('admin_resale_cap_submit', 'U_ADMIN', { value: { value: { value: '40' } } }), undefined);
    assert.strictEqual(settings.getResaleWeeklyCap(), 40);
  });

  const errors = logs.filter((l) => l.startsWith('ERR'));
  await test('aucune erreur dans le flux', () => assert.deepStrictEqual(errors, []));

  try { req('db.js').close(); } catch { /* base jamais ouverte */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows */ }
  origLog(process.exitCode ? '\n❌ Échec' : `\n✅ Tout est bon (${passed})`);
  process.exit(process.exitCode || 0);
})().catch((e) => { origLog(e); process.exit(1); });
