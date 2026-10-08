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
//  • readJson : fichier absent → valeur par défaut ; fichier abîmé
//    → mis de côté en <fichier>.corrupt-<date> (JAMAIS supprimé, à
//    restaurer à la main), erreur bien visible dans les logs, puis
//    valeur par défaut. Un fichier abîmé n'est donc jamais écrasé.
//  • Si le fichier ne peut ni être lu (droits, disque…) ni être mis
//    de côté, il est BLOQUÉ : toute écriture dessus est refusée tant
//    qu'une lecture n'a pas réussi (sinon la sauvegarde suivante
//    remplacerait les vraies données par une structure presque vide).
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Fichiers dont la dernière lecture a échoué sans copie de côté : écriture interdite. */
const unsafe = new Set();
const keyOf = (file) => path.resolve(file);

function tmpPath(file) {
  return `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
}

const SLEEP = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms) => Atomics.wait(SLEEP, 0, 0, ms);

/**
 * Windows (poste de dev) : un rename par-dessus un fichier encore ouvert
 * par un autre handle (antivirus, indexeur, lecture en cours) échoue
 * brièvement en EPERM / EACCES / EBUSY → on réessaie quelques fois
 * (≈ 0,55 s au total). Sous Linux (prod) le rename réussit du premier coup.
 */
function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      if (attempt >= 10 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
      sleep(10 * (attempt + 1));
    }
  }
}

/**
 * Écrit `content` (string ou Buffer) dans `file` de façon atomique :
 * fichier temporaire voisin + rename. `options` = options de writeFileSync
 * (encoding, mode…). Lève l'erreur si l'écriture échoue (le fichier
 * temporaire est alors nettoyé, la cible reste intacte), ou si la
 * dernière lecture de `file` a échoué (fichier bloqué, voir readJson).
 */
function writeFileAtomic(file, content, options = undefined) {
  if (unsafe.has(keyOf(file))) {
    throw new Error(`refus d'écrire ${file} : lecture précédente en échec (données d'origine protégées)`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = tmpPath(file);
  try {
    const fd = fs.openSync(tmp, 'wx', options && options.mode);
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

/** Lecture brute, 3 essais rapprochés si l'erreur n'est pas « fichier absent ». */
function readRaw(file) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return fs.readFileSync(file, 'utf-8');
    } catch (e) {
      if (e.code === 'ENOENT' || attempt >= 2) throw e;
      sleep(20 * (attempt + 1));
    }
  }
}

/**
 * Lit un fichier JSON.
 *  - absent → `fallback`
 *  - lisible → contenu parsé (BOM UTF-8 de tête ignoré)
 *  - tronqué / invalide → fichier déplacé (ou copié) en <file>.corrupt-<date>
 *    (jamais supprimé), erreur loggée, puis `fallback`
 *  - illisible, ou impossible à mettre de côté → erreur loggée, `fallback`,
 *    et le fichier est BLOQUÉ en écriture jusqu'à une lecture réussie.
 */
function readJson(file, fallback) {
  const key = keyOf(file);
  let raw;
  try {
    raw = readRaw(file);
  } catch (e) {
    if (e.code === 'ENOENT') {
      unsafe.delete(key);
      return fallback;
    }
    unsafe.add(key);
    console.error(`🚨🚨 [storage] ${file} : lecture impossible (${e.message}) → valeurs par défaut utilisées, `
      + 'ÉCRITURE BLOQUÉE sur ce fichier tant qu\'il reste illisible (données d\'origine protégées).');
    return fallback;
  }
  try {
    const value = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
    unsafe.delete(key);
    return value;
  } catch (e) {
    const backup = corruptPath(file);
    let saved = false;
    try {
      fs.renameSync(file, backup);
      saved = true;
    } catch {
      try { fs.copyFileSync(file, backup); saved = true; } catch { /* rien de mieux à faire */ }
    }
    if (saved) unsafe.delete(key);
    else unsafe.add(key);
    console.error(`🚨🚨 [storage] FICHIER DE DONNÉES CORROMPU : ${file} (${e.message}). `
      + (saved
        ? `Original conservé dans ${backup} — à restaurer à la main. Le bot repart avec des valeurs par défaut.`
        : 'IMPOSSIBLE de le mettre de côté : ÉCRITURE BLOQUÉE sur ce fichier, copier-le et le réparer à la main !'));
    return fallback;
  }
}

module.exports = { writeFileAtomic, writeJsonAtomic, readJson };
