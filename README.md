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
