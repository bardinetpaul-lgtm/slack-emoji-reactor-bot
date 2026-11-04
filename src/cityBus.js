// ═══════════════════════════════════════════════════════════
//  🏙️ Bus d'événements de la ville Jeanpip (v4.0)
//  Le bot y publie ce qui doit se voir dans la ville ; src/villeWeb.js
//  l'écoute et le pousse aux pages ouvertes (SSE).
//
//    'jp'  { userId, amount, at }   un Jeanpip délivré a rapporté des JP$
//
//  Un écouteur qui plante ne doit jamais faire tomber le bot :
//  emitSafe() avale et journalise l'erreur.
// ═══════════════════════════════════════════════════════════

const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(50);

function emitSafe(event, payload) {
  try {
    bus.emit(event, payload);
  } catch (e) {
    console.error(`[ville] écouteur ${event} :`, e.message);
  }
}

module.exports = { bus, emitSafe };
