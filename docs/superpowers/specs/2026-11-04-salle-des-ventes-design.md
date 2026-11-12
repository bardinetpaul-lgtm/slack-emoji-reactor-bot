# Salle des ventes de Jeanpip City (v4.2) — conception et plan

Date : 2026-11-04 · Base : `main` v4.1 (541c633) · Statut : décidé avec Paul, à construire

## 1. Intention

La v4.1 a apporté les enchères de cartes, mais seulement dans Slack (modales, DM, bloc « Échanges » de l'Accueil). À Jeanpip City, la Salle des ventes affiche encore « Bientôt ». La v4.2 en fait un vrai lieu : une page web où l'on voit les enchères en cours, où l'on enchérit et où l'on met une carte en vente. Les règles sont **exactement** celles de Slack.

## 2. Décisions de Paul

| Sujet | Décision |
|---|---|
| Clic sur la Salle des ventes | Ouvre **une vraie page web** : enchères en cours, enchérir et mettre une carte en vente sur place |
| Visibilité dans la ville | **Un panneau sur le bâtiment** : « N enchère(s) en cours ». L'échafaudage et le panneau « BIENTÔT » disparaissent. Pas de marteau ni de feu d'artifice. |
| Enchères terminées | La page montre **les 10 dernières ventes** : carte, prix final, gagnant |

## 3. Règles reprises de la v4.1, sans les changer (`src/trades.js`)

- Une enchère dure 12 h. Si elle se termine entre 20 h et 9 h, sa fin est repoussée au lendemain à 10 h (`auctionEnd`). On ne peut pas lancer une enchère qui se terminerait pendant une pause (`ends_in_pause`).
- Le prix de départ vaut au moins le plancher de la rareté (`trades.floor`). Chaque enchère doit dépasser la précédente d'au moins 1 JP$ (`minBid`).
- Les JP$ de l'enchérisseur sont mis de côté et rendus dès qu'il est dépassé. On ne peut pas enchérir sur sa propre carte. Celui qui mène déjà ne peut pas surenchérir sur lui-même.
- Seuls les inscrits à `/jeanpip` interagissent. On ne peut rien faire pendant une pause ou un raid subi (`blockReason`, `weekend.pauseFor`).
- Les effets Slack restent ceux de la v4.1. À la mise en vente : DM d'annonce à tous les inscrits et suivi pour le vendeur. À l'enchère : DM « dépassé » à l'ancien meilleur enchérisseur, mise à jour des DM d'annonce et des Accueils. Une action faite sur le web déclenche **les mêmes** effets.

## 4. Contrat (le front et le serveur s'y tiennent à l'identique)

Le jeton est celui de la ville (`src/villeToken.js`, `?t=`). Toutes les routes sont relatives.

- `GET /salle?t=` : la page (`public/salle.html|css|js`).
- `GET /api/salle?t=` renvoie :
  ```
  { ok, serverTime,
    me:{ userId, balance, subscribed },
    pause: null|{ title }, blocked: null|string,    // texte prêt à afficher si on ne peut rien faire
    auctions:[{ id, card:{ code, title, rarity, image }, seller:{ userId, name, avatar },
                startPrice, best:null|{ userId, name, jp }, minBid, endsAt, mine, leading }],
    sellable:[{ code, title, rarity, image, floor, count }],   // mes cartes cessibles (même source que la modale Slack)
    recent:[{ card:{ code, title, rarity, image }, seller:{ name }, winner:{ name }, jp, at }] }  // 10 dernières ventes
  ```
  `avatar` est un chemin relatif prêt à l'emploi (`api/ville/avatar/<id>?t=`), comme dans la ville. `image` est l'URL d'image de carte du bot (`cardImageUrl` / `cardThumbUrl`), relative.
- `POST /api/salle/bid?t=`, corps `{ tradeId, jp }`, renvoie `{ ok:true, …état }` ou `{ ok:false, error, text }`. `text` est le texte exact de la modale Slack.
- `POST /api/salle/sell?t=`, corps `{ code, startPrice|null }`, renvoie `{ ok:true, tradeId, endsAt, …état }` ou `{ ok:false, error, text }`.
- Côté ville : `GET /api/ville` gagne `auctions:{ open:n }`. Le flux SSE gagne `event: auctions` `{ open:n }`, envoyé à l'ouverture puis à chaque changement (contrôle toutes les 10 s). `links.salle` vaut `salle?t=…`.

## 5. Plan (3 tâches en parallèle, après un socle)

Règles communes : tests `scripts/test-*.js` lancés avec `npx -y -p node@20 node …`. Les tests serveur tournent dans une copie temporaire. Pas de `npm install`, pas de commit. Chacun ne touche qu'à ses fichiers.

**Tâche 0 (coordinateur).** Créer le module `src/salleWeb.js` (simple bouchon, branché dans `src/web.js`). Ajouter `links.salle` dans `villeLinks`. Ajouter les hooks `onAuctionCreated` / `onBid` dans `startWebServer`, côté `app.js`.

**Tâche A, serveur.**
- Fichiers : `src/salleWeb.js`, `src/tradesSlack.js` (extraction seulement), `src/app.js` (seulement les corps des hooks), `scripts/test-salle-web.js`.
- Extraire de `registerAuction` deux fonctions exportées, `afterAuctionCreated(client, res)` et `afterBid(client, res, userId)`. Elles regroupent les DM, `setDm` et `refreshAll`, et les deux chemins Slack les appellent.
- Exporter `auctionErrorText(res, card, userId, now)` et `bidErrorText(res, userId, now)`, qui renvoient les textes exacts des modales.
- La liste `sellable` utilise la même source que `buildAuctionModal`. La liste `recent` reprend les enchères `done`/`sold`, les plus récentes en premier, 10 au maximum.
- Tests :
  - un jeton absent ou faux renvoie 403 ;
  - une enchère trop basse, sur sa propre carte, avec un solde insuffisant ou pendant une pause renvoie `ok:false` avec le texte, et rien ne bouge ;
  - une enchère valide met les JP$ de côté, rembourse l'ancien meilleur et appelle le hook une seule fois ;
  - une mise en vente sous le plancher est refusée ;
  - une mise en vente valide crée l'enchère et appelle le hook une seule fois ;
  - `recent` contient au plus 10 ventes, triées ;
  - un non-inscrit reçoit `blocked`.
  - Les tests existants `test-trades-*` doivent rester verts.

**Tâche B, page web.**
- Fichiers : `public/salle.html`, `public/salle.css`, `public/salle.js`, `scripts/preview-salle.js` (aperçu avec de fausses données, sur le modèle de `preview-ville.js`).
- Le style suit la Boutique et la Banque : français, tutoiement, lien « ← Retour à Jeanpip City ».
- Contenu :
  - les enchères en cours en grandes cartes : image, numéro, rareté, vendeur, meilleure offre, compte à rebours ;
  - un bouton « Enchérir », pré-rempli avec `minBid` ;
  - « Mettre une carte en vente » : choix dans `sellable`, prix de départ pré-rempli avec le plancher, et rappel des 12 h et de la fin repoussée la nuit ;
  - le bloc « Dernières ventes ».
- La page se rafraîchit toutes les 10 s. Elle n'insère que du texte (`textContent`) pour les données du serveur.

**Tâche C, ville.**
- Fichiers : `src/villeWeb.js` (champ `auctions`, événement SSE `auctions`), `public/ville-scene/landmarks.js`, `public/ville.js`, `public/ville-logic.js`, `scripts/test-ville-web.js`, `scripts/test-ville-logic.js`, `scripts/preview-ville.js`.
- Retirer l'échafaudage et le panneau « BIENTÔT ». Afficher un panneau lumineux « N enchère(s) en cours », ou « Aucune enchère » quand il n'y en a pas, mis à jour par le flux.
- Le clic et le menu « Aller à… » ouvrent `links.salle` (avec `v=1`). La liste de repli sans 3D inclut la Salle des ventes.

**Tâche D (coordinateur).**
- Ajouter l'entrée de version 4.2.0 et passer `package.json` en 4.2.0.
- Lancer tous les tests, regarder les deux aperçus et faire faire une relecture indépendante.

## 6. Non vérifié ou à valider

- Le rendu réel des DM Slack déclenchés depuis le web : le code est le même que celui de la v4.1, mais il n'a pas été essayé dans Slack.
- Les textes du panneau et de la page : ce sont mes choix, à relire par Paul.
