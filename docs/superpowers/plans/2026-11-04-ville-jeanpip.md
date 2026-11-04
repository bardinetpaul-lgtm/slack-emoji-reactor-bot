# Ville Jeanpip (v4.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une page web 3D « ville Jeanpip » servie par le bot, ouverte depuis l'Accueil Slack, où chaque bâtiment mène à une fonction du jeu, avec la vie du jeu (combat en cours, promeneurs JP$, maisons des inscrits) et deux nouvelles pages web : Boutique (achat de boosters) et Banque (revente).

**Architecture:** Nouvelles routes branchées dans `src/web.js` comme `scratchWeb`/`tvWeb` (modules `configure(ctx)` + `route(req,res,url)`), un seul jeton personnel `ville|<userId>` pour la ville, la Boutique et la Banque. La logique d'achat et de revente est sortie de `src/app.js` dans des fonctions partagées Slack/web. Le front 3D est en Three.js r160 servi depuis `public/vendor/`, modèles Kenney CC0 dans `public/assets/ville/`. Le direct passe par SSE, sur le modèle de JP TV.

**Tech Stack:** Node.js (module `http` natif), better-sqlite3 (déjà là), Three.js 0.160.0 (ES modules, vendorisé), Slack Bolt.

**Spec:** `docs/superpowers/specs/2026-11-04-ville-jeanpip-design.md`. Lisez-la en entier avant votre tâche.

## Global Constraints

- Tests = scripts Node autonomes (`scripts/test-*.js`, `check(label, cond)`, sortie ❌ = échec, `process.exit(1)` si échec). Lancer avec `npx -y -p node@20 node scripts/<test>.js` (Node 24 ne charge pas better-sqlite3).
- Chaque test serveur travaille dans une **copie temporaire** du projet (voir `scripts/test-tv-web.js` lignes 1-40). Il ne touche jamais `data/` du dépôt.
- Toutes les routes et tous les liens dans les pages sont **relatifs** (préfixe `/jeanpip/` du proxy).
- Jeton : `<userId>.<hmac>`, `hmac = HMAC-SHA256(secret, "ville|<userId>")`, comparaison `timingSafeEqual`.
- Pas de CDN en production. Three.js et les modèles sont servis depuis `public/`.
- Textes joueurs en français, vouvoiement interdit (le jeu tutoie : « ton solde »), sans jargon.
- **Aucun commit, aucun push** : l'utilisateur valide d'abord. Ne pas toucher aux fichiers d'une autre tâche (liste « Files » de chaque tâche).
- Pas de `npm install` : `node_modules` est une jonction partagée avec un autre worktree.
- Pauses : `weekend.pauseFor(userId, now)` → ville visible, actions de Boutique et Banque refusées avec le texte de Slack.

## Review Focus

1. **Achat web d'un booster à stock en rafale ou par script** → même escalade `boosterSpam` que Slack, aucun JP$ débité, jamais au-delà du stock (aucun `await` entre `purchaseBlock` et `createPending`). Test dans la Tâche 1.
2. **Jeton absent, faux ou d'un autre joueur** sur chaque route `/api/ville*`, `/api/boutique*`, `/api/banque*` → 403 JSON, rien n'est modifié. Tests dans les Tâches 1, 2 et 3.
3. **Joueur non inscrit qui gagne des JP$** → le promeneur part de la place Dimsi (`fromHouse:false`), aucune maison n'est créée. Test dans la Tâche 2.
4. **Revente pendant un raid subi ou une pause, ou quantité supérieure aux doublons** → refus avec le même message que la fenêtre Slack, cartes et JP$ inchangés. Test dans la Tâche 3.
5. **Navigateur sans WebGL ou portable lent** → message et liens simples vers chaque page ; au-delà de 15 promeneurs, les plus anciens rentrent. Test dans la Tâche 4.

---

### Task 0: Socle commun (fait par le coordinateur avant les tâches parallèles)

