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

try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }   // Windows : fichier ouvert = non supprimable
fs.rmSync(TMP, { recursive: true, force: true });
fs.rmSync(empty, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n🎉 Rattrapage OK');
process.exit(failures ? 1 : 0);
