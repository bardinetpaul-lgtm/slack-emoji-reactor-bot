#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test anti-spam côté Slack (src/app.js) avec un faux Slack
//
//  Charge le vrai src/app.js en remplaçant @slack/bolt par un faux
//  client, dans une COPIE temporaire du projet (aucune donnée réelle
//  touchée). Un spam (2 réactions en < 8 s sur le même message) →
//  10 photos troll #62 → #71 en DM, qui entrent dans la collection
//  et dans l'intercalaire « Hors série » du classeur.
//  Les attentes de 5 s entre 2 photos sont raccourcies.
//
//  Usage : node scripts/test-app-spam.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-spam-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

process.env.WEB_PUBLIC_URL = '';
process.env.TARGET_EMOJI = 'jeanpip';
process.env.SLACK_BOT_TOKEN = 'xoxb-fake';
process.env.SLACK_SIGNING_SECRET = 'fake';
process.env.SLACK_APP_TOKEN = 'xapp-fake';

// ⏩ Les 5 s entre deux photos troll → 1 ms
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, ms === 5000 ? 1 : ms, ...a);

const posted = [];
let failNext = 0; // nombre de prochains DM qui échouent
const fakeClient = {
  conversations: {
    open: async () => ({ channel: { id: 'D_SPAM' } }),
    history: async () => ({ messages: [{ user: 'U_AUTEUR' }] }),
  },
  chat: {
    postMessage: async (m) => {
      if (failNext > 0) { failNext--; throw new Error('slack down'); }
      posted.push(m);
      return { ok: true, channel: m.channel, ts: String(1000 + posted.length) };
    },
    update: async () => ({ ok: true }),
  },
  reactions: { add: async () => ({ ok: true }) },
  users: { info: async () => ({ user: { profile: {} } }) },
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
  const collections = require(path.join(TMP, 'src', 'collections.js'));
  const { buildAlbum } = require(path.join(TMP, 'src', 'album.js'));
  const { SPAM_CARDS } = require(path.join(TMP, 'src', 'spamCards.js'));

  const react = (user, ts = '111.222') => events.reaction_added({
    event: { reaction: 'jeanpip', user, item: { channel: 'C1', ts } }, client: fakeClient, logger,
  });

  origLog('\n🧪 Anti-spam → cartes Hors série\n');

  await test('spam → 10 photos troll #62 → #71 en DM', async () => {
    await react('U_SPAM');
    posted.length = 0;
    await react('U_SPAM'); // 2e réaction < 8 s sur le même message
    await wait(300);
    const trolls = posted.filter((m) => /Spammer c'est mal/.test(m.text));
    assert.strictEqual(trolls.length, 10);
    assert.match(trolls[0].text, /Surprise #62/);
    assert.match(trolls[9].text, /Surprise #71/);
  });

  await test('les 10 cartes sont dans la collection du spammeur', () => {
    const owned = new Map(collections.getCollection('U_SPAM').map((c) => [c.url, c]));
    for (const c of SPAM_CARDS) {
      assert.ok(owned.has(c.url), `${c.title} manquante`);
      assert.strictEqual(owned.get(c.url).count, 1);
    }
  });

  await test('DM troll annonce « Nouvelle carte », puis « Doublon » au 2e spam', async () => {
    const first = posted.find((m) => /Surprise #62/.test(m.text));
    assert.match(JSON.stringify(first.blocks), /Nouvelle carte/);
    posted.length = 0;
    await wait(20);
    await react('U_SPAM', '333.444');
    await react('U_SPAM', '333.444');
    await wait(300);
    const again = posted.find((m) => /Surprise #62/.test(m.text));
    assert.match(JSON.stringify(again.blocks), /Doublon/);
    assert.strictEqual(collections.getCount('U_SPAM', SPAM_CARDS[0].url), 2);
  });

  await test('classeur : Hors série = les 10 anti-spam, hors pourcentage', () => {
    const album = buildAlbum('U_SPAM');
    const extra = album.sections.find((s) => s.key === 'extra');
    assert.deepStrictEqual(extra.stickers.map((s) => s.n), SPAM_CARDS.map((c) => c.number));
    assert.ok(extra.stickers.every((s) => s.owned && s.rarity === 'extra'));
    assert.match(extra.stickers[0].image, /^api\/card-image\/F[A-Z0-9]+$/);
    assert.deepStrictEqual(album.stats.byRarity.extra, { total: 10, owned: 10 });
    assert.ok(album.stats.owned < 10, 'les cartes anti-spam ne comptent pas dans le %');
  });

  await test('classeur d\'un non-spammeur : 10 emplacements Hors série vides', () => {
    const album = buildAlbum('U_SAGE');
    const extra = album.sections.find((s) => s.key === 'extra');
    assert.strictEqual(extra.stickers.length, 10);
    assert.ok(extra.stickers.every((s) => !s.owned && Object.keys(s).length === 3));
  });

  await test('DM troll qui échoue → carte PAS ajoutée', async () => {
    await react('U_RATE', '555.666');
    await wait(50);
    posted.length = 0;
    failNext = 1; // la 1re photo (#62) ne part pas
    await react('U_RATE', '555.666');
    await wait(300);
    assert.strictEqual(collections.getCount('U_RATE', SPAM_CARDS[0].url), 0);
    assert.strictEqual(collections.getCount('U_RATE', SPAM_CARDS[1].url), 1);
  });

  await test('photos anti-spam dans la liste blanche du proxy d\'images', async () => {
    const cardImages = require(path.join(TMP, 'src', 'cardImages.js'));
    const fileId = cardImages.slackFileId(SPAM_CARDS[0].url);
    // Pas de Slack : la résolution échoue, mais elle est TENTÉE (≠ refus hors liste blanche)
    const tried = [];
    await cardImages.getCardImage({ files: { info: async () => { tried.push(fileId); throw new Error('x'); } } }, fileId, { warn() {}, error() {} });
    assert.deepStrictEqual(tried, [fileId]);
  });

  fs.rmSync(TMP, { recursive: true, force: true });
  origLog(`\n${passed} test(s) OK${process.exitCode ? ' — ❌ ÉCHECS ci-dessus' : ' 🎉'}\n`);
  process.exit(process.exitCode || 0);
})();
