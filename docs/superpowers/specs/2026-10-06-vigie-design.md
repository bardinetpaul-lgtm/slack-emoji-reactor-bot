# v2.3 — La Vigie 🗼 remplace la Pompe

> Statut : validé par Paul le 2026-10-06 (nom « Vigie », mécanique et Capitaine « Garnison »).

## Pourquoi

La Pompe (+1 élixir toutes les 7 s pendant 45 s) n'apporte rien au jeu. Paul veut à la place une carte
« associée à une tour » : un personnage monte sur une tour pour qu'elle **défende mieux** et **attaque mieux**.

## La carte Vigie 🗼

| | Valeur (carte commune) |
|---|---|
| Coût | 4 élixir |
| Part des cartes | 5 % (la place exacte de la Pompe dans le tirage) |
| Durée sur la tour | 40 s (la rareté allonge la durée) |
| Garde | +150 PV de garde, qui encaissent les coups avant la tour (la rareté les augmente) — 250 avant équilibrage |
| Tir | dégâts de la tour +30 % — +60 % avant équilibrage |
| Portée | +2 — +4 avant équilibrage |

Règles :
- On pose la Vigie en touchant son camp : elle va sur **sa tour vivante la plus proche du point touché qui n'a pas déjà
  une Vigie** (une Vigie en cours de pose compte comme présente). Aucune tour libre → refus « Aucune tour libre ».
- Apparition après le délai normal d'une pose (0,5 s).
- Au bout de la durée, la Vigie redescend : sa carte est **sauvée** (comme une Pompe expirée aujourd'hui).
- Si la tour tombe avec la Vigie dessus, la carte est **perdue** (comme une troupe détruite).
- En fin de combat, une Vigie encore en poste suit la règle des troupes vivantes (gardée sauf défaite).
- Le QG ne peut pas recevoir de Vigie.

Design : le personnage de la carte (sa vraie tête, silhouette d'archer, à la couleur de son camp) debout sur les
créneaux de la tour, un petit étendard, un halo autour de la tour et une barre de garde (dorée) au-dessus de la barre de PV.

## Capitaine « Garnison » (remplace « Économie »)

Le Capitaine est lié à l'archétype de sa carte : le Capitaine d'une Vigie devient « Garnison ».
- Passif : tes Vigies restent deux fois plus longtemps (50 % avant équilibrage).
- Pouvoir « Alarme » (1×, sans point à viser) : toutes tes tours en vie tirent deux fois plus fort pendant 6 s.

Le style « Économie » (élixir de départ, élixir max 11, recharge +5 %) et le pouvoir « Surchauffe » disparaissent.

## Migration

- Les cartes qui tiraient « Pompe » tirent « Vigie » (même tranche du tirage) : aucune carte ne change de type sinon.
- `data/card-overrides.json` : une surcharge `"archetype": "pompe"` est lue comme `"vigie"` ; l'admin ne propose plus « Pompe ».
- Les decks dont le Capitaine était une Pompe ont automatiquement un Capitaine Garnison.

## Équilibrage

Relancer `scripts/simulate-balance.js` (toutes sections) avec la Vigie et le Capitaine Garnison joués par les bots, et
régler les valeurs (Vigie, Garnison, et si besoin les autres) jusqu'à respecter les critères du script :
aucune rareté > 70 % en duel, chaque archétype commun 35-65 %, spécialité ≤ +8 pts, chaque Capitaine 40-65 %,
deck riche > 50 % à stratégie égale, bon joueur commun ≥ 60 % contre mauvais joueur riche.
Les valeurs finales remplacent celles du tableau ci-dessus (la release note donne les valeurs réelles).
