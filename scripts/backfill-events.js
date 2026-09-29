#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  ⏪ Rattrapage de l'historique dans data/jeanpip.db
//  Idempotent : relançable sans doublon.
//  Usage : node scripts/backfill-events.js
// ═══════════════════════════════════════════════════════════
const { backfill } = require('../src/stats/backfill');

const r = backfill();
console.log('⏪ Rattrapage terminé :');
for (const [k, n] of Object.entries(r)) console.log(`   ${k.padEnd(10)} ${n}`);
