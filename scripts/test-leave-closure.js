#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test congés + fermeture de l'entreprise (v3.6)
//
//  Charge le vrai src/app.js avec un faux Slack, dans une COPIE
//  temporaire du projet (aucune donnée réelle touchée) :
//    • src/leave.js / src/closure.js : dates valides, en cours, à venir ;
//    • src/weekend.js pauseFor : textes et jour de reprise ;
//    • réaction d'un joueur en congés, ou sur le message de quelqu'un en congés ;
//    • raid, Arène, boosters, tickets bloqués pendant les congés ;
//    • série de combats : un jour de fermeture ne la casse pas ;
//    • annonces de fermeture (1er jour 9h, reprise pas le week-end) ;
//    • Accueil (joueur en congés, admin avec une fermeture) et modales.
//
//  Usage : node scripts/test-leave-closure.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-leave-'));
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

// Dates fixes (heure de Paris = UTC+1 en novembre)
const at = (iso) => Date.parse(iso);
const WED = at('2026-11-04T10:00:00Z');   // mercredi 4 novembre, 11h à Paris

(async () => {
  require(path.join(TMP, 'src', 'app.js'));
  await wait(300);
  const leave = req('leave.js');
  const closure = req('closure.js');
  const weekend = req('weekend.js');
  const broadcast = req('broadcast.js');
  const credits = req('credits.js');
  const raid = req('raid.js');
  const boosters = req('boosters.js');
  const scratchTickets = req('scratchTickets.js');
  const dailyStreak = req(path.join('game', 'dailyStreak.js'));
  const home = req('home.js');
  const { parisDay } = req('octobreRose.js');
  for (const u of ['U_A', 'U_B', 'U_CONGES', 'U_ADMIN']) broadcast.subscribe(u);

  origLog('\n🧪 Congés et fermeture (v3.6)\n');

  // ── Modules ──────────────────────────────────
  await test('congés : dates refusées (passées, à l\'envers, trop longues)', () => {
    assert.strictEqual(leave.declareLeave('U_X', '2026-11-01', '2026-11-03', WED).error, 'past');
    assert.strictEqual(leave.declareLeave('U_X', '2026-11-10', '2026-11-09', WED).error, 'order');
    assert.strictEqual(leave.declareLeave('U_X', '2026-11-04', '2027-01-10', WED).error, 'too_long');
    assert.strictEqual(leave.declareLeave('U_X', undefined, '2026-11-09', WED).error, 'format');
  });

  await test('congés à venir : prévus, pas encore actifs ; actifs dès le premier jour', () => {
    assert.ok(leave.declareLeave('U_X', '2026-11-09', '2026-11-13', WED).ok);
    assert.ok(leave.getLeave('U_X', WED));
    assert.strictEqual(leave.activeLeave('U_X', WED), null);
    assert.ok(leave.activeLeave('U_X', at('2026-11-09T00:30:00Z')), 'lundi 1h30 à Paris');
    assert.strictEqual(leave.getLeave('U_X', at('2026-11-14T10:00:00Z')), null, 'finis = oubliés');
    assert.ok(leave.endLeave('U_X'));
    assert.strictEqual(leave.getLeave('U_X', WED), null);
  });

  await test('congés : un début dans le passé devient aujourd\'hui', () => {
    const r = leave.declareLeave('U_X', '2026-11-01', '2026-11-06', WED);
    assert.strictEqual(r.leave.start, '2026-11-04');
    leave.endLeave('U_X');
  });

  await test('pauseFor : congés → reprise au retour (après le week-end)', () => {
    leave.declareLeave('U_X', '2026-11-04', '2026-11-06', WED);   // mer → ven
    const p = weekend.pauseFor('U_X', WED);
    assert.strictEqual(p.kind, 'leave');
    assert.strictEqual(p.back, 'lundi');
    assert.ok(/congés/.test(p.title) && /jusqu'à lundi 0h/.test(p.title), p.title);
    assert.strictEqual(weekend.pauseFor('U_Y', WED), null, 'un autre joueur n\'est pas en pause');
    assert.strictEqual(weekend.isPaused(WED), false, 'pas de pause pour tout le monde');
    leave.endLeave('U_X');
  });

  await test('fermeture : chevauchement refusé, pause pour tous, reprise longue en toutes lettres', () => {
    const r = closure.addClosure({ start: '2026-12-24', end: '2027-01-01', reason: 'Noël', by: 'U_ADMIN', now: WED });
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(closure.addClosure({ start: '2026-12-31', end: '2027-01-02', by: 'U_ADMIN', now: WED }).error, 'overlap');
    const xmas = at('2026-12-28T10:00:00Z');   // lundi 28 décembre
    assert.ok(weekend.isPaused(xmas));
    const p = weekend.pauseFor('U_Y', xmas);
    assert.strictEqual(p.kind, 'closure');
    assert.ok(/Noël/.test(p.title), p.title);
    assert.strictEqual(p.back, 'le lundi 4 janvier', 'reprise lundi 4 janvier (le 2-3 = week-end), à 7 jours → en toutes lettres');
    assert.strictEqual(weekend.pauseFor('U_Y', at('2026-12-31T10:00:00Z')).back, 'lundi', 'à 4 jours → « lundi »');
    assert.strictEqual(weekend.isPaused(at('2027-01-04T10:00:00Z')), false);
  });

  await test('série de combats : la fermeture ne la casse pas, les congés si', () => {
    const state = { day: '2026-12-23', step: 3 };   // mercredi 23, veille de la fermeture
    const after = at('2027-01-04T10:00:00Z');       // lundi 4 janvier
    assert.strictEqual(dailyStreak.preview(state, after).step, 3, 'série toujours vivante');
    const plain = { day: '2026-11-02', step: 3 };   // lundi 2 novembre, puis rien mardi
    assert.strictEqual(dailyStreak.preview(plain, WED).step, 0, 'un jour ouvré sans combat casse la série');
  });

  await test('annonces : début à 9h le 1er jour, reprise seulement hors week-end', () => {
    const minutes = (h) => h * 60;
    const d24 = at('2026-12-24T07:00:00Z');   // 8h à Paris
    assert.deepStrictEqual(closure.takeDueAnnouncements(d24, weekend.isPaused, minutes(8)), []);
    const start = closure.takeDueAnnouncements(at('2026-12-24T08:05:00Z'), weekend.isPaused, minutes(9));
    assert.deepStrictEqual(start.map((d) => d.kind), ['start']);
    assert.deepStrictEqual(closure.takeDueAnnouncements(at('2026-12-24T09:00:00Z'), weekend.isPaused, minutes(10)), [], 'une seule fois');
    const sat = at('2027-01-02T09:00:00Z');
    assert.deepStrictEqual(closure.takeDueAnnouncements(sat, weekend.isPaused, minutes(10)), [], 'pas de reprise un samedi');
    const mon = at('2027-01-04T08:30:00Z');
    assert.deepStrictEqual(closure.takeDueAnnouncements(mon, weekend.isPaused, minutes(9) + 30).map((d) => d.kind), ['end']);
  });

  // ── Règles de jeu pendant les congés (aujourd'hui, pour de vrai) ──
  const now = Date.now();
  const today = parisDay(now);
  const realWeekend = weekend.isPaused(now);
  leave.declareLeave('U_CONGES', today, today, now);

  await test('raid : impossible de raider ou d\'être raidé en congés', () => {
    assert.strictEqual(raid.targetProblem('U_A', 'U_CONGES'), 'leave');
    assert.strictEqual(raid.launchBlock(now, 'U_CONGES'), 'weekend');
  });

  await test('Arène : pas de file ni de défi vers / depuis quelqu\'un en congés', () => {
    const mm = req(path.join('game', 'matchmaking.js'));
    assert.strictEqual(mm.joinQueue('U_CONGES', now).reason, 'weekend');
    if (!realWeekend) assert.strictEqual(mm.createChallenge('U_A', 'U_CONGES', now).reason, 'leave_to');
  });

  await test('boosters et tickets bloqués en congés', () => {
    const b = boosters.listBoosters(now)[0];
    assert.strictEqual(boosters.purchaseBlock(b, now, 'U_CONGES'), 'weekend');
    assert.strictEqual(scratchTickets.purchaseBlock('U_CONGES', now), 'weekend');
  });

  let n = 0;
  const react = async (user, author) => {
    n += 1;
    const ts = `${n}.000`;
    authorOf[ts] = author;
    const before = posted.length;
    const eph = ephemerals.length;
    await events.reaction_added({ event: { reaction: 'jeanpip', user, item: { channel: 'C1', ts } }, client: fakeClient, logger });
    return { dms: posted.slice(before), notes: ephemerals.slice(eph) };
  };

  await test('réaction d\'un joueur en congés : rien, prévenu', async () => {
    const before = credits.getBalance('U_CONGES');
    const out = await react('U_CONGES', 'U_A');
    assert.strictEqual(out.dms.length, 0);
    assert.strictEqual(credits.getBalance('U_CONGES'), before);
    assert.ok(out.notes.length === 1, 'éphémère');
    if (!realWeekend) assert.match(out.notes[0].text, /congés/);
  });

  await test('réaction sur le message de quelqu\'un en congés : rien pour le réacteur, prévenu', async () => {
    const before = credits.getBalance('U_B');
    const out = await react('U_B', 'U_CONGES');
    assert.strictEqual(out.dms.length, 0);
    assert.strictEqual(credits.getBalance('U_B'), before);
    assert.ok(out.notes.length === 1);
    if (!realWeekend) assert.match(out.notes[0].text, /<@U_CONGES> est en congés/);
  });

  // ── Accueil + modales ─────────────────────────
  const ctx = (isAdmin) => ({
    isAdmin, creditsPerJeanpipLabel: '1', targetEmoji: 'jeanpip', farmRemainingMs: 0,
    farmQuota: { used: 0, max: 30, nextFreeMs: 0 }, formatRemaining: () => '1 min', autoTargets: [],
  });
  const textOf = (view) => JSON.stringify(view.blocks);

  await test('Accueil : en congés → bandeau + bouton « Je suis rentré »', () => {
    const t = textOf(home.buildHomeView('U_CONGES', ctx(false)));
    assert.ok(t.includes('leave_end') && t.includes('"back"'), 'bouton de retour');
    if (!realWeekend) assert.ok(t.includes('Tu es en congés'), 'bandeau');
  });

  await test('Accueil : sans congés → bouton « Déclarer mes congés »', () => {
    assert.ok(textOf(home.buildHomeView('U_A', ctx(false))).includes('leave_open'));
  });

  await test('Accueil admin : bouton Fermeture + fermeture prévue annulable', () => {
    const t = textOf(home.buildHomeView('U_ADMIN', ctx(true)));
    assert.ok(t.includes('admin_closure_open'));
    assert.ok(t.includes('admin_closure_cancel') && t.includes('Noël'));
    assert.ok(!textOf(home.buildHomeView('U_A', ctx(false))).includes('admin_closure_open'), 'pas pour un joueur');
  });

  await test('modales : congés et fermeture se construisent', () => {
    assert.strictEqual(home.buildLeaveModal('U_A').callback_id, 'leave_submit');
    assert.strictEqual(home.buildClosureModal().callback_id, 'closure_submit');
  });

  const submit = async (id, user, values) => {
    let acked;
    await views[id]({ ack: async (r) => { acked = r; }, body: { user: { id: user } }, view: { state: { values } }, client: fakeClient, logger });
    return acked;
  };
  const dates = (start, end) => ({ start: { value: { selected_date: start } }, end: { value: { selected_date: end } } });

  await test('modale congés : erreur sous le champ, puis enregistrement', async () => {
    const err = await submit('leave_submit', 'U_B', dates('2027-02-10', '2027-02-01'));
    assert.strictEqual(err.response_action, 'errors');
    assert.ok(err.errors.end);
    const ok = await submit('leave_submit', 'U_B', dates('2027-02-01', '2027-02-05'));
    assert.strictEqual(ok, undefined);
    assert.strictEqual(leave.getLeave('U_B').end, '2027-02-05');
    await actions.leave_end({ ack: async () => {}, body: { user: { id: 'U_B' } }, action: { value: 'cancel' }, client: fakeClient, logger });
    assert.strictEqual(leave.getLeave('U_B'), null);
  });

  await test('modale fermeture : réservée aux admins', async () => {
    const err = await submit('closure_submit', 'U_A', { ...dates('2027-03-01', '2027-03-02'), reason: { value: { value: 'x' } } });
    assert.strictEqual(err.response_action, 'errors');
    const ok = await submit('closure_submit', 'U_ADMIN', { ...dates('2027-03-01', '2027-03-02'), reason: { value: { value: 'Pont' } } });
    assert.strictEqual(ok, undefined);
    assert.ok(closure.listUpcoming().some((c) => c.reason === 'Pont'));
  });

  const errors = logs.filter((l) => l.startsWith('ERR'));
  await test('aucune erreur dans le flux', () => assert.deepStrictEqual(errors, []));

  try { req('db.js').close(); } catch { /* base jamais ouverte */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows */ }
  origLog(process.exitCode ? '\n❌ Échec' : `\n✅ Tout est bon (${passed})`);
  process.exit(process.exitCode || 0);
})().catch((e) => { origLog(e); process.exit(1); });
