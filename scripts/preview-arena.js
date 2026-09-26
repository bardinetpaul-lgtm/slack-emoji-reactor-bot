#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  👀 Aperçu JOUABLE de l'Arène (sans Slack)
//
//  Préparation (éditeur de deck, DA) puis combat contre un bot, sur
//  la vraie page (public/arena.html + arena.js + arena-board.js +
//  deck-editor.js), avec de vraies cartes du catalogue et une
//  collection de démo. Le VRAI moteur tourne ici à 10 Hz et pousse
//  l'état en SSE ; les actions partent en POST : même contrat qu'en prod.
//  Aucune donnée réelle touchée (pas de règlement de fin de combat).
//  Les cartes affichent les VRAIES images de la collection (proxy
//  api/card-image, cache disque data/card-cache/, comme en prod).
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
const deckRules = require('../src/game/deck');
const { getCardStats } = require('../src/game/cards');
const { cardImageUrl, getCardImage } = require('../src/cardImages');
const { compact } = require('../src/game/arenaWeb');
const wire = require('../public/arena-wire');
console.log = origLog;

const PORT = parseInt(process.argv[2], 10) || 3200;
const PUBLIC = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png' };
const ARENAS = ['jardin', 'port', 'serveurs'];
const PREP_MS = 60 * 1000;
const BOT_READY_MS = 15 * 1000;

function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const imageOf = (m) => {
  const img = cardImageUrl(m);
  return img ? (/^https?:/.test(img) ? img : `../${img}`) : null;   // relatif à …/arena/<id>
};

// ─────────────────────────────────────────────
// 🗂️ Collection de démo : ~3 cartes sur 4, 1 à 3 exemplaires
// ─────────────────────────────────────────────

function demoCollection() {
  return media.getAllMedia().map((m, i) => ({ ...m, count: i % 4 === 3 ? 0 : 1 + ((i * 7) % 3) }));
}

function catalogueOf(collection) {
  return collection.map((m) => {
    const s = getCardStats(m);
    return { url: m.url, title: m.title, rarity: s.rarity, archetype: s.archetype, cost: s.cost, copies: m.count, image: imageOf(m) };
  });
}

// ─────────────────────────────────────────────
// 🤖 Une partie : préparation → combat → fin
// ─────────────────────────────────────────────

function newGame(arena, now) {
  const collection = demoCollection();
  const auto = deckRules.buildAutoDeck(collection) || [];
  return {
    arena: ARENAS.includes(arena) ? arena : 'jardin',
    collection,
    decks: { active: 0, decks: [{ name: 'Deck 1', cards: auto }, { name: 'Deck 2', cards: [] }, { name: 'Deck 3', cards: [] }] },
    phase: 'preparing',
    startedAt: now,
    deadline: now + PREP_MS,
    ready: { you: false, opponent: false },
    state: null,
    endedFor: 0,
  };
}

function prepSetup(game) {
  return { arena: game.arena, names: { you: 'Toi', opponent: 'Bot Jeanpip' }, catalogue: catalogueOf(game.collection), symbols: '', sprites: {}, images: {} };
}

