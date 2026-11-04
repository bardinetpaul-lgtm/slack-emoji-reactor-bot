# Échange de cartes (v3.9) — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** permettre aux joueurs inscrits d'échanger des cartes : demande à une personne, demande générale, contre-offre et enchère de 12 h.

**Architecture :** toutes les règles et le stockage vivent dans un module pur, `src/trades.js` (`data/trades.json`, horloge `now` passée en paramètre). L'affichage Slack vit dans `src/tradesSlack.js` (Accueil, modales, DM, minuterie), sur le modèle de `src/bugsSlack.js`. La numérotation des cartes (`#42`, `OR3`, `HW5`) est sortie du classeur dans `src/cardIndex.js`. Les JP$ sont mis en réserve par de vrais mouvements dans le grand livre ; les cartes sont réservées de façon logique (calculées à partir des échanges ouverts) et revérifiées à chaque passage de la minuterie (toutes les 10 s). Écart volontaire avec la conception : on ne modifie pas `raid.js`. La revérification rattrape toute perte de carte, qu'elle vienne d'un raid, de l'Arène ou d'un admin.

**Tech Stack :** Node.js (CommonJS), @slack/bolt 4 (Socket Mode), better-sqlite3 (crédits), fichiers JSON via `src/storage.js`.

**Spec :** `docs/superpowers/specs/2026-11-04-echange-cartes-design.md`

## Global Constraints

- Partir de `origin/main` (v3.8). Le checkout principal est sur une vieille branche : travailler dans un worktree neuf, avec `node_modules` en jonction vers un worktree existant (voir la mémoire `node24-better-sqlite3`).
- Lancer chaque test avec `npx -y -p node@20 node scripts/<test>.js`. Node 24 ne charge pas better-sqlite3.
- Les tests suivent le modèle de `scripts/test-resale.js` : une COPIE temporaire du projet, un faux Slack, aucune donnée réelle touchée.
- Écrire les données uniquement avec `storage.writeJsonAtomic` / `storage.readJson`.
- Textes destinés aux joueurs : français, tutoiement (comme le reste du jeu), sans jargon technique.
- Seuls les inscrits à `/jeanpip` (`broadcast.isSubscribed`) peuvent interagir et recevoir les diffusions.
- Durées : demande et contre-offre **1 h** ; enchère **12 h**. Une fin d'enchère entre **20 h et 9 h** (heure de Paris) est repoussée au **10 h** suivant.
- Prix plancher (offre en JP$ seulement, sans carte) : `max(1, resale.PRICES[rarity] ?? 1)` par carte. Soit 1 pour une commune, 2 pour une rare, 5 pour une épique, 10 pour Octobre Rose ou Halloween, 20 pour une légendaire, 1 pour une photo anti-spam ou une carte retirée.
- Aucune limite d'échanges par jour. Aucune commission. Les échanges ne comptent pas dans le plafond de revente.
- Sources du grand livre : `trade_hold` (mise en réserve), `trade_refund` (restitution), `trade_sale` (paiement du vendeur).
- Pas de DM automatique pendant une pause. Passer par le `sendDM` réduit au silence le week-end, comme `bugsSlack.register`.
- Les montants en JP$ sont des entiers ≥ 1 (choix du bâtisseur).
- Version **3.9.0** : ajouter son entrée dans `src/releases.js` et dans `package.json`.

## Review Focus

1. **Double clic ou deux propriétaires qui acceptent la même demande générale à la même seconde.** Une seule vente doit avoir lieu, et l'autre propriétaire doit recevoir « déjà conclue ». Chaque transition de `trades.js` est synchrone (aucun `await` entre la lecture et l'écriture), et son test le vérifie (tâche 3).
2. **La carte disparaît pendant que l'échange est ouvert** (raid, Arène, revente faite avant la réservation). L'échange est annulé, les JP$ rendus, et personne ne reçoit une carte qui n'existe plus (tâche 5).
3. **Le solde de l'acheteur ne suffit plus pour le complément d'une contre-offre.** L'acceptation échoue proprement, sans débit partiel (tâche 3).
4. **Redémarrage du bot pendant une enchère ou une demande.** La minuterie rattrape au démarrage toutes les expirations et fins dépassées, et l'enchère n'est réglée qu'une seule fois (tâche 5).
5. **Enchère surenchérie par la même personne, ou acheteur qui fait une demande sur sa propre carte.** Refusé avec un message clair (tâches 2 et 4).

