# v2.3 — L'Arène en direct sur JP TV — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chaque combat de l'Arène entre deux joueurs est rediffusé en direct sur la TV du hall (« JP TV ») après une alerte « 🔴 PRIORITÉ AU DIRECT », et le dashboard affiche en rotation le classement de l'Arène et les derniers combats.

**Architecture:** Le bot (`slack-emoji-reactor-bot`) gagne une vue « spectateur » des combats et trois routes protégées par une clé TV : une page de diffusion plein écran, son flux SSE (5 Hz, suit tout seul le combat à l'antenne) et un JSON de synthèse (direct, classement, derniers combats). Le dashboard (`MagicDIMSI`, zéro dépendance) interroge ce JSON toutes les 5 s via un nouveau module `arene.js` ; dès qu'un combat est à l'antenne il pose par-dessus la rotation un calque plein écran contenant la page de diffusion en iframe, et il ajoute une carte « Arène » à la rotation.

**Tech Stack:** Node.js (module `http` natif, SSE), moteur de combat existant (`src/game/engine.js`), rendu SVG existant (`public/arena-board.js`), tests = scripts Node autonomes (`node scripts/test-*.js`) côté bot, `node --test` / scripts `assert` côté dashboard.

**Spec:** `docs/superpowers/specs/2026-10-06-v23-arene-direct-jp-tv-design.md`

## Global Constraints

- Tout en français : code, commentaires, commits, textes affichés.
- Bot : aucune nouvelle dépendance npm. Dashboard MagicDIMSI : **zéro dépendance** (contrainte du projet), Node ≥ 22.
- Combats diffusés : **uniquement les combats entre joueurs ayant réellement démarré** (pas ceux annulés en préparation). Tous les combats de `matches.js` sont entre deux joueurs humains.
- Deux combats en même temps : le premier lancé à l'antenne, les autres dans un bandeau « Aussi en direct : A 🆚 B ».
- Vrais noms Slack (même source que le classement : `userProfile`).
- Option joueur **« Ne pas me diffuser sur JP TV »** : si l'un des deux joueurs l'a activée, le combat n'est pas diffusé en direct ; il reste dans le classement et les derniers combats.
- La vue spectateur ne montre **ni la main ni l'élixir** des joueurs.
- Le **mode soir garde la priorité** : pas de direct de 17h45 à 19h (fenêtre du mode soir du dashboard), décidé côté serveur du dashboard.
- La TV est sur une IP whitelistée du reverse proxy : elle charge directement `https://dashboard-lorient.dimsi.cloud/jeanpip/tv/arena?k=…` (pas de relais).
- Fluidité limitée sur la TV acceptée en V1 : flux 5 Hz + interpolation, pas d'optimisation spécifique.
- Écran de fin d'un combat : 10 s, puis retour à la rotation.
- Version bot : **2.3** (`src/releases.js` en tête + `package.json` 2.3.0, tag `v2.3` après merge).
- Commits : messages en français avec emoji (style du dépôt), terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Redémarrage du bot pendant un direct** : les combats en mémoire disparaissent → la page TV doit passer en « idle » et le JSON renvoyer `onAir: false` (le calque du dashboard se referme, pas d'écran figé). Testé dans Task 4 (`pickFeatured` avec un combat disparu) et Task 5 (JSON sans combat).
2. **Historique ancien format** dans `data/arena.json` (pas de `players` sur les nuls, pas de `towers`) : les derniers combats ne doivent pas planter ni afficher « undefined ». Testé dans Task 1 (`recentResults` sur entrées anciennes).
3. **Deux combats simultanés, le premier se termine** : l'écran de fin du premier reste 10 s, puis bascule sur le second encore en cours ; un combat lancé pendant l'écran de fin n'interrompt pas celui-ci. Testé dans Task 4.
4. **Refus de diffusion activé par un seul des deux joueurs** : combat non diffusé, mais compté au classement et visible dans les derniers combats. Testé dans Task 3 et Task 5.
5. **Combat en cours pendant le mode soir** (17h45–19h) : pas de calque, `onAir: false`, la carte de classement reste. Testé dans Task 8.

---

# Partie A — Bot `slack-emoji-reactor-bot` (branche `claude/v2-3-arena-dashboard-23eedc`)

Lancer tous les tests du bot touchés à la fin de chaque tâche avec `node scripts/<fichier>.js` (chaque script affiche ✅/❌ par vérification et sort en code 1 en cas d'échec).

### Task 1: Historique des combats enrichi (joueurs, tours, raison, durée, arène)

**Files:**
- Modify: `src/game/engine.js` (fonction `endMatch`, ~l. 830-846)
- Modify: `src/game/settle.js` (`settleMatch`, ~l. 52-113)
- Modify: `src/game/matches.js` (`finish`, ~l. 258-269)
- Modify: `src/game/arenaStore.js` (en-tête, `recordResult` ~l. 143-176, nouvelle `recentResults`, `module.exports`)
- Test: `scripts/test-arena-store.js`, `scripts/test-arena-matches.js`

**Interfaces:**
- Produces:
  - `engine.result` gagne `towers: { A: number, B: number }` (tours détruites **par** A / **par** B) et `durationMs: number`.
  - `settleMatch({ matchId, players, result, cancelled, arena })` (nouveau paramètre `arena`, optionnel).
  - `arenaStore.recordResult({ matchId, at, winnerId, loserId, draw, loot, players, towers, reason, durationMs, arena })` — `players: [userId, userId]` désormais toujours fourni ; `towers: { [userId]: number } | null`.
  - `arenaStore.recentResults(limit = 5)` → `[{ matchId, at, players: [u1, u2], winnerId: string|null, draw: boolean, towers: { [userId]: number } | null, reason: string|null }]`, du plus récent au plus ancien.

- [ ] **Step 1: Write the failing tests**

Dans `scripts/test-arena-store.js`, insérer juste avant la ligne `try { require(path.join(TMP, 'src', 'db.js')).close(); } catch` :

```js
// 📺 v2.3 : historique enrichi + derniers combats (JP TV)
store.recordResult({
  matchId: 'h1', at: T0 + 10 * DAY, winnerId: 'UA', loserId: 'UB', draw: false,
  players: ['UA', 'UB'], towers: { UA: 3, UB: 1 }, reason: 'qg', durationMs: 95000, arena: 'port',
});
store.recordResult({
  matchId: 'h2', at: T0 + 11 * DAY, draw: true, players: ['UA', 'UC'],
  towers: { UA: 1, UC: 1 }, reason: 'draw', durationMs: 120000, arena: 'jardin',
});
({ store, collections } = restart());
const recent = store.recentResults(5);
check('derniers combats : le plus récent en premier', recent[0].matchId === 'h2' && recent[1].matchId === 'h1');
check('derniers combats : nul avec ses deux joueurs', recent[0].draw === true && recent[0].winnerId === null && recent[0].players.join() === 'UA,UC');
check('derniers combats : tours et raison gardées', recent[1].towers.UA === 3 && recent[1].towers.UB === 1 && recent[1].reason === 'qg');
check('derniers combats : limite respectée', store.recentResults(1).length === 1);
// Ancien format (avant v2.3) : victoire sans players/towers, nul sans joueurs
const legacy = store.recentResults(50).filter((h) => !['h1', 'h2'].includes(h.matchId));
check('ancien format : victoires reprises avec gagnant + perdant, sans tours', legacy.length > 0 && legacy.every((h) => h.players.length === 2 && h.players.every(Boolean) && h.towers === null));
check('ancien format : nuls sans joueurs ignorés', legacy.every((h) => !h.draw || h.players.length === 2));
```

Dans `scripts/test-arena-matches.js`, insérer juste avant la ligne `try { require(path.join(TMP, 'src', 'db.js')).close(); } catch` :

```js
// ─── 📺 v2.3 : historique enrichi à la fin d'un vrai combat ───
{
  giveCards('UE', 'e');
  giveCards('UF', 'f');
  const t = T + 2_000_000;
  const h = matches.createMatchFor('UE', 'UF', t, { arena: 'port' });
  matches.connect(h.id, 'UE', t);
  matches.connect(h.id, 'UF', t);
  matches.setReady(h.id, 'UE');
  matches.setReady(h.id, 'UF');
  matches.step(t + S);
  matches.action(h.id, 'UE', { type: 'forfeit' });
  matches.step(t + 2 * S);
  const last = arenaStore.recentResults(1)[0];
  check('historique : combat enregistré avec ses deux joueurs', last && last.matchId === h.id && last.players.slice().sort().join() === 'UE,UF');
  check('historique : vainqueur = celui qui n\'a pas abandonné', last.winnerId === 'UF' && last.draw === false);
  check('historique : raison + tours détruites par joueur', last.reason === 'forfeit' && last.towers && last.towers.UE === 0 && last.towers.UF === 0);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node scripts/test-arena-store.js` puis `node scripts/test-arena-matches.js`
Expected: FAIL — `store.recentResults is not a function` / `arenaStore.recentResults is not a function`.

- [ ] **Step 3: Implement**

`src/game/engine.js`, dans `endMatch`, remplacer l'objet `state.result = { … }` par :

```js
  state.result = {
    winner,
    reason,
    outOfCards: Boolean(state.outOfCards),   // fini avant 2:00 : toutes les cartes jouées
    // 📺 JP TV : tours détruites PAR chaque camp, durée réelle du combat
    towers: { A: towersDestroyed(state, 'B'), B: towersDestroyed(state, 'A') },
    durationMs: state.timeMs,
    // les poses « free » (Écho) n'engagent aucune carte : exclues du bilan
    poses: state.poses.filter((p) => !p.free).map(({ side, url, title, rarity, archetype, status }) => ({ side, url, title, rarity, archetype, status })),
  };
```

`src/game/settle.js` :
- signature : `function settleMatch({ matchId, players, result, cancelled, arena }, { random = Math.random, now = Date.now() } = {}) {`
- mettre à jour le JSDoc : `@param {{ matchId, players: { A: userId, B: userId }, result, cancelled, arena? }} match`
- juste après `const loser = winner === 'A' ? 'B' : winner === 'B' ? 'A' : null;`, ajouter :

```js
  // 📺 Détail du combat pour l'historique (derniers combats sur JP TV)
  const detail = {
    players: [players.A, players.B],
    towers: result.towers ? { [players.A]: result.towers.A, [players.B]: result.towers.B } : null,
    reason: result.reason || null,
    durationMs: typeof result.durationMs === 'number' ? result.durationMs : null,
    arena: arena || null,
  };
```

- remplacer `arenaStore.recordResult({ matchId, at: now, draw: true, players: [players.A, players.B] });` par
  `arenaStore.recordResult({ matchId, at: now, draw: true, ...detail });`
- remplacer `arenaStore.recordResult({ matchId, at: now, winnerId: w.userId, loserId: l.userId, draw: false, loot: w.loot });` par
  `arenaStore.recordResult({ matchId, at: now, winnerId: w.userId, loserId: l.userId, draw: false, loot: w.loot, ...detail });`

`src/game/matches.js`, dans `finish`, ajouter `arena: match.arena,` dans l'objet passé à `settleMatch` (après `result: match.engine.result,`).

`src/game/arenaStore.js` :
- en-tête, remplacer la ligne `history: [{ matchId, at, winnerId, loserId, draw }],` par
  `history: [{ matchId, at, winnerId, loserId, draw, players?, towers?, reason?, durationMs?, arena? }],   // détail depuis v2.3`
- signature : `function recordResult({ matchId, at, winnerId, loserId, draw, loot, players, towers, reason, durationMs, arena }) {`
- remplacer la ligne `data.history.push({ … });` par :

```js
  data.history.push({
    matchId, at, winnerId: draw ? null : winnerId, loserId: draw ? null : loserId, draw: Boolean(draw),
    players: Array.isArray(players) && players.length === 2 ? players.slice() : null,
    towers: towers || null, reason: reason || null,
    durationMs: typeof durationMs === 'number' ? durationMs : null, arena: arena || null,
  });
```

- après `weeklyTop`, ajouter :

```js
/**
 * 📺 Derniers combats (JP TV), du plus récent au plus ancien.
 * Ancien format (avant v2.3) : une victoire est reprise avec [gagnant, perdant]
 * et sans tours ; un nul sans joueurs est ignoré.
 */
function recentResults(limit = 5) {
  const out = [];
  const history = load().history;
  for (let i = history.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const h = history[i];
    const players = Array.isArray(h.players) && h.players.length === 2 ? h.players
      : (!h.draw && h.winnerId && h.loserId ? [h.winnerId, h.loserId] : null);
    if (!players) continue;
    out.push({
      matchId: h.matchId, at: h.at, players, winnerId: h.draw ? null : h.winnerId || null, draw: Boolean(h.draw),
      towers: h.towers || null, reason: h.reason || null,
    });
  }
  return out;
}
```

- ajouter `recentResults,` dans `module.exports` (à côté de `weeklyTop`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node scripts/test-arena-store.js && node scripts/test-arena-matches.js && node scripts/test-arena-settle.js && node scripts/test-arena-engine.js`
Expected: `✅ Tout est bon` pour chacun.

- [ ] **Step 5: Commit**

```bash
git add src/game/engine.js src/game/settle.js src/game/matches.js src/game/arenaStore.js scripts/test-arena-store.js scripts/test-arena-matches.js
git commit -m "📺 v2.3 : historique des combats enrichi (joueurs, tours, raison, durée)"
```

---

### Task 2: Option « Ne pas me diffuser sur JP TV » (stockage, API, page Mon deck)

**Files:**
- Modify: `src/game/arenaStore.js` (en-tête, `load` → clé `tvOptOut`, nouvelles `isTvOptOut` / `setTvOptOut`, exports)
- Modify: `src/game/arenaWeb.js` (`handleDeckApi`, ~l. 309-333)
- Modify: `public/deck.html`, `public/deck.js`, `public/arena.css`
- Test: `scripts/test-arena-store.js`, `scripts/test-arena-web.js`

**Interfaces:**
- Produces:
  - `arenaStore.isTvOptOut(userId) → boolean`, `arenaStore.setTvOptOut(userId, optOut: boolean) → boolean`
  - `GET api/deck?t=` renvoie en plus `tvOptOut: boolean` ; `POST api/deck?t=` accepte `{ tvOptOut: boolean }` → `{ ok: true, tvOptOut }`.

- [ ] **Step 1: Write the failing tests**

`scripts/test-arena-store.js`, juste avant `try { require(path.join(TMP, 'src', 'db.js')).close(); } catch` :

```js
// 📺 Refus de diffusion sur JP TV
check('JP TV : diffusé par défaut', store.isTvOptOut('UA') === false);
store.setTvOptOut('UA', true);
({ store, collections } = restart());
check('JP TV : refus gardé après redémarrage', store.isTvOptOut('UA') === true);
store.setTvOptOut('UA', false);
check('JP TV : refus retiré', store.isTvOptOut('UA') === false);
```

`scripts/test-arena-web.js`, juste avant la ligne `sA.close(); sB.close(); sA2.close();` :

```js
  // 📺 Option « Ne pas me diffuser sur JP TV » (Mon deck)
  const tvGet = await request('GET', `api/deck?t=${encodeURIComponent(dt)}`);
  check('Mon deck : diffusion JP TV active par défaut', tvGet.json && tvGet.json.tvOptOut === false);
  const tvPost = await request('POST', `api/deck?t=${encodeURIComponent(dt)}`, { tvOptOut: true });
  check('Mon deck : refus de diffusion enregistré', tvPost.json && tvPost.json.ok === true && tvPost.json.tvOptOut === true);
  check('Mon deck : refus relu', (await request('GET', `api/deck?t=${encodeURIComponent(dt)}`)).json.tvOptOut === true);
  check('Mon deck : le refus ne touche pas aux decks', (await request('GET', `api/deck?t=${encodeURIComponent(dt)}`)).json.decks[0].name === 'Nouveau');
  await request('POST', `api/deck?t=${encodeURIComponent(dt)}`, { tvOptOut: false });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node scripts/test-arena-store.js` puis `node scripts/test-arena-web.js`
Expected: FAIL — `store.isTvOptOut is not a function` ; côté web `tvOptOut` undefined.

- [ ] **Step 3: Implement**

`src/game/arenaStore.js` :
- en-tête, ajouter la ligne `//      tvOptOut: { U123: true },   // 📺 « Ne pas me diffuser sur JP TV » (v2.3)` après la ligne `streaks`.
- dans `load()`, ajouter `tvOptOut: {}` à l'objet `empty` (après `streaks: {}`).
- après `markTutorialSeen`, ajouter :

```js
// ─────────────────────────────────────────────
// 📺 JP TV : refus de diffusion en direct
// ─────────────────────────────────────────────

function isTvOptOut(userId) {
  return Boolean(load().tvOptOut[userId]);
}

function setTvOptOut(userId, optOut) {
  const data = load();
  if (optOut) data.tvOptOut[userId] = true;
  else delete data.tvOptOut[userId];
  save(data);
  return Boolean(optOut);
}
```

- exporter `isTvOptOut, setTvOptOut`.

`src/game/arenaWeb.js`, `handleDeckApi` :
- dans la réponse GET, ajouter `tvOptOut: arenaStore.isTvOptOut(userId),` après `tutorialSeen: …,`.
- dans le POST, juste après le bloc `if (body.tutorial === true) { … }`, ajouter :

```js
    if (typeof body.tvOptOut === 'boolean') {
      return ctx.sendJson(res, 200, { ok: true, tvOptOut: arenaStore.setTvOptOut(userId, body.tvOptOut) });
    }
```

- mettre à jour l'en-tête du module : `//    POST /api/deck?t=                 → enregistre mes decks ({ tutorial: true } : tuto vu ; { tvOptOut } : JP TV)`.

`public/deck.html`, dans `<div class="head-btns">`, avant le bouton 🏆 :

```html
        <label class="tv-opt" title="Tes combats passent en direct sur la TV du hall (JP TV)">
          <input type="checkbox" id="tv-opt"> Ne pas me diffuser sur JP TV
        </label>
```

`public/deck.js`, dans le `.then((data) => { … })`, juste après `status.hidden = true;` :

```js
      // 📺 JP TV : refus de diffusion en direct (enregistré tout de suite)
      const tvOpt = document.getElementById('tv-opt');
      tvOpt.checked = Boolean(data.tvOptOut);
      tvOpt.addEventListener('change', () => fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tvOptOut: tvOpt.checked }),
      }).catch(() => { status.hidden = false; status.textContent = 'Enregistrement impossible, vérifie ta connexion.'; }));
```

et compléter le commentaire d'en-tête : `//                      { tvOptOut: bool }   (📺 ne pas me diffuser sur JP TV)`.

`public/arena.css`, après la règle `.head-btns { … }` :

```css
.tv-opt { display: inline-flex; align-items: center; gap: 6px; font: 600 13px 'Inter Tight', sans-serif; color: var(--i7); cursor: pointer; white-space: nowrap; }
.tv-opt input { width: 16px; height: 16px; accent-color: var(--blue); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node scripts/test-arena-store.js && node scripts/test-arena-web.js`
Expected: `✅ Tout est bon`.

- [ ] **Step 5: Commit**

```bash
git add src/game/arenaStore.js src/game/arenaWeb.js public/deck.html public/deck.js public/arena.css scripts/test-arena-store.js scripts/test-arena-web.js
git commit -m "📺 v2.3 : option « Ne pas me diffuser sur JP TV » dans Mon deck"
```

---

### Task 3: Vue spectateur dans `matches.js`

**Files:**
- Modify: `src/game/matches.js` (en-tête, `startMatch`, `broadcast`, nouvelles `spectatorView` / `subscribeSpectator` / `listForTv`, exports)
- Test: `scripts/test-arena-matches.js`

**Interfaces:**
- Consumes: `arenaStore.isTvOptOut(userId)` (Task 2), `engine.result.towers` (Task 1).
- Produces:
  - `match.startedAt: number` et `match.broadcast: boolean` posés au démarrage du combat.
  - `matches.spectatorView(match)` → en combat : `{ matchId, phase: 'running', arena, you: 'A', ...engine.publicState(engine, null) }` avec `players.A/B` **sans** `elixir`, `elixirMax`, `hand`, `next` ; à la fin : `{ matchId, phase: 'ended'|'cancelled', arena, cancelReason, result: { winner, reason, towers } | null }`.
  - `matches.subscribeSpectator(fn: (match, events) => void) → () => void` : appelé à chaque diffusion d'un combat avec `broadcast === true`.
  - `matches.listForTv() → [{ id, status, startedAt, endedAt, broadcast, arena, players: { A: userId, B: userId } }]` (combats ayant démarré, encore en mémoire).

- [ ] **Step 1: Write the failing test**

`scripts/test-arena-matches.js`, juste avant `try { require(path.join(TMP, 'src', 'db.js')).close(); } catch` :

```js
// ─── 📺 v2.3 : JP TV (spectateurs) ───
{
  giveCards('UG', 'g');
  giveCards('UH', 'h');
  const seen = [];
  const off = matches.subscribeSpectator((match, evts) => seen.push({ id: match.id, events: evts.length }));
  const start = (id, t) => {
    matches.connect(id, 'UG', t);
    matches.connect(id, 'UH', t);
    matches.setReady(id, 'UG');
    matches.setReady(id, 'UH');
  };
  const t = T + 3_000_000;
  const tv = matches.createMatchFor('UG', 'UH', t);
  start(tv.id, t);
  check('JP TV : rien diffusé pendant la préparation', seen.length === 0);
  check('JP TV : un combat en préparation n\'est pas listé', !matches.listForTv().some((m) => m.id === tv.id));
  matches.step(t + S);
  const mt = matches.getMatch(tv.id);
  check('JP TV : combat lancé → diffusable, heure de début notée', mt.broadcast === true && mt.startedAt === t + S);
  check('JP TV : spectateurs prévenus', seen.some((s) => s.id === tv.id));
  const sv = matches.spectatorView(mt);
  check('JP TV : vue spectateur en combat, camp A en bas', sv.phase === 'running' && sv.you === 'A' && sv.arena === 'jardin');
  check('JP TV : ni main ni élixir des joueurs', ['A', 'B'].every((s) => sv.players[s].hand === undefined && sv.players[s].elixir === undefined && sv.players[s].elixirMax === undefined));
  check('JP TV : terrain visible (bâtiments)', Array.isArray(sv.buildings) && sv.buildings.length > 0);
  check('JP TV : listForTv le contient', matches.listForTv().some((m) => m.id === tv.id && m.status === 'running' && m.players.A === mt.players.A.userId && m.broadcast));
  matches.action(tv.id, 'UG', { type: 'forfeit' });
  matches.step(t + 2 * S);
  const ev = matches.spectatorView(mt);
  check('JP TV : vue de fin = vainqueur, raison, tours', ev.phase === 'ended' && ev.result.reason === 'forfeit' && ev.result.winner && ev.result.towers && ev.result.poses === undefined);
  off();
  const before = seen.length;

  // Refus de diffusion d'un seul joueur → combat non diffusé, mais bien compté
  arenaStore.setTvOptOut('UG', true);
  const t2 = t + 60 * S;
  const tv2 = matches.createMatchFor('UG', 'UH', t2);
  const seen2 = [];
  const off2 = matches.subscribeSpectator((match) => seen2.push(match.id));
  start(tv2.id, t2);
  matches.step(t2 + S);
  check('JP TV : un joueur refuse → combat non diffusé', matches.getMatch(tv2.id).broadcast === false && !seen2.includes(tv2.id));
  matches.action(tv2.id, 'UH', { type: 'forfeit' });
  matches.step(t2 + 2 * S);
  check('JP TV : combat non diffusé quand même dans les derniers combats', arenaStore.recentResults(1)[0].matchId === tv2.id);
  check('JP TV : désabonné → plus rien reçu', seen.length === before);
  off2();
  arenaStore.setTvOptOut('UG', false);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-arena-matches.js`
Expected: FAIL — `matches.subscribeSpectator is not a function`.

- [ ] **Step 3: Implement**

`src/game/matches.js` :

- en-tête, ajouter après le paragraphe « Fin » :

```js
//  • 📺 JP TV (v2.3) : un combat démarré est « diffusable » sauf si l'un
//    des joueurs a coché « Ne pas me diffuser » ; les spectateurs
//    (subscribeSpectator) reçoivent une vue sans main ni élixir.
```

- sous `const endListeners = [];`, ajouter `const spectators = new Set();   // 📺 JP TV : fn(match, events)`

- dans `startMatch`, juste après `match.lastStepAt = now;`, ajouter :

```js
  match.startedAt = now;
  // 📺 JP TV : diffusé sauf refus d'un des deux joueurs (figé au lancement)
  match.broadcast = !arenaStore.isTvOptOut(match.players.A.userId) && !arenaStore.isTvOptOut(match.players.B.userId);
```

- dans `createMatchFor`, ajouter `startedAt: null,` et `broadcast: false,` dans l'objet `match` (après `endedAt: null,`).

- remplacer le début de `broadcast` :

```js
function broadcast(match, events = []) {
  if (match.broadcast) {
    for (const fn of spectators) {
      try {
        fn(match, events);
      } catch (e) {
        console.error('[arena] diffusion JP TV:', e.message);
      }
    }
  }
  const subs = subscribers.get(match.id);
  if (!subs) return;
```

(le reste de la fonction ne change pas).

- après `subscribe`, ajouter :

```js
// ─────────────────────────────────────────────
// 📺 JP TV : vue spectateur (ni main ni élixir) + abonnés
// ─────────────────────────────────────────────

function spectatorView(match) {
  const base = { matchId: match.id, arena: match.arena };
  if (match.status === 'running') {
    const state = engine.publicState(match.engine, null);
    const players = {};
    for (const side of ['A', 'B']) {
      const { elixir, elixirMax, hand, next, ...rest } = state.players[side];
      players[side] = rest;
    }
    return { ...base, phase: 'running', ...state, you: 'A', players };
  }
  const r = match.engine && match.engine.result;
  return {
    ...base,
    phase: match.status,
    cancelReason: match.cancelReason || null,
    result: r ? { winner: r.winner, reason: r.reason, towers: r.towers || null } : null,
  };
}

/** S'abonner à tous les combats diffusables. → désabonnement */
function subscribeSpectator(fn) {
  spectators.add(fn);
  return () => spectators.delete(fn);
}

/** Combats démarrés encore en mémoire (en cours, ou finis depuis < 10 min). */
function listForTv() {
  return [...matches.values()].filter((m) => m.startedAt !== null && m.startedAt !== undefined).map((m) => ({
    id: m.id, status: m.status, startedAt: m.startedAt, endedAt: m.endedAt, broadcast: Boolean(m.broadcast), arena: m.arena,
    players: { A: m.players.A.userId, B: m.players.B.userId },
  }));
}
```

- ajouter `spectatorView, subscribeSpectator, listForTv,` à `module.exports`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node scripts/test-arena-matches.js && node scripts/test-arena-web.js`
Expected: `✅ Tout est bon`.

- [ ] **Step 5: Commit**

```bash
git add src/game/matches.js scripts/test-arena-matches.js
git commit -m "📺 v2.3 : vue spectateur des combats (sans main ni élixir)"
```

---

### Task 4: Choix du combat à l'antenne (`tvFeed.js`, logique pure)

**Files:**
- Create: `src/game/tvFeed.js`
- Test: `scripts/test-tv-feed.js`

**Interfaces:**
- Consumes: la forme de `matches.listForTv()` (Task 3).
- Produces:
  - `tvFeed.END_HOLD_MS = 10000`, `tvFeed.SEND_EVERY_MS = 200`
  - `tvFeed.pickFeatured(prevId: string|null, list, now: number) → { featuredId: string|null, also: string[] }`
  - `tvFeed.isOnAir(list, now: number) → boolean`

Règles : à l'antenne = combat `broadcast` en `running`, ou terminé (`ended`/`cancelled`) depuis moins de `END_HOLD_MS`. Le combat déjà à l'antenne (`prevId`) y reste tant qu'il est à l'antenne (y compris pendant son écran de fin). Sinon : le combat en cours lancé en premier. Un combat fini n'est **jamais** choisi s'il n'était pas déjà à l'antenne. `also` = les autres combats en cours diffusables, du plus ancien au plus récent.

- [ ] **Step 1: Write the failing test**

Créer `scripts/test-tv-feed.js` :

```js
#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test du choix du combat à l'antenne de JP TV (src/game/tvFeed.js)
//  Logique pure : aucune copie du projet nécessaire.
//  Usage : node scripts/test-tv-feed.js
// ═══════════════════════════════════════════════════════════
const path = require('path');
const tvFeed = require(path.join(__dirname, '..', 'src', 'game', 'tvFeed.js'));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const S = 1000;
const NOW = 1_000_000;
const m = (id, status, startedAt, extra = {}) => ({ id, status, startedAt, endedAt: null, broadcast: true, arena: 'jardin', players: { A: `${id}A`, B: `${id}B` }, ...extra });

check('aucun combat → rien à l\'antenne', tvFeed.pickFeatured(null, [], NOW).featuredId === null && !tvFeed.isOnAir([], NOW));

const one = [m('m1', 'running', NOW - 30 * S)];
check('un combat en cours → à l\'antenne', tvFeed.pickFeatured(null, one, NOW).featuredId === 'm1' && tvFeed.isOnAir(one, NOW));

const notBroadcast = [m('m1', 'running', NOW - 30 * S, { broadcast: false })];
check('refus de diffusion → jamais à l\'antenne', tvFeed.pickFeatured(null, notBroadcast, NOW).featuredId === null && !tvFeed.isOnAir(notBroadcast, NOW));

const two = [m('m2', 'running', NOW - 10 * S), m('m1', 'running', NOW - 30 * S)];
const p2 = tvFeed.pickFeatured(null, two, NOW);
check('deux combats → le premier lancé à l\'antenne', p2.featuredId === 'm1');
check('deux combats → l\'autre dans « Aussi en direct »', p2.also.join() === 'm2');

const keep = tvFeed.pickFeatured('m2', two, NOW);
check('le combat déjà à l\'antenne y reste', keep.featuredId === 'm2' && keep.also.join() === 'm1');

const endedHold = [m('m1', 'ended', NOW - 90 * S, { endedAt: NOW - 3 * S }), m('m2', 'running', NOW - 10 * S)];
const hold = tvFeed.pickFeatured('m1', endedHold, NOW);
check('écran de fin : le combat fini reste 10 s', hold.featuredId === 'm1' && hold.also.join() === 'm2');
check('écran de fin : toujours « à l\'antenne »', tvFeed.isOnAir([endedHold[0]], NOW));

const after = tvFeed.pickFeatured('m1', endedHold, NOW + 8 * S);
check('après l\'écran de fin → bascule sur le combat suivant', after.featuredId === 'm2' && after.also.length === 0);

const lateTv = tvFeed.pickFeatured(null, [endedHold[0]], NOW);
check('un combat déjà fini n\'est jamais pris en cours de route', lateTv.featuredId === null);

const cancelled = [m('m1', 'cancelled', NOW - 50 * S, { endedAt: NOW - 2 * S })];
check('combat annulé en cours de route : écran de fin aussi', tvFeed.pickFeatured('m1', cancelled, NOW).featuredId === 'm1');

const vanished = tvFeed.pickFeatured('m1', [], NOW);
check('combat disparu (redémarrage du bot) → plus rien à l\'antenne', vanished.featuredId === null && !tvFeed.isOnAir([], NOW));

const old = [m('m1', 'ended', NOW - 200 * S, { endedAt: NOW - 11 * S })];
check('fini depuis plus de 10 s → plus à l\'antenne', !tvFeed.isOnAir(old, NOW) && tvFeed.pickFeatured('m1', old, NOW).featuredId === null);

console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-tv-feed.js`
Expected: FAIL — `Cannot find module …/src/game/tvFeed.js`.

- [ ] **Step 3: Implement**

Créer `src/game/tvFeed.js` :

```js
// ═══════════════════════════════════════════════════════════
//  📺 JP TV — quel combat est à l'antenne ? (logique pure, sans I/O)
//
//  À l'antenne = combat diffusable (aucun refus des joueurs) en cours,
//  ou fini/annulé depuis moins de END_HOLD_MS (écran de fin).
//  Le combat déjà à l'antenne y reste jusqu'au bout de son écran de fin ;
//  sinon on prend le combat en cours lancé le premier. Les autres combats
//  en cours vont dans le bandeau « Aussi en direct ».
//  Entrée : matches.listForTv() → [{ id, status, startedAt, endedAt, broadcast }]
// ═══════════════════════════════════════════════════════════

const END_HOLD_MS = 10 * 1000;   // écran de fin
const SEND_EVERY_MS = 200;       // flux TV à 5 Hz

const isRunning = (m) => m.broadcast && m.status === 'running';
const inHold = (m, now) => m.broadcast && (m.status === 'ended' || m.status === 'cancelled')
  && typeof m.endedAt === 'number' && now - m.endedAt < END_HOLD_MS;
const byStart = (a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id);

function pickFeatured(prevId, list, now) {
  const running = list.filter(isRunning).sort(byStart);
  const prev = prevId ? list.find((m) => m.id === prevId) : null;
  const featured = prev && (isRunning(prev) || inHold(prev, now)) ? prev : running[0] || null;
  return {
    featuredId: featured ? featured.id : null,
    also: running.filter((m) => !featured || m.id !== featured.id).map((m) => m.id),
  };
}

function isOnAir(list, now) {
  return list.some((m) => isRunning(m) || inHold(m, now));
}

module.exports = { END_HOLD_MS, SEND_EVERY_MS, pickFeatured, isOnAir };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/test-tv-feed.js`
Expected: `✅ Tout est bon`.

- [ ] **Step 5: Commit**

```bash
git add src/game/tvFeed.js scripts/test-tv-feed.js
git commit -m "📺 v2.3 : choix du combat à l'antenne de JP TV"
```

---

### Task 5: Routes JP TV (`tvWeb.js`) : JSON de synthèse + flux SSE + clé TV

**Files:**
- Create: `src/game/tvWeb.js`
- Create: `scripts/tv-urls.js`
- Modify: `src/game/arenaWeb.js` (exporter `combatAssets`)
- Modify: `src/web.js` (en-tête, `require`, `configureTv`, routage, `startWebServer`, export `buildTvUrls`)
- Test: `scripts/test-tv-web.js`

**Interfaces:**
- Consumes: `matches.listForTv / spectatorView / subscribeSpectator / getMatch` (Task 3), `tvFeed` (Task 4), `arenaStore.ranking / recentResults` (Task 1), `arenaWeb.compact`, `arenaWeb.combatAssets`.
- Produces:
  - `GET /tv/arena?k=` → page `public/tv.html` (Task 6 ; avant Task 6, 404 accepté).
  - `GET /api/tv/arena?k=` → `{ status: 'ok', onAir: boolean, live: [{ matchId, a, b, startedAt, arena }], ranking: [{ rank, name, wins, losses, draws, winRate }] (≤ 7), recent: [{ at, a, b, winner: string|null, draw: boolean, towers: [number, number] | null, reason: string|null }] (≤ 5), updated: ISO }`. Clé absente/fausse → 403 `{ status: 'invalid' }`.
  - `GET /api/tv/stream?k=` → SSE : `idle` `{}` ; `setup` `{ matchId, arena, names: { A, B }, captains, specialties, symbols, sprites, images }` ; `state` (état différentiel `arena-wire`, vue `compact`, 5 Hz) ; `ended` `{ matchId, phase, names, result, cancelReason }` (une fois) ; `also` `[{ a, b }]` (à chaque changement).
  - `web.buildTvUrls() → { page, api } | null` (URL publiques avec la clé).

- [ ] **Step 1: Write the failing test**

Créer `scripts/test-tv-web.js` :

```js
#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test des routes JP TV (src/game/tvWeb.js via web.js)
//  Vrai serveur, vrai flux SSE, dans une COPIE temporaire du projet :
//  clé TV, JSON vide, combat lancé → alerte (setup) + états sans main
//  ni élixir, « Aussi en direct », fin → écran de fin, derniers combats.
//  Usage : node scripts/test-tv-web.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-tv-web-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

process.env.WEB_PUBLIC_URL = 'http://jeanpip.test';
process.env.WEB_SECRET = 'test-secret';
let PORT = 0;

const origLog = console.log;
console.log = () => {};
const web = require(path.join(TMP, 'src', 'web.js'));
const matches = require(path.join(TMP, 'src', 'game', 'matches.js'));
const arenaStore = require(path.join(TMP, 'src', 'game', 'arenaStore.js'));
const collections = require(path.join(TMP, 'src', 'collections.js'));
const media = require(path.join(TMP, 'src', 'media.js'));
const wire = require(path.join(TMP, 'public', 'arena-wire.js'));
console.log = origLog;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const quiet = { info: () => {}, warn: () => {}, error: (...a) => console.error(...a) };
const NAMES = { UA: 'Paul', UB: 'Julie', UC: 'Marc', UD: 'Léa' };
const client = { users: { info: async ({ user }) => ({ user: { profile: { display_name: NAMES[user] || user } } }) } };

function request(pathQ) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: `/${pathQ}` }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* HTML */ }
        resolve({ status: res.statusCode, body: data, json });
      });
    }).on('error', reject);
  });
}

