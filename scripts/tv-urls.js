#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  📺 Affiche les liens JP TV (avec la clé) à recopier dans
//  dashboard/arene.config.json de MagicDIMSI.
//  À lancer sur la VM, dans le dossier du bot (même .env / data/web-secret).
//  Usage : node scripts/tv-urls.js
// ═══════════════════════════════════════════════════════════
require('dotenv').config();
const web = require('../src/web');

const urls = web.buildTvUrls();
if (!urls) {
  console.error('WEB_PUBLIC_URL est vide : la page web (et donc JP TV) est désactivée.');
  process.exit(1);
}
const local = `http://127.0.0.1:${parseInt(process.env.WEB_PORT, 10) || 3100}`;
console.log(JSON.stringify({
  botApi: urls.api.replace(process.env.WEB_PUBLIC_URL.trim().replace(/\/+$/, ''), local),
  liveUrl: urls.page,
}, null, 2));
