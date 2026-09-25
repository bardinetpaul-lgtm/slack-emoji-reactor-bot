// ═══════════════════════════════════════════════════════════
//  🗂️  RATTRAPAGE DES COLLECTIONS (script one-shot)
//  Reconstruit data/collections.json à partir des cartes déjà
//  révélées dans les DM bot ↔ joueur (messages « 🎴 … — carte i/8 »).
//
//  Prérequis : scope Slack `im:history` sur le bot.
//
//  Usage (depuis la racine du repo, sur la VM) :
//    node scripts/backfill-collections.js           → simulation (n'écrit rien)
//    node scripts/backfill-collections.js --apply   → écrit dans collections.json
//
//  Options :
//    --since=2026-07-17   date de début (défaut : lancement des boosters)
//    --force              relancer même si le rattrapage a déjà été fait
//
//  Anti-doublon : on ne prend que les messages ANTÉRIEURS à la première
//  carte déjà enregistrée en live (celles-là sont déjà comptées).
// ═══════════════════════════════════════════════════════════

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { WebClient } = require('@slack/web-api');

const collections = require('../src/collections');

const DATA_DIR = path.join(__dirname, '..', 'data');
const COLLECTIONS_PATH = path.join(DATA_DIR, 'collections.json');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const sinceArg = (args.find((a) => a.startsWith('--since=')) || '').split('=')[1];
const SINCE = new Date(sinceArg || '2026-07-17T00:00:00Z');

const REVEAL_RE = /^🎴 \*(.+)\* — carte \d+\/\d+/;
const LINK_RE = /<([^|>]+)\|(?:👉 Clique ici pour voir l'image|▶️ Clique ici pour voir la vidéo)>/;
const RARITY_FROM_LINE = [
  [/LÉGENDAIRE/, 'legendary'],
  [/Épique/, 'epic'],
  [/Rare/, 'rare'],
  [/Commun/, 'common'],
];

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
  } catch {
    return fallback;
  }
}

// ─────────────────────────────────────────────
// 📦 Banque de médias indexée par URL
// ─────────────────────────────────────────────
function loadBankByUrl() {
  const bank = [
    ...readJson('media-bank.json', []),
    ...readJson('media-bank-custom.json', []),
  ];
  return new Map(bank.map((m) => [m.url, m]));
}

// ─────────────────────────────────────────────
// 🎴 Message Slack → carte (ou null si ce n'est pas une révélation)
// ─────────────────────────────────────────────
function parseRevealMessage(msg, bankByUrl) {
  const blocks = msg.blocks || [];
  const texts = blocks.map((b) => (b.text && b.text.text) || '');
  const header = texts.find((t) => REVEAL_RE.test(t));
  if (!header) return null;

  // URL : bloc image (image publique) ou lien cliquable (privée / vidéo)
  const imageBlock = blocks.find((b) => b.type === 'image' && b.image_url);
  let url = imageBlock ? imageBlock.image_url : null;
  if (!url) {
    const linkText = texts.find((t) => LINK_RE.test(t));
    if (linkText) url = linkText.match(LINK_RE)[1];
  }
  if (!url) return null;

  const known = bankByUrl.get(url);
  if (known) return { ...known };

  // Média retiré de la banque depuis : on reconstruit depuis le message
  const rarityLine = texts.find((t) => /Jeanpip/.test(t) && !REVEAL_RE.test(t)) || '';
  const rarity = (RARITY_FROM_LINE.find(([re]) => re.test(rarityLine)) || [null, 'common'])[1];
  return {
    url,
    title: header.match(REVEAL_RE)[1],
    rarity,
    type: /vidéo/.test(texts.join('\n')) ? 'video' : 'image',
    orphan: true,
  };
}

// ─────────────────────────────────────────────
// 📜 Tous les messages d'un DM (+ réponses en thread) dans la fenêtre
// ─────────────────────────────────────────────
async function fetchDmMessages(client, channel, oldest, latest) {
  const messages = [];
  let cursor;
  do {
    const res = await client.conversations.history({ channel, oldest, latest, limit: 200, cursor });
    for (const msg of res.messages || []) {
      messages.push(msg);
      // 1ʳᵉ version des boosters : cartes révélées en thread
      if (msg.reply_count && msg.thread_ts === msg.ts) {
        let rCursor;
        do {
          const rep = await client.conversations.replies({ channel, ts: msg.ts, oldest, latest, limit: 200, cursor: rCursor });
          messages.push(...(rep.messages || []).filter((r) => r.ts !== msg.ts));
          rCursor = rep.response_metadata && rep.response_metadata.next_cursor;
        } while (rCursor);
      }
    }
    cursor = res.response_metadata && res.response_metadata.next_cursor;
  } while (cursor);
  return messages;
}

