// ═══════════════════════════════════════════════════════════
//  🏠 Parcelles des maisons de la ville Jeanpip (v4.0)
//  Chaque joueur reçoit une parcelle (0, 1, 2…) à sa première demande,
//  puis la garde pour toujours : un désinscrit qui revient retrouve la
//  sienne, et une parcelle n'est jamais redonnée à quelqu'un d'autre.
//
//  DB = data/ville.json   { plots: { U123: 0, U456: 1 } }
//  Relu à chaque appel (petit fichier) : plusieurs instances du module
//  ne peuvent pas attribuer deux fois la même parcelle.
// ═══════════════════════════════════════════════════════════

const path = require('path');
const { readJson, writeJsonAtomic } = require('./storage');

const VILLE_PATH = path.join(__dirname, '..', 'data', 'ville.json');

function load() {
  const data = readJson(VILLE_PATH, { plots: {} });
  return data && data.plots && typeof data.plots === 'object' ? data : { plots: {} };
}

/** Attribue les parcelles manquantes (une seule écriture) → data.plots. */
function assign(userIds) {
  const data = load();
  let next = Math.max(-1, ...Object.values(data.plots).filter(Number.isInteger)) + 1;
  let changed = false;
  for (const userId of userIds) {
    if (Number.isInteger(data.plots[userId])) continue;
    data.plots[userId] = next;
    next += 1;
    changed = true;
  }
  if (changed) {
    try {
      writeJsonAtomic(VILLE_PATH, data);
    } catch (e) {
      console.error('[ville] écriture des parcelles :', e.message);
    }
  }
  return data.plots;
}

/** → numéro de parcelle du joueur (attribué à la première demande, puis fixe). */
function plotOf(userId) {
  return assign([userId])[userId];
}

/** → [{ userId, plot }] dans l'ordre des parcelles. */
function list(userIds) {
  const ids = [...new Set(userIds || [])];
  const plots = assign(ids);
  return ids.map((userId) => ({ userId, plot: plots[userId] })).sort((a, b) => a.plot - b.plot);
}

module.exports = { plotOf, list, VILLE_PATH };
