# 📊 Dashboard d'utilisation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tracer toute l'activité du jeu (crédits, réactions, boosters, cartes, combats) dans SQLite et l'afficher sur une page `/stats` admin avec graphiques et filtres.

**Architecture:** `src/db.js` ouvre `data/jeanpip.db` (better-sqlite3, WAL) ; `src/credits.js` passe en SQLite avec un grand livre `credit_moves` écrit dans la même transaction que le solde ; `src/events.js` journalise le reste. `src/stats/*` agrège en JS (fuseau Paris) ; `src/stats/web.js` sert l'API signée admin ; `public/stats.*` dessine avec Chart.js vendored.

**Tech Stack:** Node ≥ 18 (CommonJS), better-sqlite3, Chart.js 4 (fichier copié dans `public/vendor/`), serveur `http` natif existant, tests = scripts `node scripts/test-*.js` (✅/❌, exit code).

**Spec:** `docs/superpowers/specs/2026-09-29-dashboard-stats-design.md`

## Global Constraints

- Aucune règle du jeu ne change ; les signatures publiques existantes restent compatibles (nouveaux arguments **optionnels** uniquement).
- `data/credits.json` : importé une fois, **jamais supprimé ni renommé**, plus écrit ensuite (sauf par `scripts/export-credits-json.js`).
- `data/jeanpip-stats.json` continue d'être écrit (lu par MagicDIMSI).
- Écriture d'un événement qui échoue : `console.error` + le jeu continue. Crédits : solde et mouvement dans **une** transaction.
- Base SQLite indisponible au démarrage → le bot refuse de démarrer (message clair, exit 1).
- Page `/stats` : admins (`JEANPIP_ADMINS`) seulement, jeton signé HMAC expirant après **24 h**, revérification admin à chaque requête.
- Regroupements temporels en **Europe/Paris** ; granularités `day` | `week` (lundi) | `month`.
- Poids du score de booster : commun 1, rare 3, épique 8, légendaire 20.
- Chart.js servi depuis `public/vendor/` (aucun CDN).
- Style du code : français, en-têtes `// ═══` / `// ───` + emojis comme les modules existants.

## Review Focus

- Deux actions simultanées sur le même joueur (double clic achat) → jamais de solde modifié sans mouvement : test d'invariant `SUM(moves) = balance` après rafales (Task 2).
- `credits.json` corrompu au premier démarrage → refus de démarrer plutôt qu'une économie à zéro (Task 2).
- Paramètres d'URL farfelus (`from=abc`, `grain=year`, `user=<script>`, `to<from`) → 400, jamais 500 ni injection (Task 7 + Task 9).
- Lien stats expiré ou admin retiré de `JEANPIP_ADMINS` → 403 même avec une signature valide (Task 9).
- Relancer le rattrapage (ou le lancer après que le live a déjà enregistré des événements) → aucun doublon (Task 6).

---

## File Structure

| Fichier | Rôle |
|---|---|
| `src/db.js` (créé) | Ouverture de la base, migrations versionnées |
| `src/credits.js` (réécrit) | Soldes + grand livre SQLite, import de `credits.json` |
| `src/events.js` (créé) | `record()` idempotent, `boosterScore()` |
| `src/stats/time.js` (créé) | Filtres, buckets Paris, médiane, arrondis |
| `src/stats/economy.js` (créé) | Blocs Économie + Achats |
| `src/stats/game.js` (créé) | Blocs Boosters, Cartes, Arène, Activité |
| `src/stats/index.js` (créé) | `run(block, filters, opts)` + comparaison période précédente + `players()` |
| `src/stats/backfill.js` (créé) | Rattrapage depuis les JSON |
| `src/stats/web.js` (créé) | Jeton admin, routes `/stats` et `/api/stats/*` |
| `scripts/backfill-events.js`, `scripts/export-credits-json.js` (créés) | CLI prod |
| `public/stats.html|css|js`, `public/vendor/chart.umd.js` (créés) | Page |
| Modifiés | `package.json`, `.gitignore`, `src/app.js`, `src/admin.js`, `src/weeklyGift.js`, `src/game/settle.js`, `src/game/matches.js`, `src/openBooster.js`, `src/collections.js`, `src/media.js`, `src/web.js`, `src/home.js`, 28 scripts de test (lien `node_modules`), `README.md` |

---

### Task 1: Socle SQLite

**Files:**
- Modify: `package.json`, `.gitignore`
- Create: `src/db.js`, `scripts/test-db.js`
- Modify: les 28 scripts qui copient `src/` dans un dossier temporaire (liste ci-dessous)

**Interfaces:**
- Produces: `getDb(): Database` (singleton, schéma à jour), `close(): void`, `DB_PATH: string`, `SCHEMA_VERSION: number`. Tables : `schema_version`, `balances`, `credit_moves`, `events` (voir spec §5).

- [ ] **Step 1: Installer la dépendance**

```bash
npm install better-sqlite3@^11
```
Vérifier : `node -e "const D=require('better-sqlite3'); const d=new D(':memory:'); console.log(d.prepare('select sqlite_version() v').get())"` affiche une version. Si l'installation échoue (compilation native), STOP et remonter l'erreur : ne pas changer de librairie sans accord.

- [ ] **Step 2: Ignorer la base**

Ajouter à la fin du bloc « Données runtime » de `.gitignore` :
```
data/jeanpip.db
data/jeanpip.db-wal
data/jeanpip.db-shm
data/credits.json.bak-*
```

- [ ] **Step 3: Écrire le test qui échoue** — `scripts/test-db.js`

```js
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
```

- [ ] **Step 4: Lancer, vérifier l'échec**

Run: `node scripts/test-db.js` — Expected: crash `Cannot find module .../src/db.js`.

- [ ] **Step 5: Implémenter** — `src/db.js`

```js
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
```

- [ ] **Step 6: Lancer, vérifier le succès**

Run: `node scripts/test-db.js` — Expected: tous ✅, `🎉 Socle SQLite OK`.

- [ ] **Step 7: Lier `node_modules` dans les tests existants**

Les tests copient `src/` dans un dossier temporaire : sans lien, `require('better-sqlite3')` y échouera dès que `credits.js` l'utilisera (Task 2). Insérer, juste après la ligne `fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });`, la ligne :
```js
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
```
dans : `scripts/preview-collection.js scripts/preview-web-open.js scripts/simulate-balance.js scripts/test-app-booster.js scripts/test-app-spam.js scripts/test-app-weekly-gift.js scripts/test-arena-cards.js scripts/test-arena-cardtype.js scripts/test-arena-characters.js scripts/test-arena-deck.js scripts/test-arena-engine.js scripts/test-arena-looks.js scripts/test-arena-matches.js scripts/test-arena-mechanics.js scripts/test-arena-placement.js scripts/test-arena-progress.js scripts/test-arena-settle.js scripts/test-arena-shop.js scripts/test-arena-slack.js scripts/test-arena-store.js scripts/test-arena-targeting.js scripts/test-arena-tutorial.js scripts/test-arena-web.js scripts/test-collection.js scripts/test-farm.js scripts/test-media-author.js scripts/test-web-open.js scripts/test-weekly-gift.js`

Commande (Git Bash) :
```bash
for f in scripts/preview-collection.js scripts/preview-web-open.js scripts/simulate-balance.js scripts/test-app-*.js scripts/test-arena-cards.js scripts/test-arena-cardtype.js scripts/test-arena-characters.js scripts/test-arena-deck.js scripts/test-arena-engine.js scripts/test-arena-looks.js scripts/test-arena-matches.js scripts/test-arena-mechanics.js scripts/test-arena-placement.js scripts/test-arena-progress.js scripts/test-arena-settle.js scripts/test-arena-shop.js scripts/test-arena-slack.js scripts/test-arena-store.js scripts/test-arena-targeting.js scripts/test-arena-tutorial.js scripts/test-arena-web.js scripts/test-collection.js scripts/test-farm.js scripts/test-media-author.js scripts/test-web-open.js scripts/test-weekly-gift.js; do
  sed -i "/fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });/a fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');" "$f"
done
grep -c "node_modules'), 'junction'" scripts/*.js | grep -v ":0" | wc -l   # attendu : 29 (28 + test-db)
```
Si un script supprime `TMP` à la fin avec `fs.rmSync(TMP, { recursive: true })`, vérifier que le lien n'efface pas le vrai `node_modules` : `rmSync` supprime la jonction, pas sa cible (Node ≥ 16). Contrôle : `ls node_modules | head -1` après le Step 8.

- [ ] **Step 8: Toute la suite reste verte**

```bash
for f in scripts/test-*.js; do node "$f" > /tmp/out.txt 2>&1 || { echo "❌ $f"; tail -5 /tmp/out.txt; }; done; ls node_modules | head -1
```
Expected: aucune ligne `❌`, `node_modules` toujours présent.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json .gitignore src/db.js scripts/
git commit -m "🗄️ Socle SQLite (data/jeanpip.db) + tests liés à node_modules"
```

---

### Task 2: Crédits en SQLite avec grand livre

**Files:**
- Modify: `src/credits.js` (réécriture complète, même API)
- Create: `scripts/test-credits.js`, `scripts/export-credits-json.js`

**Interfaces:**
- Consumes: `getDb()` (Task 1).
- Produces:
  - `addCredit(userId, amount = 1, meta = {}) → number` (nouveau solde)
  - `spend(userId, amount, meta = {}) → boolean`
  - `setBalance(userId, value, meta = {}) → number`
  - `getBalance(userId) → number`
  - `ensureImported() → void` (lève si `credits.json` est illisible)
  - `meta = { source?: string, item?: string|null, ref?: string|null }` ; `source` absent → `'unknown'`.
  - `kind` écrit : `'earn'` (addCredit), `'spend'`, `'adjust'` (setBalance), `'opening'` (import, source `'migration'`).

- [ ] **Step 1: Écrire le test qui échoue** — `scripts/test-credits.js`

```js
#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test des crédits SQLite + grand livre (src/credits.js)
//  Usage : node scripts/test-credits.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

/** Projet temporaire neuf ; `creditsJson` = contenu de data/credits.json (ou null). */
function freshProject(creditsJson) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-credits-'));
  fs.cpSync(path.join(ROOT, 'src'), path.join(tmp, 'src'), { recursive: true });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'junction');
  fs.mkdirSync(path.join(tmp, 'data'));
  if (creditsJson !== null) fs.writeFileSync(path.join(tmp, 'data', 'credits.json'), creditsJson);
  return {
    tmp,
    credits: require(path.join(tmp, 'src', 'credits.js')),
    db: require(path.join(tmp, 'src', 'db.js')),
  };
}
const invariant = (conn) => conn.prepare(`
  SELECT COUNT(*) n FROM balances b
  WHERE ABS(b.balance - (SELECT COALESCE(SUM(amount), 0) FROM credit_moves m WHERE m.user_id = b.user_id)) > 1e-9`).get().n === 0;

