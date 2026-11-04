// ═══════════════════════════════════════════════════════════
//  🔊 Bruitages de l'ouverture de booster (v3.9)
//
//  Fichiers dans public/assets/sounds/ :
//    • rare.mp3 / epic.mp3 / legendaire.mp3 → révélation d'une carte
//    • ouverture.mp3 (facultatif) → déchirure du pack ; absent, la
//      page garde la déchirure synthétique. Il suffit de le déposer.
//  ⚠️ /assets/ est mis en cache 7 jours : pour remplacer un son,
//     changer aussi son nom (ex. legendaire-v3.mp3) ici.
//  Commune, 🎀 Octobre Rose, 🎃 Halloween : son synthétique (open.js).
//
//  Son ACTIVÉ par défaut ; seul un « off » mémorisé (bouton 🔇) le coupe.
//
//  Node : require('public/open-sounds.js') · Navigateur : window.OpenSounds
// ═══════════════════════════════════════════════════════════
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenSounds = api;
}(typeof self !== 'undefined' ? self : this, function () {
  const DIR = 'assets/sounds/';

  const FILES = Object.freeze({
    open: 'ouverture.mp3',
    rare: 'rare.mp3',
    epic: 'epic.mp3',
    legendary: 'legendaire.mp3',
  });

  // Fichier joué à la révélation d'une carte (null = son synthétique)
  function revealFileFor(rarity) {
    return ['rare', 'epic', 'legendary'].includes(rarity) ? FILES[rarity] : null;
  }

  // Valeur lue dans localStorage('jeanpip-sound') → son actif ?
  function isSoundOn(stored) {
    return stored !== 'off';
  }

  return { DIR, FILES, revealFileFor, isSoundOn };
}));
