#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  👀 Galerie des personnages d'Arène (sans Slack)
//
//  Génère une page HTML autonome avec le personnage de CHAQUE
//  Jeanpip du catalogue (banque + médias ajoutés via /jeanpip-addmedia),
//  dans la DA « Personnages - 125 cartes » : filtres par archétype,
//  bascule votre camp / camp adverse. Lecture seule.
//
//  Usage : node scripts/preview-characters.js [fichier.html]
//          (défaut : jeanpip-personnages.html dans le dossier temporaire)
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');

const origLog = console.log;
console.log = () => {};   // media.js annonce le catalogue au chargement
const media = require('../src/media');
const { getCardStats, ARCHETYPES } = require('../src/game/cards');
const characters = require('../src/game/characters');
console.log = origLog;

const OUT = process.argv[2] || path.join(os.tmpdir(), 'jeanpip-personnages.html');
const RARITY = { common: '⚪ Commune', rare: '🔵 Rare', epic: '🟣 Épique', legendary: '🟡 Légendaire' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plain = (s) => s.replace(/\*/g, '');

const cards = media.getAllMedia().map((m, i) => {
  const id = `p${i}`;
  return { m, id, stats: getCardStats(m), text: plain(characters.describeText(m)) };
});

const counts = {};
for (const c of cards) counts[c.stats.archetype] = (counts[c.stats.archetype] || 0) + 1;
const filters = [['all', `Toutes · ${cards.length}`], ...Object.values(ARCHETYPES).map((a) => [a.key, `${a.label} · ${counts[a.key] || 0}`])];

const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Personnages d'Arène</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;600&family=Space+Grotesk:wght@400&display=swap" rel="stylesheet">
<style>
  :root { --ink:#1A201D; --panel:#242B28; --cream:#F3EFED; --muted:#C7C9C7; --grey:#6B716E; --pink:#FF73C0; --orange:#FF6229; --blue:#1C72F1; }
  body { margin:0; background:var(--ink); color:var(--cream); font-family:'Inter Tight',sans-serif; }
  main { padding:64px 16px; max-width:1280px; margin:0 auto; display:flex; flex-direction:column; gap:32px; }
  .kicker { font-size:14px; font-weight:600; color:var(--pink); }
  h1 { margin:0; font-family:'Space Grotesk',sans-serif; font-weight:400; font-size:clamp(36px,6vw,64px); line-height:1.04; letter-spacing:-0.02em; }
  h1 span { color:var(--orange); }
  p { margin:0; font-size:17px; line-height:1.5; max-width:660px; color:var(--muted); }
  .bar { display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
  .bar .spacer { flex:1; }
  button { border:none; cursor:pointer; border-radius:10px; padding:10px 14px; font:600 14px 'Inter Tight',sans-serif; background:var(--panel); color:var(--cream); }
  button.on { background:var(--cream); color:var(--ink); }
  .team { display:flex; gap:8px; align-items:center; }
  .dot { width:14px; height:14px; border-radius:50%; background:var(--blue); }
  body.enemy .dot { background:var(--orange); }
  body.enemy .grid use { color:var(--orange) !important; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:12px; }
  .card { background:var(--cream); color:var(--ink); border-radius:16px; padding:10px 12px 12px; display:flex; flex-direction:column; gap:4px; }
  .card svg { width:100%; height:118px; overflow:visible; }
  .name { font-size:13px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .meta { display:flex; justify-content:space-between; gap:6px; font-size:12px; color:var(--grey); }
  .desc { font-size:12px; line-height:1.35; color:var(--grey); }
  .hidden { display:none; }
</style>
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${characters.GRADIENT_DEF}${cards.map((c) => characters.renderSymbol(c.m, c.id)).join('')}</defs></svg>
<main>
  <header style="display:flex;flex-direction:column;gap:20px">
    <div class="kicker">Arène · personnages</div>
    <h1>${cards.length} Jeanpip, <span>${cards.length} personnages.</span></h1>
    <p>Chaque Jeanpip a son personnage : la DA de son rôle (char, archer, guerrier, essaim ailé), habillée par le contenu de sa photo (couvre-chef, coupe, lunettes, moustache, pipe, couleurs). Un nouveau Jeanpip ajouté avec /jeanpip-addmedia est analysé tout de suite.</p>
  </header>
  <div class="bar">
    ${filters.map(([k, l], i) => `<button data-filter="${k}" class="${i === 0 ? 'on' : ''}">${esc(l)}</button>`).join('')}
    <div class="spacer"></div>
    <button id="team" class="team"><span class="dot"></span><span id="teamLabel">Votre camp</span></button>
  </div>
  <div class="grid">
    ${cards.map((c) => `<div class="card" data-arch="${c.stats.archetype}">
      <svg viewBox="${characters.VIEWBOX}" role="img" aria-label="${esc(c.text)}">${characters.renderUse(c.m, c.id)}</svg>
      <div class="name" title="${esc(c.m.title)}">${esc(c.m.title)}</div>
      <div class="meta"><span>${RARITY[c.stats.rarity]}</span><span>${esc(ARCHETYPES[c.stats.archetype].label)}</span></div>
      <div class="desc">${esc(c.text.replace(/^\S+ \S+( ×3)? · /, ''))}</div>
    </div>`).join('')}
  </div>
</main>
<script>
  document.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('.card').forEach((c) => c.classList.toggle('hidden', b.dataset.filter !== 'all' && c.dataset.arch !== b.dataset.filter));
  }));
  document.getElementById('team').addEventListener('click', () => {
    const enemy = document.body.classList.toggle('enemy');
    document.getElementById('teamLabel').textContent = enemy ? 'Camp adverse' : 'Votre camp';
  });
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, html, 'utf-8');
console.log(`🎭 ${cards.length} personnages → ${OUT}`);
