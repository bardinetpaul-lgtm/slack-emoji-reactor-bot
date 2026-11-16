# v4.4 : maison qui s'agrandit et ferme à Jeanpips (bases)

Date : 2026-11-16. Branche : `claude/v4.4-maison-ferme` (depuis `main` en v4.3).

## Besoin (Paul)

- La maison de chaque joueur dans Jeanpip City peut évoluer, et **les autres le voient**.
- Une **ferme** qu'on paie et qui fait gagner des JP$ en continu.

## Ce qui est fait

### Maison : 5 niveaux (refait le 2026-11-16 : « il faut vraiment avoir envie d'avoir la plus belle maison »)

Chaque niveau garde le décor des précédents et en ajoute. **La maison grandit à chaque niveau** (demande de Paul : « crescendo ») : chaque niveau a ses propres modèles, rangés par taille mesurée (niveau 1 : plain-pied bas ; 2 : maisons moyennes ; 3 : plus hautes ; 4 : les plus grandes et profondes), avec une échelle qui monte (3,5 → 3,8 → 4,05 → 4,3). Le modèle change donc quand la maison monte de niveau. Avant, le modèle était tiré au hasard et une maison de départ pouvait être plus grosse qu'une Villa.

| Niveau | Nom | Prix | Travaux | Ce que tout le monde voit en 3D |
|---|---|---|---|---|
| 1 | Maison | gratuit | — | la maison de départ |
| 2 | 🌷 Maison fleurie | 150 JP$ | 3 h | clôture blanche, jardinières de fleurs sous les fenêtres, massif de fleurs, boîte aux lettres rouge |
| 3 | 🏡 Grande maison | 400 JP$ | 1 jour | maison 8 % plus grande, arche fleurie au portail, deux lanternes allumées la nuit, cheminée qui fume |
| 4 | ⭐ Villa | 900 JP$ | 3 jours | maison 15 % plus grande, toit de tuiles neuf (rouge), grille en fer forgé à pointes dorées, projecteurs sur la façade la nuit, drapeau doré sur le toit |
| 5 | 🏰 Château Jeanpip | 2 000 JP$ | 5 jours | la maison est **remplacée par un château façon Chambord** construit sur mesure : terrasse et perron, façade en pierre claire à deux étages et corniches, porte d'honneur à cadre doré, **quatre tours rondes à hauts toits d'ardoise** avec bannières, grand toit hérissé de **cheminées et de lucarnes**, **lanterne centrale à coupole** ; devant : tapis rouge, grille dorée, arche en marbre, statue de Jeanpip en or le bras levé ; au-dessus : grande étoile dorée qui tourne avec des paillettes |

**Concours de la plus belle maison** : la Mairie affiche les 5 plus belles maisons (niveau le plus haut, puis le premier arrivé à ce niveau). La carte de visite dit « 3e plus belle maison de Jeanpip City ». Quand une maison monte de niveau, toutes les villes ouvertes affichent une annonce. L'étiquette au-dessus de la maison porte ⭐ (Villa) ou 🏰 (Château).

### Ferme à Jeanpips : 3 niveaux

| Niveau | Nom | Prix | Production | Silo | Ce qu'on voit |
|---|---|---|---|---|---|
| 1 | Potager à Jeanpips | 220 JP$ | 0,75 JP$/h | 6 JP$ | rangs de cultures devant la maison, 🌾 sur l'étiquette |
| 2 | Serre à Jeanpips | 450 JP$ | 1,5 JP$/h | 12 JP$ | + serre tunnel (bâche translucide sur arceaux blancs, porte verte) par-dessus les cultures |
| 3 | Ferme à Jeanpips | 900 JP$ | 2,25 JP$/h | 18 JP$ | + silo rouge |

- La production remplit un **silo**. Le joueur clique **« Récolter »** : les JP$ entiers sont crédités, les centimes restent dans le silo.
- Silo plein : la ferme ne produit plus. Il faut donc revenir dans la ville (environ 1 à 2 fois par jour) pour gagner le maximum.
- **Production et récolte seulement les jours ouvrés du joueur** : rien ne pousse et on ne peut pas récolter le week-end, pendant une fermeture de l'entreprise ni pendant ses congés. Le silo attend la reprise.

### Durée des travaux (ajout du 2026-11-16, demande de Paul)

| Travaux | Durée |
|---|---|
| Maison fleurie | 3 h |
| Grande maison | 1 jour |
| Villa | 3 jours |
| Château Jeanpip | 5 jours |
| Potager | 4 h |
| Serre | 1 jour |
| Ferme | 3 jours |

- On paie au lancement. Le nouveau niveau arrive à la fin du chantier.
- Pendant le chantier, tout le monde voit **une grue à tour animée** (la flèche pivote au-dessus de la maison, le chariot va et vient, une palette de briques monte et descend), des cônes orange et une barrière devant la maison, et 🚧 sur l'étiquette. La carte de visite affiche « Chantier : …, fini … vers … ».
- Un chantier à la fois pour la maison, un à la fois pour la ferme (les deux peuvent avancer en même temps).
- Pendant le chantier de la ferme, elle produit à son ancien niveau ; un Potager en chantier ne produit rien.
- Les durées comptent en temps réel, week-end compris (à valider : un chantier lancé le vendredi peut finir le samedi).

