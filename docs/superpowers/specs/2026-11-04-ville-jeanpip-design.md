# Ville Jeanpip — document de conception

Date : 2026-11-04 · Base de code : `origin/main` (v3.8) · Statut : **à valider par Paul**

## 1. Intention

Le jeu Jeanpip a grandi : Arène, boosters, tickets à gratter, classeur, revente, raids.
Tout passe aujourd'hui par l'onglet Accueil Slack. Cet onglet n'accepte que des briques
Block Kit (100 au maximum, aucune mise en page libre, aucune page web intégrée). Il est
devenu une longue liste de boutons.

La ville Jeanpip donne au jeu un lieu. C'est une page web en **vraie 3D**, vue de haut et
inclinée, qui ressemble à Lorient. Chaque bâtiment y est une fonction du jeu. C'est
**d'abord un plan qui mène partout** : un clic sur un bâtiment ouvre la page de cette
fonction. C'est aussi un lieu vivant, où l'on voit qu'un combat est en cours et où l'on voit
passer les collègues qui viennent de gagner des JP$.

Succès : les joueurs passent par la ville plutôt que par la liste de boutons, et s'y
reconnaissent (leur maison, leurs collègues, Lorient, Dimsi).

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs de la V1**
- Une ville 3D détaillée et reconnaissable (Lorient, Dimsi), avec un cycle jour/nuit.
- La navigation : chaque bâtiment ouvre sa page.
- La vie : combat visible à l'Arène, joueurs qui se promènent quand ils gagnent des JP$,
  une maison par joueur inscrit.
- Deux nouvelles pages web : la Boutique (achat de boosters) et la Banque (revente).

**Non-objectifs de la V1** (prévus en V2, voir §8)
- Raids visibles, feux d'artifice, camion des boosters, décors de saison, ville endormie le
  week-end.
- La Salle des ventes en état de marche (elle dépend du chantier « échange de cartes »).
- Entrer dans les bâtiments en 3D : un clic ouvre la page existante, on ne fait pas de scène
  intérieure.

**Anti-objectifs** (ce qui serait un échec même si « ça marche »)
- **Un rendu plat ou « dessin 2D ».** Paul a rejeté les trois maquettes 2D (plan illustré,
  pixel art, carte de port) : il faut de la vraie 3D, détaillée.
- **Retirer quoi que ce soit de l'Accueil Slack.** L'Accueil reste tel quel, la ville s'y
  ajoute.
- **Deux façons d'acheter ou de revendre qui ne suivent pas les mêmes règles.** La Boutique
  et la Banque web appliquent exactement les règles de Slack : stock du jour, anti-spam,
  sanctions, pause du week-end, congés, plafond de revente, raid subi.
- Une page trop lourde pour un portable de bureau, ou qui fige l'ordinateur.

## 3. Contraintes connues