// 1️⃣ Import de credits.json
{
  const { tmp, credits, db } = freshProject(JSON.stringify({ users: { UA: 42, UB: 12.5, UZ: 0 } }));
  check('import : solde UA', credits.getBalance('UA') === 42);
  check('import : demi-crédit UB', credits.getBalance('UB') === 12.5);
  const conn = db.getDb();
  const opening = conn.prepare("SELECT user_id, amount, source FROM credit_moves WHERE kind = 'opening' ORDER BY user_id").all();
  check('import : 2 mouvements opening (solde 0 ignoré)', opening.length === 2 && opening[0].source === 'migration');
  check('credits.json intact', JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'credits.json'), 'utf-8')).users.UA === 42);
  credits.ensureImported();
  check('import idempotent', conn.prepare("SELECT COUNT(*) n FROM credit_moves WHERE kind = 'opening'").get().n === 2);

  // 2️⃣ API inchangée + grand livre
  check('addCredit renvoie le nouveau solde', credits.addCredit('UA', 0.5, { source: 'reaction' }) === 42.5);
  check('addCredit défaut = 1', credits.addCredit('UC') === 1);
  const unknown = conn.prepare("SELECT source, kind FROM credit_moves WHERE user_id = 'UC'").get();
  check('meta absent → source unknown, kind earn', unknown.source === 'unknown' && unknown.kind === 'earn');
  check('spend OK', credits.spend('UA', 20, { source: 'booster', item: 'common', ref: 'b_1' }) === true);
  const sp = conn.prepare("SELECT amount, kind, source, item, ref FROM credit_moves WHERE kind = 'spend'").get();
  check('spend : mouvement négatif avec article', sp.amount === -20 && sp.source === 'booster' && sp.item === 'common' && sp.ref === 'b_1');
  const before = conn.prepare('SELECT COUNT(*) n FROM credit_moves').get().n;
  check('spend insuffisant → false', credits.spend('UB', 100, { source: 'booster' }) === false);
  check('spend insuffisant : aucun mouvement', conn.prepare('SELECT COUNT(*) n FROM credit_moves').get().n === before);
  check('spend insuffisant : solde intact', credits.getBalance('UB') === 12.5);
  check('setBalance arrondi au demi', credits.setBalance('UB', 3.7, { source: 'admin_adjust' }) === 3.5);
  const adj = conn.prepare("SELECT amount, kind FROM credit_moves WHERE kind = 'adjust'").get();
  check('setBalance : mouvement adjust = écart', adj.amount === -9 && adj.kind === 'adjust');
  check('setBalance jamais négatif', credits.setBalance('UB', -10, { source: 'admin_adjust' }) === 0);
  check('addCredit 0 : pas de mouvement', (() => { const n = conn.prepare('SELECT COUNT(*) n FROM credit_moves').get().n; credits.addCredit('UA', 0, { source: 'reaction' }); return conn.prepare('SELECT COUNT(*) n FROM credit_moves').get().n === n; })());
  check('solde inconnu = 0', credits.getBalance('U_NOBODY') === 0);

  // 3️⃣ Rafale : l'invariant tient toujours
  credits.setBalance('UR', 50, { source: 'admin_adjust' });
  let ok = 0;
  for (let i = 0; i < 200; i += 1) if (credits.spend('UR', 0.5, { source: 'booster', item: 'common' })) ok += 1;
  check('rafale : 100 débits acceptés puis refus', ok === 100 && credits.getBalance('UR') === 0);
  check('invariant balance = SUM(moves) pour tous', invariant(conn));
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 4️⃣ Pas de credits.json : démarrage vide
{
  const { tmp, credits, db } = freshProject(null);
  check('sans credits.json : solde 0', credits.getBalance('UA') === 0);
  check('sans credits.json : aucun mouvement', db.getDb().prepare('SELECT COUNT(*) n FROM credit_moves').get().n === 0);
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 5️⃣ credits.json corrompu : refus (on ne démarre pas avec une économie à zéro)
{
  const { tmp, credits, db } = freshProject('{ pas du json');
  let threw = false;
  try { credits.ensureImported(); } catch (e) { threw = /credits\.json/.test(e.message); }
  check('credits.json corrompu → ensureImported lève', threw);
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 6️⃣ Export pour retour arrière
{
  const { tmp, credits, db } = freshProject(JSON.stringify({ users: { UA: 10 } }));
  credits.addCredit('UA', 5, { source: 'reaction' });
  db.close();
  const { spawnSync } = require('child_process');
  const out = path.join(tmp, 'export.json');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'export-credits-json.js'), '--db', path.join(tmp, 'data', 'jeanpip.db'), '--out', out], { encoding: 'utf-8' });
  check('export : exit 0', r.status === 0);
  check('export : solde à jour', r.status === 0 && JSON.parse(fs.readFileSync(out, 'utf-8')).users.UA === 15);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? `\n❌ ${failures} échec(s)` : '\n🎉 Crédits SQLite OK');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `node scripts/test-credits.js` — Expected: ❌ sur `import : 2 mouvements opening` (l'ancien module ne touche pas SQLite) puis erreurs.

- [ ] **Step 3: Implémenter** — remplacer tout `src/credits.js`

```js
// ═══════════════════════════════════════════════════════════
//  💰 MODULE CREDITS
//  Porte-monnaie PERMANENT des utilisateurs (jamais de reset).
//  On gagne N crédit(s) à chaque réaction :jeanpip: posée (spam exclu),
//  N réglable par un admin (src/settings.js, défaut 0,5).
//  Les soldes peuvent donc être des demi-crédits (ex. 12.5).
//
//  DB = SQLite (src/db.js) : table `balances` + grand livre `credit_moves`.
//  Chaque variation de solde écrit son mouvement DANS LA MÊME transaction :
//  pour tout joueur, balance = SUM(credit_moves.amount), toujours.
//  `meta` = { source, item?, ref? } dit d'où vient / où part l'argent
//  (source absente → 'unknown', visible sur le dashboard /stats).
//
//  Migration : au 1er accès, data/credits.json (ancien stockage) est
//  importé (mouvements 'opening'), puis laissé intact et plus jamais écrit.
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');

const CREDITS_PATH = path.join(__dirname, '..', 'data', 'credits.json');

let imported = false;

// ─────────────────────────────────────────────
// 📥 Import unique de l'ancien credits.json
// ─────────────────────────────────────────────

function readLegacyUsers() {
  if (!fs.existsSync(CREDITS_PATH)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(CREDITS_PATH, 'utf-8'));
    return data && typeof data.users === 'object' ? data.users : {};
  } catch (e) {
    throw new Error(`credits.json illisible, import annulé : ${e.message}`);
  }
}

function ensureImported() {
  if (imported) return;
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM credit_moves LIMIT 1').get()) {
    const users = readLegacyUsers();
    const at = new Date().toISOString();
    db.transaction(() => {
      for (const [userId, value] of Object.entries(users)) {
        const balance = Math.max(0, Number(value) || 0);
        if (!balance) continue;
        db.prepare('INSERT INTO balances (user_id, balance) VALUES (?, ?)').run(userId, balance);
        db.prepare("INSERT INTO credit_moves (at, user_id, amount, kind, source) VALUES (?, ?, ?, 'opening', 'migration')").run(at, userId, balance);
      }
    })();
  }
  imported = true;
}

// ─────────────────────────────────────────────
// ✍️ Écriture d'un mouvement (dans une transaction ouverte)
// ─────────────────────────────────────────────

function readBalance(db, userId) {
  const row = db.prepare('SELECT balance FROM balances WHERE user_id = ?').get(userId);
  return row ? row.balance : 0;
}

function writeMove(db, userId, newBalance, amount, kind, meta = {}) {
  db.prepare('INSERT INTO balances (user_id, balance) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET balance = excluded.balance')
    .run(userId, newBalance);
  db.prepare('INSERT INTO credit_moves (at, user_id, amount, kind, source, item, ref) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(new Date().toISOString(), userId, amount, kind, meta.source || 'unknown', meta.item ?? null, meta.ref ?? null);
}

// ─────────────────────────────────────────────
// ➕ Créditer 1 (ou N) crédit(s) — jamais de reset
//    Retourne le nouveau solde (inchangé si l'écriture échoue).
// ─────────────────────────────────────────────

function addCredit(userId, amount = 1, meta = {}) {
  ensureImported();
  const db = getDb();
  try {
    return db.transaction(() => {
      const balance = readBalance(db, userId);
      if (!amount) return balance;
      const next = balance + amount;
      writeMove(db, userId, next, amount, 'earn', meta);
      return next;
    })();
  } catch (e) {
    console.error('[credits] écriture:', e.message);
    return getBalance(userId);
  }
}

// ─────────────────────────────────────────────
// 💰 Solde d'un user
// ─────────────────────────────────────────────

function getBalance(userId) {
  ensureImported();
  return readBalance(getDb(), userId);
}

// ─────────────────────────────────────────────
// 🔧 Fixer le solde exact d'un user (jamais négatif).
//    Arrondi au demi-crédit. Corrections admin. Mouvement 'adjust' = écart.
// ─────────────────────────────────────────────

function setBalance(userId, value, meta = {}) {
  ensureImported();
  const db = getDb();
  const next = Math.max(0, Math.floor(value * 2) / 2);
  try {
    return db.transaction(() => {
      const balance = readBalance(db, userId);
      if (next !== balance) writeMove(db, userId, next, next - balance, 'adjust', meta);
      return next;
    })();
  } catch (e) {
    console.error('[credits] écriture:', e.message);
    return getBalance(userId);
  }
}

// ─────────────────────────────────────────────
// 💸 Dépenser `amount` crédits.
//    true si le solde suffisait (débit + mouvement écrits), false sinon.
// ─────────────────────────────────────────────

function spend(userId, amount, meta = {}) {
  ensureImported();
  const db = getDb();
  try {
    return db.transaction(() => {
      const balance = readBalance(db, userId);
      if (balance < amount) return false;
      if (amount) writeMove(db, userId, balance - amount, -amount, 'spend', meta);
      return true;
    })();
  } catch (e) {
    console.error('[credits] écriture:', e.message);
    return false;
  }
}

module.exports = {
  addCredit,
  getBalance,
  setBalance,
  spend,
  ensureImported,
};
```

- [ ] **Step 4: Script d'export** — `scripts/export-credits-json.js`

```js
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
```

- [ ] **Step 5: Lancer les tests**

Run: `node scripts/test-credits.js` — Expected: tous ✅.
Puis la suite complète (commande du Task 1 Step 8) — Expected: aucun ❌ (les autres modules appellent `addCredit/spend/setBalance` sans `meta` : source `unknown`, comportement identique).

- [ ] **Step 6: Commit**

```bash
git add src/credits.js scripts/test-credits.js scripts/export-credits-json.js
git commit -m "💰 Crédits en SQLite : grand livre transactionnel + import de credits.json + export de secours"
```

---

### Task 3: Journal d'événements

**Files:**
- Create: `src/events.js`, `scripts/test-events.js`

**Interfaces:**
- Consumes: `getDb()`.
- Produces:
  - `record(type: string, userId: string|null, data: object = {}, { at?: string ISO, dedup?: string|null } = {}) → boolean` (true si inséré ; false si doublon ou erreur ; ne lève jamais)
  - `boosterScore(cards: Array<{rarity}>) → number`
  - `RARITY_WEIGHTS = { common: 1, rare: 3, epic: 8, legendary: 20 }`
  - Clés de dédup utilisées par tout le plan : `booster_created:<boosterId>`, `booster_opened:<boosterId>`, `disc:<userId>:<url>`, `added:<url>`, `match:<matchId>`.

- [ ] **Step 1: Écrire le test qui échoue** — `scripts/test-events.js`

```js
#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test du journal d'événements (src/events.js)
//  Usage : node scripts/test-events.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-events-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const events = require(path.join(TMP, 'src', 'events.js'));
const db = require(path.join(TMP, 'src', 'db.js'));

check('record → true', events.record('reaction', 'UA', { channel: 'C1' }) === true);
const row = db.getDb().prepare("SELECT * FROM events WHERE type = 'reaction'").get();
check('user + data JSON', row.user_id === 'UA' && JSON.parse(row.data).channel === 'C1');
check('date ISO par défaut', /^\d{4}-\d{2}-\d{2}T/.test(row.at));
check('date imposée', events.record('x', null, {}, { at: '2026-01-02T03:04:05.000Z' }) && db.getDb().prepare("SELECT at FROM events WHERE type = 'x'").get().at === '2026-01-02T03:04:05.000Z');
check('dedup : 1re fois insérée', events.record('card_discovered', 'UA', {}, { dedup: 'disc:UA:u1' }) === true);
check('dedup : 2e fois ignorée', events.record('card_discovered', 'UA', {}, { dedup: 'disc:UA:u1' }) === false);
check('sans dedup : doublons permis', events.record('reaction', 'UA') && db.getDb().prepare("SELECT COUNT(*) n FROM events WHERE type = 'reaction'").get().n === 2);

// Base fermée de force : ne lève jamais
const origError = console.error;
let logged = false;
console.error = () => { logged = true; };
db.getDb().close();
let threw = false;
try { events.record('reaction', 'UA'); } catch { threw = true; }
console.error = origError;
check('erreur SQLite : pas d’exception', !threw);
check('erreur SQLite : loggée', logged);

check('score booster', events.boosterScore([{ rarity: 'common' }, { rarity: 'rare' }, { rarity: 'epic' }, { rarity: 'legendary' }, { rarity: '???' }]) === 32);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n🎉 Journal OK');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Lancer, vérifier l'échec** — `node scripts/test-events.js` → `Cannot find module .../events.js`.

- [ ] **Step 3: Implémenter** — `src/events.js`

```js
// ═══════════════════════════════════════════════════════════
//  📒 MODULE JOURNAL D'ÉVÉNEMENTS (stats)
//  Une ligne datée par action du jeu : réaction, booster acheté /
//  gagné / ouvert, carte découverte / ajoutée, combat terminé.
//  Lu par le dashboard /stats (src/stats/).
//
//  N'interrompt JAMAIS le jeu : une erreur d'écriture est loggée et
//  record() renvoie false. `dedup` (clé unique) rend l'écriture
//  idempotente : le live et le rattrapage (src/stats/backfill.js)
//  utilisent les mêmes clés, donc jamais de doublon.
// ═══════════════════════════════════════════════════════════

const { getDb } = require('./db');

const RARITY_WEIGHTS = { common: 1, rare: 3, epic: 8, legendary: 20 };

function record(type, userId, data = {}, { at = new Date().toISOString(), dedup = null } = {}) {
  try {
    const r = getDb()
      .prepare('INSERT OR IGNORE INTO events (at, type, user_id, data, dedup) VALUES (?, ?, ?, ?, ?)')
      .run(at, type, userId || null, JSON.stringify(data), dedup);
    return r.changes === 1;
  } catch (e) {
    console.error(`[events] écriture ${type}:`, e.message);
    return false;
  }
}

/** Score d'un booster ouvert (meilleur booster = score le plus haut). */
function boosterScore(cards) {
  return (cards || []).reduce((sum, c) => sum + (RARITY_WEIGHTS[c && c.rarity] || 0), 0);
}

module.exports = { record, boosterScore, RARITY_WEIGHTS };
```

- [ ] **Step 4: Lancer** — `node scripts/test-events.js` → tous ✅.

- [ ] **Step 5: Commit**

```bash
git add src/events.js scripts/test-events.js
git commit -m "📒 Journal d'événements idempotent pour les stats"
```

---

### Task 4: Instrumentation des modules (crédits sourcés + événements)

**Files:**
- Modify: `src/weeklyGift.js:113`, `src/admin.js:78,91,126`, `src/game/settle.js:78-83`, `src/game/matches.js:211,222,241-265`, `src/openBooster.js:44-48`, `src/collections.js` (addCards + nouvelle `countCopies`), `src/media.js` (addMedia, après l'écriture du fichier)
- Create: `scripts/test-ledger-sources.js`

**Interfaces:**
- Consumes: `credits.*(…, meta)` (Task 2), `events.record`, `events.boosterScore` (Task 3).
- Produces:
  - `collections.countCopies(userId?: string|null) → number` (exemplaires possédés, tous joueurs si absent)
  - Événements : `booster_granted`, `booster_opened`, `card_discovered`, `card_added`, `match_finished` (forme exacte ci-dessous)
  - `match_finished.data = { matchId, result: 'win'|'draw'|'cancelled', players: [{ userId, outcome: 'win'|'loss'|'draw'|'cancelled', deck: [{url,title,rarity,rented}]|null }], loot: {url,title,rarity}|null }`
  - `match.players[side].played` (tableau `deck` ci-dessus) posé au lancement du combat.

- [ ] **Step 1: Écrire le test qui échoue** — `scripts/test-ledger-sources.js`

```js
#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Chaque mouvement de crédits a sa source, chaque action son événement
//  Usage : node scripts/test-ledger-sources.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-ledger-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}
const origLog = console.log;
console.log = () => {};
const req = (p) => require(path.join(TMP, 'src', p));
const credits = req('credits.js');
const db = req('db.js');
const broadcast = req('broadcast.js');
const weeklyGift = req('weeklyGift.js');
const collections = req('collections.js');
const boosters = req('boosters.js');
const media = req('media.js');
const { openOnce } = req('openBooster.js');
const { settleMatch } = req('game/settle.js');
const { createAdminActions } = req('admin.js');
console.log = origLog;

const conn = db.getDb();
const move = (where) => conn.prepare(`SELECT * FROM credit_moves WHERE ${where} ORDER BY id DESC`).get();
const event = (type) => conn.prepare('SELECT * FROM events WHERE type = ? ORDER BY id DESC').get(type);
const quiet = { info() {}, warn() {}, error() {} };

(async () => {
  // 🎁 Crédits du vendredi
  broadcast.subscribe('UA');
  broadcast.subscribe('UB');
  const fri = new Date(2026, 8, 25, 9, 5);
  weeklyGift.distributeIfDue(broadcast.getSubscribers(), new Date(2026, 8, 24, 12));
  weeklyGift.distributeIfDue(broadcast.getSubscribers(), fri);
  weeklyGift.give('UA', 'UB', 5, new Date(2026, 8, 26, 10));
  const wg = move("user_id = 'UB'");
  check('cadeau du vendredi → earn/weekly_gift', wg && wg.kind === 'earn' && wg.source === 'weekly_gift' && wg.amount === 5);

  // 👑 Admin : don, correction, auteur de média
  const fakeClient = {
    users: { info: async () => ({ user: { is_bot: false } }) },
    conversations: { open: async () => ({ channel: { id: 'D' } }) },
    chat: { postMessage: async () => ({ ok: true }) },
  };
  const admin = createAdminActions({ client: fakeClient });
  if (typeof admin.giveCredits === 'function') {
    await admin.giveCredits('U_ADMIN', 'UC', 10, quiet);
    const gift = move("user_id = 'UC' AND kind = 'earn'");
    check('don admin → admin_gift', gift && gift.source === 'admin_gift' && gift.ref === 'U_ADMIN');
    await admin.giveCredits('U_ADMIN', 'UC', -4, quiet);
    const adj = move("user_id = 'UC' AND kind = 'adjust'");
    check('correction admin → adjust/admin_adjust', adj && adj.source === 'admin_adjust' && adj.amount === -4);
  } else {
    check('createAdminActions expose la fonction de crédits (adapter le nom dans ce test)', false);
  }
  const addRes = admin.addMediaToBank('U_ADMIN', { url: 'https://example.test/new.png', rarity: 'rare', authorId: 'UD' }, quiet);
  const author = move("user_id = 'UD'");
  check('auteur de média → media_author/rare', addRes.ok && author && author.source === 'media_author' && author.item === 'rare');
  const added = event('card_added');
  check('média ajouté → card_added', added && JSON.parse(added.data).url === 'https://example.test/new.png' && added.dedup === 'added:https://example.test/new.png');

  // 🃏 Découverte de carte (une seule fois par joueur et par carte)
  collections.addCards('UE', [{ url: 'u1', title: 'A', rarity: 'epic', type: 'image' }, { url: 'u1', title: 'A', rarity: 'epic', type: 'image' }]);
  collections.removeCards('UE', ['u1', 'u1']);
  collections.addCards('UE', [{ url: 'u1', title: 'A', rarity: 'epic', type: 'image' }]);
  check('card_discovered une seule fois', conn.prepare("SELECT COUNT(*) n FROM events WHERE type = 'card_discovered' AND user_id = 'UE'").get().n === 1);
  check('countCopies(user)', collections.countCopies('UE') === 1);
  check('countCopies() tous joueurs ≥ 1', collections.countCopies() >= 1);

  // 🎴 Ouverture de booster
  const id = boosters.createPending('UF', 'rare');
  const opened = openOnce(id, 'UF', 'web');
  const ev = event('booster_opened');
  const data = ev && JSON.parse(ev.data);
  check('booster_opened', opened.status === 'opened' && ev.user_id === 'UF' && data.boosterType === 'rare' && data.cards.length === opened.cards.length && data.via === 'web');
  check('booster_opened : score', data.score > 0 && ev.dedup === `booster_opened:${id}`);

  // ⚔️ Règlement d'un combat : récompense + booster gagné
  collections.addCards('UH', [{ url: 'm1', title: 'M', rarity: 'common', type: 'image' }]);
  settleMatch({
    matchId: 'mtest',
    players: { A: 'UG', B: 'UH' },
    result: { winner: 'A', poses: [{ side: 'B', url: 'm1', title: 'M', rarity: 'common', status: 'alive' }] },
  }, { random: () => 0, now: Date.parse('2026-09-28T10:00:00Z') });
  const rew = move("user_id = 'UG'");
  check('récompense arène → arena_reward', rew && rew.source === 'arena_reward' && rew.ref === 'mtest');
  const granted = event('booster_granted');
  check('booster_granted', granted && granted.user_id === 'UG' && JSON.parse(granted.data).reason === 'arena');

  // ❓ Plus aucun mouvement 'unknown' pour ces flux
  check('aucune source unknown', conn.prepare("SELECT COUNT(*) n FROM credit_moves WHERE source = 'unknown'").get().n === 0);

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failures ? `\n❌ ${failures} échec(s)` : '\n🎉 Sources et événements OK');
  process.exit(failures ? 1 : 0);
})();
```

Avant de lancer : ouvrir `src/admin.js`, repérer le nom de la fonction retournée par `createAdminActions` qui contient le code des lignes 70-95 (don / correction de crédits) et sa signature ; adapter les deux appels `admin.giveCredits(...)` du test à ce nom et à cet ordre d'arguments exacts (ne pas renommer la fonction de prod).

- [ ] **Step 2: Lancer, vérifier l'échec** — `node scripts/test-ledger-sources.js` → ❌ sur les sources (`unknown`) et les événements absents.

- [ ] **Step 3: Implémenter les sources de crédits**

`src/weeklyGift.js` ligne 113 :
```js
  const recipientBalance = credits.addCredit(toId, amount, { source: 'weekly_gift', ref: fromId });
