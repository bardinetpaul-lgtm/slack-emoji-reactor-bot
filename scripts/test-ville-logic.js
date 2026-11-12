#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test de la logique pure de la ville Jeanpip (public/ville-logic.js)
//
//  Heure de Paris → lumière, parcelle → position (jamais sur un
//  bâtiment ni dans l'eau), file des promeneurs (15 au plus, un seul
//  par joueur), chemins des promeneurs, liens avec le jeton de retour.
//
//  Usage : node scripts/test-ville-logic.js
// ═══════════════════════════════════════════════════════════
const L = require('../public/ville-logic.js');

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

// ── 🌙 Lumière selon l'heure de Paris ───────────────────────
check('23 h → nuit', L.lightAt(23).night === true);
check('3 h → nuit', L.lightAt(3).night === true);
check('12 h → jour', L.lightAt(12).night === false);
check('12 h : fenêtres éteintes', L.lightAt(12).windows === 0);
check('23 h : fenêtres allumées', L.lightAt(23).windows === 1);
check('12 h : le soleil est haut', L.lightAt(12).sun.y > 0.7);
check('3 h : le soleil est sous l\'horizon (lune)', L.lightAt(3).sunBelow === true);
check('7 h 30 → aube ou jour, pas nuit noire', L.lightAt(7.5).phase !== 'nuit');
check('lumière continue (pas de saut entre 17,99 h et 18 h)',
  Math.abs(L.lightAt(17.99).sunIntensity - L.lightAt(18).sunIntensity) < 0.05);
check('heure hors bornes ramenée (27 h = 3 h)', L.lightAt(27).night === true && L.lightAt(-1).night === true);

// Heure de Paris : 2026-11-04 12:00 UTC = 13 h à Paris (heure d'hiver)
const noonUtc = Date.UTC(2026, 10, 4, 12, 0, 0);
check('heure de Paris en hiver (UTC+1)', Math.abs(L.parisHour(noonUtc) - 13) < 1e-6);
const summer = Date.UTC(2026, 6, 4, 12, 30, 0);
check('heure de Paris en été (UTC+2)', Math.abs(L.parisHour(summer) - 14.5) < 1e-6);

// ── 🏠 Parcelles ────────────────────────────────────────────
const positions = [];
for (let n = 0; n < 200; n += 1) positions.push(L.plotPosition(n));
const keys = new Set(positions.map((p) => `${p.x.toFixed(2)}|${p.z.toFixed(2)}`));
check('200 positions toutes distinctes', keys.size === 200);
const fp = L.footprints();
const onBuilding = positions.filter((p) => fp.some((f) => L.lotOverlaps(p, f)));
check('aucune parcelle sur un bâtiment, la rade ou Keroman', onBuilding.length === 0);
check('aucune parcelle dans l\'eau', positions.every((p) => p.z + L.LOT / 2 < L.QUAY_Z));
check('aucune parcelle sur une route', positions.every((p) => !L.onRoad(p.x, p.z, L.LOT / 2)));
check('parcelle stable (même n → même position)',
  JSON.stringify(L.plotPosition(17)) === JSON.stringify(L.plotPosition(17)));
check('les premières parcelles sont près du centre',
  Math.hypot(positions[0].x, positions[0].z) < Math.hypot(positions[150].x, positions[150].z));
check('parcelle invalide → null', L.plotPosition(-1) === null && L.plotPosition('x') === null);
check('chaque maison regarde vers la rue (devant sur le trottoir)',
  positions.every((p) => L.onSidewalk(p.front.x, p.front.z)));
check('étendue : 25 maisons tiennent dans l\'anneau 3', L.ringFor(24) <= 3);

// ── 🚶 File des promeneurs ──────────────────────────────────
const q = new L.WalkerQueue({ max: 15, rng: L.mulberry32(1) });
const evicted = [];
for (let i = 0; i < 16; i += 1) {
  const r = q.add({ userId: `U${i}`, name: `J${i}`, amount: 1, fromHouse: true }, 1000 + i);
  evicted.push(...r.evicted);
}
check('16 arrivées → 15 promeneurs', q.list().length === 15);
check('le premier arrivé est sorti', evicted.length === 1 && evicted[0].userId === 'U0');
check('U0 n\'est plus dans la file', !q.list().some((w) => w.userId === 'U0'));

const q2 = new L.WalkerQueue({ max: 15, rng: L.mulberry32(2) });
const a = q2.add({ userId: 'UA', name: 'Ana', amount: 1, fromHouse: true }, 1000);
const b = q2.add({ userId: 'UA', name: 'Ana', amount: 2, fromHouse: true }, 5000);
check('même joueur deux fois → un seul promeneur', q2.list().length === 1);
check('montant cumulé (+3 JP$)', q2.list()[0].amount === 3);
check('2e gain = mise à jour, pas un nouveau promeneur', a.action === 'add' && b.action === 'update' && b.walker === a.walker);
check('durée de promenade entre 30 et 60 s', a.walker.until - a.walker.since >= 30000 && a.walker.until - a.walker.since <= 60000);
check('la promenade ne raccourcit pas après un nouveau gain', b.walker.until >= a.walker.until);
const gone = q2.expire(a.walker.until + 1);
check('fin de promenade → le promeneur rentre', gone.length === 1 && q2.list().length === 0);
check('évènement sans userId ignoré', q2.add({ amount: 1 }, 1).action === 'ignore');

