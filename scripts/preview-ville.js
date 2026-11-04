#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  👀 Prévisualisation locale de la ville Jeanpip (sans Slack, sans bot)
//
//  Petit serveur autonome qui sert public/ et imite le contrat de l'API
//  de la ville (Tâche 2 du plan) avec de FAUSSES données :
//    • ~25 maisons d'inscrits (photos = initiales en SVG, quelques-unes sans photo) ;
//    • un combat en cours à l'Arène (alterne toutes les 50 s) ;
//    • un gain de JP$ toutes les 2 à 5 s (inscrits et non-inscrits) ;
//    • une maison ajoutée puis retirée de temps en temps ;
//    • des pages factices pour la Boutique, la Banque, le Kiosque, le
//      Musée, le deck, JP TV et le combat (avec le lien de retour).
//  Aucune donnée réelle n'est lue ni écrite.
//
//  Usage : node scripts/preview-ville.js [port] [--houses=25] [--mine] [--calm] [--pause]
//    --mine  : le joueur a un combat en cours (clic sur l'Arène = sa page)
//    --calm  : pas de combat ni de promeneurs automatiques
//    --pause : la ville est en pause (bandeau du week-end)
//  Puis ouvrir l'adresse affichée. Ajouter &hour=22 pour voir la nuit,
//  &replaced=1 pour voir l'avis « ouverte dans un autre onglet » (après 5 s).
// ═══════════════════════════════════════════════════════════
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = parseInt(process.argv.find((a) => /^\d+$/.test(a)), 10) || 3199;
const arg = (name) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.split('=')[1] : null; };
const flag = (name) => process.argv.includes(`--${name}`);
const NHOUSES = Math.max(0, parseInt(arg('houses') || '25', 10));
const MINE = flag('mine');
const CALM = flag('calm');

const ME = 'U_ME';
const TOKEN = `${ME}.preview`;
const query = `t=${encodeURIComponent(TOKEN)}`;

const FIRST = ['Paul', 'Léa', 'Hugo', 'Chloé', 'Yann', 'Maëlle', 'Erwan', 'Inès', 'Tanguy', 'Sarah', 'Gwen', 'Lucas', 'Nolwenn', 'Thomas', 'Camille',
  'Loïc', 'Anaïs', 'Ronan', 'Julie', 'Mathis', 'Soizic', 'Kevin', 'Emma', 'Brieuc', 'Manon', 'Corentin', 'Clara', 'Gaël', 'Zoé', 'Malo'];
const players = FIRST.map((name, i) => ({ userId: i === 0 ? ME : `U${String(i).padStart(3, '0')}`, name, hasPhoto: i % 6 !== 5 }));
const outsiders = [{ userId: 'UX01', name: 'Bastien', hasPhoto: true }, { userId: 'UX02', name: 'Morgane', hasPhoto: false }];
const byId = new Map([...players, ...outsiders].map((p) => [p.userId, p]));
const avatar = (p) => (p.hasPhoto ? `api/ville/avatar/${encodeURIComponent(p.userId)}?${query}` : null);
const person = (p) => ({ userId: p.userId, name: p.name, avatar: avatar(p) });

// maisons : les NHOUSES premiers joueurs, parcelles 0..n (le joueur a la parcelle 3)
const houses = new Map();
players.slice(0, NHOUSES).forEach((p, i) => houses.set(p.userId, i === 0 ? 3 : i <= 3 ? i - 1 : i));
let nextPlot = NHOUSES + 1;

let live = !CALM;
const tvUrl = () => (live ? 'tv/arena?k=preview' : null);

function stateFor() {
  return {
    ok: true,
    serverTime: Date.now(),
    me: { ...person(byId.get(ME)), balance: 1234 },
    pause: flag('pause') ? { title: 'Pause du week-end', kind: 'weekend', icon: '😴' } : null,
    houses: [...houses].map(([userId, plot]) => ({ ...person(byId.get(userId)), plot })),
    arena: { live, myMatchUrl: MINE ? `arena/m-preview?${query}` : null, tvUrl: tvUrl() },
    links: { museum: `collection/${ME}?t=c0ffee`, kiosk: 'tickets?t=k1osk', deck: 'deck?t=d3ck', boutique: `boutique?${query}`, banque: `banque?${query}` },
    mairie: {
      release: {
        version: '4.0.0', title: 'Jeanpip City', date: '2026-11-04',
        changes: ['🏙️ Nouveau : Jeanpip City en 3D.', '🏢 Chaque bâtiment mène à sa partie du jeu.', '🏠 Les inscrits ont leur maison.'],
      },
      ranking: players.slice(0, 10).map((p, i) => ({ ...person(p), rank: i + 1, wins: 30 - i * 2, losses: 5 + i })),
    },
  };
}

// ── 📡 Flux SSE (une seule boucle pour tous les clients) ─────
const clients = new Set();
function sendAll(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 15000);
function scheduleJp() {
  setTimeout(() => {
    if (!CALM && clients.size) {
      const pool = Math.random() < 0.25 ? outsiders : players.slice(0, Math.max(1, Math.min(players.length, NHOUSES + 2)));
      const p = pool[Math.floor(Math.random() * pool.length)];
      sendAll('jp', { ...person(p), amount: Math.random() < 0.8 ? 1 : 2, fromHouse: houses.has(p.userId) });
    }
    scheduleJp();
  }, 2000 + Math.random() * 3000);
}
scheduleJp();
if (!CALM) {
  setInterval(() => { live = !live; sendAll('arena', { live, tvUrl: tvUrl() }); }, 50000);
  // un nouvel inscrit arrive, puis se désinscrit
  setInterval(() => {
    const p = players.find((x) => !houses.has(x.userId));
    if (!p) return;
    houses.set(p.userId, nextPlot);
    nextPlot += 1;
    sendAll('house', { action: 'add', house: { ...person(p), plot: houses.get(p.userId) } });
    setTimeout(() => {
      const plot = houses.get(p.userId);
      houses.delete(p.userId);
      sendAll('house', { action: 'remove', house: { ...person(p), plot } });
    }, 30000);
  }, 70000);
}

