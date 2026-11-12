#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test du Booster ⛵ Route du Rhum (v4.3)
//
//  Dans une COPIE temporaire du projet (aucune donnée réelle touchée), avec
//  une horloge simulée :
//    • vente du vendredi 13/11 au vendredi 20/11 (Paris), lundi → vendredi
//    • 80 JP$, 3 boosters par jour pour tout le monde, 1 par personne, qui
//      arrivent à une minute aléatoire entre 9h et 10h
//    • mêmes probabilités qu'Halloween (tirages en masse), 6 cartes qui
//      sortent toutes sur la durée
//    • classeur (Hors série, RR1 → RR6), Arène, proxy d'images, revente
//
//  Usage : node scripts/test-route-du-rhum.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-rr-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

// ⏰ Horloge simulée (Date.now ET new Date())
const RealDate = Date;
let NOW = RealDate.parse('2026-11-13T08:00:00Z'); // vendredi 30/10, 15h à Paris
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
  const rhum = req('routeDuRhum.js');
  const credits = req('credits.js');
  const collections = req('collections.js');
  const resale = req('resale.js');
  const { openOnce } = req('openBooster.js');
  const { buildAlbum } = req('album.js');
  const { getCardStats } = req('game/cards.js');
  const cardIndex = req('cardIndex.js');
  const find = (name) => actions.find((a) => (a.id instanceof RegExp ? a.id.test(name) : a.id === name)).fn;
  const ack = async () => {};
  const rr = boosters.getBooster('route_du_rhum');
  const CARDS = rhum.RHUM_CARDS;
  const onSale = () => boosters.listBoosters().some((b) => b.type === 'route_du_rhum');

  origLog('\n🧪 Booster ⛵ Route du Rhum');

  // ── Catalogue ──
  check(rr && rr.price === 80 && rr.slots.length === 8, 'catalogue : 80 JP$, 8 cartes');
  check(rr.dailyStock === 3 && rr.dailyPerUser === 1 && rr.weekdaysOnly, 'catalogue : 3 par jour pour tout le monde, 1 par personne, du lundi au vendredi');
  check(rr.slots.every((s) => Object.values(s).reduce((a, b) => a + b, 0) === 100), 'chaque slot totalise 100 %');
  const hw = boosters.getBooster('halloween');
  check(JSON.stringify(rr.slots).replace(/rhum/g, 'halloween') === JSON.stringify(hw.slots), 'mêmes probabilités qu\'Halloween');
  check(rhum.isReady() && CARDS.length === 6 && new Set(CARDS.map((c) => c.url)).size === 6, 'les 6 cartes Route du Rhum sont renseignées, toutes différentes');
  check(CARDS[0].title === '⛵ Route du Rhum 1/6' && CARDS.every((c) => c.rarity === 'rhum'), `titre : « ${CARDS[0].title} »`);

  // ── Période de vente (heure d'hiver : Paris = UTC+1) ──
  const paris = (day, min) => `${day}T${String(Math.floor((min - 60) / 60)).padStart(2, '0')}:${String((min - 60) % 60).padStart(2, '0')}:00Z`;
  const drop = (day) => req('octobreRose.js').dropMinute(day);
  at('2026-11-12T12:00:00Z'); // jeudi 12/11 : veille
  check(!onSale() && boosters.purchaseBlock(rr) === 'closed', 'jeudi 12/11 : pas encore de saison');
  check(drop('2026-11-13') >= 540 && drop('2026-11-13') < 600, `vendredi 13/11 : le stock arrive à ${Math.floor(drop('2026-11-13') / 60)}h${String(drop('2026-11-13') % 60).padStart(2, '0')} (entre 9h et 10h)`);
  at(paris('2026-11-13', drop('2026-11-13') - 1));
  check(onSale() && boosters.purchaseBlock(rr) === 'not_yet', "vendredi 13/11 une minute avant l'arrivée : visible mais « pas encore »");
  at(paris('2026-11-13', drop('2026-11-13')));
  check(boosters.purchaseBlock(rr) === null && boosters.stockLeft(rr) === 3, "vendredi 13/11 à l'arrivée : achetable, 3 en stock");
  at('2026-11-14T13:00:00Z'); // samedi
  check(boosters.purchaseBlock(rr) === 'weekend', 'samedi : fermé (pause du week-end)');
  at('2026-11-15T13:00:00Z'); // dimanche
  check(boosters.purchaseBlock(rr) === 'weekend', 'dimanche : fermé aussi');
  at(paris('2026-11-16', drop('2026-11-16')));
  check(boosters.purchaseBlock(rr) === null, 'lundi 16/11 : de nouveau en vente');
  at(paris('2026-11-20', 18 * 60));
  check(onSale() && boosters.stockLeft(rr) === 3, 'vendredi 20/11 : dernier jour de vente');
  check(boosters.comeBackDay(rr) === null && /dernier jour/.test(boosters.restockText(Date.now(), rr)), 'vendredi 20/11 : « dernier jour », pas de promesse de retour');
  at('2026-11-21T09:00:00Z'); // samedi 21
  check(!onSale() && boosters.purchaseBlock(rr) === 'closed', 'samedi 21/11 : terminé');
  at('2026-11-23T09:00:00Z'); // lundi 23
  check(!onSale(), 'lundi 23/11 : terminé');
  at(paris('2026-11-17', drop('2026-11-17') + 1));
  check(boosters.buttonLabel(rr) === "⛵ Route du Rhum (80) · 3/3 aujourd'hui", `bouton : « ${boosters.buttonLabel(rr)} »`);
  check(boosters.listBoosters().map((b) => b.type).join() === 'common,rare,epic,route_du_rhum', 'en saison : les 3 classiques + Route du Rhum');
  at('2026-11-12T12:00:00Z');
  check(boosters.listBoosters().map((b) => b.type).join() === 'common,rare,epic', 'hors saison : seuls les 3 classiques sont en vente');

  // ── Répartition (tirages en masse, rien de persisté) ──
  at('2026-11-17T09:00:00Z'); // mardi 10h Paris
  const N = 20000;
  let legendary = 0; let two = 0; let ok = true;
  for (let i = 0; i < N; i++) {
    const cards = boosters.openBooster('route_du_rhum');
    const rs = cards.filter((c) => c.rarity === 'rhum');
    if (cards.length !== 8) ok = false;
    if (!cards.slice(0, 3).every((c) => c.rarity === 'common')) ok = false;
    if (cards[7].rarity !== 'rhum') ok = false;
    if (rs.length < 1 || rs.length > 2) ok = false;
    if (new Set(rs.map((c) => c.url)).size !== rs.length) ok = false;
    if (cards.slice(0, 5).some((c) => c.rarity === 'rhum' || c.rarity === 'legendary')) ok = false;
    if (cards.some((c) => c.rarity === 'legendary')) legendary += 1;
    if (rs.length === 2) two += 1;
  }
  const pct = (n) => Math.round((n / N) * 1000) / 10;
  check(ok, '3 communes · carte 8 Route du Rhum · 1 ou 2 différentes · rien de spécial en 1-5');
  check(Math.abs(pct(legendary) - 30) < 1.5, `légendaire dans ${pct(legendary)} % des boosters (visé 30 %)`);
  check(Math.abs(pct(two) - 30) < 1.5, `2 cartes Route du Rhum dans ${pct(two)} % des boosters (visé 30 %)`);
  check(!['common', 'rare', 'epic', 'octobre_rose', 'halloween'].some((t) => boosters.getBooster(t).slots.some((sl) => sl.rhum)), 'aucune carte Route du Rhum dans les autres boosters');

  // ── Chaque carte sort avant qu'une autre ne ressorte (18 boosters = 6 jours de vente × 3) ──
  const drawn = new Map();
  let balanced = true;
  for (let i = 0; i < 18; i++) {
    const id = boosters.createPending(`U_R${i}`, 'route_du_rhum');
    const r = openOnce(id, `U_R${i}`, 'slack');
    for (const c of r.cards.filter((x) => x.rarity === 'rhum')) drawn.set(c.url, (drawn.get(c.url) || 0) + 1);
    const counts = CARDS.map((c) => drawn.get(c.url) || 0);
    if (Math.max(...counts) - Math.min(...counts) > 1) balanced = false;
  }
  check(balanced && drawn.size === 6, 'écart max 1 entre la carte la plus et la moins sortie (18 boosters = toute la saison)');

  // ── Achat Slack : 1 par personne, 3 par jour pour tout le monde ──
  at(paris('2026-11-19', drop('2026-11-19') + 5));
  for (const u of ['UA', 'UB', 'UC', 'UD']) credits.setBalance(u, 500);
  const buy = (u) => find('buy_booster_route_du_rhum')({ ack, body: { user: { id: u }, view: { type: 'home' } }, action: { value: 'route_du_rhum' }, client: fakeClient, logger });
  await buy('UA'); NOW += 5000;
  check(boosters.countPending('UA') === 1 && credits.getBalance('UA') === 420, 'UA achète son booster (500 → 420)');
  await buy('UA'); NOW += 5000;
  check(boosters.countPending('UA') === 1 && credits.getBalance('UA') === 420 && boosters.purchaseBlock(rr, Date.now(), 'UA') === 'user_limit', 'UA ne peut pas en prendre un 2e (1 par personne), rien débité');
  await buy('UB'); NOW += 5000;
  await buy('UC'); NOW += 5000;
  check(boosters.stockLeft(rr) === 0 && boosters.purchaseBlock(rr, Date.now(), 'UD') === 'sold_out', 'UB et UC achètent : plus de stock (3/3 vendus), UD voit « épuisé »');
  await buy('UD');
  check(credits.getBalance('UD') === 500 && boosters.countPending('UD') === 0, 'UD refusé : rien débité');
  at(paris('2026-11-20', drop('2026-11-20') + 1));
  check(boosters.stockLeft(rr) === 3 && boosters.purchaseBlock(rr, Date.now(), 'UA') === null, 'le lendemain : stock remis à 3, UA peut de nouveau en prendre un');
  at('2026-11-14T13:00:00Z');
  const bal = credits.getBalance('UA');
  await buy('UA');
  check(credits.getBalance('UA') === bal, 'samedi : achat refusé, rien débité');

  // ── Accueil ──
  at(paris('2026-11-18', drop('2026-11-18') + 1));
  const homeArgs = { isAdmin: false, attackPrice: 30, creditsPerJeanpipLabel: '1', targetEmoji: 'jeanpip', farmRemainingMs: 0, farmQuota: { used: 0, max: 20, nextFreeMs: 0 }, formatRemaining: String };
  const home = JSON.stringify(req('home.js').buildHomeView('U_HOME', homeArgs));
  check(home.includes('buy_booster_route_du_rhum') && /Route du Rhum \(80\)/.test(home), 'Accueil : bouton « ⛵ Route du Rhum (80) »');
  check(/Seulement \*3 par jour/.test(home) && /1 par personne/.test(home) && /du lundi au vendredi/.test(home), 'Accueil : « 3 par jour, 1 par personne, du lundi au vendredi »');
  at(paris('2026-11-18', drop('2026-11-18') - 1));
  const homeEarly = JSON.stringify(req('home.js').buildHomeView('U_HOME', homeArgs));
  check(/entre 9h et 10h/.test(homeEarly) && !homeEarly.includes('buy_booster_route_du_rhum'), "Accueil avant l'arrivée : « entre 9h et 10h », pas de bouton");

  // ── Classeur, index des cartes ──
  const card2 = CARDS[1];
  collections.addCards('U_ALB', [card2]);
  const album = buildAlbum('U_ALB');
  const extra = album.sections.find((x) => x.key === 'extra');
  const stickers = extra.stickers.filter((st) => st.rarity === 'rhum');
  check(stickers.length === 6 && stickers.map((st) => st.code).join() === 'RR1,RR2,RR3,RR4,RR5,RR6', 'classeur : 6 emplacements RR1 → RR6 dans « Hors série »');
  check(stickers[1].owned && !stickers[0].owned && !stickers[0].image, 'carte possédée visible, les autres cachées');
  check(extra.stickers.filter((st) => st.link === card2.url).length === 1, 'pas de doublon « carte retirée »');
  const idx = cardIndex.listCards().filter((c) => c.rarity === 'rhum');
  check(idx.map((c) => c.code).join() === 'RR1,RR2,RR3,RR4,RR5,RR6', 'index des cartes (échanges) : RR1 → RR6');

  // ── Arène, proxy d'images, revente ──
  const stats = getCardStats(card2);
  check(stats.rarity === 'rhum', `Arène : carte jouable, rareté rhum (archétype ${stats.archetype})`);
  check(req('game/cards.js').RARITY_MODS.rhum.mult === req('game/cards.js').RARITY_MODS.epic.mult, 'Arène : puissance d\'une épique');
  const cardImages = req('cardImages.js');
  check(CARDS.every((c) => cardImages.findMediaByFileId(cardImages.slackFileId(c.url))), 'proxy d\'images : les 6 cartes autorisées');
  check(resale.PRICES.rhum === 30 && resale.RARITY_ORDER.includes('rhum') && resale.LABELS.rhum, 'revente : 30 JP$ l\'exemplaire en double, rareté listée');
  check(req('media.js').getRarityInfo('rhum').emoji === '⛵', 'rareté « rhum » reconnue (emoji ⛵)');

  origLog(process.exitCode ? '\n❌ ÉCHECS ci-dessus\n' : '\n🎉 Booster Route du Rhum OK\n');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* base SQLite encore ouverte (Windows) */ }
  process.exit(process.exitCode || 0);
})();
