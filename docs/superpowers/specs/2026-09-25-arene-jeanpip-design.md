# ⚔️ Arène Jeanpip — jeu de combat de cartes en temps réel — Design

_Date : 2026-09-25 · Auteur : Paul Bardinet (avec Claude)_

## 🎯 Objectif

Un vrai jeu de cartes **en temps réel, 1 contre 1, 2 minutes maximum**, inspiré de Clash Royale,
joué avec les cartes de sa **collection Jeanpip**. Mécanique centrale et addictive :
**engager une carte, c'est risquer de la perdre** (doublons = munitions).

Le jeu se lance depuis Slack et se joue sur une page web servie par le bot.

Hors périmètre V1 : classement Elo / trophées, spectateurs, annonces publiques des résultats,
spécialités de cartes (l'architecture les prévoit, aucune n'est livrée), combats contre l'IA.

## ⚠️ Contrainte d'accès

La page web est derrière le reverse proxy du dashboard (`https://dashboard-lorient.dimsi.cloud/jeanpip/`),
**whitelist IP : bureaux de Lorient et d'Asnières uniquement**. L'arène n'est donc jouable que
depuis ces bureaux. Les DM de défi le rappellent (« depuis le bureau de Lorient ou d'Asnières »).

## 🃏 Les cartes au combat

### Archétype

Chaque carte du catalogue (125 cartes) reçoit un **archétype**, déterminé ainsi :

1. `data/card-overrides.json` s'il contient une entrée pour la carte (clé = URL du média) ;
2. sinon, tirage **stable** : `sha256(url)` → nombre dans [0, 100) → archétype selon la répartition.

| Archétype | Part | Coût | PV | DPS | Portée | Vitesse | Cible |
|---|---|---|---|---|---|---|---|
| 🛡 Tank | 20 % | 5 | 1400 | 45 | mêlée | lente | **bâtiments uniquement** (tours, QG, Pompe) |
| ⚔️ Guerrier | 27 % | 3 | 500 | 70 | mêlée | moyenne | tout |
| 🏹 Tireur | 23 % | 3 | 320 | 80 | distance | moyenne | tout |
| 🐝 Essaim | 15 % | 3 | 3 × 230 | 3 × 42 | mêlée | rapide | tout |
| 💥 Sort | 10 % | 4 | – | 350 en zone | – | instantané | 1re unité ennemie du couloir (sinon Pompe, tour, QG), dégâts en zone autour, **40 % sur les bâtiments** |
| ⚗️ Pompe | 5 % | 4 | 500 | – | – | immobile | +1 élixir / 7 s pendant 45 s |

### Rareté

| Rareté | Multiplicateur stats | Coût |
|---|---|---|
| ⚪ Commune | ×1,0 | +0 |
| 🔵 Rare | ×1,06 | +0 |
| 🟣 Épique | ×1,13 | +0 |
| 🟡 Légendaire | ×1,2 | +0 |

Pour la **Pompe**, la rareté multiplie PV et durée de vie, **jamais la cadence de production**.
Pour l'**Essaim**, le bonus de rareté est réduit de moitié (ses 3 unités en profitent chacune).

### Cycle de contres

Un archétype inflige **×1,5 de dégâts** à celui qu'il contre, et seulement **×0,67** à celui
qui le contre (affiché sur la carte) :
**Tank → Guerrier → Tireur → Essaim → Tank**, et le **Sort** (zone) contre l'Essaim.
Le Tank ne visant que les bâtiments, « Tank bat Guerrier » se lit en défense : le Guerrier ne
lui fait que ×0,67.

### Spécialités (prévu, non livré en V1)

`data/card-overrides.json` accepte un champ `specialty` par carte. Une spécialité est une
entrée du registre `src/game/specialties.js` qui s'accroche aux moments `onDeploy`, `onHit`,
`onDeath`, `onTick`. Toute nouvelle spécialité est validée par `scripts/simulate-balance.js`.

### Équilibrage

Mesuré par `scripts/simulate-balance.js` sur le vrai moteur (contres, tours, Pompe inclus).

| Rareté | Duel à élixir égal (carte + 1 commune contre toutes les mains communes de même coût) | Combat complet de 2 min, 1 carte de cette rareté dans le deck, contre deck 100 % commun |
|---|---|---|
| ⚪ Commune | 50 % (archétypes : 46 à 52 %) | – |
| 🔵 Rare | 60 % | 51 % |
| 🟣 Épique | 63 % | 53 % |
| 🟡 Légendaire | 69 % | 57 % |

Un surcoût d'élixir pour les raretés hautes a été testé puis écarté : il les rendait plus faibles
que les rares en duel.
Critère : aucune rareté au-dessus de ~70 % de victoires à élixir égal, aucun archétype commun
hors de [35 %, 65 %].

## ⚔️ Règles du combat

### Terrain

```
      [T1]   [T2]   [T3]     ← tours de l'adversaire (600 PV, 80 DPS)
             [ QG 2000 ]
  ────────── rivière ──────────
             [ QG 2000 ]
      [T1]   [T2]   [T3]     ← mes tours
```

- **3 couloirs.** Une unité avance dans son couloir, sans jamais en changer, et attaque ce qu'elle
  croise (sauf le Tank, qui ne vise que les bâtiments).
- **Tours de couloir : 600 PV, 80 DPS** sur la zone du couloir proche d'elles. Tant qu'une tour
  tient, son couloir est fermé : on ne peut pas atteindre le QG par là.
- **Brèche :** une tour détruite ouvre le couloir jusqu'au QG. Le vainqueur de la tour peut
  alors poser ses cartes **plus loin dans ce couloir** (jusqu'à la rivière adverse).
- **QG : 2000 PV, 100 DPS**, ne tire que sur les unités entrées par une brèche.
- **Pose :** dans sa moitié de terrain, dans le couloir choisi. L'unité apparaît **1 s après**
  la pose (visible par l'adversaire pendant cette seconde).

### Deck, main, élixir

- **Deck = 8 cartes différentes** choisies dans sa collection. Il faut **au moins 8 cartes
  différentes** en collection pour combattre.
- **Chaque pose engage un exemplaire.** Une carte peut être posée autant de fois qu'on en possède
  d'exemplaires : les doublons sont des munitions. Une carte sans exemplaire restant sort du cycle.
- **Main de 4**, cycle façon Clash Royale : la carte posée repart en fin de file.
- **Élixir :** départ 5, max 10, +1 toutes les 2,8 s ; **double élixir la dernière minute**.
- **Pas de plafond de poses** : l'élixir régule. L'élixir des deux joueurs est visible.
- **Une seule Pompe active** à la fois par joueur.

### Fin du combat

1. **QG détruit** → victoire immédiate.
2. À **2:00** : le plus de **tours détruites** gagne ; à égalité, le plus de **PV de QG (en %)** ;
   à égalité parfaite, **match nul**.
3. **Abandon** ou **déconnexion > 20 s** → défaite. Les deux déconnectés → combat annulé.

Une **Pompe arrivée au bout de sa durée de vie** n'est pas détruite : elle compte comme survivante.
Une pose encore en train d'apparaître (délai de 1 s) à la fin compte aussi comme survivante.

## 💰 Économie et butin

| | Vainqueur | Perdant | Match nul |
|---|---|---|---|
| Cartes posées détruites | perdues | perdues | perdues |
| Cartes posées survivantes | reviennent | **perdues** | reviennent |
| 🎁 Pack | 1 booster **Commun** en attente d’ouverture (`boosters.createPending(userId, 'common')`) | – | – |
| 💰 Crédits | **+10** | – | – |
| 🃏 Butin | **1 exemplaire tiré au hasard parmi toutes les poses du perdant** | cet exemplaire part chez le vainqueur | – |

« Perdre » une pose = retirer 1 exemplaire de la collection. Un Sort compte toujours comme détruit.

**Anti-farm** (compteurs persistés dans `data/arena.json`, survivent aux redémarrages) :
- pack + crédits pour **5 victoires par jour et par joueur maximum**, dont **2 contre le même
  adversaire** ; au-delà on joue et le butin s'applique, sans pack ni crédits.
- le butin n'est jamais plafonné (transfert entre joueurs, aucune création de carte).

**Combat annulé** (absence en préparation, redémarrage du bot, double déconnexion) : **rien
n'est perdu**, aucune récompense.

## 🧭 Parcours Slack

### Accueil

Bloc « ⚔️ Arène » : victoires, défaites, série en cours, meilleur butin, et le top des vainqueurs
de la semaine. Boutons **⚡ Combat rapide**, **🎯 Défier…** (sélecteur d'utilisateur),
**🃏 Mon deck** (lien signé vers l'éditeur de deck). Commande équivalente : `/jeanpip-duel @user`.

### Deck

Page web `deck/<user>?t=<token>` : la collection façon classeur, avec archétype, coût, stats,
contres et nombre d'exemplaires, et une sélection de 8 cartes sauvegardée dans `data/arena.json`.
Sans deck sauvegardé, un **deck auto équilibré** est proposé (mix d'archétypes ; les cartes
les plus rares seulement si possédées en double). Si une carte du deck a disparu de la collection,
le deck est complété automatiquement au prochain combat, avec un message.

### Défi direct

1. DM à la cible : « ⚔️ Paul te défie ! [Accepter] [Refuser] », **expire après 60 s**.
2. Refus / expiration → DM au challenger.
3. Acceptation → chaque joueur reçoit son lien signé vers la **préparation**.

Refusé d'emblée si : un des deux est déjà en combat ou en file, un des deux a moins de 8 cartes
différentes, défi à soi-même.

### Combat rapide

File d'attente de **60 s** : association avec le premier joueur disponible. Personne → message
« Personne de dispo, défie un collègue ? ». Pas d'annonce publique.

### Préparation (web)

Écran « Paul vs Julie » : son deck avec **✏️ Modifier** et **✅ Prêt**. Le combat démarre quand
les deux sont prêts, ou **60 s** après l'ouverture de la préparation (deck en cours). Un joueur
jamais connecté → combat annulé. Le deck adverse reste caché.

### Fin

- Arène : écran de résultat animé (cartes perdues, butin, crédits, pack).
- DM récapitulatif **privé** à chaque joueur. Le vainqueur reçoit son pack comme un booster
  classique (bouton d'ouverture Slack + ouverture FIFA existantes).
- **Aucune annonce publique.**

## 🏗️ Architecture

Tout dans le process du bot (service `slack-reactor`), **aucune dépendance ajoutée**.

| Fichier | Rôle |
|---|---|
| `src/game/cards.js` | `getCardStats(card)` : archétype (surcharge ou hash), rareté, coût, stats, contre, spécialité. |
| `src/game/specialties.js` | Registre des spécialités et points d'accroche. Vide en V1. |
| `src/game/engine.js` | ⭐ **Moteur pur** : `createMatch({ decks, collections, seed })`, `applyAction(state, player, action)`, `tick(state, dtMs)` → `{ state, events }`. Aucun I/O, aucun timer, aléa à graine : un combat se rejoue à l'identique. |
| `src/game/matches.js` | Cycle de vie (`preparing → running → ended/cancelled`), boucle 10 Hz, 1 combat max par joueur, suivi des connexions, timers de préparation et de déconnexion. En mémoire. |
| `src/game/matchmaking.js` | Défis (60 s) et file rapide (60 s). |
| `src/game/arenaStore.js` | `data/arena.json` : decks, stats V/D/série/meilleur butin, compteurs anti-farm du jour. |
| `src/game/settle.js` | Fin de combat : calcule pertes, butin, récompenses (plafonds), puis applique en une fois : retrait des exemplaires, ajout du butin, booster, crédits, stats. |
| `src/game/arenaWeb.js` | Routes web de l'arène, branchées dans `src/web.js`. |
| `src/collections.js` | + `removeCards(userId, urls)` : décrémente, supprime la carte à 0, jamais sous 0. |
| `src/home.js` / `src/app.js` | Bloc Arène, boutons, `/jeanpip-duel`, actions Accepter/Refuser, DM de fin. |
| `public/arena.html/.css/.js` | Préparation + arène (canvas, interpolation) + résultat. |
| `public/deck.html/.css/.js` | Éditeur de deck. |
| `data/card-overrides.json` | Archétypes et spécialités posés à la main. |
| `scripts/simulate-balance.js` | Simulation d'équilibrage réutilisable, basée sur `engine.js`. |

### Temps réel

- Serveur maître : boucle **10 Hz**, état poussé en **SSE** (`GET api/arena/<id>/stream?t=`),
  en-tête `X-Accel-Buffering: no`, keep-alive toutes les 15 s.
- Actions : `POST api/arena/<id>/action?t=` `{ type: 'deploy', card, lane }` | `{ type: 'ready' }`
  | `{ type: 'forfeit' }` | `{ type: 'deck', cards }`. Le serveur valide tout (élixir, main,
  exemplaires, zone de pose). Réponse immédiate (`ok` / raison du refus).
- Le client interpole entre deux états pour un rendu fluide à 60 fps. À la reconnexion,
  `EventSource` reçoit l'état complet.
- Liens signés HMAC (secret existant de `web.js`), un jeton par (match, joueur) et par (deck, joueur).

### Fiabilité

- La collection n'est modifiée **qu'une fois, en fin de combat**, par `settle.js`.
  Les collections ne font que croître en dehors de l'arène, donc aucun conflit pendant un combat.
- Combats en mémoire : un redémarrage annule les combats en cours sans aucune perte.
- `settle.js` est idempotent par id de match (un match réglé ne l'est jamais deux fois).

## 🧪 Tests

- `scripts/test-arena-engine.js` : élixir et double élixir, cycle de main, exemplaires,
  contres ×1,5, Tank qui ne vise que les bâtiments, tir des tours, brèche et pose avancée,
  Pompe (production, limite d'une), Sort, conditions de fin, déterminisme à graine.
- `scripts/test-arena-settle.js` : pertes vainqueur / perdant / nul, butin, plafonds anti-farm,
  idempotence, jamais de compteur négatif.
- `scripts/test-arena-matchmaking.js` : défi (accepter, refuser, expirer), file rapide,
  refus si déjà en combat ou < 8 cartes.
- `scripts/simulate-balance.js` : échoue si une rareté dépasse ~70 % à élixir égal ou si un
  archétype commun sort de [35 %, 65 %].
