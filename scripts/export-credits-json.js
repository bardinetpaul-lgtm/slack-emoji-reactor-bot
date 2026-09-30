#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  ↩️ Export des soldes SQLite → credits.json (retour arrière)
//  À lancer AVANT de redéployer une version antérieure au passage
//  en SQLite, pour que personne ne perde ses crédits.
//  Sauvegarde l'éventuel credits.json existant en credits.json.bak-<date>.
//
//  Usage : node scripts/export-credits-json.js [--db data/jeanpip.db] [--out data/credits.json]
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : def;
};
const DATA = path.join(__dirname, '..', 'data');
const dbPath = arg('--db', path.join(DATA, 'jeanpip.db'));
const out = arg('--out', path.join(DATA, 'credits.json'));

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const users = {};
for (const r of db.prepare('SELECT user_id, balance FROM balances ORDER BY user_id').all()) users[r.user_id] = r.balance;
db.close();

if (fs.existsSync(out)) {
  const backup = `${out}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(out, backup);
  console.log(`💾 Ancien fichier sauvegardé : ${backup}`);
}
fs.writeFileSync(out, JSON.stringify({ users }, null, 2), 'utf-8');
console.log(`✅ ${Object.keys(users).length} solde(s) exporté(s) → ${out}`);