async function main() {
  if (!process.env.SLACK_BOT_TOKEN) {
    console.error('❌ SLACK_BOT_TOKEN manquant (lance le script depuis la racine du repo, avec le .env)');
    process.exit(1);
  }

  const existing = readJson('collections.json', { users: {} });
  if (existing.backfill && !FORCE) {
    console.error(`❌ Rattrapage déjà effectué le ${existing.backfill.at}. Utilise --force pour relancer.`);
    process.exit(1);
  }

  // Borne haute = 1ʳᵉ carte enregistrée en live (déjà comptée) ou maintenant
  const liveDates = Object.values(existing.users || {})
    .flatMap((u) => Object.values(u.cards || {}).map((c) => c.firstAt))
    .filter(Boolean)
    .sort();
  const until = liveDates.length ? new Date(liveDates[0]) : new Date();

  console.log(`🗂️  Rattrapage des collections — ${APPLY ? '✍️  MODE ÉCRITURE' : '👀 SIMULATION (rien n\'est écrit)'}`);
  console.log(`   Fenêtre : ${SINCE.toISOString()} → ${until.toISOString()}\n`);

  // Joueurs ayant ouvert au moins un booster
  const boosterStore = readJson('boosters.json', { boosters: {} });
  const owners = [...new Set(
    Object.values(boosterStore.boosters || {}).filter((b) => b.opened).map((b) => b.owner)
  )];
  console.log(`👥 ${owners.length} joueur(s) ont ouvert au moins un booster\n`);

  const client = new WebClient(process.env.SLACK_BOT_TOKEN);
  const { user_id: botUserId } = await client.auth.test();
  const bankByUrl = loadBankByUrl();
  const oldest = String(SINCE.getTime() / 1000);
  const latest = String(until.getTime() / 1000);

  const plan = []; // { userId, card, at }
  let totalOrphans = 0;

  for (const userId of owners) {
    let userLabel = userId;
    try {
      const info = await client.users.info({ user: userId });
      userLabel = `${info.user.real_name || info.user.name} (${userId})`;
    } catch { /* on garde l'id */ }

    try {
      const { channel } = await client.conversations.open({ users: userId });
      const messages = await fetchDmMessages(client, channel.id, oldest, latest);
      const cards = messages
        .filter((m) => m.user === botUserId || m.bot_id)
        .map((m) => ({ card: parseRevealMessage(m, bankByUrl), ts: m.ts }))
        .filter((x) => x.card)
        .sort((a, b) => Number(a.ts) - Number(b.ts));

      const byRarity = {};
      for (const { card, ts } of cards) {
        byRarity[card.rarity] = (byRarity[card.rarity] || 0) + 1;
        if (card.orphan) totalOrphans++;
        plan.push({ userId, card, at: new Date(Number(ts) * 1000).toISOString() });
      }
      const summary = ['common', 'rare', 'epic', 'legendary']
        .filter((r) => byRarity[r])
        .map((r) => `${{ common: '⚪', rare: '🔵', epic: '🟣', legendary: '🟡' }[r]} ${byRarity[r]}`)
        .join(' · ');
      console.log(`• ${userLabel} : ${cards.length} carte(s)${summary ? ` — ${summary}` : ''}`);
    } catch (e) {
      const err = e.data ? e.data.error : e.message;
      console.log(`• ${userLabel} : ❌ ${err}${err === 'missing_scope' ? ' (ajoute im:history et réinstalle l\'app)' : ''}`);
    }
  }

  console.log(`\n📊 Total : ${plan.length} carte(s) retrouvée(s)${totalOrphans ? `, dont ${totalOrphans} dont le média n'est plus dans la banque` : ''}`);

  if (!APPLY) {
    console.log('\n👀 Simulation terminée. Relance avec --apply pour écrire.');
    return;
  }

  // Sauvegarde de sécurité puis écriture (ordre chronologique → firstAt/lastAt justes)
  if (fs.existsSync(COLLECTIONS_PATH)) {
    const backup = `${COLLECTIONS_PATH}.bak-${Date.now()}`;
    fs.copyFileSync(COLLECTIONS_PATH, backup);
    console.log(`💾 Sauvegarde : ${backup}`);
  }
  for (const { userId, card, at } of plan) {
    const { orphan, ...clean } = card;
    collections.addCards(userId, [clean], at);
  }

  const data = readJson('collections.json', { users: {} });
  data.backfill = { at: new Date().toISOString(), since: SINCE.toISOString(), until: until.toISOString(), cards: plan.length };
  fs.writeFileSync(COLLECTIONS_PATH, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`✅ ${plan.length} carte(s) ajoutée(s) à data/collections.json`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('❌ Erreur :', e.data ? e.data.error : e.message);
    process.exit(1);
  });
}

module.exports = { parseRevealMessage, loadBankByUrl };
