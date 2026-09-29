# 📊 Dashboard d'utilisation Jeanpip — Design (chantier 1)

Date : 2026-09-29 — statut : validé en conversation, en relecture

## 1. Pourquoi

Les stats sont le seul moyen de piloter le jeu dans la durée : savoir si l'économie
reste équilibrée (inflation / déflation), ce qui s'achète, si les joueurs reviennent,
quelles cartes font le jeu. Aujourd'hui le bot ne garde que l'**état courant**
(soldes, collections, compteurs cumulés) : impossible de situer quoi que ce soit dans
le temps, ni de savoir combien de crédits ont été créés ou dépensés.

## 2. Découpage

- **Chantier 1 (ce document)** : socle SQLite, journal d'événements, crédits migrés
  en SQLite avec un grand livre (ledger) transactionnel, rattrapage de l'historique,
  page `/stats` admin.
- **Chantier 2 (spec séparée, plus tard)** : migration des autres fichiers JSON
  (collections, boosters, arène, scores…) vers SQLite, un par un, derrière les mêmes
  fonctions. Hors périmètre ici.

## 3. Ce qui a été dit / ce qui est décidé

| Sujet | Décision |
|---|---|
| Stockage | SQLite (`better-sqlite3`, synchrone comme les accès fichiers actuels), fichier `data/jeanpip.db`, mode WAL |
| Crédits | Migrés en SQLite dès le chantier 1 : solde + mouvement écrits dans **une seule transaction** |
| Autres données | Restent en JSON ; on **journalise** en plus les événements dans SQLite |
| Accès | Admins seulement (`JEANPIP_ADMINS`), lien signé depuis le panneau 👑 Admin de l'Accueil |
| Graphiques | Agrégation côté serveur (SQL), rendu Chart.js **vendored** dans `public/` (pas de CDN) |
| Page | Page à part `/stats`, servie par le serveur web du bot existant |

Garde-fous prod : aucune règle du jeu ne change ; les API des modules restent
identiques ; aucun JSON n'est supprimé ; `data/jeanpip-stats.json` continue d'être
écrit (lu par le dashboard MagicDIMSI) ; retour arrière = redéployer le commit
précédent (voir §9).

## 4. Architecture

```
Actions du jeu (réaction, booster, arène, cadeau, admin…)
   │  credits.addCredit / spend / setBalance (API inchangée + arg optionnel `meta`)
   │  events.record(type, userId, data)
   ▼
src/db.js         ouvre data/jeanpip.db (WAL), applique les migrations de schéma au démarrage
src/credits.js    soldes + ledger en SQLite ; import auto de credits.json au 1er lancement
src/events.js     journal d'événements datés ; ne lève jamais (log + continue)
src/stats.js      requêtes d'agrégation pures (séries, classements, KPIs) — testables
src/statsWeb.js   routes GET /stats et /api/stats/* (auth admin signée)
public/stats.html, stats.js, stats.css, vendor/chart.umd.min.js
scripts/backfill-events.js   rattrapage idempotent de l'historique récupérable
```

Chaque unité a un rôle unique : `db.js` ne connaît pas le métier, `stats.js` ne fait
que lire, `statsWeb.js` ne fait que de l'HTTP + auth.

## 5. Modèle de données

```sql
CREATE TABLE schema_version (version INTEGER NOT NULL);

-- Soldes (remplace data/credits.json)
CREATE TABLE balances (
  user_id TEXT PRIMARY KEY,
  balance REAL NOT NULL DEFAULT 0 CHECK (balance >= 0)
);

-- Grand livre : un mouvement par variation de solde
CREATE TABLE credit_moves (
  id        INTEGER PRIMARY KEY,
  at        TEXT NOT NULL,          -- ISO UTC
  user_id   TEXT NOT NULL,
  amount    REAL NOT NULL,          -- signé : + créé, − consommé
  kind      TEXT NOT NULL,          -- 'earn' | 'spend' | 'adjust' | 'opening'
  source    TEXT NOT NULL,          -- voir tableau ci-dessous
  item      TEXT,                   -- article acheté (ex. 'rare', 'legendary')
  ref       TEXT                    -- id booster / match / etc.
);
CREATE INDEX credit_moves_at ON credit_moves(at);
CREATE INDEX credit_moves_user ON credit_moves(user_id, at);

-- Journal d'événements (hors crédits)
CREATE TABLE events (
  id      INTEGER PRIMARY KEY,
  at      TEXT NOT NULL,
  type    TEXT NOT NULL,
  user_id TEXT,
  data    TEXT,                     -- JSON
  dedup   TEXT UNIQUE               -- clé d'idempotence (rattrapage), NULL sinon
);
CREATE INDEX events_type_at ON events(type, at);
CREATE INDEX events_user ON events(user_id, at);
```

