#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test du générateur de personnages (src/game/characters.js)
//
//  • Une DA GLOBALE par rôle : Tank = char à chenilles, Tireur = arc +
//    carquois, Essaim = ailé (vole), Guerrier = épaulières + arme.
//  • Chaque carte est habillée par SON look (src/game/looks.js) :
//    couvre-chef, coupe, lunettes, moustache, pipe, couleurs…
//  • Stable, retouchable (card-overrides.json), et tout le catalogue
//    (et tout nouveau média) a un perso valide et à peu près unique.
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
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));

const ARCHS = ['tank', 'guerrier', 'tireur', 'essaim', 'sort', 'vigie'];
const overrides = {};
for (const a of ARCHS) for (let i = 0; i < 60; i += 1) overrides[`${a}-${i}`] = { archetype: a };
overrides.retouche = { archetype: 'guerrier', character: { head: 'couronne', weapon: 'hache', glasses: 'soleil', facial: 'guidon', accessories: ['pipe'], outfit: '#1C72F1' } };
overrides['retouche-bad'] = { archetype: 'guerrier', character: { head: 'lourd', weapon: 'bazooka', accessories: ['fusee'], outfit: 'bleu' } };
// une carte « analysée » (look stocké comme après Haiku)
overrides['https://slack-files.com/T1-FANALYSE1-abc'] = { archetype: 'tank' };
fs.writeFileSync(path.join(TMP, 'data', 'card-overrides.json'), JSON.stringify(overrides));
fs.writeFileSync(path.join(TMP, 'data', 'card-looks.json'), JSON.stringify({
  FANALYSE1: { rules: 2, source: 'haiku', traits: { head: 'chapeau', hairStyle: 'bol', glasses: 'soleil', facial: 'moustache', accessories: ['pipe', 'chaine'], weapon: 'masse', skin: '#e0a896', hair: '#b8a590', hatColor: '#d8201e', outfit: '#1c2233', outfit2: '#6f8195', accent: '#d8201e', prop: 'pipe', vibe: 'test' } },
}));

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
const layerOf = (c, layer) => c.parts.filter((p) => p.layer === layer);

// 🎲 Stabilité et variété
const a1 = characters.describeCharacter(card('guerrier-3'));
const a2 = characters.describeCharacter(card('guerrier-3'));
check('même carte → même personnage', JSON.stringify(a1) === JSON.stringify(a2));
check('cartes différentes → personnages variés', new Set(all('guerrier').map((c) => JSON.stringify(c.parts))).size >= 55);

// 🎭 DA globale par rôle
const tanks = all('tank');
check('Tank = char à chenilles (roule)', tanks.every((c) => c.walk === 'roll' && layerOf(c, 'treads').length >= 5));
check('Tank : le personnage sort de la tourelle (tête dessinée)', tanks.every((c) => c.parts.some((p) => p.tf && p.tf.includes('scale(0.74)'))));
const melee = all('guerrier');
check('Guerrier = marche, arme à part (frappe au contact)', melee.every((c) => c.walk === 'step' && layerOf(c, 'weapon').length > 0));
check('Guerrier : épaulières de métal', melee.every((c) => c.parts.filter((p) => p.fill === '#D9DCDA').length >= 2));
const dist = all('tireur');
check('Tireur : toujours un arc (calque arme) et un carquois', dist.every((c) => layerOf(c, 'weapon').some((p) => p.d.startsWith('M21 -58Q41')) && layerOf(c, 'back').length >= 4));
const swarm = all('essaim');
check('Essaim : ailé, il vole', swarm.every((c) => c.walk === 'fly' && layerOf(c, 'wings').length >= 2 && c.swarm));
check('Sort immobile', all('sort').every((c) => c.walk === 'none'));
check('Vigie : silhouette d\'archer', all('vigie').every((c) => c.silhouette === 'distance' && c.kind === 'fighter'));
check('Sort : jamais un symbole rose sur le disque rose', all('sort').every((c) => c.parts[2].fill !== '#FF73C0'));

