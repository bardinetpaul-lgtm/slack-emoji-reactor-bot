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
