// ═══════════════════════════════════════════════════════════
//  🏦 Banque Jeanpip : revente des doublons (v4.0)
//  Même choix que la fenêtre Slack « Revente » : une quantité par rareté.
//  Le serveur décide de tout (resale.trySell) ; ici on affiche et on envoie.
//  Aucune donnée du serveur n'est injectée en HTML (textContent seulement).
// ═══════════════════════════════════════════════════════════
(() => {
  const token = new URLSearchParams(location.search).get('t') || '';
  const api = (p = '') => `api/banque${p}?t=${encodeURIComponent(token)}`;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => String(Math.round(n * 100) / 100).replace('.', ',');

  let state = null;
  let busy = false;
  const inputs = {};   // rareté → <input>

  $('back').href = `ville?t=${encodeURIComponent(token)}`;

  function setMsg(text, kind = '') {
    const el = $('msg');
    el.textContent = text;
    el.className = `msg${kind ? ` ${kind}` : ''}`;
  }

  /** Texte de la fenêtre Slack quand il n'y a rien à revendre (null sinon). */
  function blockedText(s) {
    if (s.pause) return `${s.pause.icon} Pas de revente ${s.pause.short}. Ça reprend ${s.pause.back}.`;
    if (s.raided) return '🚨 Tu subis un raid : pas de revente avant sa fin. Défends-toi d\'abord !';
    if (s.week.remaining <= 0) return `✅ Plafond de la semaine atteint (${fmt(s.week.cap)} JP$). Reviens lundi 😉`;
    if (!s.order.some((r) => s.available[r] > 0)) return '🃏 Aucun doublon à revendre : tu gardes toujours un exemplaire de chaque carte, et ceux de tes decks.';
    return null;
  }

  const maxFor = (r) => Math.min(state.available[r], Math.floor(state.week.remaining / state.prices[r]));
  const qtyOf = (r) => Math.max(0, Math.floor(Number(inputs[r] && inputs[r].value) || 0));

  function updateTotal() {
    let total = 0;
    for (const r of Object.keys(inputs)) {
      const n = qtyOf(r);
      total += n * state.prices[r];
      const row = inputs[r].closest('.row');
      row.querySelector('[data-dir="-1"]').disabled = busy || n <= 0;
      row.querySelector('[data-dir="1"]').disabled = busy || n >= maxFor(r);
    }
    $('total').textContent = fmt(total);
    $('sell').disabled = busy || total <= 0;
  }

  function buildRow(r) {
    const row = document.createElement('div');
    row.className = 'row';
    const label = Object.assign(document.createElement('div'), { className: 'row-label' });
    label.append(`${state.labels[r]} `);
    label.append(Object.assign(document.createElement('span'), { className: 'row-price', textContent: `${fmt(state.prices[r])} JP$ l'unité` }));
    const hint = Object.assign(document.createElement('div'), {
      className: 'row-hint',
      textContent: `${state.available[r]} en double · au plus ${maxFor(r)} avec ton plafond`,
    });
    const stepper = Object.assign(document.createElement('div'), { className: 'stepper' });
    const minus = Object.assign(document.createElement('button'), { type: 'button', textContent: '−' });
    minus.dataset.dir = '-1';
    minus.setAttribute('aria-label', `Une de moins (${state.labels[r]})`);
    const plus = Object.assign(document.createElement('button'), { type: 'button', textContent: '+' });
    plus.dataset.dir = '1';
    plus.setAttribute('aria-label', `Une de plus (${state.labels[r]})`);
    const input = Object.assign(document.createElement('input'), {
      type: 'number', inputMode: 'numeric', min: '0', max: String(state.available[r]), step: '1', value: '0',
    });
    input.setAttribute('aria-label', `Nombre de ${state.labels[r]} à revendre`);
    input.addEventListener('input', updateTotal);
    for (const b of [minus, plus]) {
      b.addEventListener('click', () => {
        input.value = String(Math.max(0, Math.min(maxFor(r), qtyOf(r) + Number(b.dataset.dir))));
        updateTotal();
      });
    }
    stepper.append(minus, input, plus);
    row.append(label, stepper, hint);
    inputs[r] = input;
    return row;
  }

  function render(s) {
    state = s;
    $('balance').textContent = fmt(s.balance);
    $('week').textContent = `Revente : ${fmt(s.week.earned)}/${fmt(s.week.cap)} JP$ cette semaine`;
    const blocked = blockedText(s);
    $('notice').hidden = !blocked;
    $('notice').textContent = blocked || '';
    $('form').hidden = Boolean(blocked);
    const intro = $('intro');
    intro.textContent = '';
    if (!blocked) {
      intro.append('Tu peux encore toucher ');
      intro.append(Object.assign(document.createElement('b'), { textContent: `${fmt(s.week.remaining)} JP$` }));
      intro.append(' cette semaine.');
    } else {
      intro.textContent = 'Le guichet de Jeanpip City : tes cartes en double contre des JP$.';
    }
    const rows = $('rows');
    rows.textContent = '';
    for (const k of Object.keys(inputs)) delete inputs[k];
    if (!blocked) for (const r of s.order.filter((x) => s.available[x] > 0)) rows.append(buildRow(r));
    updateTotal();
  }

  async function call(url, method = 'GET', body) {
    const res = await fetch(url, {
      method, cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 403) throw new Error('Ce lien n\'est pas (ou plus) valable. Rouvre Jeanpip City depuis l\'onglet Accueil du bot dans Slack.');
    if (!res.ok) throw new Error('La banque ne répond pas. Réessaie dans un instant.');
    return res.json();
  }

  async function load() {
    try {
      render(await call(api()));
    } catch (e) {
      $('intro').textContent = '';
      setMsg(e.message, 'err');
    }
  }

  $('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy || !state) return;
    const wanted = {};
    for (const r of Object.keys(inputs)) if (qtyOf(r) > 0) wanted[r] = qtyOf(r);
    busy = true;
    updateTotal();
    setMsg('Revente en cours…');
    try {
      const data = await call(api('/sell'), 'POST', { wanted });
      if (data.ok) {
        const detail = Object.entries(data.sold).map(([r, n]) => `${n} ${state.labels[r].split(' ')[0]}`).join(' · ');
        busy = false;
        render(await call(api()));
        setMsg(`♻️ Revente faite : +${fmt(data.gained)} JP$ (${detail}). Encore ${fmt(data.remaining)} JP$ possibles cette semaine.`, 'ok');
      } else {
        busy = false;
        setMsg(data.text || 'Revente impossible.', 'err');
        if (data.error === 'pause' || data.error === 'raid' || data.error === 'cap' || data.error === 'too_many') {
          const msg = data.text;
          render(await call(api()));
          setMsg(msg, 'err');
        } else {
          updateTotal();
        }
      }
    } catch (e) {
      busy = false;
      updateTotal();
      setMsg(e.message, 'err');
    }
  });

  load();
})();
