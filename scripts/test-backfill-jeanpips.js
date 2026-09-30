#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Rattrapage des Jeanpips reçus en DM (scripts/backfill-collections.js --jeanpips)
//  Lecture des messages (formats de juin et de juillet) + garde-fou anti-doublon.
//  Usage : node scripts/test-backfill-jeanpips.js
// ═══════════════════════════════════════════════════════════
const { parseJeanpipMessage, jeanpipWindowConflict } = require('./backfill-collections');

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const bank = new Map([
  ['https://files.slack.com/files-pri/T1-F1/a.jpg', { url: 'https://files.slack.com/files-pri/T1-F1/a.jpg', title: '🔵 Surprise #3', rarity: 'rare', type: 'image' }],
  ['https://media.giphy.com/x.gif', { url: 'https://media.giphy.com/x.gif', title: '⚪ Surprise #1', rarity: 'common', type: 'image' }],
]);
bank.byTitle = new Map([...bank.values()].map((m) => [m.title, m]));
const section = (text) => ({ type: 'section', text: { type: 'mrkdwn', text } });
const footer = { type: 'context', elements: [{ type: 'mrkdwn', text: '🤖 _Envoyé par Emoji Reactor Bot_' }] };

// Format de juin : pas de ligne de rareté, image privée en lien cliquable
const june = { ts: '1750200000.000100', blocks: [
  section('Bonjour jeune <@U1>, <@U2> t\'a envoyé un Jeanpip ! :jeanpip:'), { type: 'divider' },
  section('🖼️ *🔵 Surprise #3*\n<https://files.slack.com/files-pri/T1-F1/a.jpg|👉 Clique ici pour voir l\'image>'), footer] };
const c1 = parseJeanpipMessage(june, bank);
check('juin : carte de la banque retrouvée par son lien', c1 && c1.url === 'https://files.slack.com/files-pri/T1-F1/a.jpg' && c1.rarity === 'rare' && !c1.orphan);

// Format de juillet : ligne de rareté + image publique
const july = { ts: '1752700000.000100', blocks: [
  section('Hey <@U1> tu as réagi avec jean pip coucou :jeanpip:'), { type: 'divider' },
  section('⚪ Commun · Jeanpip'),
  { type: 'image', image_url: 'https://media.giphy.com/x.gif', alt_text: 'x', title: { type: 'plain_text', text: '⚪ Surprise #1' } }, footer] };
check('juillet : image publique retrouvée', (parseJeanpipMessage(july, bank) || {}).url === 'https://media.giphy.com/x.gif');

// Attaque Jeanpip
const attack = { ts: '1', blocks: [section('🚨 *ALERTE ATTAQUE JEANPIP !*\n*<@U2>* t\'a ciblé dans <#C1> ! :jeanpip:'), { type: 'divider' },
  section('🖼️ *🔵 Surprise #3*\n<https://files.slack.com/files-pri/T1-F1/a.jpg|👉 Clique ici pour voir l\'image>'), footer] };
check('attaque Jeanpip : carte retrouvée', Boolean(parseJeanpipMessage(attack, bank)));

// Média retiré de la banque : reconstruit depuis le message (rareté de la ligne, sinon commun)
const orphan = { ts: '1', blocks: [section('Bonjour jeune <@U1>, <@U2> t\'a envoyé un Jeanpip ! :jeanpip:'), { type: 'divider' },
  section('🟣 Épique · Jeanpip'),
  section('🎬 *🟣 Surprise #9 — Le saut*\n<https://example.test/v.mp4|▶️ Clique ici pour voir la vidéo>'), footer] };
const c4 = parseJeanpipMessage(orphan, bank);
check('média retiré : titre, rareté, type vidéo', c4 && c4.orphan && c4.title === '🟣 Surprise #9 — Le saut' && c4.rarity === 'epic' && c4.type === 'video');
const orphanJune = { ts: '1', blocks: [section('Bonjour jeune <@U1>, <@U2> t\'a envoyé un Jeanpip ! :jeanpip:'), { type: 'divider' },
  section('🖼️ *Surprise #7*\n<https://example.test/z.png|👉 Clique ici pour voir l\'image>'), footer] };
