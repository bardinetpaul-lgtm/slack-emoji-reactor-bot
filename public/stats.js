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
    admin_gift: 'Dons admin', unknown: '❓ Inconnu', booster: 'Boosters', arena_shop: 'Boutique arène', attack: 'Attaques',
    common: 'Commun', rare: 'Rare', epic: 'Épique', legendary: 'Légendaire', rose: 'Octobre Rose', octobre_rose: '🎀 Octobre Rose',
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
        options: { indexAxis: 'y', plugins: { legend: { display: false } } },
      });
    },
    purchases(d) {
      kpis('purchases', [{ key: 'purchases', text: 'Achats' }, { key: 'credits', text: 'JP$ dépensés' }, { key: 'buyers', text: 'Acheteurs' }], d);
      chart('c-items', { type: 'bar', data: { labels: d.series.labels, datasets: Object.entries(d.series.byItem).map(([k, v], i) => bar(label(k), v, i, { stack: 'a' })) }, options: { scales: { x: { stacked: true }, y: { stacked: true } } } });
      table('t-items', [['Article'], ['Achats', 1], ['JP$', 1], ['Acheteurs', 1]], d.tables.items.map((x) => [label(x.key), fmt(x.count, 0), fmt(x.credits), fmt(x.buyers, 0)]));
    },
    boosters(d) {
      kpis('boosters', [{ key: 'bought', text: 'Achetés' }, { key: 'granted', text: 'Gagnés (arène)' }, { key: 'opened', text: 'Ouverts' }, { key: 'stock', text: 'Non ouverts (stock)' },
        { key: 'roseCards', text: '🎀 Cartes Octobre Rose reçues' }], d);
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
      table('t-perplayer', [['Joueur'], ['Classeur', 1], ['% classeur', 1], ['dont Hors série', 1], ['🎀 Octobre Rose reçues', 1], ['Obtenues un jour', 1]],
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
  }
  init();
})();
