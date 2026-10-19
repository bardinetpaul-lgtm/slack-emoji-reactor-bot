# ⚔️ Raid Jeanpip — refonte de l'Attaque (conception)

_19 octobre 2026 — à valider par Paul avant le plan d'implémentation._

## Pourquoi

Aujourd'hui l'Attaque Jeanpip (12 Jeanpips/semaine ou 25 JP$) envoie une carte au hasard aux 7 derniers inscrits qui ont posté dans un channel. L'attaquant n'y gagne rien, les victimes ne peuvent rien faire, la cible est le hasard, et elle envoie 7 DM d'un coup. Il n'y a ni enjeu ni interaction.

Le Raid la remplace : l'attaquant **choisit** ses cibles, **prend** des cartes à celles qui tombent, et chaque victime peut **se défendre** et **riposter**.

## Décisions de Paul (19/10)

| Sujet | Décision |
|---|---|
| Déblocage | **100 Jeanpips dans la semaine** (gratuit) **ou 50 JP$** |
| Cibles | jusqu'à **5 personnes choisies**, **+10 JP$ par personne en plus** |
| Cartes envoyées | **aucune** : le raid n'envoie plus de carte |
| Butin | l'attaquant prend une carte à chaque victime qui tombe, **jamais une légendaire** ; un **doublon d'abord**, sinon une carte unique non légendaire |
| Défense | **pierre-feuille-ciseaux** : l'attaquant choisit **un style pour tout le raid** en secret, la victime devine ; **résultats révélés seulement à la fin du raid** |
| Riposte | une défense réussie fait perdre une carte **à l'attaquant** (même règle de butin) |
| Délai de défense | **20 minutes** |
| Horaires | **tout fini à 18h** : lancement en semaine de **9h à 17h40** seulement |
| Annonces | **en DM**, à l'attaquant et aux victimes seulement (pas de channel) |

## Déroulé

1. **Lancer** (Accueil → « ⚔️ Lancer un raid », ou `/jeanpip-attack`) : une modale avec
   - **Cibles** : sélection de personnes (inscrites à la liste de diffusion) ;
   - **Style d'attaque**, secret : 💥 Assaut · 🦊 Ruse · 🌫️ Embuscade ;
   - le **coût** : gratuit si débloqué, sinon 50 JP$, + 10 JP$ par cible au-delà de 5.
   Rien n'est débité tant que la modale n'est pas validée.
2. **Alerte** : chaque victime reçoit un DM « 🚨 RAID EN COURS ! <@attaquant> te raide » avec 3 boutons de défense et un compte à rebours de 20 min. Le raid apparaît aussi dans son Accueil.
3. **Défense** : un seul clic, définitif. La victime voit seulement « 🛡️ Défense enregistrée, résultat à la fin du raid (au plus tard à 10h42) ». **Elle ne connaît pas son résultat avant la fin**, pour qu'elle ne puisse pas souffler la bonne défense aux collègues (décision de Paul).
4. **Fin du raid** : au bout de 20 min, ou dès que toutes les victimes ont répondu. Les résultats tombent **tous en même temps** : un récap en DM à l'attaquant (« 5 cibles : 3 tombées, 1 repoussée, 1 riposte → +3 cartes, −1 carte ») et un DM de résultat à chaque victime, avec le style qui avait été choisi.

## Pierre-feuille-ciseaux

Chaque défense **bat** un style (riposte), **tient** contre un autre (rien ne se passe) et **cède** au dernier (la victime perd une carte) :

| Défense ↓ / Attaque → | 💥 Assaut | 🦊 Ruse | 🌫️ Embuscade |
|---|---|---|---|
| 🛡️ Bouclier | ✅ **riposte** | 🤝 repoussé | ❌ tombe |
| 🪤 Piège | ❌ tombe | ✅ **riposte** | 🤝 repoussé |
| 🏃 Esquive | 🤝 repoussé | ❌ tombe | ✅ **riposte** |

