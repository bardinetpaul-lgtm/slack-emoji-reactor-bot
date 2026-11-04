# Échange de cartes entre joueurs : conception

Date : 2026-11-04 · Demandeur : Paul · Base de code : `origin/main` v3.8

## Pourquoi

Les packs 🎃 Halloween et 🎀 Octobre Rose sont fermés. Des joueurs veulent maintenant acheter ces cartes à ceux qui les ont. Aujourd'hui, c'est impossible :
- le raid ne vole jamais une carte hors série ;
- la seule sortie possible pour une carte est la revente à la banque (`src/resale.js`).

On ouvre donc un **libre échange** entre joueurs : des cartes contre des JP$, et des cartes contre des cartes.

Ce qui compte pour Paul : un système simple, sans limite artificielle (« on fait du libre échange »). Une demande ne doit jamais rester en suspens longtemps.

## Les trois façons d'échanger

Une demande ou une enchère porte toujours sur **un seul exemplaire d'une seule carte** du vendeur. En face, l'acheteur peut proposer plusieurs cartes et/ou des JP$.

### 1. Demande à une personne
- L'acheteur choisit un joueur.
- Il voit la **liste des numéros de cartes** (`#42`, `OR5`, `HW3`, …, la même numérotation que le classeur, `src/album.js`).
- Les numéros que ce joueur ne peut pas céder sont marqués **« non disponible »** et ne peuvent pas être choisis.
- On ne montre pas l'image des cartes : le classeur garde sa confidentialité (on ne voit jamais l'image d'une carte qu'on ne possède pas).
- L'acheteur propose **des JP$, ou une ou plusieurs de ses propres cartes, ou les deux**.
- Le vendeur reçoit la demande en DM, avec trois choix : **Accepter**, **Refuser** ou **Contre-offre**.

### 2. Demande générale
- L'acheteur choisit un numéro de carte et fait son offre à tout le monde.
- **Tous les joueurs inscrits qui peuvent céder cette carte** reçoivent la demande en DM. Les autres ne reçoivent rien.
- **Le premier propriétaire qui accepte conclut la vente.** La demande se ferme alors pour les autres, et leur DM est mis à jour (« déjà conclue »).
- La contre-offre est aussi possible ici. Une contre-offre ne ferme pas la demande pour les autres propriétaires, et ne prolonge pas leur délai d'1 h. Dès que l'acheteur accepte une contre-offre, ou qu'un propriétaire accepte l'offre d'origine, tout se ferme : les autres contre-offres sont annulées.

### 3. Enchère (à l'initiative du vendeur)
- Le vendeur choisit une de ses cartes et lance une enchère de **12 h**.
- **Annonce en DM à tous les joueurs inscrits à `/jeanpip`.** C'est la seule fois où l'on montre l'**image** d'une carte à quelqu'un qui ne la possède pas.
- Les enchères se font en JP$ uniquement.
- Le vendeur peut fixer un prix de départ, qui ne peut pas être sous le plancher (voir Garde-fous).
- À la fin des 12 h, la plus haute enchère emporte la carte. Sans enchère, la carte reste au vendeur.

## Règles communes

| Règle | Décision |
|---|---|
| Cartes échangeables | **Toutes** (décision de Paul) |
| Durée de vie d'une demande (1 et 2) | **1 h**, puis expiration automatique |
| Contre-offre | **Oui** (décision de Paul) |
| Limite d'échanges par jour | **Aucune** (décision de Paul : libre échange) |
| Prix minimum | Oui : le prix de rachat de la banque (voir Garde-fous) |

