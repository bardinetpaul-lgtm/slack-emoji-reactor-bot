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

// 7️⃣ Base perdue après l'import : on NE réimporte PAS en silence un credits.json périmé
{
  const { tmp, credits, db } = freshProject(JSON.stringify({ users: { UA: 10 } }));
  credits.getBalance('UA');
  const marker = path.join(tmp, 'data', 'credits.json.imported');
  check('import : marqueur écrit', fs.existsSync(marker) && JSON.parse(fs.readFileSync(marker, 'utf-8')).total === 10);
  db.close();
  for (const f of ['jeanpip.db', 'jeanpip.db-wal', 'jeanpip.db-shm']) fs.rmSync(path.join(tmp, 'data', f), { force: true });
  delete require.cache[require.resolve(path.join(tmp, 'src', 'credits.js'))];
  delete require.cache[require.resolve(path.join(tmp, 'src', 'db.js'))];
  const credits2 = require(path.join(tmp, 'src', 'credits.js'));
  let msg = '';
  try { credits2.ensureImported(); } catch (e) { msg = e.message; }
  check(`base vide + marqueur → refus de démarrer (${msg || 'aucune erreur'})`, /déjà été importé/.test(msg));
  require(path.join(tmp, 'src', 'db.js')).close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 8️⃣ credits.json réécrit après l'import (retour arrière puis redéploiement) → refus
{
  const { tmp, credits, db } = freshProject(JSON.stringify({ users: { UA: 10 } }));
  credits.getBalance('UA');
  db.close();
  const json = path.join(tmp, 'data', 'credits.json');
  fs.writeFileSync(json, JSON.stringify({ users: { UA: 99 } }));
  const future = new Date(Date.now() + 60000);
  fs.utimesSync(json, future, future);
  delete require.cache[require.resolve(path.join(tmp, 'src', 'credits.js'))];
  delete require.cache[require.resolve(path.join(tmp, 'src', 'db.js'))];
  const credits2 = require(path.join(tmp, 'src', 'credits.js'));
  let msg = '';
  try { credits2.ensureImported(); } catch (e) { msg = e.message; }
  check('credits.json modifié après import → refus de démarrer', /modifié après/.test(msg));
  require(path.join(tmp, 'src', 'db.js')).close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? `\n❌ ${failures} échec(s)` : '\n🎉 Crédits SQLite OK');
process.exit(failures ? 1 : 0);
