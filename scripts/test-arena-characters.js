#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test du générateur de personnages (src/game/characters.js)
//
//  Un perso par carte Jeanpip, stable, conforme à la DA
//  « Personnages - 125 cartes » ; calques surchargeables ;
//  tout le catalogue (et tout nouveau média) a son perso.
//  Travaille dans une COPIE temporaire du projet.
//
//  Usage : node scripts/test-arena-characters.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-arena-chars-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

const ARCHS = ['tank', 'guerrier', 'tireur', 'essaim', 'sort', 'pompe'];
const overrides = {};
for (const a of ARCHS) for (let i = 0; i < 60; i += 1) overrides[`${a}-${i}`] = { archetype: a };
overrides['retouche'] = { archetype: 'tank', character: { head: 'couronne', weapon: 'poings', accent: '#1C72F1', shield: false } };
overrides['retouche-bad'] = { archetype: 'tireur', character: { head: 'lourd', weapon: 'marteau' } };
fs.writeFileSync(path.join(TMP, 'data', 'card-overrides.json'), JSON.stringify(overrides));

const origLog = console.log;
console.log = () => {};
const characters = require(path.join(TMP, 'src', 'game', 'characters.js'));
const media = require(path.join(TMP, 'src', 'media.js'));
console.log = origLog;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const card = (url, rarity = 'common') => ({ url, title: url, rarity });
const all = (arch) => Array.from({ length: 60 }, (_, i) => characters.describeCharacter(card(`${arch}-${i}`)));
const P = characters.POOLS;

// 🎲 Stabilité
const a1 = characters.describeCharacter(card('guerrier-3'));
const a2 = characters.describeCharacter(card('guerrier-3'));
check('même carte → même personnage', JSON.stringify(a1) === JSON.stringify(a2));
check('cartes différentes → personnages variés',
  new Set(all('guerrier').map((c) => JSON.stringify(c.layers))).size >= 50);

// 🎭 Silhouettes par archétype (règles de la DA)
const tanks = all('tank');
check('Tank : couvre-chefs autorisés', tanks.every((c) => P.tank.head.includes(c.layers.head)));
check('Tank : armes autorisées', tanks.every((c) => P.tank.weap.includes(c.layers.weapon)));
check('Tank : jamais de cape', tanks.every((c) => !c.layers.cape));
check('Tank : grand bouclier parfois', tanks.some((c) => c.layers.shield) && tanks.some((c) => !c.layers.shield));

const melee = all('guerrier');
check('Guerrier = silhouette Mêlée', melee.every((c) => c.silhouette === 'melee'));
check('Mêlée : couvre-chefs et armes autorisés', melee.every((c) => P.melee.head.includes(c.layers.head) && P.melee.weap.includes(c.layers.weapon)));
check('Mêlée : cape possible', melee.some((c) => c.layers.cape));

const dist = all('tireur');
check('Tireur = silhouette Distance', dist.every((c) => c.silhouette === 'distance'));
check('Distance : jamais de bouclier', dist.every((c) => !c.layers.shield));
check('Distance : robe longue une fois sur deux environ', dist.filter((c) => c.layers.robe).length >= 15 && dist.filter((c) => c.layers.robe).length <= 45);
check('Distance : armes à distance', dist.every((c) => P.distance.weap.includes(c.layers.weapon)));

const swarm = all('essaim');
check('Essaim : trois fois le même personnage', swarm.every((c) => c.swarm === true));
check('Essaim : armes légères seulement', swarm.every((c) => P.essaim.weap.includes(c.layers.weapon)));

const pumps = all('pompe');
check('Pompe : bâtiment (toit, fenêtre variables)', pumps.every((c) => c.kind === 'pompe') && new Set(pumps.map((c) => c.layers.roof)).size === 3);
const spells = all('sort');
check('Sort : disque rose, symbole variable', spells.every((c) => c.kind === 'sort') && new Set(spells.map((c) => c.layers.glyph)).size === 5);
check('Sort : jamais un symbole rose sur le disque rose', spells.every((c) => c.layers.accent !== '#FF73C0'));

check('deux accents toujours différents', [...melee, ...tanks, ...dist].every((c) => c.layers.accent !== c.layers.accent2));

// ✍️ Retouche calque par calque
const r = characters.describeCharacter(card('retouche'));
check('surcharge : couvre-chef imposé', r.layers.head === 'couronne');
check('surcharge : arme imposée', r.layers.weapon === 'poings');
check('surcharge : accent imposé', r.layers.accent === '#1C72F1');
check('surcharge : bouclier retiré', r.layers.shield === false);
const bad = characters.describeCharacter(card('retouche-bad'));
check('surcharge hors silhouette ignorée (Tireur avec marteau)', bad.layers.weapon !== 'marteau' && bad.layers.head !== 'lourd');

// 🖼️ Rendu SVG
const svg = characters.renderSvg(card('tank-1'), { team: 'enemy' });
check('SVG complet', svg.startsWith('<svg') && svg.includes('viewBox="-45 -85 90 95"') && svg.endsWith('</svg>'));
check('SVG : couleur du camp adverse sur le disque', svg.includes('#FF6229'));
check('SVG : dégradé DA défini', svg.includes('id="dg"'));
const sym = characters.renderSymbol(card('essaim-1'), 'p1');
check('symbole réutilisable', sym.startsWith('<symbol id="p1"') && sym.includes('<path'));
check('essaim : 3 exemplaires dans le rendu', (characters.renderUse(card('essaim-1'), 'p1').match(/<use /g) || []).length === 3);
check('description texte pour Slack', /Tank/.test(characters.describeText(card('tank-1'))));

// 📚 Tout le catalogue, et tout nouveau Jeanpip, a son perso
const bank = media.getAllMedia();
let broken = 0;
for (const m of bank) {
  const s = characters.renderSvg(m);
  if (/NaN|undefined|null/.test(s) || !s.includes('<path')) broken += 1;
}
check(`les ${bank.length} médias du catalogue ont un personnage valide`, broken === 0);
console.log = () => {};
const added = media.addMedia({ url: 'https://example.com/nouveau-jeanpip.gif', rarity: 'epic', title: 'Test' });
console.log = origLog;
const fresh = characters.renderSvg(added.media);
check('un Jeanpip tout juste ajouté a son personnage', added.ok && fresh.includes('<path') && !/NaN|undefined/.test(fresh));

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
