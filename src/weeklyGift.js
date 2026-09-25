// ═══════════════════════════════════════════════════════════
//  🎁 MODULE WEEKLY GIFT (crédits JeanPip du vendredi)
//  Chaque vendredi 9h, chaque inscrit à la liste de diffusion reçoit
//  WEEKLY_AMOUNT crédits « à offrir » : ils ne vont PAS dans son
//  porte-monnaie, il doit les donner à d'autres inscrits (dons partiels
//  possibles). Ce qui n'est pas donné est perdu le vendredi suivant.
//  DB = fichier JSON local (data/weekly-gift.json)
//    { week_start: "<ISO du dernier vendredi 9h distribué>", users: { U123: 12 } }
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const credits = require('./credits');
const broadcast = require('./broadcast');

const WEEKLY_GIFT_PATH = path.join(__dirname, '..', 'data', 'weekly-gift.json');
const WEEKLY_AMOUNT = 20;

// ─────────────────────────────────────────────
// 📦 Chargement / Sauvegarde
// ─────────────────────────────────────────────

function load() {
  try {
    if (!fs.existsSync(WEEKLY_GIFT_PATH)) return null;
    const data = JSON.parse(fs.readFileSync(WEEKLY_GIFT_PATH, 'utf-8'));
    return data && typeof data.users === 'object' && data.week_start ? data : null;
  } catch {
    return null;
  }
}

function save(data) {
  try {
    fs.writeFileSync(WEEKLY_GIFT_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('[weeklyGift] écriture:', e.message);
  }
}

// ─────────────────────────────────────────────
// 📅 Dernier vendredi à 9h (heure locale, comme le reset du dimanche 20h)
// ─────────────────────────────────────────────

function getLastFridayAt9h(now = new Date()) {
  const friday = new Date(now);
  friday.setDate(now.getDate() - ((now.getDay() - 5 + 7) % 7));
  friday.setHours(9, 0, 0, 0);
  // Vendredi avant 9h → on recule d'une semaine
  if (friday > now) friday.setDate(friday.getDate() - 7);
  return friday;
}

/** Données de la semaine en cours, ou null si la distribution n'a pas encore eu lieu. */
function currentWeek(now) {
  const data = load();
  if (!data || new Date(data.week_start) < getLastFridayAt9h(now)) return null;
  return data;
}

// ─────────────────────────────────────────────
// 🎁 Distribution du vendredi 9h
//    Remet tout le monde à WEEKLY_AMOUNT (le non-donné est perdu).
//    Une seule fois par semaine ; rattrapée si le bot était éteint à 9h.
//    Au tout premier lancement : on note la semaine sans distribuer
//    (pas de distribution surprise au déploiement).
//    Retourne la liste des users crédités (vide si rien à faire).
// ─────────────────────────────────────────────

function distributeIfDue(subscribers, now = new Date()) {
  const lastFriday = getLastFridayAt9h(now);
  const data = load();

  if (!data) {
    save({ week_start: lastFriday.toISOString(), users: {} });
    return [];
  }
  if (new Date(data.week_start) >= lastFriday) return [];

  const users = {};
  for (const userId of subscribers) users[userId] = WEEKLY_AMOUNT;
  save({ week_start: lastFriday.toISOString(), users });
  return Object.keys(users);
}

// ─────────────────────────────────────────────
// 💰 Crédits encore à offrir cette semaine
// ─────────────────────────────────────────────

function getAllowance(userId, now = new Date()) {
  const data = currentWeek(now);
  return (data && data.users[userId]) || 0;
}

// ─────────────────────────────────────────────
// 💸 Offrir `amount` crédits (entier) à un autre inscrit.
//    Débite le solde à offrir, crédite le porte-monnaie du bénéficiaire.
//    Retourne { ok: true, remaining, recipientBalance }
//          ou { ok: false, error: 'soi' | 'non_inscrit' | 'montant' | 'solde' }.
// ─────────────────────────────────────────────

function give(fromId, toId, amount, now = new Date()) {
  if (fromId === toId) return { ok: false, error: 'soi' };
  if (!broadcast.isSubscribed(toId)) return { ok: false, error: 'non_inscrit' };
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, error: 'montant' };

  const data = currentWeek(now);
  const allowance = (data && data.users[fromId]) || 0;
  if (amount > allowance) return { ok: false, error: 'solde' };

  data.users[fromId] = allowance - amount;
  save(data);
  const recipientBalance = credits.addCredit(toId, amount);
  return { ok: true, remaining: data.users[fromId], recipientBalance };
}

module.exports = {
  WEEKLY_AMOUNT,
  getLastFridayAt9h,
  distributeIfDue,
  getAllowance,
  give,
};
