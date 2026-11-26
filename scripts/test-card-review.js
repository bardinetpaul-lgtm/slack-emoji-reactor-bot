#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test v4.4.2 : validation des nouvelles cartes par CARD_REVIEWER
//  (src/cardReview.js, src/cardReviewSlack.js, branchement dans src/app.js)
//
//  Charge le vrai src/app.js avec un faux Slack, dans une COPIE temporaire :
//    • ajout par la fenêtre admin → pas dans le jeu, DM au valideur (carte,
//      nom, auteur, rareté conseillée, 3 boutons), l'admin est prévenu
//    • Valider → publiée à la rareté choisie, auteur payé, admin prévenu
//    • Changer la rareté puis Valider → publiée à SA rareté
//    • Invalider → jamais publiée ; le clic d'un autre que le valideur ne fait rien
//    • 12 h sans réponse → publiée telle quelle ; puis « Retirer du jeu » la retire
//    • même lien déjà en attente → refusé ; sans CARD_REVIEWER → publiée tout de suite
//    • la minuterie rejouée ne publie jamais deux fois
//
//  Usage : npx -y -p node@20 node scripts/test-card-review.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-card-review-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

const RealDate = Date;
let NOW = RealDate.parse('2026-11-26T09:00:00Z');   // jeudi 10h, Paris
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
process.env.JEANPIP_ADMINS = 'U_ADMIN';
process.env.CARD_REVIEWER = 'U_JEAN';
process.env.ANTHROPIC_API_KEY = '';

const posted = [];
const updated = [];
const fakeClient = {
  conversations: { open: async ({ users }) => ({ channel: { id: `D_${users}` } }), history: async () => ({ messages: [] }) },
  chat: {
    postMessage: async (m) => { posted.push(m); return { ok: true, channel: m.channel, ts: String(1000 + posted.length) }; },
    postEphemeral: async () => ({ ok: true }),
    update: async (m) => { updated.push(m); return { ok: true }; },
  },
  users: { info: async ({ user }) => ({ user: { id: user, is_bot: false, real_name: user, name: user, profile: {} } }) },
  auth: { test: async () => ({ user_id: 'B_BOT', user: 'jeanpip' }) },
  views: { publish: async () => ({ ok: true }), open: async () => ({ ok: true }), update: async () => ({ ok: true }) },
  files: { info: async () => { throw new Error('fake'); } },
  reactions: { add: async () => ({ ok: true }) },
};
const handlers = { action: [], view: [] };
class FakeApp {
  constructor() { this.client = fakeClient; }
  action(id, fn) { handlers.action.push({ id, fn }); }
  view(id, fn) { handlers.view.push({ id, fn }); }
  event() {} message() {} command() {} error() {} shortcut() {} options() {}
  async start() {}
}
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@slack/bolt') return { App: FakeApp, LogLevel: { INFO: 'info', DEBUG: 'debug' } };
  if (req === 'dotenv') return { config() {} };
  return origLoad.call(this, req, ...rest);
};

