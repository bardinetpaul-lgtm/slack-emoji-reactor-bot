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
