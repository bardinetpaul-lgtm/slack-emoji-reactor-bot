#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test v3.4 « Le Raid » (src/raid.js + src/app.js avec un faux Slack)
//
//  Dans une COPIE temporaire du projet (aucune donnée réelle touchée),
//  avec une horloge simulée (mardi 20/10, heure de Paris) :
//    • pierre-feuille-ciseaux : 9 combinaisons + pas de réponse
//    • horaires (9h → 17h40 en semaine), prix (50 JP$ ou gratuit, +10/cible)
//    • butin : doublon d'abord, jamais légendaire / hors série
//    • modale : cibles refusées, solde insuffisant, style manquant
//    • lancement : débit, alertes en DM avec 3 boutons, Accueil
//    • défense : un clic, définitif, AUCUN résultat avant la fin
//    • fin du raid : dès que tout le monde a répondu, ou au bout de 20 min
//    • cartes échangées, résultats en DM à tous, événements en base
//    • garde-fous : 1 raid à la fois par cible, 2 raids subis par jour
//
//  Usage : node scripts/test-raid.js   (~30 s : attend le contrôle des 10 s)
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-raid-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

// ⏰ Horloge simulée : mardi 20/10 à 10h (Paris, UTC+2)
const RealDate = Date;
let NOW = RealDate.parse('2026-10-20T08:00:00Z');
global.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(NOW); }
  static now() { return NOW; }
};
const at = (iso) => { NOW = RealDate.parse(iso); };
const MIN = 60 * 1000;

process.env.WEB_PUBLIC_URL = '';
process.env.WEB_PORT = '3194';
process.env.TARGET_EMOJI = 'jeanpip';
process.env.SLACK_BOT_TOKEN = 'xoxb-fake';
process.env.SLACK_SIGNING_SECRET = 'fake';
process.env.SLACK_APP_TOKEN = 'xapp-fake';

