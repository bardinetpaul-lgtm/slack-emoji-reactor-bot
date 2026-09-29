#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test de l'achat de cartes mystère (src/game/shop.js + combats)
//
//  Épique mystère 25 crédits · Légendaire mystère 40 crédits ;
//  2 achats max par combat ; carte tirée au hasard, cachée jusqu'au
//  combat ; valable pour ce combat seulement (jamais dans la
//  collection, jamais perdue ni volée) ; crédits débités au lancement.
//  Travaille dans une COPIE temporaire du projet.
//
//  Usage : node scripts/test-arena-shop.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-arena-shop-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

const origLog = console.log;
console.log = () => {};
const shop = require(path.join(TMP, 'src', 'game', 'shop.js'));
const deck = require(path.join(TMP, 'src', 'game', 'deck.js'));
const matches = require(path.join(TMP, 'src', 'game', 'matches.js'));
const arenaStore = require(path.join(TMP, 'src', 'game', 'arenaStore.js'));
const collections = require(path.join(TMP, 'src', 'collections.js'));
const credits = require(path.join(TMP, 'src', 'credits.js'));
const media = require(path.join(TMP, 'src', 'media.js'));
console.log = origLog;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const bank = media.getAllMedia();
const L = shop.token('legendary');
const E = shop.token('epic');

// 🏷️ Règles
check('prix : épique 25, légendaire 40', shop.PRICES.epic === 25 && shop.PRICES.legendary === 40);
check('jetons reconnus', shop.isToken(L) && shop.isToken(E) && !shop.isToken(bank[0].url) && shop.tokenRarity(L) === 'legendary');
check('coût d\'un deck', shop.deckCost(['a', L, E]) === 65 && shop.deckCost(['a']) === 0);
const drawn = shop.drawCard('legendary', []);
check('tirage : une vraie carte légendaire du catalogue', drawn && drawn.rarity === 'legendary' && bank.some((m) => m.url === drawn.url));
const legend = bank.filter((m) => m.rarity === 'legendary').map((m) => m.url);
check('tirage : jamais une carte déjà dans le deck', !legend.slice(0, -1).includes(shop.drawCard('legendary', legend.slice(0, -1)).url));

// 🃏 Deck avec achats
const col = bank.slice(0, 6).map((m) => ({ ...m, count: 1 }));
const six = col.map((c) => c.url);
check('deck : 6 cartes + 2 achats = valide', deck.validateDeck(col, [...six, L, E]).ok);
check('deck : 3 achats refusés', deck.validateDeck(col, [...six.slice(0, 5), L, E, L]).reason === 'shop_limit');
check('deck : les achats complètent une petite collection', deck.resolveDeck([...six, L, E], col) && deck.resolveDeck([...six, L, E], col).urls.length === 8);
arenaStore.setDecks('UX', { active: 0, decks: [{ name: 'D', cards: [...six, L] }, {}, {}] });
check('les achats ne sont pas enregistrés dans les decks sauvegardés', !arenaStore.getDecks('UX').decks[0].cards.some(shop.isToken));

// ⚔️ Combat : débit au lancement, carte valable pour ce combat seulement
const give = (u, cards) => collections.addCards(u, cards.map((m) => ({ ...m, type: 'image' })));
give('UA', bank.slice(0, 10));
give('UB', bank.slice(10, 20));
credits.addCredit('UA', 100);
let T = 1_000_000;
const m = matches.createMatchFor('UA', 'UB', T);
const mine = bank.slice(0, 6).map((c) => c.url);
check('Prêt avec 2 achats : accepté', matches.setDeck(m.id, 'UA', [...mine, L, E]).ok);
check('préparation : rien de débité', credits.getBalance('UA') === 100);
check('préparation : la carte achetée reste cachée', !JSON.stringify(matches.view(matches.getMatch(m.id), 'UA').deck).includes('legendary') || matches.view(matches.getMatch(m.id), 'UA').deck.filter((c) => c.mystery).length === 2);
matches.connect(m.id, 'UA', T);
matches.connect(m.id, 'UB', T);
matches.setReady(m.id, 'UA');
matches.setReady(m.id, 'UB');
matches.step(T + 1000);
const g = matches.getMatch(m.id);
check('lancement : 65 crédits débités', credits.getBalance('UA') === 35);
const side = g.players.A.userId === 'UA' ? 'A' : 'B';
const rented = Object.values(g.engine.players[side].cards).filter((c) => c.rented);
check('combat : 2 cartes achetées dans le deck, une légendaire et une épique', rented.length === 2 && rented.some((c) => c.rarity === 'legendary') && rented.some((c) => c.rarity === 'epic'));
check('combat : révélées dans la main', rented.every((c) => g.engine.players[side].hand.includes(c.url)));
// on pose la carte achetée si elle est en main, puis on abandonne
const r = rented.find((c) => g.engine.players[side].hand.includes(c.url));
if (r) {
  g.engine.players[side].elixir = 10;
  matches.action(m.id, 'UA', { type: 'deploy', url: r.url, lane: 1 });
}
const before = collections.getCollection('UA').reduce((a, c) => a + c.count, 0);
matches.action(m.id, 'UA', { type: 'forfeit' });
matches.step(T + 1200);
check('fin : la carte achetée n\'est jamais retirée ni volée', !g.summary.B.loot || !rented.some((c) => c.url === g.summary.B.loot.url));
check('fin : jamais ajoutée à la collection', rented.every((c) => !collections.getCollection('UA').some((x) => x.url === c.url && !bank.slice(0, 10).some((b) => b.url === c.url))));
check('fin : le récap mentionne les achats', g.summary.A && Array.isArray(matches.view(g, 'UA').rented) && matches.view(g, 'UA').rented.length === 2);
void before;

// ❌ Combat annulé : rien débité
T += 100000;
credits.setBalance('UA', 100);
const c = matches.createMatchFor('UA', 'UB', T);
matches.setDeck(c.id, 'UA', [...mine, L, E]);
matches.connect(c.id, 'UA', T);
matches.step(T + 61000);
check('annulé : aucun crédit débité', matches.getMatch(c.id).status === 'cancelled' && credits.getBalance('UA') === 100);

// 💸 Solde insuffisant au lancement : l'achat saute, le deck est complété
T += 100000;
credits.setBalance('UA', 30);
const p = matches.createMatchFor('UA', 'UB', T);
matches.setDeck(p.id, 'UA', [...mine, L, E]);
matches.connect(p.id, 'UA', T);
matches.connect(p.id, 'UB', T);
matches.setReady(p.id, 'UA');
matches.setReady(p.id, 'UB');
matches.step(T + 1000);
const pg = matches.getMatch(p.id);
const ps = pg.players.A.userId === 'UA' ? 'A' : 'B';
const pr = Object.values(pg.engine.players[ps].cards).filter((c) => c.rented);
check('solde 30 : l\'épique (25) passe, la légendaire (40) saute', pr.length === 1 && pr[0].rarity === 'epic' && credits.getBalance('UA') === 5);
check('solde insuffisant : deck quand même complet', pg.engine.players[ps].hand.length === 8);

matches.stop();
try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }   // Windows : fichier ouvert = non supprimable
fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
