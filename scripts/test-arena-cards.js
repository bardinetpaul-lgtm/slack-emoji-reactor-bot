#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test des données de cartes de l'Arène (src/game/cards.js)
//
//  Travaille dans une COPIE temporaire du projet (aucune donnée réelle
//  touchée) : archétype stable, répartition, surcharges, rareté, contres.
//
//  Usage : node scripts/test-arena-cards.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-arena-cards-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));

const cards = require(path.join(TMP, 'src', 'game', 'cards.js'));
const specialties = require(path.join(TMP, 'src', 'game', 'specialties.js'));

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

// 🎲 Archétype stable et répartition conforme
const url = 'https://slack-files.com/T6EFSEHCN-F0APX27B02Z-0abf85e576';
check('archétype stable pour une même URL', cards.archetypeFromUrl(url) === cards.archetypeFromUrl(url));

const N = 10000;
const tally = {};
for (let i = 0; i < N; i += 1) {
  const a = cards.archetypeFromUrl(`https://example.com/card-${i}`);
  tally[a] = (tally[a] || 0) + 1;
}
for (const [key, arch] of Object.entries(cards.ARCHETYPES)) {
  const pct = (100 * (tally[key] || 0)) / N;
  check(`répartition ${key} ≈ ${arch.share} % (obtenu ${pct.toFixed(1)} %)`, Math.abs(pct - arch.share) <= 2);
}

// ✍️ Surcharge manuelle prioritaire
fs.writeFileSync(path.join(TMP, 'data', 'card-overrides.json'), JSON.stringify({
  [url]: { archetype: 'pompe', specialty: 'ralenti' },
}));
cards.reloadOverrides();
const over = cards.getCardStats({ url, title: 'Surprise #1', rarity: 'common' });
check('surcharge : archétype imposé', over.archetype === 'pompe');
check('surcharge : spécialité transmise', over.specialty === 'ralenti');

// 💎 Rareté
fs.writeFileSync(path.join(TMP, 'data', 'card-overrides.json'), JSON.stringify({
  'u-guerrier': { archetype: 'guerrier' },
  'u-pompe': { archetype: 'pompe' },
  'u-sort': { archetype: 'sort' },
}));
cards.reloadOverrides();
const gC = cards.getCardStats({ url: 'u-guerrier', rarity: 'common' });
const gL = cards.getCardStats({ url: 'u-guerrier', rarity: 'legendary' });
const L = cards.RARITY_MODS.legendary;
check('légendaire : PV multipliés', Math.abs(gL.hp - gC.hp * L.mult) < 1e-9);
check('légendaire : dégâts inchangés (la rareté ne renforce que les PV)', gL.dps === gC.dps);
check('légendaire : coût +1', gL.cost === gC.cost + L.cost);
check('rareté inconnue → commune', cards.getCardStats({ url: 'u-guerrier', rarity: 'bidon' }).hp === gC.hp);

const pC = cards.getCardStats({ url: 'u-pompe', rarity: 'common' });
const pL = cards.getCardStats({ url: 'u-pompe', rarity: 'legendary' });
check('Pompe légendaire : PV et durée de vie augmentés', pL.hp > pC.hp && pL.lifetimeMs > pC.lifetimeMs);
check('Pompe légendaire : cadence de production inchangée', pL.productionMs === pC.productionMs);

const sL = cards.getCardStats({ url: 'u-sort', rarity: 'legendary' });
check('Sort légendaire : dégâts multipliés', sL.damage > cards.getCardStats({ url: 'u-sort', rarity: 'common' }).damage);

// ⚔️ Contres dans les deux sens
check('Tank → Guerrier : le Guerrier ne fait que ×0,67 au Tank', cards.damageMultiplier('guerrier', 'tank') === 0.67);
check('Guerrier → Tireur ×1,5', cards.damageMultiplier('guerrier', 'tireur') === 1.5);
check('Tireur → Essaim ×1,5', cards.damageMultiplier('tireur', 'essaim') === 1.5);
check('Essaim → Tank ×1,5', cards.damageMultiplier('essaim', 'tank') === 1.5);
check('Sort → Essaim ×1,5', cards.damageMultiplier('sort', 'essaim') === 1.5);
check('Tireur contre Guerrier ×0,67', cards.damageMultiplier('tireur', 'guerrier') === 0.67);
check('neutre ×1', cards.damageMultiplier('guerrier', 'essaim') === 1);
check('contre un bâtiment ×1', cards.damageMultiplier('guerrier', 'tower') === 1);

// 🧩 Registre des spécialités
specialties.register('test', { onHit: () => 0 });
check('spécialité enregistrée puis retrouvée', typeof specialties.get('test').onHit === 'function');
check('spécialité inconnue → null', specialties.get('nope') === null);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