const posted = [];
const updated = [];
const opened = [];
const fakeClient = {
  conversations: { open: async ({ users }) => ({ channel: { id: `D_${users}` } }) },
  chat: {
    postMessage: async (m) => { posted.push(m); return { ok: true, channel: m.channel, ts: String(1000 + posted.length) }; },
    postEphemeral: async () => ({ ok: true }),
    update: async (m) => { updated.push(m); return { ok: true }; },
  },
  users: { info: async ({ user }) => ({ user: { id: user, is_bot: user === 'UBOT', real_name: `Nom ${user}`, name: user } }) },
  auth: { test: async () => ({ user_id: 'B_BOT', user: 'jeanpip' }) },
  views: { publish: async () => ({ ok: true }), open: async (v) => { opened.push(v); return { ok: true }; } },
  files: { info: async () => { throw new Error('fake'); } },
};
const actions = [];
const views = [];
const commands = [];
class FakeApp {
  constructor() { this.client = fakeClient; }
  message() {} error() {} event() {}
  command(id, fn) { commands.push({ id, fn }); }
  view(id, fn) { views.push({ id, fn }); }
  action(id, fn) { actions.push({ id, fn }); }
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
console.info = () => {};
console.warn = () => {};
const logger = { info() {}, warn() {}, error: (...a) => origLog('ERR', ...a) };
process.on('unhandledRejection', (e) => { origLog('❌ unhandledRejection', e); process.exitCode = 1; });

const check = (ok, msg) => { origLog(`  ${ok ? '✅' : '❌'} ${msg}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dmsTo = (u) => posted.filter((m) => m.channel === `D_${u}`);
const flat = (x) => JSON.stringify(x);
const card = (key, rarity) => ({ url: `https://example.test/${key}`, title: `Carte ${key}`, rarity, type: 'image' });

(async () => {
  require(path.join(TMP, 'src', 'app.js'));
  await wait(300);
  const req = (m) => require(path.join(TMP, 'src', m));
  const raid = req('raid.js');
  const credits = req('credits.js');
  const scores = req('scores.js');
  const broadcast = req('broadcast.js');
  const collections = req('collections.js');
  const home = req('home.js');
  const db = req('db.js').getDb();
  const find = (list, name) => list.find((a) => (a.id instanceof RegExp ? a.id.test(name) : a.id === name)).fn;
  const ack = async () => {};
  const homeOf = (u) => flat(home.buildHomeView(u, { isAdmin: false, creditsPerJeanpipLabel: '0,5', targetEmoji: 'jeanpip', farmRemainingMs: 0, farmQuota: { used: 0, max: 10, nextFreeMs: 0 }, formatRemaining: String }));
  const submit = async (user, targets, style) => {
    let response = null;
    await find(views, 'raid_submit')({
      ack: async (r) => { response = r || null; },
      body: { user: { id: user } },
      view: { state: { values: { targets: { value: { selected_users: targets } }, style: { value: { selected_option: style ? { value: style } : null } } } } },
      client: fakeClient, logger,
    });
    return response;
  };
  const defend = (user, raidId, defense, { inDm = true } = {}) => find(actions, `raid_defend_${defense}`)({
    ack, action: { action_id: `raid_defend_${defense}`, value: raidId },
    body: { user: { id: user }, ...(inDm ? { channel: { id: `D_${user}` }, message: { ts: 'alert' } } : {}) },
    client: fakeClient, logger,
  });

  origLog('\n🧪 v3.4 — Le Raid');

  // ── Pierre-feuille-ciseaux ──
  const table = {
    bouclier: { assaut: 'riposte', ruse: 'repousse', embuscade: 'tombe' },
    piege: { assaut: 'tombe', ruse: 'riposte', embuscade: 'repousse' },
    esquive: { assaut: 'repousse', ruse: 'tombe', embuscade: 'riposte' },
  };
  check(Object.entries(table).every(([d, row]) => Object.entries(row).every(([s, o]) => raid.outcome(d, s) === o)), 'les 9 combinaisons : chaque défense bat un style, tient contre un autre, cède au dernier');
  check(['assaut', 'ruse', 'embuscade'].every((s) => raid.outcome(null, s) === 'tombe'), 'pas de réponse = tombe');

  // ── Horaires et prix ──
  const tue = (h, m) => RealDate.parse(`2026-10-20T${String(h - 2).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  check(raid.launchBlock(tue(8, 59)) === 'hours' && raid.launchBlock(tue(9, 0)) === null, 'mardi 8h59 : fermé · 9h00 : ouvert');
  check(raid.launchBlock(tue(17, 39)) === null && raid.launchBlock(tue(17, 40)) === 'hours', '17h39 : ouvert · 17h40 : fermé (tout fini à 18h)');
  check(raid.launchBlock(RealDate.parse('2026-10-24T09:00:00Z')) === 'weekend', 'samedi : pas de raid');
  check(raid.cost(5) === 50 && raid.cost(7) === 70 && raid.cost(10) === 100 && raid.cost(5, true) === 0 && raid.cost(7, true) === 20, 'prix : 50 JP$ pour 5 cibles, +10 par cible en plus ; gratuit = seulement les cibles en plus');
  check(scores.ATTACK_THRESHOLD === 65, 'raid gratuit à 65 Jeanpips dans la semaine (v3.6)');

  // ── Butin ──
  collections.addCards('LOOT1', [card('leg', 'legendary'), card('leg', 'legendary'), card('rose', 'rose'), card('rose', 'rose'), card('spam', 'spam'), card('spam', 'spam'), card('u1', 'common'), card('d1', 'rare'), card('d1', 'rare')]);
  check([...Array(30)].every(() => raid.pickLoot('LOOT1').url.endsWith('/d1')), 'butin : toujours un doublon s\'il y en a (jamais légendaire, Octobre Rose ni anti-spam, même en double)');
  collections.addCards('LOOT2', [card('leg', 'legendary'), card('u1', 'common'), card('u2', 'epic')]);
  check([...Array(30)].every(() => { const url = raid.pickLoot('LOOT2').url; return url.endsWith('/u1') || url.endsWith('/u2'); }), 'sans doublon : une carte unique non légendaire');
  collections.addCards('LOOT3', [card('leg', 'legendary'), card('leg', 'legendary')]);
  check(raid.pickLoot('LOOT3') === null && raid.pickLoot('NOBODY') === null, 'que des légendaires (ou rien) : rien à prendre');

  // ── Mise en place ──
  for (const u of ['UA', 'UB', 'UC', 'UD', 'UE', 'UF', 'UG', 'UH', 'UI', 'UJ']) broadcast.subscribe(u);
  credits.setBalance('UA', 200);
  credits.setBalance('UE', 200);
  credits.setBalance('UP', 60);
  broadcast.subscribe('UP');
  collections.addCards('UA', [card('a', 'common'), card('a', 'common')]);
  collections.addCards('UB', [card('x', 'common'), card('x', 'common'), card('x', 'common'), card('legB', 'legendary')]);
  collections.addCards('UC', [card('legC', 'legendary')]);
  collections.addCards('UD', [card('r', 'rare')]);

  // ── Accueil et modale ──
  let h = homeOf('UA');
  check(h.includes('⚔️ Lancer un raid (50 JP$)') && h.includes('home_attack_open') && h.includes('encore 65 pour un raid gratuit'), 'Accueil : « ⚔️ Lancer un raid (50 JP$) », encore 65 Jeanpips pour un raid gratuit');
  await find(actions, 'home_attack_open')({ ack, body: { user: { id: 'UA' }, trigger_id: 'T1' }, client: fakeClient, logger });
  check(opened.at(-1).view.callback_id === 'raid_submit' && flat(opened.at(-1).view).includes('multi_users_select') && flat(opened.at(-1).view).includes('radio_buttons'), 'bouton ⚔️ : modale avec cibles (jusqu\'à 10) et style secret');
  await find(commands, '/jeanpip-attack')({ ack, command: { user_id: 'UA', trigger_id: 'T2' }, client: fakeClient, logger });
  check(opened.at(-1).view.callback_id === 'raid_submit', '/jeanpip-attack ouvre la même modale');
  at('2026-10-20T15:45:00Z');   // 17h45
  check(!homeOf('UA').includes('home_attack_open') && homeOf('UA').includes('de 9h à 17h40'), '17h45 : plus de bouton, « en semaine, de 9h à 17h40 »');
  check(!home.buildRaidModal('UA').callback_id && flat(home.buildRaidModal('UA')).includes('17h40'), '17h45 : la modale devient un simple message');
  check((await submit('UA', ['UB'], 'ruse')).errors.targets.includes('17h40'), '17h45 : une modale restée ouverte est refusée');
  at('2026-10-20T08:00:00Z');   // 10h

  // ── Modale : refus ──
  check((await submit('UA', ['UB'], null)).errors.style, 'pas de style choisi : erreur');
  const refusedSelf = await submit('UA', ['UA', 'UBOT', 'UZ'], 'ruse');
  check(/Nom UA \(toi-même\)/.test(refusedSelf.errors.targets) && /Nom UBOT \(un bot\)/.test(refusedSelf.errors.targets) && /Nom UZ \(pas inscrit/.test(refusedSelf.errors.targets), 'cibles refusées et nommées : soi-même, un bot, un non-inscrit');
  check(/Il te faut 70 JP\$/.test((await submit('UP', ['UB', 'UC', 'UD', 'UE', 'UF', 'UG', 'UH'], 'ruse')).errors.targets) && credits.getBalance('UP') === 60, '7 cibles avec 60 JP$ : « il te faut 70 JP$ », rien débité');

  // ── Lancement ──
  const before = posted.length;
  req('farm.js').record('UD', 0);   // 🚜 UD en pénalité anti-farm : raidable quand même (v3.6)
  check(req('farm.js').getPenaltyRemaining('UD') > 0, 'UD est en pénalité anti-farm');
  check(await submit('UA', ['UB', 'UC', 'UD'], 'ruse') === null, 'UA lance un raid en 🦊 Ruse sur UB, UC et UD (UD en pénalité anti-farm : accepté, v3.6)');
  const r1 = raid.activeRaidOf('UA');
  check(r1 && credits.getBalance('UA') === 150 && r1.price === 50, '50 JP$ débités (200 → 150)');
  const alerts = posted.slice(before).filter((m) => ['D_UB', 'D_UC', 'D_UD'].includes(m.channel));
  check(alerts.length === 3 && alerts.every((m) => /RAID EN COURS/.test(flat(m)) && ['bouclier', 'piege', 'esquive'].every((d) => flat(m).includes(`raid_defend_${d}`))), 'alerte en DM aux 3 cibles, avec les 3 boutons de défense');
  check(!alerts.some((m) => flat(m).includes('Ruse*') || /attaque en 🦊/.test(flat(m))), 'l\'alerte ne trahit pas le style choisi');
  check(/Raid lancé/.test(flat(dmsTo('UA').at(-1))) && /50 JP\$ débités/.test(flat(dmsTo('UA').at(-1))), 'DM de confirmation à UA');
  check(homeOf('UA').includes('Ton raid est en cours') && homeOf('UB').includes('te raide !') && homeOf('UB').includes('raid_defend_bouclier'), 'Accueil : « ton raid est en cours » côté UA, boutons de défense côté UB');
  check(/subit déjà un raid/.test((await submit('UE', ['UB'], 'assaut')).errors.targets), 'UE ne peut pas raider UB en même temps (« subit déjà un raid »)');
  check(/déjà un raid en cours/.test(flat(home.buildRaidModal('UA'))), 'UA ne peut pas lancer un 2e raid en même temps');

  // ── Défense : aucun résultat avant la fin ──
  await defend('UB', r1.id, 'piege');          // Piège bat Ruse → riposte
  await defend('UC', r1.id, 'esquive', { inDm: false });   // depuis l'Accueil : Esquive cède à Ruse → tombe
  const upd = updated.filter((m) => m.channel === 'D_UB').at(-1);
  check(upd && /Piège enregistré/.test(flat(upd)) && !/riposte|Riposte|tombé|repoussé/.test(flat(upd)) && !flat(upd).includes('raid_defend_'), 'UB clique 🪤 Piège : « enregistré », boutons retirés, AUCUN résultat');
  await defend('UB', r1.id, 'bouclier');
  check(raid.getRaid(r1.id).targets.find((t) => t.userId === 'UB').defense === 'piege', 'un 2e clic ne change rien (choix définitif)');
  check(!raid.getRaid(r1.id).resolved && !dmsTo('UB').some((m) => /Riposte/.test(flat(m))), 'raid toujours en cours tant que UD n\'a pas répondu');
  check(homeOf('UA').includes('2/3 défenses reçues'), 'Accueil de UA : « 2/3 défenses reçues »');

  // ── Fin : tout le monde a répondu ──
  await defend('UD', r1.id, 'bouclier');       // Bouclier tient contre Ruse → repoussé
  const done = raid.getRaid(r1.id);
  check(done.resolved, 'UD répond à son tour : le raid se termine tout de suite');
  check(collections.getCount('UA', card('a').url) === 1 && collections.getCount('UB', card('a').url) === 1, 'riposte de UB : il prend un doublon à UA');
  check(collections.getCount('UC', card('legC').url) === 1, 'UC tombe mais n\'a qu\'une légendaire : il ne perd rien');
  check(collections.getCount('UD', card('r').url) === 1, 'UD repoussé : rien ne bouge');
  check(/Riposte réussie/.test(flat(dmsTo('UB').at(-1))) && /Ruse/.test(flat(dmsTo('UB').at(-1))) && /Carte a/.test(flat(dmsTo('UB').at(-1))), 'DM de UB : « Riposte réussie », le style révélé, la carte gagnée');
  check(/Tu es tombé/.test(flat(dmsTo('UC').at(-1))) && /aucune carte prenable/.test(flat(dmsTo('UC').at(-1))), 'DM de UC : tombé, mais aucune carte prenable');
  check(/Raid repoussé/.test(flat(dmsTo('UD').at(-1))), 'DM de UD : « Raid repoussé »');
  const recap = flat(dmsTo('UA').at(-1));
  check(/Raid terminé/.test(recap) && /1 tombé/.test(recap) && /1 repoussé/.test(recap) && /1 riposte/.test(recap) && /tu perds/.test(recap), 'récap de UA : 1 tombé, 1 repoussé, 1 riposte, une carte perdue');
  const ev = db.prepare("SELECT type, data FROM events WHERE type LIKE 'raid_%' ORDER BY id").all();
  check(ev.length === 2 && ev[0].type === 'raid_launched' && JSON.parse(ev[1].data).targets.length === 3, 'événements raid_launched et raid_resolved en base');

  // ── Fin au bout de 20 min (personne ne répond) ──
  check(await submit('UE', ['UB', 'UD'], 'assaut') === null, 'UE lance un 2e raid sur UB et UD (Assaut)');
  const r2 = raid.activeRaidOf('UE');
  NOW += 19 * MIN;
  await wait(10500);
  check(!raid.getRaid(r2.id).resolved, 'à 19 min : toujours en cours');
  NOW += 2 * MIN;
  await wait(10500);   // le contrôle tourne toutes les 10 s
  check(raid.getRaid(r2.id).resolved, 'à 21 min : terminé tout seul');
  check(collections.getCount('UB', card('x').url) === 2 && collections.getCount('UE', card('x').url) === 1, 'UB sans réponse tombe : UE lui prend un doublon (3 → 2)');
  check(/Pas de réponse à temps/.test(flat(dmsTo('UB').at(-1))), 'DM de UB : « pas de réponse à temps »');
  check(updated.some((m) => m.channel === 'D_UD' && /terminé/.test(flat(m))), 'l\'alerte de UD est remplacée par « raid terminé »');

  // ── 2 raids subis par jour au maximum ──
  check(/déjà subi 2 raids aujourd'hui/.test((await submit('UA', ['UB'], 'ruse')).errors.targets), 'UB a déjà subi 2 raids aujourd\'hui : refusé');
  at('2026-10-21T08:00:00Z');
  check(raid.targetProblem('UA', 'UB') === null, 'le lendemain : de nouveau raidable');

  // ── Raid gratuit ──
  scores.giveAttack('UF');
  credits.setBalance('UF', 15);
  check(homeOf('UF').includes('Lancer mon raid gratuit'), 'Accueil : « Lancer mon raid gratuit »');
  check(await submit('UF', ['UG', 'UH', 'UI', 'UJ', 'UC', 'UD'], 'embuscade') === null, 'raid gratuit sur 6 cibles');
  check(credits.getBalance('UF') === 5 && !scores.hasAttack('UF'), 'seule la 6e cible est payée (10 JP$) et le raid gratuit est consommé');

  origLog(process.exitCode ? '\n❌ ÉCHECS ci-dessus\n' : '\n🎉 Raid OK\n');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* base SQLite encore ouverte (Windows) */ }
  process.exit(process.exitCode || 0);
})();
