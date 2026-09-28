#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test de l'Arène côté Slack (src/arenaSlack.js)
//
//  Faux Slack (actions / modales / DM enregistrés) :
//    • Accueil : bloc « ⚔️ Arène » selon l'état du joueur ;
//    • Défier : modale → DM Accepter / Refuser à la cible ;
//    • Accepter → combat créé + DM avec SON lien à chacun ;
//    • Refuser, annuler, expiration ; combat rapide (file) ;
//    • fin de combat → récap privé.
//  Travaille dans une COPIE temporaire du projet.
//
//  Usage : node scripts/test-arena-slack.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-arena-slack-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

const origLog = console.log;
console.log = () => {};
const arenaSlack = require(path.join(TMP, 'src', 'arenaSlack.js'));
const matches = require(path.join(TMP, 'src', 'game', 'matches.js'));
const matchmaking = require(path.join(TMP, 'src', 'game', 'matchmaking.js'));
const collections = require(path.join(TMP, 'src', 'collections.js'));
const media = require(path.join(TMP, 'src', 'media.js'));
console.log = origLog;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

// Joueurs : P1, P2, P3 avec 10 cartes ; POOR avec 3
const bank = media.getAllMedia();
for (const [u, from] of [['P1', 0], ['P2', 10], ['P3', 20]]) collections.addCards(u, bank.slice(from, from + 10));
collections.addCards('POOR', bank.slice(40, 43));

// ─── Faux Slack ───
const handlers = { action: {}, view: {} };
const app = { action: (id, fn) => { handlers.action[id] = fn; }, view: (id, fn) => { handlers.view[id] = fn; } };
const sent = [];
const edits = [];
const modals = [];
const refreshed = [];
let ts = 0;
const client = { chat: { update: async (m) => { edits.push(m); } } };
const links = {
  arena: (matchId, userId) => `https://x/arena/${matchId}?t=${userId}`,
  deck: (userId) => `https://x/deck?t=${userId}`,
  openBooster: (id, userId) => `https://x/open/${id}?t=${userId}`,
};
const hooks = arenaSlack.register(app, {
  sendDM: async (c, userId, msg) => { ts += 1; sent.push({ userId, ...msg }); return { channel: `D${userId}`, ts: String(ts) }; },
  isBot: async (c, userId) => userId === 'BOT',
  openModal: async (c, body, view) => { modals.push(view); },
  refreshHome: async (c, userId) => { refreshed.push(userId); },
  links,
});
hooks.setClient(client);
const acked = [];
const act = (id, userId, value) => handlers.action[id]({ ack: async (r) => { acked.push(r); }, body: { user: { id: userId }, trigger_id: 't' }, action: { value }, client });
const submit = (id, userId, values) => {
  let reply = null;
  return handlers.view[id]({ ack: async (r) => { reply = r || null; }, body: { user: { id: userId } }, view: { state: { values } }, client }).then(() => reply);
};
const defi = (to, arena = 'jardin') => ({ foe: { value: { selected_user: to } }, arena: { value: { selected_option: arena ? { value: arena } : null } } });
const home = (u) => arenaSlack.buildHomeBlocks(arenaSlack.homeState(u, links));
const flat = (blocks) => JSON.stringify(blocks);
const lastTo = (u) => [...sent].reverse().find((m) => m.userId === u);

