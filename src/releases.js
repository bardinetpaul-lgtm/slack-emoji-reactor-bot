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
    version: '2.1.2',
    date: '2026-10-01',
    title: 'Le Hors série compte dans le classeur',
    changes: [
      '📒 Classeur : les cartes Hors série (Octobre Rose, photos anti-spam, cartes retirées du jeu) comptent maintenant dans ton total et ton pourcentage de complétion.',
    ],
  },
  {
    version: '2.1.1',
    date: '2026-10-01',
    title: 'Le Capitaine Guerrier rééquilibré',
    changes: [
      '⚖️ Arène : le Capitaine Guerrier (style Rush) dominait trop. Son bonus passe de +35 % de vitesse et +30 % de dégâts à +20 % de vitesse et +15 % de dégâts. Son pouvoir Charge ne change pas.',
    ],
  },
  {
    version: '2.1',
    date: '2026-10-01',
    title: 'L\'Arène sur grand écran',
    changes: [
      '🖥️ Arène : l\'écran de combat est repensé pour l\'ordinateur. Terrain, chrono, élixir et cartes tiennent dans la fenêtre, sans défiler.',
      '⌨️ Arène : chaque carte affiche sa touche du clavier (1 à 8) pour la choisir, Échap pour annuler.',
      '🎁 Arène : plus de plafond de récompense. Chaque victoire rapporte son booster Commun et ses 10 JP$, quel que soit le nombre de combats du jour.',
      '🏹 Arène : les Tireurs gardent leurs distances. Quand un ennemi de corps à corps approche, ils continuent de tirer en reculant ; une fois rattrapés, ils font face.',
      '🐛 Arène : cliquer une carte puis cliquer le terrain pour la poser fonctionne à tous les coups (le clic sur la carte était parfois perdu).',
      '⏳ Arène : pendant la préparation, le décompte reste visible quand tu parcours ta collection.',
      '💰 Les crédits changent de nom : ce sont maintenant des *JP$*. Ton solde ne change pas.',
      '📰 Nouveau bouton *Nouveautés* dans l\'Accueil : tout ce qui change dans le jeu, version par version.',
      '🏷️ Le numéro de version du jeu est maintenant affiché en bas de l\'Accueil.',
    ],
  },
  {
    version: '2.0',
    date: '2026-09-30',
    title: 'Le jeu Jeanpip',
    changes: [
      '💰 Des JP$ à chaque Jeanpip envoyé, et l\'Attaque Jeanpip à débloquer chaque semaine.',
      '🎁 Les boosters de 8 cartes, avec leur ouverture animée.',
      '📒 Le classeur : toute ta collection rangée comme un album Panini.',
      '🎁 Chaque vendredi 9h, 20 JP$ à offrir aux autres.',
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