// ── 📦 Fichiers ─────────────────────────────────────────────
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp',
};
function version() {
  const h = crypto.createHash('sha1');
  const files = ['ville.css', 'ville.js', 'ville-logic.js', ...fs.readdirSync(path.join(PUBLIC, 'ville-scene')).map((f) => `ville-scene/${f}`)];
  for (const f of files) { try { h.update(fs.readFileSync(path.join(PUBLIC, f))); } catch { h.update(f); } }
  return h.digest('hex').slice(0, 10);
}
function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(body);
}
function json(res, status, data) { send(res, status, JSON.stringify(data), 'application/json; charset=utf-8'); }

function fakePage(res, pathname, url) {
  const v = url.searchParams.get('v');
  const depth = pathname.split('/').length - 2; // collection/U → ../
  const back = v ? `${'../'.repeat(depth)}ville?t=${encodeURIComponent(v)}` : null;
  send(res, 200, `<!DOCTYPE html><meta charset="utf-8"><title>Page factice</title>
<body style="font-family:Inter,Arial,sans-serif;padding:30px;background:#f3f5fa">
<h1>Page factice : ${pathname.replace(/[<>&]/g, '')}</h1>
<p>Dans le vrai bot, c'est ici que s'ouvre la page. Paramètre de retour <code>v</code> : <b>${v ? 'présent' : 'absent'}</b>.</p>
${back ? `<p><a href="${back}">← Retour à Jeanpip City</a></p>` : ''}</body>`, 'text/html; charset=utf-8');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  if (p === '/' ) { res.writeHead(302, { Location: `ville?${query}` }); return res.end(); }
  if (p === '/ville') {
    const html = fs.readFileSync(path.join(PUBLIC, 'ville.html'), 'utf-8').replace(/__ASSET_VERSION__/g, version());
    return send(res, 200, html, TYPES['.html']);
  }
  if (p.startsWith('/api/ville')) {
    if (url.searchParams.get('t') !== TOKEN) return json(res, 403, { ok: false, reason: 'forbidden' });
    if (p === '/api/ville') return json(res, 200, stateFor());
    if (p === '/api/ville/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`event: arena\ndata: ${JSON.stringify({ live, tvUrl: tvUrl() })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      // page ouverte avec ?replaced=1 : au bout de 5 s, ce flux est « remplacé »
      // (comme quand le joueur ouvre un 4e onglet), puis fermé
      let ref = null;
      try { ref = new URL(req.headers.referer || ''); } catch { /* pas de page d'origine */ }
      if (ref && ref.searchParams.get('replaced') === '1') {
        setTimeout(() => { clients.delete(res); res.write('event: replaced\ndata: {}\n\n'); res.end(); }, 5000);
      }
      return undefined;
    }
    let m = /^\/api\/ville\/card\/([^/]+)$/.exec(p);
    if (m) {
      const pl = byId.get(decodeURIComponent(m[1]));
      if (!pl) return json(res, 404, { ok: false, reason: 'unknown' });
      const i = players.indexOf(pl);
      return json(res, 200, {
        ok: true, ...person(pl), rank: i >= 0 && i < 12 ? i + 1 : null, distinctCards: 40 + ((i * 17) % 80), legendaries: i % 4, streak: i % 7,
        ...(pl.userId === ME ? { balance: 1234 } : {}),
      });
    }
    m = /^\/api\/ville\/avatar\/([^/]+)$/.exec(p);
    if (m) {
      const pl = byId.get(decodeURIComponent(m[1]));
      if (!pl || !pl.hasPhoto) return send(res, 404, 'Not found');
      const hue = (crypto.createHash('md5').update(pl.userId).digest()[0] / 255) * 360;
      return send(res, 200, `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" fill="hsl(${hue},60%,45%)"/>
<circle cx="36" cy="28" r="13" fill="#f1c7a0"/><rect x="14" y="46" width="44" height="30" rx="14" fill="hsl(${hue},60%,30%)"/>
<text x="62" y="68" font-family="Arial" font-weight="700" font-size="16" fill="#fff" text-anchor="end">${pl.name.charAt(0)}</text></svg>`, 'image/svg+xml', { 'Cache-Control': 'max-age=3600' });
    }
    return json(res, 404, { ok: false });
  }
  if (/^\/(boutique|banque|tickets|deck|tv\/arena|arena\/[^/]+|collection\/[^/]+)$/.test(p)) return fakePage(res, p, url);
  // fichiers statiques de public/
  let decoded;
  try { decoded = decodeURIComponent(p); } catch { return send(res, 400, 'Bad request'); }
  const file = path.normalize(path.join(PUBLIC, decoded));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 404, 'Not found');
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) return send(res, 404, 'Not found');
  return fs.readFile(file, (err, data) => (err ? send(res, 404, 'Not found') : send(res, 200, data, type)));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n👀 Jeanpip City (fausses données) :');
  console.log(`   http://127.0.0.1:${PORT}/ville?${query}`);
  console.log(`   nuit : http://127.0.0.1:${PORT}/ville?${query}&hour=22`);
  console.log(`   sans jeton (403) : http://127.0.0.1:${PORT}/ville`);
  console.log('   Ctrl+C pour arrêter\n');
});
