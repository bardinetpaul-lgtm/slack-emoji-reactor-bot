// ═══════════════════════════════════════════════════════════
//  🗄️ MODULE BASE SQLITE
//  Une seule base pour le bot : data/jeanpip.db (mode WAL).
//  Crédits (soldes + grand livre) et journal d'événements des stats.
//  Le schéma est migré au premier accès (migrations versionnées,
//  chacune dans sa transaction) : ajouter une migration = pousser une
//  fonction à la fin de MIGRATIONS, ne jamais modifier les anciennes.
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'jeanpip.db');

const MIGRATIONS = [
  // v1 — crédits + journal
  (db) => db.exec(`
    CREATE TABLE balances (
      user_id TEXT PRIMARY KEY,
      balance REAL NOT NULL DEFAULT 0 CHECK (balance >= 0)
    );
    CREATE TABLE credit_moves (
      id      INTEGER PRIMARY KEY,
      at      TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount  REAL NOT NULL,
      kind    TEXT NOT NULL,
      source  TEXT NOT NULL,
      item    TEXT,
      ref     TEXT
    );
    CREATE INDEX credit_moves_at ON credit_moves(at);
    CREATE INDEX credit_moves_user ON credit_moves(user_id, at);
    CREATE TABLE events (
      id      INTEGER PRIMARY KEY,
      at      TEXT NOT NULL,
      type    TEXT NOT NULL,
      user_id TEXT,
      data    TEXT,
      dedup   TEXT UNIQUE
    );
    CREATE INDEX events_type_at ON events(type, at);
    CREATE INDEX events_user ON events(user_id, at);
  `),
];

let db = null;

function migrate(conn) {
  conn.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  let row = conn.prepare('SELECT version FROM schema_version').get();
  if (!row) {
    conn.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
    row = { version: 0 };
  }
  for (let v = row.version; v < MIGRATIONS.length; v += 1) {
    conn.transaction(() => {
      MIGRATIONS[v](conn);
      conn.prepare('UPDATE schema_version SET version = ?').run(v + 1);
    })();
  }
}

/** Connexion unique (ouverte et migrée au premier appel). Lève si la base est inutilisable. */
function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const conn = new Database(DB_PATH);
  conn.pragma('journal_mode = WAL');
  conn.pragma('busy_timeout = 2000');
  migrate(conn);
  db = conn;
  return db;
}

function close() {
  if (db) db.close();
  db = null;
}

module.exports = { getDb, close, DB_PATH, SCHEMA_VERSION: MIGRATIONS.length };
