#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test du cycle de vie des combats (src/game/matches.js)
//
//  Préparation → combat → fin (règlement), annulations, abandon,
//  déconnexions, diffusion aux abonnés. Horloge simulée via step(now).
//  Travaille dans une COPIE temporaire du projet.
//
//  Usage : node scripts/test-arena-matches.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-arena-matches-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

const origLog = console.log;
console.log = () => {};
const matches = require(path.join(TMP, 'src', 'game', 'matches.js'));
const collections = require(path.join(TMP, 'src', 'collections.js'));
const arenaStore = require(path.join(TMP, 'src', 'game', 'arenaStore.js'));
const credits = require(path.join(TMP, 'src', 'credits.js'));
console.log = origLog;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const S = 1000;
function giveCards(userId, prefix, n = 10) {
  const cards = [];
  for (let i = 0; i < n; i += 1) cards.push({ url: `${prefix}${i}`, title: `${prefix}${i}`, rarity: 'common', type: 'image' });
  collections.addCards(userId, cards);
}
const totalCards = (u) => collections.getCollection(u).reduce((s, c) => s + c.count, 0);

giveCards('UA', 'a');
giveCards('UB', 'b');
giveCards('UC', 'c');
giveCards('UD', 'd', 5);

const ended = [];
matches.onEnd((match, summary) => ended.push({ match, summary }));

let T = 1_000_000;

// ─── Création ───
check('refus : moins de 8 cartes', matches.createMatchFor('UA', 'UD', T).reason === 'cards');
const m1 = matches.createMatchFor('UA', 'UB', T);
check('combat créé en préparation', m1.ok && matches.getMatch(m1.id).status === 'preparing');
check('les deux joueurs sont occupés', matches.isBusy('UA') && matches.isBusy('UB') && !matches.isBusy('UC'));
check('refus : joueur déjà en combat', matches.createMatchFor('UA', 'UC', T).reason === 'busy');
check('getMatchOf', matches.getMatchOf('UB').id === m1.id);

// ─── Préparation ───
const views = [];
const unsub = matches.subscribe(m1.id, 'UA', (v) => views.push(v));
check('abonné : état reçu immédiatement', views.length === 1 && views[0].phase === 'preparing');
check('préparation : mon deck de 8 cartes visible', views[0].deck.length === 8 && views[0].deck[0].archetype);
check('préparation : deck adverse caché', views[0].opponentDeck === undefined);

const newDeck = ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a9'];
check('changer de deck en préparation', matches.setDeck(m1.id, 'UA', newDeck).ok);
check('deck invalide refusé', matches.setDeck(m1.id, 'UA', ['a0']).reason === 'size');
check('deck choisi sauvegardé pour la prochaine fois', JSON.stringify(arenaStore.getDeck('UA')) === JSON.stringify(newDeck));

matches.connect(m1.id, 'UA', T);
matches.connect(m1.id, 'UB', T);
matches.setReady(m1.id, 'UA');
matches.step(T + S);
check('un seul prêt : toujours en préparation', matches.getMatch(m1.id).status === 'preparing');
matches.setReady(m1.id, 'UB');
matches.step(T + 2 * S);
check('les deux prêts : le combat démarre', matches.getMatch(m1.id).status === 'running');
check('abonné : phase combat', views[views.length - 1].phase === 'running' && views[views.length - 1].players.A.hand);

// ─── Combat ───
T += 2 * S;
const m = matches.getMatch(m1.id);
const sideA = m.players.A.userId === 'UA' ? 'A' : 'B';
const handCard = m.engine.players[sideA].hand.find((u) => m.engine.players[sideA].cards[u].cost <= 5);
const act = matches.action(m1.id, 'UA', { type: 'deploy', url: handCard, lane: 1 });
check('pose acceptée pendant le combat', act.ok);
check('action d\'un inconnu refusée', matches.action(m1.id, 'UZ', { type: 'forfeit' }).reason === 'not_player');
for (let i = 1; i <= 30; i += 1) matches.step(T + i * 100);
T += 3 * S;
check('le temps du moteur avance avec l\'horloge', m.engine.timeMs === 3000);

