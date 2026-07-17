// ═══════════════════════════════════════════════════════════
//  🎪 MODULE TARGETS
//  Gère la liste des cibles auto-react de façon persistante
//  DB = fichier JSON local (data/auto-targets.json)
//
//  La liste finale = cibles du .env (TARGET_USER_IDS)
//                  + cibles ajoutées en live via /jeanpip-auto
//  Les cibles du .env sont toujours actives (non supprimables en live).
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const TARGETS_PATH = path.join(__dirname, '..', 'data', 'auto-targets.json');

// Cibles définies dans le .env (base, non modifiables en live)
const ENV_TARGETS = process.env.TARGET_USER_IDS
  ? process.env.TARGET_USER_IDS.split(',').map((id) => id.trim()).filter(Boolean)
  : [];

function loadDynamic() {
  try {
    if (!fs.existsSync(TARGETS_PATH)) return [];
    const data = JSON.parse(fs.readFileSync(TARGETS_PATH, 'utf-8'));
    return Array.isArray(data.targets) ? data.targets : [];
  } catch {
    return [];
  }
}

function saveDynamic(targets) {
  fs.writeFileSync(TARGETS_PATH, JSON.stringify({ targets }, null, 2), 'utf-8');
}

/**
 * Liste complète des cibles (env + dynamiques), sans doublon
 */
function getTargets() {
  const dynamic = loadDynamic();
  return [...new Set([...ENV_TARGETS, ...dynamic])];
}

/**
 * Vérifie si un user est une cible auto-react
 */
function isTarget(userId) {
  return getTargets().includes(userId);
}

/**
 * Ajoute une cible dynamique.
 * Retourne 'added' | 'already' | 'env' (déjà dans le .env)
 */
function addTarget(userId) {
  if (ENV_TARGETS.includes(userId)) return 'env';
  const dynamic = loadDynamic();
  if (dynamic.includes(userId)) return 'already';
  dynamic.push(userId);
  saveDynamic(dynamic);
  return 'added';
}

/**
 * Retire une cible dynamique.
 * Retourne 'removed' | 'not_found' | 'env' (protégée, dans le .env)
 */
function removeTarget(userId) {
  if (ENV_TARGETS.includes(userId)) return 'env';
  const dynamic = loadDynamic();
  if (!dynamic.includes(userId)) return 'not_found';
  saveDynamic(dynamic.filter((id) => id !== userId));
  return 'removed';
}

module.exports = {
  getTargets,
  isTarget,
  addTarget,
  removeTarget,
  ENV_TARGETS,
};