**Files:**
- Create: `src/villeToken.js`, `src/cityBus.js`, `src/villeWeb.js` (stub), `src/boutiqueWeb.js` (stub), `src/banqueWeb.js` (stub)
- Create: `public/vendor/three/three.module.js`, `public/vendor/three/addons/controls/OrbitControls.js`, `public/vendor/three/addons/loaders/GLTFLoader.js`, `public/vendor/three/addons/utils/BufferGeometryUtils.js`, `public/vendor/three/LICENSE`
- Modify: `src/web.js` (require + `configure` + `route` des trois modules ; `buildVilleUrl` exporté ; `.mjs`/`.glb` dans `STATIC_TYPES`)
- Modify: `src/app.js` (émission `cityBus` sur gain de réaction ; hooks passés à `startWebServer`)
- Test: `scripts/test-ville-token.js`

**Interfaces (Produces):**
- `villeToken.sign(userId) -> string` (hex) ; `villeToken.read(token) -> userId|null` ; `villeToken.query(userId) -> "t=<encoded>"`. Il utilise `configure({ getSecret })`, appelé par web.js.
- `cityBus` : `EventEmitter` partagé. Événement `'jp'` avec la charge `{ userId, amount, at }`, émis dans `app.js` juste après `credits.addCredit(reactingUserId, …, { source: 'reaction' … })`.
- Chaque module `villeWeb` / `boutiqueWeb` / `banqueWeb` exporte `configure(ctx)` et `route(req, res, url) -> Promise<boolean>`.
  `ctx = { publicUrl, getSecret, send, sendJson, servePage, userProfile, client, logger, hooks, buildUrls }`, avec :
  - `hooks.onBoosterBought(userId, result)` : `app.js` envoie le DM d'achat (`sendBoosterDM`) et rafraîchit l'Accueil, ou tous les Accueils si le stock est épuisé ;
  - `hooks.onResold(userId, result)` : `app.js` envoie le DM de revente et rafraîchit l'Accueil ;
  - `buildUrls(userId)` renvoie `{ museum, kiosk, deck, boutique, banque, ville, tv }`, des URL relatives à la racine web. `tv` est la page JP TV ; `arena` est absent (il est par combat, voir Tâche 2).
- `web.buildVilleUrl(userId) -> string|null`.
- Lecture du corps JSON des POST : `ctx.readJson(req) -> Promise<object>`, avec une limite de 10 Ko et `{}` si le corps est vide ou invalide.

- [ ] Step 1 : écrire `scripts/test-ville-token.js`. Assertions : `read(sign-based token)` renvoie l'id ; le jeton d'un autre utilisateur, un hex tronqué ou un jeton `tickets|` renvoient `null`.
- [ ] Step 2 : implémenter les modules, les stubs (`route` → `false`) et le câblage. Vendoriser Three.js 0.160.0 par `npm pack three@0.160.0` dans le dossier de travail temporaire, puis copier les fichiers listés.
- [ ] Step 3 : lancer `test-ville-token.js`, `test-web-open.js`, `test-tv-web.js` et `test-tickets*` existants. Résultat attendu : tous ✅.

---

### Task 1: Boutique web (achat partagé Slack/web + anti-robot web)

**Files:**
- Create: `src/boosterPurchase.js`, `src/purchaseNonce.js`, `public/boutique.html`, `public/boutique.css`, `public/boutique.js`
- Modify: `src/boutiqueWeb.js` (remplace le stub), `src/app.js` : **uniquement** le gestionnaire `app.action(/^buy_booster_/…)` et le corps du hook `onBoosterBought`
- Test: `scripts/test-booster-purchase.js`, `scripts/test-boutique-web.js` ; `scripts/test-app-booster.js` et `scripts/test-booster-anti-bot.js` doivent rester verts