```
`src/admin.js` ligne 78 :
```js
      const newBalance = credits.addCredit(targetId, amount, { source: 'admin_gift', ref: adminId });
```
ligne 91 :
```js
    const newBalance = credits.setBalance(targetId, before + amount, { source: 'admin_adjust', ref: adminId }); // amount négatif
```
ligne 126 :
```js
      const newBalance = credits.addCredit(authorId, reward, { source: 'media_author', item: rarity, ref: url });
```
`src/game/matches.js` ligne 211 :
```js
      if (!card || !credits.spend(p.userId, price, { source: 'arena_shop', item: rarity, ref: match.id })) continue;   // solde insuffisant : l'achat saute
```

- [ ] **Step 4: Implémenter les événements**

`src/game/settle.js` — ajouter `const events = require('../events');` sous les autres `require`, puis remplacer le bloc « 🎁 Pack + crédits » :
```js
  // 🎁 Pack + crédits (plafonnés)
  if (arenaStore.consumeReward(w.userId, l.userId, now)) {
    w.rewarded = true;
    w.boosterId = boosters.createPending(w.userId, REWARD_BOOSTER);
    events.record('booster_granted', w.userId, { boosterId: w.boosterId, boosterType: REWARD_BOOSTER, reason: 'arena' },
      { at: new Date(now).toISOString(), dedup: `booster_created:${w.boosterId}` });
    credits.addCredit(w.userId, REWARD_CREDITS, { source: 'arena_reward', ref: matchId });
    w.credits = REWARD_CREDITS;
  }
```

`src/openBooster.js` — ajouter `const events = require('./events');` puis remplacer la fin de `openOnce` :
```js
  const cards = boosters.openBooster(pending.type);
  const counts = collections.addCards(pending.owner, cards);
  boosters.saveOpening(id, { via, cards, counts });
  events.record('booster_opened', pending.owner, {
    boosterId: id,
    boosterType: pending.type,
    via,
    cards: cards.map((c) => ({ url: c.url, title: c.title, rarity: c.rarity })),
    score: events.boosterScore(cards),
  }, { dedup: `booster_opened:${id}` });

  return { status: 'opened', pending, via, cards, counts };
```

`src/collections.js` — ajouter `const events = require('./events');` sous `const path = require('path');` ; dans `addCards`, déclarer `const discovered = [];` avant `const counts = cards.map(...)`, ajouter `discovered.push(card);` juste avant le `return 1;` final du `map`, et après `save(data);` :
```js
  for (const card of discovered) {
    events.record('card_discovered', userId, { url: card.url, title: card.title, rarity: card.rarity },
      { at: now, dedup: `disc:${userId}:${card.url}` });
  }
```
Puis ajouter la fonction (et l'exporter) :
```js
// ─────────────────────────────────────────────
// 🔢 Exemplaires possédés (un joueur, ou tous) — dashboard /stats
// ─────────────────────────────────────────────

function countCopies(userId = null) {
  const data = load();
  const users = userId ? [data.users[userId]].filter(Boolean) : Object.values(data.users);
  return users.reduce((sum, u) => sum + Object.values(u.cards).reduce((s, c) => s + (c.count || 0), 0), 0);
}
```

`src/media.js` — ajouter `const events = require('./events');` en tête ; dans `addMedia`, juste après le bloc `try { fs.writeFileSync(CUSTOM_BANK_PATH …) } catch …` et avant le `return { ok: true, … }` :
```js
  events.record('card_added', author || null, { url: media.url, title: media.title, rarity }, { dedup: `added:${media.url}` });
```

`src/game/matches.js` — ajouter `const events = require('../events');` en tête. Dans la boucle de lancement, juste après `p.deckUrls = urls;` (ligne ~222) :
```js
    p.played = deck.map((c) => ({ url: c.url, title: c.title, rarity: c.rarity, rented: Boolean(c.rented) }));
```
Ajouter la fonction avant `function finish` :
```js
// 📒 Journal des stats : un événement par combat terminé ou annulé
function recordMatchEvent(match, cancelled, now) {
  const winner = !cancelled && match.engine && match.engine.result ? match.engine.result.winner : null;
  const result = cancelled ? 'cancelled' : winner ? 'win' : 'draw';
  const players = ['A', 'B'].map((side) => ({
    userId: match.players[side].userId,
    outcome: cancelled ? 'cancelled' : !winner ? 'draw' : winner === side ? 'win' : 'loss',
    deck: match.players[side].played || null,
  }));
  const side = winner && match.summary && match.summary[winner];
  const loot = side && side.loot ? { url: side.loot.url, title: side.loot.title, rarity: side.loot.rarity } : null;
  events.record('match_finished', null, { matchId: match.id, result, players, loot },
    { at: new Date(now).toISOString(), dedup: `match:${match.id}` });
}
```
Dans `finish(match, now)` et `cancel(match, reason, now)`, ajouter juste avant `broadcast(match);` respectivement :
```js
  recordMatchEvent(match, false, now);
```
```js
  recordMatchEvent(match, true, now);
```

- [ ] **Step 5: Test de `match_finished`** — ajouter à la fin de `scripts/test-arena-matches.js`, avant son résumé final, une vérification (le fichier crée déjà des combats qu'il termine ; repérer la variable de match terminé et adapter `matchId`) :
```js
{
  const conn = require(path.join(TMP, 'src', 'db.js')).getDb();
  const rows = conn.prepare("SELECT data FROM events WHERE type = 'match_finished'").all().map((r) => JSON.parse(r.data));
  check('match_finished enregistré pour chaque combat terminé/annulé', rows.length > 0);
  const played = rows.find((d) => d.result !== 'cancelled');
  check('match_finished : decks joués présents', !played || played.players.every((p) => Array.isArray(p.deck) && p.deck.length > 0));
  check('match_finished : issue cohérente', rows.every((d) => d.players.length === 2 && d.players.every((p) => ['win', 'loss', 'draw', 'cancelled'].includes(p.outcome))));
}
```
(utiliser la fonction de vérification du fichier, qu'elle s'appelle `check` ou autrement.)

- [ ] **Step 6: Lancer** — `node scripts/test-ledger-sources.js` puis `node scripts/test-arena-matches.js` puis toute la suite (commande Task 1 Step 8). Expected: tous ✅.

- [ ] **Step 7: Commit**

```bash
git add src/ scripts/test-ledger-sources.js scripts/test-arena-matches.js
git commit -m "📒 Sources des crédits + événements boosters, cartes, combats"
```

---

### Task 5: Instrumentation de `app.js` + garde au démarrage

**Files:**
- Modify: `src/app.js` (en-tête ~l.28, réaction ~l.493, attaque ~l.697, achat booster ~l.1050-1070)
- Modify: `scripts/test-app-booster.js`, `scripts/test-app-spam.js`

**Interfaces:**
- Consumes: `credits.ensureImported()`, `getDb()`, `events.record`.
- Produces: événements `reaction` (`{ channel }`), `booster_bought` (`{ boosterId, boosterType, price }`, dedup `booster_created:<id>`) ; mouvements `reaction`, `booster/<type>`, `attack`.

- [ ] **Step 1: Tests qui échouent**

Dans `scripts/test-app-booster.js`, juste après la ligne `check(buyMsg.text.includes('acheté'), 'achat OK');` :
```js
  {
    const conn = require(path.join(TMP, 'src', 'db.js')).getDb();
    const mv = conn.prepare("SELECT * FROM credit_moves WHERE kind = 'spend' ORDER BY id DESC").get();
    check(mv && mv.source === 'booster' && mv.item && mv.amount < 0, 'grand livre : achat de booster sourcé (booster/<type>)');
    const ev = conn.prepare("SELECT * FROM events WHERE type = 'booster_bought' ORDER BY id DESC").get();
    check(ev && ev.user_id === 'U1' && JSON.parse(ev.data).price === -mv.amount, 'événement booster_bought avec le prix');
  }
```
Dans `scripts/test-app-spam.js`, juste avant son résumé final (même style de `check` que le fichier) :
```js
  {
    const conn = require(path.join(TMP, 'src', 'db.js')).getDb();
    const unknownEarn = conn.prepare("SELECT COUNT(*) n FROM credit_moves WHERE source = 'unknown' AND kind = 'earn'").get().n;
    const reactionEvents = conn.prepare("SELECT COUNT(*) n FROM events WHERE type = 'reaction'").get().n;
    const reactionMoves = conn.prepare("SELECT COUNT(*) n FROM credit_moves WHERE source = 'reaction'").get().n;
    check(unknownEarn === 0, 'aucun gain de crédits sans source');
    check(reactionEvents === reactionMoves, `un événement reaction par réaction créditée (${reactionEvents}/${reactionMoves})`);
  }
```

- [ ] **Step 2: Lancer, vérifier l'échec** — `node scripts/test-app-booster.js` → ❌ `grand livre : achat de booster sourcé`.

- [ ] **Step 3: Implémenter**

En tête de `src/app.js`, sous `const arenaSlack = require('./arenaSlack');` :
```js
const events = require('./events');

// 🗄️ Base SQLite (crédits + journal des stats) : sans elle, pas de démarrage
//    (mieux vaut un bot arrêté qu'une économie non tracée ou remise à zéro).
try {
  require('./db').getDb();
  credits.ensureImported();
} catch (e) {
  console.error(`❌ Base SQLite indisponible (data/jeanpip.db) : ${e.message}`);
  console.error('   → vérifier `npm install` (better-sqlite3) et les droits sur data/.');
  process.exit(1);
}
```
Réaction (~l.493) :
```js
      const newBalance = credits.addCredit(reactingUserId, settings.getCreditsPerJeanpip(), { source: 'reaction', ref: channelId });
      events.record('reaction', reactingUserId, { channel: channelId });
