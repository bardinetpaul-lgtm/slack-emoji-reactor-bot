// ═══════════════════════════════════════════════════════════
//  🔨 Salle des ventes de Jeanpip City (v4.2)
//  Mêmes règles que les enchères de Slack (v4.1) : le serveur décide de
//  tout (trades.bid / trades.createAuction) ; ici on affiche et on envoie.
//  Aucune donnée du serveur n'est injectée en HTML (textContent seulement).
// ═══════════════════════════════════════════════════════════
(() => {
  const token = new URLSearchParams(location.search).get('t') || '';
  const api = (p = '') => `api/salle${p}?t=${encodeURIComponent(token)}`;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => String(Math.round(Number(n) * 100) / 100).replace('.', ',');
  const REFRESH_MS = 10000;

  const RARITY = {
    common: 'Commune', rare: 'Rare', epic: 'Épique', legendary: 'Légendaire',
    rose: 'Octobre Rose', halloween: 'Halloween', extra: 'Hors série',
  };
  const rarityClass = (r) => `r-${RARITY[r] ? r : 'common'}`;

  let state = null;
  let offset = 0;          // heure du serveur − heure du navigateur
  let busy = false;        // une action est en cours
  let dead = false;        // lien plus valable (403) : on arrête tout
  let selected = null;     // code de la carte choisie pour la vente
  let confirming = false;  // étape de confirmation de la mise en vente
  const lots = new Map();  // tradeId → éléments de la carte d'enchère

  $('back').href = `ville?t=${encodeURIComponent(token)}`;

  const now = () => Date.now() + offset;
  const canAct = () => Boolean(state) && !dead && !busy && !state.blocked && !state.pause;

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }

  function setMsg(text, kind = '') {
    const m = $('msg');
    m.textContent = text || '';
    m.className = `msg${kind ? ` ${kind}` : ''}`;
  }

  /** Image de carte, chargée tard, dans un cadre de taille fixe. */
  function art(card, alt) {
    const box = el('div', 'art');
    if (card && card.image) {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.width = 400;
      img.height = 300;
      img.alt = alt || '';
      img.src = card.image;
      img.addEventListener('error', () => { img.remove(); box.append(el('span', 'noimg', '🃏')); }, { once: true });
      box.append(img);
    } else {
      box.append(el('span', 'noimg', '🃏'));
    }
    return box;
  }

  /** Photo du joueur, ou son initiale sur un rond coloré. */
  function avatar(p) {
    if (p && p.avatar) {
      const img = document.createElement('img');
      img.className = 'avatar';
      img.loading = 'lazy';
      img.width = 28;
      img.height = 28;
      img.alt = '';
      img.src = p.avatar;
      img.addEventListener('error', () => img.replaceWith(initials(p)), { once: true });
      return img;
    }
    return initials(p);
  }
  function initials(p) {
    const name = (p && p.name) || '?';
    const s = el('span', 'avatar', name.charAt(0).toUpperCase());
    s.setAttribute('aria-hidden', 'true');
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
    s.style.background = `hsl(${h}, 45%, 45%)`;
    return s;
  }

  const codeText = (card) => (card && card.code ? `n° ${card.code}` : '');
  const cardTitle = (card) => (card && card.title) || 'Carte sans titre';

  // ── ⏱️ Temps ─────────────────────────────────────────────
  const PARIS = 'Europe/Paris';
  const dayFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, weekday: 'long', day: 'numeric', month: 'numeric' });
  const hourFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, hour: '2-digit', minute: '2-digit' });
  const dayKey = (t) => new Intl.DateTimeFormat('fr-CA', { timeZone: PARIS }).format(t);

  /** « aujourd'hui à 10h00 », « demain à 10h00 », « jeudi 6/11 à 10h00 ». */
  function whenText(t) {
    const today = dayKey(now());
    const tomorrow = dayKey(now() + 86400000);
    const k = dayKey(t);
    const day = k === today ? 'aujourd\'hui' : k === tomorrow ? 'demain' : dayFmt.format(t);
    return `${day} à ${hourFmt.format(t).replace(':', 'h')}`;
  }

  /** Temps restant : « 3 h 05 min », « 4 min 09 s ». */
  function leftText(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    if (h >= 24) return `${Math.floor(h / 24)} j ${h % 24} h`;
    if (h > 0) return `${h} h ${pad(m)} min`;
    return `${m} min ${pad(sec)} s`;
  }

  /** « il y a 5 min », « il y a 3 h », « le mardi 3/11 ». */
  function agoText(t) {
    if (!Number.isFinite(t)) return '';
    const d = Math.max(0, now() - t);
    if (d < 60000) return 'à l\'instant';
    if (d < 3600000) return `il y a ${Math.floor(d / 60000)} min`;
    if (d < 86400000) return `il y a ${Math.floor(d / 3600000)} h`;
    return `le ${dayFmt.format(t)}`;
  }

  function tick() {
    for (const lot of lots.values()) {
      const left = lot.endsAt - now();
      if (left <= 0) {
        lot.timerLeft.textContent = '⌛ Terminée, résultat bientôt';
        lot.timerEnd.hidden = true;
        lot.timer.classList.add('soon');
        if (!lot.ended) { lot.ended = true; updateLotControls(lot); }
      } else {
        lot.timerLeft.textContent = `⏱️ Encore ${leftText(left)}`;
        lot.timerEnd.hidden = false;
        if (lot.ended) { lot.ended = false; updateLotControls(lot); }
        lot.timer.classList.toggle('soon', left < 10 * 60000);
      }
    }
  }

  // ── 🔨 Enchères en cours ────────────────────────────────
  function createLot(a) {
    const lot = { id: a.id, dirty: false, ended: false };
    lot.root = el('article', 'lot');
    lot.badges = el('div', 'badges');
    const body = el('div', 'lot-body');
    const head = el('div', 'lot-head');
    lot.code = el('span', 'code');
    lot.rarity = el('span', 'rarity');
    head.append(lot.code, lot.rarity);
    lot.title = el('h3', 'lot-title');
    lot.titleId = `lot-${String(a.id).replace(/[^\w-]/g, '_')}`;
    lot.title.id = lot.titleId;
    lot.root.setAttribute('aria-labelledby', lot.titleId);
    lot.seller = el('div', 'person');
    const price = el('div', 'price');
    lot.priceLabel = el('span', 'price-label');
    lot.priceValue = el('span', 'price-value');
    price.append(lot.priceLabel, lot.priceValue);
    lot.bestWho = el('div', 'person');
    lot.timer = el('div', 'timer');
    lot.timerLeft = el('span');
    lot.timerEnd = el('small');
    lot.timer.append(lot.timerLeft, lot.timerEnd);

    lot.form = el('form', 'bid-form');
    lot.form.noValidate = true;
    const label = el('label', 'sr-only');
    const inputId = `${lot.titleId}-jp`;
    label.htmlFor = inputId;
    lot.label = label;
    const row = el('div', 'bid-row');
    lot.row = row;
    lot.input = Object.assign(document.createElement('input'), {
      id: inputId, className: 'amount', type: 'number', inputMode: 'numeric', step: '1', required: true,
    });
    lot.err = el('p', 'field-err');
    lot.err.id = `${inputId}-err`;
    lot.err.setAttribute('role', 'alert');
    lot.input.setAttribute('aria-describedby', lot.err.id);
    lot.button = el('button', 'main-btn', '🔨 Enchérir');
    lot.button.type = 'submit';
    row.append(lot.input, lot.button);
    lot.info = el('p', 'info');
    lot.form.append(label, row, lot.err, lot.info);

    lot.input.addEventListener('input', () => {
      lot.dirty = true;
      lot.err.textContent = '';
      lot.input.removeAttribute('aria-invalid');
    });
    lot.form.addEventListener('submit', (ev) => { ev.preventDefault(); placeBid(lot); });

    const artWrap = el('div');
    artWrap.style.position = 'relative';
    lot.artWrap = artWrap;
    body.append(head, lot.title, lot.seller, price, lot.bestWho, lot.timer, lot.form);
    lot.root.append(artWrap, body);
    return lot;
  }

  function personLine(box, prefix, p) {
    box.textContent = '';
    box.append(avatar(p));
    const t = el('span');
    t.append(`${prefix} `, el('b', '', (p && p.name) || 'Quelqu\'un'));
    box.append(t);
  }

  function updateLot(lot, a) {
    const prev = lot.data;
    lot.data = a;
    lot.endsAt = Number(a.endsAt);
    lot.root.className = `lot ${rarityClass(a.card.rarity)}${a.leading ? ' leading' : ''}`;
    if (!prev || prev.card.image !== a.card.image) {
      lot.artWrap.textContent = '';
      lot.artWrap.append(art(a.card, `Carte ${codeText(a.card)} : ${cardTitle(a.card)}`), lot.badges);
    }
    lot.badges.textContent = '';
    if (a.leading) lot.badges.append(el('span', 'badge lead', '🏆 Tu mènes'));
    if (a.mine) lot.badges.append(el('span', 'badge mine', '🏷️ Ta carte'));
    lot.code.textContent = codeText(a.card);
    lot.rarity.textContent = RARITY[a.card.rarity] || a.card.rarity || '';
    lot.title.textContent = cardTitle(a.card);
    personLine(lot.seller, 'Vendue par', a.seller);
    if (a.best) {
      lot.priceLabel.textContent = 'Meilleure offre';
      lot.priceValue.textContent = `${fmt(a.best.jp)} JP$`;
      lot.bestWho.hidden = false;
      personLine(lot.bestWho, a.leading ? 'Par toi,' : 'Par', a.best);
    } else {
      lot.priceLabel.textContent = 'Prix de départ (aucune offre)';
      lot.priceValue.textContent = `${fmt(a.startPrice)} JP$`;
      lot.bestWho.hidden = true;
    }
    lot.timerEnd.textContent = `Fin ${whenText(lot.endsAt)}`;
    lot.label.textContent = `Ton enchère pour ${cardTitle(a.card)}, en JP$ (au moins ${a.minBid})`;
    lot.input.min = String(a.minBid);
    // on ne touche pas à ce que le joueur est en train de taper
    if (!lot.dirty || (prev && prev.minBid !== a.minBid && Number(lot.input.value) < a.minBid && document.activeElement !== lot.input)) {
      lot.input.value = String(a.minBid);
      lot.dirty = false;
    }
    updateLotControls(lot);
  }

  function updateLotControls(lot) {
    const a = lot.data;
    if (!a) return;
    let info = '';
    if (a.mine) info = 'C\'est ta carte : tu ne peux pas enchérir dessus.';
    else if (a.leading) info = `Tu mènes : tes ${fmt(a.best ? a.best.jp : 0)} JP$ sont mis de côté. Ils te sont rendus si quelqu'un te dépasse.`;
    else if (lot.ended) info = 'Les enchères sont closes pour cette carte.';
    else if (dead || (state && (state.blocked || state.pause))) info = '';
    else if (state && state.me && state.me.balance < a.minBid) info = `Il te faut au moins ${a.minBid} JP$ pour enchérir.`;
    else if (state && state.me) info = `Au moins ${a.minBid} JP$. Tu as ${fmt(state.me.balance)} JP$.`;
    const hide = a.mine || a.leading;
    lot.row.hidden = hide;
    if (hide) lot.err.textContent = '';
    lot.info.textContent = info;
    const off = !canAct() || hide || lot.ended;
    lot.input.disabled = off;
    lot.button.disabled = off;
  }

  /** Vérifie le montant avant l'envoi ; renvoie le nombre ou null. */
  function checkBid(lot) {
    const a = lot.data;
    const raw = lot.input.value.trim();
    const n = Number(raw);
    let err = '';
    if (raw === '') err = 'Indique ton enchère en JP$.';
    else if (!Number.isInteger(n)) err = 'Indique un nombre entier de JP$.';
    else if (n < a.minBid) err = `Enchère trop basse. Au moins ${a.minBid} JP$.`;
    else if (n > state.me.balance) err = `Ton solde ne suffit pas pour cette offre. (${fmt(state.me.balance)} JP$)`;
    lot.err.textContent = err;
    if (err) {
      lot.input.setAttribute('aria-invalid', 'true');
      lot.input.focus();
      return null;
    }
    lot.input.removeAttribute('aria-invalid');
    return n;
  }

  async function placeBid(lot) {
    if (!canAct() || !lot.data) return;
    const jp = checkBid(lot);
    if (jp == null) return;
    const title = cardTitle(lot.data.card);
    setBusy(true);
    lot.button.textContent = '…';
    setMsg('Enchère en cours…');
    try {
      const data = await call(api('/bid'), 'POST', { tradeId: lot.id, jp });
      lot.button.textContent = '🔨 Enchérir';
      setBusy(false);
      if (data.ok) {
        lot.dirty = false;
        setMsg(`🔨 Ton enchère de ${jp} JP$ sur « ${title} » est posée : tu mènes !`, 'ok');
        await applyOrReload(data);
      } else {
        setMsg('');
        await applyOrReload(null);
        const again = lots.get(lot.id) || lot;
        again.err.textContent = data.text || 'Enchère impossible.';
        if (!again.row.hidden) again.input.focus();
      }
    } catch (e) {
      lot.button.textContent = '🔨 Enchérir';
      setBusy(false);
      actionError(e);
    }
  }

  function renderAuctions(list) {
    const box = $('auctions');
    const seen = new Set();
    list.forEach((a, i) => {
      seen.add(a.id);
      let lot = lots.get(a.id);
      if (!lot) { lot = createLot(a); lots.set(a.id, lot); }
      updateLot(lot, a);
      if (box.children[i] !== lot.root) box.insertBefore(lot.root, box.children[i] || null);
    });
    for (const [id, lot] of lots) {
      if (!seen.has(id)) {
        lot.root.remove();
        lots.delete(id);
      }
    }
    const n = list.filter((a) => a.endsAt > now()).length;   // même règle que le panneau de la ville
    $('count').textContent = n ? `${n} enchère${n > 1 ? 's' : ''} en cours` : 'Aucune enchère en cours';
    $('live-intro').textContent = n
      ? 'Mise au moins le montant proposé. Tes JP$ sont mis de côté et rendus si quelqu\'un te dépasse.'
      : 'Aucune enchère en cours pour l\'instant. Lance la première juste en dessous !';
    tick();
  }

  // ── 🏷️ Mise en vente ────────────────────────────────────
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let sellSig = '';
  const findSellable = (code) => (state ? state.sellable.find((c) => c.code === code) : null);

  function renderSellable(force = false) {
    const list = (state && state.sellable) || [];
    const q = norm($('sell-search').value.trim());
    const shown = q ? list.filter((c) => norm(c.code).includes(q) || norm(c.title).includes(q)) : list;
    const sig = JSON.stringify([q, canAct(), shown.map((c) => [c.code, c.count, c.floor, c.image, c.title])]);
    if (!force && sig === sellSig) return;
    sellSig = sig;
    const box = $('sellable');
    const focusedCode = box.contains(document.activeElement) ? document.activeElement.dataset.code : null;
    box.textContent = '';
    for (const c of shown) {
      const b = el('button', `pick ${rarityClass(c.rarity)}`);
      b.type = 'button';
      b.dataset.code = c.code;
      b.setAttribute('aria-pressed', String(c.code === selected));
      b.setAttribute('aria-label', `${codeText(c)} ${cardTitle(c)}, ${RARITY[c.rarity] || c.rarity || ''}, tu en as ${c.count}, départ au moins ${c.floor} JP$`);
      b.disabled = !canAct();
      const body = el('span', 'pick-body');
      const head = el('span', 'lot-head');
      head.append(el('span', 'code', codeText(c)), el('span', 'rarity', RARITY[c.rarity] || c.rarity || ''));
      body.append(head, el('span', 'pick-title', cardTitle(c)),
        el('span', 'pick-meta', `Tu en as ${c.count} · départ ≥ ${c.floor} JP$`));
      b.append(art(c, ''), body);
      b.addEventListener('click', () => selectCard(c.code));
      box.append(b);
      if (c.code === focusedCode) b.focus();
    }
    const empty = $('sell-empty');
    empty.hidden = shown.length > 0;
    empty.textContent = list.length ? 'Aucune de tes cartes ne correspond à ta recherche.' : 'Tu n\'as aucune carte que tu peux mettre en vente pour l\'instant.';
  }

  function selectCard(code) {
    const c = findSellable(code);
    if (!c || !canAct()) return;
    selected = code;
    confirming = false;
    const chosen = $('sell-chosen');
    chosen.textContent = '';
    chosen.className = `chosen ${rarityClass(c.rarity)}`;
    const text = el('div', 'chosen-text');
    const head = el('div', 'lot-head');
    head.append(el('span', 'code', codeText(c)), el('span', 'rarity', RARITY[c.rarity] || c.rarity || ''));
    text.append(head, el('b', '', cardTitle(c)), el('span', 'hint', `Tu en as ${c.count}.`));
    chosen.append(art(c, `Carte ${codeText(c)} : ${cardTitle(c)}`), text);
    const price = $('sell-price');
    price.min = String(c.floor);
    price.value = String(c.floor);
    price.removeAttribute('aria-invalid');
    $('sell-floor').textContent = `Au moins ${c.floor} JP$ pour cette rareté.`;
    $('sell-err').textContent = '';
    $('sell-pick').hidden = true;
    $('sell-form').hidden = false;
    showConfirm(false);
    price.focus();
    price.select();
  }

  function resetSell() {
    selected = null;
    confirming = false;
    $('sell-form').hidden = true;
    $('sell-pick').hidden = Boolean(state && (state.blocked || state.pause));
    renderSellable(true);
  }

  function showConfirm(on) {
    confirming = on;
    $('sell-confirm').hidden = !on;
    $('sell-go').textContent = on ? '✅ Confirmer la mise en vente' : 'Continuer';
    $('sell-cancel').textContent = on ? 'Modifier' : 'Changer de carte';
    $('sell-price').disabled = on || !canAct();
  }

  function updateSellControls() {
    const off = !canAct();
    $('sell-go').disabled = off;
    $('sell-cancel').disabled = busy || dead;
    $('sell-price').disabled = confirming || off;
    $('sell-search').disabled = dead;
    renderSellable();
  }

  $('sell-search').addEventListener('input', () => renderSellable());
  $('sell-price').addEventListener('input', () => { $('sell-err').textContent = ''; $('sell-price').removeAttribute('aria-invalid'); });
  $('sell-cancel').addEventListener('click', () => {
    if (confirming) { showConfirm(false); $('sell-price').focus(); } else { resetSell(); $('sell-search').focus(); }
  });

  $('sell-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const c = findSellable(selected);
    if (!c || !canAct()) return;
    const price = $('sell-price');
    const raw = price.value.trim();
    const n = Number(raw);
    if (!confirming) {
      let err = '';
      if (raw === '') err = 'Indique un prix de départ en JP$.';
      else if (!Number.isInteger(n)) err = 'Indique un nombre entier de JP$.';
      else if (n < c.floor) err = `Le prix de départ doit valoir au moins ${c.floor} JP$ pour cette rareté.`;
      $('sell-err').textContent = err;
      if (err) { price.setAttribute('aria-invalid', 'true'); price.focus(); return; }
      $('sell-confirm-text').textContent = `Tu mets en vente « ${cardTitle(c)} » (${codeText(c)}) à partir de ${n} JP$. Tous les inscrits seront prévenus par DM.`;
      showConfirm(true);
      $('sell-go').focus();
      return;
    }
    setBusy(true);
    $('sell-go').textContent = '…';
    setMsg('Mise en vente en cours…');
    try {
      const data = await call(api('/sell'), 'POST', { code: c.code, startPrice: n });
      setBusy(false);
      if (data.ok) {
        $('sell-search').value = '';
        resetSell();
        setMsg(`🏷️ « ${cardTitle(c)} » est en vente à partir de ${n} JP$. Fin ${whenText(Number(data.endsAt))}.`, 'ok');
        await applyOrReload(data);
      } else {
        setMsg('');
        showConfirm(false);
        $('sell-err').textContent = data.text || 'Mise en vente impossible.';
        await applyOrReload(null);
      }
    } catch (e) {
      setBusy(false);
      showConfirm(false);
      actionError(e);
    }
  });

  // ── 📜 Dernières ventes ─────────────────────────────────
  function renderRecent(list) {
    const box = $('recent');
    box.textContent = '';
    for (const r of list) {
      const li = el('li', `sale ${rarityClass(r.card && r.card.rarity)}`);
      const title = el('div', 'sale-title');
      title.append(el('span', 'code', codeText(r.card)), cardTitle(r.card));
      const who = el('div', 'sale-who');
      who.append('Vendue par ', el('b', '', (r.seller && r.seller.name) || '?'), ' à ', el('b', '', (r.winner && r.winner.name) || '?'));
      const price = el('div', 'sale-price', `${fmt(r.jp)} JP$`);
      price.append(el('small', '', agoText(Number(r.at))));
      li.append(art(r.card, ''), title, price, who);
      box.append(li);
    }
    $('recent-empty').hidden = list.length > 0;
  }

  // ── 🔄 État, appels, rafraîchissement ───────────────────
  function render(s) {
    state = s;
    if (Number.isFinite(Number(s.serverTime))) offset = Number(s.serverTime) - Date.now();
    $('balance').textContent = fmt(s.me ? s.me.balance : 0);
    const notice = $('notice');
    const text = s.blocked
      || (s.pause ? `⏸️ ${s.pause.title} : la Salle des ventes est fermée pour l'instant. Tu peux regarder, mais pas enchérir ni vendre.` : '');
    notice.hidden = !text;
    notice.className = 'notice';
    notice.textContent = text;
    renderAuctions(s.auctions || []);
    if (selected && !findSellable(selected)) {
      resetSell();
      setMsg('La carte choisie n\'est plus disponible à la vente.', 'err');
    }
    renderRecent(s.recent || []);
    const closed = Boolean(s.blocked || s.pause);
    if (selected && closed) resetSell();
    $('sell-closed').hidden = !closed;
    $('sell-intro').hidden = closed;
    $('sell-pick').hidden = closed || Boolean(selected);
    updateSellControls();
  }

  function setBusy(b) {
    busy = b;
    for (const lot of lots.values()) updateLotControls(lot);
    updateSellControls();
  }

  class HttpError extends Error {
    constructor(kind) { super(kind); this.kind = kind; }
  }

  async function call(url, method = 'GET', body) {
    let res;
    try {
      res = await fetch(url, {
        method, cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new HttpError('down');
    }
    if (res.status === 403) throw new HttpError('forbidden');
    if (res.status === 429) throw new HttpError('rate');
    if (!res.ok) throw new HttpError('down');
    return res.json();
  }

  function die() {
    dead = true;
    clearInterval(pollTimer);
    const notice = $('notice');
    notice.hidden = false;
    notice.className = 'notice err';
    notice.textContent = 'Ce lien n\'est pas (ou plus) valable. Rouvre Jeanpip City depuis l\'onglet Accueil du bot dans Slack.';
    setMsg('');
    $('live-intro').textContent = '';
    for (const id of ['sell-intro', 'sell-pick', 'sell-form']) $(id).hidden = true;
    for (const lot of lots.values()) updateLotControls(lot);
    updateSellControls();
  }

  function actionError(e) {
    if (e.kind === 'forbidden') return die();
    if (e.kind === 'rate') return setMsg('Doucement ! Réessaie dans quelques secondes.', 'err');
    return setMsg('La Salle des ventes ne répond pas. Réessaie dans un instant.', 'err');
  }

  async function applyOrReload(data) {
    if (data && Array.isArray(data.auctions)) render(data);
    else await load(true);
  }

  async function load(force = false) {
    if (dead || (busy && !force)) return;
    try {
      render(await call(api()));
    } catch (e) {
      if (e.kind === 'forbidden') die();
      else if (e.kind === 'down' && !state) {
        $('live-intro').textContent = '';
        setMsg('La Salle des ventes ne répond pas. Réessaie dans un instant.', 'err');
      }
      // 429 : on réessaie simplement au prochain tour
    }
  }

  const pollTimer = setInterval(() => load(), REFRESH_MS);
  setInterval(tick, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  load();
})();