### Contre-offre
- Une seule contre-offre par vendeur et par demande. L'acheteur peut seulement l'accepter ou la refuser : pas de ping-pong sans fin.
- La contre-offre peut porter sur le **prix en JP$** et/ou sur **des cartes de l'acheteur** (décision de Paul). Pour choisir ces cartes, le vendeur voit la même liste de numéros que dans la demande à une personne : les cartes que l'acheteur ne peut pas céder sont marquées « non disponible ». Il ne voit jamais les images ni le reste du classeur de l'acheteur.
- Les cartes réclamées dans une contre-offre ne sont pas réservées à l'envoi. On revérifie au moment où l'acheteur accepte ; si l'une n'est plus disponible, l'acceptation échoue avec un message clair.
- Si le nouveau prix dépasse le montant en réserve, le complément est prélevé quand l'acheteur accepte. Si son solde ne suffit plus, l'acceptation échoue avec un message clair.
- La contre-offre relance un délai d'1 h pour la réponse de l'acheteur, pour ce vendeur seulement.

### Mise en réserve (mes choix)
- **JP$** : dès qu'une offre ou une enchère est envoyée, son montant est retiré du solde de l'acheteur (`credits.spend`, source `trade_hold`). Il est rendu (`credits.addCredit`, source `trade_refund`) en cas de refus, d'expiration ou de surenchère. Un vendeur n'accepte ainsi jamais une offre que l'acheteur ne peut plus payer.
- **Cartes proposées en échange** par l'acheteur : elles sont réservées le temps de la demande. Elles ne peuvent pas être proposées ailleurs ni revendues à la banque.
- **Carte du vendeur** :
  - demande 1 ou 2 : on ne réserve rien à l'envoi. On revérifie au moment où le vendeur clique sur Accepter. Si la carte n'est plus disponible, l'échange échoue avec un message clair, et l'acheteur est remboursé si la demande était à une personne.
  - enchère : la carte est réservée pendant les 12 h.
- Une carte réservée est hors deck : elle n'est pas proposée au deck auto et n'est plus dans les cartes de deck disponibles.

### Ce qu'on a le droit de céder
On part de la règle de la revente (`resale.sellable`) : pas les exemplaires placés dans un deck d'Arène (Capitaine compris), ni ceux déjà réservés par un autre échange.

**Exception validée par Paul** : on peut céder son **dernier exemplaire** (le vendeur décide). Seuls les exemplaires placés en deck et ceux déjà réservés sont bloqués.

## Garde-fous

- **Raid et cartes réservées** (mon choix) : une carte réservée (mise aux enchères, ou proposée par un acheteur) peut toujours être volée par un raid. Sinon, la réserve servirait d'abri contre le pillage. Si elle est volée, l'échange ou l'enchère est annulé et tous les JP$ en réserve sont rendus. Il faut donc toucher à `raid.js` pour prévenir le module d'échange.
- **Cartes retirées de la banque** : elles restent échangeables. Elles sont affichées avec leur numéro de classeur. Si ce numéro est absent ou en double, on affiche leur titre.

