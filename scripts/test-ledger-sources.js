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
  const admin = createAdminActions({ safeSendDM: async () => {}, isBot: async () => false, targetEmoji: 'jeanpip' });
  await admin.adjustCredits(fakeClient, 'U_ADMIN', 'UC', 10, quiet);
  const gift = move("user_id = 'UC' AND kind = 'earn'");
  check('don admin → admin_gift', gift && gift.source === 'admin_gift' && gift.ref === 'U_ADMIN');
  await admin.adjustCredits(fakeClient, 'U_ADMIN', 'UC', -4, quiet);
  const adj = move("user_id = 'UC' AND kind = 'adjust'");
  check('correction admin → adjust/admin_adjust', adj && adj.source === 'admin_adjust' && adj.amount === -4);
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

  db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failures ? `\n❌ ${failures} échec(s)` : '\n🎉 Sources et événements OK');
  process.exit(failures ? 1 : 0);
})();
