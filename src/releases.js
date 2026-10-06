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
    version: '2.3',
    date: '2026-10-06',
    title: 'L\'Arène en direct sur JP TV',
    changes: [
      '📺 Tes combats de l\'Arène passent en direct sur JP TV, la TV du hall : une alerte « Priorité au direct », puis tout le combat, et le résultat à la fin. Ni ta main ni ton élixir ne sont montrés.',
      '🏆 JP TV affiche aussi le classement de l\'Arène en direct et le résultat des derniers combats.',
      '🙈 Tu préfères rester discret ? Coche « Ne pas me diffuser sur JP TV » dans « Mon deck » : tes combats ne passeront pas en direct (ils comptent toujours au classement).',
      '🌙 Pas de direct pendant le mode soir de la TV (17h45–19h).',
      '🔢 « Mon deck » et préparation d\'un combat : une carte de ton deck affiche ses exemplaires encore disponibles (ex. 1/3 = il t\'en reste 1 sur les 3 que tu possèdes).',
      '🛡 Capitaine Tank : le Rempart se voit enfin. La tour protégée s\'entoure d\'un halo à ta couleur avec un 🛡 pendant 10 s, et un message confirme chaque pouvoir de Capitaine lancé.',
      '🂠 Arène : à côté du nom de ton adversaire, ses cartes restantes s\'affichent face cachée, avec leur nombre. Tu sais ce qu\'il lui reste à poser, sans savoir quoi.',
      '🗼 Nouvelle carte : la Vigie remplace la Pompe (tes Pompes deviennent des Vigies). Elle coûte 4 élixir et grimpe sur ta tour libre la plus proche pendant 40 s. La tour gagne +150 PV de garde (absorbés en premier), tire 30 % plus fort, portée +2. Une Vigie par tour : si la tour tombe, tu perds la Vigie. Après 40 s elle redescend et tu la gardes. Rare : ↑ durée et garde.',
      '🎖️ Nouveau Capitaine Garnison (remplace Économie) : tes Vigies restent deux fois plus longtemps. Pouvoir Alarme : tes tours vivantes tirent deux fois plus fort pendant 6 s.',
    ],
  },
  {
    version: '2.2.1',
    date: '2026-10-05',
    title: 'Signale un bug, gagne des JP$',
    changes: [
      '🐛 Nouveau bouton *Signaler un bug* dans l\'Accueil : décris le problème, ajoute une capture d\'écran si tu veux. Si un admin le confirme, tu gagnes 10 JP$, et tu es prévenu quand il est corrigé.',
      '⚔️ Accueil : on voit tout de suite si ton Attaque Jeanpip est débloquée (🎉 bouton « Lancer mon attaque gratuite ») ou s\'il faut l\'acheter (💰 bouton « Acheter une attaque », avec son prix).',
    ],
  },
  {
    version: '2.2',
    date: '2026-10-05',
    title: 'Le classement et la série de combats',
    changes: [
      '🏆 Arène : le classement des joueurs est visible en direct dans l\'Accueil, dans « Mon deck » et pendant la préparation d\'un combat (bouton 🏆 Classement). On y est classé par victoires, puis par % de victoire.',
      '📅 Arène : nouvelle série de combats. Ton premier combat de la journée allé au bout (victoire, défaite ou nul) te rapporte : jour 1 = 1 JP$, jour 2 = 2 JP$, jour 3 = 4 JP$, jour 4 = 10 JP$, jour 5 = 20 JP$, jour 6 = 1 booster Rare. Ensuite la série repart au jour 1.',
      '📅 Seuls les jours ouvrés comptent : le week-end ne casse pas ta série, mais un jour de semaine sans combat la fait repartir au jour 1.',
    ],
  },
  {
    version: '2.1.2',
    date: '2026-10-02',
    title: 'Le Hors série compte dans le classeur',
    changes: [
      '🃏 Les admins peuvent maintenant rendre à la main une carte gagnée mais absente de ton classeur.',
      '🎀 Booster Octobre Rose : 1 seul par personne et par jour, pour que personne ne prenne les 2 du jour à lui seul.',
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
