// ═══════════════════════════════════════════════════════════
//  🐛 MODULE BUGS ↔ SLACK (v2.2.1)
//    • Accueil (tout le monde) : bouton « 🐛 Signaler un bug »
//    • Modale : description + jusqu'à 3 captures (file_input)
//    • DM à chaque admin : description, captures (renvoyées par le bot,
//      scope files:write), boutons ✅ Valider (+10 JP$) / ✖️ Refuser
//    • Accueil admin : bugs validés à corriger, bouton 🛠️ Corrigé
//    • DM à l'auteur à chaque étape (reçu, validé / refusé, corrigé)
//  Règles et stockage : src/bugs.js. Ici : messages et boutons.
//  Constructeurs (build*) purs → testés par scripts/test-bugs.js.
// ═══════════════════════════════════════════════════════════

const bugs = require('./bugs');
const credits = require('./credits');

const MAX_SHOWN = 15;            // bugs à corriger affichés dans l'Accueil (limite Slack : 100 blocs)
const FILE_MAX_BYTES = 10 * 1024 * 1024;

const section = (text, accessory) => ({ type: 'section', text: { type: 'mrkdwn', text }, ...(accessory ? { accessory } : {}) });
const button = (text, actionId, extra = {}) => ({ type: 'button', text: { type: 'plain_text', text, emoji: true }, action_id: actionId, ...extra });
const context = (text) => ({ type: 'context', elements: [{ type: 'mrkdwn', text }] });

// Texte saisi par un joueur, affiché en citation : pas de mention de masse ni de faux formatage
const quote = (text) => String(text).replace(/<!(channel|here|everyone)[^>]*>/g, '@$1').split('\n').map((l) => `> ${l}`).join('\n');
const short = (text, n = 90) => {
  const one = String(text).replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};
const day = (iso) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });

// ─────────────────────────────────────────────
// 🏠 Accueil
// ─────────────────────────────────────────────

/** Bloc joueur : signaler un bug. */
function buildReportBlocks() {
  return [section(
    `🐛 *Un bug ?* Décris-le (capture d'écran bienvenue). S'il est confirmé par un admin, tu gagnes *${bugs.REWARD} JP$* !`,
    button('🐛 Signaler un bug', 'bug_report_open'),
  )];
}

/** Panneau admin : compteurs + bugs validés à corriger. */
function buildAdminBugBlocks(toFix = bugs.list('validated'), c = bugs.counts()) {
  const blocks = [section(`🐛 *Bugs signalés* — ⏳ ${c.pending} en attente de validation · 🛠️ ${c.validated} à corriger · ✅ ${c.fixed} corrigé${c.fixed > 1 ? 's' : ''} · ✖️ ${c.refused} refusé${c.refused > 1 ? 's' : ''}`)];
  if (!toFix.length) {
    blocks.push(context(c.pending ? '_Aucun bug à corriger. Les bugs en attente se valident depuis tes DM._' : '_Aucun bug à corriger 🎉_'));
    return blocks;
  }
  for (const b of toFix.slice(0, MAX_SHOWN)) {
    blocks.push(section(`*n° ${b.id}* · <@${b.reporter}> · ${day(b.at)}\n${short(b.text)}`, button('🛠️ Corrigé', 'bug_fixed', { value: String(b.id) })));
  }
  if (toFix.length > MAX_SHOWN) blocks.push(context(`_… et ${toFix.length - MAX_SHOWN} autre(s), les plus récents._`));
  return blocks;
}

// ─────────────────────────────────────────────
// 🪟 Modale « Signaler un bug »
// ─────────────────────────────────────────────

function buildReportModal() {
  return {
    type: 'modal',
    callback_id: 'bug_report_submit',
    title: { type: 'plain_text', text: 'Signaler un bug' },
    submit: { type: 'plain_text', text: '🐛 Envoyer' },
    close: { type: 'plain_text', text: 'Annuler' },
    blocks: [
      section(`Merci ! Un admin vérifie chaque signalement. *Bug confirmé = ${bugs.REWARD} JP$* pour toi.`),
      {
        type: 'input',
        block_id: 'text',
        label: { type: 'plain_text', text: 'Que s\'est-il passé ?' },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          multiline: true,
          min_length: 10,
          max_length: bugs.TEXT_MAX,
          placeholder: { type: 'plain_text', text: 'Ce que tu faisais, ce qui s\'est passé, ce que tu attendais…' },
        },
      },
      {
        type: 'input',
        block_id: 'shots',
        optional: true,
        label: { type: 'plain_text', text: 'Capture d\'écran (facultatif)' },
        element: { type: 'file_input', action_id: 'value', filetypes: ['png', 'jpg', 'jpeg', 'gif', 'webp'], max_files: bugs.MAX_FILES },
      },
    ],
  };
}

