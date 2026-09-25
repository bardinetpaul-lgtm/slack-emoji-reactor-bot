# 🎬 Ouverture de booster « à la FIFA » — Design

_Date : 2026-09-25 · Auteur : Paul Bardinet (avec Claude)_

## 🎯 Objectif

Offrir une vraie animation d'ouverture de booster, façon pack opening FIFA / EA FC,
sur une page web servie par la VM de prod, **en plus** de l'ouverture actuelle dans Slack.

La page n'est joignable que depuis les bureaux de **Lorient** et **Asnières**
(URL publique `https://dashboard-lorient.dimsi.cloud/` protégée par whitelist IP).
En télétravail, l'ouverture Slack reste donc indispensable.

Hors périmètre : les Jeanpips simples (réactions), l'économie (prix, crédits), la collection
elle-même (seul l'appel existant `collections.addCards` est réutilisé).

## 🧭 Parcours utilisateur

1. `/jeanpip-booster` → achat (inchangé : débit immédiat, booster persisté).
2. Le DM « Booster acheté » propose **deux boutons** :
   - 🎬 **Ouverture FIFA** — bouton-lien vers
     `${WEB_PUBLIC_URL}/open/<boosterId>?t=<token>`, avec la mention
     « _depuis le bureau de Lorient ou d'Asnières_ ».
   - 💬 **Ouvrir dans Slack** — l'existant (`open_booster`), une carte toutes les **2 s**
     (au lieu de 5 s).
3. Dès qu'une des deux ouvertures a eu lieu, le booster est consommé :
   - Ouvert via la page → le DM d'achat est mis à jour (`chat.update`) : boutons retirés,
     « ✅ Ouvert en mode FIFA » + récap texte des 8 cartes.
   - Ouvert via Slack → le DM est mis à jour comme aujourd'hui ; la page affiche
     « Déjà ouvert dans Slack ».
4. Recharger la page ou rouvrir le lien d'un booster ouvert en mode FIFA **rejoue la même
   ouverture** (mêmes cartes, aucun nouveau tirage, aucun ajout en collection).

Si `WEB_PUBLIC_URL` n'est pas défini : le serveur web ne démarre pas et le DM d'achat
n'affiche que le bouton Slack. Le merge est donc sans risque avant la configuration du proxy.

## 🏗️ Architecture

Tout tourne dans le **même process** Node que le bot (service systemd `slack-reactor`).
Aucune nouvelle dépendance npm : module `http` natif, `crypto`, `fs`.

| Fichier | Rôle |
|---|---|
| `src/web.js` | Serveur HTTP (`127.0.0.1:${WEB_PORT}`, 3100 par défaut) : fichiers statiques de `public/` + API JSON. Exporte `startWebServer({ client, logger })` et `buildOpenUrl(boosterId, ownerId)`. |
| `src/openBooster.js` | Logique d'ouverture **partagée** Slack + web : `openOnce(id, userId, via)` — bloc synchrone qui marque ouvert, tire, ajoute en collection et persiste les cartes. |
| `src/cardImages.js` | Résolution + cache disque des images Slack (voir plus bas). |
| `src/boosters.js` | Étendu : `saveOpening(id, { via, cards, counts })`, `setMessageRef(id, channel, ts)`. |
| `src/app.js` | `sendDM` retourne `{ channel, ts }` (mémorisés via `setMessageRef` pour le `chat.update` côté web), DM d'achat à 2 boutons, handler `open_booster` qui utilise `openOnce`, délai 2 s, `ack` du bouton-lien, démarrage du serveur web. |
| `public/open.html`, `public/open.css`, `public/open.js` | Page d'animation (HTML/CSS/JS pur, sans build). |
| `public/assets/bg-lorient.jpg` | Fond fourni par Paul (vue aérienne de Lorient, coucher de soleil). |

### Données — `data/boosters.json` (étendu, rétrocompatible)

```json
{ "boosters": { "b_xxx": {
  "owner": "U123", "type": "epic", "opened": true,
  "createdAt": "…", "openedAt": "…",
  "openedVia": "web",
  "cards": [{ "type": "image", "url": "https://slack-files.com/…", "title": "🟡 Surprise #42", "rarity": "legendary" }],
  "counts": [1, 2, 1, 1, 1, 3, 1, 1],
  "message": { "channel": "D123", "ts": "1727…" }
} } }
```

Les anciens boosters (sans `cards` / `message`) restent valides.

### Ouverture partagée — `openOnce(id, userId, via)`

Entièrement **synchrone** (aucun `await`) → deux ouvertures concurrentes ne peuvent pas
s'entremêler dans les fichiers JSON (Node mono-thread) :

1. `getPending(id)` → introuvable ⇒ `{ status: 'not_found' }` ; mauvais owner ⇒ `{ status: 'forbidden' }`.
2. Déjà ouvert ⇒ `{ status: 'already', via: openedVia, cards, counts }` (permet le rejeu web).
3. `markOpened(id)` → `openBooster(type)` → `collections.addCards(owner, cards)` →
   `saveOpening(id, { via, cards, counts })` ⇒ `{ status: 'opened', cards, counts }`.

Les cartes sont donc en collection **avant** toute animation (fermer l'onglet ou redémarrer
le bot ne fait rien perdre) — corrige au passage la limite connue v1.

### API web

| Route | Réponse |
|---|---|
| `GET /open/<id>?t=<token>` | `public/open.html` (la page lit id + token dans l'URL). |
| `POST /api/open/<id>?t=<token>` | Vérifie le token → `openOnce(id, owner, 'web')`. 200 `{ status, booster: {type,label,emoji}, cards: [{ title, rarity, type, count, image, videoUrl }] }` ; `already` + `via: 'slack'` ⇒ la page affiche « Déjà ouvert dans Slack » ; 403 token invalide ; 404 introuvable. Sur `status: 'opened'`, met à jour le DM d'achat en asynchrone (erreur loguée, jamais bloquante). |
| `GET /api/card-image/<fileId>` | Image de la carte (proxy + cache). 404 si `fileId` absent de la banque. |
| `GET /<fichier statique>` | Fichiers de `public/`, chemin normalisé (pas de sortie via `..`). |

Toutes les routes fonctionnent derrière un préfixe de proxy (`/jeanpip/`) : la page
n'utilise que des chemins **relatifs**.

## 🔐 Sécurité

- **Token de lien** = `HMAC-SHA256(boosterId + ':' + ownerId, WEB_SECRET)` en hex, comparé
  avec `crypto.timingSafeEqual`. `WEB_SECRET` vient du `.env` ; absent ⇒ généré au premier
  démarrage dans `data/web-secret` (gitignored).
- Pas de login Slack sur la page : le lien fait office de clé. Un lien transféré permet à
  quelqu'un d'autre de lancer l'animation, mais les cartes vont toujours au **propriétaire**.
  Compromis assumé (OAuth Slack disproportionné).
- Proxy d'images restreint à une **liste blanche** : seuls les `fileId` extraits des URLs de
  la banque de médias (versionnée + custom) sont servis.
- Écoute sur `127.0.0.1` uniquement (accès via le reverse proxy → whitelist IP appliquée).
- En-têtes : `Content-Type` correct, `X-Content-Type-Options: nosniff`, `Cache-Control`
  long sur `assets/` et images de cartes, `no-store` sur l'API.
- Toute erreur du serveur web est attrapée et loguée : elle ne peut pas faire tomber le bot.

## 🖼️ Images des cartes — `src/cardImages.js`

Les médias sont des liens de partage `https://slack-files.com/<TEAM>-<FILEID>-<SECRET>`
(pages HTML, pas des images). Résolution de `<FILEID>` :

1. **Cache disque** `data/card-cache/<FILEID>.<ext>` (gitignored) → servi directement.
2. **API Slack** : `files.info({ file })` avec le token du bot (**scope `files:read` à
   ajouter + réinstaller l'app**) → téléchargement de `url_private` avec
   `Authorization: Bearer <SLACK_BOT_TOKEN>`.
3. **Repli** : lecture de la page publique `slack-files.com/…` et extraction de l'URL de
   l'image (`files.slack.com/files-pri/…?pub_secret=…`, via `og:image` ou la balise `<img>`),
   puis téléchargement.
4. Échec total → 404 ; la page affiche un **visuel de repli** (rareté + titre + logo), sans
   bloquer l'animation.

Téléchargements dédupliqués (une seule requête en vol par `fileId`), taille max 15 Mo,
type MIME vérifié (`image/*`). Vidéos YouTube : miniature publique
`https://img.youtube.com/vi/<id>/hqdefault.jpg` + bouton ▶️ vers la vidéo.

## 🎨 Page & animation

**Fond** : `bg-lorient.jpg` en `cover`, voile dégradé sombre ; flou + assombrissement
renforcés pendant les révélations.

**Séquence** :

1. **Intro** — le booster (couleur de son type : ⚪/🔵/🟣) flotte au centre avec une légère
   inclinaison 3D qui suit souris/doigt ; « Touche pour ouvrir ». L'appel `POST api/open`
   part au chargement et les images sont préchargées pendant l'intro.
2. **Ouverture** — tremblement, le pack se déchire en deux moitiés, flash blanc.
3. **Walkout** — couleur de la **meilleure** carte du pack. **Légendaire** : écran assombri,
   3 faisceaux dorés en rotation, pluie de particules dorées (`<canvas>`), carte qui descend
   lentement (~4-5 s). Épique : faisceaux violets plus courts. Sinon : simple flash coloré.
4. **Révélations** — 8 dos de carte en éventail ; chaque carte vient au centre, se retourne
   (flip 3D), puis rejoint la grille. Rythme : cartes 1-5 ≈ 0,7 s ; cartes 6-8 de 1,5 à 2,5 s,
   avec halo pulsé de la rareté. Chaque carte : photo, « Surprise #N », pastille de rareté,
   badge ✨ **NOUVELLE** (count = 1) ou 🔁 **×N** (count ≥ 2).
5. **Récap** — grille 4×2 (2×4 sur mobile), compteurs par rareté, nombre de nouvelles
   cartes, bouton « Retour à Slack » (`slack://open`).

**Contrôles** : **Passer ⏭** à tout moment (va au récap) ; **🔊/🔇** coupé par défaut.
Sons synthétisés en **Web Audio** (whoosh, flip, fanfare légendaire) — aucun fichier audio.

**Accessibilité / perfs** : `prefers-reduced-motion` ⇒ fondus simples sans particules ;
responsive dès 360 px ; aucune librairie externe.

**Écrans d'erreur** (même fond) : « Lien invalide », « Booster introuvable »,
« Déjà ouvert dans Slack », « Serveur injoignable — réessaie ou ouvre-le dans Slack ».

## ⚙️ Configuration & déploiement

Nouveaux paramètres `.env` (documentés dans `.env.example`) :

```env
# URL publique de la page d'ouverture (sans slash final). Vide = ouverture Slack uniquement.
WEB_PUBLIC_URL=https://dashboard-lorient.dimsi.cloud/jeanpip
# Port local du serveur web (écoute sur 127.0.0.1)
WEB_PORT=3100
# (Optionnel) Secret de signature des liens. Vide = généré dans data/web-secret
WEB_SECRET=
```

Reverse proxy (nginx, à ajouter au server block existant du dashboard) :

```nginx
location /jeanpip/ {
    proxy_pass http://127.0.0.1:3100/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Slack : ajouter le scope **`files:read`** puis réinstaller l'app.
`.gitignore` : `data/web-secret`, `data/card-cache/`.
Doc : `MEMORY.md` (section Booster) et `README.md` mis à jour.

## 🧪 Vérification

- `node --check` sur chaque fichier JS modifié.
- Script de test local `scripts/test-web-open.js` (sans Slack) : démarre le serveur avec un
  client Slack factice, crée un booster, vérifie token valide/invalide, ouverture, rejeu
  (mêmes cartes, collection non doublée), 2 ouvertures concurrentes (une seule gagne),
  refus de chemins `..` et de `fileId` hors banque.
- Vérification visuelle de la page en local (navigateur) avec des cartes factices,
  y compris un pack légendaire, mode mobile et `prefers-reduced-motion`.

## ⚠️ Risques

- `files.info` peut refuser des fichiers auxquels le bot n'a pas accès → repli page publique
  (étape 3). À valider en prod au premier déploiement.
- Si le proxy n'est pas `nginx`, adapter le bloc de config (même principe).
