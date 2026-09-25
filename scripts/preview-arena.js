#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  👀 Aperçu JOUABLE de l'Arène (sans Slack)
//
//  Tu joues le camp du bas contre un bot, sur la vraie page de combat
//  (public/arena.html + arena.js + arena-board.js), avec de vraies
//  cartes du catalogue. Le VRAI moteur tourne ici à 10 Hz et pousse
//  l'état en SSE ; les poses partent en POST : même contrat qu'en prod.
//  Aucune collection touchée (pas de règlement de fin de combat).
//
//  Usage : node scripts/preview-arena.js [port]   (3200 par défaut)
//          puis http://127.0.0.1:3200/arena/preview?t=jardin
//          (t = arène : jardin | port | serveurs)
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const http = require('http');
const path = require('path');

const origLog = console.log;
console.log = () => {};   // media.js annonce le catalogue au chargement
const media = require('../src/media');
const engine = require('../src/game/engine');
const characters = require('../src/game/characters');
const { cardImageUrl } = require('../src/cardImages');
console.log = origLog;

const PORT = parseInt(process.argv[2], 10) || 3200;
const PUBLIC = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png' };
const ARENAS = ['jardin', 'port', 'serveurs'];

// ─────────────────────────────────────────────
// 🤖 Combat : toi (A) contre le bot (B)
// ─────────────────────────────────────────────

function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newMatch(arena) {
  const pool = shuffled(media.getAllMedia());
  const deck = (cards) => cards.map((m) => ({ url: m.url, title: m.title, rarity: m.rarity }));
  const copies = (cards) => Object.fromEntries(cards.map((m, i) => [m.url, 1 + (i % 3)]));
  const a = pool.slice(0, 8);
  const b = pool.slice(8, 16);
  const state = engine.createMatch({
    id: 'preview', seed: Math.floor(Math.random() * 1e9),
    players: { A: { userId: 'Toi', deck: deck(a), copies: copies(a) }, B: { userId: 'Bot', deck: deck(b), copies: copies(b) } },
  });
  const sprites = {};
  const images = {};
  const symbols = [...a, ...b].map((m, i) => {
    const set = characters.renderSpriteSet(m, `c${i}`);
    sprites[m.url] = set.sprite;
    const img = cardImageUrl(m);
    if (img) images[m.url] = /^https?:/.test(img) ? img : `../${img}`;   // relatif à …/arena/<id>
    return set.svg;
  }).join('');
  return { state, setup: { arena: ARENAS.includes(arena) ? arena : 'jardin', names: { you: 'Toi', opponent: 'Bot Jeanpip' }, symbols, sprites, images } };
}

/** Bot : défend le couloir menacé, sinon pousse ; garde parfois l'élixir. */
function botAct(state) {
  const p = state.players.B;
  const playable = p.hand.filter((u) => engine.cardStats(state, 'B', u).cost <= p.elixir);
  if (!playable.length || Math.random() < 0.9) return;
  const url = playable[Math.floor(Math.random() * playable.length)];
  const threat = state.units.filter((u) => u.side === 'A').sort((x, y) => y.y - x.y)[0];
  engine.applyAction(state, 'B', { type: 'deploy', url, lane: threat ? threat.lane : Math.floor(Math.random() * 3) });
}

/** Vue « fin de combat » simulée (pas de règlement réel en aperçu). */
function endedView(state) {
  const r = state.result;
  const lost = [];
  const kept = [];
  for (const p of r.poses.filter((x) => x.side === 'A')) (r.winner === 'B' || p.status === 'destroyed' ? lost : kept).push(p);
  const loserPoses = r.poses.filter((x) => x.side === 'B');
  const loot = r.winner === 'A' && loserPoses.length ? loserPoses[0] : null;
  return {
    matchId: 'preview', you: 'A', opponent: 'Bot', phase: 'ended', result: r,
    summary: { you: { lost, kept, loot, stolen: null, boosterId: r.winner === 'A' ? 'aperçu' : null, credits: r.winner === 'A' ? 10 : 0 } },
  };
}

let current = null;

// ─────────────────────────────────────────────
// 🌐 Serveur
// ─────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/arena/preview') {
    const html = fs.readFileSync(path.join(PUBLIC, 'arena.html'), 'utf-8').replace(/__ASSET_VERSION__/g, String(Date.now()));
    res.writeHead(200, { 'Content-Type': TYPES['.html'] });
    return res.end(html);
  }

  if (url.pathname === '/api/arena/preview/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const arena = url.searchParams.get('t');
    let match = newMatch(arena);
    current = match;
    let endedFor = 0;
    send('setup', match.setup);
    const timer = setInterval(() => {
      if (match.state.status === 'ended') {
        if (endedFor === 0) send('state', endedView(match.state));
        endedFor += 1;
        if (endedFor < 80) return;   // 8 s sur l'écran de fin, puis revanche
        match = newMatch(arena);
        current = match;
        endedFor = 0;
        send('setup', match.setup);
      }
      botAct(match.state);
      const events = engine.tick(match.state, engine.STEP_MS);
      if (match.state.status === 'running') {
        send('state', { matchId: 'preview', you: 'A', opponent: 'Bot', phase: 'running', ...engine.publicState(match.state, 'A'), events });
      }
    }, engine.STEP_MS);
    req.on('close', () => clearInterval(timer));
    return undefined;
  }

  if (url.pathname === '/api/arena/preview/action' && req.method === 'POST') {
    const action = await readBody(req);
    const result = current ? engine.applyAction(current.state, 'A', action) : { ok: false, reason: 'not_running' };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: result.ok, reason: result.reason }));
  }

  // Fichiers statiques de public/
  const file = path.normalize(path.join(PUBLIC, url.pathname));
  if (file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    return res.end(fs.readFileSync(file));
  }
  res.writeHead(404);
  return res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🏟️  Aperçu jouable de l'Arène : http://127.0.0.1:${PORT}/arena/preview?t=jardin  (ou port, serveurs)`);
});
