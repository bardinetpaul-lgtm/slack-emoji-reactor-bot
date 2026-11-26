#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🧪 Test v4.4.2 (bug n° 21) : aperçu des cartes proposées dans un échange
//
//  Dans une COPIE temporaire du projet (aucune donnée réelle touchée) :
//    • demande à une personne, demande générale, contre-offre : chaque carte
//      proposée a sa vignette (image), sa rareté, et le nombre d'exemplaires
//      que celui qui la reçoit possède déjà (ou « pas encore »)
//    • au-delà de 5 cartes : « … et N autres cartes »
//    • une offre en JP$ seulement n'ajoute rien ; une demande close non plus
//    • bug n° 28 : carte possédée mais dans un deck = 🔒 (absente = barrée)
//
//  Usage : npx -y -p node@20 node scripts/test-trades-offer-preview.js
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jeanpip-offer-preview-'));
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction');
fs.mkdirSync(path.join(TMP, 'data'));
fs.copyFileSync(path.join(ROOT, 'data', 'media-bank.json'), path.join(TMP, 'data', 'media-bank.json'));
process.env.WEB_PUBLIC_URL = 'https://jeu.test/';

let failed = 0;
const check = (ok, label) => { console.log(`${ok ? '✅' : '❌'} ${label}`); if (!ok) failed += 1; };
const req = (m) => require(path.join(TMP, 'src', m));

const tradesSlack = req('tradesSlack.js');
const collections = req('collections.js');
const cardIndex = req('cardIndex.js');

const all = cardIndex.listCards();
const epic = all.find((c) => c.rarity === 'epic');
const commons = all.filter((c) => c.rarity === 'common').slice(0, 6);
const wanted = all.find((c) => c.rarity === 'rare');

// A (acheteur) propose l'épique ; B (vendeur) en a déjà 2
collections.addCards('UA', [{ ...epic }]);
collections.addCards('UB', [{ ...wanted }, { ...epic }, { ...epic }]);

const previews = (msg) => msg.blocks.filter((b) => b.type === 'section' && /^🃏/.test(b.text.text));
const base = { id: 'T1', buyer: 'UA', seller: 'UB', card: wanted, status: 'open', expiresAt: Date.now() + 3600e3, counters: {} };

// 1. Demande à une personne (DM du vendeur)
const direct = tradesSlack.buildSellerDM({ ...base, kind: 'direct', offer: { jp: 5, cards: [epic.url] } }, 'UB');
let p = previews(direct);
check(p.length === 1, 'demande directe : 1 aperçu pour 1 carte proposée');
check(p[0] && p[0].accessory && p[0].accessory.type === 'image' && /^https:\/\/jeu\.test\//.test(p[0].accessory.image_url), `vignette de la carte (${p[0] && p[0].accessory && p[0].accessory.image_url})`);
check(p[0] && p[0].text.text.includes(epic.code) && /Épique/.test(p[0].text.text), 'numéro et rareté (🟣 Épique) affichés');
check(p[0] && /tu en as déjà \*2\*/.test(p[0].text.text), 'B voit qu\'il en a déjà 2');

// 2. Demande générale reçue par C, qui ne l'a pas
const general = tradesSlack.buildRequestDM({ ...base, kind: 'general', seller: null, offer: { jp: 0, cards: [epic.url] } }, 'UC');
p = previews(general);
check(p.length === 1 && /pas encore/.test(p[0].text.text), 'demande générale : C voit « tu ne l\'as pas encore »');

// 3. Contre-offre de B : A reçoit des communes, 6 cartes → 5 aperçus + « … et 1 autre carte »
collections.addCards('UB', commons.map((c) => ({ ...c })));
collections.addCards('UA', [{ ...commons[0] }]);
const counterTrade = { ...base, kind: 'general', seller: null, offer: { jp: 5, cards: [] }, held: { UA: 5 },
  counters: { UB: { jp: 0, cards: commons.map((c) => c.url), status: 'open', expiresAt: Date.now() + 3600e3 } } };
const counterDM = tradesSlack.buildCounterBuyerDM(counterTrade, 'UB');
p = previews(counterDM);
check(p.length === 5, `contre-offre : 5 aperçus au plus (${p.length})`);
check(p[0] && /tu en as déjà \*1\*/.test(p[0].text.text), 'A voit qu\'il a déjà 1 exemplaire de la première commune');
check(JSON.stringify(counterDM.blocks).includes('… et 1 autre carte'), '« … et 1 autre carte » pour la 6e');
check(counterDM.blocks.length <= 50, 'moins de 50 blocs (limite Slack)');

// 4. JP$ seulement, ou demande close : aucun aperçu
check(previews(tradesSlack.buildSellerDM({ ...base, kind: 'direct', offer: { jp: 20, cards: [] } }, 'UB')).length === 0, 'offre en JP$ seulement : pas d\'aperçu');
check(previews(tradesSlack.buildSellerDM({ ...base, kind: 'direct', status: 'refused', offer: { jp: 0, cards: [epic.url] } }, 'UB')).length === 0, 'demande close : pas d\'aperçu');

// 5. Sans adresse publique : le texte reste, sans image
process.env.WEB_PUBLIC_URL = '';
p = previews(tradesSlack.buildSellerDM({ ...base, kind: 'direct', offer: { jp: 0, cards: [epic.url] } }, 'UB'));
check(p.length === 1 && !p[0].accessory, 'sans WEB_PUBLIC_URL : aperçu texte, sans image');

// 6. Bug n° 28 : carte possédée mais dans un deck → 🔒 (pas barrée comme une carte absente)
process.env.TRADES_DAILY_LIMIT = '1000';
const broadcast = req('broadcast.js');
for (const u of ['UA', 'UD']) broadcast.subscribe(u);
const locked = all.filter((c) => c.rarity === 'rare')[3];
const absent = all.filter((c) => c.rarity === 'rare')[4];
collections.addCards('UD', [{ ...locked }, { ...wanted }]);
req(path.join('game', 'arenaStore.js')).setDecks('UD', { active: 0, decks: [{ cards: [locked.url] }, {}, {}] });
const modal = JSON.stringify(tradesSlack.buildDirectModal('UA', 'UD'));
check(modal.includes(`🔒${locked.code}`), `carte dans un deck : 🔒${locked.code}`);
check(modal.includes(`*${wanted.code}*`), `carte libre : en gras (${wanted.code})`);
check(modal.includes(`~${absent.code}~`), `carte absente : barrée (${absent.code})`);
check(/possédées mais bloquées/.test(modal), 'la légende explique le 🔒');

console.log(failed ? `\n❌ ${failed} échec(s)` : '\n✅ Tout est bon');
process.exit(failed ? 1 : 0);
