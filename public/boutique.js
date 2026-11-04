/* ═══════════════════════════════════════════════════════════
   🎁 Boutique de boosters (ville Jeanpip, v4.0)
   Lien personnel : ?t=<jeton de la ville>. Chemins relatifs uniquement.
   La page reçoit un jeton d'achat à usage unique avec chaque état ; les
   boutons ne s'activent qu'après ~1 s (un achat plus rapide est refusé).
   Booster à stock du jour : un jeton reçu avant son arrivée est refusé
   « stale » → la page reprend un état frais sans message. Pendant la
   fenêtre d'arrivée (fastRefresh), l'état est rafraîchi toutes les ~5 s.
   ═══════════════════════════════════════════════════════════ */
(() => {
  const token = new URLSearchParams(location.search).get('t') || '';
  const q = `t=${encodeURIComponent(token)}`;
  const $ = (id) => document.getElementById(id);

  $('back').href = `ville?${q}`;

  const ARM_DELAY_MS = 1200;       // le serveur refuse un achat < 1 s après la remise du jeton
  const REFRESH_MS = 60 * 1000;    // le jeton vaut 2 min : on en redemande un régulièrement
  const FAST_REFRESH_MS = 5000;    // fenêtre d'arrivée du stock du jour (serveur : 1 interrogation/s max)
  let current = null;              // dernier état reçu
  let armedAt = 0;
  let busy = false;
  let refreshTimer = null;

  function setMsg(text, kind = '') {
    $('msg').textContent = text || '';
    $('msg').className = `msg ${kind}`;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function render(state) {
    current = state;
    $('balance').textContent = state.balance;
    $('pause').hidden = !state.pause;
    if (state.pause) $('pause').textContent = `${state.pause.title} Pas d'achat de booster ${state.pause.short} : retour ${state.pause.back}.`;

    const shelf = $('shelf');
    shelf.textContent = '';
    for (const b of state.boosters) {
      const card = el('article', `booster${b.seasonal ? ' seasonal' : ''}`);
      card.append(el('div', 'emoji', b.emoji), el('h2', '', `Booster ${b.label}`), el('div', 'price', `${b.price} JP$`));
      card.append(el('div', 'label', b.buttonLabel));
      if (b.blockText) card.append(el('div', 'block', b.blockText));
      const btn = el('button', 'buy-btn', b.block ? 'Indisponible' : state.balance < b.price ? `Il te manque ${b.price - state.balance} JP$` : 'Acheter');
      btn.type = 'button';
      btn.dataset.type = b.type;
      btn.dataset.ok = b.block || state.balance < b.price ? '' : '1';
      btn.disabled = true;   // activé après ARM_DELAY_MS
      btn.addEventListener('click', () => buy(b, btn));
      card.append(btn);
      shelf.append(card);
    }
    armedAt = Date.now() + ARM_DELAY_MS;
    setTimeout(arm, ARM_DELAY_MS);
  }

  function arm() {
    if (busy || Date.now() < armedAt) return;
    for (const btn of document.querySelectorAll('.buy-btn')) btn.disabled = !btn.dataset.ok;
  }

  async function load(delay = 0) {
    clearTimeout(refreshTimer);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    try {
      const res = await fetch(`api/boutique?${q}`, { cache: 'no-store' });
      if (res.status === 429) return load(1100);
      if (res.status === 403) {
        setMsg("🔒 Ce lien n'est pas valable. Rouvre Jeanpip City depuis l'onglet Accueil de Jeanpip dans Slack.", 'err');
        return undefined;
      }
      const state = await res.json();
      if (!state.ok) throw new Error(state.reason || 'erreur');
      render(state);
    } catch {
      setMsg('😕 La Boutique ne répond pas. Nouvel essai dans quelques secondes…', 'err');
      refreshTimer = setTimeout(() => load(), 5000);
      return undefined;
    }
    refreshTimer = setTimeout(() => { if (!busy) load(); }, current && current.fastRefresh ? FAST_REFRESH_MS : REFRESH_MS);
    return undefined;
  }

  async function buy(b, btn) {
    if (busy || !current) return;
    busy = true;
    for (const other of document.querySelectorAll('.buy-btn')) other.disabled = true;
    btn.textContent = 'Achat en cours…';
    setMsg('');
    try {
      const res = await fetch(`api/boutique/buy?${q}`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: b.type, nonce: current.nonce }),
      });
      const out = await res.json();
      if (out.ok) {
        $('balance').textContent = out.balance;
        setMsg(`🎉 Booster ${b.label} acheté ! Ouverture…`, 'ok');
        location.href = out.openUrl;   // relatif : open/<id>?t=…
        return;
      }
      // Jeton d'avant l'arrivée du stock : on reprend un état frais, sans message
      if (out.reason !== 'stale') setMsg(out.text || '😕 Achat impossible.', 'err');
    } catch {
      setMsg("😕 La Boutique ne répond pas. Vérifie dans Slack si l'achat est passé avant de réessayer.", 'err');
    }
    busy = false;
    load(1100);   // nouveau jeton d'achat (le précédent est utilisé)
  }

  load();
})();
