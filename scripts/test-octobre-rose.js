#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test du Booster 🎀 Octobre Rose
//
//  Dans une COPIE temporaire du projet (aucune donnée réelle touchée),
//  avec 8 liens factices et une horloge simulée :
//    • période de vente (1er → 31 octobre, heure de Paris) + 8 liens requis
//    • répartition des 8 cartes (tirages en masse)
//    • chaque carte rose sort avant qu'une autre ne ressorte (même après restart)
//    • stock partagé 2/jour, remis à zéro à minuit Paris
//    • achat Slack : refus hors stock sans débit, bouton « 1/2 aujourd'hui »
//    • classeur (Hors série, OR1 → OR8, hors complétion) + Arène
//
//  Usage : node scripts/test-octobre-rose.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-rose-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

// 🖼️ 8 liens factices dans la copie
const ROSE_PATH = path.join(TMP, 'src', 'octobreRose.js');
let roseSrc = fs.readFileSync(ROSE_PATH, 'utf-8');
let k = 0;
roseSrc = roseSrc.replace(/\{ url: '', name: '' \}/g, () => { k += 1; return `{ url: 'https://slack-files.com/T0TEST-F0ROSE${k}-abc${k}', name: 'Test ${k}' }`; });
fs.writeFileSync(ROSE_PATH, roseSrc);

// ⏰ Horloge simulée (Date.now ET new Date())
const RealDate = Date;
let NOW = RealDate.parse('2026-10-10T08:00:00Z');
global.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(NOW); }
  static now() { return NOW; }
};

process.env.WEB_PUBLIC_URL = '';
process.env.WEB_PORT = '3197';
process.env.TARGET_EMOJI = 'jeanpip';
process.env.SLACK_BOT_TOKEN = 'xoxb-fake';
process.env.SLACK_SIGNING_SECRET = 'fake';
process.env.SLACK_APP_TOKEN = 'xapp-fake';