// 🔎 Le look de la carte habille le perso
const an = characters.describeCharacter(card('https://slack-files.com/T1-FANALYSE1-abc'));
check('look analysé : repris tel quel (chapeau, bol, soleil, moustache, pipe, chaîne)', an.layers.source === 'haiku' && an.layers.head === 'chapeau' && an.layers.hairStyle === 'bol' && an.layers.accessories.includes('pipe'));
check('look analysé : pipe dessinée', an.parts.some((p) => p.d.startsWith('M3 9L10.5 10.2')));
check('look analysé : couleur de chapeau de la photo (rouge)', an.parts.some((p) => /^#D[0-9A-F]{5}$/.test(p.fill) && p.tf));
check('description texte : reprend le contenu', /char d’assaut/.test(characters.describeText(card('https://slack-files.com/T1-FANALYSE1-abc'))) && /pipe/.test(characters.describeText(card('https://slack-files.com/T1-FANALYSE1-abc'))));

// ✍️ Retouche à la main
const r = characters.describeCharacter(card('retouche'));
check('surcharge : couvre-chef, arme, lunettes, moustache, accessoire imposés', r.layers.head === 'couronne' && r.layers.weapon === 'hache' && r.layers.glasses === 'soleil' && r.layers.facial === 'guidon' && r.layers.accessories.join() === 'pipe');
check('surcharge : couleur imposée', r.layers.outfit === '#1C72F1');
const bad = characters.describeCharacter(card('retouche-bad'));
check('surcharge hors vocabulaire ignorée', bad.layers.head !== 'lourd' && bad.layers.weapon !== 'bazooka' && !bad.layers.accessories.includes('fusee') && bad.layers.outfit !== 'bleu');

// 🖼️ Rendu SVG et jeux de symboles animés
const svg = characters.renderSvg(card('tank-1'), { team: 'enemy' });
check('SVG complet', svg.startsWith('<svg') && svg.includes('viewBox="-45 -85 90 95"') && svg.endsWith('</svg>'));
check('SVG : couleur du camp adverse sur le disque', svg.includes('#FF6229'));
check('SVG : dégradé DA défini', svg.includes('id="dg"'));
const g = characters.renderSpriteSet(card('guerrier-1'), 'g1');
check('Guerrier : symboles dos / avant / arme', g.sprite.walk === 'step' && ['g1', 'g1-b', 'g1-f', 'g1-w'].every((id) => g.svg.includes(`id="${id}"`)));
const e = characters.renderSpriteSet(card('essaim-1'), 'e1');
check('Essaim : symboles corps / ailes', e.sprite.walk === 'fly' && e.svg.includes('id="e1-f"') && e.svg.includes('id="e1-w"'));
const t = characters.renderSpriteSet(card('tank-2'), 't1');
check('Tank : caisse séparée (chenilles animées par le terrain)', t.sprite.walk === 'roll' && t.svg.includes('id="t1-f"'));
check('essaim : 3 exemplaires dans le rendu', (characters.renderUse(card('essaim-1'), 'p1').match(/<use /g) || []).length === 3);

// 📚 Tout le catalogue, et tout nouveau Jeanpip, a son perso (à peu près unique)
const bank = media.getAllMedia();
let broken = 0;
for (const m of bank) {
  const s = characters.renderSvg(m);
  if (/NaN|undefined|null/.test(s) || !s.includes('<path')) broken += 1;
}
check(`les ${bank.length} médias du catalogue ont un personnage valide`, broken === 0);
const fighters = bank.map((m) => characters.describeCharacter(m)).filter((c) => c.kind === 'fighter');
check('catalogue : chaque combattant a son dessin propre', new Set(fighters.map((c) => JSON.stringify(c.parts))).size === fighters.length);
console.log = () => {};
const added = media.addMedia({ url: 'https://example.com/nouveau-jeanpip.gif', rarity: 'epic', title: 'Test' });
console.log = origLog;
const fresh = characters.renderSvg(added.media);
check('un Jeanpip tout juste ajouté a son personnage (avant même son analyse)', added.ok && fresh.includes('<path') && !/NaN|undefined/.test(fresh));

try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }   // Windows : fichier ouvert = non supprimable
fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
