# 🎟️ Tickets à gratter « ESSAI ! » — design

Date : 2026-10-13 · Validé avec Paul en brainstorming.

## Intention

Un ticket à gratter façon Goal / Maxi Goal (FDJ), en DA **rugby**, acheté en JP$ et
gratté pour de vrai (souris / doigt) sur une page web. Il rembourse souvent la mise
(envie de rejouer), donne parfois une **carte légendaire** ou un **gros lot** de JP$,
et reste **rentable pour le jeu** : à force d'en faire, on perd plus qu'on ne gagne.

## Règles

- Prix par défaut **5 JP$**, réglable par un admin (entier 1–100).
- **10 tickets par jour et par joueur** (jour de Paris), réglable par un admin (1–100).
- Un seul ticket non gratté à la fois. Joueur sous pénalité anti-farm : achat refusé.
- 9 ballons ovales à gratter (grille 3×3). **3 symboles identiques = le lot du symbole.**
  Un ticket gagne au plus un lot.

| Symbole | Lot | Chance |
|---|---|---|
| 🏆 Coupe | Carte légendaire | prix ÷ 300 (1/60 à 5 JP$), plafond 50 % |
| 🥅 Poteaux | ×40 la mise (gros lot) | 0,2 % |
| 🏉 Ballon ovale | ×10 | 0,8 % |
| 👕 Maillot | ×4 | 2,5 % |
| 👟 Crampon | ×2 | 8 % |
| 📣 Sifflet | ×1 (mise remboursée) | 22 % |
| 🟨 Carton jaune | perdant (remplissage) | — |

- Lots JP$ = multiples du prix, arrondis au demi-JP$ → l'équilibre ne bouge pas si le prix change.
- Retour JP$ ≈ 64 % de la mise ; ~1 ticket sur 2,8 gagnant ; ~300 JP$ dépensés par légendaire
  (≈ 108 JP$ net). Un joueur à 10 tickets/jour : ~5 légendaires et ~−540 JP$ par mois
  (1/40 jugé trop généreux par Paul : 7,5/mois).
- Grilles perdantes : jamais 3 identiques, souvent une paire (parfois 2 🛡️ : « presque ! »).

## Architecture

- `src/scratch.js` — logique pure : table des lots, tirage, grille, lots selon le prix.
- `src/scratchTickets.js` — persistance `data/scratch.json` (écriture atomique) + achat
  (`buy`) et grattage (`markScratched`) **synchrones** (anti double-clic / 2 onglets).
- `src/scratchWeb.js` — routes web (lien signé par joueur, comme « Mon deck ») :
  - `GET /tickets?t=` page · `GET /api/tickets?t=` état
  - `POST /api/tickets/buy?t=` · `POST /api/tickets/<id>/scratched?t=`
- `public/tickets.html|css|js` — le Kiosque : solde, compteur du jour, ticket, grattage
  `<canvas>` par ballon, « Tout gratter », « Rejouer ».
- `src/settings.js` — `ticketPrice`, `ticketDailyLimit`.
- `src/home.js` / `src/app.js` — bouton « 🎟️ Tickets ESSAI ! » (lien) + bouton admin
  « 🎟️ Tickets à gratter » (modale prix + limite).

### Achat (tout dans le même tick)
pénalité ? → ticket en attente ? → limite du jour ? → `credits.spend(prix, {source:'scratch', item:'ticket'})`
→ tirage → **gain versé tout de suite** (`addCredit(…, {source:'scratch', item:'win'})` ou
légendaire via `collections.addCards`) → ticket enregistré → `events.record('scratch_ticket')`.
Fermer l'onglet ne fait rien perdre ; la page reprend le ticket non gratté.
Le lot n'est envoyé à la page qu'au grattage terminé.

## Visuel

Version CSS/emoji rugby (pelouse, craie, maillot rayé) en attendant le design de Paul
(fond portrait ~600×900, ballon couvert PNG, 7 symboles PNG ; montants en texte par-dessus).

## Tests

`scripts/test-scratch.js` : grilles cohérentes avec le lot, jamais de triple perdant,
lots selon le prix, simulation (RTP ≈ 64 %, légendaire ≈ 1/60), achat (limite, solde,
pénalité, ticket en attente, double grattage), routes web (jeton invalide, parcours complet).