- **Pas de réponse en 20 min = tombe.**
- Pour une victime qui répond, c'est un tiers de chance pour chaque issue : l'attaquant gagne en moyenne autant qu'il risque. Le raid rapporte surtout sur les gens qui ne se défendent pas, et il reste risqué face à des joueurs attentifs.
- **Un seul style pour tout le raid**, et **aucun résultat avant la fin** : personne ne peut annoncer « c'était Assaut » au bureau pendant que les autres ont encore le temps de répondre. Le récap final révèle le style.
- Les victimes peuvent quand même se concerter pour **répartir leurs défenses** (une chacune) : ça garantit une riposte, un repoussé et une chute sur trois victimes. C'est une vraie tactique d'équipe, acceptée par Paul ; l'attaquant garde l'avantage sur les victimes qui ne répondent pas.

## Butin (raid réussi comme riposte)

- **Une carte par victime tombée**, prise dans le classeur de la victime et ajoutée à celui de l'attaquant. En cas de riposte, c'est l'inverse.
- **Ordre de choix** : une carte possédée en plusieurs exemplaires, tirée au hasard ; sinon une carte unique tirée au hasard.
- **Jamais** une 🟡 légendaire, ni une carte 🎀 Octobre Rose (hors série, introuvable ailleurs).
- Une victime sans carte prenable ne perd rien ; l'attaquant ne reçoit rien pour elle.
- Si la carte prise était dans un deck d'Arène, le deck est corrigé comme quand une carte manque (à vérifier dans `src/game/deck.js` pendant le plan).

## Garde-fous

- **Raids seulement en heures de bureau** (décision de Paul) : **tout doit être fini à 18h**. Lancement possible **du lundi au vendredi, de 9h à 17h40** (heure de Paris), pour que les 20 min de défense se terminent au plus tard à 18h. Hors de ces heures, le bouton « Lancer un raid » n'apparaît pas dans l'Accueil et la modale refuse. La pause du week-end (v3.3) est donc couverte d'office.
- **Une victime ne subit qu'un raid à la fois**, et **2 raids reçus par jour au maximum**, pour éviter l'acharnement. Les cibles indisponibles sont refusées dans la modale.
- Cibles valides : inscrites à la liste de diffusion, pas soi-même, pas un bot, pas sous pénalité anti-farm.
- Un seul raid lancé à la fois par attaquant. L'Attaque gratuite reste à une par semaine, et les scores repartent toujours à 0 le dimanche à 20h.
- Raid en cours au redémarrage du bot : il est enregistré sur disque et se termine au redémarrage (comme les pénalités anti-farm).

## Admins

- Plus d'Attaque « illimitée » pour les admins : un raid prend des cartes aux autres, donc les admins paient comme tout le monde.
- « 🎁 Offrir un raid » (panneau admin, `/jeanpip-give`) crédite un raid gratuit, comme l'ancienne Attaque offerte.

## Ce qui disparaît

- Le choix d'un channel, la réaction :jeanpip: posée sur les messages des victimes, l'envoi d'une carte aux victimes.
- Le seuil de 12 Jeanpips (→ 100) et le prix de 25 JP$ (→ 50).

## Traces et affichage

- Événements SQLite `raid_launched` et `raid_resolved` (cibles, style, réponses, cartes prises), pour les stats et un futur classement.
- Accueil : bloc « ⚔️ Raid » (lancer / raid en cours / se défendre), avec les mêmes boutons que dans le DM.
- Plus tard : classement « Raideur de la semaine », raids sur JP TV.

## Questions ouvertes (choix par défaut retenus ci-dessus)

1. Plafond de cibles payantes : **10 au total** (5 + 5 payantes) par défaut.
2. Bonus « raid parfait » quand toutes les cibles tombent : **aucun** par défaut, le butin suffit.
3. Numéro de version : **3.4** (refonte d'une fonctionnalité existante).