```
Attaque payante (~l.697) :
```js
    if (!credits.spend(userId, price, { source: 'attack', ref: channelId })) {
```
Achat de booster (~l.1050) :
```js
    if (!credits.spend(userId, booster.price, { source: 'booster', item: type })) {
```
et juste après `const id = boosters.createPending(userId, type);` :
```js
    events.record('booster_bought', userId, { boosterId: id, boosterType: type, price: booster.price }, { dedup: `booster_created:${id}` });
```

- [ ] **Step 4: Vérifier qu'aucun autre appel n'est resté sans source**

```bash
grep -n "addCredit(\|spend(\|setBalance(" src/*.js src/game/*.js | grep -v "src/credits.js" | grep -v "source:"
```
Expected: aucune ligne (hors `getBalance`). S'il en reste, leur ajouter un `meta` adapté selon le tableau §5.1 de la spec.

- [ ] **Step 5: Lancer** — `node scripts/test-app-booster.js && node scripts/test-app-spam.js && node scripts/test-app-weekly-gift.js`, puis la suite complète. Expected: tous ✅.

- [ ] **Step 6: Commit**

```bash
git add src/app.js scripts/test-app-booster.js scripts/test-app-spam.js
git commit -m "📒 app.js : réactions, achats et attaques tracés + refus de démarrer sans SQLite"
```

---

### Task 6: Rattrapage de l'historique

**Files:**
- Create: `src/stats/backfill.js`, `scripts/backfill-events.js`, `scripts/test-backfill.js`

**Interfaces:**
- Consumes: `events.record`, `events.boosterScore`, `boosters.getBooster(type)` (→ `{ price }`).
- Produces: `backfill({ dataDir }) → { bought, granted, opened, discovered, added, matches }` (nombre d'événements réellement insérés).

- [ ] **Step 1: Test qui échoue** — `scripts/test-backfill.js`

```js
#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test du rattrapage de l'historique (src/stats/backfill.js)
//  Usage : node scripts/test-backfill.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-backfill-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
const DATA = path.join(TMP, 'data');
fs.mkdirSync(DATA);
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(DATA, 'media-bank.json'));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}
const write = (name, obj) => fs.writeFileSync(path.join(DATA, name), JSON.stringify(obj));
const winAt = Date.parse('2026-09-28T10:00:00.000Z');

write('boosters.json', { boosters: {
  b_1: { owner: 'UA', type: 'rare', opened: true, createdAt: '2026-09-20T08:00:00.000Z', openedAt: '2026-09-20T08:01:00.000Z', openedVia: 'web',
    cards: [{ url: 'u1', title: 'A', rarity: 'epic' }, { url: 'u2', title: 'B', rarity: 'common' }] },
  b_2: { owner: 'UB', type: 'common', opened: false, createdAt: '2026-09-21T08:00:00.000Z' },
  b_3: { owner: 'UA', type: 'common', opened: false, createdAt: new Date(winAt + 20).toISOString() },   // gagné en arène
} });
write('collections.json', { users: {
  UA: { cards: { u1: { title: 'A', rarity: 'epic', count: 1, firstAt: '2026-09-20T08:01:00.000Z' }, u2: { title: 'B', rarity: 'common', count: 2, firstAt: '2026-09-10T08:00:00.000Z' } } },
  UB: { cards: { u2: { title: 'B', rarity: 'common', count: 1, firstAt: '2026-09-05T08:00:00.000Z' } } },
} });
write('arena.json', { history: [
  { matchId: 'm1', at: winAt, winnerId: 'UA', loserId: 'UB', draw: false },
  { matchId: 'm2', at: winAt + 60000, winnerId: null, loserId: null, draw: true, players: ['UA', 'UB'] },
] });

const origLog = console.log;
console.log = () => {};
const { backfill } = require(path.join(TMP, 'src', 'stats', 'backfill.js'));
const events = require(path.join(TMP, 'src', 'events.js'));
const conn = require(path.join(TMP, 'src', 'db.js')).getDb();
console.log = origLog;

// Le live a déjà vu la découverte UA/u1 : pas de doublon
events.record('card_discovered', 'UA', { url: 'u1' }, { dedup: 'disc:UA:u1' });

const r1 = backfill({ dataDir: DATA });
check('boosters achetés = 2 (b_1, b_2)', r1.bought === 2);
check('booster gagné en arène détecté (b_3)', r1.granted === 1);
check('booster ouvert = 1', r1.opened === 1);
check('découvertes : 3 cartes-joueur, dont 1 déjà vue en live → 2 insérées', r1.discovered === 2);
check('cartes au catalogue : 2 (u1, u2)', r1.added === 2);
check('combats = 2', r1.matches === 2);

const added = conn.prepare("SELECT at FROM events WHERE dedup = 'added:u2'").get();
check('date d’ajout approx. = plus ancien firstAt', added.at === '2026-09-05T08:00:00.000Z');
const bought = JSON.parse(conn.prepare("SELECT data FROM events WHERE dedup = 'booster_created:b_1'").get().data);
check('prix du booster rare repris du catalogue', bought.price === 45);
const opened = JSON.parse(conn.prepare("SELECT data FROM events WHERE dedup = 'booster_opened:b_1'").get().data);
check('score du booster ouvert', opened.score === 9);
const m1 = JSON.parse(conn.prepare("SELECT data FROM events WHERE dedup = 'match:m1'").get().data);
check('combat : gagnant / perdant, sans deck', m1.result === 'win' && m1.players[0].outcome === 'win' && m1.players[0].deck === null);

const r2 = backfill({ dataDir: DATA });
check('2e lancement : rien de nouveau', Object.values(r2).every((n) => n === 0));

const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-backfill-empty-'));
const r3 = backfill({ dataDir: empty });
check('fichiers absents : aucun crash, 0 partout', Object.values(r3).every((n) => n === 0));

fs.rmSync(TMP, { recursive: true, force: true });
fs.rmSync(empty, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n🎉 Rattrapage OK');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Lancer, vérifier l'échec** → `Cannot find module .../stats/backfill.js`.

- [ ] **Step 3: Implémenter** — `src/stats/backfill.js`

```js
// ═══════════════════════════════════════════════════════════
//  ⏪ RATTRAPAGE DE L'HISTORIQUE (stats)
//  Recrée dans le journal les événements passés récupérables depuis
//  les fichiers JSON du jeu. Idempotent : mêmes clés `dedup` que le
//  live (src/events.js) → relançable sans doublon, même après que le
//  bot a commencé à journaliser.
//
//  • boosters.json   → booster_bought / booster_granted / booster_opened
//    (gagné en arène = booster commun créé ≤ 5 s après une victoire
//     du même joueur dans l'historique de l'arène)
//  • collections.json → card_discovered (firstAt) et card_added
//    (approximation : plus ancien firstAt de la carte)
//  • arena.json       → match_finished (1000 derniers, sans decks)
//  Réactions et crédits passés : non récupérables.
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const events = require('../events');
const { getBooster } = require('../boosters');

const GRANT_WINDOW_MS = 5000;

function readJson(dataDir, name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf-8')) || fallback;
  } catch {
    return fallback;
  }
}

const iso = (t) => new Date(t).toISOString();

function backfill({ dataDir = path.join(__dirname, '..', '..', 'data') } = {}) {
  const out = { bought: 0, granted: 0, opened: 0, discovered: 0, added: 0, matches: 0 };
  const history = (readJson(dataDir, 'arena.json', {}).history || []);
  const wins = history.filter((h) => h && h.winnerId && !h.draw);

  // 🎁 Boosters
  const store = readJson(dataDir, 'boosters.json', {}).boosters || {};
  for (const [id, b] of Object.entries(store)) {
    if (!b || !b.owner || !b.createdAt) continue;
    const created = Date.parse(b.createdAt);
    const isGrant = b.type === 'common' && wins.some((h) => h.winnerId === b.owner && Math.abs(created - Number(h.at)) <= GRANT_WINDOW_MS);
    if (isGrant) {
      if (events.record('booster_granted', b.owner, { boosterId: id, boosterType: b.type, reason: 'arena' }, { at: b.createdAt, dedup: `booster_created:${id}` })) out.granted += 1;
    } else {
      const info = getBooster(b.type);
      if (events.record('booster_bought', b.owner, { boosterId: id, boosterType: b.type, price: info ? info.price : null }, { at: b.createdAt, dedup: `booster_created:${id}` })) out.bought += 1;
    }
    if (b.opened && b.openedAt) {
      const cards = (b.cards || []).map((c) => ({ url: c.url, title: c.title, rarity: c.rarity }));
      if (events.record('booster_opened', b.owner, { boosterId: id, boosterType: b.type, via: b.openedVia || 'slack', cards, score: events.boosterScore(cards) },
        { at: b.openedAt, dedup: `booster_opened:${id}` })) out.opened += 1;
    }
  }

  // 🃏 Cartes
  const users = readJson(dataDir, 'collections.json', {}).users || {};
  const firstSeen = new Map();
  for (const [userId, u] of Object.entries(users)) {
    for (const [url, c] of Object.entries((u && u.cards) || {})) {
      if (!c || !c.firstAt) continue;
      if (events.record('card_discovered', userId, { url, title: c.title, rarity: c.rarity }, { at: c.firstAt, dedup: `disc:${userId}:${url}` })) out.discovered += 1;
      const prev = firstSeen.get(url);
      if (!prev || c.firstAt < prev.at) firstSeen.set(url, { at: c.firstAt, title: c.title, rarity: c.rarity });
    }
  }
  for (const [url, c] of firstSeen) {
    if (events.record('card_added', null, { url, title: c.title, rarity: c.rarity, approx: true }, { at: c.at, dedup: `added:${url}` })) out.added += 1;
  }

  // ⚔️ Combats
  for (const h of history) {
    if (!h || !h.matchId || !h.at) continue;
    const players = h.draw
      ? (h.players || []).map((userId) => ({ userId, outcome: 'draw', deck: null }))
      : [{ userId: h.winnerId, outcome: 'win', deck: null }, { userId: h.loserId, outcome: 'loss', deck: null }];
    if (events.record('match_finished', null, { matchId: h.matchId, result: h.draw ? 'draw' : 'win', players, loot: null },
      { at: iso(Number(h.at)), dedup: `match:${h.matchId}` })) out.matches += 1;
  }

  return out;
}

module.exports = { backfill };
```

`scripts/backfill-events.js` :
```js
#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  ⏪ Rattrapage de l'historique dans data/jeanpip.db
//  Idempotent : relançable sans doublon.
//  Usage : node scripts/backfill-events.js
// ═══════════════════════════════════════════════════════════
const { backfill } = require('../src/stats/backfill');

const r = backfill();
console.log('⏪ Rattrapage terminé :');
for (const [k, n] of Object.entries(r)) console.log(`   ${k.padEnd(10)} ${n}`);
```

- [ ] **Step 4: Lancer** — `node scripts/test-backfill.js` → tous ✅.

- [ ] **Step 5: Commit**

```bash
git add src/stats/backfill.js scripts/backfill-events.js scripts/test-backfill.js
git commit -m "⏪ Rattrapage idempotent de l'historique (boosters, cartes, combats)"
```

---

### Task 7: Stats — temps, Économie, Achats

**Files:**
- Create: `src/stats/time.js`, `src/stats/economy.js`, `scripts/test-stats-economy.js`

**Interfaces:**
- Consumes: `getDb()`.
- Produces (`time.js`) :
  - `normalizeFilters(raw, now = Date.now()) → { from: ISO, to: ISO, grain, user: string|null, source: string|null }` ; lève `Error` avec `code = 'BAD_FILTER'` si invalide. Défaut : 30 derniers jours, `day`.
  - `parisDay(iso) → 'YYYY-MM-DD'`, `bucketKey(iso, grain) → string`, `bucketsBetween(from, to, grain) → string[]`
  - `median(number[]) → number`, `round(n, d = 2) → number`, `sum(number[]) → number`
- Produces (`economy.js`) :
  - `economy(f, { db, boosterPrice }) → { kpis, series, tables, since }`
    - `kpis = { mass, mean, median, players, created, consumed, net, adjust, inflationPct, spendRatePct, purchasingPower, ledgerGap, unknown }`
    - `series = { labels, mass, created, consumed, net, mean, median }`
    - `tables = { bySource: [{key, credits}], byUse: [{key, credits}] }`
  - `purchases(f, { db }) → { kpis: { purchases, credits, buyers }, series: { labels, byItem: { [key]: number[] } }, tables: { items: [{key, family, item, count, credits, buyers}], families: [{family, count, credits}] }, since }`
  - Clé d'article : `item ? \`${source}/${item}\` : source`.

- [ ] **Step 1: Test qui échoue** — `scripts/test-stats-economy.js`

```js
#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test des stats Économie + Achats (src/stats/economy.js)
//  Usage : node scripts/test-stats-economy.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-stats-eco-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}
const req = (p) => require(path.join(TMP, 'src', p));
const time = req('stats/time.js');
const { economy, purchases } = req('stats/economy.js');
const db = req('db.js').getDb();

// ⏱️ Temps (Paris)
check('23h30 UTC le 31/03 = 1er avril à Paris', time.parisDay('2026-03-31T23:30:00Z') === '2026-04-01');
check('semaine = lundi', time.bucketKey('2026-09-27T10:00:00Z', 'week') === '2026-09-21');
check('mois', time.bucketKey('2026-09-27T10:00:00Z', 'month') === '2026-09');
check('buckets jour', time.bucketsBetween('2026-09-01T10:00:00Z', '2026-09-03T10:00:00Z', 'day').join() === '2026-09-01,2026-09-02,2026-09-03');
check('buckets semaine', time.bucketsBetween('2026-09-01T10:00:00Z', '2026-09-15T10:00:00Z', 'week').join() === '2026-08-31,2026-09-07,2026-09-14');
check('médiane paire', time.median([1, 9, 3, 5]) === 4);
check('médiane vide', time.median([]) === 0);
const bad = (raw) => { try { time.normalizeFilters(raw); return false; } catch (e) { return e.code === 'BAD_FILTER'; } };
check('from invalide → BAD_FILTER', bad({ from: 'abc' }));
check('grain invalide → BAD_FILTER', bad({ grain: 'year' }));
check('to < from → BAD_FILTER', bad({ from: '2026-09-10T00:00:00Z', to: '2026-09-01T00:00:00Z' }));
check('user invalide → BAD_FILTER', bad({ user: '<script>' }));
check('plage > 3 ans → BAD_FILTER', bad({ from: '2020-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }));
const def = time.normalizeFilters({}, Date.parse('2026-09-29T12:00:00Z'));
check('défaut : 30 j, jour', def.grain === 'day' && def.to === '2026-09-29T12:00:00.000Z' && def.from === '2026-08-30T12:00:00.000Z');

// 💰 Jeu de données connu
const ins = db.prepare('INSERT INTO credit_moves (at, user_id, amount, kind, source, item, ref) VALUES (?, ?, ?, ?, ?, ?, ?)');
const bal = db.prepare('INSERT INTO balances (user_id, balance) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET balance = excluded.balance');
const rows = [
  ['2026-09-01T08:00:00.000Z', 'UA', 100, 'opening', 'migration', null],
  ['2026-09-01T08:00:00.000Z', 'UB', 20, 'opening', 'migration', null],
  ['2026-09-10T08:00:00.000Z', 'UA', 10, 'earn', 'reaction', null],
  ['2026-09-10T09:00:00.000Z', 'UB', 30, 'earn', 'weekly_gift', null],
  ['2026-09-10T10:00:00.000Z', 'UA', -45, 'spend', 'booster', 'rare'],
  ['2026-09-11T10:00:00.000Z', 'UB', -20, 'spend', 'booster', 'common'],
  ['2026-09-11T11:00:00.000Z', 'UA', -20, 'spend', 'booster', 'common'],
  ['2026-09-11T12:00:00.000Z', 'UB', -25, 'spend', 'arena_shop', 'epic'],
  ['2026-09-11T13:00:00.000Z', 'UC', 2, 'earn', 'unknown', null],
];
for (const r of rows) ins.run(r[0], r[1], r[2], r[3], r[4], r[5], null);
bal.run('UA', 45); bal.run('UB', 5); bal.run('UC', 2);

const f = time.normalizeFilters({ from: '2026-09-10T00:00:00+02:00', to: '2026-09-11T23:59:59+02:00', grain: 'day' });
const eco = economy(f, { db, boosterPrice: 20 });
check('labels = 2 jours', eco.series.labels.join() === '2026-09-10,2026-09-11');
check('créés = 42', eco.kpis.created === 42);
check('consommés = 110', eco.kpis.consumed === 110);
check('flux net = -68', eco.kpis.net === -68);
check('masse fin = 52', eco.kpis.mass === 52);
check('masse / jour', eco.series.mass.join() === '115,52');
check('inflation = (52-120)/120', eco.kpis.inflationPct === -56.7);
check('moyenne / médiane (soldes > 0)', eco.kpis.players === 3 && eco.kpis.mean === 17.33 && eco.kpis.median === 5);
check('pouvoir d’achat = moyenne / 20', eco.kpis.purchasingPower === 0.9);
check('écart ledger = 0', eco.kpis.ledgerGap === 0);
check('1 mouvement unknown', eco.kpis.unknown === 1);
check('créés par source', eco.tables.bySource[0].key === 'weekly_gift' && eco.tables.bySource[0].credits === 30);
check('consommés par usage', eco.tables.byUse.find((x) => x.key === 'booster/rare').credits === 45);
check('since = 1er mouvement', eco.since === '2026-09-01T08:00:00.000Z');

const ecoUser = economy({ ...f, user: 'UA' }, { db, boosterPrice: 20 });
check('filtre joueur : masse UA = 45', ecoUser.kpis.mass === 45 && ecoUser.kpis.created === 10);
const ecoSrc = economy({ ...f, source: 'booster' }, { db, boosterPrice: 20 });
check('filtre source : consommés booster = 85', ecoSrc.kpis.consumed === 85 && ecoSrc.kpis.created === 0);

bal.run('UA', 46);
check('écart ledger détecté', economy(f, { db, boosterPrice: 20 }).kpis.ledgerGap === 1);
bal.run('UA', 45);

// 🛒 Achats
const pu = purchases(f, { db });
check('4 achats, 110 crédits, 2 acheteurs', pu.kpis.purchases === 4 && pu.kpis.credits === 110 && pu.kpis.buyers === 2);
const common = pu.tables.items.find((x) => x.key === 'booster/common');
check('booster/common : 2 achats, 2 acheteurs', common.count === 2 && common.buyers === 2 && common.credits === 40);
check('classement par crédits', pu.tables.items[0].key === 'booster/rare');
check('familles', pu.tables.families.find((x) => x.family === 'booster').count === 3);
check('série par article', pu.series.byItem['booster/common'].join() === '0,2');

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n🎉 Stats Économie OK');
process.exit(failures ? 1 : 0);
```

Vérification des attendus (UA 100, UB 20 au départ → masse début 120 ; 10/09 : UA 110−45=65, UB 50 → 115 ; 11/09 : UA 45, UB 5, UC 2 → 52 ; moyenne 52/3 = 17,33 ; médiane 5 ; 17,33/20 = 0,87 → arrondi 1 décimale 0,9).

- [ ] **Step 2: Lancer, vérifier l'échec** → `Cannot find module .../stats/time.js`.

- [ ] **Step 3: Implémenter** — `src/stats/time.js`

```js
// ═══════════════════════════════════════════════════════════
//  ⏱️ STATS — filtres et découpage du temps (heure de Paris)
// ═══════════════════════════════════════════════════════════

const TZ = 'Europe/Paris';
const DAY_MS = 24 * 3600 * 1000;
const MAX_RANGE_MS = 3 * 366 * DAY_MS;
const GRAINS = new Set(['day', 'week', 'month']);

const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ });
const parisDay = (iso) => dayFmt.format(new Date(iso));

function bucketKey(iso, grain) {
  const day = parisDay(iso);
  if (grain === 'month') return day.slice(0, 7);
  if (grain === 'week') {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  return day;
}

/** Clés de buckets couvrant [from, to], dans l'ordre. */
function bucketsBetween(from, to, grain) {
  const keys = [];
  const last = parisDay(to);
  const d = new Date(`${parisDay(from)}T12:00:00Z`);   // midi UTC = même jour à Paris
  for (;;) {
    const day = d.toISOString().slice(0, 10);
    if (day > last) break;
    const k = bucketKey(`${day}T12:00:00Z`, grain);
    if (keys[keys.length - 1] !== k) keys.push(k);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return keys;
}

function badFilter(message) {
  const e = new Error(message);
  e.code = 'BAD_FILTER';
  return e;
}

function toIso(value, name) {
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw badFilter(`${name} invalide`);
  return new Date(t).toISOString();
}

function normalizeFilters({ from, to, grain = 'day', user = null, source = null } = {}, now = Date.now()) {
  const toIsoV = to ? toIso(to, 'to') : new Date(now).toISOString();
  const fromIsoV = from ? toIso(from, 'from') : new Date(Date.parse(toIsoV) - 30 * DAY_MS).toISOString();
  if (fromIsoV > toIsoV) throw badFilter('from après to');
  if (Date.parse(toIsoV) - Date.parse(fromIsoV) > MAX_RANGE_MS) throw badFilter('période trop longue (3 ans max)');
  if (!GRAINS.has(grain)) throw badFilter('grain invalide');
  if (user && !/^[A-Z0-9]{2,32}$/.test(user)) throw badFilter('user invalide');
  if (source && !/^[a-z_]{1,32}$/.test(source)) throw badFilter('source invalide');
  return { from: fromIsoV, to: toIsoV, grain, user: user || null, source: source || null };
}

const sum = (values) => values.reduce((s, v) => s + v, 0);
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Index de bucket d'une date (dernier bucket si hors bornes à cause d'arrondis). */
function indexer(keys, grain) {
  const idx = new Map(keys.map((k, i) => [k, i]));
  return (iso) => idx.get(bucketKey(iso, grain)) ?? keys.length - 1;
}

module.exports = { TZ, DAY_MS, parisDay, bucketKey, bucketsBetween, normalizeFilters, sum, round, median, indexer };
```

`src/stats/economy.js` :
```js
// ═══════════════════════════════════════════════════════════
//  💰 STATS — Économie et Achats (grand livre credit_moves)
//  Masse en circulation = somme des soldes, rejouée mouvement par
//  mouvement depuis le début (le mouvement 'opening' de la migration
//  porte les soldes d'avant le suivi).
// ═══════════════════════════════════════════════════════════

const { bucketsBetween, sum, round, median, indexer } = require('./time');

const itemKey = (m) => (m.item ? `${m.source}/${m.item}` : m.source);
const sorted = (obj) => Object.entries(obj).map(([key, credits]) => ({ key, credits: round(credits) })).sort((a, b) => b.credits - a.credits);

function firstMoveAt(db) {
  const r = db.prepare('SELECT MIN(at) AS at FROM credit_moves').get();
  return r ? r.at : null;
}

function ledgerGap(db) {
  const r = db.prepare('SELECT (SELECT COALESCE(SUM(balance), 0) FROM balances) - (SELECT COALESCE(SUM(amount), 0) FROM credit_moves) AS gap').get();
  return round(r.gap);
}

function economy(f, { db, boosterPrice = 20 }) {
  const keys = bucketsBetween(f.from, f.to, f.grain);
  const at = indexer(keys, f.grain);
  const zero = () => keys.map(() => 0);
  const created = zero(); const consumed = zero(); const mass = zero(); const mean = zero(); const med = zero();
  const bySource = {}; const byUse = {};
  let adjust = 0; let unknown = 0;

  const moves = db.prepare(`SELECT at, user_id AS userId, amount, kind, source, item FROM credit_moves
    WHERE at <= ?${f.user ? ' AND user_id = ?' : ''} ORDER BY at, id`).all(...(f.user ? [f.to, f.user] : [f.to]));

  const balances = new Map();
  const apply = (m) => balances.set(m.userId, (balances.get(m.userId) || 0) + m.amount);
  const groups = keys.map(() => []);
  for (const m of moves) {
    if (m.at < f.from) apply(m);
    else groups[at(m.at)].push(m);
  }
  const massStart = sum([...balances.values()]);
  const pass = (m) => !f.source || m.source === f.source;

  let positives = [];
  keys.forEach((_, i) => {
    for (const m of groups[i]) {
      apply(m);
      if (m.source === 'unknown') unknown += 1;
      if (m.kind === 'earn' && pass(m)) {
        created[i] += m.amount;
        bySource[m.source] = (bySource[m.source] || 0) + m.amount;
      } else if (m.kind === 'spend' && pass(m)) {
        consumed[i] -= m.amount;
        byUse[itemKey(m)] = (byUse[itemKey(m)] || 0) - m.amount;
      } else if (m.kind === 'adjust') {
        adjust += m.amount;
      }
    }
    positives = [...balances.values()].filter((v) => v > 0);
    mass[i] = round(sum(positives));
    mean[i] = positives.length ? round(mass[i] / positives.length) : 0;
    med[i] = round(median(positives));
  });

  const last = keys.length - 1;
  const createdTotal = round(sum(created));
  const consumedTotal = round(sum(consumed));
  const avgMass = keys.length ? sum(mass) / keys.length : 0;
  return {
    kpis: {
      mass: mass[last],
      mean: mean[last],
      median: med[last],
      players: positives.length,
      created: createdTotal,
      consumed: consumedTotal,
      net: round(createdTotal - consumedTotal),
      adjust: round(adjust),
      inflationPct: massStart > 0 ? round(((mass[last] - massStart) / massStart) * 100, 1) : null,
      spendRatePct: avgMass > 0 ? round((consumedTotal / avgMass) * 100, 1) : null,
      purchasingPower: boosterPrice ? round(mean[last] / boosterPrice, 1) : null,
      ledgerGap: ledgerGap(db),
      unknown,
    },
    series: {
      labels: keys,
      mass,
      created: created.map((v) => round(v)),
      consumed: consumed.map((v) => round(v)),
      net: created.map((v, i) => round(v - consumed[i])),
      mean,
      median: med,
    },
    tables: { bySource: sorted(bySource), byUse: sorted(byUse) },
    since: firstMoveAt(db),
  };
}

function purchases(f, { db }) {
  const keys = bucketsBetween(f.from, f.to, f.grain);
  const at = indexer(keys, f.grain);
  const rows = db.prepare(`SELECT at, user_id AS userId, -amount AS credits, source, item FROM credit_moves
    WHERE kind = 'spend' AND at >= ? AND at <= ?${f.user ? ' AND user_id = ?' : ''} ORDER BY at, id`)
    .all(...(f.user ? [f.from, f.to, f.user] : [f.from, f.to]));

  const items = {}; const families = {};
  for (const r of rows) {
    const key = itemKey(r);
    const it = items[key] || (items[key] = { key, family: r.source, item: r.item, count: 0, credits: 0, buyers: new Set(), series: keys.map(() => 0) });
    it.count += 1;
    it.credits += r.credits;
    it.buyers.add(r.userId);
    it.series[at(r.at)] += 1;
    const fam = families[r.source] || (families[r.source] = { family: r.source, count: 0, credits: 0 });
    fam.count += 1;
    fam.credits += r.credits;
  }
  const list = Object.values(items).sort((a, b) => b.credits - a.credits || b.count - a.count);
  return {
    kpis: { purchases: rows.length, credits: round(sum(rows.map((r) => r.credits))), buyers: new Set(rows.map((r) => r.userId)).size },
    series: { labels: keys, byItem: Object.fromEntries(list.map((it) => [it.key, it.series])) },
    tables: {
      items: list.map(({ key, family, item, count, credits, buyers }) => ({ key, family, item, count, credits: round(credits), buyers: buyers.size })),
      families: Object.values(families).map((x) => ({ ...x, credits: round(x.credits) })).sort((a, b) => b.credits - a.credits),
    },
    since: firstMoveAt(db),
  };
}

module.exports = { economy, purchases };
```

- [ ] **Step 4: Lancer** — `node scripts/test-stats-economy.js` → tous ✅. Si un attendu numérique diffère, recalculer à la main à partir des 9 lignes : corriger le code **ou** le test selon la définition de la spec (§7.3), jamais « au plus proche ».

- [ ] **Step 5: Commit**

```bash
git add src/stats/time.js src/stats/economy.js scripts/test-stats-economy.js
git commit -m "📊 Stats Économie (masse, inflation, dépense, pouvoir d'achat) et Achats"
```

---

### Task 8: Stats — Boosters, Cartes, Arène, Activité + point d'entrée

**Files:**
- Create: `src/stats/game.js`, `src/stats/index.js`, `scripts/test-stats-game.js`

**Interfaces:**
- Consumes: `time.*`, `economy`, `purchases` (Task 7).
- Produces (`game.js`) :
  - `boosters(f, { db }) → { kpis: { bought, granted, opened, stock }, series: { labels, openedByType: {[type]: number[]} }, tables: { top: [{ userId, at, boosterType, score, cards }] }, since }`
  - `cards(f, { db, catalogSize, ownedCopies }) → { kpis: { catalog, owned, added, discovered, players, mean, median }, series: { labels, added, discovered, mean, median }, tables: { perPlayer: [{ userId, cards, pct }], byRarity: [{ key, count }] }, since }`
  - `arena(f, { db }) → { kpis: { matches, decisive, draws, cancelled, withDecks, rewards, shop }, series: { labels, decisive, draws, cancelled }, tables: { topCards: [{ url, title, rarity, plays, wins, winRate }], players: [{ userId, matches, wins }] }, since }`
  - `activity(f, { db }) → { kpis: { reactions, activeUsers, reactionsPerActive }, series: { labels, reactions, activeUsers }, tables: { topReactors: [{ userId, reactions }] }, since }`
- Produces (`index.js`) :
  - `BLOCKS = ['economy', 'purchases', 'boosters', 'cards', 'arena', 'activity']`
  - `run(block, rawFilters, { db?, now?, boosterPrice?, catalogSize?, ownedCopies? }) → { ...bloc, prevKpis, filters }` (lève `BAD_FILTER`)
  - `players({ db? }) → { players: string[], firstAt: ISO|null }`

- [ ] **Step 1: Test qui échoue** — `scripts/test-stats-game.js`

```js
#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test des stats Boosters / Cartes / Arène / Activité + run()
//  Usage : node scripts/test-stats-game.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-stats-game-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}
const req = (p) => require(path.join(TMP, 'src', p));
const events = req('events.js');
const time = req('stats/time.js');
const game = req('stats/game.js');
const stats = req('stats/index.js');
const db = req('db.js').getDb();

const d = (day, h = 10) => `2026-09-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00.000Z`;
// Boosters
events.record('booster_bought', 'UA', { boosterId: 'b1', boosterType: 'rare', price: 45 }, { at: d(10), dedup: 'booster_created:b1' });
events.record('booster_bought', 'UB', { boosterId: 'b2', boosterType: 'common', price: 20 }, { at: d(10, 11), dedup: 'booster_created:b2' });
events.record('booster_granted', 'UA', { boosterId: 'b3', boosterType: 'common', reason: 'arena' }, { at: d(11), dedup: 'booster_created:b3' });
events.record('booster_opened', 'UA', { boosterId: 'b1', boosterType: 'rare', cards: [{ url: 'u1', rarity: 'legendary' }], score: 20 }, { at: d(10, 12), dedup: 'booster_opened:b1' });
events.record('booster_opened', 'UB', { boosterId: 'b2', boosterType: 'common', cards: [{ url: 'u2', rarity: 'common' }], score: 1 }, { at: d(11, 12), dedup: 'booster_opened:b2' });
// Cartes
events.record('card_added', null, { url: 'u1', rarity: 'legendary' }, { at: d(1), dedup: 'added:u1' });
events.record('card_added', null, { url: 'u2', rarity: 'common' }, { at: d(10), dedup: 'added:u2' });
events.record('card_discovered', 'UA', { url: 'u1', rarity: 'legendary' }, { at: d(10, 12), dedup: 'disc:UA:u1' });
events.record('card_discovered', 'UB', { url: 'u2', rarity: 'common' }, { at: d(11, 12), dedup: 'disc:UB:u2' });
events.record('card_discovered', 'UA', { url: 'u2', rarity: 'common' }, { at: d(11, 13), dedup: 'disc:UA:u2' });
// Combats
const deckA = [{ url: 'u1', title: 'L', rarity: 'legendary', rented: false }, { url: 'u1', title: 'L', rarity: 'legendary', rented: false }, { url: 'u2', title: 'C', rarity: 'common', rented: false }];
const deckB = [{ url: 'u2', title: 'C', rarity: 'common', rented: false }];
events.record('match_finished', null, { matchId: 'm1', result: 'win', players: [{ userId: 'UA', outcome: 'win', deck: deckA }, { userId: 'UB', outcome: 'loss', deck: deckB }] }, { at: d(10, 15), dedup: 'match:m1' });
events.record('match_finished', null, { matchId: 'm2', result: 'draw', players: [{ userId: 'UA', outcome: 'draw', deck: deckA }, { userId: 'UB', outcome: 'draw', deck: deckB }] }, { at: d(11, 15), dedup: 'match:m2' });
events.record('match_finished', null, { matchId: 'm3', result: 'cancelled', players: [{ userId: 'UA', outcome: 'cancelled', deck: null }, { userId: 'UC', outcome: 'cancelled', deck: null }] }, { at: d(11, 16), dedup: 'match:m3' });
// Réactions
events.record('reaction', 'UA', {}, { at: d(10) });
events.record('reaction', 'UA', {}, { at: d(11) });
events.record('reaction', 'UC', {}, { at: d(11) });
// Crédits arène
db.prepare("INSERT INTO credit_moves (at, user_id, amount, kind, source) VALUES (?, 'UA', 10, 'earn', 'arena_reward')").run(d(10, 15));
db.prepare("INSERT INTO credit_moves (at, user_id, amount, kind, source, item) VALUES (?, 'UB', -25, 'spend', 'arena_shop', 'epic')").run(d(10, 14));

const f = time.normalizeFilters({ from: '2026-09-10T00:00:00+02:00', to: '2026-09-11T23:59:59+02:00' });

const b = game.boosters(f, { db });
check('boosters : 2 achetés, 1 gagné, 2 ouverts, stock 1', b.kpis.bought === 2 && b.kpis.granted === 1 && b.kpis.opened === 2 && b.kpis.stock === 1);
check('meilleur booster = score 20 de UA', b.tables.top[0].userId === 'UA' && b.tables.top[0].score === 20);
check('ouvertures par type', b.series.openedByType.rare.join() === '1,0' && b.series.openedByType.common.join() === '0,1');

const c = game.cards(f, { db, catalogSize: 4, ownedCopies: 7 });
check('catalogue / exemplaires injectés', c.kpis.catalog === 4 && c.kpis.owned === 7);
check('1 carte ajoutée dans la période (u2)', c.kpis.added === 1 && c.series.added.join() === '1,0');
check('3 découvertes', c.kpis.discovered === 3 && c.series.discovered.join() === '1,2');
check('par joueur : UA 2 (50 %), UB 1', c.tables.perPlayer[0].userId === 'UA' && c.tables.perPlayer[0].cards === 2 && c.tables.perPlayer[0].pct === 50);
check('moyenne / médiane fin de période', c.kpis.mean === 1.5 && c.kpis.median === 1.5);
check('par rareté', c.tables.byRarity.find((x) => x.key === 'common').count === 2);

const a = game.arena(f, { db });
check('combats : 3 (1 décisif, 1 nul, 1 annulé)', a.kpis.matches === 3 && a.kpis.decisive === 1 && a.kpis.draws === 1 && a.kpis.cancelled === 1);
const u2 = a.tables.topCards.find((x) => x.url === 'u2');
check('u2 jouée 4 fois (présence par deck), 1 victoire → 25 %', u2.plays === 4 && u2.wins === 1 && u2.winRate === 25);
const u1 = a.tables.topCards.find((x) => x.url === 'u1');
check('doublon dans un deck compté une fois', u1.plays === 2);
check('crédits arène', a.kpis.rewards === 10 && a.kpis.shop === 25);
check('joueurs actifs arène', a.tables.players[0].userId === 'UA' && a.tables.players[0].matches === 3);
check('filtre joueur UC', game.arena({ ...f, user: 'UC' }, { db }).kpis.matches === 1);

const act = game.activity(f, { db });
check('3 réactions', act.kpis.reactions === 3 && act.series.reactions.join() === '1,2');
check('actifs sur la période : UA, UB, UC', act.kpis.activeUsers === 3);
check('top réacteur UA', act.tables.topReactors[0].userId === 'UA' && act.tables.topReactors[0].reactions === 2);

const r = stats.run('boosters', { from: '2026-09-10T00:00:00+02:00', to: '2026-09-11T23:59:59+02:00' }, { db });
check('run : période précédente calculée', r.prevKpis && r.prevKpis.opened === 0 && r.filters.grain === 'day');
let threw = null;
try { stats.run('nope', {}, { db }); } catch (e) { threw = e.code; }
check('bloc inconnu → BAD_FILTER', threw === 'BAD_FILTER');
const p = stats.players({ db });
check('players : UA, UB, UC', ['UA', 'UB', 'UC'].every((u) => p.players.includes(u)) && p.firstAt === d(1));

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n🎉 Stats jeu OK');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Lancer, vérifier l'échec** → `Cannot find module .../stats/game.js`.

- [ ] **Step 3: Implémenter** — `src/stats/game.js`

```js
// ═══════════════════════════════════════════════════════════
//  🎮 STATS — Boosters, Cartes, Arène, Activité (journal `events`)
// ═══════════════════════════════════════════════════════════

const { bucketsBetween, sum, round, median, indexer } = require('./time');

function loadEvents(db, types, { from = null, to, user = null }) {
  const where = [`type IN (${types.map(() => '?').join(',')})`, 'at <= ?'];
  const params = [...types, to];
  if (from) { where.push('at >= ?'); params.push(from); }
  if (user) { where.push('user_id = ?'); params.push(user); }
  return db.prepare(`SELECT at, type, user_id AS userId, data FROM events WHERE ${where.join(' AND ')} ORDER BY at, id`)
    .all(...params)
    .map((e) => ({ ...e, data: e.data ? JSON.parse(e.data) : {} }));
}

function firstAt(db, type, extra = '') {
  const r = db.prepare(`SELECT MIN(at) AS at FROM events WHERE type = ?${extra}`).get(type);
  return r ? r.at : null;
}

const countBy = (list, keyOf) => list.reduce((acc, x) => { const k = keyOf(x); acc[k] = (acc[k] || 0) + 1; return acc; }, {});

// 🎁 Boosters
function boosters(f, { db }) {
  const keys = bucketsBetween(f.from, f.to, f.grain);
  const at = indexer(keys, f.grain);
  const ev = loadEvents(db, ['booster_bought', 'booster_granted', 'booster_opened'], f);
  const opened = ev.filter((e) => e.type === 'booster_opened');
  const openedByType = {};
  for (const e of opened) {
    const t = e.data.boosterType || '?';
    (openedByType[t] || (openedByType[t] = keys.map(() => 0)))[at(e.at)] += 1;
  }
  const all = loadEvents(db, ['booster_bought', 'booster_granted', 'booster_opened'], { to: f.to, user: f.user });
  const openedIds = new Set(all.filter((e) => e.type === 'booster_opened').map((e) => e.data.boosterId));
  const stock = all.filter((e) => e.type !== 'booster_opened' && !openedIds.has(e.data.boosterId)).length;
  const top = opened
    .map((e) => ({ userId: e.userId, at: e.at, boosterType: e.data.boosterType, score: e.data.score || 0, cards: e.data.cards || [] }))
    .sort((a, b) => b.score - a.score || a.at.localeCompare(b.at))
    .slice(0, 5);
  return {
    kpis: {
      bought: ev.filter((e) => e.type === 'booster_bought').length,
      granted: ev.filter((e) => e.type === 'booster_granted').length,
      opened: opened.length,
      stock,
    },
    series: { labels: keys, openedByType },
    tables: { top },
    since: firstAt(db, 'booster_bought'),
  };
}

// 🃏 Cartes
function cards(f, { db, catalogSize = 0, ownedCopies = 0 }) {
  const keys = bucketsBetween(f.from, f.to, f.grain);
  const at = indexer(keys, f.grain);
  const added = loadEvents(db, ['card_added'], { ...f, user: null });
  const addedSeries = keys.map(() => 0);
  for (const e of added) addedSeries[at(e.at)] += 1;

  const disc = loadEvents(db, ['card_discovered'], { to: f.to, user: f.user });
  const discSeries = keys.map(() => 0);
  const perUser = new Map();
  const meanS = keys.map(() => 0); const medS = keys.map(() => 0);
  const inPeriod = [];
  let i = 0;
  const snapshot = (b) => {
    const vals = [...perUser.values()];
    meanS[b] = vals.length ? round(sum(vals) / vals.length) : 0;
    medS[b] = round(median(vals));
  };
  let bucket = 0;
  for (; i < disc.length && disc[i].at < f.from; i += 1) perUser.set(disc[i].userId, (perUser.get(disc[i].userId) || 0) + 1);
  for (; i < disc.length; i += 1) {
    const e = disc[i];
    const b = at(e.at);
    while (bucket < b) { snapshot(bucket); bucket += 1; }
    perUser.set(e.userId, (perUser.get(e.userId) || 0) + 1);
    discSeries[b] += 1;
    inPeriod.push(e);
  }
  while (bucket < keys.length) { snapshot(bucket); bucket += 1; }

  const perPlayer = [...perUser.entries()]
    .map(([userId, n]) => ({ userId, cards: n, pct: catalogSize ? round((n / catalogSize) * 100, 1) : null }))
    .sort((a, b) => b.cards - a.cards);
  const byRarity = Object.entries(countBy(inPeriod, (e) => e.data.rarity || '?')).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  const last = keys.length - 1;
  return {
    kpis: { catalog: catalogSize, owned: ownedCopies, added: added.length, discovered: inPeriod.length, players: perUser.size, mean: meanS[last], median: medS[last] },
    series: { labels: keys, added: addedSeries, discovered: discSeries, mean: meanS, median: medS },
    tables: { perPlayer, byRarity },
    since: firstAt(db, 'card_discovered'),
  };
}

// ⚔️ Arène
function arena(f, { db }) {
  const keys = bucketsBetween(f.from, f.to, f.grain);
  const at = indexer(keys, f.grain);
  const matches = loadEvents(db, ['match_finished'], { ...f, user: null })
    .filter((m) => !f.user || (m.data.players || []).some((p) => p.userId === f.user));
  const series = { decisive: keys.map(() => 0), draws: keys.map(() => 0), cancelled: keys.map(() => 0) };
  const cardsMap = new Map(); const playersMap = new Map();
  let withDecks = 0;
  for (const m of matches) {
    const k = m.data.result === 'win' ? 'decisive' : m.data.result === 'draw' ? 'draws' : 'cancelled';
    series[k][at(m.at)] += 1;
    const players = m.data.players || [];
    for (const p of players) {
      if (!p.userId) continue;
      const s = playersMap.get(p.userId) || { userId: p.userId, matches: 0, wins: 0 };
      s.matches += 1;
      if (p.outcome === 'win') s.wins += 1;
      playersMap.set(p.userId, s);
    }
    if (m.data.result === 'cancelled') continue;
    if (players.some((p) => Array.isArray(p.deck) && p.deck.length)) withDecks += 1;
    for (const p of players) {
      if (!Array.isArray(p.deck) || (f.user && p.userId !== f.user)) continue;
      const seen = new Set();
      for (const c of p.deck) {
        if (!c || !c.url || seen.has(c.url)) continue;
        seen.add(c.url);
        const s = cardsMap.get(c.url) || { url: c.url, title: c.title, rarity: c.rarity, plays: 0, wins: 0 };
        s.plays += 1;
        if (p.outcome === 'win') s.wins += 1;
        cardsMap.set(c.url, s);
      }
    }
  }
  const credit = (source, kind) => {
    const r = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS t FROM credit_moves WHERE source = ? AND kind = ? AND at >= ? AND at <= ?${f.user ? ' AND user_id = ?' : ''}`)
      .get(...[source, kind, f.from, f.to, ...(f.user ? [f.user] : [])]);
    return round(Math.abs(r.t));
  };
  return {
    kpis: {
      matches: matches.length,
      decisive: sum(series.decisive),
      draws: sum(series.draws),
      cancelled: sum(series.cancelled),
      withDecks,
      rewards: credit('arena_reward', 'earn'),
      shop: credit('arena_shop', 'spend'),
    },
    series: { labels: keys, ...series },
    tables: {
      topCards: [...cardsMap.values()]
        .map((c) => ({ ...c, winRate: c.plays ? round((c.wins / c.plays) * 100, 0) : 0 }))
        .sort((a, b) => b.plays - a.plays || b.winRate - a.winRate)
        .slice(0, 10),
      players: [...playersMap.values()].sort((a, b) => b.matches - a.matches).slice(0, 10),
    },
    since: firstAt(db, 'match_finished', " AND json_extract(data, '$.players[0].deck') IS NOT NULL"),
  };
}

