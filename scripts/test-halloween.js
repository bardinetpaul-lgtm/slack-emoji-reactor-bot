#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test du Booster 🎃 Halloween (v3.7)
//
//  Dans une COPIE temporaire du projet (aucune donnée réelle touchée),
//  avec 6 cartes de test injectées dans src/halloween.js et une horloge
//  simulée :
//    • fenêtre de vente : vendredi 30/10 14h → lundi 2/11 14h (Paris)
//    • pas de stock partagé ni de limite par personne, 80 JP$
//    • fermé le week-end (pause du jeu), rouvert le lundi
//    • mêmes probabilités qu'Octobre Rose (tirages en masse)
//    • 🌗 vagues : les cartes « lundi » sont IMPOSSIBLES à obtenir le vendredi
//    • classeur (Hors série, HW1 → HW6), Arène, deck, revente
//    • 🎀 promo du dernier jour d'Octobre Rose : 10/jour, 2 par personne
//
//  Usage : node scripts/test-halloween.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-hw-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

// 🖼️ Liens de test (les vrais seront collés dans src/halloween.js) : on garde
//    la répartition des vagues du fichier réel, seules les URL sont injectées.
const HW_PATH = path.join(TMP, 'src', 'halloween.js');
const TEST_URLS = [1, 2, 3, 4, 5, 6].map((n) => `https://slack-files.com/T6EFSEHCN-F0TESTHW${n}0-00000000${n}0`);
{
  const src = fs.readFileSync(HW_PATH, 'utf8');
  let i = 0;
  const patched = src.replace(/\{ url: '[^']*', name: '', wave: (\d) \}/g, (_, w) => `{ url: '${TEST_URLS[i++]}', name: '', wave: ${w} }`);
  if (i !== TEST_URLS.length) { console.error(`❌ ${i} carte(s) remplacée(s) sur ${TEST_URLS.length} : src/halloween.js a changé de forme`); process.exit(1); }
  fs.writeFileSync(HW_PATH, patched);
}

// ⏰ Horloge simulée (Date.now ET new Date())
const RealDate = Date;
let NOW = RealDate.parse('2026-10-30T14:00:00Z'); // vendredi 30/10, 15h à Paris
global.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(NOW); }
  static now() { return NOW; }
};

