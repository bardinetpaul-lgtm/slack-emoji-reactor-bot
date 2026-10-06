#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test du « Type de carte » (Accueil → 👑 Admin → ⚔️ Type de carte)
//
//  • cards.setArchetype impose / retire le type d'une carte
//    (data/card-overrides.json), sans toucher à ses autres réglages ;
//  • la modale liste toutes les cartes (groupes par rareté, ≤ 100 options
//    par groupe) et retrouve la carte choisie ;
//  • « Ajouter un média » propose le type en Arène (optionnel).
//  Travaille dans une COPIE temporaire du projet.
//
//  Usage : node scripts/test-arena-cardtype.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-cardtype-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));
const OVR = path.join(TMP, 'data', 'card-overrides.json');
fs.writeFileSync(OVR, JSON.stringify({ keep: { archetype: 'sort', specialty: 'none' } }));

const origLog = console.log;
console.log = () => {};
const cards = require(path.join(TMP, 'src', 'game', 'cards.js'));
const home = require(path.join(TMP, 'src', 'home.js'));
const media = require(path.join(TMP, 'src', 'media.js'));
console.log = origLog;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

// ⚔️ Imposer / retirer
const url = media.getAllMedia()[0].url;
const auto = cards.archetypeFromUrl(url);
const other = ['tank', 'guerrier', 'tireur', 'essaim', 'sort', 'vigie'].find((a) => a !== auto);
const r = cards.setArchetype(url, other);
check('type imposé : enregistré et pris en compte tout de suite', r.ok && cards.getCardStats({ url, rarity: 'common' }).archetype === other);
check('type imposé : écrit dans data/card-overrides.json', JSON.parse(fs.readFileSync(OVR, 'utf-8'))[url].archetype === other);
check('les autres cartes surchargées sont gardées', JSON.parse(fs.readFileSync(OVR, 'utf-8')).keep.specialty === 'none');
const back = cards.setArchetype(url, null);
check('retour à l\'automatique : tirage stable d\'origine', back.ok && back.auto && cards.getCardStats({ url, rarity: 'common' }).archetype === auto);
check('retour à l\'automatique : l\'entrée vide disparaît', !(url in JSON.parse(fs.readFileSync(OVR, 'utf-8'))));
fs.writeFileSync(OVR, JSON.stringify({ [url]: { archetype: 'tank', specialty: 'bouclier' } }));
cards.reloadOverrides();
cards.setArchetype(url, 'guerrier');
check('changer le type garde la spécialité imposée', JSON.parse(fs.readFileSync(OVR, 'utf-8'))[url].specialty === 'bouclier');
check('type inconnu refusé', cards.setArchetype(url, 'dragon').ok === false);

// 🪟 Modales
const modal = home.buildCardTypeModal();
const select = modal.blocks.find((b) => b.block_id === 'card').element;
const count = select.option_groups.reduce((n, g) => n + g.options.length, 0);
check(`modale : toutes les cartes (${count}) rangées par rareté`, count === media.getAllMedia().length && select.option_groups.every((g) => g.options.length <= 100));
check('modale : textes d\'option dans la limite Slack (75)', select.option_groups.every((g) => g.options.every((o) => o.text.text.length <= 75 && o.value.length <= 150)));
check('modale : le type automatique est proposé', modal.blocks.find((b) => b.block_id === 'arch').element.options.some((o) => o.value === 'auto'));
const picked = select.option_groups[1].options[0].value;
check('modale : la carte choisie est retrouvée', home.cardFromValue(picked) && home.cardFromValue(picked).url === picked);
check('modale : valeur inconnue → aucune carte', home.cardFromValue('https://nope') === null);
const add = home.buildAddMediaModal();
const arch = add.blocks.find((b) => b.block_id === 'arch');
check('« Ajouter un média » : type en Arène optionnel (6 types)', arch && arch.optional && arch.element.options.length === 6);

try { require(path.join(TMP, 'src', 'db.js')).close(); } catch { /* base jamais ouverte */ }   // Windows : fichier ouvert = non supprimable
fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