// ─── Abandon → règlement ───
const before = totalCards('UA');
matches.action(m1.id, 'UA', { type: 'forfeit' });
matches.step(T + 100);
check('abandon : combat terminé', matches.getMatch(m1.id).status === 'ended');
check('onEnd appelé avec le récap', ended.length === 1 && ended[0].summary.settled);
check('abandon : UA perd sa carte posée', totalCards('UA') === before - 1);
check('abandon : UB récompensé (+10 JP$, +1 JP$ de série)', credits.getBalance('UB') === 11);
check('plus occupés après la fin', !matches.isBusy('UA') && !matches.isBusy('UB'));
check('abonné : phase fin avec le récap', views[views.length - 1].phase === 'ended' && views[views.length - 1].summary);
unsub();

// ─── Préparation expirée, un joueur jamais venu → annulé ───
T += 10 * S;
const m2 = matches.createMatchFor('UA', 'UC', T);
matches.connect(m2.id, 'UA', T);
matches.step(T + 59 * S);
check('préparation : attend jusqu\'à 60 s', matches.getMatch(m2.id).status === 'preparing');
matches.step(T + 60 * S);
check('absent à 60 s → combat annulé', matches.getMatch(m2.id).status === 'cancelled');
check('annulé : onEnd prévenu', ended[ended.length - 1].summary.cancelled === true);

// ─── Préparation expirée, les deux présents → démarre avec le deck en cours ───
T += 100 * S;
const m3 = matches.createMatchFor('UA', 'UC', T);
matches.connect(m3.id, 'UA', T);
matches.connect(m3.id, 'UC', T);
matches.step(T + 60 * S);
check('les deux présents à 60 s → le combat démarre sans « Prêt »', matches.getMatch(m3.id).status === 'running');

// ─── Déconnexion > 20 s → défaite ───
T += 60 * S;
matches.disconnect(m3.id, 'UC', T);
matches.step(T + 19 * S);
check('déconnecté 19 s : combat continue', matches.getMatch(m3.id).status === 'running');
matches.connect(m3.id, 'UC', T + 19 * S);
matches.disconnect(m3.id, 'UC', T + 19.5 * S);
matches.step(T + 39 * S);
check('reconnexion : le compteur repart de zéro', matches.getMatch(m3.id).status === 'running');
matches.step(T + 40 * S);
check('déconnecté 20 s → défaite', matches.getMatch(m3.id).status === 'ended'
  && matches.getMatch(m3.id).engine.result.reason === 'disconnect');
const last = ended[ended.length - 1];
check('déconnexion : UA vainqueur', last.match.engine.result.winner === (last.match.players.A.userId === 'UA' ? 'A' : 'B'));

// ─── Les deux déconnectés → annulé ───
T += 100 * S;
const m4 = matches.createMatchFor('UA', 'UC', T);
matches.connect(m4.id, 'UA', T);
matches.connect(m4.id, 'UC', T);
matches.setReady(m4.id, 'UA');
matches.setReady(m4.id, 'UC');
matches.step(T + S);
matches.disconnect(m4.id, 'UA', T + S);
matches.disconnect(m4.id, 'UC', T + S);
matches.step(T + 21 * S);
check('les deux déconnectés → annulé, rien perdu', matches.getMatch(m4.id).status === 'cancelled');

// ─── Combat qui va au bout des 2 minutes ───
T += 100 * S;
const m5 = matches.createMatchFor('UB', 'UC', T);
matches.connect(m5.id, 'UB', T);
matches.connect(m5.id, 'UC', T);
matches.setReady(m5.id, 'UB');
matches.setReady(m5.id, 'UC');
matches.step(T);
for (let t = 100; t <= 121 * S; t += 100) matches.step(T + t);
check('à 2:00 le combat se termine tout seul', matches.getMatch(m5.id).status === 'ended');

// ─── Purge des combats terminés ───
matches.step(T + 121 * S + 11 * 60 * S);
check('combats terminés purgés après 10 min', matches.getMatch(m5.id) === null);

// ─── 📒 Journal des stats ───
{
  const conn = require(path.join(TMP, 'src', 'db.js')).getDb();
  const rows = conn.prepare("SELECT data FROM events WHERE type = 'match_finished'").all().map((r) => JSON.parse(r.data));
  check('match_finished enregistré pour chaque combat terminé/annulé', rows.length > 0);
  const played = rows.filter((d) => d.result !== 'cancelled');
  check('match_finished : decks joués présents', played.length > 0 && played.every((d) => d.players.every((p) => Array.isArray(p.deck) && p.deck.length > 0)));
  check('match_finished : issue cohérente', rows.every((d) => d.players.length === 2 && d.players.every((p) => ['win', 'loss', 'draw', 'cancelled'].includes(p.outcome))));
}