// 😀 Activité
function activity(f, { db }) {
  const keys = bucketsBetween(f.from, f.to, f.grain);
  const at = indexer(keys, f.grain);
  const ev = loadEvents(db, ['reaction', 'booster_bought', 'booster_opened', 'match_finished'], { ...f, user: null });
  const reactions = keys.map(() => 0);
  const active = keys.map(() => new Set());
  const all = new Set();
  const reactors = {};
  for (const e of ev) {
    const users = e.type === 'match_finished' ? (e.data.players || []).map((p) => p.userId) : [e.userId];
    const kept = users.filter((u) => u && (!f.user || u === f.user));
    if (!kept.length) continue;
    const b = at(e.at);
    for (const u of kept) { active[b].add(u); all.add(u); }
    if (e.type === 'reaction') {
      reactions[b] += 1;
      reactors[e.userId] = (reactors[e.userId] || 0) + 1;
    }
  }
  const total = sum(reactions);
  return {
    kpis: { reactions: total, activeUsers: all.size, reactionsPerActive: all.size ? round(total / all.size, 1) : 0 },
    series: { labels: keys, reactions, activeUsers: active.map((s) => s.size) },
    tables: { topReactors: Object.entries(reactors).map(([userId, n]) => ({ userId, reactions: n })).sort((a, b) => b.reactions - a.reactions).slice(0, 10) },
    since: firstAt(db, 'reaction'),
  };
}

