#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  👀 Prévisualisation locale de la Salle des ventes (sans Slack, sans bot)
//
//  Petit serveur autonome qui sert public/ et imite le contrat de l'API
//  de la Salle des ventes (spec v4.2 §4) avec de FAUSSES données :
//    • 4 enchères en cours (dont une à moi, une où je mène), fins variées ;
//    • 6 cartes que je peux vendre, 10 ventes terminées ;
//    • images de cartes et photos en SVG ; les POST modifient l'état factice
//      et renvoient des refus réalistes (trop bas, ma carte, solde…).
//  Aucune donnée réelle n'est lue ni écrite.
//
//  Usage : node scripts/preview-salle.js [port] [--soon]   (port par défaut : 3196)
//    --soon : la première enchère finit au bout de 40 s (pour voir la fin)
//  Ajouter &blocked=1 ou &pause=1 à l'adresse de la page pour voir les bandeaux.
// ═══════════════════════════════════════════════════════════
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = parseInt(process.argv.find((a) => /^\d+$/.test(a)), 10) || 3196;

const ME = 'U_ME';
const TOKEN = `${ME}.preview`;
const query = `t=${encodeURIComponent(TOKEN)}`;
const H = 3600 * 1000;

const PEOPLE = [
  { userId: ME, name: 'Paul', hasPhoto: true },
  { userId: 'U001', name: 'Léa', hasPhoto: true },
  { userId: 'U002', name: 'Hugo', hasPhoto: false },
  { userId: 'U003', name: 'Maëlle', hasPhoto: true },
  { userId: 'U004', name: 'Erwan', hasPhoto: true },
  { userId: 'U005', name: 'Nolwenn', hasPhoto: false },
];
const byId = new Map(PEOPLE.map((p) => [p.userId, p]));
const avatar = (p) => (p.hasPhoto ? `api/ville/avatar/${encodeURIComponent(p.userId)}?${query}` : null);
const person = (id) => { const p = byId.get(id); return { userId: p.userId, name: p.name, avatar: avatar(p) }; };

const FLOOR = { common: 1, rare: 2, epic: 5, legendary: 20, rose: 30, halloween: 30 };
const COLORS = { common: '#7d8796', rare: '#2f6fd6', epic: '#8e3fd6', legendary: '#c98a10', rose: '#e0407f', halloween: '#e0701a' };
const cardImage = (code) => `api/card-image/${encodeURIComponent(code)}`;
const cardThumb = (code) => `api/card-thumb/${encodeURIComponent(code)}`;
const card = (code, title, rarity) => ({ code, title, rarity, image: cardImage(code) });
// sellable et recent : vignettes (cardThumbUrl) ; enchères : image entière (cardImageUrl)
const thumbOf = (c) => ({ ...c, image: cardThumb(c.code) });

const CARDS = new Map([
  card('042', 'Jeanpip au bord du Scorff', 'legendary'),
  card('007', 'Le café de 9 h', 'common'),
  card('113', 'Réunion qui aurait pu être un mail', 'rare'),
  card('088', 'La photocopieuse en grève', 'epic'),
  card('OR3', 'Ruban rose au port', 'rose'),
  card('HW2', 'Citrouille du service compta', 'halloween'),
  card('015', 'Le badge oublié', 'common'),
  card('061', 'Pause baby-foot', 'rare'),
  card('099', 'Déploiement du vendredi', 'epic'),
  card('120', 'Le stagiaire légendaire', 'legendary'),
  card('033', 'Coucher de soleil à Larmor', 'rare'),
  card('054', 'Le chat de l\'open space', 'common'),
].map((c) => [c.code, c]));

