#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  👀 Aperçu animé de l'Arène (sans Slack)
//
//  Deux bots s'affrontent avec de vraies cartes du catalogue : le VRAI
//  moteur tourne côté serveur à 10 Hz et pousse l'état en SSE, la page
//  le dessine avec public/arena-board.js (DA « Arènes » + personnages).
//  Exactement la chaîne de la prod, sans Slack ni collection.
//
//  Usage : node scripts/preview-arena.js [port]   (3200 par défaut)
//          puis http://127.0.0.1:3200/?arena=jardin|port|serveurs
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const http = require('http');
const path = require('path');

const origLog = console.log;
console.log = () => {};   // media.js annonce le catalogue au chargement
const media = require('../src/media');
const engine = require('../src/game/engine');
const characters = require('../src/game/characters');
console.log = origLog;

const PORT = parseInt(process.argv[2], 10) || 3200;
const BOARD_JS = path.join(__dirname, '..', 'public', 'arena-board.js');

// ─────────────────────────────────────────────
// 🤖 Un combat entre bots
// ─────────────────────────────────────────────

function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newMatch() {
  const pool = shuffled(media.getAllMedia());
  const deck = (cards) => cards.map((m) => ({ url: m.url, title: m.title, rarity: m.rarity }));
  const copies = (cards) => Object.fromEntries(cards.map((m) => [m.url, 3]));
  const a = pool.slice(0, 8);
  const b = pool.slice(8, 16);
  const state = engine.createMatch({
    id: 'preview', seed: Math.floor(Math.random() * 1e9),
    players: { A: { userId: 'Toi', deck: deck(a), copies: copies(a) }, B: { userId: 'Bot', deck: deck(b), copies: copies(b) } },
  });
  const cards = [...a, ...b];
  const sprites = {};
  const symbols = cards.map((m, i) => { sprites[m.url] = `c${i}`; return characters.renderSymbol(m, `c${i}`); }).join('');
  return { state, sprites, symbols };
}

/** Bot simple : défend le couloir menacé, sinon pousse ; garde parfois l'élixir. */
function botAct(state, side) {
  const p = state.players[side];
  const playable = p.hand.filter((u) => engine.cardStats(state, side, u).cost <= p.elixir);
  if (!playable.length || Math.random() < 0.85) return;
  const url = playable[Math.floor(Math.random() * playable.length)];
  const foe = side === 'A' ? 'B' : 'A';
  const threat = state.units.filter((u) => u.side === foe).sort((x, y) => (side === 'A' ? x.y - y.y : y.y - x.y))[0];
  const lane = threat ? threat.lane : Math.floor(Math.random() * 3);
  engine.applyAction(state, side, { type: 'deploy', url, lane });
}

// ─────────────────────────────────────────────
// 🌐 Page + flux SSE
// ─────────────────────────────────────────────

const PAGE = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aperçu Arène</title>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;600&family=Space+Grotesk:wght@400&display=swap" rel="stylesheet">
<style>
  body{margin:0;background:#1A201D;color:#F3EFED;font-family:'Inter Tight',sans-serif;display:flex;flex-direction:column;align-items:center;gap:16px;padding:24px 16px}
  .bar{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
  a{border-radius:10px;padding:10px 14px;font-weight:600;font-size:14px;background:#242B28;color:#F3EFED;text-decoration:none}
  a.on{background:#F3EFED;color:#1A201D}
  .frame{background:#242B28;border-radius:32px;padding:16px;width:min(405px,100%);box-sizing:border-box}
  svg{display:block;width:100%;height:auto;border-radius:24px}
  .hud{display:flex;justify-content:space-between;align-items:baseline;padding:12px 8px 0;font-size:14px;color:#C7C9C7}
  .hud b{font-family:'Space Grotesk',sans-serif;font-weight:400;font-size:28px;color:#F3EFED}
  .x2{color:#FF73C0;font-weight:600}
</style></head>
<body>
<div class="bar">
  <a href="?arena=jardin">01 · Le jardin</a><a href="?arena=port">02 · Le port</a><a href="?arena=serveurs">03 · La salle serveur</a>
</div>
<div class="frame">
  <svg id="board"></svg>
  <div class="hud"><span id="score">Tours 0 – 0</span><b id="clock">2:00</b><span id="x2"></span></div>
</div>
<script src="/arena-board.js"></script>
<script>
  const arena = new URLSearchParams(location.search).get('arena') || 'jardin';
  document.querySelectorAll('.bar a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '?arena=' + arena));
  let renderer = null;
  const es = new EventSource('/stream');
  es.addEventListener('setup', (e) => {
    const { symbols, sprites } = JSON.parse(e.data);
    if (renderer) renderer.stop();
    renderer = ArenaBoard.createRenderer(document.getElementById('board'), { arena, symbols, sprites });
  });
  es.addEventListener('state', (e) => {
    const v = JSON.parse(e.data);
    if (renderer) renderer.push(v);
    const s = Math.ceil(v.remainingMs / 1000);
    document.getElementById('clock').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    document.getElementById('score').textContent = 'Tours ' + v.players.A.towersDestroyed + ' – ' + v.players.B.towersDestroyed;
    document.getElementById('x2').innerHTML = v.doubleElixir ? '<span class="x2">×2 élixir</span>' : '';
  });
</script>
</body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }
  if (url.pathname === '/arena-board.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    return res.end(fs.readFileSync(BOARD_JS));
  }
  if (url.pathname === '/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    let match = newMatch();
    let pause = 0;
    send('setup', { symbols: match.symbols, sprites: match.sprites });
    const timer = setInterval(() => {
      if (match.state.status === 'ended') {
        pause += 1;
        if (pause < 30) return;   // 3 s sur l'écran de fin, puis un nouveau combat
        match = newMatch();
        pause = 0;
        send('setup', { symbols: match.symbols, sprites: match.sprites });
      }
      botAct(match.state, 'A');
      botAct(match.state, 'B');
      const events = engine.tick(match.state, engine.STEP_MS);
      send('state', { ...engine.publicState(match.state, 'A'), events });
    }, engine.STEP_MS);
    req.on('close', () => clearInterval(timer));
    return undefined;
  }
  res.writeHead(404);
  return res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🏟️  Aperçu de l'Arène : http://127.0.0.1:${PORT}/?arena=jardin`);
});
