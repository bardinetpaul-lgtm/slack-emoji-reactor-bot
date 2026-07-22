// ═══════════════════════════════════════════════════════════
//  📮 MODULE BROADCAST (liste de diffusion)
//  Gère qui accepte de RECEVOIR des Jeanpips des autres.
//
//  ⚠️ OPT-IN : par défaut personne n'est inscrit, donc personne
//     ne reçoit de Jeanpip venant des autres. Il faut s'inscrire
//     explicitement via la commande /jeanpip.
//
//  Ne concerne QUE la réception venant des autres :
//    • Tu reçois toujours TON Jeanpip quand tu réagis.
//    • Tes boosters et les punitions anti-spam ne sont pas affectés.
//
//  DB = fichier JSON local (data/subscribers.json)
//    { users: ["U123", "U456"] }
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const SUBSCRIBERS_PATH = path.join(__dirname, '..', 'data', 'subscribers.json');

// ─────────────────────────────────────────────
// 📦 Chargement / Sauvegarde
// ─────────────────────────────────────────────

function load() {
  try {
    if (!fs.existsSync(SUBSCRIBERS_PATH)) return { users: [] };
    const data = JSON.parse(fs.readFileSync(SUBSCRIBERS_PATH, 'utf-8'));
    return Array.isArray(data.users) ? data : { users: [] };
  } catch {
    return { users: [] };
  }
}

function save(data) {
  try {
    fs.writeFileSync(SUBSCRIBERS_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('[broadcast] écriture:', e.message);
  }
}

// ─────────────────────────────────────────────
// ✅ Est-ce que cette personne accepte de recevoir des Jeanpips ?
//    (false par défaut = opt-in)
// ─────────────────────────────────────────────

function isSubscribed(userId) {
  if (!userId) return false;
  return load().users.includes(userId);
}

// ─────────────────────────────────────────────
// ➕ Inscription. Retourne true si ajouté, false si déjà inscrit.
// ─────────────────────────────────────────────

function subscribe(userId) {
  const data = load();
  if (data.users.includes(userId)) return false;
  data.users.push(userId);
  save(data);
  return true;
}

// ─────────────────────────────────────────────
// ➖ Désinscription. Retourne true si retiré, false s'il n'y était pas.
// ─────────────────────────────────────────────

function unsubscribe(userId) {
  const data = load();
  if (!data.users.includes(userId)) return false;
  save({ users: data.users.filter((id) => id !== userId) });
  return true;
}

// ─────────────────────────────────────────────
// 📋 Liste complète des inscrits
// ─────────────────────────────────────────────

function getSubscribers() {
  return load().users;
}

module.exports = {
  isSubscribed,
  subscribe,
  unsubscribe,
  getSubscribers,
};