---

### Task 1 : index des cartes (`src/cardIndex.js`)

**Files :**
- Create : `src/cardIndex.js`
- Modify : `src/album.js` (exporter `numberBank`)
- Test : `scripts/test-card-index.js`

**Interfaces :**
- Produces :
  - `listCards(): Array<{ code: string, url: string, title: string, rarity: string, type: string }>`. Ordre : banque par numéro, puis `OR1…`, `HW1…`, anti-spam. Le code vaut `#N` pour la banque et l'anti-spam, `ORn` pour Octobre Rose, `HWn` pour Halloween.
  - `codeOf(url: string, title?: string): string`. Le code d'une carte connue. Pour une carte retirée de la banque : `#N` tiré du titre, sinon le titre lui-même.
  - `byCode(code: string): { code, url, title, rarity, type } | null`. Insensible à la casse ; accepte `42` comme `#42`.

- [ ] **Step 1 : écrire le test qui échoue.** Assertions :
  - les codes de `listCards()` sont uniques ;
  - `codeOf` d'une carte Halloween = `HW<number>` ;
  - `byCode('hw1').url === HALLOWEEN_CARDS[0].url` ;
  - `byCode('42')` équivaut à `byCode('#42')` ;
  - `codeOf('https://x.test/retiree', 'Surprise #999') === '#999'` ;
  - `codeOf('https://x.test/r2', 'Sans numéro') === 'Sans numéro'`.
- [ ] **Step 2 : lancer le test.** Il doit échouer (`Cannot find module`).
- [ ] **Step 3 : écrire `src/cardIndex.js`.** Même ordre et même numérotation que `album.buildAlbum`, en réutilisant `numberBank` et `numberFromTitle`.
- [ ] **Step 4 : lancer le test, puis `scripts/test-album*.js` s'il existe.** Tout doit passer.
- [ ] **Step 5 : commiter.** `git add src/cardIndex.js src/album.js scripts/test-card-index.js`

### Task 2 : cœur des échanges, demande à une personne (`src/trades.js`)

**Files :**
- Create : `src/trades.js`
- Modify : `src/resale.js` (soustraire les cartes réservées dans `sellable`)
- Test : `scripts/test-trades.js`

