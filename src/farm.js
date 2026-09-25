// ═══════════════════════════════════════════════════════════
//  🚜 MODULE FARM (état anti-farm PERSISTANT)
//  Historique des Jeanpips de l'heure glissante + pénalités en cours,
//  sauvegardés sur disque pour survivre aux redémarrages du bot
//  (sinon chaque redémarrage offrait un quota neuf et levait les pénalités).
//  La limite N est passée par l'appelant (réglable : src/settings.js).
//  DB = fichier JSON local (data/farm.json)
//    { history: { U123: [timestamps ms] }, penalties: { U123: fin_ms } }
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const FARM_PATH = path.join(__dirname, '..', 'data', 'farm.json');
const FARM_WINDOW_MS = 60 * 60 * 1000;   // fenêtre glissante : 1 heure
const FARM_PENALTY_MS = 60 * 60 * 1000;  // durée de la pénalité : 1 heure

// ─────────────────────────────────────────────
// 📦 Chargement / Sauvegarde
// ─────────────────────────────────────────────

function load() {
  try {
    if (!fs.existsSync(FARM_PATH)) return { history: {}, penalties: {} };
    const data = JSON.parse(fs.readFileSync(FARM_PATH, 'utf-8'));
    return {
      history: data && typeof data.history === 'object' ? data.history : {},
      penalties: data && typeof data.penalties === 'object' ? data.penalties : {},
    };
  } catch {
    return { history: {}, penalties: {} };
  }
}

function save(data) {
  try {
    fs.writeFileSync(FARM_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('[farm] écriture:', e.message);
  }
}

const inWindow = (timestamps, now) => (timestamps || []).filter((t) => now - t < FARM_WINDOW_MS);

// ─────────────────────────────────────────────
// ⏳ Temps de pénalité restant (0 si aucune).
//    Nettoie les pénalités expirées (et repart à zéro côté historique).
// ─────────────────────────────────────────────

function getPenaltyRemaining(userId, now = Date.now()) {
  const data = load();
  const until = data.penalties[userId];
  if (!until) return 0;
  if (until - now > 0) return until - now;
  delete data.penalties[userId];
  delete data.history[userId];
  save(data);
  return 0;
}

// ─────────────────────────────────────────────
// ➕ Enregistre un Jeanpip dans la fenêtre glissante.
//    Retourne true s'il fait dépasser `max` (→ pénalité de 1 h).
// ─────────────────────────────────────────────

function record(userId, max, now = Date.now()) {
  const data = load();
  const recent = inWindow(data.history[userId], now);
  recent.push(now);

  if (recent.length > max) {
    data.penalties[userId] = now + FARM_PENALTY_MS;
    delete data.history[userId];
    save(data);
    return true;
  }
  data.history[userId] = recent;
  save(data);
  return false;
}

// ─────────────────────────────────────────────
// 📊 Quota de l'heure : { used, max, nextFreeMs }
//    nextFreeMs = délai avant que le plus ancien Jeanpip ne sorte de la fenêtre.
// ─────────────────────────────────────────────

function getQuota(userId, max, now = Date.now()) {
  const recent = inWindow(load().history[userId], now);
  const nextFreeMs = recent.length ? Math.max(0, recent[0] + FARM_WINDOW_MS - now) : 0;
  return { used: recent.length, max, nextFreeMs };
}

// ─────────────────────────────────────────────
// 🧹 Fin de pénalité : efface pénalité + historique
// ─────────────────────────────────────────────

function clear(userId) {
  const data = load();
  delete data.penalties[userId];
  delete data.history[userId];
  save(data);
}

// ─────────────────────────────────────────────
// 📋 Pénalités encore actives (pour reprogrammer les notifs au démarrage)
// ─────────────────────────────────────────────

function listPenalties(now = Date.now()) {
  return Object.entries(load().penalties)
    .filter(([, until]) => until > now)
    .map(([userId, until]) => ({ userId, remainingMs: until - now }));
}

module.exports = {
  FARM_WINDOW_MS,
  FARM_PENALTY_MS,
  getPenaltyRemaining,
  record,
  getQuota,
  clear,
  listPenalties,
};
