# Arène Jeanpip — cœur back-end — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer tout le back-end de l'Arène qui ne dépend pas du visuel (en cours chez Claude Design) : données de cartes, moteur de combat, simulation d'équilibrage, decks, stockage, règlement de fin de combat, matchmaking, cycle de vie des combats.

**Architecture:** Modules CommonJS sous `src/game/`. Le moteur (`engine.js`) est pur : aucun I/O, aucun timer, aléa à graine ; il mute l'objet d'état qu'on lui passe et renvoie des événements. Tout ce qui touche au disque passe par des modules à fichier JSON dans `data/` (même style que `farm.js`). `matches.js` orchestre avec une horloge injectable (`step(now)`) pour être testable.

**Tech Stack:** Node 18+ (prod), CommonJS, aucune dépendance ajoutée. Tests = `scripts/test-*.js` exécutés avec `node`, style `check(label, cond)` dans une copie temporaire du projet.

**Spec:** `docs/superpowers/specs/2026-09-25-arene-jeanpip-design.md`

## Global Constraints

- Aucune dépendance npm ajoutée.
- Combat : 120 s ; élixir départ 5, max 10, +1 / 2,8 s, double élixir les 60 dernières secondes.
- Tours 600 PV / 80 DPS ; QG 2000 PV / 100 DPS (tire seulement dans un couloir dont la tour du même camp est tombée).
- Deck = 8 cartes différentes ; il faut ≥ 8 cartes différentes en collection.
- Pose apparaît 1 s après ; une seule Pompe active par joueur ; main de 4.
- Contres ×1,5 (et ×0,67 dans l'autre sens) : Tank → Guerrier → Tireur → Essaim → Tank ; Sort → Essaim.
- Sort : 40 % de ses dégâts sur les bâtiments.
- Pompe expirée = survivante.
- Récompense vainqueur : booster `common` + 10 crédits, max 5 victoires récompensées / jour, max 2 contre le même adversaire (jour = Europe/Paris). Butin : 1 pose du perdant au hasard, jamais plafonné.
- Commentaires et messages en français, en-têtes de module façon `═══` comme le reste de `src/`.

---

### Task 1: Données des cartes + registre des spécialités

**Files:** Create `src/game/cards.js`, `src/game/specialties.js`, `scripts/test-arena-cards.js`

**Produces:**
- `ARCHETYPES` (clé → `{ key, label, emoji, cost, hp, dps, range, speed, count, targets: 'all'|'buildings', share }` ; `sort` : `{ damage, radius, buildingRatio }` ; `pompe` : `{ hp, productionMs, lifetimeMs }`)
- `RARITY_MODS` (`common|rare|epic|legendary` → `{ mult, cost }`)
- `archetypeFromUrl(url) → key` (sha256, répartition `share`)
- `getCardStats({ url, title, rarity }) → { url, title, rarity, archetype, cost, hp, dps, range, speed, count, targets, damage, radius, buildingRatio, productionMs, lifetimeMs, specialty }`
- `damageMultiplier(attackerArch, targetArch) → 1.5 | 0.67 | 1`
- `reloadOverrides()` (relit `data/card-overrides.json`)
- specialties : `register(name, hooks)`, `get(name)`, `list()`

Tests : répartition ≈ `share` sur 10 000 URLs (±2 pts), stabilité, surcharge prioritaire, rareté (×1,6 / +1 légendaire, Pompe : cadence inchangée), contres dans les deux sens.

### Task 2: Moteur de combat

**Files:** Create `src/game/engine.js`, `scripts/test-arena-engine.js`

**Consumes:** `getCardStats`, `damageMultiplier`, `ARCHETYPES`, specialties `get`.

**Produces:**
- `createMatch({ id, seed, players: { A: { userId, deck: [card], copies: { url: n } }, B: … } }) → state`
- `applyAction(state, side, action) → { ok, reason?, events }` ; actions `{ type: 'deploy', url, lane: 0|1|2, forward?: bool }`, `{ type: 'forfeit' }`
- `tick(state, dtMs) → events` (pas fixes de 100 ms)
- `endMatch(state, winner|null, reason)` ; `publicState(state, viewerSide)`
- `state.result` à la fin : `{ winner: 'A'|'B'|null, reason, poses: [{ side, url, title, rarity, archetype, status: 'alive'|'destroyed'|'expired' }] }`

Terrain : axe y de 0 (camp A) à 100 (camp B). Tours A y=15, B y=85 ; QG A y=5, B y=95 ; pose A y=20 (B y=80), pose avancée A y=60 (B y=40) si la tour ennemie du couloir est tombée ; Pompe posée devant sa tour.

Tests : élixir et double élixir, main et cycle, exemplaires épuisés, refus (élixir, main, couloir, Pompe en double, pose avancée sans brèche), délai de 1 s, Tank ignore les unités, tir des tours, brèche puis dégâts QG, Sort (zone, 40 % bâtiment, toujours détruit), Pompe (production, expiration = `expired`), contres, fins (QG, tours, PV %, nul, abandon), déterminisme à graine.

### Task 3: Simulation d'équilibrage

**Files:** Create `scripts/simulate-balance.js`

Duels à élixir égal via `engine` (même couloir, poses simultanées), rapport par rareté et archétype, code de sortie ≠ 0 si une rareté > 70 % ou un archétype commun hors [35 %, 65 %]. Ajuster les constantes de `cards.js` jusqu'au vert.

### Task 4: Decks

**Files:** Create `src/game/deck.js`, `scripts/test-arena-deck.js`

**Produces:** `DECK_SIZE = 8`, `distinctCount(collection)`, `validateDeck(collection, urls) → { ok, reason? }`, `buildAutoDeck(collection) → urls`, `resolveDeck(saved, collection) → { urls, replaced: [url] }`.

### Task 5: Retrait de cartes + stockage de l'arène

**Files:** Modify `src/collections.js` (+ `removeCards`) ; Create `src/game/arenaStore.js`, `scripts/test-arena-store.js`

**Produces:**
- `collections.removeCards(userId, urls) → [countAfter]` (jamais < 0, entrée supprimée à 0)
- arenaStore : `getDeck`, `setDeck`, `getStats`, `recordResult({ matchId, at, winnerId, loserId, draw, loot })`, `consumeReward(winnerId, loserId, now) → bool`, `isSettled(matchId)`, `markSettled(matchId)`, `weeklyTop(now, limit)`

### Task 6: Règlement de fin de combat

**Files:** Create `src/game/settle.js`, `scripts/test-arena-settle.js`

**Produces:** `settleMatch({ matchId, players: { A: userId, B: userId }, result, cancelled }, { random, now }) → { settled, A: { lost, loot, rewarded, boosterId, credits }, B: … }`

### Task 7: Matchmaking

**Files:** Create `src/game/matchmaking.js`, `scripts/test-arena-matchmaking.js`

**Produces:** `configure({ isBusy, cardCount })`, `createChallenge(from, to, now)`, `acceptChallenge(id, userId)`, `refuseChallenge(id, userId)`, `joinQueue(userId, now)`, `leaveQueue(userId)`, `sweep(now) → { expiredChallenges, expiredQueue }`, `isWaiting(userId)`, `reset()`.

### Task 8: Cycle de vie des combats

**Files:** Create `src/game/matches.js`, `scripts/test-arena-matches.js`

**Produces:** `createMatchFor(userA, userB, now)`, `getMatch(id)`, `getMatchOf(userId)`, `isBusy(userId)`, `setDeck(id, userId, urls)`, `setReady(id, userId)`, `connect(id, userId, now)`, `disconnect(id, userId, now)`, `action(id, userId, action)`, `step(now)`, `subscribe(id, userId, fn) → unsubscribe`, `onEnd(fn)`, `start()` / `stop()` (setInterval 100 ms).
