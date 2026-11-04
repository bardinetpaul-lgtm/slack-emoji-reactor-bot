#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test de l'index des cartes (v3.9, src/cardIndex.js)
//
//  Module pur : on le charge dans une COPIE temporaire du projet
//  (aucune donnée réelle touchée) et on vérifie :
//    • codes uniques, même numérotation que le classeur ;
//    • HW<n> pour Halloween, OR<n> pour Octobre Rose ;
//    • byCode insensible à la casse, « 42 » = « #42 » ;
//    • cartes retirées de la banque.
//
//  Usage : node scripts/test-card-index.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-cardindex-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) {
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
}

const { listCards, codeOf, byCode } = require(path.join(TMP, 'src', 'cardIndex.js'));
const { HALLOWEEN_CARDS } = require(path.join(TMP, 'src', 'halloween.js'));
const { ROSE_CARDS } = require(path.join(TMP, 'src', 'octobreRose.js'));
const { SPAM_CARDS } = require(path.join(TMP, 'src', 'spamCards.js'));

let n = 0;
const ok = (name) => { n += 1; console.log(`  ✅ ${name}`); };

const cards = listCards();
assert(cards.length > 0, 'index vide');
const codes = cards.map((c) => c.code);
assert.strictEqual(new Set(codes).size, codes.length, 'codes en double');
ok('les codes sont uniques');

for (const c of cards) {
  assert(c.code && c.url && c.title !== undefined && c.rarity && c.type, `carte incomplète ${JSON.stringify(c)}`);
}
ok('chaque carte a code, url, title, rarity, type');

HALLOWEEN_CARDS.filter((c) => c.url).forEach((c) => {
  assert.strictEqual(codeOf(c.url), `HW${c.number}`);
});
ok('codeOf Halloween = HW<n>');
ROSE_CARDS.filter((c) => c.url).forEach((c) => {
  assert.strictEqual(codeOf(c.url), `OR${c.number}`);
});
ok('codeOf Octobre Rose = OR<n>');
SPAM_CARDS.forEach((c) => {
  assert.strictEqual(codeOf(c.url), `#${c.number}`);
});
ok('codeOf anti-spam = #N');

assert.strictEqual(byCode('hw1').url, HALLOWEEN_CARDS[0].url);
assert.strictEqual(byCode('HW1').code, 'HW1');
ok('byCode("hw1") insensible à la casse');

const first = cards.find((c) => /^#\d+$/.test(c.code));
const num = first.code.slice(1);
assert.deepStrictEqual(byCode(num), byCode(`#${num}`));
assert.strictEqual(byCode(num).url, first.url);
ok('byCode("42") équivaut à byCode("#42")');

assert.strictEqual(byCode('ZZ999'), null);
assert.strictEqual(byCode(''), null);
ok('code inconnu → null');

assert.strictEqual(codeOf('https://x.test/retiree', 'Surprise #999'), '#999');
assert.strictEqual(codeOf('https://x.test/r2', 'Sans numéro'), 'Sans numéro');
ok('carte retirée : #N du titre, sinon le titre');

for (const c of cards) assert.strictEqual(codeOf(c.url), c.code);
ok('codeOf(listCards) est cohérent avec les codes');

console.log(`\n${n} contrôles OK`);
fs.rmSync(TMP, { recursive: true, force: true });
