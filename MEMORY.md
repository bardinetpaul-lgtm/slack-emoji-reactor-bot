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
users:read           → Récupérer les infos utilisateurs
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
│   └── media-bank.json   ← Banque de 25 médias
└── src/
    ├── app.js            ← Point d'entrée + listener reaction_added
    ├── blocks.js         ← Construction des blocs Slack (gère URLs privées)
    └── media.js          ← Sélection aléatoire (local + Giphy fallback)
```

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

## 🚨 Règle d'or

> **Quand le bot ne fonctionne pas → vérifier EN PREMIER qu'il est bien invité dans le channel.**
> C'est la cause n°1 à chaque fois.