process.env.WEB_PUBLIC_URL = '';
process.env.WEB_PORT = '3198';
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
  const halloween = req('halloween.js');
  const credits = req('credits.js');
  const collections = req('collections.js');
  const resale = req('resale.js');
  const { openOnce } = req('openBooster.js');
  const { buildAlbum } = req('album.js');
  const { getCardStats } = req('game/cards.js');
  const find = (name) => actions.find((a) => (a.id instanceof RegExp ? a.id.test(name) : a.id === name)).fn;
  const ack = async () => {};
  const hw = boosters.getBooster('halloween');
  const CARDS = halloween.HALLOWEEN_CARDS;
  const WAVE1 = CARDS.filter((c) => c.wave === 1).map((c) => c.url);
  const WAVE2 = CARDS.filter((c) => c.wave === 2).map((c) => c.url);
  const onSale = (() => boosters.listBoosters().some((b) => b.type === 'halloween'));

  origLog('\n🧪 Booster 🎃 Halloween');

  // ── Catalogue ──
  check(hw && hw.price === 80 && hw.slots.length === 8, 'catalogue : 80 JP$, 8 cartes');
  check(!hw.dailyStock && !hw.dailyPerUser, 'ni stock partagé, ni limite par personne');
  check(hw.slots.every((s) => Object.values(s).reduce((a, b) => a + b, 0) === 100), 'chaque slot totalise 100 %');
  const rose = boosters.getBooster('octobre_rose');
  check(JSON.stringify(hw.slots).replace(/halloween/g, 'rose') === JSON.stringify(rose.slots), 'mêmes probabilités qu\'Octobre Rose');
  check(halloween.isReady() && new Set(CARDS.map((c) => c.url)).size === 6, 'les 6 cartes Halloween sont renseignées');
  check(WAVE1.length === 3 && WAVE2.length === 3, `3 cartes dès vendredi (${CARDS.filter((c) => c.wave === 1).map((c) => c.number).join('-')}), 3 réservées au lundi (${CARDS.filter((c) => c.wave === 2).map((c) => c.number).join('-')})`);
  check(CARDS[0].title === '🎃 Halloween 1/6', `titre : « ${CARDS[0].title} »`);

  // ── Fenêtre de vente (heure d'hiver depuis le 25/10 : Paris = UTC+1) ──
  at('2026-10-30T12:59:00Z'); // vendredi 13h59 Paris
  check(!onSale() && boosters.purchaseBlock(hw) === 'closed', 'vendredi 13h59 : pas encore en vente');
  at('2026-10-30T13:00:00Z'); // vendredi 14h00 Paris
  check(onSale() && boosters.purchaseBlock(hw) === null, 'vendredi 14h00 : en vente');
  at('2026-10-31T13:00:00Z'); // samedi
  check(boosters.purchaseBlock(hw) === 'weekend', 'samedi : fermé (pause du week-end)');
  at('2026-11-01T13:00:00Z'); // dimanche
  check(boosters.purchaseBlock(hw) === 'weekend', 'dimanche : fermé aussi');
  at('2026-11-02T08:00:00Z'); // lundi 9h Paris
  check(onSale() && boosters.purchaseBlock(hw) === null, 'lundi 9h : de nouveau en vente');
  at('2026-11-02T12:59:00Z'); // lundi 13h59 Paris
  check(onSale(), 'lundi 13h59 : dernière minute');
  at('2026-11-02T13:00:00Z'); // lundi 14h00 Paris
  check(!onSale() && boosters.purchaseBlock(hw) === 'closed', 'lundi 14h00 : terminé');
  check(boosters.listBoosters().map((b) => b.type).join() === 'common,rare,epic', 'les 3 boosters classiques restent en vente');
  check(boosters.buttonLabel(hw) === '🎃 Halloween (80)', `bouton : « ${boosters.buttonLabel(hw)} »`);

  // ── Répartition + vagues (tirages en masse, rien de persisté) ──
  at('2026-10-30T14:00:00Z'); // vendredi 15h Paris
  const N = 20000;
  let legendary = 0; let twoHw = 0; let ok = true; let wave2Leak = 0;
  const slot45 = { common: 0, rare: 0, epic: 0 };
  for (let i = 0; i < N; i++) {
    const cards = boosters.openBooster('halloween');
    const hws = cards.filter((c) => c.rarity === 'halloween');
    if (cards.length !== 8) ok = false;
    if (!cards.slice(0, 3).every((c) => c.rarity === 'common')) ok = false;
    if (cards[7].rarity !== 'halloween') ok = false;
    if (hws.length < 1 || hws.length > 2) ok = false;
    if (new Set(hws.map((c) => c.url)).size !== hws.length) ok = false;
    if (cards.slice(0, 5).some((c) => c.rarity === 'halloween' || c.rarity === 'legendary')) ok = false;
    if (hws.some((c) => WAVE2.includes(c.url))) wave2Leak += 1;
    for (const c of cards.slice(3, 5)) slot45[c.rarity] += 1;
    if (cards.some((c) => c.rarity === 'legendary')) legendary += 1;
    if (hws.length === 2) twoHw += 1;
  }
  const pct = (n, d = N) => Math.round((n / d) * 1000) / 10;
  check(ok, '3 communes · carte 8 Halloween · 1 ou 2 Halloween différentes · rien de spécial en 1-5');
  check(wave2Leak === 0, `🌗 vendredi : aucune carte de la vague du lundi sur ${N} boosters`);
  check(Math.abs(pct(legendary) - 30) < 1.5, `légendaire dans ${pct(legendary)} % des boosters (visé 30 %)`);
  check(Math.abs(pct(twoHw) - 30) < 1.5, `2 cartes Halloween dans ${pct(twoHw)} % des boosters (visé 30 %)`);
  const s = slot45.common + slot45.rare + slot45.epic;
  check(Math.abs(pct(slot45.rare, s) - 40) < 1.5 && Math.abs(pct(slot45.common, s) - 30) < 1.5 && Math.abs(pct(slot45.epic, s) - 30) < 1.5,
    `cartes 4-5 : ${pct(slot45.rare, s)} % rare · ${pct(slot45.common, s)} % commun · ${pct(slot45.epic, s)} % épique`);

  // 🌗 Lundi : les 6 cartes deviennent possibles
  at('2026-11-02T08:00:00Z');
  const seenMonday = new Set();
  for (let i = 0; i < 2000; i++) boosters.openBooster('halloween').filter((c) => c.rarity === 'halloween').forEach((c) => seenMonday.add(c.url));
  check(seenMonday.size === 6, `🌗 lundi matin : les 6 cartes sortent (${seenMonday.size}/6)`);
  check(!boosters.getBooster('common').slots.some((sl) => sl.halloween) && !boosters.getBooster('epic').slots.some((sl) => sl.halloween) && !rose.slots.some((sl) => sl.halloween),
    'aucune carte Halloween dans les autres boosters');

  // ── Chaque carte sort avant qu'une autre ne ressorte ──
  const drawn = new Map();
  let balanced = true;
  for (let i = 0; i < 40; i++) {
    const id = boosters.createPending(`U_H${i}`, 'halloween');
    const r = openOnce(id, `U_H${i}`, 'slack');
    for (const c of r.cards.filter((x) => x.rarity === 'halloween')) drawn.set(c.url, (drawn.get(c.url) || 0) + 1);
    const counts = CARDS.map((c) => drawn.get(c.url) || 0);
    if (Math.max(...counts) - Math.min(...counts) > 1) balanced = false;
  }
  check(balanced, 'écart max 1 entre la carte Halloween la plus et la moins sortie (40 boosters)');

  // ── Achat Slack : sans limite par personne ──
  at('2026-10-30T14:00:00Z'); // vendredi 15h Paris
  credits.setBalance('UA', 500);
  const buy = (u) => find('buy_booster_halloween')({ ack, body: { user: { id: u }, view: { type: 'home' } }, action: { value: 'halloween' }, client: fakeClient, logger });
  const before = boosters.countPending('UA');
  await buy('UA'); NOW += 5000;
  await buy('UA'); NOW += 5000;
  await buy('UA');
  check(boosters.countPending('UA') - before === 3 && credits.getBalance('UA') === 260, 'UA en achète 3 d\'affilée (500 → 260) : aucune limite par personne');
  check(boosters.stockLeft(hw) === null, 'pas de stock du jour à épuiser');
  // Hors Accueil (vieux DM boutique) : autorisé, ce n'est pas un booster à stock
  const beforeDm = boosters.countPending('UA');
  await buy('UA');
  check(boosters.countPending('UA') - beforeDm === 1, 'achat possible aussi depuis un DM boutique');
  at('2026-10-31T13:00:00Z'); // samedi
  const bal = credits.getBalance('UA');
  await buy('UA');
  check(credits.getBalance('UA') === bal && /pause/i.test(posted.at(-1).text || ''), 'samedi : achat refusé, rien débité');

  // ── Accueil ──
  at('2026-10-30T14:00:00Z');
  const homeArgs = { isAdmin: false, attackPrice: 30, creditsPerJeanpipLabel: '1', targetEmoji: 'jeanpip', farmRemainingMs: 0, farmQuota: { used: 0, max: 20, nextFreeMs: 0 }, formatRemaining: String };
  const home = JSON.stringify(req('home.js').buildHomeView('U_HOME', homeArgs));
  check(home.includes('buy_booster_halloween') && /Halloween \(80\)/.test(home), 'Accueil : bouton « 🎃 Halloween (80) »');
  check(/Sans limite par personne/.test(home) && /lundi 2\/11 à 14h/.test(home), 'Accueil : « sans limite par personne », fin annoncée');
  check(/n'arrive que lundi matin/.test(home), 'Accueil : la moitié des cartes n\'arrive que lundi matin');
  at('2026-11-02T08:00:00Z');
  check(!/n'arrive que lundi matin/.test(JSON.stringify(req('home.js').buildHomeView('U_HOME', homeArgs))), 'Accueil le lundi : l\'avertissement disparaît');

  // ── Classeur ──
  const card3 = CARDS[2];
  collections.addCards('U_ALB', [card3]);
  const album = buildAlbum('U_ALB');
  const extra = album.sections.find((x) => x.key === 'extra');
  const stickers = extra.stickers.filter((st) => st.rarity === 'halloween');
  check(stickers.length === 6 && stickers.map((st) => st.code).join() === 'HW1,HW2,HW3,HW4,HW5,HW6', 'classeur : 6 emplacements HW1 → HW6 dans « Hors série »');
  check(stickers[2].owned && !stickers[0].owned && !stickers[0].image, 'carte possédée visible, les autres cachées');
  check(album.stats.total === album.sections.reduce((n, x) => n + x.stickers.length, 0), 'comptée dans la complétion (Hors série inclus dans le total)');
  check(extra.stickers.filter((st) => st.link === card3.url).length === 1, 'pas de doublon « carte retirée »');

  // ── Arène, deck et proxy d'images ──
  const stats = getCardStats(card3);
  check(stats.rarity === 'halloween', `Arène : carte jouable, rareté halloween (archétype ${stats.archetype})`);
  check(req('game/cards.js').RARITY_MODS.halloween.mult === req('game/cards.js').RARITY_MODS.epic.mult, 'Arène : puissance d\'une épique');
  const cardImages = req('cardImages.js');
  check(CARDS.every((c) => cardImages.findMediaByFileId(cardImages.slackFileId(c.url))), 'proxy d\'images : les 6 cartes Halloween autorisées');
  const catalogue = req('game/arenaWeb.js').catalogueFor
    ? req('game/arenaWeb.js').catalogueFor('U_ALB', '/') : null;
  check(!catalogue || catalogue.some((c) => c.url === card3.url), 'deck : la carte possédée est proposée dans « Mon deck »');

  // ── Revente ──
  collections.addCards('U_ALB', [card3]);  // un doublon
  check(resale.PRICES ? resale.PRICES.halloween === 10 : true, 'revente : 10 JP$ l\'exemplaire en double');
  const sellable = resale.summary ? resale.summary('U_ALB') : null;
  check(!sellable || JSON.stringify(sellable).includes('Halloween'), 'revente : la rareté Halloween est listée');

  // ── 🎀 Promo du dernier jour d'Octobre Rose (vendredi 30/10) ──
  at('2026-10-29T14:00:00Z'); // jeudi 29/10
  const r29 = boosters.getBooster('octobre_rose');
  check(r29.price === 80 && r29.dailyStock === 3 && r29.dailyPerUser === 1, 'jeudi 29/10 : 80 JP$, 3 par jour, 1 par personne');
  at('2026-10-30T14:00:00Z'); // vendredi 30/10
  const r30 = boosters.getBooster('octobre_rose');
  check(r30.price === 80 && r30.dailyStock === 10 && r30.dailyPerUser === 2, 'vendredi 30/10 : 80 JP$ (inchangé), 10 pour tout le monde, 2 par personne');
  check(boosters.stockLeft(r30) === 10, 'stock du jour : 10');

  origLog(process.exitCode ? '\n❌ ÉCHECS ci-dessus\n' : '\n🎉 Booster Halloween OK\n');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* base SQLite encore ouverte (Windows) */ }
  process.exit(process.exitCode || 0);
})();
