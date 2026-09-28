#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  ⏱️ Contrôle de rapidité de l'Arène (à lancer SUR LE SERVEUR)
//
//  Mesure, avec le vrai code et les vraies cartes de la machine :
//    1. le moteur : N combats simultanés (bots), temps d'un pas de 100 ms ;
//    2. l'envoi aux joueurs : vue + allègement + envoi différentiel,
//       temps et taille par état, débit par joueur ;
//    3. le démarrage d'un combat : dessins des 16 personnages ;
//    4. « Mon deck » / préparation : catalogue de toutes les cartes ;
//    5. les looks (card-looks.json) et la mémoire ;
//    6. (option --web URL) les temps de réponse HTTP des pages de l'Arène ;
//    7. (option --haiku) une analyse de photo par Haiku, de bout en bout.
//  Lecture seule : rien n'est écrit, aucun joueur n'est touché.
//
//  Usage (sur la VM, depuis la racine du repo) :
//    node scripts/check-arena-perf.js
//    node scripts/check-arena-perf.js --matches 20
//    node scripts/check-arena-perf.js --web http://127.0.0.1:3100 --haiku
// ═══════════════════════════════════════════════════════════
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const origLog = console.log;
console.log = () => {};   // media.js annonce le catalogue au chargement
const media = require('../src/media');
const engine = require('../src/game/engine');
const cards = require('../src/game/cards');
const characters = require('../src/game/characters');
const looks = require('../src/game/looks');
const wire = require('../public/arena-wire');
const { compact } = require('../src/game/arenaWeb');
console.log = origLog;

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
};
const MATCHES = Number(arg('--matches', 10));
const WEB = arg('--web', null);
const HAIKU = process.argv.includes('--haiku');

let warnings = 0;
const line = (ok, label, value, limit) => {
  if (!ok) warnings += 1;
  console.log(`${ok ? '✅' : '⚠️ '} ${label.padEnd(48)} ${String(value).padStart(12)}   ${limit}`);
};
const pct = (list, p) => { const a = [...list].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * p))] || 0; };
const ms = (v) => `${v.toFixed(2)} ms`;

// ─────────────────────────────────────────────
// Cartes réelles de la machine
// ─────────────────────────────────────────────
const bank = media.getAllMedia();
const pick = (n, from) => Array.from({ length: n }, (_, i) => bank[(from + i * 7) % bank.length]);
const player = (id, list) => ({
  userId: id,
  deck: list.map((m) => ({ url: m.url, title: m.title, rarity: m.rarity })),
  copies: Object.fromEntries(list.map((m) => [m.url, 3])),
});

console.log(`⏱️  Arène — contrôle de rapidité · ${bank.length} cartes · Node ${process.version} · ${MATCHES} combats simultanés\n`);

// ─────────────────────────────────────────────
// 1 + 2. Combats simultanés : moteur + envoi aux joueurs
// ─────────────────────────────────────────────
function bot(s, side, t) {
  const p = s.players[side];
  if (t % 15 !== 0) return;   // une décision toutes les 1,5 s
  const playable = p.hand.filter((u) => engine.cardStats(s, side, u).cost <= p.elixir);
  if (!playable.length) return;
  const url = playable[t % playable.length];
  engine.applyAction(s, side, { type: 'deploy', url, x: 10 + ((t * 37) % 80), depth: 12 + ((t * 13) % 30) });
}

const games = Array.from({ length: MATCHES }, (_, i) => ({
  s: engine.createMatch({ id: `perf${i}`, seed: 100 + i, players: { A: player('A', pick(8, i * 3)), B: player('B', pick(8, i * 3 + 40)) } }),
  enc: { A: wire.createEncoder(), B: wire.createEncoder() },
}));
const stepTimes = [];
const viewTimes = [];
const bytes = [];
let maxUnits = 0;
for (let t = 0; t < 1200; t += 1) {   // 2 min de combat
  const t0 = performance.now();
  const evs = games.map((g) => { if (g.s.status !== 'running') return []; bot(g.s, 'A', t); bot(g.s, 'B', t + 7); return engine.tick(g.s, 100); });
  stepTimes.push(performance.now() - t0);
  for (const [i, g] of games.entries()) {
    maxUnits = Math.max(maxUnits, g.s.units.length);
    for (const side of ['A', 'B']) {
      const v0 = performance.now();
      const view = { matchId: g.s.id, you: side, opponent: 'X', arena: 'jardin', phase: 'running', ...engine.publicState(g.s, side), events: evs[i] };
      const packet = JSON.stringify(g.enc[side].encode(compact(view, {})));
      viewTimes.push(performance.now() - v0);
      bytes.push(Buffer.byteLength(packet));
    }
  }
}
console.log('🎮 Moteur (une boucle de 100 ms pour tous les combats)');
line(pct(stepTimes, 0.95) < 20, `pas de ${MATCHES} combats — 95 % des pas`, ms(pct(stepTimes, 0.95)), '< 20 ms (budget 100 ms)');
line(Math.max(...stepTimes) < 60, 'pas le plus lent', ms(Math.max(...stepTimes)), '< 60 ms');
line(true, 'unités max sur un terrain', maxUnits, '(information)');
console.log('\n📡 Envoi aux joueurs (10 états / s / joueur)');
line(pct(viewTimes, 0.95) < 1.5, 'préparer un état — 95 %', ms(pct(viewTimes, 0.95)), '< 1,5 ms');
const perLoop = (pct(viewTimes, 0.5) * MATCHES * 2);
line(perLoop < 30, `préparer les ${MATCHES * 2} états d'une boucle`, ms(perLoop), '< 30 ms');
line(pct(bytes, 0.95) < 2500, 'taille d\'un état — 95 %', `${pct(bytes, 0.95)} o`, '< 2,5 Ko');
const kbps = (bytes.reduce((a, b) => a + b, 0) / bytes.length) * 10 / 1024;
line(kbps < 20, 'débit moyen par joueur', `${kbps.toFixed(1)} Ko/s`, '< 20 Ko/s');