module.exports = { boosters, cards, arena, activity };
```

`src/stats/index.js` :
```js
// ═══════════════════════════════════════════════════════════
//  📊 STATS — point d'entrée
//  run(bloc, filtres) : calcule le bloc sur la période ET sur la
//  période précédente de même durée (flèches ▲/▼ du dashboard).
// ═══════════════════════════════════════════════════════════

const { getDb } = require('../db');
const { normalizeFilters } = require('./time');
const { economy, purchases } = require('./economy');
const game = require('./game');

const IMPL = { economy, purchases, boosters: game.boosters, cards: game.cards, arena: game.arena, activity: game.activity };
const BLOCKS = Object.keys(IMPL);

function run(block, rawFilters, opts = {}) {
  const impl = IMPL[block];
  if (!impl) {
    const e = new Error('bloc inconnu');
    e.code = 'BAD_FILTER';
    throw e;
  }
  const ctx = { ...opts, db: opts.db || getDb() };
  const f = normalizeFilters(rawFilters, opts.now);
  const current = impl(f, ctx);
  const span = Date.parse(f.to) - Date.parse(f.from);
  const prev = impl({ ...f, from: new Date(Date.parse(f.from) - span).toISOString(), to: f.from }, ctx);
  return { ...current, prevKpis: prev.kpis, filters: f };
}

/** Joueurs connus (filtre) + première date de données (période « tout »). */
function players({ db = getDb() } = {}) {
  const ids = db.prepare(`SELECT user_id FROM credit_moves UNION SELECT user_id FROM events WHERE user_id IS NOT NULL
    UNION SELECT json_extract(p.value, '$.userId') FROM events, json_each(events.data, '$.players') p WHERE events.type = 'match_finished'`)
    .all().map((r) => r.user_id).filter(Boolean);
  const first = db.prepare('SELECT MIN(at) AS at FROM (SELECT at FROM credit_moves UNION ALL SELECT at FROM events)').get();
  return { players: [...new Set(ids)].sort(), firstAt: first ? first.at : null };
}

module.exports = { BLOCKS, run, players };
```

- [ ] **Step 4: Lancer** — `node scripts/test-stats-game.js` → tous ✅.

- [ ] **Step 5: Commit**

```bash
git add src/stats/game.js src/stats/index.js scripts/test-stats-game.js
git commit -m "📊 Stats Boosters, Cartes, Arène, Activité + comparaison période précédente"
```

---

### Task 9: API signée admin + bouton Accueil

**Files:**
- Create: `src/stats/web.js`, `scripts/test-stats-web.js`
- Modify: `src/web.js` (require, routage, configuration, export), `src/home.js` (`buildAdminBlocks`), `src/app.js` (`buildHomeFor`, action `open_stats_web`)

**Interfaces:**
- Consumes: `stats.run`, `stats.players`, `stats.BLOCKS` ; contexte web (`getSecret`, `send`, `sendJson`, `servePage`, `displayName`).
- Produces:
  - `statsWeb.configure(ctx)`, `statsWeb.route(req, res, url) → Promise<boolean>`, `statsWeb.buildStatsUrl(userId, now?) → string|null`, `statsWeb.makeToken(userId, now?)`, `statsWeb.readToken(token, now?) → userId|null`, `TTL_MS`
  - `web.buildStatsUrl(userId) → string|null` (null si non admin ou page web désactivée)
  - `ctx.statsUrl` dans `home.buildHomeView` → bouton-lien `📊 Stats` (`action_id: 'open_stats_web'`) du panneau admin
  - Jeton : `<userId>.<expMs>.<hmac('stats|<userId>|<expMs>')>`

- [ ] **Step 1: Test qui échoue** — `scripts/test-stats-web.js`

```js
#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test de l'API /stats (jeton admin signé, expiration, routes)
//  Usage : node scripts/test-stats-web.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-stats-web-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

process.env.WEB_PUBLIC_URL = 'https://example.test/jeanpip';
process.env.WEB_SECRET = 'secret-de-test';
process.env.JEANPIP_ADMINS = 'UADMIN';

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}
const origLog = console.log;
console.log = () => {};
const web = require(path.join(TMP, 'src', 'web.js'));
const statsWeb = require(path.join(TMP, 'src', 'stats', 'web.js'));
console.log = origLog;
const quiet = { info() {}, warn() {}, error() {} };

const get = (port, p) => new Promise((resolve) => {
  http.get({ host: '127.0.0.1', port, path: p }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  });
});

(async () => {
  const fakeClient = { users: { info: async ({ user }) => ({ user: { profile: { display_name: `nom-${user}` } } }) } };
  const server = web.startWebServer({ client: fakeClient, logger: quiet, port: 3197, force: true });
  await new Promise((r) => server.on('listening', r));

  const url = web.buildStatsUrl('UADMIN');
  check('lien admin construit', /^https:\/\/example\.test\/jeanpip\/stats\?t=UADMIN\.\d+\.[a-f0-9]{64}$/.test(decodeURIComponent(url)));
  check('pas de lien pour un non-admin', web.buildStatsUrl('UJOE') === null);
  const t = new URL(url).searchParams.get('t');
  const q = (block, extra = '') => get(3197, `/api/stats/${block}?t=${encodeURIComponent(t)}${extra}`);

  const page = await get(3197, '/stats');
  check('page /stats servie', page.status === 200 && page.body.includes('<canvas'));
  for (const b of ['economy', 'purchases', 'boosters', 'cards', 'arena', 'activity']) {
    const r = await q(b);
    const j = r.status === 200 && JSON.parse(r.body);
    check(`API ${b} : 200 + kpis`, j && j.ok && j.kpis && j.series && Array.isArray(j.series.labels));
  }
  const pl = await q('players');
  check('API players : 200', pl.status === 200 && JSON.parse(pl.body).ok);

  check('sans jeton → 403', (await get(3197, '/api/stats/economy')).status === 403);
  check('jeton falsifié → 403', (await get(3197, `/api/stats/economy?t=${encodeURIComponent(t.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')))}`)).status === 403);
  const expired = statsWeb.makeToken('UADMIN', Date.now() - statsWeb.TTL_MS - 1000);
  check('jeton expiré → 403', (await get(3197, `/api/stats/economy?t=${encodeURIComponent(expired)}`)).status === 403);
  const joe = statsWeb.makeToken('UJOE');
  check('jeton signé d’un non-admin → 403', (await get(3197, `/api/stats/economy?t=${encodeURIComponent(joe)}`)).status === 403);
  process.env.JEANPIP_ADMINS = 'UOTHER';
  check('admin retiré depuis → 403', (await q('economy')).status === 403);
  process.env.JEANPIP_ADMINS = 'UADMIN';

  check('from invalide → 400', (await q('economy', '&from=abc')).status === 400);
  check('grain invalide → 400', (await q('economy', '&grain=year')).status === 400);
  check('user invalide → 400', (await q('economy', `&user=${encodeURIComponent('<script>')}`)).status === 400);
  check('bloc inconnu → 404', (await q('nope')).status === 404);

  server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failures ? `\n❌ ${failures} échec(s)` : '\n🎉 API stats OK');
  process.exit(failures ? 1 : 0);
})();
```

- [ ] **Step 2: Lancer, vérifier l'échec** → `web.buildStatsUrl is not a function`.

- [ ] **Step 3: Implémenter** — `src/stats/web.js`

```js
// ═══════════════════════════════════════════════════════════
//  📊 MODULE WEB DU DASHBOARD /stats (admins seulement)
//
//  Routes (relatives, fonctionnent derrière le préfixe /jeanpip/) :
//    GET /stats?t=<jeton>                    → page
//    GET /api/stats/<bloc>?t=&from=&to=&grain=&user=&source=
//    GET /api/stats/players?t=               → joueurs du filtre (+ noms)
//
//  Jeton « <userId>.<expMs>.<hmac> », valable 24 h, recréé à chaque
//  ouverture de l'onglet Accueil. Chaque requête revérifie : signature,
//  expiration ET que userId est toujours dans JEANPIP_ADMINS.
// ═══════════════════════════════════════════════════════════

const crypto = require('crypto');
const stats = require('./index');

const TTL_MS = 24 * 3600 * 1000;
const PAGE_ASSETS = ['stats.css', 'stats.js', 'vendor/chart.umd.js'];

let ctx = null;   // { publicUrl, getSecret, send, sendJson, servePage, displayName, client, logger, catalogSize, ownedCopies, boosterPrice }

function configure(context) {
  ctx = context;
}