check('média retiré sans ligne de rareté → commun', (parseJeanpipMessage(orphanJune, bank) || {}).rarity === 'common');

// Auto-react (en-tête par défaut de l'époque)
const auto = { ts: '1', blocks: [section('Hey <@U1>, tu as posté un message et tu mérites un Jeanpip ! :jeanpip:'), { type: 'divider' },
  section('🖼️ *🔵 Surprise #3*\n<https://files.slack.com/files-pri/T1-F1/a.jpg|👉 Clique ici pour voir l\'image>'), footer] };
check('auto-react : carte retrouvée', Boolean(parseJeanpipMessage(auto, bank)));

// Ce qui n'est PAS un Jeanpip reçu
const addMediaPreview = { ts: '1', blocks: [section('🖼️ *Nouveau Jeanpip 🔵 Rare*'), { type: 'divider' },
  section('🖼️ *🔵 Surprise #3*\n<https://files.slack.com/files-pri/T1-F1/a.jpg|👉 Clique ici pour voir l\'image>'), footer] };
check('aperçu admin « Nouveau Jeanpip » (ajout de média) ignoré', parseJeanpipMessage(addMediaPreview, bank) === null);
const spam = { ts: '1', blocks: [section('🚨 Spammer c\'est mal. (1/10)'), { type: 'divider' },
  section('🖼️ *Troll*\n<https://example.test/troll.png|👉 Clique ici pour voir l\'image>'), footer] };
check('punition anti-spam ignorée', parseJeanpipMessage(spam, bank) === null);
const reveal = { ts: '1', blocks: [section('🎴 *🔵 Surprise #3* — carte 2/8'),
  section('🖼️ *🔵 Surprise #3*\n<https://files.slack.com/files-pri/T1-F1/a.jpg|👉 Clique ici pour voir l\'image>')] };
check('révélation de booster ignorée', parseJeanpipMessage(reveal, bank) === null);
check('message sans média ignoré', parseJeanpipMessage({ ts: '1', blocks: [section('🎉 Tu as débloqué une Attaque Jeanpip !')] }, bank) === null);
check('message texte seul ignoré', parseJeanpipMessage({ ts: '1', text: 'Salut' }, bank) === null);

// 🛡️ Garde-fou : une période déjà appliquée ne peut pas l'être une 2e fois
const done = { jeanpipBackfills: [{ since: '2026-06-17T00:00:00.000Z', until: '2026-07-17T12:06:38.541Z' }] };
check('aucune période appliquée → pas de conflit', jeanpipWindowConflict({}, '2026-06-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z') === null);
check('même période → conflit', Boolean(jeanpipWindowConflict(done, '2026-06-17T00:00:00.000Z', '2026-07-17T12:06:38.541Z')));
check('période qui chevauche → conflit', Boolean(jeanpipWindowConflict(done, '2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')));
check('période accolée après → pas de conflit', jeanpipWindowConflict(done, '2026-07-17T12:06:38.541Z', '2026-08-01T00:00:00.000Z') === null);