function openStream(pathQ) {
  const events = [];
  const decoder = wire.createDecoder();
  const req = http.get({ host: '127.0.0.1', port: PORT, path: `/${pathQ}` }, (res) => {
    let buf = '';
    res.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(block);
        const data = /^data: (.+)$/m.exec(block);
        if (!ev || !data) continue;
        if (ev[1] === 'setup') decoder.reset();
        const parsed = JSON.parse(data[1]);
        events.push({ event: ev[1], data: ev[1] === 'state' ? decoder.decode(parsed) : parsed });
      }
    });
  });
  req.on('error', () => {});
  return { events, close: () => req.destroy() };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await wait(50);
  }
  return false;
}
const launch = (a, b) => {
  const m = matches.createMatchFor(a, b, Date.now());
  for (const u of [a, b]) {
    matches.connect(m.id, u, Date.now());
    matches.setReady(m.id, u);
  }
  return m.id;
};

(async () => {
  const bank = media.getAllMedia();
  collections.addCards('UA', bank.slice(0, 10));
  collections.addCards('UB', bank.slice(10, 20));
  collections.addCards('UC', bank.slice(20, 30));
  collections.addCards('UD', bank.slice(30, 40));

  const server = web.startWebServer({ client, logger: quiet, port: 0, force: true });
  await until(() => server.address());
  PORT = server.address().port;

  const urls = web.buildTvUrls();
  check('liens JP TV construits avec la clé', urls && /^http:\/\/jeanpip\.test\/tv\/arena\?k=[a-f0-9]{32}$/.test(urls.page) && urls.api.startsWith('http://jeanpip.test/api/tv/arena?k='));
  const k = new URL(urls.page).searchParams.get('k');

  check('JSON : clé absente refusée', (await request('api/tv/arena')).status === 403);
  check('JSON : mauvaise clé refusée', (await request('api/tv/arena?k=0123456789abcdef0123456789abcdef')).status === 403);
  check('flux : mauvaise clé refusée', (await request('api/tv/stream?k=nope')).status === 403);
  const empty = (await request(`api/tv/arena?k=${k}`)).json;
  check('JSON : rien à l\'antenne au départ', empty.status === 'ok' && empty.onAir === false && empty.live.length === 0 && empty.recent.length === 0);

  const tv = openStream(`api/tv/stream?k=${k}`);
  check('flux : « idle » tant qu\'aucun combat', await until(() => tv.events.some((e) => e.event === 'idle')));

  // Combat 1 (UA/UB) puis combat 2 (UC/UD), lancé après
  const id1 = launch('UA', 'UB');
  matches.step(Date.now());
  await wait(30);   // le 2e combat démarre forcément après le 1er
  const id2 = launch('UC', 'UD');
  matches.step(Date.now());

  check('flux : setup du 1er combat (alerte « Priorité au direct »)', await until(() => tv.events.some((e) => e.event === 'setup' && e.data.matchId === id1)));
  const setup = tv.events.find((e) => e.event === 'setup');
  const m1 = matches.getMatch(id1);
  check('flux : vrais noms des deux camps', setup.data.names.A === NAMES[m1.players.A.userId] && setup.data.names.B === NAMES[m1.players.B.userId]);
  check('flux : dessins des cartes fournis', typeof setup.data.symbols === 'string' && setup.data.symbols.length > 0);
  check('flux : états reçus', await until(() => tv.events.some((e) => e.event === 'state')));
  const st = tv.events.filter((e) => e.event === 'state').pop().data;
  check('flux : ni main ni élixir', ['A', 'B'].every((s) => !st.players[s].hand && (st.players[s].elixir === null || st.players[s].elixir === undefined)));
  check('flux : « Aussi en direct » = 2e combat', await until(() => tv.events.some((e) => e.event === 'also' && e.data.length === 1 && e.data[0].a && e.data[0].b)));

  const live = (await request(`api/tv/arena?k=${k}`)).json;
  check('JSON : à l\'antenne, 2 combats en direct, le 1er lancé en tête', live.onAir === true && live.live.length === 2 && live.live[0].matchId === id1 && live.live[0].a === NAMES[m1.players.A.userId]);

  // Fin du 1er combat → écran de fin, puis derniers combats + classement
  matches.action(id1, m1.players.A.userId, { type: 'forfeit' });
  matches.step(Date.now());
  check('flux : écran de fin du 1er combat', await until(() => tv.events.some((e) => e.event === 'ended' && e.data.matchId === id1 && e.data.result && e.data.result.reason === 'forfeit')));
  const after = (await request(`api/tv/arena?k=${k}`)).json;
  check('JSON : dernier combat avec noms, vainqueur et tours', after.recent.length === 1 && after.recent[0].winner === NAMES[m1.players.B.userId] && Array.isArray(after.recent[0].towers) && after.recent[0].draw === false);
  check('JSON : classement avec vrais noms', after.ranking.length === 2 && after.ranking[0].name === NAMES[m1.players.B.userId] && after.ranking[0].wins === 1);
  check('JSON : toujours à l\'antenne (2e combat en cours)', after.onAir === true);

  // Refus de diffusion : combat non diffusé mais classé
  matches.action(id2, 'UC', { type: 'forfeit' });
  matches.step(Date.now());
  arenaStore.setTvOptOut('UA', true);
  const id3 = launch('UA', 'UB');
  matches.step(Date.now());
  const hidden = (await request(`api/tv/arena?k=${k}`)).json;
  check('refus de diffusion : combat absent du direct', !hidden.live.some((m) => m.matchId === id3));

  tv.close();
  matches.stop();
  server.close();
  try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-tv-web.js`
Expected: FAIL — `web.buildTvUrls is not a function`.

- [ ] **Step 3: Implement**

`src/game/arenaWeb.js` : exporter `combatAssets` :
`module.exports = { configure, route, buildArenaUrl, buildDeckUrl, compact, combatAssets };`

Créer `src/game/tvWeb.js` :

```js
// ═══════════════════════════════════════════════════════════
//  📺 MODULE JP TV — l'Arène en direct sur la TV du hall (v2.3)
//  (branché dans src/web.js)
//
//    GET /tv/arena?k=        → page de diffusion plein écran (public/tv.html)
//    GET /api/tv/stream?k=   → flux SSE du combat à l'antenne (5 Hz)
//    GET /api/tv/arena?k=    → { onAir, live, ranking, recent } pour le
//                              dashboard MagicDIMSI (module arene.js)
//
//  Clé TV = hmac(« tv|jp-tv ») tronqué à 32 caractères : un seul lien,
//  non personnel (la TV n'a pas de compte Slack). `node scripts/tv-urls.js`
//  affiche les deux URL à mettre dans arene.config.json du dashboard.
//
//  Flux : une boucle par TV connectée, toutes les 200 ms (5 Hz) :
//    • choix du combat à l'antenne (tvFeed.pickFeatured) ;
//    • changement → « setup » (noms + dessins ; la page affiche l'alerte
//      « PRIORITÉ AU DIRECT ») ou « idle » ;
//    • combat en cours → « state » (vue spectateur allégée, différentielle,
//      avec les événements accumulés depuis le dernier envoi) ;
//    • fin → « ended » une fois (écran de fin 10 s) ;
//    • « also » quand la liste « Aussi en direct » change.
// ═══════════════════════════════════════════════════════════

const crypto = require('crypto');

const matches = require('./matches');
const arenaStore = require('./arenaStore');
const arenaWeb = require('./arenaWeb');
const tvFeed = require('./tvFeed');
const wire = require('../../public/arena-wire');
const { CAPTAINS } = require('./captains');
const specialties = require('./specialties');

const PING_MS = 15 * 1000;
const RANKING_SIZE = 7;
const RECENT_SIZE = 5;
const TV_ASSETS = ['tv.css', 'arena-wire.js', 'arena-board.js', 'tv.js'];

let ctx = null;   // { publicUrl, getSecret, send, sendJson, servePage, userProfile, client, logger }

function configure(context) {
  ctx = context;
}

// ─────────────────────────────────────────────
// 🔐 Clé TV
// ─────────────────────────────────────────────

function tvKey() {
  return crypto.createHmac('sha256', ctx.getSecret()).update('tv|jp-tv').digest('hex').slice(0, 32);
}

function validKey(k) {
  const expected = Buffer.from(tvKey());
  const given = Buffer.from(String(k || ''));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** → { page, api } (URL publiques avec la clé) ou null si la page web est désactivée. */
function buildTvUrls() {
  if (!ctx || !ctx.publicUrl) return null;
  const k = tvKey();
  return { page: `${ctx.publicUrl}/tv/arena?k=${k}`, api: `${ctx.publicUrl}/api/tv/arena?k=${k}` };
}

async function nameOf(userId) {
  const p = await ctx.userProfile(ctx.client, userId, ctx.logger);
  return (p && p.name) || 'Joueur';
}

// ─────────────────────────────────────────────
// 📊 Synthèse pour le dashboard
// ─────────────────────────────────────────────

async function summary(now = Date.now()) {
  const list = matches.listForTv();
  const running = list.filter((m) => m.broadcast && m.status === 'running')
    .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  const live = await Promise.all(running.map(async (m) => ({
    matchId: m.id, a: await nameOf(m.players.A), b: await nameOf(m.players.B), startedAt: m.startedAt, arena: m.arena,
  })));
  const ranking = await Promise.all(arenaStore.ranking({ limit: RANKING_SIZE }).top.map(async (r) => ({
    rank: r.rank, name: await nameOf(r.userId), wins: r.wins, losses: r.losses, draws: r.draws, winRate: r.winRate,
  })));
  const recent = await Promise.all(arenaStore.recentResults(RECENT_SIZE).map(async (h) => ({
    at: h.at,
    a: await nameOf(h.players[0]),
    b: await nameOf(h.players[1]),
    winner: h.draw || !h.winnerId ? null : await nameOf(h.winnerId),
    draw: h.draw,
    towers: h.towers ? [h.towers[h.players[0]] || 0, h.towers[h.players[1]] || 0] : null,
    reason: h.reason,
  })));
  return { status: 'ok', onAir: tvFeed.isOnAir(list, now), live, ranking, recent, updated: new Date(now).toISOString() };
}

// ─────────────────────────────────────────────
// 📡 Flux SSE de la TV
// ─────────────────────────────────────────────

function handleStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
  });
  if (res.socket) res.socket.setNoDelay(true);
  res.write('retry: 2000\n\n');

  let closed = false;
  const write = (event, data) => { if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  const encoder = wire.createEncoder();
  let featuredId = null;
  let phase = null;
  let names = null;
  let alsoKey = '';
  let pending = [];
  let busy = false;

  const unsubscribe = matches.subscribeSpectator((match, events) => {
    if (match.id === featuredId && events.length) pending.push(...events);
  });

  async function tick() {
    if (busy || closed) return;
    busy = true;
    try {
      const now = Date.now();
      const list = matches.listForTv();
      const pick = tvFeed.pickFeatured(featuredId, list, now);

      const key = pick.also.join('|');
      if (key !== alsoKey) {
        alsoKey = key;
        write('also', await Promise.all(pick.also.map(async (id) => {
          const m = list.find((x) => x.id === id);
          return { a: await nameOf(m.players.A), b: await nameOf(m.players.B) };
        })));
      }

      if (pick.featuredId !== featuredId) {
        featuredId = pick.featuredId;
        phase = null;
        pending = [];
        if (!featuredId) write('idle', {});
      }
      const match = featuredId ? matches.getMatch(featuredId) : null;
      if (!match) return;
      const view = matches.spectatorView(match);

      if (view.phase !== phase) {
        if (view.phase === 'running') {
          encoder.reset();
          const [A, B] = await Promise.all([nameOf(match.players.A.userId), nameOf(match.players.B.userId)]);
          names = { A, B };
          const a = arenaWeb.combatAssets(match);
          write('setup', {
            matchId: match.id, arena: match.arena, names, captains: CAPTAINS, specialties: specialties.INFO,
            symbols: a.symbols, sprites: a.sprites, images: a.images,
          });
        } else {
          write('ended', { matchId: match.id, phase: view.phase, names, result: view.result, cancelReason: view.cancelReason });
        }
        phase = view.phase;
      }
      if (view.phase === 'running') {
        const events = pending;
        pending = [];
        write('state', encoder.encode(arenaWeb.compact({ ...view, events }, arenaWeb.combatAssets(match))));
      }
    } catch (e) {
      ctx.logger.error('[jp-tv] flux:', e.message);
    } finally {
      busy = false;
    }
  }

  write('idle', {});
  const timer = setInterval(tick, tvFeed.SEND_EVERY_MS);
  const ping = setInterval(() => { if (!closed) res.write(': ping\n\n'); }, PING_MS);
  tick();

  req.on('close', () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    clearInterval(ping);
    unsubscribe();
    res.end();
  });
}