let failures = 0;
const check = (label, ok) => { console.log(`${ok ? '✅' : '❌'} ${label}`); if (!ok) failures += 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const logger = { info() {}, warn() {}, error: (...a) => console.log('   (log erreur)', ...a), debug() {} };
const find = (kind, id) => handlers[kind].find((h) => (h.id instanceof RegExp ? h.id.test(id) : h.id === id)).fn;
const flat = (x) => JSON.stringify(x);
const dmsTo = (u) => posted.filter((m) => m.channel === `D_${u}`);
const lastUpdate = () => updated[updated.length - 1];

(async () => {
  const origLog = console.log;
  console.log = () => {};
  require(path.join(TMP, 'src', 'app.js'));
  await wait(300);
  console.log = origLog;
  const media = require(path.join(TMP, 'src', 'media.js'));
  const credits = require(path.join(TMP, 'src', 'credits.js'));
  const cardReview = require(path.join(TMP, 'src', 'cardReview.js'));
  const app = require(path.join(TMP, 'src', 'app.js'));
  const inBank = (url) => media.getAllMedia().some((m) => m.url === url);

  const addCard = async (url, rarity, { title = '', author = 'U_AUTEUR' } = {}) => {
    let ackArg = null;
    await find('view', 'admin_addmedia_submit')({
      ack: async (a) => { ackArg = a; },
      body: { user: { id: 'U_ADMIN' } },
      view: { state: { values: { url: { value: { value: url } }, rarity: { value: { selected_option: { value: rarity } } }, title: { value: { value: title } }, author: { value: { selected_user: author } } } } },
      client: fakeClient,
      logger,
    });
    await wait(50);
    return ackArg;
  };
  const click = (actionId, value, user = 'U_JEAN') => find('action', actionId)({
    ack: async () => {}, body: { user: { id: user } }, action: actionId === 'card_review_rarity' ? { selected_option: { value } } : { value: String(value) }, client: fakeClient, logger,
  });

  // ─── 1. Ajout → en attente, DM au valideur ───
  const U1 = 'https://media.giphy.com/media/test-carte-1/giphy.gif';
  const beforeAuthor = credits.getBalance('U_AUTEUR');
  await addCard(U1, 'rare', { title: 'Le chat de Léo' });
  const r1 = cardReview.list('pending')[0];
  check('ajout : la carte n\'est PAS encore dans le jeu', !inBank(U1) && r1 && r1.url === U1);
  const dmJean = dmsTo('U_JEAN').pop();
  const t = flat(dmJean);
  check('DM au valideur : nom, auteur, rareté conseillée', /Le chat de Léo/.test(t) && /<@U_AUTEUR>/.test(t) && /Rareté conseillée/.test(t) && /Rare/.test(t));
  check('DM au valideur : image de la carte (hébergeur public)', /"type":"image"/.test(t) && t.includes(U1));
  check('DM au valideur : Valider / Invalider / Changer la rareté', /card_review_ok/.test(t) && /card_review_no/.test(t) && /card_review_rarity/.test(t));
  check('DM au valideur : délai de 12 h affiché', /Sans réponse avant/.test(t));
  check('admin prévenu de l\'envoi en validation', /envoyée à <@U_JEAN> pour validation/.test(flat(dmsTo('U_ADMIN').pop())));
  check('auteur pas encore payé', credits.getBalance('U_AUTEUR') === beforeAuthor);

  // Même lien déjà en attente → refusé
  const dup = await addCard(U1, 'rare');
  check('même lien déjà en attente : refusé dans la fenêtre', dup && dup.response_action === 'errors');

  // Un autre que le valideur ne peut pas décider
  await click('card_review_ok', r1.id, 'U_ADMIN');
  check('clic d\'un admin (pas le valideur) : rien ne se passe', cardReview.get(r1.id).status === 'pending' && !inBank(U1));

  // ─── 2. Changer la rareté puis Valider ───
  await click('card_review_rarity', `${r1.id}|epic`);
  check('changer la rareté : retenue, message mis à jour', cardReview.get(r1.id).chosen === 'epic' && /Valider en Épique/.test(flat(lastUpdate())));
  await click('card_review_ok', r1.id);
  const pub = media.getAllMedia().find((m) => m.url === U1);
  check('Valider : publiée à LA rareté du valideur (épique)', pub && pub.rarity === 'epic' && cardReview.get(r1.id).status === 'published');
  await wait(50);
  check('Valider : auteur payé à la rareté retenue', credits.getBalance('U_AUTEUR') > beforeAuthor);
  check('Valider : admin prévenu', /a validé la carte/.test(flat(dmsTo('U_ADMIN').pop())));
  check('Valider : bouton « Retirer du jeu » à la place', /card_review_remove/.test(flat(lastUpdate())) && !/card_review_ok/.test(flat(lastUpdate())));
  await click('card_review_ok', r1.id);
  check('double clic : pas publiée deux fois', media.getAllMedia().filter((m) => m.url === U1).length === 1);

  // ─── 3. Invalider ───
  const U2 = 'https://img.test/carte-2.png';
  await addCard(U2, 'common');
  const r2 = cardReview.list('pending').find((r) => r.url === U2);
  check('DM au valideur : image privée → lien « voir l\'image »', /Clique ici pour voir l'image/.test(flat(dmsTo('U_JEAN').pop())) && flat(dmsTo('U_JEAN').pop()).includes(U2));
  await click('card_review_no', r2.id);
  check('Invalider : jamais publiée', cardReview.get(r2.id).status === 'refused' && !inBank(U2));
  check('Invalider : admin prévenu', /a invalidé la carte/.test(flat(dmsTo('U_ADMIN').pop())));
  NOW += 13 * 3600 * 1000;
  check('Invalider : le délai de 12 h ne la publie pas', cardReview.due().every((r) => r.id !== r2.id));
  NOW -= 13 * 3600 * 1000;

  // ─── 4. 12 h sans réponse → publiée telle quelle, puis retirée ───
  const U3 = 'https://img.test/carte-3.png';
  await addCard(U3, 'legendary', { author: null });
  const r3 = cardReview.list('pending').find((r) => r.url === U3);
  NOW += 11 * 3600 * 1000;
  check('11 h : toujours en attente', cardReview.due().length === 0);
  NOW += 2 * 3600 * 1000;
  await app.cardReviews.runTick(fakeClient, logger);
  const pub3 = media.getAllMedia().find((m) => m.url === U3);
  check('13 h sans réponse : publiée telle quelle (légendaire conseillée)', pub3 && pub3.rarity === 'legendary' && cardReview.get(r3.id).how === 'timeout');
  check('13 h : admin prévenu « publiée telle quelle »', /publiée telle quelle/.test(flat(dmsTo('U_ADMIN').pop())));
  check('13 h : DM du valideur mis à jour, bouton « Retirer du jeu »', /Publiée telle quelle/.test(flat(lastUpdate())) && /card_review_remove/.test(flat(lastUpdate())));
  await app.cardReviews.runTick(fakeClient, logger);
  check('minuterie rejouée : pas publiée deux fois', media.getAllMedia().filter((m) => m.url === U3).length === 1);

  // Invalider après 12 h = la retirer du jeu
  await click('card_review_remove', r3.id);
  check('Retirer du jeu : plus au catalogue', !inBank(U3) && cardReview.get(r3.id).status === 'removed');
  check('Retirer du jeu : admin prévenu', /a retiré du jeu la carte/.test(flat(dmsTo('U_ADMIN').pop())));

  // ─── 5. Sans valideur : publiée tout de suite, comme avant ───
  process.env.CARD_REVIEWER = '';
  const U4 = 'https://img.test/carte-4.png';
  await addCard(U4, 'common');
  check('sans CARD_REVIEWER : publiée tout de suite', inBank(U4));

  console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log(e); process.exit(1); });