### 5.1 Sources des mouvements de crédits (état du code au 2026-09-29)

| Appel actuel | kind | source | item |
|---|---|---|---|
| `app.js` réaction :jeanpip: | earn | `reaction` | — |
| `weeklyGift.give` (crédits du vendredi reçus) | earn | `weekly_gift` | — |
| `settle.js` récompense de combat | earn | `arena_reward` | — |
| `admin.js` récompense auteur de média | earn | `media_author` | rareté |
| `admin.js` don admin (montant > 0) | earn | `admin_gift` | — |
| `admin.js` correction admin (`setBalance`) | adjust | `admin_adjust` | — (montant = écart signé) |
| `app.js` achat de booster | spend | `booster` | type (`common`/`rare`/`epic`) |
| `matches.js` carte mystère d'arène | spend | `arena_shop` | rareté (`epic`/`legendary`) |
| `app.js` Attaque Jeanpip payante | spend | `attack` | — |
| import initial de `credits.json` | opening | `migration` | — |

`addCredit(userId, amount, meta)` / `spend(userId, amount, meta)` /
`setBalance(userId, value, meta)` : `meta = { source, item?, ref? }`. Si `meta` est
absent, `source = 'unknown'` (le dashboard affiche cette ligne : tout nouvel appel
oublié devient visible au lieu de disparaître). Un nouvel article (nouveau booster)
apparaît automatiquement dans les stats sans code spécifique.

**Invariant** : pour tout joueur, `balance = SUM(credit_moves.amount)`. Vérifié par
les tests et affiché sur le dashboard (« écart ledger » doit valoir 0).

### 5.2 Types d'événements

| type | user_id | data | écrit par |
|---|---|---|---|
| `reaction` | réacteur | `{ channel }` | handler de réaction (spam exclu, comme les crédits) |
| `booster_bought` | acheteur | `{ boosterId, boosterType, price }` | achat |
| `booster_granted` | gagnant | `{ boosterId, boosterType, reason:'arena' }` | `settle.js` |
| `booster_opened` | owner | `{ boosterId, boosterType, via, cards:[{url,title,rarity}], score }` | `openOnce` |
| `card_discovered` | joueur | `{ url, title, rarity, via }` | `collections.addCards` quand count passe à 1 |
| `card_added` | admin/auteur | `{ url, title, rarity }` | `media.addMedia` |
| `match_finished` | — | `{ matchId, players:[{userId, deck:[{url,rarity,rented}] , outcome}], result:'win'|'draw'|'cancelled', loot }` | `settle.js` (+ annulations dans `matches.js`) |

`score` d'un booster = somme des poids par rareté : commun 1, rare 3, épique 8,
légendaire 20. Sert au « meilleur booster ouvert ».

## 6. Migration et rattrapage

**Au démarrage** (`db.js` puis `credits.js`) :
1. Crée le schéma si absent (migrations versionnées).
2. Si `balances` est vide et que `data/credits.json` existe : importe chaque solde
   + un mouvement `opening/migration` daté de l'instant d'import, dans une seule
   transaction. `credits.json` est **laissé intact** (ni renommé, ni supprimé)
   et n'est plus écrit ensuite.

**Rattrapage** (`scripts/backfill-events.js`, idempotent via `events.dedup`, lancé
une fois au déploiement, relançable sans doublon) :

| Source | Événements recréés | Fidélité |
|---|---|---|
| `boosters.json` | `booster_bought` (createdAt), `booster_opened` (openedAt, cards) | complète |
| `collections.json` | `card_discovered` (firstAt par carte et joueur) | complète |
| `collections.json` | `card_added` = plus ancien firstAt de chaque carte | approximative (date de 1re apparition) |
| `arena.json` history | `match_finished` sans decks | 1000 derniers combats, sans cartes jouées |
| réactions, crédits | — | non récupérable : suivi démarre au déploiement |

La page affiche « suivi depuis le JJ/MM » sur les courbes concernées (date du
mouvement `opening`, du premier `reaction`, du premier `match_finished` avec decks).

## 7. Page `/stats`

### 7.1 Accès
- Bouton « 📊 Stats » dans le panneau 👑 Admin de l'Accueil → URL signée HMAC
  (même secret que les autres liens) contenant `userId` + expiration **24 h**.
- Chaque requête `/api/stats/*` revérifie la signature, l'expiration **et** que le
  `userId` est toujours dans `JEANPIP_ADMINS`. Sinon 403.

### 7.2 Filtres (barre fixe, reflétés dans l'URL)
Période (7 j / 30 j / 90 j / tout / dates libres), granularité (jour / semaine /
mois, fuseau Europe/Paris), joueur (tous ou un), comparaison automatique avec la
période précédente de même durée (▲/▼ %). Filtre additionnel source/article sur le
bloc Économie.

