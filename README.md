# 🤖 Slack Emoji Reactor Bot

Bot Slack qui envoie des images/vidéos aléatoires en DM quand quelqu'un réagit avec un emoji spécifique.

## 🎯 Fonctionnement

```
👤 User A poste un message dans un channel
👤 User B réagit avec :emoji_cible:
        │
        ▼
🤖 Bot détecte la réaction
        │
        ├──→ 📨 DM à User B (réacteur) avec un média aléatoire
        └──→ 📨 DM à User A (auteur) avec un autre média aléatoire
```

## 📋 Prérequis

- **Node.js** v18+ (pour `fetch` natif)
- Un **workspace Slack** avec les droits admin
- Une **App Slack** configurée (voir ci-dessous)

## 🚀 Installation

### 1. Cloner le repo

```bash
git clone https://github.com/bardinetpaul-lgtm/slack-emoji-reactor-bot.git
cd slack-emoji-reactor-bot
npm install
```

### 2. Créer l'App Slack

1. Va sur [api.slack.com/apps](https://api.slack.com/apps)
2. **Create New App** → **From scratch**
3. Donne un nom et sélectionne ton workspace

### 3. Configurer les permissions (OAuth Scopes)

Dans **OAuth & Permissions** → **Bot Token Scopes**, ajoute :

| Scope | Raison |
|---|---|
| `reactions:read` | Lire les réactions emoji |
| `channels:history` | Lire les messages des channels publics |
| `groups:history` | Lire les messages des channels privés |
| `chat:write` | Envoyer des messages/DM |
| `im:write` | Ouvrir des conversations DM |
| `users:read` | Récupérer les infos utilisateurs |

### 4. Activer les Events

Dans **Event Subscriptions** → **Enable Events: ON**

Dans **Subscribe to bot events**, ajoute :
- `reaction_added`

### 5. Activer le Socket Mode

1. Menu → **Socket Mode** → **Enable Socket Mode**
2. Crée un **App-Level Token** avec le scope `connections:write`
3. Note le token `xapp-...`

### 6. Installer l'App

Menu → **Install App** → **Install to Workspace**

Note les tokens :
- **Bot User OAuth Token** (`xoxb-...`)
- **Signing Secret** (dans Basic Information)
- **App-Level Token** (`xapp-...`)

### 7. Configurer l'environnement

```bash
cp .env.example .env
```

Remplis le fichier `.env` avec tes tokens :

```env
SLACK_BOT_TOKEN=xoxb-ton-token
SLACK_SIGNING_SECRET=ton-signing-secret
SLACK_APP_TOKEN=xapp-ton-app-token
TARGET_EMOJI=partyparrot
```

### 8. Lancer le bot

```bash
npm start
```

Pour le mode développement (auto-reload) :

```bash
npm run dev
```

### 9. Inviter le bot dans les channels

Dans chaque channel que tu veux surveiller :
```
/invite @NomDuBot
```

## 🎨 Personnalisation

### Banque de médias locale

Modifie `data/media-bank.json` pour ajouter tes propres images/vidéos :

```json
[
  {
    "type": "image",
    "url": "https://exemple.com/mon-image.gif",
    "title": "🎉 Mon image"
  },
  {
    "type": "video",
    "url": "https://exemple.com/ma-video.mp4",
    "title": "🎬 Ma vidéo"
  }
]
```

### Utiliser Giphy API

Pour des GIFs aléatoires dynamiques :

1. Crée un compte sur [developers.giphy.com](https://developers.giphy.com/)
2. Crée une app pour obtenir une API Key
3. Ajoute dans ton `.env` :

```env
GIPHY_API_KEY=ta-clé-giphy
GIPHY_TAG=celebration
```

> Si Giphy est configuré, il est utilisé en priorité. En cas d'erreur, le bot utilise la banque locale en fallback.

## 📁 Structure du projet

```
slack-emoji-reactor-bot/
├── .env.example          # Template de configuration
├── .gitignore
├── package.json
├── README.md
├── data/
│   └── media-bank.json   # Banque de médias locale
└── src/
    ├── app.js            # Point d'entrée principal
    ├── blocks.js         # Construction des blocs Slack
    └── media.js          # Gestion des médias (local + Giphy)
```

## 📊 Dashboard /stats et base SQLite

Les crédits (soldes + grand livre de chaque mouvement) et le journal des stats vivent dans `data/jeanpip.db` (SQLite, non versionné). Les autres données restent dans les fichiers JSON de `data/`.

**Premier déploiement** (VM `BS-LORIENT-DASHBOARD`) :

```bash
node --version                     # ≥ 18
cd /root/slack-emoji-reactor-bot
cp -r data data.bak-$(date +%F)    # sauvegarde
git pull
npm install                        # installe better-sqlite3
node scripts/backfill-events.js    # rattrapage de l'historique (relançable sans doublon)
systemctl restart slack-reactor
journalctl -u slack-reactor -n 50  # « Bot lancé », aucune erreur SQLite
```

Au premier démarrage, `data/credits.json` est importé (log « credits.json importé dans SQLite : N solde(s), total X ») puis n'est plus écrit (il reste en place) ; le marqueur `data/credits.json.imported` garde la date et le total. Si la base est inutilisable, le bot refuse de démarrer (message dans les logs). Il refuse aussi de démarrer — plutôt que de réimporter en silence un `credits.json` périmé — si la base a disparu après l'import, ou si `credits.json` a été réécrit après l'import.

**Accès** : onglet Accueil du bot → 👑 Admin → 📊 Stats du jeu (admins `JEANPIP_ADMINS` seulement, lien valable 24 h).

**Retour arrière** : `node scripts/export-credits-json.js` (réécrit `credits.json` avec les soldes actuels, l'ancien est sauvegardé) **puis** redéployer le commit précédent et `systemctl restart slack-reactor`.

**Redéployer après un retour arrière** : l'ancienne version a continué d'écrire `credits.json`, c'est lui qui fait foi. Avant le redémarrage : `mv data/jeanpip.db data/jeanpip.db.avant-retour-arriere && rm -f data/jeanpip.db-wal data/jeanpip.db-shm data/credits.json.imported`, puis `node scripts/backfill-events.js` et `systemctl restart slack-reactor` (credits.json est réimporté). Sans ça, le bot refuse de démarrer et l'indique dans les logs.

**Sauvegarde** : `node -e "require('better-sqlite3')('data/jeanpip.db').backup('data/jeanpip-backup-$(date +%F).db').then(() => console.log('ok'))"` (copie cohérente même bot lancé), avec les autres fichiers de `data/` et `data/credits.json.imported`.

**Aperçu local** : `node scripts/preview-stats.js` (données simulées).

## 🐛 Dépannage

| Problème | Solution |
|---|---|
| Bot ne reçoit pas les events | Vérifie que Socket Mode est activé |
| `channel_not_found` | Invite le bot dans le channel : `/invite @Bot` |
| `not_in_channel` | Le bot doit être membre du channel |
| `missing_scope` | Ajoute les scopes manquants dans OAuth & Permissions |
| Pas de DM reçu | Vérifie que le bot a les scopes `chat:write` et `im:write` |

## 📜 License

MIT