(async () => {
  // 🏠 Accueil au repos
  const h = flat(home('P1'));
  check('Accueil : bloc Arène avec Défier, Combat rapide et Mon deck', h.includes('arena_challenge_open') && h.includes('arena_queue_join') && h.includes('https://x/deck?t=P1'));
  check('Accueil : bilan V/D/N et prochaine arène', h.includes('V ·') && h.includes('Le port dans 10 victoires'));
  check('Accueil : moins de 8 cartes → pas de bouton de combat', !flat(home('POOR')).includes('arena_challenge_open') && flat(home('POOR')).includes('au moins 8 cartes'));
  check('Accueil : page web désactivée → message clair', flat(arenaSlack.buildHomeBlocks(arenaSlack.homeState('P1', { arena: () => null, deck: () => null })))
    .includes('pas disponible'));

  // ⚔️ Défier : modale + contrôles
  await act('arena_challenge_open', 'P1');
  check('Défier : la modale propose un adversaire et les arènes débloquées', modals[0] && modals[0].callback_id === 'arena_challenge_submit' && flat(modals[0]).includes('users_select') && flat(modals[0]).includes('jardin'));
  check('refus : se défier soi-même', (await submit('arena_challenge_submit', 'P1', defi('P1'))).errors.foe.includes('toi-même'));
  check('refus : défier un bot', (await submit('arena_challenge_submit', 'P1', defi('BOT'))).errors.foe.includes('bot'));
  check('refus : adversaire sans 8 cartes', (await submit('arena_challenge_submit', 'P1', defi('POOR'))).errors.foe.includes('8 cartes'));
  check('refus : arène pas encore débloquée', (await submit('arena_challenge_submit', 'P1', defi('P2', 'serveurs'))).errors.arena.includes('débloquée'));

  const ok = await submit('arena_challenge_submit', 'P1', defi('P2'));
  const invite = lastTo('P2');
  check('défi envoyé : la modale se ferme', ok === null);
  check('défi : DM à la cible avec Accepter / Refuser', invite && flat(invite.blocks).includes('arena_accept') && flat(invite.blocks).includes('arena_refuse') && invite.text.includes('<@P1>'));
  check('défi : le challenger est prévenu', lastTo('P1').text.includes('Défi envoyé à <@P2>'));
  check('Accueil du challenger : défi en attente + Annuler', flat(home('P1')).includes('arena_challenge_cancel'));
  check('Accueil de la cible : Accepter depuis l\'Accueil aussi', flat(home('P2')).includes('arena_accept'));
  check('Accueils rafraîchis', refreshed.includes('P1') && refreshed.includes('P2'));

  // ✅ Accepter → combat + liens
  const challengeId = JSON.parse(flat(invite.blocks)).find((b) => b.type === 'actions').elements[0].value;
  await act('arena_accept', 'P2', challengeId);
  const m = matches.getMatchOf('P1');
  check('accepté : combat créé entre les deux', m && m.players.A.userId === 'P1' && m.players.B.userId === 'P2' && m.status === 'preparing');
  check('accepté : chacun reçoit SON lien de combat', flat(lastTo('P1').blocks).includes(`https://x/arena/${m.id}?t=P1`) && flat(lastTo('P2').blocks).includes(`https://x/arena/${m.id}?t=P2`));
  check('accepté : le message de défi est remplacé', edits.some((e) => e.text.includes('accepté')));
  check('Accueil pendant le combat : « Rejoindre mon combat »', flat(home('P1')).includes('Rejoindre mon combat') && !flat(home('P1')).includes('arena_queue_join'));
  check('déjà en combat : impossible de défier', (await submit('arena_challenge_submit', 'P3', defi('P1'))).errors.foe.includes('déjà en combat'));

  // 🏁 Fin : combat annulé (personne ne vient) → récap « rien n'est perdu »
  const before = sent.length;
  matches.step(m.prepDeadline + 1000);
  await new Promise((r) => setTimeout(r, 20));
  const recaps = sent.slice(before);
  check('fin : un récap privé à chacun', recaps.filter((x) => x.userId === 'P1').length === 1 && recaps.filter((x) => x.userId === 'P2').length === 1);
  check('fin : combat annulé → rien n\'est perdu', recaps[0].text.includes('annulé') && recaps[0].text.includes('rien'));
  check('après le combat : les boutons reviennent', flat(home('P1')).includes('arena_queue_join'));

  // ✖️ Refus
  await submit('arena_challenge_submit', 'P1', defi('P3'));
  const id2 = JSON.parse(flat(lastTo('P3').blocks)).find((b) => b.type === 'actions').elements[0].value;
  await act('arena_refuse', 'P3', id2);
  check('refusé : les deux messages sont mis à jour', edits.some((e) => e.text.includes('refusé le défi')) && edits.some((e) => e.text.includes('a refusé ton défi')));
  check('refusé : plus de défi en attente', !matchmaking.statusOf('P1').outgoing);
  await act('arena_accept', 'P3', id2);
  check('défi déjà traité : message clair', lastTo('P3').text.includes('expiré ou a déjà été traité'));

  // ⌛ Expiration
  await submit('arena_challenge_submit', 'P1', defi('P3'));
  const exp = matchmaking.statusOf('P1').outgoing;
  exp.expiresAt = Date.now() - 1;
  await new Promise((r) => setTimeout(r, 5300));
  check('défi sans réponse : expiré et messages mis à jour', !matchmaking.statusOf('P1').outgoing && edits.some((e) => e.text.includes('expiré')));

  // ⚡ Combat rapide
  await act('arena_queue_join', 'P1');
  check('file : P1 attend, message + Accueil « Quitter la file »', matchmaking.statusOf('P1').inQueue && flat(home('P1')).includes('arena_queue_leave'));
  await act('arena_queue_join', 'P3');
  const q = matches.getMatchOf('P3');
  check('file : P3 arrive → combat P1 contre P3, liens envoyés', q && [q.players.A.userId, q.players.B.userId].sort().join() === 'P1,P3' && flat(lastTo('P3').blocks).includes('https://x/arena/'));
  check('file : le message d\'attente de P1 est remplacé', edits.some((e) => e.text.includes('Adversaire trouvé')));

  // 🏆 Récap de victoire (construction seule)
  const fake = { status: 'ended', players: { A: { userId: 'W' }, B: { userId: 'L' } }, engine: { result: { winner: 'A', reason: 'towers', outOfCards: true } } };
  const sum = { A: { lost: [{ title: 'Carte perdue' }], kept: [{ title: 'Carte gardée' }], loot: { title: 'Butin' }, stolen: null, boosterId: 'b1', credits: 10 }, B: { lost: [{ title: 'Butin' }], kept: [], loot: null, stolen: { title: 'Butin' }, boosterId: null, credits: 0 } };
  const win = arenaSlack.buildResultDM(fake, sum, 'W', links);
  const lose = arenaSlack.buildResultDM(fake, sum, 'L', links);
  check('récap vainqueur : victoire, butin, booster ouvrable', win.text.includes('Victoire') && flat(win.blocks).includes('Butin') && flat(win.blocks).includes('open_booster') && flat(win.blocks).includes('https://x/open/b1'));
  check('récap : raison de la fin (toutes les cartes jouées)', flat(win.blocks).includes('Toutes les cartes jouées'));
  check('récap perdant : défaite, carte volée', lose.text.includes('Défaite') && flat(lose.blocks).includes('part chez'));

  matches.stop();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
