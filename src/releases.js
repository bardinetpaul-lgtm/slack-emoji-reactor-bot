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
    version: '3.8.0',
    date: '2026-10-29',
    title: 'Les boosters ont leur propre ambiance',
    changes: [
      '🎬 L’ouverture animée d’un booster 🎃 *Halloween* se passe maintenant à Lorient de nuit : la lune, des chauves-souris qui traversent l’écran et des fantômes qui montent entre les faisceaux. Au moment du walkout, une nuée de chauves-souris monte du bas de l’écran.',
      '🎀 Le booster *Octobre Rose* noie l’écran sous le rose, avec une pluie de cœurs et de rubans.',
      '✨ L’ambiance vient du booster que tu ouvres, pas de la carte que tu tires : un pack Halloween est sombre du premier au dernier écran. Une légendaire garde sa fanfare dorée, mais dans le décor du pack.',
      '🕶 Correctif : quand tu lances l’ouverture animée, Slack n’affiche plus tes cartes pendant que la page les révèle. Le DM dit simplement « ouverture en cours », et le récap arrive une fois l’animation terminée. Plus de spoil si tu gardes Slack ouvert à côté.',
      '♿ Si ton système est réglé sur « animations réduites », le décor ne s’affiche pas : l’ouverture reste sobre, comme avant.',
    ],
  },
  {
    version: '3.7.0',
    date: '2026-10-29',
    title: 'Halloween, raids moins chers',
    changes: [
      '⚔️ Le Raid coûte maintenant *30 JP$* au lieu de 50, et le Raid gratuit se débloque dès *40 Jeanpips* dans la semaine (au lieu de 65). Les cibles en plus restent à 10 JP$.',
      '🎃 Nouveau : le *Booster Halloween* (80 JP$), en vente du vendredi 30/10 à 14h au lundi 2/11 à 14h. Mêmes chances qu’Octobre Rose, mais *sans limite par personne* : prends-en autant que tu veux. Comme tous les boosters, il est fermé samedi et dimanche : en clair, vendredi après-midi, puis lundi matin.',
      '🌑 Attention : 4 des 7 cartes Halloween sortent dès le vendredi, les *3 autres seulement le lundi matin*. Impossible de compléter la série dès le vendredi — il faudra revenir.',
      '🃏 Les cartes Halloween sont rangées dans le « Hors série » de ton classeur (HW1 → HW7), jouables dans l’Arène et dans ton deck (puissance d’une épique), et revendables 10 JP$ l’exemplaire en double.',
      '🎀 Dernier jour d’Octobre Rose le vendredi 30/10 : exceptionnellement *10 boosters pour tout le monde*, *2 par personne*. Le prix ne change pas (80 JP$).',
    ],
  },
  {
    version: '3.6.1',
    date: '2026-10-21',
    title: 'Raid gratuit débloqué pour tous',
    changes: [
      '⚔️ Correctif : si tu avais déjà plus de 65 Jeanpips cette semaine avant la baisse du seuil, ton Raid gratuit n\'apparaissait pas. Il est maintenant débloqué tout de suite, sans attendre un Jeanpip de plus.',
    ],
  },
  {
    version: '3.6.0',
    date: '2026-10-21',
    title: 'Revente, congés et fini le spam',
    changes: [
      '🎯 Fini la course aux réactions : 20 Jeanpips comptent par jour, et chacun rapporte maintenant 1 JP$ (au lieu de 0,5). Au total, on gagne autant qu\'avant, mais sans spammer. Au-delà de 20, une réaction ne donne plus rien jusqu\'au lendemain. Ton compteur du jour est dans l\'Accueil.',
      '🏉 Tickets à gratter : le SCORE est maintenant un vrai 2e jeu. Si « Votre score » bat le « Score adverse », ta mise est remboursée, même si les ballons perdent (1 ticket sur 4). Les lots des ballons sont un peu plus rares pour compenser : au total, les tickets rapportent autant qu\'avant.',
      '⚔️ Le Raid gratuit se débloque maintenant à 65 Jeanpips dans la semaine (au lieu de 100). Et une personne en pénalité anti-farm peut maintenant être raidée.',
      '♻️ Nouveau : revends tes doublons contre des JP$ depuis l\'onglet Accueil. ⚪ Commune 0,5 · 🔵 Rare 2 · 🟣 Épique 5 · 🎀 Octobre Rose 10 · 🟡 Légendaire 20 JP$ l\'exemplaire. Tu gardes toujours un exemplaire de chaque carte, et ceux de tes decks d\'Arène. Les cartes troll de l\'anti-spam ne se revendent pas.',
      '♻️ Jusqu\'à 30 JP$ de revente par personne et par semaine (remis à zéro le lundi), pour que les JP$ gardent leur valeur. Pas de revente pendant un raid que tu subis.',
      '🌴 Nouveau : « Mes congés » dans l\'onglet Accueil. Tu choisis tes dates (60 jours au maximum) et, pendant tes congés, Jeanpip te laisse tranquille : on ne peut ni te raider ni te défier, tu ne reçois aucun Jeanpip ni notification, et réagir à tes messages ne rapporte rien. Toi non plus tu ne joues pas : pas de raid, d\'Arène, de booster ni de ticket. Tu peux revenir plus tôt avec « Je suis rentré(e) ».',
      '🌴 Pendant tes congés, ta série de combats, ton Raid gratuit et tes JP$ du vendredi continuent comme d\'habitude. Un raid ou un combat déjà commencé se termine normalement.',
      '🏢 Quand l\'entreprise ferme (Noël, pont…), un admin met Jeanpip en pause pour tout le monde, comme un week-end. Tu reçois un message le premier jour à 9h, puis à la reprise. Ces jours-là ne cassent pas ta série de combats.',
      '🔕 Quand tu réagis avec :jeanpip:, tu reçois ton image comme avant, mais l\'auteur du message ne reçoit plus rien. Plus de DM d\'images à chaque fois que quelqu\'un réagit à tes messages.',
      '💰 Le reste ne change pas : ta réaction te rapporte toujours tes JP$ et compte pour le Raid gratuit et le classement, toujours sur les messages des personnes inscrites à la liste de diffusion.',
    ],
  },
  {
    version: '3.5.0',
    date: '2026-10-20',
    title: 'Rééquilibrage de l\'Arène',
    changes: [
      '⚖️ Arène : on a analysé vos 102 combats depuis le 30 septembre. Résultat : l\'🐝 Essaim écrasait tout, le 💥 Sort était devenu obligatoire pour s\'en sortir et le 🛡 Tank servait trop peu. Voici les retouches.',
      '🛡 Le Tank piétine : il fonce toujours sur les bâtiments, mais il abîme maintenant les troupes collées à lui en passant. Les ⚔️ Guerriers (qu\'il contre) le sentent passer, et l\'Essaim ne le fait plus fondre sans y laisser des plumes.',
      '🐝 L\'Essaim perd un peu de PV (105 → 95 par abeille) : les decks à 5 Essaims ne passent plus aussi facilement.',
      '🗼 La Vigie protège mieux sa tour : garde 200 → 250.',
      '🔵 Les cartes rares et plus sont mieux récompensées : Rare +9 % de PV (au lieu de +6 %), Épique +15 % (au lieu de +11 %), Légendaire +20 % (au lieu de +16 %). La stratégie garde le dernier mot : un bon joueur avec des communes bat encore le plus souvent un deck riche mal joué.',
    ],
  },
  {
    version: '3.4.0',
    date: '2026-10-19',
    title: 'L\'Attaque devient le Raid',
    changes: [
      '⚔️ Nouveau : le Raid Jeanpip remplace l\'Attaque. Tu choisis tes cibles (5 incluses, +10 JP$ par cible en plus, 10 au maximum) et un style d\'attaque secret : 💥 Assaut, 🦊 Ruse ou 🌫️ Embuscade.',
      '🛡️ Chaque cible reçoit une alerte et a 20 minutes pour deviner ton style avec 🛡️ Bouclier, 🪤 Piège ou 🏃 Esquive. Elle se trompe ou ne répond pas : elle te donne une carte. Sa défense tient : rien ne se passe. Elle devine : riposte, c\'est toi qui lui donnes une carte.',
      '🃏 Une carte prise, c\'est d\'abord un doublon, et jamais une légendaire ni une carte hors série. Le raid n\'envoie plus de carte à personne.',
      '🤫 Les résultats tombent à la fin du raid, pour tout le monde en même temps : inutile de crier ta défense dans l\'open space.',
      '💰 Un raid coûte 50 JP$, ou rien si tu as envoyé 100 Jeanpips dans la semaine. Les raids se lancent en semaine, de 9h à 17h40 : tout est fini à 18h. Une personne ne subit qu\'un raid à la fois, et 2 par jour au maximum.',
      '🃏 Arène : toutes tes cartes « Hors série » sont maintenant jouables dans ton deck, y compris les photos anti-spam 🚨 et les cartes retirées de la banque.',
      '🐝 Arène : les abeilles des Renforts de la Capitaine Essaim étaient invisibles, elles apparaissent enfin. Et les abeilles d\'un même Essaim ne s\'empilent plus au même endroit : chacune a sa place.',
      '⚖️ Arène : la Capitaine Essaim était la plus forte. Son passif donne maintenant 1 abeille de plus par Essaim (au lieu de 2), et ses Renforts appellent 3 abeilles (au lieu de 4).',
    ],
  },
  {
    version: '3.3.0',
    date: '2026-10-19',
    title: 'Le week-end, on souffle',
    changes: [
      '🏖️ Du samedi 0h au lundi 0h, Jeanpip est en pause : on laisse les collègues tranquilles. Une réaction :jeanpip: ne fait rien (pas d\'image, pas de JP$, pas de point) et seul toi vois un petit rappel.',
      '🏖️ Le week-end, pas d\'Attaque, pas d\'achat ni d\'ouverture de booster, pas de ticket à gratter et pas de nouveau combat d\'Arène. Ton classeur et ton deck restent ouverts, et tes boosters non ouverts t\'attendent lundi.',
      '🔕 Le bot n\'envoie plus aucune notification le week-end : il répond seulement quand tu cliques sur quelque chose.',
      '⚔️ Une Attaque débloquée se lance donc avant vendredi minuit (les scores repartent toujours à 0 le dimanche à 20h).',
    ],
  },
  {
    version: '3.2.0',
    date: '2026-10-15',
    title: 'Octobre Rose sans triche',
    changes: [
      '🎀 Booster Octobre Rose : le bouton d\'achat n\'apparaît dans l\'Accueil qu\'à l\'arrivée des boosters du jour (entre 9h et 10h). Il apparaît pour tout le monde en même temps, puis disparaît quand il n\'y en a plus ou quand tu as eu le tien. Plus besoin de cliquer en boucle !',
      '🎀 Le Booster Octobre Rose s\'achète uniquement depuis l\'onglet Accueil, plus depuis la boutique `/jeanpip-booster`.',
      '🤖 Les auto-clickers et scripts sont détectés : des clics à intervalles parfaitement réguliers bloquent le bouton, et les admins sont prévenus. Tricher peut coûter une interdiction d\'acheter le booster.',
    ],
  },
  {
    version: '3.1.1',
    date: '2026-10-13',
    title: 'Le suspense du grattage',
    changes: [
      '🎟️ Tickets ESSAI ! : ton solde ne bouge plus avant que tu aies gratté. Le gain (JP$ ou carte légendaire) arrive quand tout le ticket est découvert. Si tu fermes la page avant la fin, ton ticket t\'attend.',
    ],
  },
  {
    version: '3.1.0',
    date: '2026-10-13',
    title: 'Tickets à gratter ESSAI !',
    changes: [
      '🏉 Nouveau : les tickets à gratter ESSAI ! Bouton « 🎟️ Jouer » dans l\'Accueil. 5 JP$ le ticket, 9 ballons à gratter au doigt ou à la souris : 3 symboles identiques = le gain. Le Sifflet rembourse ta mise, les Poteaux rapportent 200 JP$ et la Coupe 🏆 te donne une carte légendaire !',
      '🎟️ 10 tickets par jour et par personne. Ton gain est sur ton compte dès l\'achat : si tu fermes la page, tu retrouves ton ticket à gratter en revenant.',
    ],
  },
  {
    version: '3.0.4',
    date: '2026-10-08',
    title: 'JP TV en plein écran',
    changes: [
      '📺 JP TV : le combat en direct s\'affiche maintenant en entier sur la TV du hall (la moitié de l\'écran était coupée).',
      '🂠 JP TV : sous le nom de chaque joueur, ses cartes restantes s\'affichent face cachée, avec leur nombre. Le public voit ce qu\'il reste à poser, jamais quelles cartes.',
      '🎀 Booster Octobre Rose : plus de booster le samedi ni le dimanche. À partir du lundi 12 octobre, il y en a 3 par jour (du lundi au vendredi) au prix de 80 JP$.',
    ],
  },
  {
    version: '3.0.3',
    date: '2026-10-08',
    title: 'Classeur, booster et données',
    changes: [
      '📮 Si tu fais un Jeanpip à quelqu\'un qui n\'est pas dans la liste de diffusion (ou qui est en pénalité anti-farm), tu ne reçois plus rien et un petit message, visible de toi seul, te prévient. Résultat : toute image que tu reçois va bien dans ton classeur.',
      '🎀 Booster Octobre Rose : un seul clic suffit ! Si tu cliques en rafale sur « Acheter » (plus de 4 clics en moins de 5 s), tu reçois un avertissement et ton bouton est bloqué 2 min, puis 5, 10, 20, 30 et 60 min si tu recommences. Le compteur repart à zéro chaque jour.',
      '💾 Tes cartes, tes JP$ et tes decks sont mieux protégés : une coupure du serveur ne peut plus les effacer.',
    ],
  },
  {
    version: '3.0.2',
    date: '2026-10-08',
    title: 'L\'anti-farm se durcit',
    changes: [
      '🚜 Anti-farm : pendant l\'heure de pénalité, tu ne reçois plus aucune image, ni la tienne quand tu réagis, ni celles des autres (Jeanpips, Attaques). Tes Jeanpips n\'envoient toujours rien et ne rapportent pas de JP$. Tu peux toujours ouvrir tes boosters.',
      '🚜 Réagir au message d\'une personne sous pénalité ne rapporte rien : elle ne reçoit pas ton Jeanpip (tu reçois quand même ton image).',
    ],
  },
  {
    version: '3.0.1',
    date: '2026-10-07',
    title: 'Le compteur sur ton deck',
    changes: [
      '🔢 Mon deck et préparation d\'un combat : les cartes de ton deck (à gauche) affichent aussi combien d\'exemplaires il te reste (ex. 1/3), comme dans ta collection.',
    ],
  },
  {
    version: '3.0',
    date: '2026-10-07',
    title: 'L\'Arène en direct sur JP TV et la Vigie',
    changes: [
      '📺 Tes combats de l\'Arène passent en direct sur JP TV, la TV du hall : une alerte « Priorité au direct », puis tout le combat, et le résultat à la fin. Ni ta main ni ton élixir ne sont montrés.',
      '🏆 JP TV affiche aussi le classement de l\'Arène en direct et le résultat des derniers combats.',
      '🙈 Tu préfères rester discret ? Coche « Ne pas me diffuser sur JP TV » dans « Mon deck » : tes combats ne passeront pas en direct (ils comptent toujours au classement).',
      '🌙 Pas de direct pendant le mode soir de la TV (17h45–19h).',
      '🔢 « Mon deck » et préparation d\'un combat : une carte de ton deck affiche ses exemplaires encore disponibles (ex. 1/3 = il t\'en reste 1 sur les 3 que tu possèdes).',
      '🛡 Capitaine Tank : le Rempart se voit enfin. La tour protégée s\'entoure d\'un halo à ta couleur avec un 🛡 pendant 10 s, et un message confirme chaque pouvoir de Capitaine lancé.',
      '🂠 Arène : à côté du nom de ton adversaire, ses cartes restantes s\'affichent face cachée, avec leur nombre. Tu sais ce qu\'il lui reste à poser, sans savoir quoi.',
      '🗼 Nouvelle carte : la Vigie remplace la Pompe (tes Pompes deviennent des Vigies). Elle coûte 4 élixir et grimpe sur ta tour libre la plus proche pendant 40 s. La tour gagne +200 PV de garde (absorbés en premier), tire 40 % plus fort, portée +2. Une Vigie par tour : si la tour tombe, tu perds la Vigie. Après 40 s elle redescend et tu la récupères, sauf si tu perds le combat (comme toute carte posée). Rare : ↑ durée et garde.',
      '🎖️ Nouveau Capitaine Garnison (remplace Économie) : tes Vigies restent deux fois plus longtemps. Pouvoir Alarme : tes tours vivantes tirent trois fois plus fort pendant 15 s.',
      '❄️ Capitaine Magie : le Gel fige maintenant les ennemis 5 s (au lieu de 3 s).',
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