// ─────────────────────────────────────────────
// 🚦 Routage : true si la requête était pour JP TV
// ─────────────────────────────────────────────

async function route(req, res, url) {
  const { pathname } = url;
  if (pathname !== '/tv/arena' && pathname !== '/api/tv/arena' && pathname !== '/api/tv/stream') return false;
  if (req.method !== 'GET') { ctx.send(res, 405, 'Method not allowed', { Allow: 'GET' }); return true; }
  if (pathname === '/tv/arena') { ctx.servePage(res, 'tv', TV_ASSETS); return true; }
  if (!validKey(url.searchParams.get('k'))) { ctx.sendJson(res, 403, { status: 'invalid' }); return true; }
  if (pathname === '/api/tv/arena') { ctx.sendJson(res, 200, await summary()); return true; }
  handleStream(req, res);
  return true;
}

module.exports = { configure, route, buildTvUrls, summary };
```

`src/web.js` :
- en-tête, après la ligne `/stats, /api/stats/…`, ajouter :
  `//    /tv/arena, /api/tv/…             → 📺 JP TV : Arène en direct (src/game/tvWeb.js)`
- après `const statsWeb = require('./stats/web');` : `const tvWeb = require('./game/tvWeb');`
- dans `createHandler`, juste avant `if (await statsWeb.route(req, res, url)) return undefined;` :
  `      if (await tvWeb.route(req, res, url)) return undefined;`
