#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Achat de booster partagé Slack / web (src/boosterPurchase.js, v4.0)
//  Dans une COPIE temporaire du projet, horloge simulée au jeudi 15/10
//  10h30 (Paris), stock Octobre Rose arrivé (3 par jour, 1 par personne) :
//    • solde insuffisant, booster inconnu ;
//    • booster à stock : refusé depuis un vieux DM, acheté via web et Slack,
//      jamais au-delà du stock ; canal noté dans les événements ;
//    • rafale de 5 clics en < 1 s → spam_lock, rien débité ;
//    • achat « trop rapide » (web) compté comme un clic ;
//    • aucun await : la fonction est synchrone (pas de dépassement de stock).
//  Usage : node scripts/test-booster-purchase.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-purchase-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

const RealDate = Date;
let NOW = RealDate.parse('2026-10-15T08:30:00Z');   // jeudi 10h30 à Paris
global.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(NOW); }
  static now() { return NOW; }
};

process.env.SLACK_SIGNING_SECRET = 'fake';

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const req = (m) => require(path.join(TMP, 'src', m));
const origLog = console.log;
console.log = () => {};
const { purchaseBooster, texts } = req('boosterPurchase.js');
const credits = req('credits.js');
const boosters = req('boosters.js');
const db = req('db.js').getDb();
console.log = origLog;

const lastEvent = (type, user) => {
  const row = db.prepare('SELECT data FROM events WHERE type = ? AND user_id = ? ORDER BY id DESC').get(type, user);
  return row ? JSON.parse(row.data) : null;
};

const rose = boosters.getBooster('octobre_rose');
check('le stock Octobre Rose du jour est arrivé (3)', boosters.stockLeft(rose) === 3 && boosters.purchaseBlock(rose, NOW, 'UA') === null);

// ── Booster inconnu, solde insuffisant ──
check('booster inconnu → unknown', purchaseBooster('UA', 'nope', { channel: 'web' }).status === 'unknown');
credits.setBalance('UA', 10);
const poor = purchaseBooster('UA', 'epic', { channel: 'slack' });
const epic = boosters.getBooster('epic');
check('solde insuffisant → insufficient', poor.status === 'insufficient' && poor.balance === 10 && poor.missing === epic.price - 10);
check('… solde inchangé, aucun booster créé', credits.getBalance('UA') === 10 && boosters.countPending('UA') === 0);
check('purchaseBooster est synchrone (aucun await entre contrôle et création)', !(poor instanceof Promise));

// ── Booster à stock ──
for (const u of ['UA', 'UB', 'UC', 'UD', 'UE', 'UF']) credits.setBalance(u, 500);
const dm = purchaseBooster('UA', 'octobre_rose', { channel: 'dm' });
check('booster à stock depuis un vieux DM → wrong_channel', dm.status === 'wrong_channel');
check('… rien débité, stock intact', credits.getBalance('UA') === 500 && boosters.stockLeft(rose) === 3);
check('… texte : Accueil du bot ou Boutique de Jeanpip City', /s'achète uniquement depuis l'onglet Accueil du bot ou la Boutique de Jeanpip City\.\* Son bouton y apparaît/.test(texts.wrongChannel(dm.booster)));

const web = purchaseBooster('UA', 'octobre_rose', { channel: 'web' });
check('booster à stock via le web → bought', web.status === 'bought' && /^b_/.test(web.id) && web.booster.type === 'octobre_rose');
check('… débité et solde renvoyé', web.balance === 500 - rose.price && credits.getBalance('UA') === web.balance);
check('… soldOut faux (il en reste 2)', web.soldOut === false && boosters.stockLeft(rose) === 2);
check('événement booster_bought avec channel web', (lastEvent('booster_bought', 'UA') || {}).channel === 'web');
check('événement booster_click avec channel web', (lastEvent('booster_click', 'UA') || {}).channel === 'web');

NOW += 4000;
const again = purchaseBooster('UA', 'octobre_rose', { channel: 'web' });
check('2e achat de UA le même jour → blocked user_limit', again.status === 'blocked' && again.blocked === 'user_limit' && credits.getBalance('UA') === web.balance);

const slack = purchaseBooster('UB', 'octobre_rose', { channel: 'slack' });
check('via Slack (Accueil) → bought, channel slack', slack.status === 'bought' && (lastEvent('booster_bought', 'UB') || {}).channel === 'slack');
const last = purchaseBooster('UC', 'octobre_rose', { channel: 'web' });
check('dernier du stock → bought avec soldOut', last.status === 'bought' && last.soldOut === true && boosters.stockLeft(rose) === 0);
const late = purchaseBooster('UD', 'octobre_rose', { channel: 'web' });
check('stock épuisé → blocked sold_out, rien débité', late.status === 'blocked' && late.blocked === 'sold_out' && credits.getBalance('UD') === 500);
check('texte « Plus de Booster … » identique à Slack', /^😢 \*Plus de Booster 🎀 Octobre Rose aujourd'hui !\* Les 3 du jour sont partis\.\n\n/.test(texts.blocked(late, 'UD', NOW)));

// ── Rafale : 5 clics en moins d'une seconde ──
let verdicts = [];
for (let i = 0; i < 5; i += 1) { verdicts.push(purchaseBooster('UE', 'octobre_rose', { channel: 'web' })); NOW += 100; }
check('clics 2 à 4 → spam_ignore', verdicts.slice(1, 4).every((v) => v.status === 'spam_ignore'));
const lock = verdicts[4];
check('5e clic en < 1 s → spam_lock 2 min', lock.status === 'spam_lock' && lock.verdict.minutes === 2);
check('… aucun JP$ débité', credits.getBalance('UE') === 500);
check('texte de blocage identique à Slack', /^🚫 \*Doucement !\* Tu as cliqué en rafale sur le Booster 🎀 Octobre Rose\./.test(texts.lock(lock).body));
NOW += 1000;
const during = purchaseBooster('UE', 'octobre_rose', { channel: 'web' });
check('pendant le blocage → spam_ignore (locked)', during.status === 'spam_ignore' && during.verdict.reason === 'locked');

// ── Achat web « trop rapide » (jeton remis il y a moins d'1 s) ──
NOW += 10000;
const fast = purchaseBooster('UF', 'octobre_rose', { channel: 'web', tooFast: true });
check('trop rapide (booster à stock) → too_fast, compté comme un clic', fast.status === 'too_fast' && (lastEvent('booster_click', 'UF') || {}).reason === 'too_fast');
let r = null;
for (let i = 0; i < 4; i += 1) { NOW += 100; r = purchaseBooster('UF', 'octobre_rose', { channel: 'web', tooFast: true }); }
check('… 5 achats trop rapides en rafale → spam_lock (même escalade que Slack)', r.status === 'spam_lock' && credits.getBalance('UF') === 500);
const fastCommon = purchaseBooster('UF', 'common', { channel: 'web', tooFast: true });
check('trop rapide (booster classique) → too_fast, rien débité', fastCommon.status === 'too_fast' && credits.getBalance('UF') === 500);

// ── Booster classique, Slack ──
const common = purchaseBooster('UF', 'common', { channel: 'dm' });
check('booster classique depuis un DM → bought (pas de règle de canal)', common.status === 'bought' && common.soldOut === false);

try { req('db.js').close(); } catch { /* déjà fermée */ }
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows */ }
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
