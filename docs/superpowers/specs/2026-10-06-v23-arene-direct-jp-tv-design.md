# v2.3 — L'Arène en direct sur JP TV

> Statut : périmètre validé par Paul le 2026-10-06. Deux dépôts concernés :
> `slack-emoji-reactor-bot` (le jeu) et `MagicDIMSI` (dashboard TV du hall, « JP TV »).

## Objectif

Chaque combat de l'Arène est rediffusé en direct sur la TV du hall, précédé d'une
alerte **« 🔴 PRIORITÉ AU DIRECT »**. Le dashboard affiche aussi en permanence le
**classement de l'Arène en direct** et le **résultat des derniers combats**.

## Décisions

| Sujet | Décision |
|---|---|
| Combats diffusés | Uniquement les combats entre joueurs (pas l'Attaque Jeanpip, pas le tutoriel, pas les combats annulés en préparation) |
| Deux combats en même temps | Le premier lancé en plein écran, les autres dans un bandeau « Aussi en direct : A 🆚 B » ; à la fin du premier, on bascule sur le suivant encore en cours |
| Noms affichés | Vrais noms Slack |
| Refus de diffusion | Option joueur **« Ne pas me diffuser sur JP TV »** : si l'un des deux joueurs l'a activée, le combat n'est pas diffusé en direct (il reste dans le classement et les derniers combats) |
| Mode soir | Garde la priorité : pas d'alerte ni de direct quand le mode soir est affiché |
| Accès réseau | La TV est sur une IP whitelistée du reverse proxy : elle charge directement les pages du bot (`https://dashboard-lorient.dimsi.cloud/jeanpip/…`), pas de relais par le serveur du dashboard |
| Triche | La vue spectateur ne montre ni la main ni l'élixir des joueurs |

## 1. Bot — mode spectateur

- `matches.js` : `viewSpectator(match)` (terrain, unités, tours, QG, chrono, noms,
  capitaines ; **sans** main ni élixir) et `subscribeSpectator(fn)` qui reçoit les
  états de tous les combats diffusables.
- Diffusable = combat entre deux joueurs humains, en `running`, aucun des deux n'a
  activé le refus de diffusion.
- Routes (secret TV dédié, comme `/stats`, variable `TV_SECRET`) :
  - `GET /tv/arena?k=` : page de diffusion plein écran 1920×1080, réutilise
    `arena-board.js` sans contrôles ; affiche l'alerte, le combat, le bandeau
    « Aussi en direct », l'écran de fin (10 s) ;
  - `GET /api/tv/stream?k=` : SSE unique qui suit automatiquement le combat diffusé
    (setup à chaque changement de combat, puis états différentiels) ;
  - `GET /api/tv/arena?k=` : JSON `{ live: [...], ranking: [...], recent: [...] }`
    pour la carte du dashboard.
- Flux spectateur à **5 Hz** (au lieu de 10) avec interpolation côté page, pour
  ménager le navigateur de la TV Android.
- `arenaStore.recordResult` enrichit `history[]` : noms, tours détruites de chaque
  côté, durée, arène, raison de fin (QG, temps, forfait, déconnexion). Les anciennes
  entrées sans ces champs restent lisibles.
- Option joueur `tvOptOut` (dans `arena.json`) : case « Ne pas me diffuser sur
  JP TV » dans « Mon deck ».

## 2. Dashboard MagicDIMSI — « Priorité au direct »

- Nouveau module `dashboard/arene.js` (modèle `jeanpip.js`, zéro dépendance) :
  interroge `/api/tv/arena` toutes les 5 s, expose `/api/arene`. Bot injoignable
  ou secret absent → dormance, le reste du dashboard continue.
- Dès que `live` n'est pas vide (et hors mode soir) : calque plein écran au-dessus
  de la rotation contenant une iframe `/tv/arena`.
  1. alerte « 🔴 PRIORITÉ AU DIRECT » + « A 🆚 B » (~4 s) ;
  2. combat en plein écran jusqu'à la fin ;
  3. écran de fin 10 s, puis retour à la rotation.
- Le calque est sous le mode soir (z-index inférieur à 60) et ne s'ouvre pas
  quand celui-ci est actif.

## 3. Dashboard MagicDIMSI — carte « Arène »

- **Classement en direct** : top 7, tri identique à l'Accueil (victoires, puis %
  de victoire) — `arenaStore.ranking()`.
- **Derniers combats** : 5 derniers, ex. `Alice 🆚 Bob · 🏆 Alice · 3–1 tours · il y a 12 min`
  (nul : `🤝 Nul`).
- Pastille 🔴 « En direct » quand un combat tourne.
- Carte dans la rotation normale ; sort de la rotation si aucun combat n'a jamais
  été joué.

## 4. Livraison

1. PR bot (version **2.3**) : entrée en tête de `src/releases.js`,
   `npm version 2.3.0 --no-git-tag-version`, `node scripts/test-releases.js`,
   tag `v2.3` après merge. Release note joueurs : combats en direct sur JP TV,
   option « Ne pas me diffuser ».
2. Déploiement bot sur la VM (routes nouvelles, sans effet sur le jeu).
3. PR MagicDIMSI : `arene.js` + `arene.test.js` + calque + carte, spec dans
   `docs/superpowers/specs/`.

## Fluidité : limitation acceptée en V1

Le navigateur de la TV Android ne rendra sûrement pas le combat de façon fluide.
C'est accepté pour la V1 (décision de Paul, 2026-10-06) : c'est une limite du
logiciel de la TV, pas du jeu. Pas de prototype bloquant ni de rendu dégradé
spécifique ; on garde le flux à 5 Hz + interpolation. Une vraie fluidité passera
plus tard par un changement du logiciel qui tourne sur la TV.

## Hors périmètre

Son, commentaires automatiques, ralentis/replays, paris des spectateurs.