function startCombat(game) {
  const owned = game.collection.filter((m) => m.count > 0);
  const byUrl = Object.fromEntries(owned.map((m) => [m.url, m]));
  const active = game.decks.decks[game.decks.active].cards;
  const mine = (deckRules.validateDeck(game.collection, active).ok ? active : deckRules.resolveDeck(active, game.collection).urls).map((u) => byUrl[u]);
  const bot = shuffled(media.getAllMedia().filter((m) => !mine.includes(m))).slice(0, 8).map((m) => ({ ...m, count: 2 }));
  const deck = (cards) => cards.map((m) => ({ url: m.url, title: m.title, rarity: m.rarity }));
  const copies = (cards) => Object.fromEntries(cards.map((m) => [m.url, m.count]));
  game.state = engine.createMatch({
    id: 'preview', seed: Math.floor(Math.random() * 1e9),
    players: { A: { userId: 'Toi', deck: deck(mine), copies: copies(mine) }, B: { userId: 'Bot', deck: deck(bot), copies: copies(bot) } },
  });
  game.phase = 'running';
  const sprites = {};
  const images = {};
  const symbols = [...mine, ...bot].map((m, i) => {
    const set = characters.renderSpriteSet(m, `c${i}`);
    sprites[m.url] = set.sprite;
    if (imageOf(m)) images[m.url] = imageOf(m);
    return set.svg;
  }).join('');
  return { ...prepSetup(game), symbols, sprites, images };
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

function prepView(game) {
  return {
    matchId: 'preview', you: 'A', opponent: 'Bot', arena: game.arena, phase: 'preparing',
    deadline: game.deadline, ready: game.ready, decks: game.decks.decks, activeDeck: game.decks.active,
  };
}

/** Vue « fin de combat » simulée (pas de règlement réel en aperçu). */
function endedView(game) {
  const r = game.state.result;
  const lost = [];
  const kept = [];
  for (const p of r.poses.filter((x) => x.side === 'A')) (r.winner === 'B' || p.status === 'destroyed' ? lost : kept).push(p);
  const loserPoses = r.poses.filter((x) => x.side === 'B');
  const loot = r.winner === 'A' && loserPoses.length ? loserPoses[0] : null;
  return {
    matchId: 'preview', you: 'A', opponent: 'Bot', arena: game.arena, phase: 'ended', result: r,
    summary: { you: { lost, kept, loot, stolen: null, boosterId: r.winner === 'A' ? 'aperçu' : null, credits: r.winner === 'A' ? 10 : 0 } },
  };
}

let current = null;

function handleAction(action) {
  const game = current;
  if (!game) return { ok: false, reason: 'not_running' };
  if (action.type === 'decks' && game.phase === 'preparing') {
    game.decks = { active: Number(action.active) || 0, decks: action.decks };
    return { ok: true };
  }
  if (action.type === 'ready' && game.phase === 'preparing') {
    if (action.ready) {
      const check = deckRules.validateDeck(game.collection, action.urls);
      if (!check.ok) return check;
      game.decks.decks[game.decks.active].cards = action.urls;
    }
    game.ready.you = Boolean(action.ready);
    return { ok: true };
  }
  if (game.phase !== 'running') return { ok: false, reason: 'not_running' };
  const r = engine.applyAction(game.state, 'A', action);
  return { ok: r.ok, reason: r.reason };
}

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
    let game = newGame(arena, Date.now());
    current = game;
    const encoder = wire.createEncoder();   // même envoi différentiel que la prod
    send('setup', prepSetup(game));
    send('state', prepView(game));
    let tickN = 0;
    const timer = setInterval(() => {
      const now = Date.now();
      tickN += 1;
      if (game.phase === 'preparing') {
        if (!game.ready.opponent && now - game.startedAt >= BOT_READY_MS) game.ready.opponent = true;
        if ((game.ready.you && game.ready.opponent) || now >= game.deadline) {
          encoder.reset();
          send('setup', startCombat(game));
        } else {
          if (tickN % 5 === 0) send('state', prepView(game));
          return;
        }
      }
      if (game.phase === 'ended') {
        game.endedFor += 1;
        if (game.endedFor < 100) return;   // 10 s sur l'écran de fin, puis revanche
        game = newGame(arena, now);
        current = game;
        send('setup', prepSetup(game));
        send('state', prepView(game));
        return;
      }
      botAct(game.state);
      const events = engine.tick(game.state, engine.STEP_MS);
      if (game.state.status === 'ended') {
        game.phase = 'ended';
        send('state', endedView(game));
        return;
      }
      const view = { matchId: 'preview', you: 'A', opponent: 'Bot', arena: game.arena, phase: 'running', ...engine.publicState(game.state, 'A'), events };
      send('state', encoder.encode(compact(view, {})));
    }, engine.STEP_MS);
    req.on('close', () => clearInterval(timer));
    return undefined;
  }

  if (url.pathname === '/api/arena/preview/action' && req.method === 'POST') {
    const result = handleAction(await readBody(req));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: result.ok, reason: result.reason }));
  }

  // 🖼️ Vraies images des cartes (même route que la prod : proxy + cache disque).
  //    Sans token Slack ici : repli sur la page publique de partage.
  const img = /^\/api\/card-image\/([A-Z0-9]+)$/.exec(url.pathname);
  if (img) {
    const noSlack = { files: { info: async () => { throw new Error('aperçu sans token Slack'); } } };
    const quiet = { warn: () => {}, error: (...a) => console.error(...a) };
    const image = await getCardImage(noSlack, img[1], quiet);
    if (!image) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': image.mime, 'Cache-Control': 'public, max-age=604800' });
    return res.end(fs.readFileSync(image.file));
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
