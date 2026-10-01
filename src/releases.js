// ═══════════════════════════════════════════════════════════
//  📰 MODULE RELEASES
//  Versions du jeu et release note affichée aux joueurs (bouton
//  « Nouveautés » de l'Accueil). Seule source de vérité de la version.
//
//  À CHAQUE LIVRAISON :
//   1. ajouter une entrée EN TÊTE de RELEASES (la 1re = version courante) ;
//   2. aligner package.json : npm version 2.2.0 --no-git-tag-version ;
//   3. node scripts/test-releases.js (échoue si les deux divergent) ;
//   4. une fois mergé : git tag v2.2 && git push origin v2.2
//
//  Numérotation : +0.1 par package livré (2.1 → 2.2), 2.1.1 pour un
//  correctif urgent entre deux packages.
//  Les textes sont lus par les joueurs : français, sans jargon technique.
// ═══════════════════════════════════════════════════════════

const RELEASES = [
  {
    version: '2.1',
    date: '2026-10-01',
    title: 'Les nouveautés dans l\'Accueil',
    changes: [
      '📰 Nouveau bouton *Nouveautés* dans l\'Accueil : tout ce qui change dans le jeu, version par version.',
      '🏷️ Le numéro de version du jeu est maintenant affiché en bas de l\'Accueil.',
    ],
  },
  {
    version: '2.0',
    date: '2026-09-30',
    title: 'Le jeu Jeanpip',
    changes: [
      '💰 Des crédits à chaque Jeanpip envoyé, et l\'Attaque Jeanpip à débloquer chaque semaine.',
      '🎁 Les boosters de 8 cartes, avec leur ouverture animée.',
      '📒 Le classeur : toute ta collection rangée comme un album Panini.',
      '🎁 Chaque vendredi 9h, 20 crédits JeanPip à offrir aux autres.',
      '⚔️ L\'Arène : monte ton deck et affronte les autres joueurs.',
      '🎀 Le booster Octobre Rose et ses 6 cartes exclusives.',
    ],
  },
];

/** Compare deux versions (« 2.10 » > « 2.9 », « 2.1 » = « 2.1.0 ») : >0, 0 ou <0. */
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function current() {
  return RELEASES[0];
}

function currentVersion() {
  return current().version;
}

/** « 2026-10-01 » → « 01/10/2026 » */
function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

module.exports = { RELEASES, compareVersions, current, currentVersion, formatDate };