// ── 🗺️ Chemins des promeneurs (trottoirs) ───────────────────
const bounds = L.boundsForRing(3);
const start = L.plotPosition(3).front;
const walk = L.planWalk(start, 45000, L.mulberry32(7), bounds);
check('le chemin commence devant la maison', walk.length > 2 && Math.hypot(walk[0].x - start.x, walk[0].z - start.z) < 1e-6);
check('le chemin revient à la maison', Math.hypot(walk[walk.length - 1].x - start.x, walk[walk.length - 1].z - start.z) < 1e-6);
check('chaque étape (hors départ) est sur un trottoir', walk.every((p) => L.onSidewalk(p.x, p.z)));
check('tous les segments sont droits (axe x ou z)', walk.every((p, i) => i === 0
  || Math.abs(p.x - walk[i - 1].x) < 1e-6 || Math.abs(p.z - walk[i - 1].z) < 1e-6));
check('le chemin reste dans la ville', walk.every((p) => p.x >= bounds.minX - 1e-6 && p.x <= bounds.maxX + 1e-6
  && p.z >= bounds.minZ - 1e-6 && p.z <= bounds.maxZ + 1e-6));
const len = walk.reduce((s, p, i) => (i ? s + Math.hypot(p.x - walk[i - 1].x, p.z - walk[i - 1].z) : 0), 0);
check('longueur cohérente avec la durée (vitesse ≈ 2 u/s)', len > 45 && len < 200);

// ── 🔗 Liens avec le jeton de retour ────────────────────────
check('withVille ajoute v= à une URL avec ?', L.withVille('tickets?t=abc', 'U1.ff') === 'tickets?t=abc&v=1');
check('withVille ajoute v= à une URL sans ?', L.withVille('deck', 'U1.ff') === 'deck?v=1');
check("withVille ne met jamais le jeton dans l'adresse", !L.withVille('deck', 'SECRET.tok').includes('SECRET'));
check('withVille garde l\'ancre', L.withVille('x?t=1#top', 'k') === 'x?t=1&v=1#top');
check('withVille ne touche pas slack://', L.withVille('slack://open', 'k') === 'slack://open');
check('withVille sans lien → null', L.withVille(null, 'k') === null);

// ── 🧭 Repli sans WebGL : un lien par destination ───────────
const state = {
  arena: { live: true, myMatchUrl: null, tvUrl: 'tv/arena?k=1' },
  links: { museum: 'collection/U1?t=c', kiosk: 'tickets?t=k', deck: 'deck?t=d', boutique: 'boutique?t=v', banque: 'banque?t=v', salle: 'salle?t=s' },
  auctions: { open: 3 },
};
const links = L.fallbackLinks(state, 'TOK');
const hrefs = links.map((l) => l.href);
check('repli : Boutique, Banque, Kiosque, Musée, Salle des ventes, Deck, JP TV, Slack',
  ['boutique?t=v&v=1', 'banque?t=v&v=1', 'tickets?t=k&v=1', 'collection/U1?t=c&v=1', 'salle?t=s&v=1', 'deck?t=d&v=1', 'tv/arena?k=1&v=1', 'slack://open']
    .every((h) => hrefs.includes(h)));
check('repli : la Salle des ventes affiche le nombre d\'enchères', links.some((l) => l.href === 'salle?t=s&v=1' && /Salle des ventes/.test(l.label) && /3 enchères en cours/.test(l.label)));
check('repli : sans lien salle (ancien serveur) → pas d\'entrée Salle des ventes', !L.fallbackLinks({ links: {} }, 'TOK').some((l) => /Salle/.test(l.label)));

// ── 🔨 Panneau de la Salle des ventes ───────────────────────
check('panneau : 0 → « Aucune enchère »', L.auctionText(0) === 'Aucune enchère');
check('panneau : 1 → « 1 enchère en cours »', L.auctionText(1) === '1 enchère en cours');
check('panneau : 3 → « 3 enchères en cours »', L.auctionText(3) === '3 enchères en cours');
check('panneau : valeur absente ou invalide → « Aucune enchère »', L.auctionText(undefined) === 'Aucune enchère' && L.auctionText('x') === 'Aucune enchère' && L.auctionText(-2) === 'Aucune enchère');
const mine = L.fallbackLinks({ ...state, arena: { live: false, myMatchUrl: 'arena/m1?t=z', tvUrl: null } }, 'TOK');
check('repli : mon combat en premier s\'il y en a un', mine[0].href === 'arena/m1?t=z&v=1');
check('repli : pas de JP TV si rien à l\'antenne', !mine.some((l) => /^tv\//.test(l.href)));

// ── 🎨 Couleur stable par joueur ────────────────────────────
check('couleur stable par joueur', L.hashColor('U1') === L.hashColor('U1') && L.hashColor('U1') !== L.hashColor('U2'));

console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
