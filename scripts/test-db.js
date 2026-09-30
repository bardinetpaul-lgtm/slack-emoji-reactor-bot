#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test du socle SQLite (src/db.js)
//  Usage : node scripts/test-db.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-db-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const db = require(path.join(TMP, 'src', 'db.js'));
const conn = db.getDb();
check('le dossier data/ est créé', fs.existsSync(path.join(TMP, 'data', 'jeanpip.db')));
check('mode WAL', conn.pragma('journal_mode', { simple: true }) === 'wal');
const tables = conn.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
for (const t of ['schema_version', 'balances', 'credit_moves', 'events']) check(`table ${t}`, tables.includes(t));
check('version = SCHEMA_VERSION', conn.prepare('SELECT version FROM schema_version').get().version === db.SCHEMA_VERSION);
check('singleton', db.getDb() === conn);

let refused = false;
try { conn.prepare("INSERT INTO balances (user_id, balance) VALUES ('U', -1)").run(); } catch { refused = true; }
check('solde négatif refusé (CHECK)', refused);

conn.prepare("INSERT INTO events (at, type, dedup) VALUES ('2026-01-01T00:00:00Z', 'x', 'k1')").run();
const again = conn.prepare("INSERT OR IGNORE INTO events (at, type, dedup) VALUES ('2026-01-01T00:00:00Z', 'x', 'k1')").run();
check('dedup unique', again.changes === 0);

db.close();
const reopened = db.getDb();
check('réouverture : données conservées', reopened.prepare('SELECT COUNT(*) n FROM events').get().n === 1);
check('réouverture : une seule ligne schema_version', reopened.prepare('SELECT COUNT(*) n FROM schema_version').get().n === 1);
db.close();

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n🎉 Socle SQLite OK');
process.exit(failures ? 1 : 0);
