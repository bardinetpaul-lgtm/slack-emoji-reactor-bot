#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  📺 Aperçu de JP TV en local : combats simulés en boucle.
//  COPIE temporaire du projet (data/ réelle jamais touchée), deux
//  joueurs fictifs qui posent une carte au hasard toutes les 1,5 s.
//  Usage : node scripts/preview-tv.js   puis ouvrir l'URL affichée.
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-preview-tv-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

const PORT = parseInt(process.env.PREVIEW_PORT, 10) || 3199;
process.env.WEB_PUBLIC_URL = `http://127.0.0.1:${PORT}`;
process.env.WEB_SECRET = 'preview-secret';

const web = require(path.join(TMP, 'src', 'web.js'));
const matches = require(path.join(TMP, 'src', 'game', 'matches.js'));
const collections = require(path.join(TMP, 'src', 'collections.js'));
const media = require(path.join(TMP, 'src', 'media.js'));

const NAMES = { UA: 'Paul', UB: 'Julie', UC: 'Marc', UD: 'Léa' };
const client = { users: { info: async ({ user }) => ({ user: { profile: { display_name: NAMES[user] } } }) } };
const bank = media.getAllMedia();
['UA', 'UB', 'UC', 'UD'].forEach((u, i) => collections.addCards(u, bank.slice(i * 10, i * 10 + 10)));

web.startWebServer({ client, logger: console, port: PORT, force: true });

function launch(a, b) {
  const m = matches.createMatchFor(a, b, Date.now(), { arena: ['jardin', 'port', 'serveurs'][Math.floor(Math.random() * 3)] });
  if (!m.ok) return;
  for (const u of [a, b]) {
    matches.connect(m.id, u, Date.now());
    matches.setReady(m.id, u);
  }
}

// Une pose au hasard par joueur et par combat en cours, toutes les 1,5 s
setInterval(() => {
  for (const { id, status, players } of matches.listForTv()) {
    if (status !== 'running') continue;
    const m = matches.getMatch(id);
    for (const side of ['A', 'B']) {
      const p = m.engine.players[side];
      const url = p.hand.find((u) => p.cards[u].cost <= p.elixir);
      if (url) matches.action(id, players[side], { type: 'deploy', url, lane: Math.floor(Math.random() * 3) });
    }
  }
}, 1500);

// Toujours un combat UA/UB ; un second UC/UD de temps en temps (bandeau « Aussi en direct »)
setInterval(() => {
  if (!matches.isBusy('UA') && !matches.isBusy('UB')) launch('UA', 'UB');
  if (!matches.isBusy('UC') && !matches.isBusy('UD') && Math.random() < 0.3) launch('UC', 'UD');
}, 5000);
launch('UA', 'UB');

const urls = web.buildTvUrls();
console.log(`\n📺 JP TV (aperçu) : ${urls.page}\n📊 Synthèse       : ${urls.api}\n`);
process.on('SIGINT', () => { fs.rmSync(TMP, { recursive: true, force: true }); process.exit(0); });