// ─── 📺 v2.3 : historique enrichi à la fin d'un vrai combat ───
{
  giveCards('UE', 'e');
  giveCards('UF', 'f');
  const t = T + 2_000_000;
  const h = matches.createMatchFor('UE', 'UF', t, { arena: 'port' });
  matches.connect(h.id, 'UE', t);
  matches.connect(h.id, 'UF', t);
  matches.setReady(h.id, 'UE');
  matches.setReady(h.id, 'UF');
  matches.step(t + S);
  matches.action(h.id, 'UE', { type: 'forfeit' });
  matches.step(t + 2 * S);
  const last = arenaStore.recentResults(1)[0];
  check('historique : combat enregistré avec ses deux joueurs', last && last.matchId === h.id && last.players.slice().sort().join() === 'UE,UF');
  check('historique : vainqueur = celui qui n\'a pas abandonné', last.winnerId === 'UF' && last.draw === false);
  check('historique : raison + tours détruites par joueur', last.reason === 'forfeit' && last.towers && last.towers.UE === 0 && last.towers.UF === 0);
}

// ─── 📺 v2.3 : JP TV (spectateurs) ───
{
  giveCards('UG', 'g');
  giveCards('UH', 'h');
  const seen = [];
  const off = matches.subscribeSpectator((match, evts) => seen.push({ id: match.id, events: evts.length }));
  const start = (id, t) => {
    matches.connect(id, 'UG', t);
    matches.connect(id, 'UH', t);
    matches.setReady(id, 'UG');
    matches.setReady(id, 'UH');
  };
  const t = T + 3_000_000;
  const tv = matches.createMatchFor('UG', 'UH', t);
  start(tv.id, t);
  check('JP TV : rien diffusé pendant la préparation', seen.length === 0);
  check('JP TV : un combat en préparation n\'est pas listé', !matches.listForTv().some((m) => m.id === tv.id));
  matches.step(t + S);
  const mt = matches.getMatch(tv.id);
  check('JP TV : combat lancé → diffusable, heure de début notée', mt.broadcast === true && mt.startedAt === t + S);
  check('JP TV : spectateurs prévenus', seen.some((s) => s.id === tv.id));
  const sv = matches.spectatorView(mt);
  check('JP TV : vue spectateur en combat, camp A en bas', sv.phase === 'running' && sv.you === 'A' && sv.arena === 'jardin');
  check('JP TV : ni main ni élixir des joueurs', ['A', 'B'].every((s) => sv.players[s].hand === undefined && sv.players[s].elixir === undefined && sv.players[s].elixirMax === undefined));
  check('JP TV : terrain visible (bâtiments)', Array.isArray(sv.buildings) && sv.buildings.length > 0);
  check('JP TV : listForTv le contient', matches.listForTv().some((m) => m.id === tv.id && m.status === 'running' && m.players.A === mt.players.A.userId && m.broadcast));
  matches.action(tv.id, 'UG', { type: 'forfeit' });
  matches.step(t + 2 * S);
  const ev = matches.spectatorView(mt);
  check('JP TV : vue de fin = vainqueur, raison, tours', ev.phase === 'ended' && ev.result.reason === 'forfeit' && ev.result.winner && ev.result.towers && ev.result.poses === undefined);
  off();
  const before = seen.length;

  // Refus de diffusion d'un seul joueur → combat non diffusé, mais bien compté
  arenaStore.setTvOptOut('UG', true);
  const t2 = t + 60 * S;
  const tv2 = matches.createMatchFor('UG', 'UH', t2);
  const seen2 = [];
  const off2 = matches.subscribeSpectator((match) => seen2.push(match.id));
  start(tv2.id, t2);
  matches.step(t2 + S);
  check('JP TV : un joueur refuse → combat non diffusé', matches.getMatch(tv2.id).broadcast === false && !seen2.includes(tv2.id));
  matches.action(tv2.id, 'UH', { type: 'forfeit' });
  matches.step(t2 + 2 * S);
  check('JP TV : combat non diffusé quand même dans les derniers combats', arenaStore.recentResults(1)[0].matchId === tv2.id);
  check('JP TV : désabonné → plus rien reçu', seen.length === before);
  off2();
  arenaStore.setTvOptOut('UG', false);
}

try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }   // Windows : fichier ouvert = non supprimable
fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
