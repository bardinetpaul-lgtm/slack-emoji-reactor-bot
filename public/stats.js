// ═══════════════════════════════════════════════════════════
//  📊 Dashboard Jeanpip — page /stats (admins)
//  Lit les blocs agrégés côté serveur (api/stats/<bloc>) et les dessine
//  avec Chart.js. Les filtres sont gardés dans l'URL (favoris).
// ═══════════════════════════════════════════════════════════
(() => {
  const form = document.getElementById('filters');
  const statusEl = document.getElementById('status');
  const params = new URLSearchParams(location.search);
  const token = params.get('t');
  // Couleurs de série lues dans le CSS (--s1…--s8) : ordre fixe, variante sombre dédiée
  let COLORS = [];
  const readColors = () => { const st = getComputedStyle(document.documentElement); COLORS = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => st.getPropertyValue(`--s${i}`).trim()); };
  readColors();   // avant de construire les séries (couleurs utilisées dans line()/bar())
  const names = {};
  const charts = {};
  let firstAt = null;

  const LABELS = {
    reaction: 'Réactions', weekly_gift: 'Cadeaux du vendredi', arena_reward: 'Récompenses arène', arena_streak: 'Séries arène', bug_bounty: 'Bugs signalés', media_author: 'Auteurs de médias',
    admin_gift: 'Dons admin', unknown: '❓ Inconnu', booster: 'Boosters', arena_shop: 'Boutique arène', attack: 'Attaques', raid: 'Raids', resale: '♻️ Revente de doublons', scratch: 'Tickets à gratter', ticket: 'achat', win: 'gains',
    common: 'Commun', rare: 'Rare', epic: 'Épique', legendary: 'Légendaire', rose: 'Octobre Rose', octobre_rose: '🎀 Octobre Rose', halloween: '🎃 Halloween',
  };
  const label = (key) => String(key).split('/').map((k) => LABELS[k] || k).join(' · ');
  const who = (id) => names[id] || id;
  const fmt = (n, d = 1) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: d }));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ─── Filtres ⇄ URL ───
  for (const name of ['range', 'from', 'to', 'grain', 'user', 'source']) {
    if (params.get(name)) form.elements[name].value = params.get(name);
  }
  // Par heure : 7 jours maximum (au-delà, les barres sont illisibles)
  function clampHourRange() {
    const v = form.elements;
    if (v.grain.value === 'hour' && ['30', '90', 'all'].includes(v.range.value)) v.range.value = '7';
  }
  function syncUrl() {
    clampHourRange();
    const q = new URLSearchParams({ t: token });
    for (const name of ['range', 'from', 'to', 'grain', 'user', 'source']) if (form.elements[name].value) q.set(name, form.elements[name].value);
    history.replaceState(null, '', `?${q}`);
    form.classList.toggle('is-custom', form.elements.range.value === 'custom');
  }
  function period() {
    const v = form.elements;
    const now = new Date();
    if (v.range.value === 'custom' && v.from.value && v.to.value) {
      return { from: new Date(`${v.from.value}T00:00:00`).toISOString(), to: new Date(`${v.to.value}T23:59:59`).toISOString() };
    }
    if (v.range.value === 'all') return { from: firstAt || new Date(now - 30 * 864e5).toISOString(), to: now.toISOString() };
    const days = Number(v.range.value) || 30;
    return { from: new Date(now - days * 864e5).toISOString(), to: now.toISOString() };
  }

  async function api(block) {
    const q = new URLSearchParams({ t: token, grain: form.elements.grain.value, ...period() });
    if (form.elements.user.value) q.set('user', form.elements.user.value);
    if (block === 'economy' && form.elements.source.value) q.set('source', form.elements.source.value);
    const res = await fetch(`api/stats/${block}?${q}`, { cache: 'no-store' });
    if (res.status === 403) throw new Error('Lien expiré ou non autorisé : rouvre « 📊 Stats du jeu » depuis l’onglet Accueil du bot.');
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) throw new Error(json.reason || `Erreur ${res.status}`);
    return json;
  }

  // ─── Rendu ───
  function kpis(sectionId, items, data) {
    const box = document.querySelector(`#${sectionId} .kpis`);
    box.innerHTML = items.map(({ key, text, unit = '', invert = false, alert }) => {
      const v = data.kpis[key];
      const p = data.prevKpis ? data.prevKpis[key] : null;
      let delta = '';
      if (typeof v === 'number' && typeof p === 'number' && p !== 0 && v !== p) {
        const pct = ((v - p) / Math.abs(p)) * 100;
        const good = invert ? pct < 0 : pct > 0;
        delta = `<div class="delta ${good ? 'up' : 'down'}">${pct > 0 ? '▲' : '▼'} ${fmt(Math.abs(pct), 0)} % vs période préc.</div>`;
      }
      const isAlert = alert && alert(v);
      return `<div class="kpi${isAlert ? ' alert' : ''}"><div class="label">${esc(text)}</div><div class="value">${fmt(v)}${unit}</div>${delta}</div>`;
    }).join('');
  }
  function since(sectionId, iso) {
    const el = document.querySelector(`#${sectionId} .since`);
    if (el) el.textContent = iso ? `Suivi depuis le ${new Date(iso).toLocaleDateString('fr-FR')}` : 'Pas encore de données';
  }
  function chart(id, config) {
    if (charts[id]) charts[id].destroy();
    const style = getComputedStyle(document.documentElement);
    Chart.defaults.color = style.getPropertyValue('--muted').trim();
    Chart.defaults.borderColor = style.getPropertyValue('--line').trim();
    readColors();
    config.options = { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, ...config.options };
    charts[id] = new Chart(document.getElementById(id), config);
  }
  const line = (name, data, i, extra = {}) => ({ type: 'line', label: name, data, borderColor: COLORS[i % COLORS.length], backgroundColor: COLORS[i % COLORS.length], tension: 0.25, pointRadius: 0, ...extra });
  const bar = (name, data, i, extra = {}) => ({ type: 'bar', label: name, data, backgroundColor: COLORS[i % COLORS.length], borderRadius: 4, borderSkipped: 'start', borderColor: getComputedStyle(document.documentElement).getPropertyValue('--panel').trim(), borderWidth: 1, ...extra });
  function table(id, head, rows) {
    const el = document.getElementById(id);
    if (!rows.length) { el.innerHTML = '<p class="empty">Aucune donnée sur la période.</p>'; return; }
    el.innerHTML = `<table><thead><tr>${head.map(([h, num]) => `<th${num ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${head[i][1] ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  // Montant écrit au bout de chaque barre horizontale (graphique « par source »)
  const valueLabels = {
    id: 'valueLabels',
    afterDatasetsDraw(c) {
      const { ctx } = c;
      ctx.save();
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#333';
      ctx.textBaseline = 'middle';
      c.data.datasets.forEach((ds, i) => c.getDatasetMeta(i).data.forEach((el, j) => ctx.fillText(fmt(ds.data[j], 0), el.x + 6, el.y)));
      ctx.restore();
    },
  };

  // 🎟️ Symboles des tickets à gratter (src/scratch.js)
  const SYMBOLS = { trophy: '🏆', posts: '🥅', ball: '🏉', jersey: '👕', boot: '👟', whistle: '📣' };
  const SYMBOL_NAMES = { trophy: 'Coupe (carte légendaire)', posts: 'Poteaux', ball: 'Ballon ovale', jersey: 'Maillot', boot: 'Crampon', whistle: 'Sifflet' };
  const prizeLabel = (key, symbol) => ({ lose: '❌ Perdant', score: '🏉 Score gagnant (mise remboursée)', score_only: '🏉 Ballons perdants, score gagnant' }[key]
    || `${SYMBOLS[symbol] || ''} ${SYMBOL_NAMES[symbol] || key}`);

  // 📡 Une ligne lisible par événement du fil « En direct »
  const BOOSTER = (t) => `🎁 ${label(t)}`;
  function describe(e) {
    const d = e.data || {};
    switch (e.type) {
      case 'scratch_ticket': {
        const sc = d.score ? `${d.card || d.amount ? ' + ' : ' '}🏉 score : ${fmt(d.score)} JP$` : '';
        return d.card ? `🎟️ Ticket gratté : ${SYMBOLS[d.symbol] || '🏆'} gagne ${d.card.title} !${sc}`
          : d.amount ? `🎟️ Ticket gratté : ${SYMBOLS[d.symbol] || ''} gagne ${fmt(d.amount)} JP$${sc}`
            : d.score ? `🎟️ Ticket gratté :${sc}` : '🎟️ Ticket gratté : perdu';
      }
      case 'booster_bought': return `🛒 Achète un booster ${BOOSTER(d.boosterType)} (${fmt(d.price)} JP$)`;
      case 'booster_opened': return `📦 Ouvre un booster ${BOOSTER(d.boosterType)}${d.best ? ` · meilleure carte : ${d.best.title}` : ''}`;
      case 'booster_granted': return `🎁 Reçoit un booster ${BOOSTER(d.boosterType)}${d.reason === 'arena' ? ' (Arène)' : ''}`;
      case 'match_finished': {
        const ps = d.players || [];
        const w = ps.find((p) => p.outcome === 'win');
        const l = ps.find((p) => p.outcome === 'loss');
        return w && l ? `⚔️ ${who(w.userId)} bat ${who(l.userId)} en Arène` : `⚔️ Combat terminé (${ps.map((p) => who(p.userId)).join(' vs ')})`;
      }
      case 'raid_launched': return `🚨 Lance un raid sur ${d.targets} cible${d.targets > 1 ? 's' : ''}${d.free ? ' (gratuit)' : ''}`;
      case 'raid_resolved': return `⚔️ Raid terminé : ${d.tombe} tombé(s), ${d.riposte} riposte(s) sur ${d.targets}`;
      case 'card_added': return `🖼️ Nouvelle carte au catalogue : ${d.title}`;
      case 'cards_sold': return `♻️ Revend des doublons : +${fmt(d.gained)} JP$`;
      case 'credit_weekly_gift': return `🎁 Reçoit ${fmt(d.amount)} JP$ (cadeau du vendredi)`;
      case 'credit_media_author': return `🎨 Gagne ${fmt(d.amount)} JP$ (auteur d'un média)`;
      case 'credit_admin_gift': return `👑 Reçoit ${fmt(d.amount)} JP$ d'un admin`;
      case 'credit_bug_bounty': return `🐛 Gagne ${fmt(d.amount)} JP$ (bug validé)`;
      default: return e.type;
    }
  }

  const RENDER = {
    economy(d) {
      since('economy', d.since);
      kpis('economy', [
        { key: 'mass', text: 'Masse en circulation' }, { key: 'mean', text: 'Moyenne / joueur' }, { key: 'median', text: 'Médiane / joueur' },
        { key: 'created', text: 'Créés' }, { key: 'consumed', text: 'Consommés' }, { key: 'net', text: 'Flux net' },
        { key: 'inflationPct', text: 'Inflation', unit: ' %', invert: true }, { key: 'spendRatePct', text: 'Taux de dépense', unit: ' %' },
        { key: 'purchasingPower', text: 'Pouvoir d’achat (boosters)' }, { key: 'players', text: 'Joueurs avec solde' },
        { key: 'ledgerGap', text: 'Écart ledger (doit être 0)', alert: (v) => v !== 0 }, { key: 'unknown', text: 'Mouvements sans source', alert: (v) => v > 0 },
      ], d);
      const s = d.series;
      chart('c-mass', { data: { labels: s.labels, datasets: [line('Masse', s.mass, 0, { fill: true, backgroundColor: `${COLORS[0]}26` })] }, options: { plugins: { legend: { display: false } } } });
      chart('c-flow', { data: { labels: s.labels, datasets: [bar('Créés', s.created, 2), bar('Consommés', s.consumed, 1)] } });
      chart('c-perplayer', { data: { labels: s.labels, datasets: [line('Moyenne', s.mean, 0), line('Médiane', s.median, 1)] } });
      const src = d.tables.bySource; const use = d.tables.byUse;
      chart('c-sources', {
        type: 'bar',
        data: {
          labels: [...src.map((x) => `+ ${label(x.key)}`), ...use.map((x) => `− ${label(x.key)}`)],
          datasets: [{ label: 'JP$', data: [...src.map((x) => x.credits), ...use.map((x) => x.credits)], backgroundColor: [...src.map(() => COLORS[2]), ...use.map(() => COLORS[1])], borderRadius: 4 }],
        },
        // Toutes les étiquettes (pas d'une sur deux) + le montant au bout de chaque barre
        options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { y: { ticks: { autoSkip: false } }, x: { grace: '12%' } } },
        plugins: [valueLabels],
      });
      table('t-fortunes', [['#', 1], ['Joueur'], ['Solde', 1], ['Part', 1]],
        d.tables.fortunes.map((p, i) => [['🥇', '🥈', '🥉'][i] || String(i + 1), who(p.userId), `${fmt(p.balance)} JP$`, `${fmt(p.sharePct)} %`]));
    },
    scratch(d) {
      kpis('scratch', [{ key: 'tickets', text: 'Tickets grattés' }, { key: 'staked', text: 'JP$ misés' }, { key: 'won', text: 'JP$ gagnés' },
        { key: 'net', text: 'JP$ retirés du jeu (misés − gagnés)' }, { key: 'rtpPct', text: 'Taux de retour', unit: ' %' }, { key: 'winRatePct', text: 'Tickets gagnants', unit: ' %' },
        { key: 'cards', text: '🏆 Légendaires gagnées' }, { key: 'scoreWins', text: '🏉 Scores gagnants' }, { key: 'players', text: 'Joueurs' }], d);
      chart('c-scratch', { type: 'bar', data: { labels: d.series.labels, datasets: [bar('Misés', d.series.staked, 1), bar('Gagnés', d.series.won, 2)] } });
      table('t-outcomes', [['Lot'], ['Tickets', 1], ['JP$ versés', 1]],
        d.tables.outcomes.map((o) => [prizeLabel(o.key, o.symbol), fmt(o.count, 0), fmt(o.credits)]));
      table('t-bigwins', [['Date'], ['Joueur'], ['Lot']],
        d.tables.biggest.map((w) => [new Date(w.at).toLocaleString('fr-FR'), who(w.userId), w.card ? `${SYMBOLS[w.symbol] || '🏆'} ${w.card.title}${w.score ? ` + ${fmt(w.score)} JP$` : ''}` : `${SYMBOLS[w.symbol] || (w.score ? '🏉' : '')} ${fmt(w.amount)} JP$`]));
      table('t-scratchers', [['Joueur'], ['Tickets', 1], ['Misé', 1], ['Gagné', 1], ['Bilan', 1], ['🏆', 1]],
        d.tables.players.map((p) => [who(p.userId), fmt(p.tickets, 0), fmt(p.staked), fmt(p.won), `${p.net > 0 ? '+' : ''}${fmt(p.net)}`, fmt(p.cards, 0)]));
    },
    live(d) {
      kpis('live', [{ key: 'reactionsHour', text: 'Réactions (dernière heure)' }, { key: 'reactionsDay', text: 'Réactions (24 h)' }], d);
      table('t-live', [['Quand'], ['Joueur'], ['Quoi']],
        d.tables.feed.map((e) => [new Date(e.at).toLocaleTimeString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }), e.userId ? who(e.userId) : '—', describe(e)]));
    },
    purchases(d) {
      kpis('purchases', [{ key: 'purchases', text: 'Achats' }, { key: 'credits', text: 'JP$ dépensés' }, { key: 'buyers', text: 'Acheteurs' }], d);
      chart('c-items', { type: 'bar', data: { labels: d.series.labels, datasets: Object.entries(d.series.byItem).map(([k, v], i) => bar(label(k), v, i, { stack: 'a' })) }, options: { scales: { x: { stacked: true }, y: { stacked: true } } } });
      table('t-items', [['Article'], ['Achats', 1], ['JP$', 1], ['Acheteurs', 1]], d.tables.items.map((x) => [label(x.key), fmt(x.count, 0), fmt(x.credits), fmt(x.buyers, 0)]));
    },
    boosters(d) {
      kpis('boosters', [{ key: 'bought', text: 'Achetés' }, { key: 'granted', text: 'Gagnés (arène)' }, { key: 'opened', text: 'Ouverts' }, { key: 'stock', text: 'Non ouverts (stock)' },
        { key: 'roseCards', text: '🎀🎃 Cartes exclusives reçues' }], d);
      const types = d.tables.boughtTypes;
      table('t-buyers', [['#', 1], ['Joueur'], ...types.map((t) => [label(t), 1]), ['Total', 1], ['JP$', 1]],
        d.tables.topBuyers.map((b, i) => [['🥇', '🥈', '🥉'][i] || String(i + 1), who(b.userId), ...types.map((t) => fmt(b.byType[t] || 0, 0)), fmt(b.total, 0), fmt(b.credits)]));
      table('t-lastbuys', [['Date'], ['Joueur'], ['Booster'], ['JP$', 1]],
        d.tables.lastPurchases.map((b) => [new Date(b.at).toLocaleString('fr-FR'), who(b.userId), label(b.boosterType), fmt(b.price)]));
      chart('c-opened', { type: 'bar', data: { labels: d.series.labels, datasets: Object.entries(d.series.openedByType).map(([k, v], i) => bar(label(k), v, i, { stack: 'a' })) }, options: { scales: { x: { stacked: true }, y: { stacked: true } } } });
      table('t-best', [['Joueur'], ['Booster'], ['Score', 1], ['Cartes'], ['Date']],
        d.tables.top.map((b) => [who(b.userId), label(b.boosterType), fmt(b.score, 0), b.cards.map((c) => label(c.rarity)).join(', '), new Date(b.at).toLocaleString('fr-FR')]));
    },
    cards(d) {
      since('cards', d.since);
      kpis('cards', [{ key: 'catalog', text: 'Cartes au catalogue' }, { key: 'owned', text: 'Exemplaires possédés' }, { key: 'added', text: 'Ajoutées (période)' },
        { key: 'discovered', text: 'Découvertes (période)' }, { key: 'mean', text: 'Moyenne / joueur' }, { key: 'median', text: 'Médiane / joueur' }], d);
      const s = d.series;
      chart('c-newcards', { data: { labels: s.labels, datasets: [bar('Ajoutées au catalogue', s.added, 1), line('Découvertes', s.discovered, 0)] } });
      chart('c-cardsavg', { data: { labels: s.labels, datasets: [line('Moyenne', s.mean, 0), line('Médiane', s.median, 1)] } });
      table('t-perplayer', [['Joueur'], ['Classeur', 1], ['% classeur', 1], ['dont Hors série', 1], ['🎀🎃 Exclusives reçues', 1], ['Obtenues un jour', 1]],
        d.tables.perPlayer.map((p) => [who(p.userId), `${fmt(p.cards, 0)} / ${fmt(p.total, 0)}`, `${fmt(p.pct)} %`, fmt(p.extra, 0), fmt(p.rose, 0), fmt(p.discovered, 0)]));
    },
    arena(d) {
      since('arena', d.since);
      kpis('arena', [{ key: 'matches', text: 'Combats' }, { key: 'fighters', text: 'Joueurs classés' }, { key: 'decisive', text: 'Avec vainqueur' }, { key: 'draws', text: 'Nuls' }, { key: 'cancelled', text: 'Annulés', invert: true },
        { key: 'rewards', text: 'JP$ gagnés' }, { key: 'shop', text: 'JP$ dépensés (boutique)' }], d);
      const s = d.series;
      chart('c-matches', { type: 'bar', data: { labels: s.labels, datasets: [bar('Avec vainqueur', s.decisive, 0, { stack: 'a' }), bar('Nuls', s.draws, 1, { stack: 'a' }), bar('Annulés', s.cancelled, 2, { stack: 'a' })] }, options: { scales: { x: { stacked: true }, y: { stacked: true } } } });
      table('t-ranking', [['#', 1], ['Joueur'], ['Victoires', 1], ['Défaites', 1], ['Nuls', 1], ['% victoire', 1], ['Combats', 1], ['JP$ gagnés', 1]],
        d.tables.ranking.map((p, i) => [['🥇', '🥈', '🥉'][i] || String(i + 1), who(p.userId), fmt(p.wins, 0), fmt(p.losses, 0), fmt(p.draws, 0), `${fmt(p.winRate, 0)} %`, fmt(p.played, 0), fmt(p.rewards)]));
      table('t-topcards', [['Carte'], ['Rareté'], ['Jouée', 1], ['Victoires', 1], ['% victoire', 1]],
        d.tables.topCards.map((c) => [c.title || c.url, label(c.rarity), fmt(c.plays, 0), fmt(c.wins, 0), `${fmt(c.winRate, 0)} %`]));
    },
    activity(d) {
      since('activity', d.since);
      kpis('activity', [{ key: 'reactions', text: 'Réactions Jeanpip' }, { key: 'activeUsers', text: 'Joueurs actifs' }, { key: 'reactionsPerActive', text: 'Réactions / actif' }], d);
      const s = d.series;
      chart('c-activity', { type: 'bar', data: { labels: s.labels, datasets: [bar('Réactions', s.reactions, 0)] }, options: { plugins: { legend: { display: false } } } });
      chart('c-active', { type: 'line', data: { labels: s.labels, datasets: [line('Joueurs actifs', s.activeUsers, 1)] }, options: { plugins: { legend: { display: false } } } });
      table('t-reactors', [['Joueur'], ['Réactions', 1]], d.tables.topReactors.map((r) => [who(r.userId), fmt(r.reactions, 0)]));
    },
  };

  async function refresh() {
    syncUrl();
    statusEl.className = 'status';
    statusEl.textContent = 'Chargement…';
    try {
      const results = await Promise.all(Object.keys(RENDER).map((b) => api(b).then((d) => [b, d])));
      for (const [b, d] of results) RENDER[b](d);
      statusEl.textContent = `Mis à jour à ${new Date().toLocaleTimeString('fr-FR')}`;
    } catch (e) {
      statusEl.className = 'status error';
      statusEl.textContent = e.message;
    }
  }

  async function init() {
    if (!token) { statusEl.className = 'status error'; statusEl.textContent = 'Lien incomplet : ouvre la page depuis l’onglet Accueil du bot.'; return; }
    try {
      const res = await fetch(`api/stats/players?t=${encodeURIComponent(token)}`, { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        firstAt = j.firstAt;
        const sel = form.elements.user;
        const current = params.get('user') || '';
        for (const p of j.players) {
          names[p.id] = p.name || p.id;
          sel.add(new Option(p.name || p.id, p.id));
        }
        sel.value = current;
      }
    } catch { /* noms facultatifs */ }
    form.addEventListener('change', refresh);
    refresh();
    // 📡 « En direct » : seul ce bloc se recharge, toutes les 15 s (pas quand l'onglet est caché)
    setInterval(() => {
      if (document.hidden) return;
      api('live').then((d) => RENDER.live(d)).catch(() => { /* prochain essai dans 15 s */ });
    }, 15000);
  }
  init();
})();