const adminIds = () => (process.env.JEANPIP_ADMINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const hmac = (msg) => crypto.createHmac('sha256', ctx.getSecret()).update(msg).digest('hex');

function makeToken(userId, now = Date.now()) {
  const exp = now + TTL_MS;
  return `${userId}.${exp}.${hmac(`stats|${userId}|${exp}`)}`;
}

/** → userId admin si le jeton est valide et non expiré, sinon null. */
function readToken(token, now = Date.now()) {
  const m = /^([A-Z0-9_-]+)\.(\d{10,16})\.([a-f0-9]{64})$/i.exec(token || '');
  if (!m) return null;
  const exp = Number(m[2]);
  if (exp < now) return null;
  const expected = Buffer.from(hmac(`stats|${m[1]}|${exp}`), 'hex');
  const given = Buffer.from(m[3], 'hex');
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return adminIds().includes(m[1]) ? m[1] : null;
}

function buildStatsUrl(userId, now = Date.now()) {
  if (!ctx || !ctx.publicUrl || !adminIds().includes(userId)) return null;
  return `${ctx.publicUrl}/stats?t=${encodeURIComponent(makeToken(userId, now))}`;
}

async function handlePlayers(res) {
  const { players, firstAt } = stats.players();
  const named = await Promise.all(players.map(async (id) => ({
    id,
    name: ctx.client ? await ctx.displayName(ctx.client, id, ctx.logger) : null,
  })));
  ctx.sendJson(res, 200, { ok: true, players: named, firstAt });
}

function handleBlock(res, block, q) {
  const filters = {
    from: q.get('from') || undefined,
    to: q.get('to') || undefined,
    grain: q.get('grain') || 'day',
    user: q.get('user') || null,
    source: q.get('source') || null,
  };
  try {
    const data = stats.run(block, filters, {
      catalogSize: ctx.catalogSize(),
      ownedCopies: ctx.ownedCopies(filters.user),
      boosterPrice: ctx.boosterPrice,
    });
    ctx.sendJson(res, 200, { ok: true, ...data });
  } catch (e) {
    if (e.code !== 'BAD_FILTER') throw e;
    ctx.sendJson(res, 400, { ok: false, reason: e.message });
  }
}

async function route(req, res, url) {
  const { pathname } = url;
  if (req.method === 'GET' && pathname === '/stats') {
    ctx.servePage(res, 'stats', PAGE_ASSETS);
    return true;
  }
  const m = /^\/api\/stats\/([a-z]+)$/.exec(pathname);
  if (!m) return false;
  if (req.method !== 'GET') { ctx.send(res, 405, 'Method not allowed', { Allow: 'GET' }); return true; }
  if (!readToken(url.searchParams.get('t'))) { ctx.sendJson(res, 403, { ok: false, reason: 'invalid' }); return true; }
  if (m[1] === 'players') { await handlePlayers(res); return true; }
  if (!stats.BLOCKS.includes(m[1])) { ctx.sendJson(res, 404, { ok: false, reason: 'unknown' }); return true; }
  handleBlock(res, m[1], url.searchParams);
  return true;
}

module.exports = { configure, route, buildStatsUrl, makeToken, readToken, TTL_MS };
```

Dans `src/web.js` :
- en-tête, compléter la liste des routes du commentaire : `//    /stats, /api/stats/… → Dashboard admin (src/stats/web.js)` ;
- sous `const arenaMatches = require('./game/matches');` :
```js
const statsWeb = require('./stats/web');
const collections = require('./collections');
const { getAllMedia } = require('./media');
```
(`boosters` est déjà importé en entier dans `web.js` : on utilise `boosters.getBooster`. Si `collections` ou `getAllMedia` sont déjà importés, ne pas les dupliquer.)
- dans `createHandler`, juste avant `if (await arenaWeb.route(req, res, url)) return undefined;` :
```js
      if (await statsWeb.route(req, res, url)) return undefined;
```
- après `configureArena();` :
```js
// 📊 Dashboard /stats : mêmes secret et réponses
function configureStats({ client = null, logger = console } = {}) {
  statsWeb.configure({
    publicUrl: WEB_PUBLIC_URL, getSecret, send, sendJson, servePage, displayName, client, logger,
    catalogSize: () => getAllMedia().length,
    ownedCopies: (userId) => collections.countCopies(userId),
    boosterPrice: (boosters.getBooster('common') || {}).price || 20,
  });
}
configureStats();

/** Lien du dashboard /stats (admins seulement ; null sinon ou si la page web est désactivée). */
function buildStatsUrl(userId) {
  if (!isEnabled()) return null;
  return statsWeb.buildStatsUrl(userId);
}
```
- dans `startWebServer`, sous `configureArena({ client, logger });` : `configureStats({ client, logger });`
- ajouter `buildStatsUrl` au `module.exports`.

Dans `src/home.js` : documenter `@param {string|null} [ctx.statsUrl] - lien du dashboard /stats (admins)` ; remplacer `blocks.push(...buildAdminBlocks(ctx.autoTargets || []));` par `blocks.push(...buildAdminBlocks(ctx.autoTargets || [], ctx.statsUrl));` ; changer la signature en `function buildAdminBlocks(autoTargets, statsUrl = null) {` et, juste après l'élément `{ type: 'header', … '👑 Admin' … }`, insérer :
```js
    ...(statsUrl ? [{
      type: 'actions',
      block_id: 'home_admin_stats',
      elements: [{ ...button('📊 Stats du jeu', 'open_stats_web'), url: statsUrl }],
    }] : []),
```

Dans `src/app.js`, `buildHomeFor` : ajouter `statsUrl: isAdmin ? web.buildStatsUrl(userId) : null,` ; et sous le handler `open_collection_web` :
```js
// 📊 Bouton-lien « Stats du jeu » (admins) : la page s'ouvre dans le navigateur
app.action('open_stats_web', async ({ ack }) => {
  await ack();
});
```

- [ ] **Step 4: Page minimale pour le test** — créer `public/stats.html` provisoire contenant au moins `<canvas id="c-mass"></canvas>` (remplacé au Task 10) et `public/vendor/` vide avec `chart.umd.js` vide (remplacé au Task 10).

- [ ] **Step 5: Lancer** — `node scripts/test-stats-web.js` puis `node scripts/test-web-open.js && node scripts/test-arena-web.js && node scripts/test-app-booster.js`. Expected: tous ✅.

- [ ] **Step 6: Commit**

```bash
git add src/stats/web.js src/web.js src/home.js src/app.js public/stats.html public/vendor scripts/test-stats-web.js
git commit -m "🔐 API /stats signée admin (24 h) + bouton 📊 dans le panneau Admin"
```

---

### Task 10: Page `/stats` (filtres + graphiques)

**Files:**
- Create: `public/stats.html`, `public/stats.css`, `public/stats.js`, `public/vendor/chart.umd.js`, `scripts/preview-stats.js`
- Modify: `package.json` (devDependency `chart.js`)

**Interfaces:**
- Consumes: API du Task 9 (JSON `{ ok, kpis, prevKpis, series, tables, since, filters }`, `players` → `{ players: [{id, name}], firstAt }`).
- Produces: page autonome ; filtres reflétés dans l'URL (`range`, `from`, `to`, `grain`, `user`, `source`, `t`).

Avant d'écrire la page, charger la skill `dataviz` (palette, tuiles KPI, lisibilité clair/sombre) et appliquer ses règles aux couleurs `COLORS` ci-dessous si elles divergent.

- [ ] **Step 1: Vendoriser Chart.js**

```bash
npm install --save-dev chart.js@^4
mkdir -p public/vendor && cp node_modules/chart.js/dist/chart.umd.js public/vendor/chart.umd.js
head -c 200 public/vendor/chart.umd.js
```
Expected: en-tête `/*! Chart.js v4…`. (Si le fichier s'appelle `chart.umd.min.js` dans la version installée, copier celui-là sous le nom `chart.umd.js`.)

- [ ] **Step 2: `public/stats.html`**

```html
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Stats Jeanpip</title>
  <link rel="stylesheet" href="stats.css?v=__ASSET_VERSION__">
</head>
<body>
  <header class="bar">
    <h1>📊 Stats Jeanpip</h1>
    <form id="filters" class="filters">
      <label>Période
        <select name="range">
          <option value="7">7 jours</option>
          <option value="30" selected>30 jours</option>
          <option value="90">90 jours</option>
          <option value="all">Tout</option>
          <option value="custom">Dates…</option>
        </select>
      </label>
      <label class="custom">Du <input type="date" name="from"></label>
      <label class="custom">au <input type="date" name="to"></label>
      <label>Par
        <select name="grain">
          <option value="day">jour</option>
          <option value="week">semaine</option>
          <option value="month">mois</option>
        </select>
      </label>
      <label>Joueur <select name="user"><option value="">Tous</option></select></label>
      <label>Source
        <select name="source">
          <option value="">Toutes</option>
          <option value="reaction">Réactions</option>
          <option value="weekly_gift">Cadeaux du vendredi</option>
          <option value="arena_reward">Récompenses arène</option>
          <option value="media_author">Auteurs de médias</option>
          <option value="admin_gift">Dons admin</option>
          <option value="booster">Boosters</option>
          <option value="arena_shop">Boutique arène</option>
          <option value="attack">Attaques</option>
        </select>
      </label>
    </form>
    <p id="status" class="status" role="status"></p>
  </header>

  <main>
    <section id="economy">
      <h2>💰 Économie</h2>
      <p class="since"></p>
      <div class="kpis"></div>
      <div class="grid">
        <figure><figcaption>Masse en circulation</figcaption><canvas id="c-mass"></canvas></figure>
        <figure><figcaption>Créés vs consommés (barres) · flux net (ligne)</figcaption><canvas id="c-flow"></canvas></figure>
        <figure><figcaption>Moyenne et médiane par joueur</figcaption><canvas id="c-perplayer"></canvas></figure>
        <figure><figcaption>Créés par source · consommés par usage</figcaption><canvas id="c-sources"></canvas></figure>
      </div>
    </section>

    <section id="purchases">
      <h2>🛒 Achats</h2>
      <div class="kpis"></div>
      <div class="grid">
        <figure><figcaption>Achats par article dans le temps</figcaption><canvas id="c-items"></canvas></figure>
        <figure><figcaption>Classement des articles</figcaption><div class="table" id="t-items"></div></figure>
      </div>
    </section>

    <section id="boosters">
      <h2>🎁 Boosters</h2>
      <div class="kpis"></div>
      <div class="grid">
        <figure><figcaption>Ouvertures par type</figcaption><canvas id="c-opened"></canvas></figure>
        <figure><figcaption>🏆 Meilleurs boosters ouverts</figcaption><div class="table" id="t-best"></div></figure>
      </div>
    </section>

    <section id="cards">
      <h2>🃏 Cartes</h2>
      <p class="since"></p>
      <div class="kpis"></div>
      <div class="grid">
        <figure><figcaption>Nouvelles cartes : ajoutées au catalogue · découvertes</figcaption><canvas id="c-newcards"></canvas></figure>
        <figure><figcaption>Cartes découvertes par joueur (moyenne · médiane)</figcaption><canvas id="c-cardsavg"></canvas></figure>
        <figure><figcaption>Cartes découvertes par joueur</figcaption><div class="table" id="t-perplayer"></div></figure>
      </div>
    </section>

    <section id="arena">
      <h2>⚔️ Arène</h2>
      <p class="since"></p>
      <div class="kpis"></div>
      <div class="grid">
        <figure><figcaption>Combats</figcaption><canvas id="c-matches"></canvas></figure>
        <figure><figcaption>Cartes les plus jouées</figcaption><div class="table" id="t-topcards"></div></figure>
      </div>
    </section>

    <section id="activity">
      <h2>😀 Activité</h2>
      <p class="since"></p>
      <div class="kpis"></div>
      <div class="grid">
        <figure><figcaption>Réactions · joueurs actifs</figcaption><canvas id="c-activity"></canvas></figure>
        <figure><figcaption>Top réacteurs</figcaption><div class="table" id="t-reactors"></div></figure>
      </div>
    </section>
  </main>

  <script src="vendor/chart.umd.js?v=__ASSET_VERSION__"></script>
  <script src="stats.js?v=__ASSET_VERSION__"></script>
</body>
</html>
```

- [ ] **Step 3: `public/stats.css`**

```css
:root {
  --bg: #f6f7f9; --panel: #ffffff; --text: #1d2330; --muted: #677084; --line: #e3e6ec;
  --up: #1a7f4b; --down: #c0392b; --accent: #4f7cff;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #11141a; --panel: #1a1e26; --text: #e8ebf1; --muted: #9aa3b5; --line: #2a303b; --up: #4cc98a; --down: #ff7a6b; --accent: #7c9cff; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
.bar { position: sticky; top: 0; z-index: 5; background: var(--panel); border-bottom: 1px solid var(--line); padding: 10px 16px; }
.bar h1 { margin: 0 0 6px; font-size: 18px; }
.filters { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: end; }
.filters label { display: flex; flex-direction: column; font-size: 12px; color: var(--muted); gap: 2px; }
.filters select, .filters input { font: inherit; padding: 4px 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--text); }
.filters .custom { display: none; }
.filters.is-custom .custom { display: flex; }
.status { margin: 6px 0 0; font-size: 13px; color: var(--muted); min-height: 1em; }
.status.error { color: var(--down); }
main { max-width: 1280px; margin: 0 auto; padding: 16px; }
section { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-bottom: 18px; }
section h2 { margin: 0 0 4px; font-size: 17px; }
.since { margin: 0 0 10px; font-size: 12px; color: var(--muted); }
.since:empty { display: none; }
.kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin: 8px 0 14px; }
.kpi { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
.kpi .label { font-size: 12px; color: var(--muted); }
.kpi .value { font-size: 22px; font-weight: 650; font-variant-numeric: tabular-nums; }
.kpi .delta { font-size: 12px; font-variant-numeric: tabular-nums; }
.kpi .delta.up { color: var(--up); }
.kpi .delta.down { color: var(--down); }
.kpi.alert { border-color: var(--down); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 14px; }
figure { margin: 0; min-width: 0; }
figcaption { font-size: 13px; color: var(--muted); margin-bottom: 6px; }
canvas { width: 100% !important; height: 260px !important; }
.table { max-height: 300px; overflow: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid var(--line); }
th { color: var(--muted); font-weight: 600; position: sticky; top: 0; background: var(--panel); }
td.num, th.num { text-align: right; }
.empty { color: var(--muted); font-size: 13px; padding: 8px 0; }
@media (max-width: 520px) { .grid { grid-template-columns: 1fr; } canvas { height: 220px !important; } }
```

- [ ] **Step 4: `public/stats.js`**

```js
// ═══════════════════════════════════════════════════════════
//  📊 Dashboard Jeanpip — page /stats (admins)
//  Lit les blocs agrégés côté serveur (api/stats/<bloc>) et les dessine
//  avec Chart.js. Les filtres sont gardés dans l'URL (favoris).
// ═══════════════════════════════════════════════════════════
(() => {
  const form = document.getElementById('filters');
  const statusEl = document.getElementById('status');
  const params = new URLSearchParams(location.search);
  const token = params.get('t');
  const COLORS = ['#4f7cff', '#f5a524', '#17a35b', '#e5484d', '#8e4ec6', '#0ea5c6', '#ff7a45', '#7c8595'];
  const names = {};
  const charts = {};
  let firstAt = null;

  const LABELS = {
    reaction: 'Réactions', weekly_gift: 'Cadeaux du vendredi', arena_reward: 'Récompenses arène', media_author: 'Auteurs de médias',
    admin_gift: 'Dons admin', unknown: '❓ Inconnu', booster: 'Boosters', arena_shop: 'Boutique arène', attack: 'Attaques',
    common: 'Commun', rare: 'Rare', epic: 'Épique', legendary: 'Légendaire',
  };
  const label = (key) => String(key).split('/').map((k) => LABELS[k] || k).join(' · ');
  const who = (id) => names[id] || id;
  const fmt = (n, d = 1) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: d }));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ─── Filtres ⇄ URL ───
  for (const name of ['range', 'from', 'to', 'grain', 'user', 'source']) {
    if (params.get(name)) form.elements[name].value = params.get(name);
  }
  function syncUrl() {
    const q = new URLSearchParams({ t: token });
    for (const name of ['range', 'from', 'to', 'grain', 'user', 'source']) if (form.elements[name].value) q.set(name, form.elements[name].value);
    history.replaceState(null, '', `?${q}`);
    form.classList.toggle('is-custom', form.elements.range.value === 'custom');
  }
  function period() {
    const v = form.elements;
    const now = new Date();
    if (v.range.value === 'custom' && v.from.value && v.to.value) {
      return { from: new Date(`${v.from.value}T00:00:00`).toISOString(), to: new Date(`${v.to.value}T23:59:59`).toISOString() };
    }
    if (v.range.value === 'all') return { from: firstAt || new Date(now - 30 * 864e5).toISOString(), to: now.toISOString() };
    const days = Number(v.range.value) || 30;
    return { from: new Date(now - days * 864e5).toISOString(), to: now.toISOString() };
  }

  async function api(block) {
    const q = new URLSearchParams({ t: token, grain: form.elements.grain.value, ...period() });
    if (form.elements.user.value) q.set('user', form.elements.user.value);
    if (block === 'economy' && form.elements.source.value) q.set('source', form.elements.source.value);
    const res = await fetch(`api/stats/${block}?${q}`, { cache: 'no-store' });
    if (res.status === 403) throw new Error('Lien expiré ou non autorisé : rouvre « 📊 Stats du jeu » depuis l’onglet Accueil du bot.');
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) throw new Error(json.reason || `Erreur ${res.status}`);
    return json;
  }

  // ─── Rendu ───
  function kpis(sectionId, items, data) {
    const box = document.querySelector(`#${sectionId} .kpis`);
    box.innerHTML = items.map(({ key, text, unit = '', invert = false, alert }) => {
      const v = data.kpis[key];
      const p = data.prevKpis ? data.prevKpis[key] : null;
      let delta = '';
      if (typeof v === 'number' && typeof p === 'number' && p !== 0 && v !== p) {
        const pct = ((v - p) / Math.abs(p)) * 100;
        const good = invert ? pct < 0 : pct > 0;
        delta = `<div class="delta ${good ? 'up' : 'down'}">${pct > 0 ? '▲' : '▼'} ${fmt(Math.abs(pct), 0)} % vs période préc.</div>`;
      }
      const isAlert = alert && alert(v);
      return `<div class="kpi${isAlert ? ' alert' : ''}"><div class="label">${esc(text)}</div><div class="value">${fmt(v)}${unit}</div>${delta}</div>`;
    }).join('');
  }
  function since(sectionId, iso) {
    const el = document.querySelector(`#${sectionId} .since`);
    if (el) el.textContent = iso ? `Suivi depuis le ${new Date(iso).toLocaleDateString('fr-FR')}` : 'Pas encore de données';
  }
  function chart(id, config) {
    if (charts[id]) charts[id].destroy();
    const style = getComputedStyle(document.documentElement);
    Chart.defaults.color = style.getPropertyValue('--muted').trim();
    Chart.defaults.borderColor = style.getPropertyValue('--line').trim();
    config.options = { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, ...config.options };
    charts[id] = new Chart(document.getElementById(id), config);
  }
  const line = (name, data, i, extra = {}) => ({ type: 'line', label: name, data, borderColor: COLORS[i % COLORS.length], backgroundColor: COLORS[i % COLORS.length], tension: 0.25, pointRadius: 0, ...extra });
  const bar = (name, data, i, extra = {}) => ({ type: 'bar', label: name, data, backgroundColor: COLORS[i % COLORS.length], ...extra });
  function table(id, head, rows) {
    const el = document.getElementById(id);
    if (!rows.length) { el.innerHTML = '<p class="empty">Aucune donnée sur la période.</p>'; return; }
    el.innerHTML = `<table><thead><tr>${head.map(([h, num]) => `<th${num ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${head[i][1] ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  const RENDER = {
    economy(d) {
      since('economy', d.since);
      kpis('economy', [
        { key: 'mass', text: 'Masse en circulation' }, { key: 'mean', text: 'Moyenne / joueur' }, { key: 'median', text: 'Médiane / joueur' },
        { key: 'created', text: 'Créés' }, { key: 'consumed', text: 'Consommés' }, { key: 'net', text: 'Flux net' },
        { key: 'inflationPct', text: 'Inflation', unit: ' %', invert: true }, { key: 'spendRatePct', text: 'Taux de dépense', unit: ' %' },
        { key: 'purchasingPower', text: 'Pouvoir d’achat (boosters)' }, { key: 'players', text: 'Joueurs avec solde' },
        { key: 'ledgerGap', text: 'Écart ledger (doit être 0)', alert: (v) => v !== 0 }, { key: 'unknown', text: 'Mouvements sans source', alert: (v) => v > 0 },
      ], d);
      const s = d.series;
      chart('c-mass', { data: { labels: s.labels, datasets: [line('Masse', s.mass, 0, { fill: true, backgroundColor: 'rgba(79,124,255,.15)' })] } });
      chart('c-flow', { data: { labels: s.labels, datasets: [bar('Créés', s.created, 2), bar('Consommés', s.consumed, 3), line('Flux net', s.net, 0)] } });
      chart('c-perplayer', { data: { labels: s.labels, datasets: [line('Moyenne', s.mean, 0), line('Médiane', s.median, 1)] } });
      const src = d.tables.bySource; const use = d.tables.byUse;
      chart('c-sources', {
        type: 'bar',
        data: {
          labels: [...src.map((x) => `+ ${label(x.key)}`), ...use.map((x) => `− ${label(x.key)}`)],
          datasets: [{ label: 'Crédits', data: [...src.map((x) => x.credits), ...use.map((x) => x.credits)], backgroundColor: [...src.map(() => COLORS[2]), ...use.map(() => COLORS[3])] }],
        },
        options: { indexAxis: 'y', plugins: { legend: { display: false } } },
      });
    },
    purchases(d) {
      kpis('purchases', [{ key: 'purchases', text: 'Achats' }, { key: 'credits', text: 'Crédits dépensés' }, { key: 'buyers', text: 'Acheteurs' }], d);
      chart('c-items', { type: 'bar', data: { labels: d.series.labels, datasets: Object.entries(d.series.byItem).map(([k, v], i) => bar(label(k), v, i, { stack: 'a' })) }, options: { scales: { x: { stacked: true }, y: { stacked: true } } } });
      table('t-items', [['Article'], ['Achats', 1], ['Crédits', 1], ['Acheteurs', 1]], d.tables.items.map((x) => [label(x.key), fmt(x.count, 0), fmt(x.credits), fmt(x.buyers, 0)]));
    },
    boosters(d) {
      kpis('boosters', [{ key: 'bought', text: 'Achetés' }, { key: 'granted', text: 'Gagnés (arène)' }, { key: 'opened', text: 'Ouverts' }, { key: 'stock', text: 'Non ouverts (stock)' }], d);
      chart('c-opened', { type: 'bar', data: { labels: d.series.labels, datasets: Object.entries(d.series.openedByType).map(([k, v], i) => bar(label(k), v, i, { stack: 'a' })) }, options: { scales: { x: { stacked: true }, y: { stacked: true } } } });
      table('t-best', [['Joueur'], ['Booster'], ['Score', 1], ['Cartes'], ['Date']],
        d.tables.top.map((b) => [who(b.userId), label(b.boosterType), fmt(b.score, 0), b.cards.map((c) => label(c.rarity)).join(', '), new Date(b.at).toLocaleString('fr-FR')]));
    },
    cards(d) {
      since('cards', d.since);
      kpis('cards', [{ key: 'catalog', text: 'Cartes au catalogue' }, { key: 'owned', text: 'Exemplaires possédés' }, { key: 'added', text: 'Ajoutées (période)' },
        { key: 'discovered', text: 'Découvertes (période)' }, { key: 'mean', text: 'Moyenne / joueur' }, { key: 'median', text: 'Médiane / joueur' }], d);
      const s = d.series;
      chart('c-newcards', { data: { labels: s.labels, datasets: [bar('Ajoutées au catalogue', s.added, 1), line('Découvertes', s.discovered, 0)] } });
      chart('c-cardsavg', { data: { labels: s.labels, datasets: [line('Moyenne', s.mean, 0), line('Médiane', s.median, 1)] } });
      table('t-perplayer', [['Joueur'], ['Cartes', 1], ['% catalogue', 1]], d.tables.perPlayer.map((p) => [who(p.userId), fmt(p.cards, 0), `${fmt(p.pct)} %`]));
    },
    arena(d) {
      since('arena', d.since);
      kpis('arena', [{ key: 'matches', text: 'Combats' }, { key: 'decisive', text: 'Avec vainqueur' }, { key: 'draws', text: 'Nuls' }, { key: 'cancelled', text: 'Annulés', invert: true },
        { key: 'rewards', text: 'Crédits gagnés' }, { key: 'shop', text: 'Crédits dépensés (boutique)' }], d);
      const s = d.series;
      chart('c-matches', { type: 'bar', data: { labels: s.labels, datasets: [bar('Avec vainqueur', s.decisive, 0, { stack: 'a' }), bar('Nuls', s.draws, 1, { stack: 'a' }), bar('Annulés', s.cancelled, 7, { stack: 'a' })] }, options: { scales: { x: { stacked: true }, y: { stacked: true } } } });
      table('t-topcards', [['Carte'], ['Rareté'], ['Jouée', 1], ['Victoires', 1], ['% victoire', 1]],
        d.tables.topCards.map((c) => [c.title || c.url, label(c.rarity), fmt(c.plays, 0), fmt(c.wins, 0), `${fmt(c.winRate, 0)} %`]));
    },
    activity(d) {
      since('activity', d.since);
      kpis('activity', [{ key: 'reactions', text: 'Réactions Jeanpip' }, { key: 'activeUsers', text: 'Joueurs actifs' }, { key: 'reactionsPerActive', text: 'Réactions / actif' }], d);
      const s = d.series;
      chart('c-activity', { data: { labels: s.labels, datasets: [bar('Réactions', s.reactions, 0), line('Joueurs actifs', s.activeUsers, 1, { yAxisID: 'y1' })] }, options: { scales: { y1: { position: 'right', grid: { drawOnChartArea: false } } } } });
      table('t-reactors', [['Joueur'], ['Réactions', 1]], d.tables.topReactors.map((r) => [who(r.userId), fmt(r.reactions, 0)]));
    },
  };

  async function refresh() {
    syncUrl();
    statusEl.className = 'status';
    statusEl.textContent = 'Chargement…';
    try {
      const results = await Promise.all(Object.keys(RENDER).map((b) => api(b).then((d) => [b, d])));
      for (const [b, d] of results) RENDER[b](d);
      statusEl.textContent = `Mis à jour à ${new Date().toLocaleTimeString('fr-FR')}`;
    } catch (e) {
      statusEl.className = 'status error';
      statusEl.textContent = e.message;
    }
  }

  async function init() {
    if (!token) { statusEl.className = 'status error'; statusEl.textContent = 'Lien incomplet : ouvre la page depuis l’onglet Accueil du bot.'; return; }
    try {
      const res = await fetch(`api/stats/players?t=${encodeURIComponent(token)}`, { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        firstAt = j.firstAt;
        const sel = form.elements.user;
        const current = params.get('user') || '';
        for (const p of j.players) {
          names[p.id] = p.name || p.id;
          sel.add(new Option(p.name || p.id, p.id));
        }
        sel.value = current;
      }
    } catch { /* noms facultatifs */ }
    form.addEventListener('change', refresh);
    refresh();
  }
  init();
})();
```

- [ ] **Step 5: Aperçu local avec données** — `scripts/preview-stats.js`

```js
#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  👀 Aperçu du dashboard /stats avec des données fictives
//  Copie temporaire, 60 jours d'activité simulée, serveur sur :3196.
//  Usage : node scripts/preview-stats.js   → ouvrir l'URL affichée
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-preview-stats-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

process.env.WEB_PUBLIC_URL = 'http://127.0.0.1:3196';
process.env.WEB_SECRET = 'preview';
process.env.JEANPIP_ADMINS = 'UADMIN';

const req = (p) => require(path.join(TMP, 'src', p));
const db = req('db.js').getDb();
const events = req('events.js');
const { getAllMedia } = req('media.js');

let seed = 42;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const users = ['U01', 'U02', 'U03', 'U04', 'U05', 'U06', 'U07', 'U08'];
const catalog = getAllMedia();
const bal = new Map(users.map((u) => [u, 0]));
const move = (at, u, amount, kind, source, item = null) => {
  bal.set(u, bal.get(u) + amount);
  db.prepare('INSERT INTO credit_moves (at, user_id, amount, kind, source, item) VALUES (?, ?, ?, ?, ?, ?)').run(at, u, amount, kind, source, item);
};
const start = Date.now() - 60 * 864e5;
for (const u of users) move(new Date(start).toISOString(), u, Math.round(rnd() * 80), 'opening', 'migration');
const owned = new Map(users.map((u) => [u, new Set()]));
for (let day = 0; day < 60; day += 1) {
  for (let k = 0; k < 20 + day; k += 1) {
    const at = new Date(start + day * 864e5 + rnd() * 864e5).toISOString();
    const u = pick(users);
    const r = rnd();
    if (r < 0.6) { move(at, u, 0.5, 'earn', 'reaction'); events.record('reaction', u, {}, { at }); }
    else if (r < 0.75 && bal.get(u) >= 20) {
      const type = pick(['common', 'common', 'rare', 'epic']);
      const price = { common: 20, rare: 45, epic: 60 }[type];
      if (bal.get(u) < price) continue;
      const id = `b${day}_${k}`;
      move(at, u, -price, 'spend', 'booster', type);
      events.record('booster_bought', u, { boosterId: id, boosterType: type, price }, { at, dedup: `booster_created:${id}` });
      const cards = Array.from({ length: 8 }, () => pick(catalog));
      events.record('booster_opened', u, { boosterId: id, boosterType: type, cards, score: events.boosterScore(cards) }, { at, dedup: `booster_opened:${id}` });
      for (const c of cards) if (!owned.get(u).has(c.url)) { owned.get(u).add(c.url); events.record('card_discovered', u, { url: c.url, rarity: c.rarity }, { at, dedup: `disc:${u}:${c.url}` }); }
    } else if (r < 0.85) {
      const [a, b] = [pick(users), pick(users)];
      if (a === b) continue;
      const deck = (x) => [...owned.get(x)].slice(0, 8).map((url) => catalog.find((c) => c.url === url)).map((c) => ({ url: c.url, title: c.title, rarity: c.rarity, rented: false }));
      const res = pick(['win', 'win', 'win', 'draw', 'cancelled']);
      events.record('match_finished', null, { matchId: `m${day}_${k}`, result: res, players: [
        { userId: a, outcome: res === 'win' ? 'win' : res, deck: deck(a) }, { userId: b, outcome: res === 'win' ? 'loss' : res, deck: deck(b) }] }, { at, dedup: `match:m${day}_${k}` });
      if (res === 'win') move(at, a, 10, 'earn', 'arena_reward');
    } else if (day % 7 === 4) { move(at, u, 5, 'earn', 'weekly_gift'); }
  }
}
for (const [u, v] of bal) db.prepare('INSERT INTO balances (user_id, balance) VALUES (?, ?)').run(u, Math.max(0, v));

const web = req('web.js');
web.startWebServer({ client: null, logger: { info() {}, warn() {}, error: console.error }, port: 3196, force: true });
console.log(`👀 ${web.buildStatsUrl('UADMIN')}`);
```

(Les soldes peuvent passer sous 0 avant clamp dans cette simulation : sans importance pour un aperçu, mais l'écart ledger affiché ne sera pas 0 — c'est attendu ici et prouve que l'alerte fonctionne.)

- [ ] **Step 6: Vérifier dans le navigateur**

Run: `node scripts/preview-stats.js` (en arrière-plan) puis ouvrir l'URL affichée dans le navigateur intégré. Vérifier :
- les 6 sections affichent chiffres + graphiques, sans erreur console (`read_console_messages`) ;
- changer « Par » → semaine : les axes passent en lundis ;
- choisir un joueur : les chiffres changent, l'URL contient `user=` ;
- « Dates… » affiche les deux champs date ;
- largeur 375 px (`resize_window` preset mobile) : pas de défilement horizontal ;
- recharger avec `t=` modifié → message « Lien expiré ou non autorisé ».
Corriger ce qui cloche, puis remettre `resize_window` en `desktop`.

- [ ] **Step 7: Lancer `node scripts/test-stats-web.js`** → tous ✅ (la vraie page contient bien `<canvas`).

- [ ] **Step 8: Commit**

```bash
git add public/stats.html public/stats.css public/stats.js public/vendor/chart.umd.js scripts/preview-stats.js package.json package-lock.json
git commit -m "📊 Page /stats : filtres, KPIs avec comparaison, graphiques Chart.js"
```

---

### Task 11: Répétition générale sur les données de prod + doc de déploiement

**Files:**
- Modify: `README.md` (section déploiement), `docs/superpowers/specs/2026-09-29-dashboard-stats-design.md` (petits alignements)

- [ ] **Step 1: Copie des données de prod** — demander à Paul une copie de `/root/slack-emoji-reactor-bot/data/*.json` de la VM (ou la récupérer avec son accord : `scp root@BS-LORIENT-DASHBOARD:/root/slack-emoji-reactor-bot/data/*.json <dossier scratchpad>/prod-data/`). Ne **jamais** lancer quoi que ce soit sur la VM à ce stade.

- [ ] **Step 2: Répétition** (dans une copie du projet, jamais dans `data/` du dépôt) :

```bash
REH=$(mktemp -d) && cp -r src scripts public package.json "$REH"/ && ln -s "$PWD/node_modules" "$REH/node_modules" && mkdir "$REH/data" && cp <dossier>/prod-data/*.json "$REH/data/"
node -e "require('$REH/src/credits').ensureImported(); const db=require('$REH/src/db').getDb(); console.log(db.prepare('SELECT COUNT(*) n, SUM(amount) s FROM credit_moves').get()); console.log(db.prepare('SELECT SUM(balance) s FROM balances').get())"
node -e "const u=require('$REH/data/credits.json').users; console.log('json', Object.values(u).reduce((a,b)=>a+b,0))"
node "$REH/scripts/backfill-events.js" && node "$REH/scripts/backfill-events.js"
```
Expected : somme des soldes SQLite = somme de `credits.json` ; 2e rattrapage = tous les compteurs à 0. Puis lancer `preview`-like : démarrer le serveur web sur cette copie (adapter `scripts/preview-stats.js` en lui passant le dossier, ou lancer `node -e` avec `web.startWebServer({ force: true, port: 3195 })`) et vérifier les 6 blocs avec les vraies données, `écart ledger = 0`.

- [ ] **Step 3: README — section déploiement**, ajouter avant `## 🐛 Dépannage` :

```markdown
## 📊 Dashboard /stats et base SQLite

Depuis le dashboard d'utilisation, les crédits et le journal des stats vivent dans `data/jeanpip.db` (SQLite, fichier non versionné).

**Premier déploiement** (VM `BS-LORIENT-DASHBOARD`) :

    node --version                     # ≥ 18
    cd /root/slack-emoji-reactor-bot
    cp -r data data.bak-$(date +%F)    # sauvegarde
    git pull
    npm install                        # installe better-sqlite3
    node scripts/backfill-events.js    # rattrapage de l'historique (relançable)
    systemctl restart slack-reactor
    journalctl -u slack-reactor -n 50  # « Bot lancé », aucune erreur SQLite

Au premier démarrage, `data/credits.json` est importé puis n'est plus écrit (il reste en place). Le lien de la page est dans l'onglet Accueil du bot → 👑 Admin → 📊 Stats du jeu (valable 24 h).

**Retour arrière** : `node scripts/export-credits-json.js` (réécrit `credits.json` avec les soldes actuels) **puis** redéployer le commit précédent et `systemctl restart slack-reactor`.

**Sauvegarde** : copier `data/jeanpip.db` (et `jeanpip.db-wal` s'il existe) avec les autres fichiers de `data/`.
```

- [ ] **Step 4: Aligner la spec** — dans le tableau §5.2, retirer `via` des données de `card_discovered` (non disponible dans `collections.addCards`) et ajouter une ligne sous §6 : « Booster gagné en arène dans le passé : détecté si un booster commun a été créé ≤ 5 s après une victoire du même joueur. »

- [ ] **Step 5: Suite complète**

```bash
for f in scripts/test-*.js; do node "$f" > /tmp/out.txt 2>&1 && echo "✅ $f" || { echo "❌ $f"; tail -5 /tmp/out.txt; }; done
```
Expected: 100 % ✅.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-29-dashboard-stats-design.md
git commit -m "📚 Déploiement du dashboard /stats + alignement de la spec"
```
