#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test des bugs signalés (src/bugs.js + src/bugsSlack.js, v2.2.1)
//
//  Faux Slack : signalement (modale) → DM de reçu à l'auteur + DM à
//  chaque admin avec les captures renvoyées dans le fil → Valider
//  (+10 JP$, une seule fois même si deux admins cliquent) ou Refuser
//  → « Corrigé » depuis l'Accueil → DM à l'auteur.
//  Travaille dans une COPIE temporaire du projet.
//
//  Usage : node scripts/test-bugs.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-bugs-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

const origLog = console.log;
console.log = () => {};
const bugs = require(path.join(TMP, 'src', 'bugs.js'));
const bugsSlack = require(path.join(TMP, 'src', 'bugsSlack.js'));
const credits = require(path.join(TMP, 'src', 'credits.js'));
const home = require(path.join(TMP, 'src', 'home.js'));
console.log = origLog;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

// ─── Faux Slack ───
const handlers = { action: {}, view: {} };
const app = { action: (id, fn) => { handlers.action[id] = fn; }, view: (id, fn) => { handlers.view[id] = fn; } };
const sent = []; const updates = []; const uploads = []; const posts = []; const modals = []; const refreshed = [];
let ts = 0;
let uploadFails = false;
const client = {
  chat: {
    update: async (m) => { updates.push(m); },
    postMessage: async (m) => { posts.push(m); return { ok: true }; },
  },
  files: {
    info: async ({ file }) => ({ file: { url_private: `https://files.test/${file}`, name: `${file}.png`, size: 1000 } }),
    uploadV2: async (m) => { if (uploadFails) throw new Error('missing_scope'); uploads.push(m); },
  },
};
global.fetch = async (url) => ({ ok: true, arrayBuffer: async () => Buffer.from(`img:${url}`) });
process.env.SLACK_BOT_TOKEN = 'xoxb-test';

const ADMINS = ['ADM1', 'ADM2'];
bugsSlack.register(app, {
  admins: ADMINS,
  isAdmin: (u) => ADMINS.includes(u),
  sendDM: async (c, userId, msg) => { ts += 1; sent.push({ userId, ...msg }); return { channel: `D${userId}`, ts: String(ts) }; },
  openModal: async (c, body, view) => { modals.push(view); },
  refreshHome: async (c, userId) => { refreshed.push(userId); },
});

const flat = (x) => JSON.stringify(x);
const lastTo = (u) => [...sent].reverse().find((m) => m.userId === u);
const act = (id, userId, value) => handlers.action[id]({ ack: async () => {}, body: { user: { id: userId }, trigger_id: 't' }, action: { value }, client, logger: console });
async function submit(userId, text, files = []) {
  let reply = null;
  await handlers.view.bug_report_submit({
    ack: async (r) => { reply = r || null; },
    body: { user: { id: userId } },
    view: { state: { values: { text: { value: { value: text } }, shots: { value: { files } } } } },
    client,
  });
  return reply;
}