### Simulation de l'économie (prod au 2026-11-16, 28 jours)

`scripts/simulate-maison-ferme.js` fait tourner le vrai moteur sur 4 semaines avec 4 rythmes de récolte.

- Prod, échanges entre joueurs exclus : 9 895 JP$ créés, 8 655 détruits, soit +1 240 JP$ nets (+36 % de la masse de 3 403 JP$ en un mois). Gain médian d'un joueur actif : 45 JP$ par jour.
- **Réglage A (première proposition)** : le Potager rapporte 12,7 JP$/jour à 2 visites (28 % du gain médian), remboursé en 16 jours ouvrés ; la Ferme rapporte 38 à 50 JP$/jour, autant que le gain médian. 8 Potagers ajouteraient +20 % de création de JP$.
- **Réglage C (choisi par Paul le 2026-11-16, DANS LE CODE)** : intermédiaire entre A et B, parce que les maisons ajoutent une nouvelle dépense. Potager 220 JP$ (0,75/h, silo 6), Serre 450 (1,5/h, silo 12), Ferme 900 (2,25/h, silo 18). À 2 visites par jour : Potager 8,8 JP$/jour (19 % du gain médian), remboursé en 26 jours ouvrés ; Serre 18,5 JP$/jour ; Ferme 28,2 JP$/jour (63 %). 8 Potagers : +14 % de création de JP$ ; les 2 plus gros joueurs en Ferme : +11 %.
- **Réglage B (recommandé au départ)** : Potager 250 JP$ (0,5/h, silo 4), Serre 500 (1/h, silo 8), Ferme 1 000 (1,5/h, silo 12). Potager à 2 visites : 5,9 JP$/jour (13 %), remboursé en 43 jours ouvrés ; 8 Potagers : +9 % de création.
- Les maisons sont une pure dépense (1 450 JP$ jusqu'à la Villa, 3 450 JP$ jusqu'au Château) : bon moyen d'absorber le surplus actuel. Le plus gros solde de prod est de 758 JP$ : le Château est un objectif de plusieurs mois.
- Aujourd'hui, seulement le quart des joueurs a assez pour un Potager à 200 JP$ (soldes : médiane 65,5 ; 3e quartile 178).

### Où ça se passe

- Dans Jeanpip City, clic sur **sa maison** → la fenêtre « Ta maison » montre les travaux possibles, le silo et le bouton de récolte.
- Sur la maison d'un collègue : on voit son niveau et sa ferme, jamais son solde ni son silo.
- Quand quelqu'un fait des travaux, toutes les villes ouvertes mettent sa maison à jour en direct.
- Seuls les inscrits à Jeanpip ont une maison, donc seuls eux peuvent faire des travaux.

### Technique

- `src/maison.js` : niveaux, prix, production, achats, récolte. Données dans `data/maisons.json`.
- `src/villeWeb.js` : `POST /api/ville/maison/house|farm|collect` (jeton de la ville), niveaux ajoutés aux maisons, événement direct `house` `update`.
- `public/ville-scene/houses.js` : décor des niveaux et de la ferme ; `public/ville.js` : fenêtre « Ta maison ».
- Grand livre des JP$ : sources `house_upgrade`, `farm_upgrade` (débits) et `farm` (récoltes) ; événements `house_upgrade`, `farm_upgrade`, `farm_collect`.
- Protection double clic : chaque achat dit le niveau visé ; un niveau déjà passé est refusé sans débit.
- Release note 4.4.0 ajoutée, version 4.4.0.
- Test : `scripts/test-maison.js` (chantiers compris). L'aperçu `scripts/preview-ville.js` montre des niveaux et fermes variés.

## Vérifié

- `test-maison` : tout passe ; `test-ville-web`, `test-releases`, `test-ville-logic`, `test-ledger-sources`, `test-home-ville` : OK (Node 20).
- Rendu 3D et fenêtre « Ta maison » regardés dans l'aperçu (fausses données) et dans la vitrine (`node scripts/preview-ville.js` puis `/vitrine`).

## Pas vérifié / à faire valider par Paul

- **Tous les prix, rendements et durées sont des propositions.** La ferme est au réglage C (choisi par Paul). La Ferme au niveau max rapporte encore 63 % du gain médian à 2 visites par jour : à surveiller après la mise en prod.
- Pas de notification Slack quand le silo est plein (idée possible).
- Pas d'entrée dans l'Accueil Slack ni dans le tableau de bord `/stats` pour ces nouvelles sources.
- Pas testé sur la vraie ville avec les vraies maisons (place sur les petites parcelles, à regarder en direct).
- Ni commit, ni PR, ni déploiement.
