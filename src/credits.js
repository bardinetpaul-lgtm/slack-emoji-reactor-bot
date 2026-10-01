// ═══════════════════════════════════════════════════════════
//  💰 MODULE CREDITS
//  Porte-monnaie PERMANENT des utilisateurs (jamais de reset).
//  On gagne N crédit(s) à chaque réaction :jeanpip: posée (spam exclu),
//  N réglable par un admin (src/settings.js, défaut 0,5).
//  Les soldes peuvent donc être des demi-crédits (ex. 12.5).
//
//  DB = SQLite (src/db.js) : table `balances` + grand livre `credit_moves`.
//  Chaque variation de solde écrit son mouvement DANS LA MÊME transaction :
//  pour tout joueur, balance = SUM(credit_moves.amount), toujours.
//  `meta` = { source, item?, ref? } dit d'où vient / où part l'argent
//  (source absente → 'unknown', visible sur le dashboard /stats).
//
//  Migration : au 1er accès, data/credits.json (ancien stockage) est
//  importé (mouvements 'opening'), puis laissé intact et plus jamais écrit.
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');

const CREDITS_PATH = path.join(__dirname, '..', 'data', 'credits.json');
const MARKER_PATH = path.join(__dirname, '..', 'data', 'credits.json.imported');

let imported = false;

// ─────────────────────────────────────────────
// 📥 Import unique de l'ancien credits.json
// ─────────────────────────────────────────────

function readLegacyUsers() {
  if (!fs.existsSync(CREDITS_PATH)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(CREDITS_PATH, 'utf-8'));
    return data && typeof data.users === 'object' ? data.users : {};
  } catch (e) {
    throw new Error(`credits.json illisible, import annulé : ${e.message}`);
  }
}

// 🛡️ Marqueur d'import : après la migration, credits.json est figé. Si la base
//    disparaît (restauration incomplète, nouvelle VM…) ou si credits.json est
//    réécrit ensuite (retour arrière puis redéploiement), réimporter en silence
//    ferait perdre des crédits : on refuse de démarrer, avec la marche à suivre.
function readMarker() {
  try {
    return JSON.parse(fs.readFileSync(MARKER_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function checkNoStaleImport(db, marker) {
  const hasMoves = Boolean(db.prepare('SELECT 1 FROM credit_moves LIMIT 1').get());
  if (!hasMoves && marker) {
    throw new Error(`credits.json a déjà été importé le ${marker.at} mais la base est vide : `
      + 'restaurer data/jeanpip.db, ou supprimer data/credits.json.imported pour réimporter volontairement credits.json');
  }
  if (hasMoves && marker && fs.existsSync(CREDITS_PATH) && fs.statSync(CREDITS_PATH).mtimeMs > Date.parse(marker.at) + 1000) {
    throw new Error(`credits.json modifié après son import du ${marker.at} (retour arrière ?) : `
      + 'archiver data/jeanpip.db et supprimer data/credits.json.imported pour repartir de credits.json, ou restaurer credits.json');
  }
  return hasMoves;
}

function ensureImported() {
  if (imported) return;
  const db = getDb();
  if (!checkNoStaleImport(db, readMarker()) && fs.existsSync(CREDITS_PATH)) {
    const users = readLegacyUsers();
    const at = new Date().toISOString();
    let total = 0;
    let count = 0;
    db.transaction(() => {
      for (const [userId, value] of Object.entries(users)) {
        const balance = Math.max(0, Number(value) || 0);
        if (!balance) continue;
        db.prepare('INSERT INTO balances (user_id, balance) VALUES (?, ?)').run(userId, balance);
        db.prepare("INSERT INTO credit_moves (at, user_id, amount, kind, source) VALUES (?, ?, ?, 'opening', 'migration')").run(at, userId, balance);
        total += balance;
        count += 1;
      }
    })();
    fs.writeFileSync(MARKER_PATH, JSON.stringify({ at, users: count, total }, null, 2), 'utf-8');
    console.log(`💰 credits.json importé dans SQLite : ${count} solde(s), total ${total} JP$`);
  }
  imported = true;
}

// ─────────────────────────────────────────────
// ✍️ Écriture d'un mouvement (dans une transaction ouverte)
// ─────────────────────────────────────────────

function readBalance(db, userId) {
  const row = db.prepare('SELECT balance FROM balances WHERE user_id = ?').get(userId);
  return row ? row.balance : 0;
}

function writeMove(db, userId, newBalance, amount, kind, meta = {}) {
  db.prepare('INSERT INTO balances (user_id, balance) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET balance = excluded.balance')
    .run(userId, newBalance);
  db.prepare('INSERT INTO credit_moves (at, user_id, amount, kind, source, item, ref) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(new Date().toISOString(), userId, amount, kind, meta.source || 'unknown', meta.item ?? null, meta.ref ?? null);
}

// ─────────────────────────────────────────────
// ➕ Créditer 1 (ou N) crédit(s) — jamais de reset
//    Retourne le nouveau solde (inchangé si l'écriture échoue).
// ─────────────────────────────────────────────

function addCredit(userId, amount = 1, meta = {}) {
  ensureImported();
  const db = getDb();
  try {
    return db.transaction(() => {
      const balance = readBalance(db, userId);
      if (!amount) return balance;
      const next = balance + amount;
      writeMove(db, userId, next, amount, 'earn', meta);
      return next;
    })();
  } catch (e) {
    console.error('[credits] écriture:', e.message);
    return getBalance(userId);
  }
}

// ─────────────────────────────────────────────
// 💰 Solde d'un user
// ─────────────────────────────────────────────

function getBalance(userId) {
  ensureImported();
  return readBalance(getDb(), userId);
}

// ─────────────────────────────────────────────
// 🔧 Fixer le solde exact d'un user (jamais négatif).
//    Arrondi au demi-crédit. Corrections admin. Mouvement 'adjust' = écart.
// ─────────────────────────────────────────────

function setBalance(userId, value, meta = {}) {
  ensureImported();
  const db = getDb();
  const next = Math.max(0, Math.floor(value * 2) / 2);
  try {
    return db.transaction(() => {
      const balance = readBalance(db, userId);
      if (next !== balance) writeMove(db, userId, next, next - balance, 'adjust', meta);
      return next;
    })();
  } catch (e) {
    console.error('[credits] écriture:', e.message);
    return getBalance(userId);
  }
}

// ─────────────────────────────────────────────
// 💸 Dépenser `amount` crédits.
//    true si le solde suffisait (débit + mouvement écrits), false sinon.
// ─────────────────────────────────────────────

function spend(userId, amount, meta = {}) {
  ensureImported();
  const db = getDb();
  try {
    return db.transaction(() => {
      const balance = readBalance(db, userId);
      if (balance < amount) return false;
      if (amount) writeMove(db, userId, balance - amount, -amount, 'spend', meta);
      return true;
    })();
  } catch (e) {
    console.error('[credits] écriture:', e.message);
    return false;
  }
}

module.exports = {
  addCredit,
  getBalance,
  setBalance,
  spend,
  ensureImported,
};
