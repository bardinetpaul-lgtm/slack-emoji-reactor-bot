// ═══════════════════════════════════════════════════════════
//  💾 MODULE STORAGE (écriture sûre des fichiers de données)
//  Tous les fichiers data/*.json sont réécrits en entier à chaque
//  sauvegarde. Un writeFileSync direct n'est PAS atomique : si la VM
//  tombe en pleine écriture, le fichier reste tronqué, la relecture
//  échoue, le module repart d'une structure vide… et la sauvegarde
//  suivante écrase les données de tout le monde.
//
//  • writeFileAtomic / writeJsonAtomic : écrit dans un fichier
//    temporaire voisin puis le renomme par-dessus la cible (rename =
//    atomique sur un même disque, Linux comme Windows) → la cible
//    contient toujours l'ancienne OU la nouvelle version, jamais un
//    morceau.
//  • readJson : fichier absent → valeur par défaut ; fichier illisible
//    → mis de côté en <fichier>.corrupt-<date> (JAMAIS supprimé, à
//    restaurer à la main), erreur bien visible dans les logs, puis
//    valeur par défaut. Un fichier abîmé n'est donc jamais écrasé.
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function tmpPath(file) {
  return `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
}

const SLEEP = new Int32Array(new SharedArrayBuffer(4));

/**
 * Windows (poste de dev) : un rename par-dessus un fichier encore ouvert
 * par un autre handle (antivirus, indexeur, lecture en cours) échoue
 * brièvement en EPERM / EACCES / EBUSY → on réessaie quelques fois
 * (≈ 1 s au total). Sous Linux (prod) le rename réussit du premier coup.
 */
function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      if (attempt >= 10 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
      Atomics.wait(SLEEP, 0, 0, 10 * (attempt + 1));
    }
  }
}

/**
 * Écrit `content` (string ou Buffer) dans `file` de façon atomique :
 * fichier temporaire voisin + rename. `options` = options de writeFileSync
 * (encoding, mode…). Lève l'erreur si l'écriture échoue (le fichier
 * temporaire est alors nettoyé, la cible reste intacte).
 */
function writeFileAtomic(file, content, options = undefined) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = tmpPath(file);
  try {
    const fd = fs.openSync(tmp, 'w', options && options.mode);
    try {
      fs.writeFileSync(fd, content, options && options.encoding ? { encoding: options.encoding } : undefined);
      fs.fsyncSync(fd); // données sur le disque AVANT le rename
    } finally {
      fs.closeSync(fd);
    }
    renameWithRetry(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* déjà absent */ }
    throw e;
  }
}

/** JSON.stringify(data, null, indent) écrit de façon atomique (indent 2 par défaut). */
function writeJsonAtomic(file, data, indent = 2) {
  writeFileAtomic(file, JSON.stringify(data, null, indent), { encoding: 'utf-8' });
}

/** Chemin libre pour la copie de côté d'un fichier abîmé. */
function corruptPath(file) {
  const stamp = new Date().toISOString().replace(/:/g, '-');
  let target = `${file}.corrupt-${stamp}`;
  if (fs.existsSync(target)) target = `${target}-${crypto.randomBytes(3).toString('hex')}`;
  return target;
}

/**
 * Lit un fichier JSON.
 *  - absent → `fallback`
 *  - lisible → contenu parsé
 *  - illisible / tronqué → fichier déplacé en <file>.corrupt-<date>
 *    (jamais supprimé), erreur loggée, puis `fallback`
 */
function readJson(file, fallback) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    console.error(`🚨🚨 [storage] ${file} : lecture impossible (${e.message}) → valeurs par défaut utilisées`);
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    const backup = corruptPath(file);
    let moved = false;
    try {
      fs.renameSync(file, backup);
      moved = true;
    } catch {
      try { fs.copyFileSync(file, backup); moved = true; } catch { /* rien de mieux à faire */ }
    }
    console.error(`🚨🚨 [storage] FICHIER DE DONNÉES CORROMPU : ${file} (${e.message}). `
      + (moved
        ? `Original conservé dans ${backup} — à restaurer à la main. Le bot repart avec des valeurs par défaut.`
        : 'IMPOSSIBLE de le mettre de côté : copier ce fichier immédiatement avant toute nouvelle écriture !'));
    return fallback;
  }
}

module.exports = { writeFileAtomic, writeJsonAtomic, readJson };