const now0 = Date.now();
let seq = 100;
// enchères ouvertes (état interne : bids = [{ userId, jp }])
const auctions = [
  { id: 'a1', code: '042', seller: 'U001', startPrice: 20, bids: [{ userId: 'U002', jp: 35 }], endsAt: now0 + (process.argv.includes('--soon') ? 40000 : 3 * 60 * 1000 + 20000) },
  { id: 'a2', code: '113', seller: ME, startPrice: 4, bids: [{ userId: 'U003', jp: 6 }], endsAt: now0 + 5 * H + 12 * 60000 },
  { id: 'a3', code: '088', seller: 'U004', startPrice: 5, bids: [{ userId: 'U001', jp: 8 }, { userId: ME, jp: 12 }], endsAt: now0 + 9 * H },
  { id: 'a4', code: 'OR3', seller: 'U005', startPrice: 10, bids: [], endsAt: now0 + 26 * H },
];
// mes cartes cessibles (code → nombre)
const mine = new Map([['007', 3], ['061', 1], ['099', 2], ['120', 1], ['033', 1], ['HW2', 2]]);
let balance = 140;
// ventes terminées, les plus récentes en premier
const recent = [
  ['054', 'U001', 'U002', 3, 0.4], ['015', 'U003', ME, 2, 2], ['120', 'U004', 'U001', 64, 5], ['099', 'U002', 'U005', 11, 9],
  ['033', ME, 'U003', 5, 20], ['061', 'U005', 'U004', 4, 27], ['HW2', 'U001', ME, 15, 40], ['007', 'U002', 'U003', 1, 50],
  ['088', 'U003', 'U002', 9, 70], ['113', 'U004', 'U005', 6, 95],
].map(([code, seller, winner, jp, hoursAgo]) => ({ code, seller, winner, jp, at: now0 - hoursAgo * H }));

// ── 🔨 Règles factices (reprennent celles de src/trades.js) ──
const best = (a) => (a.bids.length ? a.bids[a.bids.length - 1] : null);
const minBid = (a) => (best(a) ? best(a).jp + 1 : a.startPrice);

/** Heure murale de Paris → { y, m, d, h }. */
function parisParts(t) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(t).map((p) => [p.type, p.value]));
  return { y: +parts.year, m: +parts.month, d: +parts.day, h: +parts.hour };
}
/** 12 h ; si la fin tombe entre 20 h et 9 h, lendemain (du lancement) à 10 h. */
function auctionEnd(start) {
  const end = start + 12 * H;
  const { h } = parisParts(end);
  if (h >= 9 && h < 20) return end;
  const s = parisParts(start);
  const guess = Date.UTC(s.y, s.m - 1, s.d + 1, 10);           // 10 h UTC le lendemain
  const off = parisParts(guess).h - 10;                         // décalage de Paris (1 ou 2 h)
  return guess - off * H;
}

function settle(t) {
  for (let i = auctions.length - 1; i >= 0; i -= 1) {
    const a = auctions[i];
    if (a.endsAt > t) continue;
    auctions.splice(i, 1);
    const b = best(a);
    if (b) {
      recent.unshift({ code: a.code, seller: a.seller, winner: b.userId, jp: b.jp, at: a.endsAt });
      if (a.seller === ME) balance += b.jp;
      if (b.userId === ME) mine.set(a.code, (mine.get(a.code) || 0) + 1);
    } else if (a.seller === ME) {
      mine.set(a.code, (mine.get(a.code) || 0) + 1);
    }
  }
  recent.splice(10);
}

function modeOf(req, url) {
  let ref = null;
  try { ref = new URL(req.headers.referer || ''); } catch { /* pas de page d'origine */ }
  const has = (k) => url.searchParams.get(k) === '1' || (ref && ref.searchParams.get(k) === '1');
  return {
    blocked: has('blocked') ? '🚨 Tu subis un raid : pas d\'enchère ni de mise en vente avant sa fin. Défends-toi d\'abord !' : null,
    pause: has('pause') ? { title: 'Pause du week-end' } : null,
  };
}