// ─────────────────────────────────────────────
// 💬 Messages
// ─────────────────────────────────────────────

const STATUS_LINE = {
  validated: (b) => `✅ *Validé* par <@${b.decidedBy}> : +${bugs.REWARD} JP$ versés à <@${b.reporter}>. À corriger depuis l'Accueil (👑 Admin).`,
  refused: (b) => `✖️ *Refusé* par <@${b.decidedBy}>.`,
  fixed: (b) => `🛠️ *Corrigé* (marqué par <@${b.fixedBy}>) : <@${b.reporter}> a été prévenu.`,
};

/** DM admin : le bug, puis les boutons (en attente) ou la décision. */
function buildAdminDM(bug) {
  const files = bug.files.length ? `\n📎 ${bug.files.length} capture${bug.files.length > 1 ? 's' : ''} ci-dessous (fil du message).` : '';
  const blocks = [section(`🐛 *Bug n° ${bug.id}* signalé par <@${bug.reporter}> · ${day(bug.at)}\n${quote(bug.text)}${files}`)];
  if (bug.status === 'pending') {
    blocks.push({
      type: 'actions',
      block_id: `bug_decide_${bug.id}`,
      elements: [
        button(`✅ Valider (+${bugs.REWARD} JP$)`, 'bug_validate', { value: String(bug.id), style: 'primary' }),
        button('✖️ Refuser', 'bug_refuse', { value: String(bug.id) }),
      ],
    });
  } else {
    blocks.push(context(STATUS_LINE[bug.status](bug)));
  }
  return { text: `🐛 Bug n° ${bug.id} signalé par <@${bug.reporter}>`, blocks };
}

/** DM à l'auteur, selon l'étape. */
function buildReporterDM(bug, step) {
  const text = {
    received: `🐛 *Merci, ton bug n° ${bug.id} est bien reçu !* Un admin va le vérifier. S'il est confirmé, tu gagnes *${bugs.REWARD} JP$*.`,
    validated: `✅ *Ton bug n° ${bug.id} est confirmé !* Merci pour ton aide : *+${bugs.REWARD} JP$* sur ton solde. On te prévient dès qu'il est corrigé.`,
    refused: `🐛 *Ton signalement n° ${bug.id} n'a pas été retenu* (déjà connu, pas reproduit ou pas un bug). Merci quand même d'avoir pris le temps !`,
    fixed: `🛠️ *Ton bug n° ${bug.id} est corrigé !* Merci encore de l'avoir signalé.`,
  }[step];
  return { text: text.replace(/\*/g, ''), blocks: [section(`${text}\n${quote(short(bug.text, 200))}`)] };
}

// ─────────────────────────────────────────────
// 📎 Captures : téléchargées (files:read) puis renvoyées dans le fil du DM admin (files:write)
// ─────────────────────────────────────────────

