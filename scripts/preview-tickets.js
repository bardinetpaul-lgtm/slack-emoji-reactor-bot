#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  👀 Prévisualisation locale du Kiosque à tickets (sans Slack)
//
//  Démarre le serveur web sur une COPIE temporaire du projet
//  (aucune donnée réelle touchée), crédite 500 JP$ à un joueur de
//  test et affiche son lien personnel.
//  Option --win=legendary|posts|whistle : force le lot des tickets achetés.
//
//  Usage : node scripts/preview-tickets.js [port] [--win=legendary]
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-preview-tickets-'));
const PORT = parseInt(process.argv.find((a) => /^\d+$/.test(a)), 10) || 3100;
const WIN = (process.argv.find((a) => a.startsWith('--win=')) || '').slice(6);

fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.symlinkSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), 'junction'); // éditions CSS/JS visibles en live
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

process.env.WEB_PUBLIC_URL = `http://127.0.0.1:${PORT}`;
process.env.WEB_SECRET = 'preview';

const web = require(path.join(TMP, 'src', 'web.js'));
const credits = require(path.join(TMP, 'src', 'credits.js'));
const scratch = require(path.join(TMP, 'src', 'scratch.js'));

if (WIN) {
  // 🎯 Lot forcé : drawOutcome renvoie toujours le lot demandé
  const prize = scratch.prizeTable(5).find((p) => p.symbol === WIN || p.kind === WIN);
  if (prize) scratch.drawOutcome = (price) => {
    const p = scratch.prizeTable(price).find((x) => x.symbol === prize.symbol);
    return { kind: p.kind, symbol: p.symbol, amount: p.amount || 0 };
  };
}

credits.addCredit('U_PREVIEW', 500, { source: 'preview' });
web.startWebServer({ client: { users: { info: async () => ({ user: {} }) } }, port: PORT });

console.log('\n👀 Kiosque à tickets :');
console.log(`   ${web.buildTicketsUrl('U_PREVIEW')}${WIN ? `   (lot forcé : ${WIN})` : ''}`);
console.log('   Ctrl+C pour arrêter\n');

process.on('SIGINT', () => {
  fs.unlinkSync(path.join(TMP, 'public')); // retirer le lien AVANT de supprimer (ne jamais toucher au vrai public/)
  try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(0);
});