- **Hébergement.** La page est servie par le serveur web du bot (`src/web.js`, module HTTP
  natif, 127.0.0.1:3100). Elle est derrière le reverse proxy du dashboard
  (`https://dashboard-lorient.dimsi.cloud/jeanpip/`, liste blanche d'adresses IP) et
  derrière Cloudflare. **Elle n'est donc accessible que depuis les bureaux**, comme le
  classeur et l'Arène. Toutes les routes doivent rester relatives, parce qu'un préfixe est
  ajouté devant.
- **Authentification.** Le lien est personnel et signé, comme les autres pages : jeton
  `<userId>.<hmac>`, avec `hmac(« ville|<userId> »)` signé par le secret du bot
  (`getSecret()` dans `src/web.js`). Il n'y a ni connexion ni mot de passe. Le « | »
  empêche toute confusion avec les autres messages signés. Pour les liens vers les pages
  existantes, la ville réutilise les fonctions qui les construisent déjà :
  `buildCollectionUrl`, `buildDeckUrl`, `buildTicketsUrl`, `buildArenaUrl`.
- **Règles du jeu.** L'achat d'un booster se trouve aujourd'hui dans `app.js`
  (`app.action(/^buy_booster_/…)`, vers la ligne 1204). La revente se trouve dans
  `src/resale.js` et dans `app.view('resale_submit')`. Les pages web doivent appeler
  **la même logique**. On la sort donc dans une fonction partagée, sans la recopier.
- **Pauses.** Pendant le week-end, une fermeture de l'entreprise ou des congés
  (`weekend.pauseFor`), la ville reste visible. La Boutique, le Kiosque et la Banque
  refusent alors l'action, avec le même message que dans Slack.
- **JP TV.** Les joueurs qui ont choisi « Ne pas me diffuser sur JP TV »
  (`arenaStore.isTvOptOut`) ne doivent pas pouvoir être regardés en spectateur. On
  réutilise le filtre `broadcast` de `matches.listForTv()` / `tvFeed`.
- **Vie privée.** Les photos et prénoms Slack sont ceux de l'espace de travail, déjà
  visibles de tous les collègues. On n'affiche aucun montant de solde d'un autre joueur
  (voir §5.4).

## 4. Ce que Paul a décidé

| Sujet | Décision de Paul |
|---|---|
| Rôle de la ville | Un plan qui mène partout, vu du dessus, avec la vie du jeu visible |
| Style | Vraie 3D, plus détaillée que la maquette jetable (formes à facettes, vue inclinée qu'on fait tourner) |
| Détails voulus | Bâtiments travaillés, vie de rue, identité Lorient/Dimsi, jour et nuit |
| Repères | La rade et le port, la base sous-marine de Keroman, les locaux Dimsi au centre (pas de phare) |
| Modèles 3D | Un pack libre de droits réputé (type Kenney, licence CC0), retouché, et des bâtiments faits sur mesure en code pour les pièces uniques |
| Clic sur un bâtiment | Ouvre la page existante |
| Boutique et Banque | On leur crée des pages web |
| Salle des ventes | Visible, annoncée « bientôt » en V1 |
| Arène, combat en cours, non-participant | Il choisit entre « Regarder le combat » et « Mon deck » |
| Locaux Dimsi | « Mairie du jeu » : nouveautés, classement, retour vers l'Accueil Slack |
| Joueurs qui gagnent des JP$ | Un petit personnage se promène dans la ville, avec sa photo Slack et son prénom |
| Maisons | Chaque joueur inscrit a sa petite maison (nom et photo). Un clic sur celle d'un collègue montre sa carte de visite. C'est de là que part son personnage. |
| Accueil Slack | Tout est gardé, et un bouton « Entrer dans la ville » s'ajoute en haut |
| Événements | Raids, grosses cartes tirées, arrivée des boosters du jour, saisons et week-end : tous voulus, **en V2** |
| Découpage | V1 = ville + navigation + vie + pages Boutique et Banque ; V2 = événements + Salle des ventes |
| Boosters à stock du jour (Octobre Rose…) | **Vendus aussi dans la Boutique web**, avec une protection anti-robot propre au web (§5.5) |
| « Regarder le combat » | Ouvre la **vue JP TV** existante (combat à l'antenne). Paul accepte que le lien TV soit connu des joueurs. |
| Qui a une maison | **Seulement les inscrits à la liste de diffusion.** Les promeneurs des non-inscrits partent de la place Dimsi. |
| Pack 3D | **Kenney (kenney.nl, CC0) autorisé** ; nom et taille exacts des kits à annoncer à Paul avant de les garder dans le dépôt |
| Nom | **« Jeanpip City »** dans tous les textes des joueurs (bouton « 🏙️ Entrer dans Jeanpip City », « ← Retour à Jeanpip City ») ; fichiers et routes restent `ville` |
| Document | Validé par Paul le 2026-11-04 (« construire la V1 »), sous réserve des réponses ci-dessus |

## 5. Comportement attendu (V1)

### 5.1 Entrée
- Un bouton « 🏙️ Entrer dans la ville » apparaît en tête de l'Accueil, juste sous le solde.
  C'est un lien direct (`url`), comme « Ouvrir mon classeur ». Il est absent si la page web
  est désactivée (`WEB_PUBLIC_URL` vide).
- La page s'ouvre sur une vue d'ensemble de la ville. Le joueur peut faire tourner la vue à
  la souris, zoomer à la molette et se déplacer. La caméra reste au-dessus du sol et ne passe
  pas sous la carte.

### 5.2 Les bâtiments et leurs destinations

| Bâtiment | Fonction | Clic |
|---|---|---|
| 🏟️ Arène | Combats | Pas de combat du joueur : petit choix « Regarder le combat » (s'il y en a un à l'antenne → page JP TV `/tv/arena?k=`) / « Mon deck ». Combat du joueur en cours : sa page de combat. |
| 🎁 Boutique de boosters | Achat | Nouvelle page Boutique (§5.5) |
| 🏦 Banque | Revente des doublons | Nouvelle page Banque (§5.6) |
| 🎟️ Kiosque | Tickets « ESSAI ! » | Page tickets existante (`/tickets`) |
| 🏛️ Musée | Classeur | Classeur existant (`/collection/<user>`) |
| 🔨 Salle des ventes | Enchères (futur) | Panneau « Bientôt » |
| 🏢 Locaux Dimsi (mairie) | Infos du jeu | Panneau : nouveautés de la version (`src/releases.js`), classement de l'Arène, lien « Retour à l'Accueil Slack » |
| 🏠 Maisons | Joueurs | Ma maison : ma carte de visite. Celle d'un collègue : la sienne. |

- Chaque bâtiment porte une étiquette lisible (nom + emoji) et réagit au survol (contour,
  curseur main).
- Le classeur, les tickets et l'Arène s'ouvrent **dans le même onglet**, et chacune de ces
  pages reçoit un lien « ← Retour à la ville ». *(Choix du concepteur, voir §7.)*
- L'Arène montre qu'un combat est en cours : projecteurs allumés, deux combattants qui
  s'affrontent sur le terrain, étiquette rouge « ⚔️ combat en cours ».

### 5.3 La vie de la ville
- **Joueurs qui gagnent des JP$.** À chaque Jeanpip délivré qui rapporte des JP$, un
  personnage sort de la maison du joueur. Il porte sa photo Slack et son prénom au-dessus de
  la tête, ainsi qu'une bulle « +1 JP$ ». Il se promène dans les rues pendant 30 à
  60 secondes, puis rentre ou disparaît. Si ce joueur gagne à nouveau des JP$ pendant sa
  promenade, la bulle se met à jour : on n'ajoute pas de deuxième personnage.
  Si le joueur n'a pas de maison (il n'est pas inscrit), son personnage part de la place
  Dimsi. *Choix du concepteur : seuls les gains de réaction Jeanpip font sortir un
  personnage (`credits.addCredit` avec `source: 'reaction'`), pas les tickets, la revente
  ni les dons du vendredi. C'est facile à élargir.*
- On affiche au maximum une quinzaine de personnages en même temps, pour que l'ordinateur
  suive. Au-delà, les plus anciens rentrent.
- **Maisons.** Une petite maison par joueur inscrit à la liste de diffusion
  (`src/broadcast.js`), dans des quartiers résidentiels. Chacune porte le prénom et la photo
  du joueur, sur une boîte aux lettres ou un panneau. La place d'une maison est stable : un
  joueur garde sa maison d'une visite à l'autre. Un nouvel inscrit reçoit la prochaine
  parcelle libre.
- **Vie de rue.** Lampadaires, bancs, voitures qui circulent, bateaux dans la rade, mouettes.
- **Jour et nuit.** La lumière suit l'heure de Paris : aube, jour, crépuscule, nuit. La nuit,
  les fenêtres et les lampadaires s'allument.

### 5.4 Carte de visite d'un joueur
Un clic sur une maison ouvre un panneau qui affiche :
- la photo et le prénom ;
- le rang au classement de l'Arène ;
- le nombre de cartes différentes et le nombre de légendaires ;
- la série en cours.

Elle n'affiche **pas** le solde de JP$ d'un collègue, qui reste privé *(choix du
concepteur)*. Sur **sa propre** maison, le joueur voit en plus son solde.

### 5.5 Page Boutique (nouvelle)
- Elle liste les mêmes boosters que l'Accueil (`boosters.listBoosters(now)`), avec le même
  texte de prix, de stock du jour et de blocage.
- Le bouton « Acheter » appelle la même logique que `buy_booster_*`. Une fois l'achat fait,
  la page enchaîne directement sur l'ouverture animée existante (`/open/<id>`). Le message
  Slack habituel (DM) est quand même envoyé, et l'Accueil est rafraîchi.
- Elle respecte l'anti-spam du booster à stock (`boosterSpam`), les sanctions
  (`boosterBans`), la limite par personne et les pauses.
- **Boosters à stock du jour : vendus aussi sur le web (décision de Paul).** La règle v3.2
  « Accueil seulement » (`app.js`, vers la ligne 1216) est élargie à « Accueil **ou**
  Boutique web ». Les vieux boutons dans les DM restent refusés. Comme un lien signé
  permanent est plus facile à automatiser qu'un clic Slack, la Boutique web ajoute ses
  propres protections *(choix du concepteur, à relire par Paul)* :
  - **jeton d'achat à usage unique** : il est remis par la page quand elle affiche le
    bouton, valable 2 minutes et lié au joueur. Un achat sans jeton valide est refusé ;
  - **délai humain** : un achat arrivé moins d'environ 1 s après la remise du jeton est
    refusé et compté comme un clic en rafale ;
  - **même escalade que Slack** : les clics en rafale sur le web s'ajoutent à ceux de Slack
    dans `boosterSpam`, avec le même blocage progressif ;
  - **pas d'avance sur Slack** : l'arrivée du stock du jour n'est pas annoncée plus tôt ni
    plus précisément qu'à l'Accueil. Les interrogations répétées de la page Boutique sont
    limitées (environ 1 par seconde et par joueur) ;
  - **traçabilité** : chaque achat porte son canal (`web` ou `slack`) dans le journal, pour
    que le dashboard /stats puisse repérer un comportement anormal.

### 5.6 Page Banque (nouvelle)
- Elle affiche les doublons revendables par rareté, le prix unitaire (`resale.PRICES`), ce
  qui a déjà été touché cette semaine et le plafond restant.
- Elle offre le même choix que la fenêtre Slack (`buildResaleModal`), puis appelle la même
  logique que `resale_submit`.
- Elle refuse avec le même message pendant une pause ou un raid subi.

### 5.7 Données en direct
- La ville reçoit l'activité par un flux d'événements continu (SSE), sur le modèle de JP TV
  (`src/game/tvWeb.js`) : ping toutes les 15 s, `X-Accel-Buffering: no`, une seule boucle
  serveur pour toutes les villes ouvertes.
- Les événements de la V1 sont : `jp` (le joueur X vient de gagner N JP$), `arena` (combat
  en cours ou fini), `house` (maison ajoutée ou retirée).
- Au chargement, un état initial donne les maisons, les combats en cours et l'heure du
  serveur.

## 6. Technique (choix du concepteur, non tranchés par Paul)

- **Bibliothèque 3D : Three.js**, servie localement depuis `public/vendor/`, comme
  `chart.umd.js`. Pas de CDN en production.
- **Modèles :** un pack CC0 au format `.glb` (par exemple les kits City et Survival de
  Kenney), rangé dans `public/assets/ville/`, avec sa licence dans le dépôt. L'Arène, les
  locaux Dimsi, la base sous-marine et le Musée sont faits sur mesure : modélisés en code ou
  retouchés à partir du pack. Le téléchargement du pack est à valider avec Paul au moment de
  l'implémentation (source, taille).
- **Performance :** un même modèle de maison répété pour tout le monde (instanciation),
  ombres limitées, et un budget d'environ 60 images par seconde sur un portable de bureau.
  Si l'ordinateur n'y arrive pas, on réduit la qualité : moins d'ombres, moins de détails.
- **Photos Slack :** elles passent par le bot (proxy et cache), comme les images de cartes,
  pour éviter les problèmes de domaine croisé dans les textures.
- Les fichiers suivent le modèle existant : `src/villeWeb.js` (routes, branché dans
  `src/web.js`), `public/ville.html`, `ville.js`, `ville.css`, et les pages `boutique.*` et
  `banque.*`.

## 7. Laissé au concepteur

- Le plan exact de la ville : placement des bâtiments, des rues, des quartiers de maisons,
  de la rade.
- Le style précis des maisons et leur variété (couleurs, toits).
- Le chemin des promeneurs, les animations, l'éclairage.
- Le retour vers la ville depuis les pages existantes : même onglet, avec un lien
  « ← Retour à la ville » ajouté sur chaque page.
- Le rendu en cas de navigateur sans WebGL : message et liens simples vers chaque page.
- Le format exact du flux et des réponses JSON.

## 8. Deuxième version (cadrée, non détaillée)

- **Raids :** une troupe part de la maison de l'attaquant vers celles des cibles, et une
  alerte apparaît sur la carte.
- **Grosses cartes tirées :** un feu d'artifice au-dessus de la Boutique quand une
  légendaire sort d'un booster, et au-dessus du Kiosque pour un gros lot.
- **Arrivée des boosters du jour :** un camion de livraison arrive à la Boutique quand le
  stock du jour tombe.
- **Saisons et week-end :** décor Halloween, Noël ou Octobre Rose ; le week-end, la ville
  s'endort (volets fermés, rues vides).
- **Salle des ventes :** branchée sur le chantier « échange de cartes » (demandes et
  enchères de 12 h).

Une idée de plus tard, non décidée : faire grandir la maison selon la progression du joueur.

## 9. Prouvé / supposé / à valider

**Prouvé (lu dans le code de `origin/main`)**
- Le classeur, l'Arène, le deck, les tickets, JP TV et les stats sont servis par
  `src/web.js`, avec des liens HMAC.
- L'achat de booster et la revente sont aujourd'hui des actions Slack.
- La liste de diffusion est `data/subscribers.json`.
- Le choix de ne pas être diffusé sur JP TV existe déjà (`tvOptOut`).

**Supposé**
- Les portables du bureau font tourner une scène Three.js de cette taille de façon fluide.
- Un pack CC0 couvre assez de bâtiments pour obtenir le détail voulu.
- Le nombre de joueurs inscrits tient dans une ville lisible (quelques dizaines de maisons).

**À relire par Paul (choix du concepteur)**
- Seules les réactions Jeanpip font sortir un personnage (§5.3).
- Le solde reste privé sur la carte de visite (§5.4).
- Les protections anti-robot de la Boutique web (§5.5).
- Le nom et la taille exacts des kits Kenney, annoncés avant de les garder dans le dépôt.
