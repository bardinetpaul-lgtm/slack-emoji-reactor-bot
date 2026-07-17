// ═══════════════════════════════════════════════════════════
//  💰 MODULE CREDITS
//  Porte-monnaie PERMANENT des utilisateurs (jamais de reset).
//  On gagne 1 crédit à chaque réaction :jeanpip: posée (spam exclu).
//  DB = fichier JSON local (data/credits.json)
//    { users: { U123: 42 } }
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const CREDITS_PATH = path.join(__dirname, '..', 'data', 'credits.json');

// ─────────────────────────────────────────────
// 📦 Chargement / Sauvegarde
// ─────────────────────────────────────────────

function load() {
  try {
    if (!fs.existsSync(CREDITS_PATH)) return { users: {} };
    const data = JSON.parse(fs.readFileSync(CREDITS_PATH, 'utf-8'));
    return data && typeof data.users === 'object' ? data : { users: {} };
  } catch {
    return { users: {} };
  }
}

function save(data) {
  try {
    fs.writeFileSync(CREDITS_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('[credits] écriture:', e.message);
  }
}

// ─────────────────────────────────────────────
// ➕ Créditer 1 (ou N) crédit(s) — jamais de reset
//    Retourne le nouveau solde.
// ─────────────────────────────────────────────

function addCredit(userId, amount = 1) {
  const data = load();
  data.users[userId] = (data.users[userId] || 0) + amount;
  save(data);
  return data.users[userId];
}

// ─────────────────────────────────────────────
// 💰 Solde d'un user
// ─────────────────────────────────────────────

function getBalance(userId) {
  const data = load();
  return data.users[userId] || 0;
}

// ─────────────────────────────────────────────
// 💸 Dépenser `amount` crédits.
//    Retourne true si le solde suffisait (débit effectué),
//    false sinon (rien débité).
// ─────────────────────────────────────────────

function spend(userId, amount) {
  const data = load();
  const balance = data.users[userId] || 0;
  if (balance < amount) return false;
  data.users[userId] = balance - amount;
  save(data);
  return true;
}

module.exports = {
  addCredit,
  getBalance,
  spend,
};