**Interfaces :**
- Consumes : `cardIndex.byCode`, `cardIndex.codeOf` ; `resale.lockedByDecks`, `resale.PRICES` ; `credits.spend/addCredit/getBalance` ; `collections.getCount/getCollection/removeCards/addCards` ; `broadcast.isSubscribed` ; `weekend.pauseFor` ; `raid.raidsAgainst` ; `farm.getPenaltyRemaining`.
- Produces (toutes les fonctions prennent `now = Date.now()` en dernier paramètre) :
  - `TRADES_PATH`, `REQUEST_MS = 3600000`, `AUCTION_MS = 43200000`.
  - `floor(rarity): number`.
  - `blockReason(userId, now): null | 'not_subscribed' | 'pause' | 'raid' | 'farm'`.
  - `reservedCounts(userId): Map<url, n>`. Ce sont les cartes proposées dans les demandes ouvertes de l'acheteur, plus la carte d'une enchère ouverte du vendeur.
  - `cessible(userId): Map<url, n>`, calculé comme `count − deckLocks − reserved`. Le dernier exemplaire **est** cessible.
  - `createDirect({ buyer, seller, code, jp, cards: [url], now }) → { ok: true, trade } | { ok: false, error }`. Erreurs possibles : `self`, `blocked_buyer`, `blocked_seller`, `unavailable`, `cards_unavailable`, `floor`, `empty`, `balance`.
  - `accept(tradeId, sellerId, now) → { ok, trade, error? }` ; `refuse(tradeId, sellerId, now)`.
  - `getTrade(id)` ; `openTradesOf(userId)` (en tant qu'acheteur, vendeur ou enchérisseur).
- Forme d'un échange dans `data/trades.json` :
  ```
  { seq, trades: { [id]: { id, kind, buyer, seller, card: { url, title, rarity, code },
    offer: { jp, cards: [url] }, status: 'open'|'done'|'refused'|'expired'|'cancelled',
    createdAt, expiresAt, counters: {}, bids: [], dms: {}, closedAt, reason } } }
  ```

- [ ] **Step 1 : écrire le test qui échoue.** Avec une horloge simulée un mardi 10 h, deux joueurs inscrits A et B. B possède 1 `HW1` et 3 communes, dont 1 placée dans un deck. Assertions :
  - `cessible(B)` contient `HW1` = 1 (le dernier exemplaire est cessible) et la commune du deck = 2 ;
  - `createDirect` avec `jp: 9` sur `HW1` → `floor` ; avec `jp: 10` → ok, le solde de A baisse de 10 et une ligne `trade_hold` apparaît ;
  - une offre carte contre carte sans JP$ (`jp: 0`, une commune de A) → ok, sans contrôle de plancher ;
  - A non inscrit → `blocked_buyer` ; B en congés → `blocked_seller` ; A demande sa propre carte → `self` ;
  - pendant l'offre, la commune proposée par A n'est plus dans `cessible(A)` ni dans `resale.sellable(A)` ;
  - `accept` : `HW1` passe chez A, B reçoit 10 JP$ (`trade_sale`), le statut vaut `done` ; un 2ᵉ `accept` → `{ ok: false, error: 'closed' }` ;
  - `refuse` : A est remboursé (`trade_refund`), statut `refused` ;
  - si B a perdu `HW1` avant d'accepter, `accept` → `unavailable`, A est remboursé et le statut vaut `cancelled`.
- [ ] **Step 2 : lancer le test.** Il doit échouer.
- [ ] **Step 3 : écrire `src/trades.js` et modifier `resale.sellable`.** Dans `sellable`, soustraire `trades.reservedCounts(userId)`. L'import est paresseux (`require` dans la fonction), pour éviter un cycle. Règle : chaque fonction qui modifie l'état fait lecture, contrôles, mouvements de crédits/cartes et écriture **sans aucun `await`**.
- [ ] **Step 4 : lancer `test-trades.js` et `test-resale.js`.** Les deux doivent passer.
- [ ] **Step 5 : commiter.**

### Task 3 : demande générale et contre-offres

**Files :**
- Modify : `src/trades.js`
- Test : `scripts/test-trades.js` (nouvelle section)

**Interfaces :**
- Produces :
  - `createGeneral({ buyer, code, jp, cards, now }) → { ok, trade, recipients: [userId] }`. Les destinataires sont les inscrits non bloqués, autres que l'acheteur, pour qui `cessible(u).get(url) ≥ 1`. Erreur `no_owner` si la liste est vide.
  - `counter(tradeId, sellerId, { jp, cards }, now) → { ok, trade, error? }`. La contre-offre **remplace entièrement** ce que l'acheteur donne (JP$ et cartes) : le vendeur peut ainsi retirer des cartes proposées ou en réclamer d'autres. À l'acceptation, les cartes de l'offre d'origine qui ne figurent plus dans la contre-offre sont libérées. Une seule contre-offre par vendeur (sinon `already_countered`). Les cartes doivent être cessibles **chez l'acheteur**. La contre-offre est stockée dans `trade.counters[sellerId] = { jp, cards, at, expiresAt: now + REQUEST_MS, status: 'open' }`.
  - `acceptCounter(tradeId, buyerId, sellerId, now) → { ok, trade, error? }`. Le complément `jp − offer.jp` est débité (`trade_hold`) au moment de l'acceptation, ou rendu s'il est négatif. Erreurs : `balance`, `cards_unavailable`, `unavailable`.
  - `refuseCounter(tradeId, buyerId, sellerId, now)`.
  - `accept(tradeId, sellerId)` accepte aussi une demande générale, pour tout propriétaire éligible.

- [ ] **Step 1 : écrire les tests qui échouent.**
  - Demande générale `HW1` alors que B et C l'ont et que D ne l'a pas : `recipients` = [B, C].
  - B accepte, puis C accepte → `closed`.
  - B fait une contre-offre (`jp: 30`) pendant que C accepte l'offre d'origine : l'échange se conclut avec C et la contre-offre de B passe à `cancelled`.
  - Une contre-offre relance 1 h pour cette paire seulement : `expiresAt` de la demande est inchangé.
  - Une contre-offre réclame une carte de A ; A la perd ; `acceptCounter` → `cards_unavailable`, sans aucun mouvement de crédits.
  - Le solde de A est insuffisant pour le complément → `balance`, aucun débit partiel.
  - Deuxième contre-offre du même vendeur → `already_countered`.
- [ ] **Step 2 : lancer les tests.** Ils doivent échouer.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : lancer les tests.** Ils doivent passer.
- [ ] **Step 5 : commiter.**

### Task 4 : enchères

**Files :**
- Modify : `src/trades.js`
- Test : `scripts/test-trades.js` (nouvelle section)

**Interfaces :**
- Produces :
  - `auctionEnd(start: number): number`. Calcule `start + AUCTION_MS`. Si l'heure de Paris tombe à 20 h ou plus, ou avant 9 h, on passe au prochain 10 h 00, heure de Paris.
  - `createAuction({ seller, code, startPrice, now }) → { ok, trade, recipients }`. Erreurs : `unavailable`, `floor`, `blocked_seller`, `ends_in_pause` (quand `weekend.isPausedDay(parisDay(auctionEnd(now)))`). `kind: 'auction'`, `seller`, `startPrice`, `endsAt`. Les destinataires sont tous les inscrits sauf le vendeur.
  - `bid(tradeId, userId, jp, now) → { ok, trade, outbid: userId | null, error? }`. Montant minimum : `startPrice` pour la 1ʳᵉ enchère, sinon meilleure enchère + 1. Le montant est débité (`trade_hold`), et l'enchérisseur précédent est remboursé (`trade_refund`). Erreurs : `self`, `already_best`, `too_low`, `balance`, `blocked`, `ended`.
  - `settleAuction(tradeId, now) → { ok, trade, outcome: 'sold'|'no_bid'|'cancelled' }`. Ne fait rien avant `endsAt` ni pendant `weekend.isPaused(now)`.

- [ ] **Step 1 : écrire les tests qui échouent.**
  - Fins calculées par `auctionEnd` :
    - lancement le mardi 9 h → fin mardi 21 h, repoussée au mercredi 10 h ;
    - lancement le mardi 7 h 30 → fin 19 h 30, sans changement ;
    - lancement le vendredi 11 h → fin repoussée au samedi 10 h, donc `ends_in_pause`.
  - Plancher : prix de départ 4 sur une épique → `floor`.
  - B enchérit 10, C 11 : B est remboursé et `outbid` vaut B. C enchérit encore alors qu'il est déjà le meilleur → `already_best`. Une enchère à 11 → `too_low`.
  - Le vendeur enchérit sur sa propre carte → `self`.
  - Pendant l'enchère, la carte n'est ni dans `cessible(vendeur)` ni dans `resale.sellable`.
  - Le règlement après `endsAt` donne `sold` : la carte va à C et le vendeur reçoit 11 (`trade_sale`). Un 2ᵉ règlement → `closed`.
  - Sans enchère → `no_bid` : la carte reste au vendeur.
- [ ] **Step 2 : lancer les tests.** Ils doivent échouer.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : lancer les tests.** Ils doivent passer.
- [ ] **Step 5 : commiter.**

### Task 5 : minuterie, cohérence et désinscription

**Files :**
- Modify : `src/trades.js`
- Test : `scripts/test-trades.js` (nouvelle section)

**Interfaces :**
- Produces :
  - `tick(now) → Array<{ trade, event: 'expired'|'counter_expired'|'settled'|'cancelled', reason? }>`. C'est une fonction pure, sans Slack, qui fait dans l'ordre :
    1. annule tout échange dont une carte réservée n'est plus possédée (`reason: 'card_lost'`) et rembourse ;
    2. pendant une pause globale, ou une pause de l'une des parties, annule les demandes (pas les enchères) ouvertes (`reason: 'pause'`) ;
    3. fait expirer les contre-offres puis les demandes dépassées. Une demande reste ouverte tant qu'une contre-offre ouverte a un `expiresAt` plus tardif ;
    4. règle les enchères arrivées à échéance.
  - `onUnsubscribe(userId, now) → events (même forme)`. Annule ses demandes en tant qu'acheteur, les demandes directes qui le visent et ses contre-offres. Ses enchères et ses mises restent valables.

- [ ] **Step 1 : écrire les tests qui échouent.**
  - Une demande sans réponse pendant 1 h 00 min 01 s → `expired`, remboursée.
  - Une demande avec contre-offre ouverte plus tardive reste ouverte au premier `tick`, puis expire après la contre-offre.
  - Une carte proposée par A, volée (simulé par `collections.removeCards`) → `cancelled/card_lost`, remboursement.
  - Une carte mise aux enchères, volée → enchère `cancelled`, meilleur enchérisseur remboursé.
  - Une demande créée le vendredi à 23 h 30, puis `tick` le samedi à 0 h 01 → `cancelled/pause`.
  - Deux `tick` successifs au même instant → le 2ᵉ ne renvoie rien (idempotent).
  - `onUnsubscribe(A)` → ses demandes sont annulées et remboursées, son enchère sur la carte de C reste.
- [ ] **Step 2 : lancer les tests.** Ils doivent échouer.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : lancer les tests.** Ils doivent passer.
- [ ] **Step 5 : commiter.**

### Task 6 : les cartes réservées hors des decks

**Files :**
- Modify : `src/game/arenaWeb.js:112` (les comptes `owned` envoyés à l'éditeur de deck) et l'endroit où le deck est enregistré (`arenaStore` / `matches.js:128` `validateDeck`)
- Test : `scripts/test-arena-deck.js` (ajouter un cas)

**Interfaces :**
- Consumes : `trades.reservedCounts(userId)`.

- [ ] **Step 1 : écrire le test qui échoue.** Un joueur possède ×2 `C`, dont 1 réservée par une enchère. L'éditeur de deck affiche `C` ×1, et l'enregistrement d'un deck qui utilise `C` deux fois est refusé.
- [ ] **Step 2 : lancer le test.** Il doit échouer.
- [ ] **Step 3 : soustraire `reservedCounts` de la collection** passée à l'éditeur et à `validateDeck` lors de l'enregistrement. On ne touche pas à `resolveDeck` en combat : après un transfert, le deck se complète déjà tout seul.
- [ ] **Step 4 : lancer `test-arena-deck.js` et `test-arena-web.js`.** Les deux doivent passer.
- [ ] **Step 5 : commiter.**

### Task 7 : Slack, Accueil, demandes et contre-offres (`src/tradesSlack.js`)

**Files :**
- Create : `src/tradesSlack.js`
- Modify : `src/home.js` (insérer `tradesSlack.buildTradeBlocks(userId)` juste après le bloc revente) ; `src/app.js` (appeler `tradesSlack.register(app, ctx)` à côté de `bugsSlack.register`, et `tradesSlack.onUnsubscribe(client, userId)` après `broadcast.unsubscribe`, ligne ~1542)
- Test : `scripts/test-trades-slack.js` (faux Slack, modèle `test-raid.js`)

**Interfaces :**
- Consumes : tout `trades.*` ; `ctx = { sendDM, openModal, refreshHome }`, avec la même forme que `bugsSlack.register`.
- Produces :
  - fonctions de construction pures : `buildTradeBlocks(userId, now)`, `buildDirectModal(buyer, seller?)`, `buildGeneralModal(buyer)`, `buildCounterModal(trade, sellerId)`, `buildSellerDM(trade, sellerId)`, `buildBuyerResultDM(trade, event)`.
  - identifiants d'action : `trade_direct_open`, `trade_direct_seller` (choix du joueur, `dispatch_action` puis `views.update`), `trade_direct_submit`, `trade_general_open`, `trade_general_submit`, `trade_accept`, `trade_refuse`, `trade_counter_open`, `trade_counter_submit`, `trade_counter_accept`, `trade_counter_refuse`. La `value` d'un bouton vaut `tradeId` ou `tradeId|sellerId`.
  - `register(app, ctx)` ; `onUnsubscribe(client, userId)`.

Choix d'interface (Slack limite un menu à 100 options) :
- **Liste des numéros chez le vendeur.** Un bloc texte affiche tous les codes : en gras s'ils sont disponibles, ~barrés~ s'ils ne le sont pas. C'est la « liste des numéros » voulue par Paul. En dessous, un `static_select` propose seulement les codes disponibles, groupés par rareté (`option_groups`). S'il y en a plus de 100, on affiche à la place un champ texte validé avec `cardIndex.byCode`.
- **Offre.** Un `number_input` entier pour les JP$, et un `multi_static_select` des cartes cessibles de l'acheteur (même repli au-delà de 100 options).
- **Non inscrit.** `buildTradeBlocks` affiche seulement une invitation à taper `/jeanpip`.
- **Mes échanges en cours.** Au plus 10 lignes, avec leur heure de fin.

- [ ] **Step 1 : écrire le test qui échoue.**
  - L'Accueil d'un non-inscrit ne contient aucun bouton `trade_*` ; celui d'un inscrit en contient trois.
  - La modale directe de A vers B montre `HW1` disponible et `HW2` barré.
  - Une soumission sous le plancher renvoie une erreur sur le champ (`response_action: 'errors'`).
  - Une soumission valide envoie un DM à B avec 3 boutons.
  - `trade_accept` → DM de résultat à A, le DM de B est mis à jour (`chat.update`), et les Accueils sont rafraîchis.
  - Demande générale : DM seulement aux propriétaires inscrits. Après l'acceptation de B, le DM de C est mis à jour en « déjà conclue ».
  - Contre-offre : le DM de A contient `trade_counter_accept`.
  - Un samedi : aucun DM n'est envoyé, et les boutons répondent par le texte de pause.
- [ ] **Step 2 : lancer le test.** Il doit échouer.
- [ ] **Step 3 : implémenter.** Erreurs de `trades.*` → textes joueur (une table `ERROR_TEXT` dans `tradesSlack.js`). Les références des DM sont gardées dans `trade.dms[userId] = { channel, ts }`, à ajouter dans `trades.js` avec `setDm(id, userId, ref)`.
- [ ] **Step 4 : lancer `test-trades-slack.js`, `test-resale.js` et `test-raid.js`.** Tous doivent passer.
- [ ] **Step 5 : commiter.**

### Task 8 : Slack, enchères, minuterie et version 3.9

**Files :**
- Modify : `src/tradesSlack.js`, `src/app.js` (minuterie), `src/releases.js`, `package.json`
- Test : `scripts/test-trades-slack.js` (nouvelle section), `scripts/test-releases.js`, `scripts/test-ledger-sources.js`

**Interfaces :**
- Produces :
  - `buildAuctionModal(seller)`, `buildAuctionDM(trade)` (avec `image` = `cardThumbUrl` de la carte, prix actuel, fin, bouton `trade_bid_open`), `buildBidModal(trade)`.
  - Actions : `trade_auction_open`, `trade_auction_submit`, `trade_bid_open`, `trade_bid_submit`.
  - `runTick(client, logger)`. Il appelle `trades.tick(Date.now())`, envoie les DM liés à chaque événement, met à jour les DM ouverts et rafraîchit les Accueils. Dans `app.js` : `tradeTick()` au démarrage, puis `setInterval(tradeTick, 10 * 1000)`, comme `raidTick`.

- [ ] **Step 1 : écrire les tests qui échouent.**
  - Lancer une enchère envoie un DM avec image à chaque inscrit sauf le vendeur, et à aucun non-inscrit.
  - Être dépassé envoie un DM au précédent meilleur enchérisseur.
  - `runTick` après la fin envoie un DM au vendeur et au gagnant, et la carte change de main.
  - `runTick` relancé ne fait rien.
  - `test-ledger-sources.js` connaît `trade_hold`, `trade_refund` et `trade_sale`.
- [ ] **Step 2 : lancer les tests.** Ils doivent échouer.
- [ ] **Step 3 : implémenter, enregistrer `events.record('trade_done', buyer, { tradeId, kind, card, jp, cards, seller })` à chaque échange conclu (tâches 7 et 8), puis ajouter l'entrée 3.9.0 de `releases.js`** (titre « Échanges et enchères entre joueurs », 4 à 6 lignes pour les joueurs, qui reprennent les trois façons d'échanger, la contre-offre, la règle des inscrits, la durée d'1 h et celle de 12 h). Ensuite, lancer `npm version 3.9.0 --no-git-tag-version`.
- [ ] **Step 4 : lancer tous les `scripts/test-trade*.js`, `test-releases.js`, `test-ledger-sources.js`, `test-resale.js`, `test-raid.js` et `test-weekend.js`.** Tous doivent passer.
- [ ] **Step 5 : commiter.**

## Hors plan (à faire après relecture de Paul)

- Pousser la branche et ouvrir la PR, seulement avec l'accord de Paul.
- Déployer sur la VM. Les v3.7 et v3.8 ne sont peut-être pas encore déployées : vérifier la version en production d'abord.
- La salle des ventes de la ville Jeanpip : un autre projet.