// ─── 🔁 Bout en bout : simulation, écriture, refus d'une 2e écriture ───
{
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { spawnSync } = require('child_process');
  const ROOT = path.join(__dirname, '..');
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-backfill-jp-'));
  fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(TMP, 'scripts'), { recursive: true });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
  fs.mkdirSync(path.join(TMP, 'data'));
  const url = 'https://files.slack.com/files-pri/T1-F1/a.jpg';
  fs.writeFileSync(path.join(TMP, 'data', 'media-bank.json'), JSON.stringify([{ url, title: '🔵 Surprise #3', rarity: 'rare', type: 'image' }]));
  // U1 possède déjà la carte depuis le 20/07 (live) : le rattrapage la rend plus ancienne et ajoute un exemplaire
  fs.writeFileSync(path.join(TMP, 'data', 'collections.json'), JSON.stringify({ users: { U1: { cards: { [url]: { title: '🔵 Surprise #3', rarity: 'rare', type: 'image', count: 1, firstAt: '2026-07-20T10:00:00.000Z', lastAt: '2026-07-20T10:00:00.000Z' } } } } }));
  const jp = (ts) => ({ ts, bot_id: 'B1', blocks: [
    { type: 'section', text: { type: 'mrkdwn', text: 'Bonjour jeune <@U2>, <@U1> t\'a envoyé un Jeanpip ! :jeanpip:' } }, { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: `🖼️ *🔵 Surprise #3*\n<${url}|👉 Clique ici pour voir l'image>` } }] });
  const mock = path.join(TMP, 'slack-mock.js');
  fs.writeFileSync(mock, `
const Module = require('module');
const orig = Module._load;
const DM = { DU1: [${JSON.stringify(jp('1782036000.000100'))}], DU2: [${JSON.stringify(jp('1782381600.000100'))}, ${JSON.stringify(jp('1782986400.000100'))}, ${JSON.stringify(jp('1784973600.000100'))}] };
class WebClient {
  constructor() {
    this.auth = { test: async () => ({ user_id: 'UBOT' }) };
    this.users = { info: async ({ user }) => ({ user: { real_name: 'Joueur ' + user } }) };
    this.conversations = {
      list: async () => ({ channels: [{ user: 'U1' }, { user: 'U2' }, { user: 'USLACKBOT' }] }),
      open: async ({ users }) => ({ channel: { id: 'D' + users } }),
      history: async ({ channel, oldest, latest }) => ({ messages: (DM[channel] || []).filter((m) => Number(m.ts) >= Number(oldest) && Number(m.ts) <= Number(latest)) }),
      replies: async () => ({ messages: [] }),
    };
  }
}
Module._load = function (req, ...rest) {
  if (req === '@slack/web-api') return { WebClient };
  if (req === 'dotenv') return { config() {} };
  return orig.call(this, req, ...rest);
};
process.env.SLACK_BOT_TOKEN = 'xoxb-test';
`);
  const run = (...extra) => spawnSync(process.execPath, ['-r', mock, path.join(TMP, 'scripts', 'backfill-collections.js'),
    '--jeanpips', '--since=2026-06-17', '--until=2026-07-17T12:06:38Z', ...extra], { cwd: TMP, encoding: 'utf-8' });
  const read = () => JSON.parse(fs.readFileSync(path.join(TMP, 'data', 'collections.json'), 'utf-8'));

  const dry = run();
  check('simulation : 3 cartes annoncées', dry.status === 0 && /Total : 3 carte/.test(dry.stdout));
  check('simulation : rien écrit', read().users.U1.cards[url].count === 1 && !read().jeanpipBackfills);

  const apply = run('--apply');
  const after = read();
  check('écriture : exit 0', apply.status === 0);
  check('écriture : U1 +1 exemplaire, 1re obtention avancée au 21/06/2026', after.users.U1.cards[url].count === 2 && after.users.U1.cards[url].firstAt.startsWith('2026-06-21'));
  check('écriture : U2 reçoit 2 exemplaires (celui du 25/07, hors période, ignoré)', after.users.U2 && after.users.U2.cards[url].count === 2);
  check('écriture : période enregistrée', after.jeanpipBackfills && after.jeanpipBackfills.length === 1 && after.jeanpipBackfills[0].cards === 3);
  check('écriture : sauvegarde de collections.json créée', fs.readdirSync(path.join(TMP, 'data')).some((f) => f.startsWith('collections.json.bak-')));

  const again = run('--apply');
  check('2e écriture même période → refus, rien ajouté', again.status === 1 && /déjà rattrapés/.test(again.stderr) && read().users.U2.cards[url].count === 2);

  try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log(failures ? `\n❌ ${failures} échec(s)` : '\n🎉 Rattrapage des Jeanpips OK');
process.exit(failures ? 1 : 0);
