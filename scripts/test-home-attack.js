#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test du bloc « Attaque Jeanpip » de l'Accueil (src/home.js, v2.2.1)
//
//  Chaque cas dit clairement s'il faut ACHETER l'attaque ou si elle
//  est DÉBLOQUÉE (gratuite), avec le bouton qui va avec.
//  Travaille dans une COPIE temporaire du projet.
//
//  Usage : node scripts/test-home-attack.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-home-attack-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

const origLog = console.log;
console.log = () => {};
const home = require(path.join(TMP, 'src', 'home.js'));
const credits = require(path.join(TMP, 'src', 'credits.js'));
const scores = require(path.join(TMP, 'src', 'scores.js'));
console.log = origLog;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const PRICE = 25;
const ctx = (extra = {}) => ({
  isAdmin: false, attackPrice: PRICE, creditsPerJeanpipLabel: '0,5', targetEmoji: 'jeanpip',
  farmRemainingMs: 0, farmQuota: { used: 0, max: 10, nextFreeMs: 0 }, formatRemaining: () => '12 min', ...extra,
});
/** Bloc « Attaque » de l'Accueil → { text, button } */
function attackBlock(userId, extra) {
  const b = home.buildHomeView(userId, ctx(extra)).blocks.find((x) => x.type === 'section' && x.text.text.includes('Ta semaine'));
  return { text: b.text.text, button: b.accessory || null };
}

// 💰 Pas débloquée, assez de JP$ → bouton d'ACHAT avec le prix
credits.addCredit('RICH', 40);
const rich = attackBlock('RICH');
check('à acheter : bouton « Acheter une attaque (25 JP$) »', rich.button && rich.button.text.text === '💰 Acheter une attaque (25 JP$)' && rich.button.action_id === 'home_attack_open');
check('à acheter : le texte dit qu\'elle n\'est pas débloquée et son prix', rich.text.includes('pas encore débloquée') && rich.text.includes('Achète-la pour 25 JP$'));
check('à acheter : comment la débloquer gratuitement', rich.text.includes('pour la débloquer gratuitement'));

// ❌ Pas débloquée, pas assez de JP$ → pas de bouton, il manque X JP$
credits.addCredit('POOR', 10);
const poor = attackBlock('POOR');
check('trop pauvre : aucun bouton', poor.button === null);
check('trop pauvre : il manque 15 JP$', poor.text.includes('il te manque *15* JP$'));

// 🎉 Débloquée → « Tu as débloqué une Attaque Jeanpip ! » + bouton gratuit
scores.giveAttack('FREE');
const free = attackBlock('FREE');
check('débloquée : « Tu as débloqué une Attaque Jeanpip ! »', free.text.includes('Tu as débloqué une Attaque Jeanpip') && free.text.includes('gratuite'));
check('débloquée : bouton « Lancer mon attaque gratuite »', free.button && free.button.text.text === '🎉 Lancer mon attaque gratuite');
check('débloquée : aucun prix affiché', !free.text.includes('JP$'));

// 👑 Admin
const admin = attackBlock('ADMIN', { isAdmin: true });
check('admin : illimitée + Lancer', admin.text.includes('illimitée') && admin.button && admin.button.text.text === '⚔️ Lancer une attaque');

// 🚜 Pénalité anti-farm : pas de bouton, même débloquée
const farm = attackBlock('FREE', { farmRemainingMs: 60000 });
check('anti-farm : aucun bouton', farm.button === null && farm.text.includes('Pénalité anti-farm'));

// 🪟 Modale : le bouton de validation dit « Acheter » quand on paie
check('modale à acheter : « Acheter (25 JP$) »', home.buildAttackModal('RICH', { isAdmin: false, attackPrice: PRICE }).submit.text === '💰 Acheter (25 JP$)');
check('modale débloquée : « Lancer », gratuite', (() => {
  const m = home.buildAttackModal('FREE', { isAdmin: false, attackPrice: PRICE });
  return m.submit.text === '⚔️ Lancer' && JSON.stringify(m.blocks).includes('Gratuite');
})());
check('modale : bouton de validation ≤ 24 caractères (limite Slack)', home.buildAttackModal('RICH', { isAdmin: false, attackPrice: 999 }).submit.text.length <= 24);

try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }   // Windows : fichier ouvert = non supprimable
fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
