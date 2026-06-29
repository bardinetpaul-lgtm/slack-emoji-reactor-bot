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
// 📊 Récupérer le score d'un user
// ─────────────────────────────────────────────

function getScore(userId) {
  const data = checkAndReset();
  const user = data.users[userId];
  return user ? user.score : 0;
}

module.exports = {
  incrementScore,
  hasAttack,
  consumeAttack,
  getScore,
  checkAndReset,
  ATTACK_THRESHOLD,
};
