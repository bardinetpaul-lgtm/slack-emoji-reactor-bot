#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  👀 Prévisualisation locale de la page d'ouverture FIFA (sans Slack)
//
//  Démarre le serveur web sur une COPIE temporaire du projet
//  (aucune donnée réelle touchée) et affiche 2 liens :
//    • un booster épique neuf (tirage réel, rejouable avec « Revoir »)
//    • une démo « légendaire » (cartes choisies, pour voir le walkout doré)
//
//  Usage : node scripts/preview-web-open.js [port]   (3100 par défaut)
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-preview-'));
const PORT = parseInt(process.argv[2], 10) || 3100;

fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), 'junction'); // éditions CSS/JS visibles en live
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

process.env.WEB_PUBLIC_URL = `http://127.0.0.1:${PORT}`;
process.env.WEB_SECRET = 'preview';

const web = require(path.join(TMP, 'src', 'web.js'));
const boosters = require(path.join(TMP, 'src', 'boosters.js'));
const media = require(path.join(TMP, 'src', 'media.js'));

const fakeClient = {
  chat: { update: async () => {} },
  files: { info: async () => { throw new Error('preview : pas de token Slack'); } },
};

// Booster neuf (tirage réel au premier chargement)
const fresh = boosters.createPending('U_PREVIEW', 'epic');

// Démo légendaire : 5 communes, 1 rare, 1 épique, 1 légendaire, déjà « ouvert en web »
const pick = (rarity, n) => media.getAllMedia().filter((m) => m.rarity === rarity).slice(0, n);
const demoCards = [...pick('common', 5), ...pick('rare', 1), ...pick('epic', 1), ...pick('legendary', 1)];
const demo = boosters.createPending('U_PREVIEW', 'epic');
boosters.markOpened(demo);
boosters.saveOpening(demo, { via: 'web', cards: demoCards, counts: [1, 2, 1, 3, 1, 1, 2, 1] });

web.startWebServer({ client: fakeClient, port: PORT });

console.log('\n👀 Prévisualisation :');
console.log(`   Booster épique neuf : ${web.buildOpenUrl(fresh, 'U_PREVIEW')}`);
console.log(`   Démo légendaire     : ${web.buildOpenUrl(demo, 'U_PREVIEW')}`);
console.log('   Ctrl+C pour arrêter\n');

process.on('SIGINT', () => {
  fs.unlinkSync(path.join(TMP, 'public')); // retirer le lien AVANT de supprimer (ne jamais toucher au vrai public/)
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(0);
});