- **Prix plancher** pour toute offre contenant une carte contre des JP$ seulement : le prix de rachat de la banque (`resale.PRICES`), arrondi à 1 JP$ minimum par carte. Soit 1 JP$ pour une commune, 2 pour une rare, 5 pour une épique, 10 pour une hors série et 20 pour une légendaire. Les cartes sans prix de rachat (photos anti-spam) ont un plancher de 1 JP$. But : empêcher de se donner des cartes gratuitement.
- **Échange carte contre carte** : aucun plancher, c'est du libre échange (validé par Paul).
- **Pauses** : comme pour la revente, aucun échange, aucune demande et aucune enchère ne démarre pendant une pause (week-end, fermeture, congés de l'un des deux joueurs : `weekend.pauseFor`).
- **Raid** : rien pendant qu'on subit un raid (`raid.raidsAgainst`), ni comme acheteur ni comme vendeur, pour qu'on ne soustraie pas ses cartes au pillage.
- **Les échanges ne créent pas de JP$** : ils ne comptent pas dans le plafond hebdomadaire de revente.
- Pas d'échange avec soi-même. Pas d'échange avec un joueur non inscrit, en congés ou sous pénalité anti-farm.

## Délais qui croisent une pause (mes choix)
- Une demande d'1 h expire normalement au bout d'1 h, même la nuit. Si la pause commence avant la fin de la demande (vendredi 23 h 30 → samedi 0 h), la demande est annulée à l'entrée en pause et l'acheteur est remboursé.
- Une enchère de 12 h dont la fin tombe **la nuit (entre 20 h et 9 h)** voit sa fin repoussée au **lendemain, 10 h**, pour que les joueurs puissent suivre la fin.
- On ne peut pas lancer une enchère dont la fin (même repoussée) tomberait pendant une pause : aucune enchère ne court donc pendant un week-end ou une fermeture. Pendant les congés d'un joueur, il ne peut pas enchérir, mais l'enchère continue pour les autres.

## Notifications
- Demande à une personne : DM au vendeur. Le résultat (accepté, refusé, contre-offre, expiré) est envoyé en DM à l'acheteur.
- Demande générale : DM à chaque propriétaire éligible. Chaque DM est mis à jour à la clôture.
- Enchère : DM d'annonce à tous les joueurs, avec l'image, le prix actuel, un bouton **Enchérir** et l'heure de fin. Un DM est envoyé au précédent meilleur enchérisseur quand il est dépassé. À la fin, un DM au vendeur et un au gagnant.
- **Seuls les inscrits à la liste `/jeanpip` (`broadcast.isSubscribed`) reçoivent les DM de diffusion** (décision de Paul) : les annonces d'enchères et les demandes générales. Pas de réglage en plus : s'inscrire ou se désinscrire suffit.
- **Seuls les inscrits peuvent interagir** (décision de Paul) : faire une demande, en recevoir une, faire une contre-offre, lancer une enchère, enchérir. Un non-inscrit voit le bloc « Échanges » de l'Accueil avec une invitation à s'inscrire à `/jeanpip`, et rien d'autre.
- Dans la demande à une personne, seuls les joueurs inscrits sont proposés.
- Se désinscrire en cours d'échange (mon choix) : les demandes et contre-offres en cours de cette personne sont annulées et les JP$ rendus. Ses enchères en cours vont à leur terme ; ses enchères posées sur l'enchère d'un autre restent valables.
- Pendant une pause, aucun DM automatique n'est envoyé, comme partout ailleurs dans le jeu.

## Où ça vit
- Onglet Accueil : un bloc **« Échanges »** avec les boutons *Demander une carte*, *Demande générale*, *Mettre aux enchères*, et la liste de mes demandes et enchères en cours.
- Les saisies se font dans des modales Slack (choix du joueur, du numéro de carte, de l'offre).
- Plus tard, la **salle des ventes** de la ville Jeanpip (brainstorm séparé) affichera les enchères en cours. Hors périmètre ici.

## Ce qui reste à décider par le bâtisseur
- Le stockage : un fichier `data/trades.json` à écriture atomique (`src/storage.js`), comme les autres modules, ou bien SQLite.
- Le mécanisme de minuterie pour les expirations et les fins d'enchère. Il doit survivre à un redémarrage du bot.
- Les textes exacts des DM et des modales.
- L'ajout aux statistiques (`src/stats/`) et au grand livre des crédits (sources `trade_*`).
- La ligne de release note dans `src/releases.js`.

## Non-objectifs
- Pas d'échange pendant les pauses.
- Pas de carte « mystère » de la boutique d'Arène dans les échanges.
- Pas de place de marché publique permanente (vitrine). Seules existent les demandes et les enchères.
- Pas de commission de la banque sur les échanges.

## Décisions validées par Paul (2026-11-04)
1. On peut vendre son **dernier exemplaire** d'une carte. Seuls les exemplaires placés dans un deck sont bloqués : la règle de cessibilité est donc différente de `resale.sellable`.
2. Un échange **carte contre carte n'a pas de prix minimum**.
3. Une enchère qui se terminerait la nuit (20 h - 9 h) est repoussée au lendemain 10 h. On ne peut pas lancer une enchère qui finirait pendant une pause.
4. Seuls les inscrits à `/jeanpip` interagissent avec les échanges et reçoivent les diffusions.
5. La contre-offre peut porter sur des JP$ et/ou sur des cartes de l'acheteur.
6. Une carte réservée peut être volée par un raid. L'échange est alors annulé et les JP$ rendus.
