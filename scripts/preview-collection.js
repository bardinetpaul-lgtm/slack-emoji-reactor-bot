#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  👀 Prévisualisation locale du classeur Panini (sans Slack)
//
//  Démarre le serveur web sur une COPIE temporaire du projet
//  (aucune donnée réelle touchée), remplit un classeur de démo
//  puis ajoute une carte toutes les 12 s pour voir le direct.
//
//  Usage : node scripts/preview-collection.js [port]   (3100 par défaut)
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-album-'));
const PORT = parseInt(process.argv[2], 10) || 3100;

fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), 'junction'); // éditions CSS/JS visibles en live
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

process.env.WEB_PUBLIC_URL = `http://127.0.0.1:${PORT}`;
process.env.WEB_SECRET = 'preview';

const web = require(path.join(TMP, 'src', 'web.js'));
const collections = require(path.join(TMP, 'src', 'collections.js'));
const media = require(path.join(TMP, 'src', 'media.js'));
const { SPAM_CARDS } = require(path.join(TMP, 'src', 'spamCards.js'));

const fakeClient = {
  chat: { update: async () => {} },
  users: { info: async () => ({ user: { profile: { display_name: 'Paul' } } }) },
  files: { info: async () => { throw new Error('preview : pas de token Slack'); } },
};

// Classeur de démo : ~1 carte sur 2, quelques doublons
const all = media.getAllMedia();
const owned = all.filter((_, i) => i % 2 === 0 || i % 7 === 0);
collections.addCards('U_PREVIEW', owned, '2026-09-01T10:00:00.000Z');
collections.addCards('U_PREVIEW', owned.slice(0, 6), '2026-09-10T10:00:00.000Z');
collections.addCards('U_PREVIEW', SPAM_CARDS.slice(0, 4), '2026-09-12T10:00:00.000Z'); // 🚨 Hors série

// Le direct : une carte au hasard toutes les 12 s
setInterval(() => {
  const card = all[Math.floor(Math.random() * all.length)];
  const [count] = collections.addCards('U_PREVIEW', [card]);
  console.log(`   ➕ ${card.title} (×${count})`);
}, 12000);

web.startWebServer({ client: fakeClient, port: PORT });

console.log('\n👀 Classeur de démo (une carte arrive toutes les 12 s) :');
console.log(`   ${web.buildCollectionUrl('U_PREVIEW')}`);
console.log('   Ctrl+C pour arrêter\n');

process.on('SIGINT', () => {
  fs.unlinkSync(path.join(TMP, 'public')); // retirer le lien AVANT de supprimer (ne jamais toucher au vrai public/)
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(0);
});