**Interfaces:**
- Consumes : Task 0 (`ctx`, `villeToken`, `hooks.onBoosterBought`).
- Produces : `purchaseBooster(userId, type, { channel: 'slack'|'web'|'dm', now = Date.now() }) -> result`, avec `result.status` parmi :
  - `'unknown'` ;
  - `'wrong_channel'` : booster à stock et `channel === 'dm'` ;
  - `'spam_ignore'` `{ verdict }` ;
  - `'spam_lock'` `{ verdict }` ;
  - `'blocked'` `{ blocked, ban? }` ;
  - `'insufficient'` `{ balance, missing }` ;
  - `'bought'` `{ id, booster, balance, soldOut }`.

  La fonction enregistre les mêmes `events.record` qu'aujourd'hui, en ajoutant `channel` aux métadonnées de `booster_click` et `booster_bought`.
- `purchaseNonce.issue(userId, now) -> { value, issuedAt }` ; `purchaseNonce.consume(userId, value, now) -> 'ok'|'invalid'|'expired'|'too_fast'`, avec `TTL_MS = 120000` et `MIN_DELAY_MS = 1000`. Un jeton ne sert qu'une fois.
- Routes :
  - `GET /boutique?t=` : la page ;
  - `GET /api/boutique?t=` renvoie `{ ok, balance, pause, boosters:[{ type, label, emoji, price, buttonLabel, block, blockText, stockLeft|null }], nonce }` ; au-delà d'une requête par seconde et par joueur, réponse 429 `{ ok:false, reason:'slow_down' }` ;
  - `POST /api/boutique/buy?t=`, corps `{ type, nonce }`, renvoie `{ ok:true, openUrl, balance }` ou `{ ok:false, reason, text }`.

  `too_fast` est traité comme un clic : `boosterSpam.click`, puis l'escalade normale. `openUrl` vaut `open/<id>?t=<signToken(id,userId)>` (chemin relatif).

- [ ] Step 1 : écrire les tests.
  - `test-booster-purchase.js` : solde insuffisant → `insufficient`, solde inchangé ; booster à stock via `dm` → `wrong_channel` ; via `web` → `bought` ; stock de 1 et deux achats → le second est `blocked:'sold_out'` ; 4 clics en 1 s → `spam_lock`.
  - `test-boutique-web.js` : 403 sans jeton ; achat sans nonce → `invalid` ; nonce consommé moins d'1 s après → `too_fast` ; nonce rejoué → `invalid` ; achat valide → `openUrl` qui commence par `open/` et hook appelé une fois ; pendant `pauseFor` → `ok:false` avec le texte de pause.
- [ ] Step 2 : lancer les tests. Résultat attendu : FAIL (modules absents).
- [ ] Step 3 : extraire la logique de `buy_booster_` dans `purchaseBooster`. `app.js` ne fait plus que traduire le `status` en DM, **avec les textes actuels à l'identique**. Le canal vaut `'slack'` si `body.view.type === 'home'`, sinon `'dm'`.
- [ ] Step 4 : écrire `boutiqueWeb.js` et la page. La page est dans le style des tickets (`public/tickets.*`). Après un achat, elle redirige vers `openUrl`. Elle a un lien « ← Retour à la ville » (`ville?t=`).
- [ ] Step 5 : lancer les quatre tests. Résultat attendu : tous ✅.

---

### Task 2: API de la ville (état, direct, maisons, carte de visite, avatars)

**Files:**
- Modify: `src/villeWeb.js` (remplace le stub)
- Create: `src/villePlots.js` (parcelles stables, fichier `data/ville.json` écrit avec `writeJsonAtomic`)
- Test: `scripts/test-ville-web.js`

