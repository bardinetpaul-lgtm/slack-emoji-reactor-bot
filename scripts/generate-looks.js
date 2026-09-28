#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  🎭 Crée le personnage d'Arène de CHAQUE carte selon les règles en
//     vigueur (à lancer sur la VM après un merge qui touche aux persos).
//
//  Pour chaque carte (banque + médias ajoutés via /jeanpip-addmedia) :
//    photo téléchargée (cache data/card-cache) → analyse du contenu par
//    Claude Haiku 4.5 (si ANTHROPIC_FOUNDRY_API_KEY ou ANTHROPIC_API_KEY)
//    sinon couleurs lues dans les pixels → data/card-looks.json.
//  Sans --force, seules les cartes sans look (ou aux règles périmées,
//  ou pas encore analysées alors qu'une clé est là) sont traitées.
//  Le bot fait déjà la même chose en fond à chaque démarrage et à chaque
//  upload : cette commande sert à tout (re)faire d'un coup, en le voyant.
//
//  Usage (depuis la racine du repo, sur la VM) :
//    node scripts/generate-looks.js            # cartes manquantes
//    node scripts/generate-looks.js --force    # toutes les cartes
//  Puis : sudo systemctl restart slack-reactor (le bot relit les looks).
// ═══════════════════════════════════════════════════════════
require('dotenv').config();

const { WebClient } = require('@slack/web-api');

const origLog = console.log;
console.log = () => {};   // media.js annonce le catalogue au chargement
const { getAllMedia } = require('../src/media');
const looks = require('../src/game/looks');
const analyzer = require('../src/game/lookAnalyzer');
const { describeText } = require('../src/game/characters');
console.log = origLog;

(async () => {
  const force = process.argv.includes('--force');
  const cards = getAllMedia();
  const client = process.env.SLACK_BOT_TOKEN ? new WebClient(process.env.SLACK_BOT_TOKEN) : null;
  const quiet = { info: () => {}, warn: (...a) => console.warn('   ⚠️ ', ...a), error: (...a) => console.error('   ❌', ...a) };

  console.log(`🎭 Personnages d'Arène — ${cards.length} cartes${force ? ' (toutes, --force)' : ''}`);
  console.log(analyzer.enabled()
    ? `   Analyse du contenu : ${analyzer.MODEL} (${process.env.ANTHROPIC_FOUNDRY_API_KEY ? 'Microsoft Foundry' : 'API Anthropic'})`
    : '   ⚠️  Aucune clé Haiku : seules les couleurs des photos seront lues');
  if (!client) console.log('   ⚠️  SLACK_BOT_TOKEN absent : photos Slack via leur page publique');

  let i = 0;
  const result = await looks.backfill(cards, {
    client,
    logger: quiet,
    force,
    concurrency: 2,   // deux photos en parallèle (au-delà, le quota Foundry sature)
    onCard: (card, r) => {
      i += 1;
      const label = r.skipped ? 'déjà à jour' : r.source;
      console.log(`   ${String(i).padStart(3)}/${cards.length} ${card.title} → ${label}${r.skipped ? '' : ` · ${describeText(card).replace(/\*/g, '')}`}`);
    },
  });
  console.log(`✅ ${result.done} créé(s) : ${result.haiku} par Haiku, ${result.pixels} par leurs couleurs, ${result.none} sans photo lisible · ${result.skipped} déjà à jour`);
  if (result.done) console.log('   Redémarre le bot pour les combats en cours : sudo systemctl restart slack-reactor');
})().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