// ─────────────────────────────────────────────
// 3. Démarrage d'un combat : dessins des personnages
// ─────────────────────────────────────────────
console.log('\n🎭 Démarrage d\'un combat');
const sixteen = pick(16, 5);
let t0 = performance.now();
let svg = '';
sixteen.forEach((m, i) => { svg += characters.renderSpriteSet(m, `c${i}`).svg; });
const draw = performance.now() - t0;
line(draw < 150, 'dessins des 16 personnages', ms(draw), '< 150 ms');
line(svg.length < 400000, 'poids des dessins envoyés', `${Math.round(svg.length / 1024)} Ko`, '< 400 Ko');

// ─────────────────────────────────────────────
// 4. Catalogue (« Mon deck », préparation)
// ─────────────────────────────────────────────
console.log('\n🃏 « Mon deck » / préparation');
t0 = performance.now();
const catalogue = bank.map((m) => { const st = cards.getCardStats(m); return { url: m.url, title: m.title, rarity: st.rarity, archetype: st.archetype, cost: st.cost, specialty: st.specialty }; });
const cat = performance.now() - t0;
line(cat < 50, `catalogue de ${bank.length} cartes`, ms(cat), '< 50 ms');
line(JSON.stringify(catalogue).length < 150000, 'poids du catalogue', `${Math.round(JSON.stringify(catalogue).length / 1024)} Ko`, '< 150 Ko');

// ─────────────────────────────────────────────
// 5. Looks + mémoire
// ─────────────────────────────────────────────
console.log('\n🎨 Looks des cartes et mémoire');
const looksFile = path.join(__dirname, '..', 'data', 'card-looks.json');
const withLook = fs.existsSync(looksFile) ? Object.keys(JSON.parse(fs.readFileSync(looksFile, 'utf-8'))).length : 0;
line(withLook >= bank.length - 2, 'cartes avec un look (analysé ou couleurs)', `${withLook}/${bank.length}`, 'toutes (sinon : generate-looks)');
t0 = performance.now();
bank.forEach((m) => looks.getLook(m));
line(performance.now() - t0 < 30, 'lire le look de toutes les cartes', ms(performance.now() - t0), '< 30 ms');
const rss = process.memoryUsage().rss / 1024 / 1024;
line(rss < 400, 'mémoire du contrôle (processus)', `${Math.round(rss)} Mo`, '< 400 Mo');

// ─────────────────────────────────────────────
// 6 + 7. Web et Haiku (optionnels)
// ─────────────────────────────────────────────
(async () => {
  if (WEB) {
    console.log(`\n🌐 Pages de l'Arène (${WEB})`);
    for (const p of ['/arena-board.js', '/arena.js', '/deck-editor.js', '/arena.css', '/arena-tutorial.js']) {
      const times = [];
      let status = 0;
      let size = 0;
      for (let i = 0; i < 5; i += 1) {
        const a = performance.now();
        try {
          const res = await fetch(WEB.replace(/\/$/, '') + p);
          status = res.status;
          size = (await res.arrayBuffer()).byteLength;
        } catch (e) { status = e.message; }
        times.push(performance.now() - a);
      }
      line(status === 200 && pct(times, 0.5) < 200, `GET ${p} (${Math.round(size / 1024)} Ko)`, status === 200 ? ms(pct(times, 0.5)) : String(status), '< 200 ms');
    }
  }
  if (HAIKU) {
    console.log('\n🔎 Analyse d\'une photo par Haiku');
    const analyzer = require('../src/game/lookAnalyzer');
    if (!analyzer.enabled()) {
      line(false, 'clé Haiku configurée', 'non', 'ANTHROPIC_FOUNDRY_API_KEY');
    } else {
      const cache = path.join(__dirname, '..', 'data', 'card-cache');
      const file = fs.existsSync(cache) && fs.readdirSync(cache).find((n) => /\.(png|jpe?g)$/.test(n));
      if (!file) line(false, 'photo en cache pour le test', 'aucune', 'data/card-cache');
      else {
        const buf = fs.readFileSync(path.join(cache, file));
        const pixels = looks.decode(buf, file.endsWith('.png') ? 'image/png' : 'image/jpeg');
        const a = performance.now();
        const traits = await analyzer.analyze(pixels, { role: 'guerrier', title: file, logger: { warn() {}, error() {} } });
        const took = performance.now() - a;
        line(Boolean(traits), 'réponse valide', traits ? 'oui' : 'non', '');
        line(took < 30000, 'durée d\'une analyse (en fond, à l\'upload)', ms(took), '< 30 s');
      }
    }
  }
  console.log(warnings ? `\n⚠️  ${warnings} point(s) à regarder` : '\n✅ Tout est rapide');
  process.exit(0);
})();