**Interfaces:**
- Consumes : Task 0 (`ctx`, `cityBus`, `buildUrls`), `broadcast` (inscrits), `arenaStore.ranking`, `matches.listForTv`, `tvFeed.pickFeatured`, `collections.getCollection`, `releases.current()`, `weekend.pauseFor`, `credits.getBalance`.
- Produces (contrat que la Tâche 4 consomme **à l'identique**) :
  - `villePlots.plotOf(userId) -> number` : la parcelle est attribuée à la première demande, puis ne change plus ; un désinscrit garde la sienne s'il revient. `villePlots.list(userIds) -> [{ userId, plot }]`.
  - `GET /ville?t=` : `servePage('ville', ['ville.css'])`. La page charge ses modules elle-même.
  - `GET /api/ville?t=` renvoie :
    ```
    { ok, serverTime, me:{ userId, name, avatar, balance },
      pause: null|{ title },
      houses:[{ userId, name, avatar, plot }],
      arena:{ live:boolean, myMatchUrl:null|string, tvUrl:null|string },
      links:{ museum, kiosk, deck, boutique, banque },
      mairie:{ release:{ version, title, date, changes }, ranking:[{ userId, name, avatar, rank, wins, losses }] } }
    ```
    `myMatchUrl` est le lien de combat du joueur s'il en a un en cours (`buildArenaUrl`). `tvUrl` vaut `null` si rien n'est à l'antenne.
  - `GET /api/ville/stream?t=` (SSE) envoie :
    - `event: jp` `{ userId, name, avatar, amount, fromHouse }` ;
    - `event: arena` `{ live, tvUrl }`, seulement si l'état change, avec un contrôle toutes les 2 s ;
    - `event: house` `{ action:'add'|'remove', house }`, avec un contrôle des inscrits toutes les 30 s ;
    - un ping `: ping` toutes les 15 s.

    En-têtes comme `tvWeb` : `no-transform`, `X-Accel-Buffering: no`, `setNoDelay`. Il n'y a qu'**une** boucle serveur pour tous les flux.
  - `GET /api/ville/card/<userId>?t=` renvoie `{ ok, userId, name, avatar, rank|null, distinctCards, legendaries, streak, balance? }`. `balance` n'est présent que si `<userId>` est le joueur du jeton. `streak` est l'étape de série du jour (`dailyStreak` / `arenaStore`, 0 si elle est rompue).
  - `GET /api/ville/avatar/<userId>?t=` : photo Slack (`image_72`) téléchargée par le bot, gardée 1 h en mémoire et servie en `image/*`, ou 404.

- [ ] Step 1 : écrire `test-ville-web.js` (copie temporaire, vrai serveur). Assertions :
  - 403 sans jeton, ou avec un jeton `tickets|` ;
  - l'état renvoie `houses` = les inscrits seulement, avec des parcelles distinctes et stables après redémarrage du module ;
  - `cityBus.emit('jp', { userId: inscrit })` → l'événement `jp` arrive avec `fromHouse:true` ; pour un non-inscrit → `fromHouse:false` ;
  - la carte d'un autre joueur n'a pas de `balance`, la sienne en a une ;
  - l'état change à un combat diffusable lancé → `arena.live:true` ;
  - un joueur `tvOptOut` en combat → `live` reste `false`.
- [ ] Step 2 : lancer le test. Résultat attendu : FAIL.
- [ ] Step 3 : implémenter `villePlots.js` et `villeWeb.js`.
- [ ] Step 4 : lancer le test. Résultat attendu : tous ✅.

---

### Task 3: Banque web (revente partagée Slack/web)

**Files:**
- Modify: `src/resale.js` (ajout de `trySell`), `src/banqueWeb.js` (remplace le stub), `src/app.js` : **uniquement** `app.view('resale_submit'…)` et le corps du hook `onResold`
- Create: `public/banque.html`, `public/banque.css`, `public/banque.js`
- Test: `scripts/test-banque-web.js` ; `scripts/test-resale.js` doit rester vert

**Interfaces:**
- Produces : `resale.trySell(userId, wanted, now = Date.now()) -> res`. `res` vaut `{ ok:false, error:'pause', pause }`, ou `{ ok:false, error:'raid' }`, ou le retour actuel de `resale.sell` (`empty`/`too_many`/plafond/ok). Si `require('./raid')` dans `resale.js` crée un cycle, la vérification du raid reçoit une fonction injectée `isRaided(userId)`.
- Routes :
  - `GET /banque?t=` : la page ;
  - `GET /api/banque?t=` renvoie `{ ok, balance, pause, raided, order, labels, prices, available:{ <rarity>: n }, week:{ earned, cap, remaining } }` ; `available` utilise la même source que `buildResaleModal` ;
  - `POST /api/banque/sell?t=`, corps `{ wanted:{ <rarity>: n } }`, renvoie `{ ok:true, gained, sold, balance, remaining }` ou `{ ok:false, error, text }`. `text` est le texte exact de la fenêtre Slack.

- [ ] Step 1 : écrire `test-banque-web.js`. Assertions : 403 sans jeton ; pause → `error:'pause'`, rien ne bouge ; raid → `error:'raid'` ; trop de cartes → `too_many` ; revente valide → JP$ crédités, cartes retirées, hook appelé une fois.
- [ ] Step 2 : lancer le test. Résultat attendu : FAIL.
- [ ] Step 3 : implémenter `trySell`. `resale_submit` l'utilise et garde les textes actuels. Écrire `banqueWeb.js` et la page, dans le style des tickets, avec le lien « ← Retour à la ville ».
- [ ] Step 4 : lancer `test-banque-web.js` et `test-resale.js`. Résultat attendu : ✅.

---

### Task 4: Front 3D de la ville

**Files:**
- Create: `public/ville.html`, `public/ville.css`, `public/ville.js` (point d'entrée, module ES), `public/ville-logic.js` (logique pure, en UMD comme `arena-wire.js` : heure → lumière, parcelle → position, file des promeneurs), `public/ville-scene/*.js` (décor, bâtiments, maisons, promeneurs, étiquettes, panneaux)
- Create: `public/assets/ville/` (modèles Kenney `.glb` + `License.txt`)
- Create: `scripts/preview-ville.js` (serveur d'aperçu avec fausses données, comme `scripts/preview-tickets.js`), `scripts/test-ville-logic.js`

**Interfaces:**
- Consumes : le contrat JSON/SSE de la Tâche 2, **à l'identique**. Le jeton est lu dans `?t=` et ajouté à chaque appel. Three.js est importé depuis `vendor/three/three.module.js` avec une importmap relative.
- Produces : rien pour les autres tâches.

Exigences (spec §5.1-5.3, §5.4, §6, §7) :
- **Vue et commandes.** Vraie 3D, vue de haut inclinée, rotation, zoom et déplacement (OrbitControls), caméra bornée au-dessus du sol.
- **Décor.** Lorient : rade et port avec bateaux, base sous-marine de Keroman, locaux Dimsi au centre en place principale. Vie de rue : lampadaires, bancs, voitures, mouettes.
- **Bâtiments.** Chacun a une étiquette, réagit au survol et a sa destination (§5.2).
  - Arène : si `myMatchUrl` → lien direct ; sinon panneau « Regarder le combat » (si `tvUrl`) / « Mon deck ».
  - Salle des ventes : panneau « Bientôt ».
  - Mairie : panneau nouveautés + classement + « Retour à l'Accueil Slack » (`slack://open`).
  - Maisons : panneau carte de visite (`/api/ville/card`).
- **Navigation.** Tous les liens s'ouvrent dans le même onglet et ajoutent `v=<jeton ville>`, pour le retour (Tâche 5).
- **Combat en cours.** Projecteurs allumés, deux combattants animés, étiquette rouge.
- **Promeneurs.** Un par événement `jp`, avec la photo (`/api/ville/avatar`), le prénom et une bulle « +N JP$ ». Il part de la maison du joueur, ou de la place Dimsi si `fromHouse:false`. Il marche 30 à 60 s. Un nouveau gain du même joueur pendant sa promenade met la bulle à jour. Au maximum **15** promeneurs : au-delà, le plus ancien rentre.
- **Maisons.** Une par `houses[]`, placée à partir de `plot` (quartiers résidentiels, grille extensible), avec le prénom et la photo sur un panneau. Elles sont instanciées (InstancedMesh ou clones partagés).
- **Jour et nuit.** La lumière suit l'heure de Paris calculée à partir de `serverTime` ; la nuit, les fenêtres et les lampadaires sont allumés.
- **Repli.** Sans WebGL : message et liste de liens simples. Qualité adaptative : si on reste sous 30 images/s pendant 5 s, on coupe les ombres et on réduit les détails.
- **Modèles Kenney.** Les télécharger depuis kenney.nl (kits City/Suburban/Commercial/Industrial, CC0) dans le dossier de travail temporaire. **Noter le nom et la taille exacts dans le rapport.** Ne copier dans `public/assets/ville/` que le nécessaire (objectif < 10 Mo). Si le téléchargement échoue, construire en code et le dire.

- [ ] Step 1 : écrire `test-ville-logic.js`. Assertions :
  - `lightAt(hourParis)` : nuit à 23 h et 3 h (`night:true`), jour à 12 h ;
  - `plotPosition(n)` : 200 positions toutes distinctes et hors des emprises des bâtiments ;
  - file des promeneurs : 16 arrivées → 15 restants, le premier sorti ; même `userId` deux fois → un seul promeneur avec `amount` cumulé.
- [ ] Step 2 : lancer le test. Résultat attendu : FAIL.
- [ ] Step 3 : implémenter `ville-logic.js`, puis la scène et les panneaux.
- [ ] Step 4 : lancer `test-ville-logic.js` (✅). Lancer ensuite `preview-ville.js`, ouvrir la page, faire des captures de jour et de nuit, puis vérifier dans la console du navigateur qu'il n'y a aucune erreur.

---

### Task 5: Accueil, liens de retour, version 4.0

**Files:**
- Modify: `src/home.js` (bouton en tête), `src/app.js` : **uniquement** `buildHomeFor` (`villeUrl: web.buildVilleUrl(userId)`)
- Modify: `public/collection.js`, `public/tickets.js`, `public/deck.js` (+ leurs `.html` si besoin) : lien « ← Retour à la ville » si l'URL porte `v=`
- Modify: `src/releases.js` (entrée 4.0.0 en tête), `package.json` (`"version": "4.0.0"`)
- Test: `scripts/test-releases.js`, plus un cas ajouté dans le test existant de l'Accueil, s'il y en a un ; sinon un nouveau `scripts/test-home-ville.js`

**Interfaces:**
- Consumes : `web.buildVilleUrl` (Tâche 0).

- [ ] Step 1 : test. `buildHomeView(userId, { …, villeUrl:'https://x/ville?t=…' })` → le premier `section` après le solde contient un bouton `url` dont le texte est « 🏙️ Entrer dans la ville » ; sans `villeUrl`, aucun bouton ville.
- [ ] Step 2 : implémenter. Le bouton est placé juste sous le solde, **sans rien retirer** de l'Accueil. Le lien de retour est calculé par rapport à la page : `collection/<user>` → `../ville?t=<v>` ; `tickets` et `deck` → `ville?t=<v>`.
- [ ] Step 3 : écrire l'entrée de version 4.0.0 « La ville Jeanpip ». Elle est rédigée pour les joueurs : la ville, les maisons, la Boutique et la Banque sur le web, le Booster Octobre Rose achetable aussi dans la Boutique.
- [ ] Step 4 : lancer `test-releases.js` et le test de l'Accueil. Résultat attendu : ✅.

---

### Task 6: Vérification d'ensemble (coordinateur)

- [ ] Lancer **tous** les `scripts/test-*.js`. Résultat attendu : aucun ❌, et toute régression est corrigée.
- [ ] Lancer `preview-ville.js` et parcourir les clics : chaque bâtiment, Boutique → achat → ouverture animée, Banque → revente, retour à la ville.
- [ ] Faire relire la branche entière par un relecteur indépendant (superpowers:requesting-code-review).
