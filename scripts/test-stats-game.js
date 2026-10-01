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
// 📒 Avec le classeur : même chiffre que le joueur (possédées, hors Hors série), l'historique à part
const cAlbum = game.cards(f, { db, catalogSize: 4, ownedCopies: 7, albumStats: (u) => (u === 'UA' ? { owned: 1, total: 3, extra: 1 } : { owned: 1, total: 3, extra: 0 }) });
const ua = cAlbum.tables.perPlayer.find((p) => p.userId === 'UA');
check('par joueur = classeur : UA 1 / 3 (33,3 %), 1 hors série, 2 obtenues un jour', ua.cards === 1 && ua.total === 3 && ua.pct === 33.3 && ua.extra === 1 && ua.discovered === 2);
check('sans classeur branché : repli sur l’historique', c.tables.perPlayer[0].discovered === 2 && c.tables.perPlayer[0].extra === null);
check('par rareté', c.tables.byRarity.find((x) => x.key === 'common').count === 2);

const a = game.arena(f, { db });
check('combats : 3 (1 décisif, 1 nul, 1 annulé)', a.kpis.matches === 3 && a.kpis.decisive === 1 && a.kpis.draws === 1 && a.kpis.cancelled === 1);
const u2 = a.tables.topCards.find((x) => x.url === 'u2');
check('u2 jouée 4 fois (présence par deck), 1 victoire → 25 %', u2.plays === 4 && u2.wins === 1 && u2.winRate === 25);
const u1 = a.tables.topCards.find((x) => x.url === 'u1');
check('doublon dans un deck compté une fois', u1.plays === 2);
check('JP$ arène', a.kpis.rewards === 10 && a.kpis.shop === 25);
check('joueurs actifs arène', a.tables.players[0].userId === 'UA' && a.tables.players[0].matches === 3);
check('filtre joueur UC', game.arena({ ...f, user: 'UC' }, { db }).kpis.matches === 1);
// 🏆 Classement : UA (1 victoire, 1 nul, 1 annulé) devant UB (1 défaite, 1 nul) ; UC n'a qu'un combat annulé
const [first, second] = a.tables.ranking;
check('classement : 2 joueurs classés (combat annulé seul = non classé)', a.tables.ranking.length === 2 && a.kpis.fighters === 2);
check('classement : UA 1er, 1 victoire / 2 combats = 50 %, 10 JP$', first.userId === 'UA' && first.wins === 1 && first.draws === 1 && first.losses === 0 && first.played === 2 && first.winRate === 50 && first.rewards === 10);
check('classement : UB 2e, 1 défaite, 1 nul, 0 %', second.userId === 'UB' && second.losses === 1 && second.draws === 1 && second.winRate === 0 && second.rewards === 0);
const fHour = time.normalizeFilters({ from: d(10, 14), to: d(10, 16), grain: 'hour' });
check('combats par heure', game.arena(fHour, { db }).series.decisive.join() === '0,1,0' && game.activity(fHour, { db }).series.labels.length === 3);

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

try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }   // Windows : fichier ouvert = non supprimable
fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n🎉 Stats jeu OK');
process.exit(failures ? 1 : 0);