(async () => {
  // 🏠 Accueil : bouton pour tout le monde, suivi pour les admins
  const ctx = (isAdmin) => ({
    isAdmin, attackPrice: 25, creditsPerJeanpipLabel: '0,5', targetEmoji: 'jeanpip',
    farmRemainingMs: 0, farmQuota: { used: 0, max: 10, nextFreeMs: 0 }, formatRemaining: () => '', autoTargets: [],
  });
  check('Accueil joueur : bouton « Signaler un bug », pas de suivi', flat(home.buildHomeView('P1', ctx(false))).includes('bug_report_open') && !flat(home.buildHomeView('P1', ctx(false))).includes('Bugs signalés'));
  check('Accueil admin : bloc « Bugs signalés »', flat(home.buildHomeView('ADM1', ctx(true))).includes('Bugs signalés') && flat(home.buildHomeView('ADM1', ctx(true))).includes('Aucun bug à corriger'));

  // 🪟 Modale
  await act('bug_report_open', 'P1');
  check('modale : description + captures (3 max, images)', modals[0].callback_id === 'bug_report_submit' && flat(modals[0]).includes('file_input') && flat(modals[0]).includes('"max_files":3'));
  check('description trop courte → erreur dans la modale', (await submit('P1', 'bof')).errors.text.includes('10 caractères'));

  // 🐛 Signalement avec 2 captures
  const ok = await submit('P1', 'Le bouton Combat rapide ne fait rien\nquand je clique <!channel>', [{ id: 'F1', name: 'a.png' }, { id: 'F2', name: 'b.png' }]);
  const bug = bugs.get(1);
  check('signalement : modale fermée, bug n° 1 en attente', ok === null && bug && bug.status === 'pending' && bug.files.length === 2);
  check('auteur : DM « bien reçu »', lastTo('P1') && lastTo('P1').text.includes('bien reçu'));
  check('chaque admin reçoit le bug avec Valider / Refuser', ADMINS.every((a) => lastTo(a) && flat(lastTo(a).blocks).includes('bug_validate') && flat(lastTo(a).blocks).includes('bug_refuse')));
  check('pas de mention de masse dans le DM admin', !flat(lastTo('ADM1').blocks).includes('<!channel>'));
  check('captures renvoyées dans le fil du DM de chaque admin', uploads.length === 2 && uploads.every((u) => u.file_uploads.length === 2 && u.thread_ts));
  check('DM admin mémorisés pour la mise à jour', bugs.get(1).adminMessages.length === 2);

  // ✅ Validation : deux admins cliquent, un seul paiement
  await act('bug_validate', 'ADM1', '1');
  await act('bug_validate', 'ADM2', '1');
  check('validé : +10 JP$ une seule fois', credits.getBalance('P1') === 10 && bugs.get(1).status === 'validated' && bugs.get(1).decidedBy === 'ADM1');
  check('validé : DM de confirmation à l’auteur', lastTo('P1').text.includes('confirmé'));
  check('validé : les DM des deux admins sont mis à jour (plus de boutons)', updates.filter((u) => u.text.includes('n° 1')).length >= 2 && !flat(updates[updates.length - 1].blocks).includes('bug_validate'));
  check('non-admin : ne peut rien valider', await (async () => {
    const b2 = await submit('P2', 'Les cartes ne se chargent pas sur mon écran');
    await act('bug_validate', 'P2', '2');
    return b2 === null && bugs.get(2).status === 'pending' && credits.getBalance('P2') === 0;
  })());

  // ✖️ Refus
  await act('bug_refuse', 'ADM2', '2');
  check('refusé : pas de JP$, DM neutre à l’auteur', bugs.get(2).status === 'refused' && credits.getBalance('P2') === 0 && lastTo('P2').text.includes("n'a pas été retenu"));
  await act('bug_validate', 'ADM1', '2');
  check('refusé puis validé par un autre admin : rien ne change', bugs.get(2).status === 'refused' && credits.getBalance('P2') === 0);

  // 🛠️ Suivi dans l'Accueil admin
  const adminHome = flat(home.buildHomeView('ADM1', ctx(true)));
  check('Accueil admin : bug n° 1 à corriger avec bouton « Corrigé »', adminHome.includes('n° 1') && adminHome.includes('bug_fixed') && adminHome.includes('1 à corriger'));
  await act('bug_fixed', 'P1', '1');
  check('non-admin : ne peut pas marquer corrigé', bugs.get(1).status === 'validated');
  await act('bug_fixed', 'ADM2', '1');
  check('corrigé : statut + DM à l’auteur', bugs.get(1).status === 'fixed' && bugs.get(1).fixedBy === 'ADM2' && lastTo('P1').text.includes('corrigé'));
  check('corrigé : plus dans la liste à corriger', !flat(home.buildHomeView('ADM1', ctx(true))).includes('bug_fixed'));
  check('compteurs', flat(bugsSlack.buildAdminBugBlocks()).includes('1 corrigé') && flat(bugsSlack.buildAdminBugBlocks()).includes('1 refusé'));
  check('Accueils des admins rafraîchis', refreshed.includes('ADM1') && refreshed.includes('ADM2'));

  // 📎 Sans le droit files:write : le DM part quand même, avec un message dans le fil
  uploadFails = true;
  await submit('P3', 'Encore un souci avec une capture jointe', [{ id: 'F9' }]);
  check('sans files:write : DM admin envoyé + explication dans le fil', bugs.get(3).adminMessages.length === 2 && posts.some((p) => p.text.includes('files:write')));

  // 💰 Source du grand livre
  const db = require(path.join(TMP, 'src', 'db.js')).getDb();
  check('JP$ tracés avec la source bug_bounty', db.prepare("SELECT COUNT(*) AS n FROM credit_moves WHERE source = 'bug_bounty' AND ref = 'bug:1'").get().n === 1);

  try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }   // Windows : fichier ouvert = non supprimable
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
