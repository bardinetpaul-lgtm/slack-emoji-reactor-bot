# 🧠 MEMORY — Notes & Leçons apprises

> Ce fichier documente tout ce qu'on a appris pendant la mise en place du bot.
> À consulter en cas de problème ou avant toute modification.

---

## 📌 Infos clés du projet

| Clé | Valeur |
|---|---|
| **Emoji cible** | `:jeanpip:` (emoji custom du workspace) |
| **Config** | Dans `.env`, on met `TARGET_EMOJI=jeanpip` (SANS les `::`) |
| **Nombre de médias** | 25 (23 images slack-files + 2 vidéos YouTube) |
| **Framework** | Slack Bolt (Node.js) + Socket Mode |
| **Node.js minimum** | v18+ (pour `fetch` natif) |

---

## ⚠️ Problèmes rencontrés & solutions

### 1. Le bot ne reçoit aucun event (rien dans les logs)

**Causes possibles (dans l'ordre) :**

1. **Le bot n'est pas dans le channel** → `/invite @NomDuBot` dans chaque channel
   - ⚡ C'est la cause #1 la plus fréquente
   - Le bot doit être invité dans CHAQUE channel où on veut qu'il fonctionne
   - Pour les channels privés, l'invite manuelle est OBLIGATOIRE

2. **Event Subscriptions pas activé** → api.slack.com → Event Subscriptions → ON + `reaction_added` dans **bot events**

3. **Socket Mode désactivé** → api.slack.com → Socket Mode → Enabled

4. **App pas réinstallée après modification des scopes/events** → api.slack.com → Install App → Reinstall (bandeau jaune)

### 2. `downloading image failed` / `invalid_blocks`

**Cause :** Les URLs `slack-files.com` sont privées, Slack ne peut pas les télécharger pour les afficher en bloc image inline.

**Solution :** On envoie les médias en **lien cliquable** au lieu de bloc image. Le fichier `src/blocks.js` détecte automatiquement si l'URL est publique ou privée.

### 3. Le bot plante quand l'ordi s'éteint

**Cause :** Le bot tourne en local via `npm start`. Si le terminal ou le PC est fermé, le bot s'arrête.

**Solution :** Déployer sur Railway.app, Render, Fly.io ou un VPS pour du 24/7.

---

## 🔧 Scopes OAuth nécessaires

```
reactions:read       → Lire les réactions emoji
channels:history     → Lire les messages des channels publics
groups:history       → Lire les messages des channels privés
chat:write           → Envoyer des messages/DM
im:write             → Ouvrir des conversations DM
im:history           → Lire l'historique des DM (rattrapage des collections)
users:read           → Récupérer les infos utilisateurs
files:read           → Images des cartes sur la page d'ouverture animée
```

**Optionnels (pour auto-join) :**
```
channels:join        → Rejoindre automatiquement les channels publics
channels:read        → Lister les channels publics
```

---

## 💬 Messages personnalisés

### DM au réacteur :
```
Hey @{user} tu as réagi avec jean pip coucou :jeanpip:
[lien vers média aléatoire]
```

### DM à l'auteur du message :
```
Bonjour jeune @{user}, @{réacteur} t'a envoyé un Jeanpip ! :jeanpip:
[lien vers média aléatoire]
```

### Si réacteur = auteur → un seul DM est envoyé (pas de doublon)

---

## 🎲 Système aléatoire

- `Math.random()` → nombre entre 0 et 1 → × nombre de médias → `Math.floor()`
- Tirage avec remise : un même média peut sortir plusieurs fois
- Deux médias différents sont tirés (un pour le réacteur, un pour l'auteur)

---

## 📁 Structure du projet

```
slack-emoji-reactor-bot/
├── .env.example          ← Template (ne JAMAIS commit .env)
├── .gitignore
├── package.json
├── README.md             ← Doc d'installation
├── MEMORY.md             ← CE FICHIER
├── data/
│   ├── media-bank.json   ← Banque de médias (avec rareté)
│   ├── scores.json       ← Scores hebdo (runtime, gitignored)
│   ├── credits.json      ← Porte-monnaie booster (runtime, gitignored)
│   ├── boosters.json     ← Boosters achetés non ouverts (runtime, gitignored)
│   ├── collections.json  ← Cartes possédées par user (runtime, gitignored)
│   ├── settings.json     ← Réglages admin (crédits par Jeanpip) (runtime, gitignored)
│   ├── web-secret        ← Secret des liens d'ouverture animée si WEB_SECRET vide (runtime, gitignored)
│   └── card-cache/       ← Images des cartes pour la page d'ouverture animée (runtime, gitignored)
├── public/               ← Page d'ouverture animée (open.html/css/js + assets/)
├── scripts/              ← backfill-collections, test-web-open, preview-web-open
└── src/
    ├── app.js            ← Point d'entrée + listeners + slash commands + boutons
    ├── blocks.js         ← Construction des blocs Slack (gère URLs privées)
    ├── media.js          ← Sélection aléatoire par rareté (local + Giphy fallback)
    ├── scores.js         ← Compteur hebdo + attaque Jeanpip
    ├── targets.js        ← Cibles auto-react persistantes
    ├── credits.js        ← Porte-monnaie PERMANENT (jamais de reset)
    ├── boosters.js       ← Catalogue de boosters + tirage + persistance
    ├── collections.js    ← Cartes possédées par user + phrases doublon/triplon
    ├── broadcast.js      ← Liste de diffusion opt-in (qui accepte de recevoir)
    ├── openBooster.js    ← Ouverture d'un booster, partagée Slack + web (openOnce)
    ├── web.js            ← Serveur HTTP de la page d'ouverture animée
    ├── cardImages.js     ← Proxy + cache des images slack-files pour la page
    ├── settings.js       ← Réglages live (crédits par Jeanpip), data/settings.json
    ├── home.js           ← Onglet Accueil (vue par user) + modales (fonctions pures)
    └── admin.js          ← Actions admin partagées (commandes slash + panneau Accueil)
```

---

## 🏠 Onglet Accueil (App Home)

Construit **par utilisateur** (`src/home.js`) et publié via `views.publish` à l'ouverture
(`app_home_opened`) et après chaque changement d'état.

**Config Slack requise (une fois) :** api.slack.com → *App Home* → *Show Tabs* → **Home Tab ON** ;
*Event Subscriptions* → bot event **`app_home_opened`** ; puis **Reinstall** l'app.
Aucun nouveau scope OAuth.

**Partie joueur (tout le monde) :** solde (demi-crédits affichés « 12,5 »), score de la semaine,
⚔️ Attaque (bouton → modale avec sélecteur de channel `conversations_select` ; gratuite si
débloquée, illimitée pour un admin, sinon `ATTACK_PRICE` crédits ; mêmes règles que
`/jeanpip-attack` via `launchAttack`), boutons d'achat de boosters (`buy_booster_<type>`,
le booster s'ouvre ensuite dans l'onglet *Messages*) + compteur de boosters non ouverts,
bouton liste de diffusion (`broadcast_join/leave`). Pas de vue collection (refusée pour l'instant).

**Panneau 👑 Admin :** construit UNIQUEMENT pour `JEANPIP_ADMINS` (Slack ne permet pas de
masquer une commande slash, d'où l'Accueil). 4 boutons → modales : offrir une attaque,
crédits ± (demi-crédits acceptés, positif = notifie, négatif = correction silencieuse),
ajouter un média (lien + rareté + titre), ajouter une cible auto-react, ⚙️ crédits par Jeanpip
(valeur d'un Jeanpip envoyé : multiple de 0,5 entre 0,5 et 10, sans rétroactivité, persistée dans
`data/settings.json` via `src/settings.js`) ; liste des cibles
avec bouton « Retirer » (cibles `.env` marquées fixes). **Chaque action admin revérifie
`JEANPIP_ADMINS` côté serveur.** Les erreurs de saisie s'affichent dans la modale, les
confirmations arrivent en DM.

**Logique partagée :** les commandes admin slash (`/jeanpip-give`, `/jeanpip-give-credits`,
`/jeanpip-addmedia`, `/jeanpip-auto`) et le panneau appellent les mêmes fonctions de
`src/admin.js`. Les commandes sont gardées en parallèle pour l'instant (suppression plus tard).

**Rafraîchissement :** `refreshHome()` après achat de booster, attaque, liste de diffusion,
actions admin. Pour les passages « passifs » (crédits gagnés via une réaction, ouverture de
booster, cadeau d'un admin), `refreshHomeIfSeen()` ne republie que pour les users ayant
ouvert l'Accueil depuis le démarrage (Set en mémoire) → pas de `views.publish` à chaque
réaction de tout le workspace. Limite connue : une ouverture animée (page web) ne republie pas
l'Accueil → le compteur « non ouverts » se met à jour à la prochaine ouverture de l'onglet.

---

## 📮 Liste de diffusion (opt-in)

**Par défaut, PERSONNE n'est inscrit** → personne ne reçoit de Jeanpip venant des autres.
Inscription via la commande `/jeanpip` (DM avec un bouton entrer/sortir).
Stockage : `data/subscribers.json` (runtime, gitignored).

| Situation | Comportement |
|---|---|
| Tu réagis au message d'un **inscrit** | Il reçoit son Jeanpip ✅ · tu reçois le tien ✅ · tu gagnes des crédits (0,5 par défaut) ✅ |
| Tu réagis au message d'un **non-inscrit** | Il ne reçoit **rien** ❌ · tu reçois quand même le tien ✅ · **aucun crédit** ❌ |

La liste est respectée **partout** : réactions, `/jeanpip-attack` (ne cible que les
inscrits) et auto-react (`/jeanpip-auto`). Non concernés : ton propre Jeanpip quand
tu réagis, tes boosters, et les punitions anti-spam.

---

## 🎁 Mode Booster JeanPip

**Gagner des crédits :** +0,5 crédit (par défaut, réglable par un admin depuis l'Accueil) permanent à chaque réaction `:jeanpip:` que TU poses
(spam exclu ; l'attaque et l'auto-react ne créditent pas — anti-farming). Jamais de reset.
Les soldes peuvent donc contenir des demi-crédits (réglage `creditsPerJeanpip` dans `data/settings.json`, module `src/settings.js`).

**Dépenser :**
- `/jeanpip-booster` → boutique DM avec 3 boutons :
  ⚪ Commun (20) · 🔵 Rare (45) · 🟣 Épique (60).
- `/jeanpip-attack` sans attaque gratuite débloquée → DM avec un bouton
  « Lancer l'attaque (25 crédits) » (`ATTACK_PRICE` dans `src/app.js`). Débit seulement
  si l'attaque part vraiment (personne à cibler / channel illisible → rien n'est débité).
  Anti-farm respecté, anti-double-clic.
- `/jeanpip-credits` affiche le solde.

**Contenu d'un booster :** toujours **8 cartes**. Les 5 premières sont communes ;
les 3 dernières suivent une distribution **par slot** (tables dans `src/boosters.js`,
chacune totalise 100 %). Ex. booster épique, slot 8 : 50 % épique / 20 % rare / 30 % légendaire.

**Flux d'ouverture :** achat → débit immédiat → DM « Booster acheté » avec **2 boutons** :
- 🎬 **Ouverture animée** → lien vers la page web d'animation (voir ci-dessous).
  N'apparaît que si `WEB_PUBLIC_URL` est défini.
- 💬 **Ouvrir dans Slack** → cartes révélées une toutes les **2 s dans le DM**
  (`SLACK_REVEAL_INTERVAL_MS` dans `src/app.js`).

Les deux passent par `openOnce()` (`src/openBooster.js`) : bloc **synchrone** qui marque
ouvert → tire → ajoute en collection → mémorise les cartes dans `boosters.json`. Le
premier gagne, l'autre répond « déjà ouvert ». Les cartes sont en collection AVANT
l'animation (un restart ou un onglet fermé ne fait rien perdre).

### 🎬 Page d'ouverture animée

- Servie par le bot lui-même (`src/web.js`, module `http` natif) sur `127.0.0.1:3100`,
  exposée via le reverse proxy du dashboard : `https://dashboard-lorient.dimsi.cloud/jeanpip/`.
- ⚠️ **Whitelist IP** : accessible uniquement depuis les bureaux de **Lorient** et
  **Asnières**. En télétravail → bouton « Ouvrir dans Slack ».
- Lien = `/open/<boosterId>?t=<HMAC>` (signé avec `WEB_SECRET`, sinon `data/web-secret`).
  Pas de login : le lien fait office de clé, mais les cartes vont toujours au propriétaire.
- Rouvrir le lien rejoue la même ouverture (mêmes cartes, pas de nouvel ajout).
- Après ouverture web, le DM d'achat est mis à jour (`chat.update`) avec le récap des cartes.
- Images : `src/cardImages.js` récupère les `slack-files.com` via `files.info` (scope
  **`files:read`**), sinon via la page publique (lien `pub_secret`), cache dans
  `data/card-cache/` (gitignored). Seuls les fichiers de la banque sont servis.
- Front : `public/open.html|css|js` (sans build, sans lib). Fond : `public/assets/bg-lorient.jpg`.
- ⚠️ **Cloudflare impose un cache navigateur de 4 h** sur les .css/.js (`max-age=14400`, il écrase
  notre `no-cache`). D'où `open.css?v=<hash>` / `open.js?v=<hash>` : le serveur remplace
  `__ASSET_VERSION__` dans `open.html` par un hash du contenu → une mise à jour est vue tout de
  suite. Si tu renommes/ajoutes un asset chargé par la page, versionne-le de la même façon.
- En prod, la page passe par le **dashboard MagicDIMSI** (seul port exposé, 8080) qui relaie
  `/jeanpip/*` vers `127.0.0.1:3100` (`jeanpip-web.js` dans le repo exagyde/MagicDIMSI).
  Caddy (port 80) ne reçoit PAS le trafic extérieur : la config nginx/Caddy ci-dessous est inutile.
  Sons en Web Audio, coupés par défaut.
- Tests : `node scripts/test-web-open.js` (page web) + `node scripts/test-app-booster.js`
  (achat/ouverture Slack avec un faux Slack, ~30 s) · Aperçu local : `node scripts/preview-web-open.js`
  (copie temporaire, aucune donnée réelle touchée).

**Chemin réseau réel (constaté le 2026-09-25)** : navigateur → Cloudflare (whitelist) →
redirection de port DIMSI → VM `10.0.13.250:8080` = dashboard MagicDIMSI → relais `/jeanpip/*`
→ bot `127.0.0.1:3100`. Il n'y a **pas de nginx** sur la VM, et Caddy (port 80) est hors circuit.
`.env` de prod : `WEB_PUBLIC_URL=https://dashboard-lorient.dimsi.cloud/jeanpip` + `WEB_PORT=3100`.

**Collection :** chaque carte tirée d'un booster ET chaque Jeanpip reçu en DM (réaction,
attaque, auto-react — via `sendJeanpipDM`) est enregistré dans `data/collections.json`.
Ta propre image de réacteur ne compte que si ton Jeanpip compte (destinataire inscrit,
hors anti-farm). Punitions anti-spam et aperçus `/jeanpip-addmedia` exclus.
Stockage :
(gitignored, module `src/collections.js`), indexée par URL du média, avec le nombre
d'exemplaires. À la révélation, une phrase indique Nouvelle / Doublon / Triplon…
(`COPY_PHRASES`). Historique d'avant la collection : `node scripts/backfill-collections.js`
(simulation) puis `--apply` — nécessite le scope `im:history`.

**Catalogue extensible :** ajouter une entrée dans `BOOSTERS` (`src/boosters.js`)
avec un `price` et 8 `slots` suffit à créer un nouveau type de booster.

**Commandes admin liées** (aussi dans le panneau 👑 Admin de l'Accueil) :
- `/jeanpip-give-credits @user <montant>` → crédite le porte-monnaie de quelqu'un
  (positif = cadeau notifié, négatif = correction ; demi-crédits acceptés, ex. `2,5`).
- `/jeanpip-addmedia <lien> <rareté> [titre]` → ajoute un média à la banque **sans
  redémarrage**. Rareté acceptée en FR/EN (`commun/rare/epique/legendaire`). Le type
  (image/vidéo) est déduit de l'URL. Média persisté dans `data/media-bank-custom.json`
  (gitignored, séparé de `media-bank.json` versionné) et rechargé au démarrage.

---

## 📝 Comment ajouter un nouveau média

Modifier `data/media-bank.json`, ajouter une entrée :

**Image :**
```json
{
  "type": "image",
  "url": "https://ton-lien-direct",
  "title": "🎉 Titre"
}
```

**Vidéo :**
```json
{
  "type": "video",
  "url": "https://youtu.be/xxx",
  "title": "🎬 Titre"
}
```

Puis : `git pull` → `Ctrl+C` → `npm start`

---

## 🚀 Évolutions possibles (discutées mais pas encore implémentées)

### 1. Déploiement 24/7
**Problème :** Le bot s'arrête quand le PC est éteint.
**Solution :** Déployer sur une plateforme cloud :
| Option | Coût | Difficulté |
|---|---|---|
| Railway.app ⭐ (recommandé) | 5$/mois (trial gratuit) | 🟢 Très facile |
| Render | Gratuit (mais s'éteint après 15min) | 🟢 Facile |
| Fly.io | Gratuit tier | 🟡 Moyen |
| VPS (OVH, Hetzner) | ~3-5€/mois | 🔴 Avancé |

> Avec Socket Mode, pas besoin d'URL publique. Railway se connecte au repo GitHub et redéploie automatiquement à chaque push.

### 2. Support multi-emoji
**Idée :** Surveiller plusieurs emojis différents, pas seulement `:jeanpip:`.
**Implémentation :** Transformer `TARGET_EMOJI` en liste dans `.env` :
```env
TARGET_EMOJIS=jeanpip,partyparrot,fire
```
Chaque emoji pourrait avoir sa propre banque de médias.

### 3. Cooldown anti-spam
**Problème :** Si quelqu'un spam 50 réactions :jeanpip: d'affilée, le bot envoie 50 DMs.
**Solution :** Ajouter un cooldown par utilisateur (ex: 1 réaction prise en compte toutes les 30 secondes).

### 4. Auto-join dans tous les channels publics
**Idée :** Le bot rejoint automatiquement tous les channels publics au démarrage, plus besoin de faire `/invite` manuellement.
**Prérequis :** Ajouter les scopes `channels:join` + `channels:read` sur api.slack.com.

### 5. Amélioration de l'aléatoire
**Options discutées :**
| Besoin | Solution |
|---|---|
| Éviter les doublons entre réacteur et auteur | Tirer le 2ème en excluant le 1er |
| Ne jamais renvoyer le même 2 fois de suite | Mémoriser le dernier tirage |
| Rotation complète des 25 avant de boucler | Système de shuffle (mélanger le deck) |

### 6. Logs dans un channel Slack
**Idée :** Envoyer un récap de chaque utilisation dans un channel admin dédié (ex: `#jeanpip-logs`) pour monitorer l'activité du bot.

### 7. Giphy API dynamique
**Idée :** Au lieu de se limiter à la banque locale, utiliser l'API Giphy pour des GIFs aléatoires infinis.
**Prérequis :** Créer un compte sur developers.giphy.com et ajouter `GIPHY_API_KEY` dans `.env`.
**Note :** Déjà supporté dans le code (`src/media.js`), il suffit d'ajouter la clé.

### 8. Ré-hébergement des images
**Problème :** Les URLs `slack-files.com` sont privées → affichées en lien cliquable au lieu d'image inline.
**Solution :** Ré-héberger les images sur un service public (Imgur, Cloudinary, S3) pour qu'elles s'affichent directement dans le DM Slack.

---

## 🚨 Règle d'or

> **Quand le bot ne fonctionne pas → vérifier EN PREMIER qu'il est bien invité dans le channel.**
> C'est la cause n°1 à chaque fois.