function stateFor(mode) {
  const t = Date.now();
  if (!mode.pause) settle(t); // en pause, une enchère finie attend d'être réglée
  return {
    ok: true,
    serverTime: t,
    me: { userId: ME, balance, subscribed: true },
    pause: mode.pause,
    blocked: mode.blocked,
    auctions: auctions.map((a) => ({
      id: a.id,
      card: CARDS.get(a.code),
      seller: person(a.seller),
      startPrice: a.startPrice,
      best: best(a) ? { userId: best(a).userId, name: byId.get(best(a).userId).name, jp: best(a).jp } : null,
      minBid: minBid(a),
      endsAt: a.endsAt,
      mine: a.seller === ME,
      leading: Boolean(best(a) && best(a).userId === ME),
    })).sort((x, y) => x.endsAt - y.endsAt),
    sellable: [...mine].filter(([, n]) => n > 0).map(([code, count]) => ({ ...thumbOf(CARDS.get(code)), floor: FLOOR[CARDS.get(code).rarity], count })),
    recent: recent.map((r) => ({
      card: thumbOf(CARDS.get(r.code)), seller: { name: byId.get(r.seller).name }, winner: { name: byId.get(r.winner).name }, jp: r.jp, at: r.at,
    })),
  };
}

const fail = (error, text) => ({ ok: false, error, text });

function doBid(mode, body) {
  const t = Date.now();
  if (!mode.pause) settle(t);
  if (mode.pause) return fail('pause', '⏸️ Pause du week-end : pas d\'enchère avant lundi.');
  if (mode.blocked) return fail('blocked', mode.blocked);
  if (body.jp == null || body.jp === '') return fail('no_amount', 'Indique ton enchère en JP\$.');
  const a = auctions.find((x) => x.id === body.tradeId);
  if (!a || a.endsAt <= t) return fail('ended', 'Cette enchère est terminée.');
  if (a.seller === ME) return fail('self', 'Tu ne peux pas enchérir sur ta propre enchère.');
  if (best(a) && best(a).userId === ME) return fail('already_best', 'Tu es déjà le meilleur enchérisseur : attends qu\'on te dépasse.');
  const jp = Number(body.jp);
  if (!Number.isInteger(jp) || jp < minBid(a)) return fail('too_low', `Enchère trop basse. Au moins ${minBid(a)} JP$.`);
  if (jp > balance) return fail('balance', `Ton solde ne suffit pas pour cette offre. (${balance} JP$)`);
  balance -= jp;
  a.bids.push({ userId: ME, jp });
  console.log(`🔨 enchère ${jp} JP$ sur ${a.id}`);
  return { ...stateFor(mode) };
}

function doSell(mode, body) {
  const t = Date.now();
  if (mode.pause) return fail('pause', '⏸️ Pause du week-end : pas de mise en vente avant lundi.');
  if (mode.blocked) return fail('blocked_seller', mode.blocked);
  const c = CARDS.get(body.code);
  if (!c || !(mine.get(body.code) > 0)) return fail('unavailable', 'La carte n\'est plus disponible (partie, volée ou placée dans un deck).');
  const price = body.startPrice == null ? FLOOR[c.rarity] : Number(body.startPrice);
  if (!Number.isInteger(price) || price < FLOOR[c.rarity]) {
    return fail('floor', `Le prix de départ doit valoir au moins le prix de rachat de la banque (${FLOOR[c.rarity]} JP$).`);
  }
  mine.set(body.code, mine.get(body.code) - 1);
  seq += 1;
  const a = { id: `a${seq}`, code: body.code, seller: ME, startPrice: price, bids: [], endsAt: auctionEnd(t) };
  auctions.push(a);
  console.log(`🏷️ mise en vente ${body.code} à ${price} JP$, fin ${new Date(a.endsAt).toISOString()}`);
  return { ...stateFor(mode), tradeId: a.id, endsAt: a.endsAt };
}

// un rival surenchérit de temps en temps là où je mène (je suis remboursé)
setInterval(() => {
  const a = auctions.find((x) => best(x) && best(x).userId === ME);
  if (!a) return;
  balance += best(a).jp;
  a.bids.push({ userId: 'U004', jp: minBid(a) + 2 });
  console.log(`⚔️ Erwan me dépasse sur ${a.id}`);
}, 45000);

