// ═══════════════════════════════════════════════════════════
//  🏆 Classement de l'Arène (v2.2)
//  Panneau ouvert par le bouton « 🏆 Classement » de « Mon deck » et
//  de la préparation du combat. Relu à chaque ouverture (en direct).
//
//  ArenaRanking.open(url) → { close() }
//    url = api/deck/ranking?t=… ou ../api/arena/<id>/ranking?t=…
//    → { top: [{ rank, name, avatar, wins, losses, draws, played, winRate, you }], me }
//  Réutilise le style du tuto (tu-overlay / tu-dialog).
// ═══════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  const MEDALS = ['🥇', '🥈', '🥉'];

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function row(r) {
    const li = el('li', `rk-row${r.you ? ' you' : ''}`);
    li.append(el('span', 'rk-rank', MEDALS[r.rank - 1] || String(r.rank)));
    const who = el('span', 'rk-who');
    if (r.avatar) {
      const img = el('img', 'rk-avatar');
      img.src = r.avatar;
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      who.append(img);
    } else {
      who.append(el('span', 'rk-avatar empty', (r.name || '?').charAt(0).toUpperCase()));
    }
    who.append(el('span', 'rk-name', r.you ? `${r.name} (toi)` : r.name));
    li.append(who);
    li.append(el('span', 'rk-wins', `${r.wins} V`));
    li.append(el('span', 'rk-rate', `${r.winRate} %`));
    li.title = `${r.wins} victoire(s), ${r.losses} défaite(s), ${r.draws} nul(s)`;
    return li;
  }

  function open(url) {
    const overlay = el('div', 'tu-overlay');
    const dialog = el('div', 'tu-dialog rk-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Classement de l’Arène');

    const head = el('div', 'tu-head');
    head.append(el('span', 'tu-kicker', 'Arène Jeanpip'));
    const closeBtn = el('button', 'tu-skip', 'Fermer');
    closeBtn.type = 'button';
    head.append(closeBtn);
    const body = el('div', 'rk-body');
    body.append(el('p', 'tu-text', 'Chargement…'));
    dialog.append(head, el('h2', 'tu-title', '🏆 Classement'), body,
      el('p', 'rk-note', 'Victoires depuis le début, puis % de victoire, puis combats joués.'));
    overlay.append(dialog);
    document.body.append(overlay);

    const onKey = (e) => { if (e.key === 'Escape') close(); };
    function close() {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    }
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);
    closeBtn.focus();

    fetch(url, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        body.textContent = '';
        if (!data.top || !data.top.length) {
          body.append(el('p', 'tu-text', 'Personne n’a encore combattu : la première place est libre !'));
          return;
        }
        const list = el('ol', 'rk-list');
        data.top.forEach((r) => list.append(row(r)));
        if (data.me) {
          list.append(el('li', 'rk-gap', '…'));
          list.append(row(data.me));
        }
        body.append(list);
        if (!data.top.some((r) => r.you) && !data.me) body.append(el('p', 'rk-note', 'Termine un combat pour entrer au classement !'));
      })
      .catch(() => {
        body.textContent = '';
        body.append(el('p', 'tu-text', 'Impossible de charger le classement. Réessaie dans un instant.'));
      });

    return { close };
  }

  root.ArenaRanking = { open };
}(typeof window !== 'undefined' ? window : globalThis));