async function downloadFile(client, fileId) {
  const info = await client.files.info({ file: fileId });
  const f = info.file || {};
  if (!f.url_private || (f.size && f.size > FILE_MAX_BYTES)) return null;
  const res = await fetch(f.url_private, { headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` }, redirect: 'follow' });
  if (!res.ok) return null;
  return { data: Buffer.from(await res.arrayBuffer()), name: f.name || `capture-${fileId}`, title: f.title || f.name || 'Capture' };
}

// ─────────────────────────────────────────────
// 🔌 Branchement Slack
//    ctx = { admins: [userId], sendDM(client, userId, msg) → { channel, ts },
//            openModal(client, body, view, logger), refreshHome(client, userId, logger),
//            isAdmin(userId) }
// ─────────────────────────────────────────────

function register(app, ctx) {
  const log = (what, e) => console.error(`❌ Bugs (${what}) :`, e.data ? e.data.error : e.message);
  const dm = async (client, userId, msg) => { try { return await ctx.sendDM(client, userId, msg); } catch (e) { log(`DM <@${userId}>`, e); return null; } };
  const refreshAdmins = (client) => Promise.all(ctx.admins.map((a) => ctx.refreshHome(client, a, console)));
  const updateAdminDMs = async (client, bug) => {
    const msg = buildAdminDM(bug);
    for (const ref of bug.adminMessages || []) {
      try { await client.chat.update({ channel: ref.channel, ts: ref.ts, text: msg.text, blocks: msg.blocks }); } catch (e) { log('mise à jour DM admin', e); }
    }
  };

  app.action('bug_report_open', async ({ ack, body, client, logger }) => {
    await ack();
    await ctx.openModal(client, body, buildReportModal(), logger);
  });

  app.view('bug_report_submit', async ({ ack, body, view, client }) => {
    const values = view.state.values;
    const text = (values.text.value.value || '').trim();
    if (text.length < 10) return ack({ response_action: 'errors', errors: { text: 'Décris le bug en quelques mots (10 caractères minimum).' } });
    await ack();
    const files = (values.shots && values.shots.value && values.shots.value.files) || [];
    const bug = bugs.create(body.user.id, text, files);
    console.log(`🐛 Bug n° ${bug.id} signalé par <@${bug.reporter}> (${bug.files.length} capture(s))`);
    await dm(client, bug.reporter, buildReporterDM(bug, 'received'));

    // Captures téléchargées une fois, renvoyées à chaque admin
    const downloads = [];
    for (const f of bug.files) {
      try { const d = await downloadFile(client, f.id); if (d) downloads.push(d); } catch (e) { log(`capture ${f.id}`, e); }
    }
    const refs = [];
    for (const adminId of ctx.admins) {
      const ref = await dm(client, adminId, buildAdminDM(bug));
      if (!ref) continue;
      refs.push({ adminId, channel: ref.channel, ts: ref.ts });
      if (downloads.length) {
        try {
          await client.files.uploadV2({
            channel_id: ref.channel,
            thread_ts: ref.ts,
            file_uploads: downloads.map((d) => ({ file: d.data, filename: d.name, title: d.title })),
          });
        } catch (e) {
          log('envoi des captures (scope files:write ?)', e);
          await client.chat.postMessage({ channel: ref.channel, thread_ts: ref.ts, text: `📎 ${bug.files.length} capture(s) jointe(s), mais le bot n'a pas pu te les renvoyer (droit Slack « files:write » manquant ?).` }).catch(() => {});
        }
      } else if (bug.files.length) {
        await client.chat.postMessage({ channel: ref.channel, thread_ts: ref.ts, text: `📎 ${bug.files.length} capture(s) jointe(s), illisible(s) pour le bot.` }).catch(() => {});
      }
    }
    bugs.setAdminMessages(bug.id, refs);
    await refreshAdmins(client);
  });

  // ✅ / ✖️ Décision (premier admin qui clique)
  const decideAction = (actionId, accept) => app.action(actionId, async ({ ack, body, action, client }) => {
    await ack();
    if (!ctx.isAdmin(body.user.id)) return;
    const res = bugs.decide(action.value, body.user.id, accept);
    if (!res.bug) return;
    if (res.ok) {
      if (accept) credits.addCredit(res.bug.reporter, bugs.REWARD, { source: 'bug_bounty', ref: `bug:${res.bug.id}` });
      console.log(`🐛 Bug n° ${res.bug.id} ${accept ? 'validé' : 'refusé'} par <@${body.user.id}>`);
      await dm(client, res.bug.reporter, buildReporterDM(res.bug, accept ? 'validated' : 'refused'));
      await ctx.refreshHome(client, res.bug.reporter, console);
    }
    await updateAdminDMs(client, bugs.get(res.bug.id));   // déjà traité : on remet juste le message à jour
    await refreshAdmins(client);
  });
  decideAction('bug_validate', true);
  decideAction('bug_refuse', false);

  // 🛠️ Corrigé (Accueil admin)
  app.action('bug_fixed', async ({ ack, body, action, client }) => {
    await ack();
    if (!ctx.isAdmin(body.user.id)) return;
    const res = bugs.markFixed(action.value, body.user.id);
    if (res.ok) {
      console.log(`🐛 Bug n° ${res.bug.id} corrigé (marqué par <@${body.user.id}>)`);
      await dm(client, res.bug.reporter, buildReporterDM(res.bug, 'fixed'));
      await updateAdminDMs(client, res.bug);
    }
    await refreshAdmins(client);
  });
}

module.exports = { buildReportBlocks, buildAdminBugBlocks, buildReportModal, buildAdminDM, buildReporterDM, register };