// ── 🖼️ Images factices ───────────────────────────────────
const esc = (s) => String(s).replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
function cardSvg(c) {
  const col = COLORS[c.rarity] || '#777';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${col}"/><stop offset="1" stop-color="#26171a"/></linearGradient></defs>
<rect width="400" height="300" fill="url(#g)"/><circle cx="300" cy="90" r="60" fill="#ffffff22"/><circle cx="90" cy="230" r="90" fill="#ffffff14"/>
<text x="200" y="160" font-family="Impact,Arial" font-size="96" fill="#fff" text-anchor="middle">${esc(c.code)}</text>
<text x="200" y="215" font-family="Arial" font-weight="700" font-size="20" fill="#ffffffcc" text-anchor="middle">${esc(c.title)}</text></svg>`;
}
function avatarSvg(p) {
  const hue = (crypto.createHash('md5').update(p.userId).digest()[0] / 255) * 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" fill="hsl(${hue},60%,45%)"/>
<circle cx="36" cy="28" r="13" fill="#f1c7a0"/><rect x="14" y="46" width="44" height="30" rx="14" fill="hsl(${hue},60%,30%)"/></svg>`;
}

// ── 📦 Serveur ───────────────────────────────────────────
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};
function version() {
  const h = crypto.createHash('sha1');
  for (const f of ['salle.html', 'salle.css', 'salle.js']) { try { h.update(fs.readFileSync(path.join(PUBLIC, f))); } catch { h.update(f); } }
  return h.digest('hex').slice(0, 10);
}
function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(body);
}
const json = (res, status, data) => send(res, status, JSON.stringify(data), 'application/json; charset=utf-8');

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (ch) => { raw += ch; if (raw.length > 10000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  if (p === '/') { res.writeHead(302, { Location: `salle?${query}` }); return res.end(); }
  if (p === '/salle') {
    const html = fs.readFileSync(path.join(PUBLIC, 'salle.html'), 'utf-8').replace(/__ASSET_VERSION__/g, version());
    return send(res, 200, html, TYPES['.html']);
  }
  if (p === '/ville') {
    return send(res, 200, `<!DOCTYPE html><meta charset="utf-8"><title>Jeanpip City (factice)</title>
<body style="font-family:Inter,Arial,sans-serif;padding:30px;background:#f3f5fa"><h1>Jeanpip City (page factice)</h1>
<p>Jeton reçu : <b>${url.searchParams.get('t') === TOKEN ? 'oui' : 'non'}</b>.</p><p><a href="salle?${query}">→ Salle des ventes</a></p></body>`, TYPES['.html']);
  }
  let m = /^\/api\/card-(image|thumb)\/([^/]+)$/.exec(p);
  if (m) {
    const c = CARDS.get(decodeURIComponent(m[2]));
    return c ? send(res, 200, cardSvg(c), 'image/svg+xml', { 'Cache-Control': 'max-age=3600' }) : send(res, 404, 'Not found');
  }
  m = /^\/api\/ville\/avatar\/([^/]+)$/.exec(p);
  if (m) {
    if (url.searchParams.get('t') !== TOKEN) return send(res, 403, 'Forbidden');
    const pl = byId.get(decodeURIComponent(m[1]));
    return pl && pl.hasPhoto ? send(res, 200, avatarSvg(pl), 'image/svg+xml', { 'Cache-Control': 'max-age=3600' }) : send(res, 404, 'Not found');
  }
  if (p.startsWith('/api/salle')) {
    if (url.searchParams.get('t') !== TOKEN) return json(res, 403, { ok: false, reason: 'forbidden' });
    const mode = modeOf(req, url);
    if (p === '/api/salle' && req.method === 'GET') return json(res, 200, stateFor(mode));
    if (p === '/api/salle/bid' && req.method === 'POST') return json(res, 200, doBid(mode, await readBody(req)));
    if (p === '/api/salle/sell' && req.method === 'POST') return json(res, 200, doSell(mode, await readBody(req)));
    return json(res, 404, { ok: false });
  }
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
  console.log('\n👀 Salle des ventes (fausses données) :');
  console.log(`   http://127.0.0.1:${PORT}/salle?${query}`);
  console.log(`   raid subi : http://127.0.0.1:${PORT}/salle?${query}&blocked=1`);
  console.log(`   pause     : http://127.0.0.1:${PORT}/salle?${query}&pause=1`);
  console.log(`   sans jeton (403) : http://127.0.0.1:${PORT}/salle`);
  console.log('   Ctrl+C pour arrêter\n');
});