const posted = [];
const published = [];
const fakeClient = {
  conversations: { open: async () => ({ channel: { id: 'D_TEST' } }) },
  chat: {
    postMessage: async (m) => { posted.push(m); return { ok: true, channel: m.channel, ts: String(1000 + posted.length) }; },
    update: async () => ({ ok: true }),
  },
  auth: { test: async () => ({ user_id: 'B_BOT', user: 'jeanpip' }) },
  views: { publish: async (v) => { published.push(v); return { ok: true }; } },
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

const origLog = console.log;
console.log = () => {};
console.warn = () => {};
const logger = { info() {}, warn() {}, error: (...a) => origLog('ERR', ...a) };
process.on('unhandledRejection', (e) => { origLog('❌ unhandledRejection', e); process.exitCode = 1; });

const check = (ok, msg) => { origLog(`  ${ok ? '✅' : '❌'} ${msg}`); if (!ok) process.exitCode = 1; };
const at = (iso) => { NOW = RealDate.parse(iso); };

(async () => {
  require(path.join(TMP, 'src', 'app.js'));
  await new Promise((r) => setTimeout(r, 300));
  const req = (m) => require(path.join(TMP, 'src', m));
  const boosters = req('boosters.js');
  const octobreRose = req('octobreRose.js');
  const credits = req('credits.js');
  const collections = req('collections.js');
  const { openOnce } = req('openBooster.js');
  const { buildAlbum } = req('album.js');
  const { getCardStats } = req('game/cards.js');
  const find = (name) => actions.find((a) => (a.id instanceof RegExp ? a.id.test(name) : a.id === name)).fn;
  const ack = async () => {};
  const rose = boosters.getBooster('octobre_rose');
  const ROSE_URLS = new Set(octobreRose.ROSE_CARDS.map((c) => c.url));

  origLog('\n🧪 Booster 🎀 Octobre Rose');

  // ── Catalogue & période ──
  check(rose && rose.price === 65 && rose.dailyStock === 2 && rose.slots.length === 8, 'catalogue : 65 crédits, 2/jour, 8 cartes');
  check(rose.slots.every((s) => Object.values(s).reduce((a, b) => a + b, 0) === 100), 'chaque slot totalise 100 %');
  at('2026-09-30T21:59:00Z'); // 23h59 à Paris le 30/09
  check(!boosters.listBoosters().some((b) => b.type === 'octobre_rose'), 'pas en vente le 30 septembre (23h59 Paris)');
  at('2026-09-30T22:00:00Z'); // minuit à Paris le 1/10
  check(boosters.listBoosters().some((b) => b.type === 'octobre_rose'), 'en vente le 1er octobre à minuit (Paris)');
  at('2026-10-31T22:59:00Z'); // 23h59 Paris le 31/10 (heure d'hiver, UTC+1)
  check(boosters.listBoosters().some((b) => b.type === 'octobre_rose'), 'encore en vente le 31 octobre à 23h59 (Paris)');
  at('2026-10-31T23:00:00Z'); // minuit Paris → 1/11
  check(!boosters.listBoosters().some((b) => b.type === 'octobre_rose'), 'plus en vente le 1er novembre');
  check(boosters.purchaseBlock(rose) === 'closed', 'achat hors saison → closed');
  check(boosters.listBoosters().map((b) => b.type).join() === 'common,rare,epic', 'les 3 boosters classiques restent en vente');
  at('2026-10-10T08:00:00Z');

  // ── Répartition (tirages en masse, sans rien persister) ──
  const N = 20000;
  let legendary = 0; let twoRoses = 0; let ok = true;
  const slot45 = { common: 0, rare: 0, epic: 0 };
  for (let i = 0; i < N; i++) {
    const cards = boosters.openBooster('octobre_rose');
    const roses = cards.filter((c) => c.rarity === 'rose');
    if (cards.length !== 8) ok = false;
    if (!cards.slice(0, 3).every((c) => c.rarity === 'common')) ok = false;
    if (cards[7].rarity !== 'rose') ok = false;
    if (roses.length < 1 || roses.length > 2) ok = false;
    if (new Set(roses.map((c) => c.url)).size !== roses.length) ok = false;
    if (cards.slice(0, 5).some((c) => c.rarity === 'rose' || c.rarity === 'legendary')) ok = false;
    for (const c of cards.slice(3, 5)) slot45[c.rarity] += 1;
    if (cards.some((c) => c.rarity === 'legendary')) legendary += 1;
    if (roses.length === 2) twoRoses += 1;
  }
  const pct = (n, d = N) => Math.round((n / d) * 1000) / 10;
  check(ok, '3 communes · carte 8 rose · 1 ou 2 roses différentes · rien de spécial en 1-5');
  check(Math.abs(pct(legendary) - 30) < 1.5, `légendaire dans ${pct(legendary)} % des boosters (visé 30 %)`);
  check(Math.abs(pct(twoRoses) - 30) < 1.5, `2 cartes roses dans ${pct(twoRoses)} % des boosters (visé 30 %)`);
  const s = slot45.common + slot45.rare + slot45.epic;
  check(Math.abs(pct(slot45.rare, s) - 40) < 1.5 && Math.abs(pct(slot45.common, s) - 30) < 1.5 && Math.abs(pct(slot45.epic, s) - 30) < 1.5,
    `cartes 4-5 : ${pct(slot45.rare, s)} % rare · ${pct(slot45.common, s)} % commun · ${pct(slot45.epic, s)} % épique`);

  // ── Chaque carte rose sort avant qu'une autre ne ressorte ──
  const drawn = new Map();
  let balanced = true;
  let allAfter = null;
  for (let i = 0; i < 40; i++) {
    const id = boosters.createPending(`U_R${i}`, 'octobre_rose');
    const r = openOnce(id, `U_R${i}`, 'slack');
    for (const c of r.cards.filter((x) => x.rarity === 'rose')) drawn.set(c.url, (drawn.get(c.url) || 0) + 1);
    const counts = [...ROSE_URLS].map((u) => drawn.get(u) || 0);
    if (Math.max(...counts) - Math.min(...counts) > 1) balanced = false;
    if (allAfter === null && counts.every((n) => n > 0)) allAfter = i + 1;
  }
  check(balanced, 'écart max 1 entre la carte rose la plus et la moins sortie (40 boosters)');
  check(allAfter !== null && allAfter <= 8, `les 8 cartes roses sont toutes sorties après ${allAfter} boosters`);
  check(!boosters.getBooster('common').slots.some((sl) => sl.rose) && !boosters.getBooster('epic').slots.some((sl) => sl.rose), 'aucune carte rose dans les autres boosters');

  // ── Stock partagé 2/jour (les 40 ci-dessus datent du 10/10) ──
  at('2026-10-11T21:30:00Z'); // 23h30 Paris le 11/10
  check(boosters.stockLeft(rose) === 2, 'nouveau jour → stock 2/2');
  check(boosters.buttonLabel(rose) === "🎀 Octobre Rose (65) · 2/2 aujourd'hui", `bouton : « ${boosters.buttonLabel(rose)} »`);

  credits.setBalance('UA', 200);
  credits.setBalance('UB', 200);
  credits.setBalance('UC', 200);
  const buy = (u) => find('buy_booster_octobre_rose')({ ack, body: { user: { id: u } }, action: { value: 'octobre_rose' }, client: fakeClient, logger });
  await buy('UA');
  check(posted.at(-1).text.includes('acheté') && credits.getBalance('UA') === 135, 'UA achète (200 → 135)');
  check(boosters.stockLeft(rose) === 1, 'stock 1/2');
  await buy('UB');
  check(credits.getBalance('UB') === 135 && boosters.stockLeft(rose) === 0, 'UB achète le dernier');
  check(boosters.buttonLabel(rose).endsWith('· épuisé'), 'bouton « épuisé »');
  await buy('UC');
  check(posted.at(-1).text.includes("Plus de Booster") && credits.getBalance('UC') === 200, 'UC refusé : stock épuisé, rien débité');
  check(boosters.countPending('UC') === 0, 'UC n\'a pas de booster');

  at('2026-10-11T22:00:00Z'); // minuit Paris → 12/10
  check(boosters.stockLeft(rose) === 2, 'minuit (Paris) → stock remis à 2');
  await buy('UC');
  check(credits.getBalance('UC') === 135, 'UC achète le lendemain');

  at('2026-11-01T09:00:00Z');
  credits.setBalance('UD', 200);
  await buy('UD');
  check(posted.at(-1).text.includes("n'est plus en vente") && credits.getBalance('UD') === 200, 'vieux bouton cliqué en novembre : refusé, rien débité');
  at('2026-10-12T09:00:00Z');

  // ── Accueil ──
  const home = JSON.stringify(published.at(-1) || {});
  check(home.includes('Octobre Rose (65)'), 'onglet Accueil : bouton Octobre Rose');

  // ── Classeur ──
  const roseCard = octobreRose.ROSE_CARDS[2];
  collections.addCards('U_ALB', [roseCard]);
  const album = buildAlbum('U_ALB');
  const extra = album.sections.find((x) => x.key === 'extra');
  const roseStickers = extra.stickers.filter((st) => st.rarity === 'rose');
  check(roseStickers.length === 8 && roseStickers.map((st) => st.code).join() === 'OR1,OR2,OR3,OR4,OR5,OR6,OR7,OR8', 'classeur : 8 emplacements OR1 → OR8 dans « Hors série »');
  check(roseStickers[2].owned && !roseStickers[0].owned && !roseStickers[0].image, 'carte possédée visible, les autres cachées');
  check(album.stats.owned === 0, 'hors pourcentage de complétion');
  check(extra.stickers.filter((st) => st.link === roseCard.url).length === 1, 'pas de doublon « carte retirée »');

  // ── Arène ──
  const stats = getCardStats(roseCard);
  check(stats.rarity === 'rose', `Arène : carte jouable, rareté rose (archétype ${stats.archetype})`);
  const cardImages = req('cardImages.js');
  check(Boolean(cardImages.findMediaByFileId ? cardImages.findMediaByFileId('F0ROSE3') : true), 'proxy d\'images : carte rose autorisée');

  origLog(process.exitCode ? '\n❌ ÉCHECS ci-dessus\n' : '\n🎉 Booster Octobre Rose OK\n');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* base SQLite encore ouverte (Windows) */ }
  process.exit(process.exitCode || 0);
})();
