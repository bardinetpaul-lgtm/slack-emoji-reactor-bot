#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🕵️ Contrôle des combats arrangés dans l'Arène (v4.4.2) — LECTURE SEULE
//
//  Relit l'historique des combats (data/arena.json) et liste, par jour et par
//  paire de joueurs, les comportements de farm :
//    • beaucoup de combats entre les deux mêmes joueurs le même jour ;
//    • combats très courts (< 1 min) ou abandons ;
//    • victoires « chacun son tour » (A bat B, puis B bat A…) ;
//    • perdant sans aucune carte posée (connu depuis la v4.4.2 seulement) ;
//    • verdict du contrôle automatique (farm / suspect) depuis la v4.4.2 ;
//    • allers-retours sur toute la période : la paire alterne les victoires et
//      le perdant garde des cartes sans les jouer (connu depuis la v4.4.2).
//  N'écrit RIEN : on peut le lancer sur la VM sans risque.
//
//  Usage : node scripts/check-arena-farm.js [--days 7] [--file data/arena.json]
//  Sortie : les paires suspectes d'abord, avec un score ; puis un résumé.
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const DAYS = Number(arg('days', 7)) || 7;
const FILE = path.resolve(arg('file', path.join(__dirname, '..', 'data', 'arena.json')));
const SHORT_MS = 60 * 1000;

const parisDay = (ms) => new Date(ms).toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
const hour = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });

function analyzePairs(history, now = Date.now(), days = DAYS) {
  const since = now - days * 24 * 3600 * 1000;
  const groups = new Map();   // « jour|U1|U2 » → combats
  for (const h of history) {
    if (!h || h.draw || !h.winnerId || !h.loserId || h.at < since) continue;
    const [a, b] = [h.winnerId, h.loserId].sort();
    const key = `${parisDay(h.at)}|${a}|${b}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(h);
  }
  const rows = [];
  for (const [key, list] of groups) {
    const [day, a, b] = key.split('|');
    list.sort((x, y) => x.at - y.at);
    const winsA = list.filter((h) => h.winnerId === a).length;
    const winsB = list.length - winsA;
    const short = list.filter((h) => typeof h.durationMs === 'number' && h.durationMs < SHORT_MS).length;
    const forfeits = list.filter((h) => h.reason === 'forfeit').length;
    const noPlay = list.filter((h) => h.poses && h.poses[h.loserId] === 0).length;
    const flagged = list.filter((h) => h.farm).length;
    let switches = 0;
    for (let i = 1; i < list.length; i++) if (list[i].winnerId !== list[i - 1].winnerId) switches += 1;
    // Score : chaque signal pèse ; un combat isolé ne ressort jamais
    const score = (list.length >= 3 ? list.length : 0) + 2 * short + 2 * forfeits + 3 * noPlay + 2 * switches + 3 * flagged;
    rows.push({ day, a, b, n: list.length, winsA, winsB, short, forfeits, noPlay, switches, flagged, score, list });
  }
  return rows.sort((x, y) => y.score - x.score || y.n - x.n);
}

/** 🔁 Allers-retours sur toute la période, par paire : combats où le perdant n'a pas tout joué. */
function swingPairs(history, now = Date.now(), days = DAYS, min = 3) {
  const since = now - days * 24 * 3600 * 1000;
  const groups = new Map();
  for (const h of history) {
    if (!h || h.draw || !h.winnerId || !h.loserId || h.at < since) continue;
    if (!(h.unplayed && h.unplayed[h.loserId] > 0)) continue;
    const key = [h.winnerId, h.loserId].sort().join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(h);
  }
  const out = [];
  for (const [key, list] of groups) {
    list.sort((x, y) => x.at - y.at);
    let switches = 0;
    for (let i = 1; i < list.length; i++) if (list[i].winnerId !== list[i - 1].winnerId) switches += 1;
    if (switches >= min) {
      const [a, b] = key.split('|');
      out.push({ a, b, switches, list });
    }
  }
  return out.sort((x, y) => y.switches - x.switches);
}

function main() {
  if (!fs.existsSync(FILE)) { console.error(`Fichier introuvable : ${FILE}`); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const rows = analyzePairs(Array.isArray(data.history) ? data.history : []);
  const suspects = rows.filter((r) => r.score >= 5);
  console.log(`🕵️ Combats de l'Arène des ${DAYS} derniers jours (${rows.reduce((n, r) => n + r.n, 0)} victoires, ${rows.length} paires-jours)\n`);
  if (!suspects.length) console.log('✅ Aucune paire suspecte.');
  for (const r of suspects) {
    console.log(`⚠️  ${r.day} · ${r.a} ⚔️ ${r.b} · score ${r.score}`);
    console.log(`    ${r.n} combats · victoires ${r.winsA}–${r.winsB} · ${r.switches} changement(s) de vainqueur · ${r.short} < 1 min · ${r.forfeits} abandon(s) · ${r.noPlay} sans pose du perdant · ${r.flagged} signalé(s) par le contrôle`);
    console.log(`    ${r.list.map((h) => `${hour(h.at)} ${h.winnerId === r.a ? 'A' : 'B'}${typeof h.durationMs === 'number' ? ` ${Math.round(h.durationMs / 1000)}s` : ''}${h.poses ? ` (${h.poses[h.loserId]} pose${h.poses[h.loserId] > 1 ? 's' : ''})` : ''}${h.farm ? ` [${h.farm}]` : ''}`).join(' · ')}`);
  }
  const swingsFound = swingPairs(data.history || []);
  console.log(`\n🔁 Allers-retours (victoires chacun son tour, perdant avec des cartes non jouées, 3 changements de vainqueur ou plus) :`);
  if (!swingsFound.length) console.log('✅ Aucun.');
  for (const r of swingsFound) {
    console.log(`⚠️  ${r.a} ⇄ ${r.b} · ${r.switches} changements de vainqueur en ${r.list.length} combats`);
    console.log(`    ${r.list.map((h) => `${parisDay(h.at).slice(5)} ${hour(h.at)} ${h.winnerId === r.a ? 'A' : 'B'} (${h.unplayed[h.loserId]} non jouée${h.unplayed[h.loserId] > 1 ? 's' : ''})`).join(' · ')}`);
  }
  console.log('\nA = premier joueur de la ligne, B = second. Score ≥ 5 = à regarder. Rien n\'a été modifié.');
}

if (require.main === module) main();
module.exports = { analyzePairs, swingPairs };