- dans `startWebServer`, après `configureStats({ client, logger });` : `  configureTv({ client, logger });`
- après le bloc `configureStats();` (et avant `buildStatsUrl`), ajouter :

```js
// 📺 JP TV : mêmes secret, réponses et pages que le reste du site
function configureTv({ client = null, logger = console } = {}) {
  tvWeb.configure({ publicUrl: WEB_PUBLIC_URL, getSecret, send, sendJson, servePage, userProfile, client, logger });
}
configureTv();

/** Liens JP TV { page, api } (null si la page web est désactivée). */
function buildTvUrls() {
  if (!isEnabled()) return null;
  return tvWeb.buildTvUrls();
}
```

- ajouter `buildTvUrls` à `module.exports`.

Créer `scripts/tv-urls.js` :

```js
#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  📺 Affiche les liens JP TV (avec la clé) à recopier dans
//  dashboard/arene.config.json de MagicDIMSI.
//  À lancer sur la VM, dans le dossier du bot (même .env / data/web-secret).
//  Usage : node scripts/tv-urls.js
// ═══════════════════════════════════════════════════════════
require('dotenv').config();
const web = require('../src/web');

const urls = web.buildTvUrls();
if (!urls) {
  console.error('WEB_PUBLIC_URL est vide : la page web (et donc JP TV) est désactivée.');
  process.exit(1);
}
const local = `http://127.0.0.1:${parseInt(process.env.WEB_PORT, 10) || 3100}`;
console.log(JSON.stringify({
  botApi: urls.api.replace(process.env.WEB_PUBLIC_URL.trim().replace(/\/+$/, ''), local),
  liveUrl: urls.page,
}, null, 2));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node scripts/test-tv-web.js && node scripts/test-arena-web.js && node scripts/test-stats-web.js`
Expected: `✅ Tout est bon` pour chacun.

- [ ] **Step 5: Commit**

```bash
git add src/game/tvWeb.js src/game/arenaWeb.js src/web.js scripts/tv-urls.js scripts/test-tv-web.js
git commit -m "📺 v2.3 : routes JP TV (direct SSE, synthèse classement + derniers combats)"
```

---

### Task 6: Page de diffusion JP TV (alerte, combat, bandeau, écran de fin) + aperçu local

**Files:**
- Modify: `public/arena-board.js` (`createRenderer` : option `step`)
- Create: `public/tv.html`, `public/tv.css`, `public/tv.js`
- Create: `scripts/preview-tv.js`
- Test: `scripts/test-tv-web.js` (page servie) ; vérification visuelle via `scripts/preview-tv.js`

**Interfaces:**
- Consumes: flux SSE de Task 5 (`idle`, `setup`, `state`, `ended`, `also`).
- Produces: `ArenaBoard.createRenderer(svg, { arena, symbols, sprites, step })` — `step` (ms entre deux états, défaut 100) règle l'interpolation.

- [ ] **Step 1: Write the failing test**

Dans `scripts/test-tv-web.js`, juste après la ligne `const k = new URL(urls.page).searchParams.get('k');`, ajouter :

```js
  const page = await request(`tv/arena?k=${k}`);
  check('page JP TV servie, assets versionnés', page.status === 200 && /tv\.js\?v=[a-f0-9]{10}/.test(page.body) && page.body.includes('PRIORITÉ AU DIRECT'));
  check('page JP TV : scripts servis', (await request('tv.js')).status === 200 && (await request('tv.css')).status === 200);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-tv-web.js`
Expected: FAIL sur « page JP TV servie » (404, `tv.html` absent).

- [ ] **Step 3: Implement**

`public/arena-board.js`, dans `createRenderer` :
- signature : `function createRenderer(svgEl, { arena = 'jardin', symbols = '', sprites = {}, step = 100 } = {}) {`
- remplacer `const STEP = 100;` par `const STEP = step;   // ms entre deux états (100 en jeu, 200 sur JP TV)`
- compléter le commentaire au-dessus : `//    interpole les positions à 60 images/s (option step : 5 Hz sur JP TV), gère Sorts et chips.`

Créer `public/tv.html` :

```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=1920, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>JP TV · Arène en direct</title>
  <!-- Chemins relatifs : la page est servie sur …/tv/arena (derrière un préfixe de proxy) -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;600;800&display=swap">
  <link rel="stylesheet" href="../tv.css?v=__ASSET_VERSION__">
</head>
<body>
  <main class="tv">
    <header class="tv-top">
      <span class="on-air">🔴 EN DIRECT · JP TV</span>
      <span class="tv-title">⚔️ Arène Jeanpip</span>
      <span class="tv-clock" id="clock">2:00</span>
    </header>

    <section class="tv-live" id="live" hidden>
      <aside class="side side-b">
        <span class="who"><i class="dot orange"></i><b id="name-b">Joueur B</b></span>
        <span class="towers" id="towers-b">0 tour détruite</span>
      </aside>
      <div class="board-wrap"><svg id="board" role="img" aria-label="Arène en direct"></svg>
        <span class="x2" id="x2" hidden>×2 élixir</span>
      </div>
      <aside class="side side-a">
        <span class="who"><i class="dot blue"></i><b id="name-a">Joueur A</b></span>
        <span class="towers" id="towers-a">0 tour détruite</span>
      </aside>
    </section>

    <section class="tv-ended" id="ended" hidden>
      <p class="kicker">Fin du combat</p>
      <h1 id="ended-title">Victoire</h1>
      <p class="sub" id="ended-sub"></p>
    </section>

    <section class="tv-idle" id="idle">
      <h1>⚔️ Arène Jeanpip</h1>
      <p class="sub">Aucun combat en direct pour l'instant.</p>
    </section>

    <footer class="also" id="also" hidden></footer>

    <div class="alert" id="alert" hidden>
      <p class="alert-kicker">⚠️ PRIORITÉ AU DIRECT</p>
      <p class="alert-names" id="alert-names"></p>
      <p class="alert-sub">Combat de l'Arène en direct</p>
    </div>
  </main>

  <script src="../arena-wire.js?v=__ASSET_VERSION__"></script>
  <script src="../arena-board.js?v=__ASSET_VERSION__"></script>
  <script src="../tv.js?v=__ASSET_VERSION__"></script>
</body>
</html>
```

Créer `public/tv.css` :

```css
/* 📺 JP TV : Arène en direct, plein écran 1920×1080 (TV du hall) */
:root { --ink: #1A201D; --i7: #2F3733; --cream: #F3EFED; --blue: #1C72F1; --orange: #FF6229; --red: #E5332A; --pink: #FF73C0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; background: var(--ink); color: var(--cream); font-family: 'Inter Tight', sans-serif; }
.tv { position: relative; width: 100vw; height: 100vh; display: flex; flex-direction: column; }
.tv-top { display: flex; align-items: center; gap: 24px; padding: 18px 40px; font-weight: 800; font-size: 28px; }
.on-air { background: var(--red); color: #fff; border-radius: 999px; padding: 6px 18px; letter-spacing: 1px; }
.tv-title { flex: 1; }
.tv-clock { font-size: 44px; font-variant-numeric: tabular-nums; }
.tv-live { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr auto 1fr; align-items: stretch; gap: 32px; padding: 0 40px 24px; }
.board-wrap { position: relative; height: 100%; aspect-ratio: 360 / 640; }
.board-wrap svg { width: 100%; height: 100%; display: block; }
.side { display: flex; flex-direction: column; gap: 12px; font-size: 34px; }
.side-b { justify-content: flex-start; align-items: flex-end; text-align: right; }
.side-a { justify-content: flex-end; align-items: flex-start; }
.who { display: flex; align-items: center; gap: 12px; font-weight: 800; }
.dot { width: 22px; height: 22px; border-radius: 50%; display: inline-block; }
.dot.blue { background: var(--blue); } .dot.orange { background: var(--orange); }
.towers { font-size: 26px; opacity: .8; }
.x2 { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); background: var(--pink); color: var(--ink); font-weight: 800; border-radius: 999px; padding: 4px 14px; font-size: 22px; }
.tv-ended, .tv-idle { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; text-align: center; }
.tv-ended h1, .tv-idle h1 { font-size: 96px; font-weight: 800; }
.kicker { font-size: 32px; letter-spacing: 3px; text-transform: uppercase; opacity: .7; }
.sub { font-size: 40px; opacity: .85; }
.also { padding: 14px 40px; background: var(--i7); font-size: 28px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alert { position: absolute; inset: 0; z-index: 10; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px; background: var(--red); color: #fff; text-align: center; animation: flash 1s ease-in-out infinite alternate; }
.alert-kicker { font-size: 110px; font-weight: 800; letter-spacing: 2px; }
.alert-names { font-size: 72px; font-weight: 800; }
.alert-sub { font-size: 40px; opacity: .9; }
@keyframes flash { from { background: var(--red); } to { background: #B8231C; } }
@media (prefers-reduced-motion: reduce) { .alert { animation: none; } }
[hidden] { display: none !important; }
```

Créer `public/tv.js` :

```js
// ═══════════════════════════════════════════════════════════
//  📺 JP TV — page de diffusion de l'Arène (TV du hall, v2.3)
//    GET ../api/tv/stream?k=  (SSE)
//      idle  → écran d'attente
//      setup → alerte « PRIORITÉ AU DIRECT » (4 s) puis le combat
//      state → terrain (5 Hz, interpolé), chrono, tours détruites
//      ended → écran de fin (le serveur le garde 10 s, puis idle)
//      also  → bandeau « Aussi en direct »
//  Lecture seule : aucune action possible, ni main ni élixir affichés.
// ═══════════════════════════════════════════════════════════
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const k = new URLSearchParams(location.search).get('k') || '';
  const decoder = ArenaWire.createDecoder();
  const ALERT_MS = 4000;
  const REASONS = { qg: 'QG détruit', towers: 'aux tours détruites', draw: 'égalité parfaite', forfeit: 'par abandon', disconnect: 'par déconnexion' };
  let renderer = null;
  let names = { A: 'Joueur A', B: 'Joueur B' };
  let alertTimer = null;

  function show(id) {
    for (const s of ['idle', 'live', 'ended']) $(s).hidden = s !== id;
  }
  function clock(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  const towersText = (n) => `${n} tour${n > 1 ? 's' : ''} détruite${n > 1 ? 's' : ''}`;
  function stopRenderer() {
    if (renderer) renderer.stop();
    renderer = null;
  }

  const es = new EventSource(`../api/tv/stream?k=${encodeURIComponent(k)}`);

  es.addEventListener('idle', () => {
    stopRenderer();
    $('alert').hidden = true;
    $('clock').textContent = '';
    show('idle');
  });

  es.addEventListener('setup', (e) => {
    const s = JSON.parse(e.data);
    decoder.reset();
    names = s.names || names;
    $('name-a').textContent = names.A;
    $('name-b').textContent = names.B;
    $('towers-a').textContent = towersText(0);
    $('towers-b').textContent = towersText(0);
    stopRenderer();
    renderer = ArenaBoard.createRenderer($('board'), { arena: s.arena, symbols: s.symbols, sprites: s.sprites, step: 200 });
    show('live');
    // ⚠️ Priorité au direct : alerte plein écran avant le combat
    $('alert-names').textContent = `${names.A} 🆚 ${names.B}`;
    $('alert').hidden = false;
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => { $('alert').hidden = true; }, ALERT_MS);
  });

  es.addEventListener('state', (e) => {
    const v = decoder.decode(JSON.parse(e.data));
    if (renderer) renderer.push(v);
    $('clock').textContent = clock(v.remainingMs);
    $('towers-a').textContent = towersText(v.players.A.towersDestroyed);
    $('towers-b').textContent = towersText(v.players.B.towersDestroyed);
    $('x2').hidden = !v.doubleElixir;
  });

  es.addEventListener('ended', (e) => {
    const v = JSON.parse(e.data);
    const n = v.names || names;
    stopRenderer();
    $('alert').hidden = true;
    if (v.phase === 'cancelled' || !v.result) {
      $('ended-title').textContent = 'Combat annulé';
      $('ended-sub').textContent = `${n.A} 🆚 ${n.B}`;
    } else if (!v.result.winner) {
      $('ended-title').textContent = '🤝 Match nul';
      $('ended-sub').textContent = `${n.A} 🆚 ${n.B}`;
    } else {
      const t = v.result.towers;
      const score = t ? ` · ${t.A}–${t.B} tours` : '';
      $('ended-title').textContent = `🏆 ${n[v.result.winner]}`;
      $('ended-sub').textContent = `gagne ${REASONS[v.result.reason] || ''} contre ${n[v.result.winner === 'A' ? 'B' : 'A']}${score}`;
    }
    show('ended');
  });

  es.addEventListener('also', (e) => {
    const list = JSON.parse(e.data);
    $('also').hidden = !list.length;
    $('also').textContent = list.length ? `Aussi en direct : ${list.map((m) => `${m.a} 🆚 ${m.b}`).join(' · ')}` : '';
  });
}());
```

Créer `scripts/preview-tv.js` (aperçu local : combats simulés en boucle, sans Slack ni données réelles) :

```js
#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  📺 Aperçu de JP TV en local : combats simulés en boucle.
//  COPIE temporaire du projet (data/ réelle jamais touchée), deux
//  joueurs fictifs qui posent une carte au hasard toutes les 1,5 s.
//  Usage : node scripts/preview-tv.js   puis ouvrir l'URL affichée.
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-preview-tv-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.cpSync(path.join(ROOT, 'public'), path.join(TMP, 'public'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

const PORT = parseInt(process.env.PREVIEW_PORT, 10) || 3199;
process.env.WEB_PUBLIC_URL = `http://127.0.0.1:${PORT}`;
process.env.WEB_SECRET = 'preview-secret';

const web = require(path.join(TMP, 'src', 'web.js'));
const matches = require(path.join(TMP, 'src', 'game', 'matches.js'));
const collections = require(path.join(TMP, 'src', 'collections.js'));
const media = require(path.join(TMP, 'src', 'media.js'));

const NAMES = { UA: 'Paul', UB: 'Julie', UC: 'Marc', UD: 'Léa' };
const client = { users: { info: async ({ user }) => ({ user: { profile: { display_name: NAMES[user] } } }) } };
const bank = media.getAllMedia();
['UA', 'UB', 'UC', 'UD'].forEach((u, i) => collections.addCards(u, bank.slice(i * 10, i * 10 + 10)));

web.startWebServer({ client, logger: console, port: PORT, force: true });

function launch(a, b) {
  const m = matches.createMatchFor(a, b, Date.now(), { arena: ['jardin', 'port', 'serveurs'][Math.floor(Math.random() * 3)] });
  if (!m.ok) return;
  for (const u of [a, b]) {
    matches.connect(m.id, u, Date.now());
    matches.setReady(m.id, u);
  }
}

// Une pose au hasard par joueur et par combat en cours, toutes les 1,5 s
setInterval(() => {
  for (const { id, status, players } of matches.listForTv()) {
    if (status !== 'running') continue;
    const m = matches.getMatch(id);
    for (const side of ['A', 'B']) {
      const p = m.engine.players[side];
      const url = p.hand.find((u) => p.cards[u].cost <= p.elixir);
      if (url) matches.action(id, players[side], { type: 'deploy', url, lane: Math.floor(Math.random() * 3) });
    }
  }
}, 1500);

// Toujours un combat UA/UB ; un second UC/UD de temps en temps (bandeau « Aussi en direct »)
setInterval(() => {
  if (!matches.isBusy('UA') && !matches.isBusy('UB')) launch('UA', 'UB');
  if (!matches.isBusy('UC') && !matches.isBusy('UD') && Math.random() < 0.3) launch('UC', 'UD');
}, 5000);
launch('UA', 'UB');

const urls = web.buildTvUrls();
console.log(`\n📺 JP TV (aperçu) : ${urls.page}\n📊 Synthèse       : ${urls.api}\n`);
process.on('SIGINT', () => { fs.rmSync(TMP, { recursive: true, force: true }); process.exit(0); });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node scripts/test-tv-web.js && node scripts/test-arena-board.js`
Expected: `✅ Tout est bon`.

Puis vérification visuelle : `node scripts/preview-tv.js`, ouvrir l'URL `📺 JP TV` affichée dans le navigateur intégré (fenêtre 1920×1080). Vérifier : alerte rouge « ⚠️ PRIORITÉ AU DIRECT · Paul 🆚 Julie » ~4 s → terrain qui bouge, chrono qui descend, noms de part et d'autre (Julie/orange en haut, Paul/bleu en bas) → bandeau « Aussi en direct : Marc 🆚 Léa » quand un 2e combat tourne → écran de fin 🏆 ~10 s → combat suivant. Aucune main ni élixir visibles.

- [ ] **Step 5: Commit**

```bash
git add public/arena-board.js public/tv.html public/tv.css public/tv.js scripts/preview-tv.js scripts/test-tv-web.js
git commit -m "📺 v2.3 : page de diffusion JP TV (alerte Priorité au direct, combat, écran de fin)"
```

---

### Task 7: Livraison 2.3 côté bot (release note, version, README)

**Files:**
- Modify: `src/releases.js` (entrée en tête de `RELEASES`)
- Modify: `package.json` (version 2.3.0)
- Modify: `README.md` (section JP TV)
- Test: `scripts/test-releases.js`

- [ ] **Step 1: Bump the version (test qui échoue d'abord)**

Run: `npm version 2.3.0 --no-git-tag-version` puis `node scripts/test-releases.js`
Expected: FAIL — `package.json` (2.3.0) diverge de la première entrée de `RELEASES` (2.2.1).

- [ ] **Step 2: Add the release note**

En tête du tableau `RELEASES` de `src/releases.js` :

```js
  {
    version: '2.3',
    date: '2026-10-06',
    title: 'L\'Arène en direct sur JP TV',
    changes: [
      '📺 Tes combats de l\'Arène passent en direct sur JP TV, la TV du hall : une alerte « Priorité au direct », puis tout le combat, et le résultat à la fin. Ni ta main ni ton élixir ne sont montrés.',
      '🏆 JP TV affiche aussi le classement de l\'Arène en direct et le résultat des derniers combats.',
      '🙈 Tu préfères rester discret ? Coche « Ne pas me diffuser sur JP TV » dans « Mon deck » : tes combats ne passeront pas en direct (ils comptent toujours au classement).',
      '🌙 Le direct ne coupe jamais le mode soir de la TV.',
    ],
  },
```

- [ ] **Step 3: Document in the README**

Dans `README.md`, après la section `## 📊 Dashboard /stats et base SQLite` (et avant la section suivante), ajouter :

```markdown
## 📺 JP TV : l'Arène en direct (v2.3)

La TV du hall (dashboard MagicDIMSI) affiche chaque combat de l'Arène en direct, le classement et les derniers combats.

- `GET /tv/arena?k=` : page de diffusion plein écran (alerte « Priorité au direct », combat, écran de fin 10 s).
- `GET /api/tv/stream?k=` : flux SSE 5 Hz du combat à l'antenne (vue sans main ni élixir).
- `GET /api/tv/arena?k=` : `{ onAir, live, ranking, recent }`, lu toutes les 5 s par `dashboard/arene.js` de MagicDIMSI.
- Clé TV dérivée du secret web : `node scripts/tv-urls.js` (sur la VM) affiche `botApi` et `liveUrl` à recopier dans `dashboard/arene.config.json` de MagicDIMSI.
- Option joueur « Ne pas me diffuser sur JP TV » dans « Mon deck » (`tvOptOut` dans `data/arena.json`).
- Aperçu local avec combats simulés : `node scripts/preview-tv.js`.
```

- [ ] **Step 4: Run tests**

Run: `node scripts/test-releases.js && node scripts/test-tv-feed.js && node scripts/test-tv-web.js && node scripts/test-arena-matches.js && node scripts/test-arena-store.js && node scripts/test-arena-web.js && node scripts/test-arena-settle.js && node scripts/test-arena-engine.js`
Expected: `✅ Tout est bon` pour chacun.

- [ ] **Step 5: Commit**

```bash
git add src/releases.js package.json package-lock.json README.md
git commit -m "📰 v2.3 : release note « L'Arène en direct sur JP TV »"
```

---

# Partie B — Dashboard `MagicDIMSI` (dépôt `C:\Users\p.bardinet\Documents\MagicDIMSI-main`)

Travailler dans un worktree dédié de MagicDIMSI, branche `claude/v2-3-jp-tv-arene` (depuis `main`). Lire `CLAUDE.md` de MagicDIMSI avant de commencer (zéro dépendance, commentaire d'en-tête obligatoire, `index.html` = bundle à éditer par sections identifiables). Tests : `cd dashboard && node --test` (tous) ou `node dashboard/<fichier>.test.js`.

### Task 8: Module serveur `dashboard/arene.js` + route `/api/arene`

**Files:**
- Create: `dashboard/arene.js`
- Create: `dashboard/arene.config.example.json`
- Modify: `dashboard/server.js` (`require`, route `/api/arene` à côté de `/api/jeanpip` ~l. 426, `arene.start()` dans `server.listen` ~l. 808)
- Modify: `.gitignore` si `dashboard/arene.config.json` n'est pas déjà ignoré
- Test: `dashboard/arene.test.js`

**Interfaces:**
- Consumes: JSON du bot `GET /api/tv/arena?k=` (Task 5).
- Produces:
  - `GET /api/arene` → `{}` (veille) ou `{ onAir: boolean, liveUrl: string, live: [{ a, b }], ranking: [{ medal, name, wins, winRate }], recent: [{ line, result, towers, when }] }`.
  - Fonctions pures exportées pour les tests : `inEvening(date) → boolean`, `relTime(at, now) → string`, `shape(api, now, cfg) → object`.

- [ ] **Step 1: Write the failing test**

Créer `dashboard/arene.test.js` :

```js
// arene.test.js — Arène Jeanpip sur JP TV : `node arene.test.js`
// Logique pure (pas de réseau) : mode soir prioritaire, mise en forme du
// classement et des derniers combats, veille.
const assert = require("assert");
const { inEvening, relTime, shape } = require("./arene");

let passed = 0;
function ok(cond, label) { assert.ok(cond, label); console.log("  ok -", label); passed++; }

const MIN = 60 * 1000;
const at = (h, m) => new Date(2026, 9, 6, h, m).getTime(); // mardi 6 octobre 2026, heure locale de la VM
const cfg = { liveUrl: "https://dashboard-lorient.dimsi.cloud/jeanpip/tv/arena?k=x" };
const api = {
  status: "ok", onAir: true,
  live: [{ matchId: "m1", a: "Paul", b: "Julie", startedAt: at(10, 0) }],
  ranking: [
    { rank: 1, name: "Julie", wins: 5, losses: 1, draws: 0, winRate: 83 },
    { rank: 2, name: "Paul", wins: 3, losses: 3, draws: 1, winRate: 43 },
    { rank: 4, name: "Marc", wins: 1, losses: 0, draws: 0, winRate: 100 },
  ],
  recent: [
    { at: at(10, 0) - 12 * MIN, a: "Paul", b: "Julie", winner: "Julie", draw: false, towers: [1, 3], reason: "qg" },
    { at: at(9, 0), a: "Marc", b: "Léa", winner: null, draw: true, towers: null, reason: null },
  ],
};

// Mode soir (17h45 → 19h) : le direct s'efface
ok(!inEvening(new Date(at(17, 44))), "17h44 : pas encore le mode soir");
ok(inEvening(new Date(at(17, 45))), "17h45 : mode soir");
ok(inEvening(new Date(at(18, 59))), "18h59 : mode soir");
ok(!inEvening(new Date(at(19, 0))), "19h00 : fin du mode soir");

const day = shape(api, at(10, 0), cfg);
ok(day.onAir === true && day.liveUrl === cfg.liveUrl, "journée : combat à l'antenne, lien de diffusion fourni");
ok(day.live.length === 1 && day.live[0].a === "Paul", "journée : combat en direct listé");
ok(day.ranking[0].medal === "🥇" && day.ranking[1].medal === "🥈" && day.ranking[2].medal === "4.", "classement : médailles puis rang");
ok(day.ranking[0].name === "Julie" && day.ranking[0].wins === 5 && day.ranking[0].winRate === 83, "classement : nom, victoires, % de victoire");
ok(day.recent[0].line === "Paul 🆚 Julie" && day.recent[0].result === "🏆 Julie" && day.recent[0].towers === "1–3 tours", "dernier combat : vainqueur et tours");
ok(day.recent[0].when === "il y a 12 min", "dernier combat : il y a 12 min");
ok(day.recent[1].result === "🤝 Nul" && day.recent[1].towers === "", "nul sans tours (ancien format) : pas de « undefined »");

const evening = shape(api, at(18, 0), cfg);
ok(evening.onAir === false && evening.live.length === 0, "mode soir : pas de direct, même si un combat tourne");
ok(evening.ranking.length === 3 && evening.recent.length === 2, "mode soir : classement et derniers combats restent");

ok(JSON.stringify(shape(null, at(10, 0), cfg)) === "{}", "bot injoignable → veille {}");
ok(JSON.stringify(shape({ status: "invalid" }, at(10, 0), cfg)) === "{}", "clé refusée → veille {}");
ok(shape({ status: "ok", onAir: true, live: [], ranking: [], recent: [] }, at(10, 0), {}).onAir === false, "sans liveUrl → pas de calque");

ok(relTime(at(10, 0), at(10, 0)) === "à l'instant", "à l'instant");
ok(relTime(at(8, 0), at(10, 0)) === "il y a 2 h", "il y a 2 h");
ok(relTime(at(10, 0) - 30 * 60 * MIN, at(10, 0)) === "hier", "hier");

console.log(`\n${passed} vérifications OK`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node dashboard/arene.test.js`
Expected: FAIL — `Cannot find module './arene'`.

- [ ] **Step 3: Implement**

Créer `dashboard/arene.js` :

```js
// arene.js — Arène Jeanpip sur JP TV : combat en direct, classement de l'Arène, derniers combats.
// Source : API du bot slack-emoji-reactor-bot sur la même VM — GET <botApi> (clé TV incluse),
//   { onAir, live, ranking, recent } ; `node scripts/tv-urls.js` côté bot donne botApi et liveUrl.
// Fenêtre : le direct est coupé pendant le mode soir (17h45-19h, même seuil que le front) —
//   onAir:false et live:[] ; le classement et les derniers combats restent affichés.
// Fréquence : relevé toutes les 5 s (appel local, léger).
// Veille : arene.config.json absent, bot injoignable ou clé refusée → API {} ; la carte sort
//   de la rotation et le calque de direct ne s'ouvre jamais. Zéro dépendance.
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const CONFIG_PATH = path.join(__dirname, "arene.config.json");
const REFRESH_MS = 5 * 1000;
const MEDALS = ["🥇", "🥈", "🥉"];

let cache = {};

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); } catch { return null; }
}

// Mode soir de la TV : 17h45 → 19h (heure de la VM, comme le front).
function inEvening(d) {
  const m = d.getHours() * 60 + d.getMinutes();
  return m >= 17 * 60 + 45 && d.getHours() < 19;
}

function relTime(at, now) {
  const min = Math.max(0, Math.round((now - at) / 60000));
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "hier" : `il y a ${d} j`;
}

// Réponse du bot → données prêtes à afficher (logique pure, testée).
function shape(api, now, cfg) {
  if (!api || api.status !== "ok") return {};
  const evening = inEvening(new Date(now));
  const liveUrl = (cfg && cfg.liveUrl) || "";
  return {
    onAir: Boolean(api.onAir) && !evening && Boolean(liveUrl),
    liveUrl,
    live: evening ? [] : (api.live || []).map(m => ({ a: m.a, b: m.b })),
    ranking: (api.ranking || []).map(r => ({
      medal: MEDALS[r.rank - 1] || r.rank + ".", name: r.name, wins: r.wins, winRate: r.winRate,
    })),
    recent: (api.recent || []).map(r => ({
      line: `${r.a} 🆚 ${r.b}`,
      result: r.draw || !r.winner ? "🤝 Nul" : `🏆 ${r.winner}`,
      towers: Array.isArray(r.towers) ? `${r.towers[0]}–${r.towers[1]} tours` : "",
      when: relTime(r.at, now),
    })),
  };
}

function getJson(url) {
  return new Promise(resolve => {
    const lib = url.startsWith("https:") ? https : http;
    const req = lib.get(url, { timeout: 4000 }, res => {
      let data = "";
      res.on("data", c => { data += c; });
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}

async function refresh() {
  const cfg = loadConfig();
  if (!cfg || !cfg.botApi) { cache = {}; return; } // pas de config → veille
  cache = shape(await getJson(cfg.botApi), Date.now(), cfg);
}

function getArene() { return cache; }
function start() { refresh(); setInterval(refresh, REFRESH_MS); }

module.exports = { start, getArene, refresh, inEvening, relTime, shape };

if (require.main === module) { refresh().then(() => console.log(JSON.stringify(getArene(), null, 1))); }
```

Créer `dashboard/arene.config.example.json` :

```json
{
  "botApi": "http://127.0.0.1:3100/api/tv/arena?k=CLE_TV_DONNEE_PAR_node_scripts/tv-urls.js",
  "liveUrl": "https://dashboard-lorient.dimsi.cloud/jeanpip/tv/arena?k=CLE_TV_DONNEE_PAR_node_scripts/tv-urls.js"
}
```

Vérifier que la vraie config sera ignorée : `git check-ignore dashboard/arene.config.json`. Si la commande ne renvoie rien, ajouter `dashboard/arene.config.json` au `.gitignore` racine, à côté des autres `*.config.json`.

`dashboard/server.js` :
- après `const jeanpip    = require("./jeanpip");` : `const arene      = require("./arene");`
- juste après le bloc `if (req.url === "/api/jeanpip") { … }` (même forme) :

```js
  if (req.url === "/api/arene") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(arene.getArene() || {}));
    return;
  }
```

(recopier exactement les en-têtes utilisés par la route `/api/jeanpip` si elles diffèrent ; garder `no-store`).
- dans `server.listen`, après `jeanpip.start();` : `  arene.start();      // Arène Jeanpip sur JP TV : direct, classement, derniers combats (API du bot, 5 s, dormant sans arene.config.json)`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node dashboard/arene.test.js && cd dashboard && node --test`
Expected: `… vérifications OK`, puis toute la suite verte.

- [ ] **Step 5: Commit**

```bash
git add dashboard/arene.js dashboard/arene.config.example.json dashboard/arene.test.js dashboard/server.js .gitignore
git commit -m "feat: module Arène Jeanpip pour JP TV (direct, classement, derniers combats)"
```

---

### Task 9: Front — calque « Priorité au direct » + carte « Arène » dans la rotation

**Files:**
- Modify: `dashboard/index.html` (chargeur en tête : `loadArene` + `areneDirect` ; template du bundle : carte « Arène »)
- Create: `dashboard/arene-front.test.js`
- Modify: `README.md`, `CLAUDE.md` (inventaire des cartes / modules), `docs/superpowers/specs/2026-10-06-arene-jp-tv.md` (copie courte de la spec côté dashboard)

**Interfaces:**
- Consumes: `GET /api/arene` (Task 8).
- Produces: `window.__dimsiArene` ; calque `#jp-tv-direct` (iframe `liveUrl`) ouvert tant que `onAir` ; entrée de rotation `'arene'`.

- [ ] **Step 1: Write the failing test**

Créer `dashboard/arene-front.test.js` :

```js
// arene-front.test.js — JP TV côté front : `node arene-front.test.js`
// Exécute le VRAI code d'index.html (chargeur + bloc de rotation), comme heure.test.js.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let passed = 0;
function ok(cond, label) { assert.ok(cond, label); console.log("  ok -", label); passed++; }

const HTML = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const tpl = JSON.parse(/<script type="__bundler\/template">([\s\S]*?)<\/script>/.exec(HTML)[1]);

// ── Calque « Priorité au direct » (chargeur en tête d'index.html) ────────────
const a = HTML.indexOf("/* JP TV : début */");
const b = HTML.indexOf("/* JP TV : fin */");
ok(a !== -1 && b > a, "index.html : bloc JP TV balisé dans le chargeur");
function fakeDocument() {
  const nodes = {};
  const body = { children: [], appendChild(n) { this.children.push(n); nodes[n.id] = n; n.parentNode = body; return n; },
    removeChild(n) { this.children = this.children.filter(c => c !== n); delete nodes[n.id]; } };
  return {
    body,
    getElementById: id => nodes[id] || null,
    createElement: tag => ({ tag, style: {}, attrs: {}, children: [], setAttribute(k, v) { this.attrs[k] = v; }, appendChild(n) { this.children.push(n); } }),
  };
}
const doc = fakeDocument();
const bac = { document: doc, window: {} };
vm.createContext(bac);
vm.runInContext(HTML.slice(a, b), bac);
const URL_LIVE = "https://dashboard-lorient.dimsi.cloud/jeanpip/tv/arena?k=x";
bac.areneDirect({ onAir: false, liveUrl: URL_LIVE });
ok(!doc.getElementById("jp-tv-direct"), "rien à l'antenne → pas de calque");
bac.areneDirect({ onAir: true, liveUrl: URL_LIVE });
const calque = doc.getElementById("jp-tv-direct");
ok(calque && calque.children[0].tag === "iframe" && calque.children[0].src === URL_LIVE, "à l'antenne → calque plein écran avec la page de diffusion");
bac.areneDirect({ onAir: true, liveUrl: URL_LIVE });
ok(doc.body.children.length === 1, "toujours à l'antenne → le même calque (iframe jamais rechargée)");
bac.areneDirect({ onAir: false, liveUrl: URL_LIVE });
ok(!doc.getElementById("jp-tv-direct"), "fin du direct → calque retiré (flux fermé)");
bac.areneDirect({});
ok(!doc.getElementById("jp-tv-direct"), "veille {} → pas de calque");

// ── Carte « Arène » dans la rotation (template du bundle) ────────────────────
const c = tpl.indexOf("// ⚔️ Arène JP TV : début");
const d = tpl.indexOf("// ⚔️ Arène JP TV : fin");
ok(c !== -1 && d > c, "template : bloc Arène balisé dans la rotation");
const rot = tpl.slice(c, d); // code du composant, tel quel
const run = data => {
  const s = { window: { __dimsiArene: data }, slotCards: [] };
  vm.createContext(s);
  vm.runInContext(rot + "\nthis.out = { areneRanking: areneRanking, areneRecent: areneRecent, areneLiveDisplay: areneLiveDisplay };", s);
  return s;
};
const plein = run({ onAir: true, ranking: [{ medal: "🥇", name: "Julie", wins: 5, winRate: 83 }], recent: [{ line: "Paul 🆚 Julie", result: "🏆 Julie", towers: "1–3 tours", when: "il y a 12 min" }] });
ok(plein.slotCards.indexOf("arene") !== -1, "classement présent → carte Arène dans la rotation");
ok(plein.out.areneRanking.length === 1 && plein.out.areneRecent.length === 1, "carte : classement et derniers combats");
ok(plein.out.areneLiveDisplay !== "none", "combat en cours → pastille 🔴 En direct");
const vide = run({});
ok(vide.slotCards.indexOf("arene") === -1, "veille → carte hors rotation");
ok(tpl.indexOf("{{ areneDisplay }}") !== -1 && tpl.indexOf('list="{{ areneRanking }}"') !== -1 && tpl.indexOf('list="{{ areneRecent }}"') !== -1, "template : carte Arène (classement + derniers combats)");

console.log(`\n${passed} vérifications OK`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node dashboard/arene-front.test.js`
Expected: FAIL — `index.html : bloc JP TV balisé dans le chargeur`.

- [ ] **Step 3a: Chargeur en tête d'`index.html`**

Dans le `<script>` du chargeur (tête d'`index.html`), juste après le bloc `loadJeanpip(); … setInterval(loadJeanpip, 60 * 1000);` — repérer la ligne `function loadJeanpip(){` et la ligne `setInterval(loadJeanpip, 60 * 1000);` qui lui correspond, puis insérer **après** cette ligne `setInterval` (relire autour avant d'éditer, cf. CLAUDE.md §5.7) :

```js
    /* JP TV : début */
    // 🔴 Priorité au direct : tant qu'un combat de l'Arène est à l'antenne, calque plein
    // écran au-dessus de la rotation avec la page de diffusion du bot en iframe. Le mode
    // soir garde la priorité : le serveur (arene.js) renvoie onAir:false de 17h45 à 19h.
    // Hors du template : l'iframe n'est jamais recréée par le rendu de la rotation ; si le
    // bundle remplace le document, le calque est reposé au relevé suivant (5 s).
    function areneDirect(d){
      var on = !!(d && d.onAir && d.liveUrl);
      var el = document.getElementById('jp-tv-direct');
      if(on && !el){
        el = document.createElement('div');
        el.id = 'jp-tv-direct';
        el.style.cssText = 'position:fixed;inset:0;z-index:50;background:#1A201D';
        var f = document.createElement('iframe');
        f.src = d.liveUrl;
        f.setAttribute('title', 'JP TV : Arène en direct');
        f.style.cssText = 'border:0;width:100%;height:100%;display:block';
        el.appendChild(f);
        document.body.appendChild(el);
      } else if(!on && el){
        el.parentNode.removeChild(el);
      }
    }
    /* JP TV : fin */
    function loadArene(){
      fetch('/api/arene', { cache: 'no-store' }).then(function(r){ return r.json(); }).then(function(d){
        if(d && typeof d === 'object'){ window.__dimsiArene = d; areneDirect(d); }
      }).catch(function(){});
    }
    loadArene();
    setInterval(loadArene, 5 * 1000); // le direct doit s'ouvrir vite
```

- [ ] **Step 3b: Carte « Arène » dans le template du bundle**

Le template est une chaîne JSON dans `<script type="__bundler/template">`. Ne pas l'éditer à la main : écrire ce script dans le scratchpad (pas dans le dépôt) et l'exécuter une fois depuis la racine de MagicDIMSI. Il relit le template, insère les quatre morceaux à des ancres uniques, vérifie chaque ancre et réécrit `index.html`.

```js
// patch-arene.js — à exécuter UNE fois : node <scratchpad>/patch-arene.js
const fs = require("fs");
const FILE = "dashboard/index.html";
const html = fs.readFileSync(FILE, "utf8");
const re = /(<script type="__bundler\/template">)([\s\S]*?)(<\/script>)/;
const m = re.exec(html);
let tpl = JSON.parse(m[2]);

function insertAfter(anchor, text) {
  const i = tpl.indexOf(anchor);
  if (i === -1 || tpl.indexOf(anchor, i + 1) !== -1) throw new Error("ancre absente ou non unique : " + anchor);
  tpl = tpl.slice(0, i + anchor.length) + text + tpl.slice(i + anchor.length);
}

// 1. Rotation : données + entrée 'arene' (après le Hall of Shame)
insertAfter("if (jeanpipShame.length) slotCards.push('jeanpipShame');",
  "\n    // ⚔️ Arène JP TV : début\n" +
  "    var areneData = window.__dimsiArene || {};\n" +
  "    var areneRanking = Array.isArray(areneData.ranking) ? areneData.ranking : [];\n" +
  "    var areneRecent = Array.isArray(areneData.recent) ? areneData.recent : [];\n" +
  "    var areneLiveDisplay = (Array.isArray(areneData.live) && areneData.live.length) ? 'inline-flex' : 'none';\n" +
  "    if (areneRanking.length) slotCards.push('arene');\n" +
  "    // ⚔️ Arène JP TV : fin");

// 2. Affichage de la carte quand c'est son tour
insertAfter("var jeanpipShameDisplay = (slotShow === 'jeanpipShame') ? 'flex' : 'none';",
  "\n    var areneDisplay = (slotShow === 'arene') ? 'flex' : 'none';");

// 3. Variables exposées au gabarit
insertAfter("inEvening: inEvening, eveningDisplay: eveningDisplay,",
  " areneDisplay: areneDisplay, areneRanking: areneRanking, areneRecent: areneRecent, areneLiveDisplay: areneLiveDisplay,");

// 4. Gabarit : carte sœur du Hall of Shame, même cadre
const shame = tpl.indexOf("display:{{ jeanpipShameDisplay }}");
if (shame === -1) throw new Error("carte Hall of Shame introuvable");
const open = tpl.lastIndexOf("<div", shame);
const frame = tpl.slice(open, tpl.indexOf(">", shame) + 1).replace("{{ jeanpipShameDisplay }}", "{{ areneDisplay }}");
const card = frame +
  '<div style="display:flex;align-items:center;gap:9px;margin-bottom:14px"><span style="font-size:20px">⚔️</span>' +
  '<div style="font-size:11px;font-weight:700;color:#6B8BA8;text-transform:uppercase;letter-spacing:2px">Arène Jeanpip &#183; Classement en direct</div>' +
  '<span style="margin-left:auto;display:{{ areneLiveDisplay }};font-size:13px;font-weight:700;color:#fff;background:#E5332A;border-radius:999px;padding:3px 10px">🔴 En direct</span></div>' +
  '<sc-for list="{{ areneRanking }}" as="r"><div style="display:flex;align-items:center;gap:14px;padding:8px 0;border-bottom:1px solid #EBF2FA">' +
  '<span style="font-size:21px;width:40px;text-align:center;flex-shrink:0">{{ r.medal }}</span>' +
  '<span style="flex:1;font-size:18px;font-weight:600;color:#1B3A5C">{{ r.name }}</span>' +
  '<span style="font-size:16px;color:#6B8BA8">{{ r.wins }} V &#183; {{ r.winRate }} %</span></div></sc-for>' +
  '<div style="font-size:11px;font-weight:700;color:#6B8BA8;text-transform:uppercase;letter-spacing:2px;margin:16px 0 6px">Derniers combats</div>' +
  '<sc-for list="{{ areneRecent }}" as="c"><div style="display:flex;align-items:baseline;gap:10px;padding:6px 0;font-size:16px;color:#1B3A5C">' +
  '<span style="flex:1;font-weight:600">{{ c.line }}</span><span>{{ c.result }}</span>' +
  '<span style="color:#6B8BA8">{{ c.towers }}</span><span style="color:#9AB0C6;font-size:14px">{{ c.when }}</span></div></sc-for>' +
  "</div>";
tpl = tpl.slice(0, open) + card + tpl.slice(open);

// Réécriture (même encodage que le bundle : JSON + </script> échappé)
const out = JSON.stringify(tpl).split("</script>").join("<\\/script>");
fs.writeFileSync(FILE, html.slice(0, m.index) + m[1] + out + m[3] + html.slice(m.index + m[0].length));
console.log("index.html : carte Arène insérée");
```

Avant de lancer : vérifier que le bundle d'origine échappe `</` comme `<\/` (`grep -c '<\\\\/div>' dashboard/index.html` > 0) ; c'est le cas pour le Hall of Shame (`<\/span>` vu dans le template). Après exécution : `git diff --stat dashboard/index.html` ne doit montrer que la ligne du chargeur et la ligne du template ; `grep -o "jeanpipShame" dashboard/index.html | wc -l` doit toujours valoir 7 (rien de cassé), et `grep -o "arene[A-Z][A-Za-z]*" dashboard/index.html | sort | uniq -c` doit montrer `areneDisplay`, `areneRanking`, `areneRecent`, `areneLiveDisplay`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node dashboard/arene-front.test.js && node dashboard/heure.test.js && cd dashboard && node --test`
Expected: tout vert (en particulier `heure.test.js` : aucun `new Date()` sans argument ajouté dans le template).

Vérification visuelle : lancer `PORT=8081 npm run server` avec un `dashboard/arene.config.json` local qui pointe sur l'aperçu du bot (`node scripts/preview-tv.js` côté bot : recopier `📊 Synthèse` dans `botApi` et `📺 JP TV` dans `liveUrl`). Ouvrir `http://localhost:8081/` dans le navigateur intégré en 1920×1080 : le calque s'ouvre en ≤ 10 s avec l'alerte rouge, puis le combat ; à la fin du combat simulé, l'écran de fin, puis retour à la rotation. Couper l'aperçu du bot → plus de calque au relevé suivant, la carte Arène sort de la rotation. Pour la carte : attendre son tour dans la rotation (classement + derniers combats + pastille 🔴).

- [ ] **Step 5: Documentation + commit**

- `README.md` (inventaire des cartes) : ajouter la carte « Arène Jeanpip / JP TV » — source (API du bot, `arene.config.json`), fenêtre (direct coupé 17h45-19h, carte toujours en rotation), fréquence (5 s), veille.
- `CLAUDE.md` : rien de structurel à changer sauf mentionner, dans §4, que le calque `#jp-tv-direct` vit dans le chargeur en tête (hors template) et pourquoi (iframe non recréée).
- `docs/superpowers/specs/2026-10-06-arene-jp-tv.md` : 10-15 lignes reprenant les décisions de la spec du bot (lien vers celle-ci) et le contrat de `/api/arene`.

```bash
git add dashboard/index.html dashboard/arene-front.test.js README.md CLAUDE.md docs/superpowers/specs/2026-10-06-arene-jp-tv.md
git commit -m "feat: JP TV — calque Priorité au direct + carte Arène (classement, derniers combats)"
```

---

### Task 10: Mise en production (checklist, sans code)

- [ ] Merger la PR du bot, tag `v2.3` (`git tag v2.3 && git push origin v2.3`), déployer sur la VM `BS-LORIENT-DASHBOARD` (`/root/slack-emoji-reactor-bot`, `systemctl restart slack-reactor`).
- [ ] Sur la VM, dans le dossier du bot : `node scripts/tv-urls.js` → recopier `botApi` et `liveUrl` dans `dashboard/arene.config.json` de MagicDIMSI (fichier non versionné).
- [ ] Vérifier que le reverse proxy n'interdit pas l'iframe : `curl -sI "<liveUrl>" | grep -i -E "x-frame-options|content-security-policy"` ne doit rien renvoyer de bloquant (sinon autoriser l'origine du dashboard pour `/jeanpip/tv/`).
- [ ] Vérifier que le flux SSE passe le proxy sans tampon depuis la TV : `curl -sN "<liveUrl remplacé par /api/tv/stream?k=…>"` affiche `event: idle` immédiatement.
- [ ] Merger la PR MagicDIMSI, redémarrer le service du dashboard.
- [ ] Sur la TV : lancer un combat réel entre deux joueurs → alerte puis direct en ≤ 10 s ; fin → écran de fin puis retour à la rotation ; carte Arène visible dans la rotation. Fluidité limitée attendue (acceptée en V1).
