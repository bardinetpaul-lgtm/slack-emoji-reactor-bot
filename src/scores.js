// ═══════════════════════════════════════════════════════════
//  📊 MODULE SCORES
//  Gère les compteurs de :jeanpip: par utilisateur
//  DB = fichier JSON local (data/scores.json)
//  Semaine : Dimanche 20h → Dimanche 20h
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const SCORES_PATH = path.join(__dirname, '..', 'data', 'scores.json');
const ATTACK_THRESHOLD = 12; // Nombre de jeanpips pour débloquer l'attaque

// ─────────────────────────────────────────────
// 📦 Chargement / Sauvegarde
// ─────────────────────────────────────────────

function loadScores() {
  try {
    if (!fs.existsSync(SCORES_PATH)) {
      return { week_start: getLastSundayAt20h().toISOString(), users: {} };
    }
    return JSON.parse(fs.readFileSync(SCORES_PATH, 'utf-8'));
  } catch {
    return { week_start: getLastSundayAt20h().toISOString(), users: {} };
  }
}

function saveScores(data) {
  fs.writeFileSync(SCORES_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// ─────────────────────────────────────────────
// 📅 Calcul du dernier dimanche à 20h
// ─────────────────────────────────────────────

function getLastSundayAt20h() {
  const now = new Date();
  const day = now.getDay(); // 0 = dimanche
  const diff = day === 0 ? 0 : day;
  const lastSunday = new Date(now);
  lastSunday.setDate(now.getDate() - diff);
  lastSunday.setHours(20, 0, 0, 0);

  // Si on est dimanche mais avant 20h → on recule d'une semaine
  if (day === 0 && now.getHours() < 20) {
    lastSunday.setDate(lastSunday.getDate() - 7);
  }

  return lastSunday;
}

// ─────────────────────────────────────────────
// 🔄 Reset hebdomadaire
// ─────────────────────────────────────────────

function checkAndReset() {
  const data = loadScores();
  const lastSunday = getLastSundayAt20h();
  const weekStart = new Date(data.week_start);

  if (weekStart < lastSunday) {
    console.log('🔄 Reset hebdomadaire des scores Jeanpip !');
    data.week_start = lastSunday.toISOString();
    data.users = {};
    saveScores(data);
  }

  return data;
}

// ─────────────────────────────────────────────
// ➕ Incrémenter le score d'un user
// Retourne { score, justUnlocked }
// ─────────────────────────────────────────────

function incrementScore(userId) {
  const data = checkAndReset();

  if (!data.users[userId]) {
    data.users[userId] = { score: 0, hasAttack: false, notified: false };
  }

  const user = data.users[userId];
  user.score += 1;

  // Vérifier si on vient de débloquer l'attaque
  // On débloque si on passe le seuil ET qu'on n'a pas déjà une attaque
  let justUnlocked = false;
  if (user.score >= ATTACK_THRESHOLD && !user.hasAttack && !user.notified) {
    user.hasAttack = true;
    user.notified = true;
    justUnlocked = true;
  }

  saveScores(data);
  return { score: user.score, justUnlocked, hasAttack: user.hasAttack };
}

// ─────────────────────────────────────────────
// ✅ Vérifier si un user a une attaque disponible
// ─────────────────────────────────────────────

function hasAttack(userId) {
  const data = checkAndReset();
  const user = data.users[userId];
  return user ? user.hasAttack : false;
}

// ─────────────────────────────────────────────
// 💥 Consommer l'attaque (remet score à 0)
// ─────────────────────────────────────────────

function consumeAttack(userId) {
  const data = checkAndReset();

  if (!data.users[userId]) return false;

  const user = data.users[userId];
  if (!user.hasAttack) return false;

  // Reset score + attaque
  user.score = 0;
  user.hasAttack = false;
  user.notified = false;

  saveScores(data);
  return true;
}

// ─────────────────────────────────────────────
// 🎁 Créditer manuellement une attaque à un user (commande admin)
// Retourne true si l'attaque a été donnée, false si l'user l'avait déjà
// ─────────────────────────────────────────────

function giveAttack(userId) {
  const data = checkAndReset();

  if (!data.users[userId]) {
    data.users[userId] = { score: 0, hasAttack: false, notified: false };
  }

  const user = data.users[userId];

  // Si l'user a déjà une attaque dispo, on ne fait rien
  if (user.hasAttack) return false;

  user.hasAttack = true;
  user.notified = true; // évite une double notif par le flux normal

  saveScores(data);
  return true;
}

// ─────────────────────────────────────────────
// 📊 Récupérer le score d'un user
// ─────────────────────────────────────────────

function getScore(userId) {
  const data = checkAndReset();
  const user = data.users[userId];
  return user ? user.score : 0;
}

// ─────────────────────────────────────────────
// 📈 Compteur DURABLE pour le classement du dashboard
//    (indépendant du jeu : pas de reset au "consume", cumul all-time + semaine)
//    Fichier lu par le dashboard MagicDIMSI (même VM).
// ─────────────────────────────────────────────

const STATS_PATH = path.join(__dirname, '..', 'data', 'jeanpip-stats.json');

function recordHit(userId) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8'));
  } catch {
    data = { week_start: getLastSundayAt20h().toISOString(), allTime: {}, week: {} };
  }
  // Reset hebdo de la vue "semaine" uniquement (aligné dimanche 20h, comme le jeu).
  const lastSunday = getLastSundayAt20h();
  if (!data.week_start || new Date(data.week_start) < lastSunday) {
    data.week = {};
    data.week_start = lastSunday.toISOString();
  }
  data.allTime = data.allTime || {};
  data.week = data.week || {};
  data.allTime[userId] = (data.allTime[userId] || 0) + 1;
  data.week[userId] = (data.week[userId] || 0) + 1;
  data.updated = new Date().toISOString();
  try { fs.writeFileSync(STATS_PATH, JSON.stringify(data, null, 2), 'utf-8'); }
  catch (e) { console.error('[jeanpip-stats] écriture:', e.message); }
}

module.exports = {
  incrementScore,
  hasAttack,
  consumeAttack,
  giveAttack,
  getScore,
  checkAndReset,
  recordHit,
  ATTACK_THRESHOLD,
};
