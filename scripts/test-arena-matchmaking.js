#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test du matchmaking de l'Arène (src/game/matchmaking.js)
//
//  Défis (accepter, refuser, expirer), file rapide, refus si déjà
//  en combat ou moins de 8 cartes différentes. Horloge simulée.
//
//  Usage : node scripts/test-arena-matchmaking.js
// ═══════════════════════════════════════════════════════════
const path = require('path');

const mm = require(path.join(__dirname, '..', 'src', 'game', 'matchmaking.js'));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const inMatch = new Set();
const cards = { UA: 10, UB: 10, UC: 10, UD: 3, UE: 10, UF: 10 };
mm.configure({ isBusy: (u) => inMatch.has(u), cardCount: (u) => cards[u] || 0 });

const T0 = 1_000_000;
const S = 1000;

// ─── 🎯 Défis ───
mm.reset();
check('refus : se défier soi-même', mm.createChallenge('UA', 'UA', T0).reason === 'self');
check('refus : moins de 8 cartes (challenger)', mm.createChallenge('UD', 'UA', T0).reason === 'cards_from');
check('refus : moins de 8 cartes (cible)', mm.createChallenge('UA', 'UD', T0).reason === 'cards_to');
inMatch.add('UC');
check('refus : cible déjà en combat', mm.createChallenge('UA', 'UC', T0).reason === 'busy_to');
check('refus : challenger en combat', mm.createChallenge('UC', 'UA', T0).reason === 'busy_from');
inMatch.delete('UC');

const c1 = mm.createChallenge('UA', 'UB', T0);
check('défi créé', c1.ok && c1.id && c1.expiresAt === T0 + 60 * S);
check('challenger en attente', mm.isWaiting('UA'));
check('refus : un seul défi sortant à la fois', mm.createChallenge('UA', 'UC', T0).reason === 'busy_from');
check('seule la cible peut accepter', mm.acceptChallenge(c1.id, 'UC', T0 + S).reason === 'not_target');
const acc = mm.acceptChallenge(c1.id, 'UB', T0 + 10 * S);
check('défi accepté → les deux joueurs', acc.ok && acc.from === 'UA' && acc.to === 'UB');
check('défi consommé', mm.acceptChallenge(c1.id, 'UB', T0 + 11 * S).reason === 'not_found');
check('challenger plus en attente', !mm.isWaiting('UA'));

// Refus
const c2 = mm.createChallenge('UA', 'UB', T0);
const ref = mm.refuseChallenge(c2.id, 'UB');
check('défi refusé', ref.ok && ref.from === 'UA' && ref.to === 'UB');
const c2b = mm.createChallenge('UA', 'UB', T0);
check('le challenger peut annuler son défi', mm.refuseChallenge(c2b.id, 'UA').ok);

// Expiration
const c3 = mm.createChallenge('UA', 'UB', T0);
check('pas expiré à 59 s', mm.sweep(T0 + 59 * S).expiredChallenges.length === 0);
const sw = mm.sweep(T0 + 60 * S);
check('expiré à 60 s', sw.expiredChallenges.length === 1 && sw.expiredChallenges[0].id === c3.id);
check('défi expiré inacceptable', mm.acceptChallenge(c3.id, 'UB', T0 + 61 * S).reason === 'not_found');

// Acceptation après un changement de situation
const c4 = mm.createChallenge('UA', 'UB', T0);
inMatch.add('UA');
check('acceptation refusée si le challenger est parti en combat', mm.acceptChallenge(c4.id, 'UB', T0 + S).reason === 'busy_from');
inMatch.delete('UA');

// Accepter un défi annule les autres défis des deux joueurs
mm.reset();
const d1 = mm.createChallenge('UA', 'UB', T0);
const d2 = mm.createChallenge('UC', 'UB', T0);
const d3 = mm.createChallenge('UE', 'UA', T0);
const a2 = mm.acceptChallenge(d1.id, 'UB', T0 + S);
check('défis concurrents annulés et renvoyés', a2.cancelled.map((c) => c.id).sort().join() === [d2.id, d3.id].sort().join());

// ─── ⚡ File rapide ───
mm.reset();
check('refus file : moins de 8 cartes', mm.joinQueue('UD', T0).reason === 'cards');
const q1 = mm.joinQueue('UA', T0);
check('1er joueur : en attente', q1.ok && q1.matched === null && mm.isWaiting('UA'));
check('rejoindre deux fois : sans effet', mm.joinQueue('UA', T0).matched === null);
const q2 = mm.joinQueue('UB', T0 + 5 * S);
check('2e joueur : associé au 1er', q2.ok && q2.matched === 'UA');
check('file vidée', !mm.isWaiting('UA') && !mm.isWaiting('UB'));

mm.joinQueue('UC', T0);
check('quitter la file', mm.leaveQueue('UC') === true && !mm.isWaiting('UC'));
mm.joinQueue('UC', T0);
inMatch.add('UC');
check('joueur parti en combat : pas associé', mm.joinQueue('UE', T0 + S).matched === null);
inMatch.delete('UC');
mm.reset();
mm.joinQueue('UE', T0);
const sq = mm.sweep(T0 + 60 * S);
check('file expirée à 60 s', sq.expiredQueue.length === 1 && sq.expiredQueue[0] === 'UE' && !mm.isWaiting('UE'));

// En file = occupé pour les défis
mm.reset();
mm.joinQueue('UA', T0);
check('refus : défier quelqu\'un qui est en file', mm.createChallenge('UB', 'UA', T0).reason === 'busy_to');

console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
