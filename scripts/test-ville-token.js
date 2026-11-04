#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Jeton de la ville Jeanpip (src/villeToken.js) + câblage web.js (v4.0)
//  Usage : node scripts/test-ville-token.js
// ═══════════════════════════════════════════════════════════
const path = require('path');
const crypto = require('crypto');

process.env.WEB_PUBLIC_URL = 'http://jeanpip.test';
process.env.WEB_SECRET = 'test-secret';

const origLog = console.log;
console.log = () => {};
const web = require(path.join(__dirname, '..', 'src', 'web.js'));
const villeToken = require(path.join(__dirname, '..', 'src', 'villeToken.js'));
console.log = origLog;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures += 1;
}

const token = (u) => decodeURIComponent(villeToken.query(u).slice(2));
check('jeton valide → userId', villeToken.read(token('UA1')) === 'UA1');
check('jeton d\'un autre joueur refusé', villeToken.read(`UB2.${villeToken.sign('UA1')}`) === null);
check('hex tronqué refusé', villeToken.read(token('UA1').slice(0, -2)) === null);
const ticketsHmac = crypto.createHmac('sha256', 'test-secret').update('tickets|UA1').digest('hex');
check('jeton « tickets| » refusé', villeToken.read(`UA1.${ticketsHmac}`) === null);
check('vide / null refusés', villeToken.read('') === null && villeToken.read(null) === null);
check('buildVilleUrl → /ville?t=', web.buildVilleUrl('UA1') === `http://jeanpip.test/ville?${villeToken.query('UA1')}`);

console.log(failures ? `\n❌ ${failures} échec(s)` : '\n✅ Tout est bon');
process.exit(failures ? 1 : 0);