### 7.3 Blocs

1. **💰 Économie**
   - KPIs : masse en circulation, moyenne et médiane par joueur (joueurs avec solde > 0),
     créés, consommés, flux net (créés − consommés), taux d'inflation
     `(masse fin − masse début) / masse début`, taux de dépense
     `consommés / masse moyenne`, pouvoir d'achat `masse moyenne par joueur / prix du booster commun`,
     écart ledger (doit être 0).
   - Courbes : masse en circulation (cumul du ledger) ; créés vs consommés en
     barres + flux net en ligne ; moyenne et médiane par joueur ; répartition créés par
     source ; répartition consommés par usage.
2. **🛒 Achats** : classement des articles (nb d'achats et crédits dépensés), part
   par famille (booster / arena_shop / attack), courbe par article, nb d'acheteurs
   distincts par article.
3. **🎁 Boosters** : achetés, gagnés, ouverts, stock non ouvert ; ouvertures par type
   dans le temps ; meilleur booster ouvert (joueur, date, cartes) ; top 5 de la période.
4. **🃏 Cartes** : total catalogue et total d'exemplaires possédés ; courbe des
   cartes ajoutées au catalogue et des cartes découvertes ; tableau cartes découvertes
   par joueur (+ % du catalogue) ; moyenne et médiane par joueur dans le temps ;
   répartition des découvertes par rareté.
5. **⚔️ Arène** : combats dans le temps (victoires / nuls / annulations) ; top 10
   des cartes les plus jouées (présence dans les decks joués) avec taux de victoire ;
   joueurs les plus actifs ; crédits gagnés et dépensés en arène.
6. **😀 Activité** : réactions dans le temps ; **joueurs actifs** par période (au moins
   une action : réaction, achat, ouverture, combat) — indicateur de rétention ; top
   réacteurs.

### 7.4 API
`GET /api/stats/<bloc>?from=&to=&grain=&user=&t=` → JSON `{ kpis, series, tables, since }`
pour `economy`, `purchases`, `boosters`, `cards`, `arena`, `activity`, plus
`GET /api/stats/players` (liste pour le filtre). Toutes les agrégations dans
`stats.js` en SQL paramétré ; le front ne fait que dessiner.

## 8. Erreurs

- Écriture d'un **événement** qui échoue : `console.error` + le jeu continue.
- Opération de **crédits** qui échoue (DB verrouillée, disque plein) : l'opération
  échoue proprement (`spend` → false comme un solde insuffisant ; `addCredit` →
  log d'erreur et solde inchangé renvoyé, comme un échec d'écriture aujourd'hui) ; la transaction garantit qu'on n'a jamais un solde
  modifié sans mouvement, ni l'inverse.
- `better-sqlite3` absent / DB illisible au démarrage : le bot **refuse de démarrer**
  avec un message clair (mieux que de tourner avec une économie non tracée).
- API stats : 400 sur paramètres invalides, 403 sur auth, 500 loggé sinon.

## 9. Déploiement et retour arrière

1. Vérifier `node --version` sur la VM (better-sqlite3 fournit des binaires
   précompilés pour Node 18/20/22 x64 Linux).
2. `git pull && npm install && node scripts/backfill-events.js && systemctl restart slack-reactor`.
3. Retour arrière : redéployer le commit précédent. **Attention** : les crédits
   gagnés/dépensés après migration ne sont que dans SQLite ; le script
   `scripts/export-credits-json.js` (livré avec ce chantier) réécrit un
   `credits.json` à jour depuis la DB avant de revenir en arrière.
4. Sauvegarde : copier `data/jeanpip.db` (+ `-wal`) avec les autres fichiers runtime.

## 10. Tests

Dans le style existant (`scripts/test-*.js`, DB en fichier temporaire) :
- `test-db.js` : création et migration de schéma, réouverture.
- `test-credits.js` : API inchangée (add/spend/setBalance/getBalance), import de
  `credits.json`, invariant `balance = SUM(moves)`, spend insuffisant sans mouvement,
  source `unknown` quand `meta` absent.
- `test-events.js` : enregistrement, dédup, jamais d'exception propagée.
- `test-backfill.js` : sur des fixtures JSON, idempotence (2 lancements = mêmes lignes).
- `test-stats.js` : KPIs et séries sur un jeu de données connu (inflation, médiane,
  meilleur booster, cartes les plus jouées, granularité semaine en heure de Paris).
- `test-stats-web.js` : 403 sans signature / lien expiré / non-admin, 200 admin.
- Répétition générale : backfill + démarrage sur une **copie des vrais fichiers de
  prod** avant merge, vérification écart ledger = 0.

## 11. Hors périmètre

Migration des autres JSON (chantier 2), export CSV, alertes automatiques
(ex. inflation > seuil), vue joueur publique.
